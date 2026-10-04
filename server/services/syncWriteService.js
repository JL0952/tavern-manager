import { mutateLibrary as defaultMutateLibrary } from "./jsonStorage.js";
import { randomUUID } from "node:crypto";
import {
  materializeCanonicalCharacter,
  materializeCanonicalWorldBook,
  SyncCanonicalMaterializationError,
} from "./syncCanonicalMaterializer.js";
import { SyncEntityStateIntegrityError } from "./syncEntityState.js";
import { buildSyncResource } from "./syncReadModel.js";
import {
  SyncMetadataIntegrityError,
  SyncMetadataValidationError,
} from "./syncMetadata.js";
import { stableSerialize } from "./syncProjection.js";
import { isPlainObject } from "./objects.js";

export class SyncWriteValidationError extends Error {}

export class SyncWriteConflictError extends Error {
  constructor(code, state) {
    super(`Sync write base revision conflicts with current ${state.type} metadata.`);
    this.code = code;
    this.entityType = state.type;
    this.id = state.id;
    this.current = toConflictCurrent(state);
  }
}

export class SyncWriteNotFoundError extends Error {
  constructor(entityType, id) {
    super(`${entityType} "${id}" was not found.`);
    this.entityType = entityType;
    this.id = id;
  }
}

export class SyncWriteIntegrityError extends Error {
  constructor(message, { entityType = null, id = null } = {}) {
    super(message);
    this.entityType = entityType;
    this.id = id;
  }
}

function clone(value) {
  return structuredClone(value);
}

function assertEntityId(id, entityType) {
  if (typeof id !== "string" || !id) {
    throw new SyncWriteValidationError(`${entityType} id must be a non-empty string.`);
  }
}

function validateWriteRequest(request) {
  if (!isPlainObject(request)) {
    throw new SyncWriteValidationError("Sync write request must be an object.");
  }

  const expectedKeys = new Set(["baseRevision", "canonical"]);

  for (const key of Object.keys(request)) {
    if (!expectedKeys.has(key)) {
      throw new SyncWriteValidationError(`Sync write request contains unsupported field "${key}".`);
    }
  }

  for (const key of expectedKeys) {
    if (!Object.hasOwn(request, key)) {
      throw new SyncWriteValidationError(`Sync write request is missing required field "${key}".`);
    }
  }

  if (!Number.isSafeInteger(request.baseRevision) || request.baseRevision < 1) {
    throw new SyncWriteValidationError("baseRevision must be a positive integer.");
  }

  if (!isPlainObject(request.canonical)) {
    throw new SyncWriteValidationError("canonical must be an object.");
  }

  return {
    baseRevision: request.baseRevision,
    canonical: clone(request.canonical),
  };
}

function validateCreateRequest(request) {
  if (!isPlainObject(request)) {
    throw new SyncWriteValidationError("Sync create request must be an object.");
  }

  if (Object.keys(request).length !== 1 || !Object.hasOwn(request, "canonical")) {
    throw new SyncWriteValidationError("Sync create request must contain only canonical.");
  }

  if (!isPlainObject(request.canonical)) {
    throw new SyncWriteValidationError("canonical must be an object.");
  }

  return { canonical: clone(request.canonical) };
}

function toConflictCurrent(state) {
  return {
    revision: state.revision,
    contentHash: state.contentHash,
    updatedAt: state.updatedAt,
    metadataSource: state.metadataSource,
    resource: `/api/sync/v1/${state.type === "character" ? "characters" : "worldbooks"}/${encodeURIComponent(state.id)}`,
  };
}

function assertMatchingBaseRevision(baseRevision, state) {
  if (baseRevision === state.revision) {
    return;
  }

  throw new SyncWriteConflictError(
    baseRevision < state.revision ? "sync_revision_conflict" : "sync_future_base_revision",
    state,
  );
}

function hasSameCanonicalProjection(left, right) {
  try {
    return stableSerialize(left) === stableSerialize(right);
  } catch (error) {
    throw new SyncWriteValidationError(`Canonical projection is not serializable: ${error.message}`);
  }
}

function isIntegrityError(error) {
  return (
    error instanceof SyncEntityStateIntegrityError ||
    error instanceof SyncMetadataIntegrityError ||
    error instanceof SyncMetadataValidationError
  );
}

function writeTimestamp(now) {
  const timestamp = typeof now === "function" ? now() : now;

  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("Sync write clock must return an ISO-8601 timestamp string.");
  }

  return timestamp;
}

function selectWrittenResource(entityType, id, result) {
  return ({ db }) => {
    const resource = buildSyncResource(db, entityType, id);

    if (!resource) {
      throw new Error(`Reconciled ${entityType} "${id}" was unexpectedly missing.`);
    }

    return {
      apiVersion: "sync/v1",
      write: { outcome: result.outcome },
      entity: resource.entity,
    };
  };
}

function getCurrentState(transaction, entityType, id) {
  return entityType === "character"
    ? transaction.getCharacterSyncState(id)
    : transaction.getWorldBookSyncState(id);
}

function getCurrentRecord(transaction, entityType, id) {
  return entityType === "character" ? transaction.getCharacter(id) : transaction.getWorldBook(id);
}

function updateRecord(transaction, entityType, id, record) {
  return entityType === "character"
    ? transaction.updateCharacter(id, () => record)
    : transaction.updateWorldBook(id, () => record);
}

function createSeed(entityType, id, timestamp) {
  if (entityType === "character") {
    return {
      id,
      fileName: null,
      avatar: null,
      pinned: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      worldBookId: null,
      rawCard: { data: {} },
    };
  }

  return {
    id,
    fileName: null,
    source: "sync",
    createdAt: timestamp,
    updatedAt: timestamp,
    name: "",
    entries: [],
    rawWorldBook: {},
  };
}

export function createSyncWriteService({
  mutateLibrary = defaultMutateLibrary,
  now = () => new Date().toISOString(),
  generateId = randomUUID,
} = {}) {
  if (typeof mutateLibrary !== "function") {
    throw new Error("Sync write service requires a library mutation function.");
  }
  if (typeof generateId !== "function") {
    throw new Error("Sync write service requires an id generator.");
  }

  async function update(entityType, id, request) {
    assertEntityId(id, entityType);
    const { baseRevision, canonical } = validateWriteRequest(request);

    try {
      return await mutateLibrary(
        (transaction) => {
          const current = getCurrentState(transaction, entityType, id);

          if (!current) {
            throw new SyncWriteNotFoundError(entityType, id);
          }

          assertMatchingBaseRevision(baseRevision, current);
          const existingRecord = getCurrentRecord(transaction, entityType, id);

          if (!existingRecord) {
            throw new Error(`Current ${entityType} "${id}" was unexpectedly missing.`);
          }

          let materialized;

          try {
            if (entityType === "character") {
              const relationshipId = canonical.relationship?.worldBookId;
              const linkedWorldBook = relationshipId
                ? transaction.getWorldBook(relationshipId)
                : null;
              materialized = materializeCanonicalCharacter({
                existingCharacter: existingRecord,
                canonical,
                linkedWorldBook,
              });
            } else {
              materialized = materializeCanonicalWorldBook({
                existingWorldBook: existingRecord,
                canonical,
              });
            }
          } catch (error) {
            if (error instanceof SyncCanonicalMaterializationError) {
              throw new SyncWriteValidationError(error.message);
            }

            throw error;
          }

          if (hasSameCanonicalProjection(current.projection, canonical)) {
            return { outcome: "unchanged" };
          }

          const nextRecord = entityType === "character" ? materialized.character : materialized.worldBook;
          nextRecord.updatedAt = writeTimestamp(now);
          updateRecord(transaction, entityType, id, nextRecord);
          return { outcome: "updated" };
        },
        {
          selectResult: ({ db, result }) => selectWrittenResource(entityType, id, result)({ db }),
        },
      );
    } catch (error) {
      if (isIntegrityError(error)) {
        throw new SyncWriteIntegrityError(error.message, {
          entityType: error.entityType ?? entityType,
          id: error.id ?? id,
        });
      }

      throw error;
    }
  }

  async function create(entityType, request) {
    const { canonical } = validateCreateRequest(request);
    const id = generateId();
    assertEntityId(id, entityType);
    const timestamp = writeTimestamp(now);

    try {
      return await mutateLibrary(
        (transaction) => {
          if (getCurrentRecord(transaction, entityType, id)) {
            throw new SyncWriteValidationError(`${entityType} id "${id}" already exists.`);
          }

          let materialized;
          try {
            if (entityType === "character") {
              const relationshipId = canonical.relationship?.worldBookId;
              const linkedWorldBook = relationshipId
                ? transaction.getWorldBook(relationshipId)
                : null;
              materialized = materializeCanonicalCharacter({
                existingCharacter: createSeed("character", id, timestamp),
                canonical,
                linkedWorldBook,
              });
            } else {
              materialized = materializeCanonicalWorldBook({
                existingWorldBook: createSeed("worldbook", id, timestamp),
                canonical,
              });
            }
          } catch (error) {
            if (error instanceof SyncCanonicalMaterializationError) {
              throw new SyncWriteValidationError(error.message);
            }
            throw error;
          }

          const record = entityType === "character" ? materialized.character : materialized.worldBook;
          record.createdAt = timestamp;
          record.updatedAt = timestamp;
          return entityType === "character"
            ? transaction.createCharacter(record)
            : transaction.createWorldBook(record);
        },
        {
          selectResult: ({ db }) => selectWrittenResource(entityType, id, { outcome: "created" })({ db }),
        },
      );
    } catch (error) {
      if (isIntegrityError(error)) {
        throw new SyncWriteIntegrityError(error.message, { entityType, id });
      }
      throw error;
    }
  }

  return Object.freeze({
    updateCharacter: (id, request) => update("character", id, request),
    updateWorldBook: (id, request) => update("worldbook", id, request),
    createCharacter: (request) => create("character", request),
    createWorldBook: (request) => create("worldbook", request),
  });
}
