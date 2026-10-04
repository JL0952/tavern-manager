import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  deleteCharacter,
  getCharacterById,
  getCharacters,
  getWorldBookById,
  mutateLibrary,
  replaceCharacter,
  saveCharacter,
  saveCharacterWithWorldBook,
  updateCharacter,
} from "../services/jsonStorage.js";
import { uploadAvatar, uploadCard } from "../middleware/upload.js";
import {
  CardParserError,
  createAvatarPngExportSource,
  createEmbeddedWorldBook,
  parseCharacterCard,
  parseCharacterNote,
  removeAvatarFile,
  removeCharacterAvatar,
  removeCharacterSourceFile,
  validateAvatarImage,
} from "../services/cardParser.js";
import { withSyncedRawCard } from "../services/characterRawCard.js";
import {
  CardExportError,
  createEmbeddedCharacterBook,
  createJsonExport,
  createPngExport,
} from "../services/cardExporter.js";
import { findCharacterDuplicateCandidates, findManagerIdCandidate } from "../services/duplicateDetection.js";
import { takeEmbeddedManagerId } from "../services/embeddedManagerId.js";
import { createUniqueExportName, sanitizeExportFileName } from "../services/zipExport.js";
import { getDuplicateAction, sendExportZip, unexpectedErrorSender } from "./routeHelpers.js";
import { isPlainObject } from "../services/objects.js";
import { normalizeTagList } from "../services/tagList.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("Card API");

function getRequestIds(body, message) {
  if (!isPlainObject(body)) {
    throw new CardParserError("Request body must be a JSON object.");
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)
    : [];

  if (ids.length === 0) {
    throw new CardParserError(message);
  }

  return [...new Set(ids)];
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Import promotes every known creator-note shape into creator_notes, and
// writes keep rawCard in step, so the record field is the current note.
function getCharacterSearchValues(character) {
  return [character.name, character.creator_notes];
}

function createRawCardShell(character) {
  return {
    spec: character.spec || "chara_card_v3",
    spec_version: character.spec_version || "3.0",
    data: {},
  };
}

function ensureRawCardData(character) {
  if (!isPlainObject(character.rawCard)) {
    character.rawCard = createRawCardShell(character);
  }

  if (!isPlainObject(character.rawCard.data)) {
    character.rawCard.data = {};
  }

  return character.rawCard.data;
}

function syncWorldExtension(character, worldBookName) {
  const rawData = ensureRawCardData(character);
  const extensions = {
    ...(isPlainObject(character.extensions) ? character.extensions : {}),
    ...(isPlainObject(rawData.extensions) ? rawData.extensions : {}),
  };

  extensions.world = worldBookName;
  rawData.extensions = extensions;
  character.extensions = { ...extensions };
}

function clearWorldExtension(character) {
  if (isPlainObject(character.extensions) && Object.hasOwn(character.extensions, "world")) {
    const extensions = { ...character.extensions };
    delete extensions.world;
    character.extensions = extensions;
  }

  if (
    isPlainObject(character.rawCard) &&
    isPlainObject(character.rawCard.data) &&
    isPlainObject(character.rawCard.data.extensions) &&
    Object.hasOwn(character.rawCard.data.extensions, "world")
  ) {
    delete character.rawCard.data.extensions.world;
  }
}

function linkCharacterWorldBook(character, worldBook) {
  const embeddedCharacterBook = createEmbeddedCharacterBook(worldBook);

  if (!embeddedCharacterBook) {
    throw new CardParserError("Selected worldbook cannot be embedded in a character card.");
  }

  const rawData = ensureRawCardData(character);

  character.worldBookId = worldBook.id;
  character.character_book = embeddedCharacterBook;
  rawData.character_book = structuredClone(embeddedCharacterBook);
  syncWorldExtension(character, worldBook.name || "");
}

export function createManualCharacter(body) {
  const name = normalizeOptionalString(body.name);

  if (!name) {
    throw new CardParserError("Character name is required.");
  }

  const description = normalizeOptionalString(body.description);
  const creatorNotes = normalizeOptionalString(body.creator_notes);
  const depthPrompt = parseCharacterNote(body.extensions?.depth_prompt);
  const firstMessage = normalizeOptionalString(body.first_mes);
  const tags = normalizeTagList(body.tags);
  const timestamp = new Date().toISOString();
  const rawData = {
    name,
    description,
    personality: "",
    scenario: "",
    first_mes: firstMessage,
    mes_example: "",
    creator_notes: creatorNotes,
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    group_only_greetings: [],
    creator: "",
    character_version: "",
    tags,
    extensions: { depth_prompt: depthPrompt },
    assets: [],
  };

  return {
    id: randomUUID(),
    fileName: null,
    sourceType: "json",
    avatar: null,
    spec: "chara_card_v3",
    spec_version: "3.0",
    name,
    description,
    personality: "",
    scenario: "",
    first_mes: firstMessage,
    mes_example: "",
    creator_notes: creatorNotes,
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    group_only_greetings: [],
    creator: "",
    character_version: "",
    tags,
    extensions: { depth_prompt: structuredClone(depthPrompt) },
    character_book: null,
    assets: [],
    legacy: {
      creatorcomment: "",
      avatar: "",
      chat: "",
      talkativeness: null,
      fav: false,
      create_date: "",
    },
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: rawData,
    },
    worldBookId: null,
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function unlinkCharacterWorldBook(character) {
  character.worldBookId = null;
  delete character.character_book;

  if (isPlainObject(character.rawCard) && isPlainObject(character.rawCard.data)) {
    delete character.rawCard.data.character_book;
  }

  if (isPlainObject(character.rawCard)) {
    delete character.rawCard.character_book;
  }

  clearWorldExtension(character);
}

async function removeImportedCharacterFiles(character, requestFilePath) {
  await Promise.all([
    rm(requestFilePath, { force: true }),
    removeCharacterAvatar(character),
  ]).catch(() => {});
}

function createCharacterConflictResponse(character, candidates, managerIdMatch = null) {
  return {
    error: managerIdMatch
      ? "This file belongs to an existing Manager character."
      : "Possible duplicate character detected.",
    type: "character",
    pendingImport: {
      name: character.name || "Unnamed character",
      tags: Array.isArray(character.tags) ? character.tags : [],
      sourceType: character.sourceType || "",
    },
    candidates,
    ...(managerIdMatch ? { managerIdMatch } : {}),
  };
}

router.post("/import", uploadCard, async (request, response) => {
  if (!request.file) {
    return response
      .status(400)
      .json({ error: 'Upload a .json or .png character card using the "file" field.' });
  }

  let character;

  try {
    character = await parseCharacterCard(request.file);
    // The stored record never keeps the marker; a new card gets a new UUID.
    const embeddedManagerId = takeEmbeddedManagerId(character);
    const duplicateAction = getDuplicateAction(request, CardParserError);

    if (duplicateAction === "skip") {
      await removeImportedCharacterFiles(character, request.file.path);
      return response.json({ skipped: true });
    }

    const characters = await getCharacters();
    // A file exported from an existing card is identified by its UUID alone;
    // the user chooses to update that card or import a separate new one.
    const managerIdCandidate = findManagerIdCandidate(embeddedManagerId, characters);
    const duplicateCandidates = managerIdCandidate
      ? [managerIdCandidate]
      : findCharacterDuplicateCandidates(character, characters);

    if (duplicateCandidates.length > 0 && !duplicateAction) {
      await removeImportedCharacterFiles(character, request.file.path);
      return response.status(409).json(
        createCharacterConflictResponse(character, duplicateCandidates, managerIdCandidate?.id),
      );
    }

    const embeddedWorldBook = createEmbeddedWorldBook(character);

    if (duplicateAction === "replace_existing") {
      const replaceId = request.body?.replaceId;

      if (!replaceId || typeof replaceId !== "string") {
        await removeImportedCharacterFiles(character, request.file.path);
        return response.status(400).json({ error: "replaceId is required to replace a character." });
      }

      if (managerIdCandidate && replaceId !== managerIdCandidate.id) {
        await removeImportedCharacterFiles(character, request.file.path);
        return response.status(400).json({
          error: "This file belongs to another Manager character; it can only update that character.",
        });
      }

      const replacedCharacter = await replaceCharacter(replaceId, character, embeddedWorldBook);

      if (!replacedCharacter) {
        await removeImportedCharacterFiles(character, request.file.path);
        return response.status(404).json({ error: "Replacement character not found." });
      }

      return response.json(replacedCharacter);
    }

    let savedCharacter;

    if (embeddedWorldBook) {
      character.worldBookId = embeddedWorldBook.id;
      savedCharacter = await saveCharacterWithWorldBook(character, embeddedWorldBook);
    } else {
      savedCharacter = await saveCharacter(character);
    }

    return response.status(201).json(savedCharacter);
  } catch (error) {
    await rm(request.file.path, { force: true }).catch(() => {});
    await removeCharacterAvatar(character).catch(() => {});

    if (error instanceof CardParserError) {
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
    const character = createManualCharacter(request.body);
    const requestedWorldBookId =
      typeof request.body.worldBookId === "string" ? request.body.worldBookId.trim() : "";
    const createdCharacter = await mutateLibrary((transaction) => {
      if (requestedWorldBookId) {
        const worldBook = transaction.getWorldBook(requestedWorldBookId);

        if (!worldBook) {
          return null;
        }

        linkCharacterWorldBook(character, worldBook);
      }

      return transaction.createCharacter(withSyncedRawCard(character));
    });

    if (!createdCharacter) {
      return response.status(404).json({ error: "World book not found." });
    }

    return response.status(201).json(createdCharacter);
  } catch (error) {
    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.get("/", async (request, response) => {
  const { search, tag, tags } = request.query;

  if (search !== undefined && typeof search !== "string") {
    return response.status(400).json({ error: 'Query parameter "search" must be a string.' });
  }

  if (
    tag !== undefined &&
    typeof tag !== "string" &&
    !(Array.isArray(tag) && tag.every((value) => typeof value === "string"))
  ) {
    return response
      .status(400)
      .json({ error: 'Query parameter "tag" must be a string or repeated strings.' });
  }

  if (tags !== undefined && typeof tags !== "string") {
    return response.status(400).json({ error: 'Query parameter "tags" must be a string.' });
  }

  try {
    let characters = await getCharacters();
    const selectedTags = [
      ...(typeof tags === "string" ? tags.split(",") : []),
      ...(Array.isArray(tag) ? tag : typeof tag === "string" ? [tag] : []),
    ]
      .map((selectedTag) => selectedTag.trim().toLowerCase())
      .filter(Boolean);

    const normalizedSearch = search ? search.trim().toLowerCase() : "";

    if (normalizedSearch) {
      characters = characters.filter((character) => {
        return getCharacterSearchValues(character).some(
          (value) => typeof value === "string" && value.toLowerCase().includes(normalizedSearch),
        );
      });
    }

    if (selectedTags.length > 0) {
      characters = characters.filter(
        (character) =>
          Array.isArray(character.tags) &&
          selectedTags.every((selectedTag) =>
            character.tags.some(
              (characterTag) =>
                typeof characterTag === "string" &&
                characterTag.toLowerCase() === selectedTag,
            ),
          ),
      );
    }

    return response.json(characters);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/export/batch", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  const ids = Array.isArray(request.body.ids) ? request.body.ids : [];
  const format = request.body.format || "json";

  if (ids.length === 0 || !ids.every((id) => typeof id === "string" && id.trim())) {
    return response.status(400).json({ error: "Select at least one character to export." });
  }

  if (!["json", "png", "both"].includes(format)) {
    return response.status(400).json({ error: 'Batch export format must be "json", "png", or "both".' });
  }

  const files = [];
  const errors = [];
  const usedNames = new Set();
  const formats = format === "both" ? ["json", "png"] : [format];

  try {
    for (const id of ids) {
      const character = await getCharacterById(id);

      if (!character) {
        errors.push(`Character ${id}: not found`);
        continue;
      }

      const linkedWorldBook = character.worldBookId
        ? await getWorldBookById(character.worldBookId)
        : null;

      for (const exportFormat of formats) {
        try {
          files.push({
            name: createUniqueExportName(
              character.name || "character-card",
              exportFormat,
              usedNames,
              "character-card",
            ),
            contents:
              exportFormat === "png"
                ? await createPngExport(character, linkedWorldBook)
                : createJsonExport(character, linkedWorldBook),
          });
        } catch (error) {
          errors.push(`${character.name || id} ${exportFormat}: ${error.message}`);
        }
      }
    }

    return sendExportZip(response, {
      files,
      errors,
      baseName: "characters-export",
      allFailedMessage: "All selected character exports failed.",
    });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/batch-delete", async (request, response) => {
  let ids;

  try {
    ids = getRequestIds(request.body, "Select at least one character to delete.");
  } catch (error) {
    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }

  const failed = [];
  let deleted = 0;

  try {
    for (const id of ids) {
      try {
        const character = await getCharacterById(id);

        if (!character) {
          failed.push({ id, error: "Character card not found." });
          continue;
        }

        const removed = await deleteCharacter(id);

        if (!removed) {
          failed.push({ id, error: "Character card not found." });
          continue;
        }

        deleted += 1;
        await Promise.all([
          removeCharacterAvatar(character),
          removeCharacterSourceFile(character),
        ]).catch((error) => {
          failed.push({ id, error: `Deleted, but file cleanup failed: ${error.message}` });
        });
      } catch (error) {
        failed.push({ id, error: error.message });
      }
    }

    return response.json({ deleted, failed });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/batch-tags", async (request, response) => {
  let ids;

  try {
    ids = getRequestIds(request.body, "Select at least one character to update.");
  } catch (error) {
    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }

  const addTags = normalizeTagList(request.body.addTags);
  const removeTags = normalizeTagList(request.body.removeTags);
  const createMissingDefinitions = request.body.createMissingDefinitions === true;

  if (addTags.length === 0 && removeTags.length === 0) {
    return response.status(400).json({ error: "Add or remove at least one tag." });
  }

  try {
    const result = await mutateLibrary((transaction) => {
      const selectedIds = new Set(ids);
      const removeSet = new Set(removeTags);
      const characters = transaction.listCharacters();
      const knownCharacterIds = new Set(characters.map((character) => character.id));
      const failed = ids
        .filter((id) => !knownCharacterIds.has(id))
        .map((id) => ({ id, error: "Character card not found." }));
      const updatedAt = new Date().toISOString();
      let updated = 0;

      for (const character of characters) {
        if (!selectedIds.has(character.id)) {
          continue;
        }

        const currentTags = normalizeTagList(character.tags).filter((tag) => !removeSet.has(tag));
        const nextTags = [...currentTags];

        for (const tag of addTags) {
          if (!nextTags.includes(tag)) {
            nextTags.push(tag);
          }
        }

        const updatedCharacter = withSyncedRawCard({
          ...character,
          tags: nextTags,
          updatedAt,
        });
        transaction.updateCharacter(character.id, () => updatedCharacter);
        updated += 1;
      }

      const tagDefinitions = transaction.getTagDefinitions();
      const existingDefinitions = new Set(
        tagDefinitions
          .map((definition) => (typeof definition?.name === "string" ? definition.name.trim() : ""))
          .filter(Boolean),
      );
      const createdTags = [];

      if (createMissingDefinitions) {
        for (const tag of addTags) {
          if (existingDefinitions.has(tag)) {
            continue;
          }

          tagDefinitions.push({ name: tag, color: "", category: "" });
          existingDefinitions.add(tag);
          createdTags.push(tag);
        }
      }

      transaction.replaceTagDefinitions(tagDefinitions);
      return { updated, createdTags, failed };
    });

    return response.json(result);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.get("/:id/export", async (request, response) => {
  const format = request.query.format || "json";

  if (!["json", "png"].includes(format)) {
    return response.status(400).json({ error: 'Export format must be "json" or "png".' });
  }

  try {
    const character = await getCharacterById(request.params.id);

    if (!character) {
      return response.status(404).json({ error: "Character card not found." });
    }

    const linkedWorldBook = character.worldBookId
      ? await getWorldBookById(character.worldBookId)
      : null;
    const fileName = `${sanitizeExportFileName(character.name, "character-card")}.${format}`;
    const contents =
      format === "png"
        ? await createPngExport(character, linkedWorldBook)
        : createJsonExport(character, linkedWorldBook);

    response.attachment(fileName);
    response.type(format);
    return response.send(contents);
  } catch (error) {
    if (error instanceof CardExportError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.post("/:id/avatar", uploadAvatar, async (request, response) => {
  if (!request.file) {
    return response
      .status(400)
      .json({ error: 'Upload a PNG, JPG, JPEG, or WEBP avatar using the "file" field.' });
  }

  let avatarPng = null;

  try {
    const character = await getCharacterById(request.params.id);

    if (!character) {
      await rm(request.file.path, { force: true });
      return response.status(404).json({ error: "Character card not found." });
    }

    await validateAvatarImage(request.file.path);
    avatarPng = await createAvatarPngExportSource(request.file.path, request.file.filename);

    const updatedCharacter = await updateCharacter(request.params.id, {
      avatar: `avatars/${request.file.filename}`,
      avatarPng,
      avatarSource: "uploaded",
    });

    await removeCharacterAvatar(character).catch((error) => {
      console.warn("Unable to remove replaced avatar:", error);
    });

    return response.status(201).json(updatedCharacter);
  } catch (error) {
    await rm(request.file.path, { force: true }).catch(() => {});
    await removeAvatarFile(avatarPng).catch(() => {});

    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.get("/:id", async (request, response) => {
  try {
    const character = await getCharacterById(request.params.id);

    if (!character) {
      return response.status(404).json({ error: "Character card not found." });
    }

    return response.json(character);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.put("/:id/worldbook", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  const { worldBookId } = request.body;

  if (worldBookId !== null && (typeof worldBookId !== "string" || !worldBookId.trim())) {
    return response
      .status(400)
      .json({ error: 'Request body field "worldBookId" must be a worldbook id or null.' });
  }

  try {
    const outcome = await mutateLibrary((transaction) => {
      const character = transaction.getCharacter(request.params.id);

      if (!character) {
        return { character: null, worldBookMissing: false };
      }

      if (worldBookId === null) {
        unlinkCharacterWorldBook(character);
      } else {
        const worldBook = transaction.getWorldBook(worldBookId.trim());

        if (!worldBook) {
          return { character: null, worldBookMissing: true };
        }

        linkCharacterWorldBook(character, worldBook);
      }

      character.pinned = Boolean(character.pinned);
      character.updatedAt = new Date().toISOString();
      return {
        character: transaction.updateCharacter(request.params.id, () => withSyncedRawCard(character)),
        worldBookMissing: false,
      };
    });

    if (!outcome.character && !outcome.worldBookMissing) {
      return response.status(404).json({ error: "Character card not found." });
    }

    if (outcome.worldBookMissing) {
      return response.status(404).json({ error: "World book not found." });
    }

    return response.json(outcome.character);
  } catch (error) {
    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.put("/:id", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  if (Object.hasOwn(request.body, "id") || Object.hasOwn(request.body, "sync")) {
    return response.status(400).json({ error: 'Character updates cannot modify "id" or "sync".' });
  }

  if (Object.hasOwn(request.body, "tags") && !Array.isArray(request.body.tags)) {
    return response.status(400).json({ error: '"tags" must be an array of strings.' });
  }

  try {
    // updateCharacter normalizes the note inside its transaction; validate it first.
    if (Object.hasOwn(request.body.extensions ?? {}, "depth_prompt")) {
      parseCharacterNote(request.body.extensions.depth_prompt);
    }

    const updates = Object.hasOwn(request.body, "tags")
      ? { ...request.body, tags: normalizeTagList(request.body.tags) }
      : request.body;
    const character = await updateCharacter(request.params.id, updates);

    if (!character) {
      return response.status(404).json({ error: "Character card not found." });
    }

    return response.json(character);
  } catch (error) {
    if (error instanceof CardParserError) {
      return response.status(400).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.put("/:id/pin", async (request, response) => {
  if (!isPlainObject(request.body)) {
    return response.status(400).json({ error: "Request body must be a JSON object." });
  }

  if (typeof request.body.pinned !== "boolean") {
    return response.status(400).json({ error: 'Request body field "pinned" must be a boolean.' });
  }

  try {
    const character = await updateCharacter(request.params.id, {
      pinned: request.body.pinned,
    });

    if (!character) {
      return response.status(404).json({ error: "Character card not found." });
    }

    return response.json(character);
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.delete("/:id", async (request, response) => {
  try {
    const character = await getCharacterById(request.params.id);
    const deleted = await deleteCharacter(request.params.id);

    if (!deleted) {
      return response.status(404).json({ error: "Character card not found." });
    }

    await Promise.all([
      removeCharacterAvatar(character),
      removeCharacterSourceFile(character),
    ]).catch((error) => {
      console.warn("Unable to remove deleted character files:", error);
    });

    return response.json({ deleted: true });
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

export default router;
