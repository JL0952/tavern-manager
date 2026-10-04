import express, { Router } from "express";
import { readDbSnapshot } from "../services/jsonStorage.js";
import { createSyncAvatarService } from "../services/syncAvatarService.js";
import {
  buildSyncManifest,
  buildSyncResource,
  serializeSyncResponse,
  SyncReadIntegrityError,
} from "../services/syncReadModel.js";
import {
  createSyncWriteService,
  SyncWriteConflictError,
  SyncWriteIntegrityError,
  SyncWriteNotFoundError,
  SyncWriteValidationError,
} from "../services/syncWriteService.js";

function requestMatchesEtag(request, etag) {
  const value = request.get("If-None-Match");

  if (!value) {
    return false;
  }

  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag);
}

function sendSyncResponse(request, response, payload) {
  const { body, etag } = serializeSyncResponse(payload);

  response.set("Cache-Control", "private, max-age=0, must-revalidate");
  response.set("ETag", etag);

  if (requestMatchesEtag(request, etag)) {
    return response.status(304).end();
  }

  return response.type("application/json").send(body);
}

function sendIntegrityError(response, error) {
  const details = {};

  if (error.entityType) {
    details.entityType = error.entityType;
  }

  if (error.id) {
    details.id = error.id;
  }

  return response.status(409).json({
    error: {
      code: "sync_integrity_error",
      message: error.message,
      ...details,
    },
  });
}

function sendWriteError(response, error) {
  if (error instanceof SyncWriteValidationError) {
    return response.status(400).json({
      error: { code: "sync_invalid_request", message: error.message },
    });
  }

  if (error instanceof SyncWriteIntegrityError) {
    return sendIntegrityError(response, error);
  }

  if (error instanceof SyncWriteConflictError) {
    return response.status(409).json({
      error: {
        code: error.code,
        entityType: error.entityType,
        id: error.id,
        current: error.current,
      },
    });
  }

  if (error instanceof SyncWriteNotFoundError) {
    return response.status(404).json({
      error: {
        code: "sync_entity_not_found",
        entityType: error.entityType,
        id: error.id,
      },
    });
  }

  console.error("Sync API error:", error);
  return response.status(500).json({ error: "Unexpected server error." });
}

export function createSyncRouter({
  readSnapshot = readDbSnapshot,
  writeService = createSyncWriteService(),
  avatarService = createSyncAvatarService(),
} = {}) {
  if (typeof readSnapshot !== "function") {
    throw new Error("Sync router requires a database snapshot reader.");
  }

  if (
    !writeService ||
    typeof writeService.updateCharacter !== "function" ||
    typeof writeService.updateWorldBook !== "function" ||
    typeof writeService.createCharacter !== "function" ||
    typeof writeService.createWorldBook !== "function"
  ) {
    throw new Error("Sync router requires a sync write service.");
  }

  const router = Router();

  async function handle(request, response, buildResponse) {
    try {
      const db = await readSnapshot();
      const payload = buildResponse(db);

      return payload === null ? undefined : sendSyncResponse(request, response, payload);
    } catch (error) {
      if (error instanceof SyncReadIntegrityError) {
        return sendIntegrityError(response, error);
      }

      console.error("Sync API error:", error);
      return response.status(500).json({ error: "Unexpected server error." });
    }
  }

  router.get("/manifest", (request, response) =>
    handle(request, response, (db) => buildSyncManifest(db)),
  );

  router.get("/characters/:id", (request, response) =>
    handle(request, response, (db) => {
      const resource = buildSyncResource(db, "character", request.params.id);

      if (!resource) {
        response.status(404).json({ error: "Character not found." });
        return null;
      }

      return resource;
    }),
  );

  router.get("/worldbooks/:id", (request, response) =>
    handle(request, response, (db) => {
      const resource = buildSyncResource(db, "worldbook", request.params.id);

      if (!resource) {
        response.status(404).json({ error: "Worldbook not found." });
        return null;
      }

      return resource;
    }),
  );

  async function handleCreate(request, response, entityType) {
    try {
      const result =
        entityType === "character"
          ? await writeService.createCharacter(request.body)
          : await writeService.createWorldBook(request.body);
      return response.status(201).json(result);
    } catch (error) {
      return sendWriteError(response, error);
    }
  }

  async function handleWrite(request, response, entityType) {
    try {
      const result =
        entityType === "character"
          ? await writeService.updateCharacter(request.params.id, request.body)
          : await writeService.updateWorldBook(request.params.id, request.body);
      return response.json(result);
    } catch (error) {
      return sendWriteError(response, error);
    }
  }

  router.post("/characters", (request, response) =>
    handleCreate(request, response, "character"),
  );

  router.post("/worldbooks", (request, response) =>
    handleCreate(request, response, "worldbook"),
  );

  router.put("/characters/:id", (request, response) =>
    handleWrite(request, response, "character"),
  );

  router.put("/worldbooks/:id", (request, response) =>
    handleWrite(request, response, "worldbook"),
  );

  // Character avatars travel with Push and Pull but are not canonical content.
  router.get("/characters/:id/avatar", async (request, response) => {
    try {
      const image = await avatarService.read(request.params.id);

      if (!image) {
        return response.status(404).json({
          error: { code: "sync_avatar_not_found", entityType: "character", id: request.params.id },
        });
      }

      response.set("Cache-Control", "no-store");
      return response.type(image.type).send(image.buffer);
    } catch (error) {
      return sendWriteError(response, error);
    }
  });

  router.put("/characters/:id/avatar", express.raw({ type: "image/png", limit: "20mb" }), async (request, response) => {
    try {
      const { outcome } = await avatarService.write(request.params.id, request.body);
      return response.json({ apiVersion: "sync/v1", avatar: { outcome } });
    } catch (error) {
      return sendWriteError(response, error);
    }
  });

  return router;
}

export default createSyncRouter();
