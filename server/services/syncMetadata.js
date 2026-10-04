import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
} from "./syncProjection.js";
import { hashCanonicalProjection } from "./canonicalHash.js";
import { isPlainObject } from "./objects.js";

export const SYNC_METADATA_SCHEMA_VERSION = 4;

const contentHashPattern = /^sha256:[a-f0-9]{64}$/;
const entityCollections = [
  {
    key: "characters",
    entityType: "character",
    project: createCanonicalCharacterProjection,
  },
  {
    key: "worldbooks",
    entityType: "worldbook",
    project: createCanonicalWorldBookProjection,
  },
];

export class SyncMetadataValidationError extends Error {}

export class SyncMetadataIntegrityError extends Error {}

function clone(value) {
  return structuredClone(value);
}

function recordLabel(entityType, id) {
  return `${entityType} "${id}"`;
}

function getRecordSync(record) {
  return Object.hasOwn(record, "sync") ? record.sync : undefined;
}

// Metadata from before projection V5 (schemas 1-3, or schema 4 with
// projection 4), as an old backup may still hold, can no longer be checked
// against its content. It counts as absent: the record reads as revision 1 and
// its next change starts new metadata.
export function isOutdatedSyncMetadata(sync) {
  return isPlainObject(sync) && (
    [1, 2, 3].includes(sync.schemaVersion) ||
    (sync.schemaVersion === SYNC_METADATA_SCHEMA_VERSION && sync.projectionVersion === 4)
  );
}

// The record's metadata unless it is absent or outdated.
export function getCurrentSyncMetadata(record) {
  const sync = getRecordSync(record);
  return isOutdatedSyncMetadata(sync) ? undefined : sync;
}

function assertRecord(record, entityType) {
  if (!isPlainObject(record)) {
    throw new SyncMetadataValidationError(`${entityType} records must be objects.`);
  }

  if (typeof record.id !== "string" || !record.id) {
    throw new SyncMetadataValidationError(`${entityType} records must have non-empty string ids.`);
  }
}

function assertLibraryShape(db) {
  if (!isPlainObject(db)) {
    throw new SyncMetadataValidationError("Library database must be an object.");
  }

  for (const { key, entityType } of entityCollections) {
    if (!Array.isArray(db[key])) {
      throw new SyncMetadataValidationError(`Library database field "${key}" must be an array.`);
    }

    const ids = new Set();

    for (const record of db[key]) {
      assertRecord(record, entityType);

      if (ids.has(record.id)) {
        throw new SyncMetadataValidationError(
          `Library database contains duplicate ${entityType} id "${record.id}".`,
        );
      }

      ids.add(record.id);
    }
  }
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new SyncMetadataValidationError(`${label} must be an ISO-8601 UTC timestamp.`);
  }

  if (new Date(value).toISOString() !== value) {
    throw new SyncMetadataValidationError(`${label} must use canonical ISO-8601 UTC formatting.`);
  }
}

function normalizeTimestamp(timestamp) {
  assertIsoTimestamp(timestamp, "sync metadata timestamp");
  return timestamp;
}

function createInitialSyncMetadata(contentHash, updatedAt) {
  return {
    schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    revision: 1,
    contentHash,
    updatedAt,
  };
}

function createAdvancedSyncMetadata(previousSync, contentHash, updatedAt) {
  return {
    ...clone(previousSync),
    schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    revision: previousSync.revision + 1,
    contentHash,
    updatedAt,
  };
}

function createLegacyAdvancedSyncMetadata(contentHash, updatedAt) {
  return {
    schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    revision: 2,
    contentHash,
    updatedAt,
  };
}

function buildRecordMap(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function createEmptyChangeSummary() {
  return {
    created: { characters: [], worldbooks: [] },
    advanced: { characters: [], worldbooks: [] },
    unchanged: { characters: [], worldbooks: [] },
    deleted: { characters: [], worldbooks: [] },
  };
}

export function validateSyncMetadata(sync, { entityType = "record", id = "unknown" } = {}) {
  const label = recordLabel(entityType, id);

  if (!isPlainObject(sync)) {
    throw new SyncMetadataValidationError(`${label} sync metadata must be an object.`);
  }

  if (sync.schemaVersion !== SYNC_METADATA_SCHEMA_VERSION) {
    throw new SyncMetadataValidationError(`${label} sync.schemaVersion must be ${SYNC_METADATA_SCHEMA_VERSION}.`);
  }

  if (sync.projectionVersion !== CANONICAL_PROJECTION_VERSION) {
    throw new SyncMetadataValidationError(
      `${label} sync.projectionVersion must be ${CANONICAL_PROJECTION_VERSION}.`,
    );
  }

  if (!Number.isSafeInteger(sync.revision) || sync.revision < 1) {
    throw new SyncMetadataValidationError(`${label} sync.revision must be a positive integer.`);
  }

  if (typeof sync.contentHash !== "string" || !contentHashPattern.test(sync.contentHash)) {
    throw new SyncMetadataValidationError(`${label} sync.contentHash must be a SHA-256 hash.`);
  }

  assertIsoTimestamp(sync.updatedAt, `${label} sync.updatedAt`);
  return sync;
}

// With `onlyIds` ({ characters, worldbooks } id sets) only those records are
// hashed; every record's metadata is still validated.
export function captureCanonicalHashes(db, onlyIds = null) {
  assertLibraryShape(db);

  const hashes = {
    characters: new Map(),
    worldbooks: new Map(),
  };

  for (const { key, entityType, project } of entityCollections) {
    for (const record of db[key]) {
      if (!onlyIds || onlyIds[key].has(record.id)) {
        hashes[key].set(record.id, hashCanonicalProjection(project(record)));
      }

      const sync = getCurrentSyncMetadata(record);

      if (sync !== undefined) {
        validateSyncMetadata(sync, { entityType, id: record.id });
      }
    }
  }

  return hashes;
}

// `touched` ({ characters, worldbooks } id sets) names the records a
// transaction created, replaced, updated or deleted. Every other record is an
// unchanged copy and keeps its metadata without being hashed.
export function reconcileSyncMetadata({ beforeDb, afterDb, now, touched = null }) {
  const timestamp = normalizeTimestamp(now);
  const beforeHashes = captureCanonicalHashes(beforeDb, touched);
  const afterHashes = captureCanonicalHashes(afterDb, touched);
  const reconciledDb = clone(afterDb);
  const changes = createEmptyChangeSummary();

  for (const { key, entityType } of entityCollections) {
    const beforeRecords = buildRecordMap(beforeDb[key]);
    const afterRecords = buildRecordMap(reconciledDb[key]);

    for (const record of reconciledDb[key]) {
      const beforeRecord = beforeRecords.get(record.id);
      const beforeHash = beforeHashes[key].get(record.id);
      const afterHash = afterHashes[key].get(record.id);

      if (!beforeRecord) {
        record.sync = createInitialSyncMetadata(afterHash, timestamp);
        changes.created[key].push(record.id);
        continue;
      }

      const storedSync = getRecordSync(beforeRecord);
      const previousSync = getCurrentSyncMetadata(beforeRecord);

      if ((touched && !touched[key].has(record.id)) || beforeHash === afterHash) {
        if (storedSync === undefined) {
          delete record.sync;
        } else {
          record.sync = clone(storedSync);
        }

        changes.unchanged[key].push(record.id);
        continue;
      }

      if (previousSync === undefined) {
        record.sync = createLegacyAdvancedSyncMetadata(afterHash, timestamp);
      } else {
        if (previousSync.contentHash !== beforeHash) {
          throw new SyncMetadataIntegrityError(
            `${recordLabel(entityType, record.id)} sync.contentHash does not match its pre-mutation canonical content.`,
          );
        }

        record.sync = createAdvancedSyncMetadata(previousSync, afterHash, timestamp);
      }

      changes.advanced[key].push(record.id);
    }

    for (const id of beforeRecords.keys()) {
      if (!afterRecords.has(id)) {
        changes.deleted[key].push(id);
      }
    }
  }

  return {
    db: reconciledDb,
    beforeHashes,
    afterHashes,
    changes,
  };
}
