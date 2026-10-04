import {
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  getCanonicalWorldBookProjectionDiagnostics,
} from "./syncProjection.js";
import { getCurrentSyncMetadata, validateSyncMetadata } from "./syncMetadata.js";
import { hashCanonicalProjection } from "./canonicalHash.js";
import { isPlainObject } from "./objects.js";

const entityDefinitions = Object.freeze({
  character: Object.freeze({
    collection: "characters",
    project: createCanonicalCharacterProjection,
  }),
  worldbook: Object.freeze({
    collection: "worldbooks",
    project: createCanonicalWorldBookProjection,
  }),
});

export class SyncEntityStateIntegrityError extends Error {
  constructor(message, { entityType = null, id = null } = {}) {
    super(message);
    this.name = "SyncEntityStateIntegrityError";
    this.entityType = entityType;
    this.id = id;
  }
}

function assertLibraryCollections(db) {
  if (!isPlainObject(db)) {
    throw new SyncEntityStateIntegrityError("Library database must be an object.");
  }

  for (const { collection } of Object.values(entityDefinitions)) {
    if (!Array.isArray(db[collection])) {
      throw new SyncEntityStateIntegrityError(`Library database field "${collection}" must be an array.`);
    }
  }
}

function assertRecord(record, entityType) {
  if (!isPlainObject(record)) {
    throw new SyncEntityStateIntegrityError(`${entityType} records must be objects.`, { entityType });
  }

  if (typeof record.id !== "string" || !record.id) {
    throw new SyncEntityStateIntegrityError(
      `${entityType} records must have non-empty string ids.`,
      { entityType },
    );
  }
}

function assertUniqueRecords(records, entityType) {
  const ids = new Set();

  for (const record of records) {
    assertRecord(record, entityType);

    if (ids.has(record.id)) {
      throw new SyncEntityStateIntegrityError(
        `Library database contains duplicate ${entityType} id "${record.id}".`,
        { entityType, id: record.id },
      );
    }

    ids.add(record.id);
  }
}

function projectRecord(record, entityType) {
  try {
    return entityDefinitions[entityType].project(record);
  } catch (error) {
    throw new SyncEntityStateIntegrityError(
      `Unable to build canonical ${entityType} projection: ${error.message}`,
      { entityType, id: record.id },
    );
  }
}

function resolveMetadata(record, entityType, projection) {
  let contentHash;

  try {
    contentHash = hashCanonicalProjection(projection);
  } catch (error) {
    throw new SyncEntityStateIntegrityError(
      `Unable to hash canonical ${entityType} projection: ${error.message}`,
      { entityType, id: record.id },
    );
  }

  const storedSync = getCurrentSyncMetadata(record);

  if (storedSync === undefined) {
    return {
      revision: 1,
      contentHash,
      updatedAt: null,
      metadataSource: "ephemeral",
    };
  }

  let sync;

  try {
    sync = validateSyncMetadata(storedSync, { entityType, id: record.id });
  } catch (error) {
    throw new SyncEntityStateIntegrityError(error.message, { entityType, id: record.id });
  }

  if (sync.contentHash !== contentHash) {
    throw new SyncEntityStateIntegrityError(
      `${entityType} "${record.id}" sync.contentHash does not match its canonical content.`,
      { entityType, id: record.id },
    );
  }

  return {
    revision: sync.revision,
    contentHash,
    updatedAt: sync.updatedAt,
    metadataSource: "persisted",
  };
}

function getWorldBookIds(db) {
  return new Set(db.worldbooks.map((record) => record.id));
}

function createRelationshipDiagnostics(projection, worldBookIds) {
  const worldBookId = projection.relationship?.worldBookId;

  if (worldBookId && !worldBookIds.has(worldBookId)) {
    return [{ code: "missing_canonical_worldbook", worldBookId }];
  }

  return [];
}

function materializeEntityState(record, entityType, worldBookIds) {
  const projection = projectRecord(record, entityType);
  const metadata = resolveMetadata(record, entityType, projection);
  const diagnostics = entityType === "character"
    ? createRelationshipDiagnostics(projection, worldBookIds)
    : getCanonicalWorldBookProjectionDiagnostics(record);

  return {
    id: record.id,
    type: entityType,
    ...metadata,
    projection,
    diagnostics,
  };
}

function assertEntityType(entityType) {
  if (!Object.hasOwn(entityDefinitions, entityType)) {
    throw new Error(`Unsupported sync entity type "${entityType}".`);
  }
}

export function assertCanonicalLibrary(db) {
  assertLibraryCollections(db);
  assertUniqueRecords(db.characters, "character");
  assertUniqueRecords(db.worldbooks, "worldbook");
}

export function getCanonicalEntityState(db, entityType, id) {
  assertEntityType(entityType);
  assertCanonicalLibrary(db);

  const { collection } = entityDefinitions[entityType];
  const record = db[collection].find((candidate) => candidate.id === id);

  if (!record) {
    return null;
  }

  return materializeEntityState(record, entityType, getWorldBookIds(db));
}

export function listCanonicalEntityStates(db, entityType) {
  assertEntityType(entityType);
  assertCanonicalLibrary(db);

  const { collection } = entityDefinitions[entityType];
  const worldBookIds = getWorldBookIds(db);
  return db[collection].map((record) => materializeEntityState(record, entityType, worldBookIds));
}
