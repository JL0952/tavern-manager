import { reconcileSyncMetadata } from "./syncMetadata.js";
import { getCanonicalEntityState } from "./syncEntityState.js";
import { isPlainObject } from "./objects.js";

export class LibraryTransactionError extends Error {}

function clone(value) {
  return structuredClone(value);
}

function assertRecord(record, entityType) {
  if (!isPlainObject(record)) {
    throw new LibraryTransactionError(`${entityType} records must be objects.`);
  }

  if (typeof record.id !== "string" || !record.id) {
    throw new LibraryTransactionError(`${entityType} records must have non-empty string ids.`);
  }
}

function assertNoRecordLevelSync(record, entityType) {
  if (Object.hasOwn(record, "sync")) {
    throw new LibraryTransactionError(
      `${entityType} record-level sync metadata is managed by the transaction boundary.`,
    );
  }
}

function createEditableRecord(record) {
  const editable = clone(record);
  delete editable.sync;
  return editable;
}

function createTransaction(db) {
  const draft = clone(db);
  // Records this transaction created, replaced, updated or deleted; all others
  // stay exact copies, so sync metadata reconciliation can skip them.
  const touched = { characters: new Set(), worldbooks: new Set() };

  function touch(entityType, id) {
    touched[entityType === "character" ? "characters" : "worldbooks"].add(id);
  }

  function getCollection(entityType) {
    return entityType === "character" ? draft.characters : draft.worldbooks;
  }

  function findRecord(entityType, id) {
    if (typeof id !== "string" || !id) {
      throw new LibraryTransactionError(`${entityType} id must be a non-empty string.`);
    }

    const collection = getCollection(entityType);
    const index = collection.findIndex((record) => record.id === id);
    return { collection, index };
  }

  function list(entityType) {
    return getCollection(entityType).map(createEditableRecord);
  }

  function get(entityType, id) {
    const { collection, index } = findRecord(entityType, id);
    return index === -1 ? null : createEditableRecord(collection[index]);
  }

  function create(entityType, record) {
    assertRecord(record, entityType);
    assertNoRecordLevelSync(record, entityType);

    const collection = getCollection(entityType);

    if (collection.some((existingRecord) => existingRecord.id === record.id)) {
      throw new LibraryTransactionError(`${entityType} id "${record.id}" already exists.`);
    }

    const nextRecord = clone(record);
    collection.push(nextRecord);
    touch(entityType, nextRecord.id);
    return createEditableRecord(nextRecord);
  }

  function update(entityType, id, updater) {
    if (typeof updater !== "function") {
      throw new LibraryTransactionError(`${entityType} updater must be a function.`);
    }

    const { collection, index } = findRecord(entityType, id);

    if (index === -1) {
      return null;
    }

    const existingRecord = collection[index];
    const nextRecord = updater(createEditableRecord(existingRecord));

    assertRecord(nextRecord, entityType);
    assertNoRecordLevelSync(nextRecord, entityType);

    if (nextRecord.id !== id) {
      throw new LibraryTransactionError(`${entityType} ids are immutable within a transaction.`);
    }

    if (Object.hasOwn(existingRecord, "sync")) {
      nextRecord.sync = clone(existingRecord.sync);
    }

    collection[index] = clone(nextRecord);
    touch(entityType, id);
    return createEditableRecord(collection[index]);
  }

  function replace(entityType, id, replacement) {
    assertRecord(replacement, entityType);
    assertNoRecordLevelSync(replacement, entityType);

    const { collection, index } = findRecord(entityType, id);

    if (index === -1) {
      return null;
    }

    const existingRecord = collection[index];
    const nextRecord = {
      ...clone(replacement),
      id,
    };

    if (Object.hasOwn(existingRecord, "sync")) {
      nextRecord.sync = clone(existingRecord.sync);
    }

    collection[index] = nextRecord;
    touch(entityType, id);
    return createEditableRecord(nextRecord);
  }

  function remove(entityType, id) {
    const { collection, index } = findRecord(entityType, id);

    if (index === -1) {
      return false;
    }

    collection.splice(index, 1);
    touch(entityType, id);
    return true;
  }

  function replaceTagDefinitions(tagDefinitions) {
    if (!Array.isArray(tagDefinitions)) {
      throw new LibraryTransactionError("tagDefinitions must be an array.");
    }

    draft.tagDefinitions = clone(tagDefinitions);
    return clone(draft.tagDefinitions);
  }

  const transaction = Object.freeze({
    listCharacters: () => list("character"),
    getCharacter: (id) => get("character", id),
    createCharacter: (record) => create("character", record),
    updateCharacter: (id, updater) => update("character", id, updater),
    replaceCharacter: (id, replacement) => replace("character", id, replacement),
    deleteCharacter: (id) => remove("character", id),
    listWorldBooks: () => list("worldbook"),
    getWorldBook: (id) => get("worldbook", id),
    createWorldBook: (record) => create("worldbook", record),
    updateWorldBook: (id, updater) => update("worldbook", id, updater),
    replaceWorldBook: (id, replacement) => replace("worldbook", id, replacement),
    deleteWorldBook: (id) => remove("worldbook", id),
    getTagDefinitions: () => clone(draft.tagDefinitions),
    replaceTagDefinitions,
    getCharacterSyncState: (id) => getCanonicalEntityState(db, "character", id),
    getWorldBookSyncState: (id) => getCanonicalEntityState(db, "worldbook", id),
  });

  return {
    transaction,
    // reconcileSyncMetadata copies the draft, so it is handed over as is.
    finish: () => ({ db: draft, touched }),
  };
}

function validateAdapter({ readDb, writeDb }) {
  if (typeof readDb !== "function" || typeof writeDb !== "function") {
    throw new LibraryTransactionError("Serialized library transactions require readDb and writeDb functions.");
  }
}

export function createSerializedLibraryWriter({ readDb, writeDb, now = () => new Date().toISOString() }) {
  validateAdapter({ readDb, writeDb });
  let writerTail = Promise.resolve();

  function enqueueWriterTask(callback) {
    const operation = writerTail.then(callback);
    writerTail = operation.catch(() => {});
    return operation;
  }

  function runTransaction(callback, { selectResult } = {}) {
    if (typeof callback !== "function") {
      return Promise.reject(new LibraryTransactionError("Library mutation callback must be a function."));
    }

    if (selectResult !== undefined && typeof selectResult !== "function") {
      return Promise.reject(new LibraryTransactionError("Transaction result selector must be a function."));
    }

    return enqueueWriterTask(async () => {
      const beforeDb = await readDb();
      const { transaction, finish } = createTransaction(beforeDb);
      const result = await callback(transaction);
      const { db: afterDb, touched } = finish();
      const timestamp = typeof now === "function" ? now() : now;
      const reconciliation = reconcileSyncMetadata({ beforeDb, afterDb, now: timestamp, touched });

      const selectedResult = selectResult
        ? await selectResult({ db: clone(reconciliation.db), result })
        : result;

      await writeDb(reconciliation.db);
      return selectedResult;
    });
  }

  function runExclusive(callback) {
    if (typeof callback !== "function") {
      return Promise.reject(new LibraryTransactionError("Exclusive library callback must be a function."));
    }

    return enqueueWriterTask(callback);
  }

  return Object.freeze({ mutateLibrary: runTransaction, runExclusive });
}
