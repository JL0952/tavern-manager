import express, { Router } from "express";
import {
  assertRelayType,
  RelayConflictError,
  RelayNotFoundError,
  relayStore,
  RelayValidationError,
} from "../services/relayStore.js";
import { createUniqueExportName, sanitizeExportFileName } from "../services/zipExport.js";
import { sendExportZip, unexpectedErrorSender } from "./routeHelpers.js";

// Presets reach a few MB; the limit leaves room without accepting anything.
export const relayFileLimit = "20mb";

const sendUnexpectedError = unexpectedErrorSender("Relay API");

function sendError(response, error) {
  if (error instanceof RelayValidationError) {
    return response.status(400).json({ error: { code: "relay_invalid_request", message: error.message } });
  }

  if (error instanceof RelayNotFoundError) {
    return response.status(404).json({ error: { code: "relay_not_found", message: error.message } });
  }

  if (error instanceof RelayConflictError) {
    return response.status(409).json({
      error: { code: "relay_name_conflict", message: error.message, existing: error.item },
    });
  }

  return sendUnexpectedError(response, error);
}

// Downloads keep the name the file has in Manager, in UTF-8 where supported.
function attachmentHeader(name) {
  const fileName = `${sanitizeExportFileName(name, "file")}.json`;
  const fallback = fileName.replace(/[^\x20-\x7e]|"/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// A file is stored exactly as received, whatever its declared type.
const rawBody = express.raw({ type: () => true, limit: relayFileLimit });

function readRawBody(request, response, next) {
  rawBody(request, response, (error) => {
    if (error?.type === "entity.too.large") {
      return response.status(413).json({
        error: { code: "relay_too_large", message: `A relay file can be at most ${relayFileLimit}.` },
      });
    }

    return next(error);
  });
}

export function createRelayRouter({ store = relayStore } = {}) {
  const router = Router();

  router.param("type", (request, response, next, type) => {
    try {
      assertRelayType(type);
      return next();
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.get("/:type", async (request, response) => {
    try {
      return response.json({ apiVersion: "relay/v1", type: request.params.type, items: await store.list(request.params.type) });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.get("/:type/:id", async (request, response) => {
    try {
      const { item, contents } = await store.read(request.params.type, request.params.id);
      // setHeader, not set: Express would add a charset the file never declared.
      response.setHeader("Content-Type", "application/json");
      response.set("Content-Disposition", attachmentHeader(item.name));
      response.set("Cache-Control", "no-store");
      return response.send(contents);
    } catch (error) {
      return sendError(response, error);
    }
  });

  // ?name= is the file's name in SillyTavern; ?onConflict= is fail, replace
  // or rename. X-Content-Hash is the uploader's hash of the parsed file.
  router.post("/:type", readRawBody, async (request, response) => {
    try {
      const result = await store.save(request.params.type, {
        name: request.query.name,
        contents: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
        contentHash: request.get("X-Content-Hash"),
        source: request.get("X-Relay-Source") ?? "file",
        onConflict: request.query.onConflict ?? "fail",
      });
      return response.status(result.outcome === "replaced" ? 200 : 201).json({ apiVersion: "relay/v1", ...result });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.post("/:type/archive", express.json({ limit: "1mb" }), async (request, response) => {
    const ids = request.body?.ids;

    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || !id)) {
      return sendError(response, new RelayValidationError("Choose at least one file to download."));
    }

    try {
      const files = [];
      const errors = [];
      const usedNames = new Set();

      for (const id of new Set(ids)) {
        try {
          const { item, contents } = await store.read(request.params.type, id);
          // Zip entries may not contain "..", which names sometimes do.
          const name = createUniqueExportName(item.name.replace(/\.{2,}/g, "."), "json", usedNames, "file");
          files.push({ name, contents });
        } catch (error) {
          if (!(error instanceof RelayNotFoundError)) throw error;
          errors.push(`${id}: no longer in Manager`);
        }
      }

      return sendExportZip(response, {
        files,
        errors,
        baseName: `tavern-manager-${request.params.type}`,
        allFailedMessage: "None of the selected files are in Manager anymore.",
      });
    } catch (error) {
      return sendError(response, error);
    }
  });

  router.delete("/:type/:id", async (request, response) => {
    try {
      await store.remove(request.params.type, request.params.id);
      return response.status(204).end();
    } catch (error) {
      return sendError(response, error);
    }
  });

  return router;
}

export default createRelayRouter();
