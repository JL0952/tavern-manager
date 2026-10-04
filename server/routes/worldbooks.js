import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { uploadWorldBook } from "../middleware/upload.js";
import {
  deleteWorldBookIfUnlinked,
  getWorldBookById,
  getWorldBooks,
  replaceWorldBook,
  saveWorldBook,
  updateWorldBook,
} from "../services/jsonStorage.js";
import {
  createWorldBookExport,
  parseWorldBook,
  removeWorldBookSourceFile,
  WorldBookParserError,
} from "../services/worldBookParser.js";
import { findWorldBookDuplicateCandidates } from "../services/duplicateDetection.js";
import { createUniqueExportName, sanitizeExportFileName } from "../services/zipExport.js";
import { getDuplicateAction, sendExportZip, unexpectedErrorSender } from "./routeHelpers.js";
import { isPlainObject } from "../services/objects.js";
import { normalizeCanonicalWorldBookEntry } from "../services/syncProjection.js";
import { materializeWorldBookEntry } from "../services/syncCanonicalMaterializer.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("World book API");

function encodeRfc5987FileName(fileName) {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function textIncludes(value, query) {
  return String(value ?? "").toLowerCase().includes(query);
}

function worldBookMatchesSearch(worldBook, query) {
  return (
    textIncludes(worldBook?.name, query) ||
    textIncludes(worldBook?.fileName, query) ||
    textIncludes(worldBook?.source, query)
  );
}

function normalizeSearchValue(value) {
  return String(value ?? "").toLowerCase();
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];

  return [
    ...new Set(
      values
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

function getEntrySearchableValues(entry) {
  if (!isPlainObject(entry)) {
    return [];
  }

  return [
    entry.comment,
    entry.content,
    ...(Array.isArray(entry.keys) ? entry.keys : []),
    ...(Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []),
  ];
}

function includesSearch(values, search) {
  const normalizedSearch = normalizeSearchValue(search);

  return values.some((value) =>
    normalizeSearchValue(value).includes(normalizedSearch),
  );
}


function createWorldBookConflictResponse(worldBook, candidates) {
  return {
    error: "Possible duplicate worldbook detected.",
    type: "worldbook",
    pendingImport: {
      name: worldBook.name || "Unnamed worldbook",
      entryCount: Array.isArray(worldBook.entries) ? worldBook.entries.length : 0,
    },
    candidates,
  };
}

function createManualWorldBookEntry(entryBody) {
  if (!isPlainObject(entryBody)) {
    return null;
  }

  const comment = normalizeOptionalString(entryBody.comment);
  const content = normalizeOptionalString(entryBody.content);
  const keys = normalizeStringArray(entryBody.keys);

  if (!comment && !content && keys.length === 0) {
    return null;
  }

  // Everything not typed in takes ST's new-entry defaults, written once in
  // both the Manager record and ST's World Info dialect.
  const entry = normalizeCanonicalWorldBookEntry({ id: randomUUID(), comment, content }, 0);
  return materializeWorldBookEntry({ ...entry, keys }, null);
}

export function createManualWorldBook(body) {
  const name = normalizeOptionalString(body.name);

  if (!name) {
    throw new WorldBookParserError("Worldbook name is required.");
  }

  const timestamp = new Date().toISOString();
  const firstEntry = createManualWorldBookEntry(body.firstEntry);
  const entries = firstEntry ? [firstEntry] : [];

  return {
    id: randomUUID(),
    fileName: null,
    name,
    sourceType: "json",
    source: "manual",
    entries,
    tags: [],
    rawWorldBook: {
      name,
      entries: Object.fromEntries(entries.map((entry) => [entry.id, structuredClone(entry.rawEntry)])),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

router.post("/import", uploadWorldBook, async (request, response) => {
  if (!request.file) {
    return response.status(400).json({ error: 'Upload a .json world book using the "file" field.' });
  }

  try {
    const worldBook = await parseWorldBook(request.file);
    const duplicateAction = getDuplicateAction(request, WorldBookParserError);

    if (duplicateAction === "skip") {
      await rm(request.file.path, { force: true }).catch(() => {});
      return response.json({ skipped: true });
    }

    const duplicateCandidates = findWorldBookDuplicateCandidates(
      worldBook,
      await getWorldBooks(),
    );

    if (duplicateCandidates.length > 0 && !duplicateAction) {
      await rm(request.file.path, { force: true }).catch(() => {});
      return response.status(409).json(createWorldBookConflictResponse(worldBook, duplicateCandidates));
    }

    if (duplicateAction === "replace_existing") {
      const replaceId = request.body?.replaceId;

      if (!replaceId || typeof replaceId !== "string") {
        await rm(request.file.path, { force: true }).catch(() => {});
        return response.status(400).json({ error: "replaceId is required to replace a worldbook." });
      }

      const replacedWorldBook = await replaceWorldBook(replaceId, worldBook);

      if (!replacedWorldBook) {
        await rm(request.file.path, { force: true }).catch(() => {});
        return response.status(404).json({ error: "Replacement worldbook not found." });
      }

      return response.json(replacedWorldBook);
    }

    await saveWorldBook(worldBook);
    return response.status(201).json(worldBook);
  } catch (error) {
    await rm(request.file.path, { force: true }).catch(() => {});

    if (error instanceof WorldBookParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.post("/", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  try {
    const worldBook = createManualWorldBook(request.body);

    await saveWorldBook(worldBook);
    return response.status(201).json(worldBook);
  } catch (error) {
    if (error instanceof WorldBookParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.get("/", async (request, response) => {
  const { search, summary } = request.query;

  if (search !== undefined && typeof search !== "string") {
    return response.status(400).json({ error: 'Query parameter "search" must be a string.' });
  }

  if (summary !== undefined && summary !== "true") {
    return response.status(400).json({ error: 'Query parameter "summary" must be "true" when present.' });
  }

  try {
    let worldBooks = await getWorldBooks();

    if (search) {
      const query = normalizeSearchValue(search);

      worldBooks = worldBooks.filter((worldBook) =>
        worldBookMatchesSearch(worldBook, query),
      );
    }

    // Lists that only label worldbooks skip entries and raw data.
    if (summary) {
      return response.json(worldBooks.map(({ id, name }) => ({ id, name })));
    }

    return response.json(worldBooks);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/export/batch", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  const ids = Array.isArray(request.body.ids) ? request.body.ids : [];

  if (ids.length === 0 || !ids.every((id) => typeof id === "string" && id.trim())) {
    return response.status(400).json({ error: "Select at least one worldbook to export." });
  }

  const files = [];
  const errors = [];
  const usedNames = new Set();

  try {
    for (const id of ids) {
      try {
        const worldBook = await getWorldBookById(id);

        if (!worldBook) {
          errors.push(`Worldbook ${id}: not found`);
          continue;
        }

        files.push({
          name: createUniqueExportName(
            worldBook.name || "worldbook",
            "json",
            usedNames,
            "worldbook",
          ),
          contents: createWorldBookExport(worldBook),
        });
      } catch (error) {
        errors.push(`Worldbook ${id}: ${error.message}`);
      }
    }

    return sendExportZip(response, {
      files,
      errors,
      baseName: "worldbooks-export",
      allFailedMessage: "All selected worldbook exports failed.",
    });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/batch-delete", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  const ids = Array.isArray(request.body.ids)
    ? request.body.ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)
    : [];

  if (ids.length === 0) {
    return response.status(400).json({ error: "Select at least one worldbook to delete." });
  }

  const blocked = [];
  const failed = [];
  let deleted = 0;

  try {
    for (const id of [...new Set(ids)]) {
      try {
        const outcome = await deleteWorldBookIfUnlinked(id);

        if (!outcome.worldBook) {
          failed.push({ id, error: "World book not found." });
          continue;
        }

        if (outcome.linkedCharacters.length > 0) {
          blocked.push({
            id,
            name: outcome.worldBook.name || "Unnamed worldbook",
            linkedCharacters: outcome.linkedCharacters,
          });
          continue;
        }

        deleted += 1;
        await removeWorldBookSourceFile(outcome.worldBook).catch((error) => {
          failed.push({ id, error: `Deleted, but file cleanup failed: ${error.message}` });
        });
      } catch (error) {
        failed.push({ id, error: error.message });
      }
    }

    return response.json({ deleted, blocked, failed });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.get("/:id/entries", async (request, response) => {
  const { search } = request.query;

  if (search !== undefined && typeof search !== "string") {
    return response.status(400).json({ error: 'Query parameter "search" must be a string.' });
  }

  try {
    const worldBook = await getWorldBookById(request.params.id);

    if (!worldBook) {
      return response.status(404).json({ error: "World book not found." });
    }

    let entries = Array.isArray(worldBook.entries) ? worldBook.entries : [];

    if (search) {
      entries = entries.filter((entry) =>
        includesSearch(getEntrySearchableValues(entry), search),
      );
    }

    return response.json(entries);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.get("/:id/export", async (request, response) => {
  try {
    const worldBook = await getWorldBookById(request.params.id);

    if (!worldBook) {
      return response.status(404).json({ error: "World book not found." });
    }

    const fileName = `${sanitizeExportFileName(worldBook.name, "worldbook")}.json`;

    response.set(
      "Content-Disposition",
      `attachment; filename="worldbook.json"; filename*=UTF-8''${encodeRfc5987FileName(fileName)}`,
    );
    response.set("Content-Type", "application/json; charset=utf-8");
    return response.send(createWorldBookExport(worldBook));
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.get("/:id", async (request, response) => {
  try {
    const worldBook = await getWorldBookById(request.params.id);

    if (!worldBook) {
      return response.status(404).json({ error: "World book not found." });
    }

    return response.json(worldBook);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.put("/:id", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  if (Object.hasOwn(request.body, "id") || Object.hasOwn(request.body, "sync")) {
    return response.status(400).json({ error: 'Worldbook updates cannot modify "id" or "sync".' });
  }

  try {
    const worldBook = await updateWorldBook(request.params.id, request.body);

    if (!worldBook) {
      return response.status(404).json({ error: "World book not found." });
    }

    return response.json(worldBook);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.delete("/:id", async (request, response) => {
  try {
    const outcome = await deleteWorldBookIfUnlinked(request.params.id);

    if (!outcome.worldBook) {
      return response.status(404).json({ error: "World book not found." });
    }

    if (outcome.linkedCharacters.length > 0) {
      return response.status(409).json({
        error: "Cannot delete worldbook because it is linked to characters.",
        linkedCharacters: outcome.linkedCharacters,
      });
    }

    await removeWorldBookSourceFile(outcome.worldBook).catch((error) => {
      console.warn("Unable to remove deleted world book file:", error);
    });

    return response.json({ deleted: true });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

export default router;
