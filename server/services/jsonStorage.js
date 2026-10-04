import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createSerializedLibraryWriter } from "./libraryTransaction.js";
import { normalizeCharacterNote } from "./characterNote.js";
import { withSyncedRawCard } from "./characterRawCard.js";
import { isPlainObject } from "./objects.js";

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDataDirectory = resolve(serviceDirectory, "../../data");

const createDefaultDb = () => ({
  characters: [],
  worldbooks: [],
  tagDefinitions: [],
});

export function validateDb(db) {
  if (!db || typeof db !== "object" || Array.isArray(db)) {
    throw new Error("Database contents must be a JSON object.");
  }

  for (const key of ["characters", "worldbooks", "tagDefinitions"]) {
    if (!Array.isArray(db[key])) {
      throw new Error(`Database field "${key}" must be an array.`);
    }
  }
}

function validateCharacter(character) {
  if (!character || typeof character !== "object" || Array.isArray(character)) {
    throw new Error("Character must be an object.");
  }

  if (!character.id || typeof character.id !== "string") {
    throw new Error("Character must have a non-empty string id.");
  }
}

function validateWorldBook(worldBook) {
  if (!worldBook || typeof worldBook !== "object" || Array.isArray(worldBook)) {
    throw new Error("World book must be an object.");
  }

  if (!worldBook.id || typeof worldBook.id !== "string") {
    throw new Error("World book must have a non-empty string id.");
  }
}

function validateUpdatePatch(patch, entityType) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error(`${entityType} update patch must be an object.`);
  }

  for (const field of ["id", "sync"]) {
    if (Object.hasOwn(patch, field)) {
      throw new Error(`${entityType} update patches cannot modify "${field}".`);
    }
  }
}

// Early versions stored the raw worldbook as `rawBook`. Every read renames it,
// so the rest of Manager sees only `rawWorldBook` and the next write persists
// it; old backups are handled the same way once restored.
function renameLegacyRawBook(worldBook) {
  if (!isPlainObject(worldBook) || !Object.hasOwn(worldBook, "rawBook")) {
    return worldBook;
  }

  const { rawBook, ...current } = worldBook;
  return current.rawWorldBook || !rawBook ? current : { ...current, rawWorldBook: rawBook };
}

function normalizeCharacter(character) {
  if (!character || typeof character !== "object" || Array.isArray(character)) {
    return character;
  }

  return {
    ...character,
    pinned: Boolean(character.pinned),
  };
}

function getLinkedCharacters(worldBookId, characters) {
  return characters
    .filter((character) => character.worldBookId === worldBookId)
    .map((character) => ({
      id: character.id,
      name: character.name || "Unnamed character",
    }));
}

function withLinkedCharacters(worldBook, characters) {
  return {
    ...worldBook,
    linkedCharacters: getLinkedCharacters(worldBook.id, characters),
  };
}

function normalizeComparableText(value) {
  return typeof value === "string" ? value : "";
}

function normalizeComparableArray(value) {
  return Array.isArray(value) ? value.map(normalizeComparableText) : [];
}

function getWorldBookComparableSignature(worldBook) {
  return JSON.stringify({
    name: normalizeComparableText(worldBook.name).trim(),
    entries: (Array.isArray(worldBook.entries) ? worldBook.entries : []).map(
      (entry) => ({
        comment: normalizeComparableText(entry.comment),
        keys: normalizeComparableArray(entry.keys),
        content: normalizeComparableText(entry.content),
      }),
    ),
  });
}

function createDuplicateWorldBookName(name, worldBooks) {
  const baseName = normalizeComparableText(name).trim() || "Worldbook";
  const existingNames = new Set(
    worldBooks.map((worldBook) => normalizeComparableText(worldBook.name).trim()),
  );
  const copyName = `${baseName} copy`;

  if (!existingNames.has(copyName)) {
    return copyName;
  }

  let copyIndex = 2;

  while (existingNames.has(`${copyName} ${copyIndex}`)) {
    copyIndex += 1;
  }

  return `${copyName} ${copyIndex}`;
}

function attachWorldBookForCharacter(transaction, character, worldBook) {
  validateWorldBook(worldBook);
  // A copy: a clashing id or name is replaced without touching the caller's object.
  const newWorldBook = { ...worldBook };
  const existingWorldBooks = transaction.listWorldBooks();
  const newSignature = getWorldBookComparableSignature(newWorldBook);
  const matchingWorldBook = existingWorldBooks.find(
    (existingWorldBook) => getWorldBookComparableSignature(existingWorldBook) === newSignature,
  );

  if (matchingWorldBook) {
    character.worldBookId = matchingWorldBook.id;
    return matchingWorldBook;
  }

  if (existingWorldBooks.some(({ id }) => id === newWorldBook.id)) {
    newWorldBook.id = randomUUID();
  }

  if (
    existingWorldBooks.some(
      (existingWorldBook) =>
        normalizeComparableText(existingWorldBook.name).trim() ===
        normalizeComparableText(newWorldBook.name).trim(),
    )
  ) {
    newWorldBook.name = createDuplicateWorldBookName(
      newWorldBook.name,
      existingWorldBooks,
    );
  }

  character.worldBookId = newWorldBook.id;
  transaction.createWorldBook(newWorldBook);
  return newWorldBook;
}

export function createJsonStorage({ dataDirectory = defaultDataDirectory, writeDatabase } = {}) {
  const activeDataDirectory = resolve(dataDirectory);
  const activeDbPath = resolve(activeDataDirectory, "db.json");

  async function writeAtomically(db) {
    const temporaryPath = resolve(activeDataDirectory, `.db.${randomUUID()}.tmp`);
    const contents = `${JSON.stringify(db, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, contents, "utf8");
      await rename(temporaryPath, activeDbPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw new Error(`Unable to write database file at "${activeDbPath}": ${error.message}`);
    }
  }

  async function writeDb(db) {
    validateDb(db);
    await mkdir(activeDataDirectory, { recursive: true });

    if (writeDatabase) {
      await writeDatabase(db);
    } else {
      await writeAtomically(db);
    }

    return db;
  }

  async function ensureDbExists() {
    await mkdir(activeDataDirectory, { recursive: true });

    try {
      await access(activeDbPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Unable to access database file at "${activeDbPath}": ${error.message}`);
      }

      await writeDb(createDefaultDb());
    }
  }

  async function readDb() {
    await ensureDbExists();

    return readStoredDb();
  }

  async function readStoredDb({ returnEmptyWhenMissing = false } = {}) {

    let contents;

    try {
      contents = await readFile(activeDbPath, "utf8");
    } catch (error) {
      if (returnEmptyWhenMissing && error.code === "ENOENT") {
        return createDefaultDb();
      }

      throw new Error(`Unable to read database file at "${activeDbPath}": ${error.message}`);
    }

    let db;

    try {
      db = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Database file at "${activeDbPath}" contains invalid JSON: ${error.message}`);
    }

    validateDb(db);
    db.worldbooks = db.worldbooks.map(renameLegacyRawBook);
    return db;
  }

  // Sync reads must never initialize an absent library or otherwise write to disk.
  async function readDbSnapshot() {
    return readStoredDb({ returnEmptyWhenMissing: true });
  }

  const libraryWriter = createSerializedLibraryWriter({ readDb, writeDb });

  function mutateLibrary(callback, options) {
    return libraryWriter.mutateLibrary(callback, options);
  }

  async function restoreLibrarySnapshot(db, restoreFiles) {
    validateDb(db);

    if (typeof restoreFiles !== "function") {
      throw new Error("Library restore requires a filesystem restore callback.");
    }

    const snapshot = structuredClone(db);

    return libraryWriter.runExclusive(async () => {
      await restoreFiles();
      await writeDb(snapshot);
    });
  }

  async function getCharacters() {
    const db = await readDb();
    return db.characters.map(normalizeCharacter);
  }

  async function getCharacterById(id) {
    if (!id || typeof id !== "string") {
      throw new Error("Character id must be a non-empty string.");
    }

    const characters = await getCharacters();
    return characters.find((character) => character.id === id) ?? null;
  }

  async function getWorldBooks() {
    const db = await readDb();
    return db.worldbooks.map((worldBook) => withLinkedCharacters(worldBook, db.characters));
  }

  async function getWorldBookById(id) {
    if (!id || typeof id !== "string") {
      throw new Error("World book id must be a non-empty string.");
    }

    const db = await readDb();
    const worldBook = db.worldbooks.find((candidate) => candidate.id === id);
    return worldBook ? withLinkedCharacters(worldBook, db.characters) : null;
  }

  async function saveCharacter(character) {
    validateCharacter(character);
    const normalizedCharacter = normalizeCharacter(character);

    return mutateLibrary((transaction) => {
      if (transaction.getCharacter(normalizedCharacter.id)) {
        throw new Error(`Character with id "${normalizedCharacter.id}" already exists.`);
      }

      return transaction.createCharacter(withSyncedRawCard(normalizedCharacter));
    });
  }

  async function saveCharacterWithWorldBook(character, worldBook) {
    validateCharacter(character);
    const normalizedCharacter = normalizeCharacter(character);
    validateWorldBook(worldBook);

    return mutateLibrary((transaction) => {
      if (transaction.getCharacter(normalizedCharacter.id)) {
        throw new Error(`Character with id "${normalizedCharacter.id}" already exists.`);
      }

      const characterWithWorldBook = { ...normalizedCharacter };
      attachWorldBookForCharacter(transaction, characterWithWorldBook, worldBook);
      return transaction.createCharacter(withSyncedRawCard(characterWithWorldBook));
    });
  }

  async function replaceCharacter(id, character, worldBook = null) {
    if (!id || typeof id !== "string") {
      throw new Error("Character id must be a non-empty string.");
    }

    validateCharacter(character);

    return mutateLibrary((transaction) => {
      const existingCharacter = transaction.getCharacter(id);

      if (!existingCharacter) {
        return null;
      }

      const updatedCharacter = {
        ...character,
        id,
        createdAt: existingCharacter.createdAt || character.createdAt,
        pinned: Boolean(existingCharacter.pinned),
        updatedAt: new Date().toISOString(),
        worldBookId: null,
      };

      if (worldBook) {
        attachWorldBookForCharacter(transaction, updatedCharacter, worldBook);
      }

      validateCharacter(updatedCharacter);
      return transaction.replaceCharacter(id, withSyncedRawCard(updatedCharacter));
    });
  }

  async function saveWorldBook(worldBook) {
    validateWorldBook(worldBook);

    return mutateLibrary((transaction) => {
      if (transaction.getWorldBook(worldBook.id)) {
        throw new Error(`World book with id "${worldBook.id}" already exists.`);
      }

      return transaction.createWorldBook(worldBook);
    });
  }

  async function replaceWorldBook(id, worldBook) {
    if (!id || typeof id !== "string") {
      throw new Error("World book id must be a non-empty string.");
    }

    validateWorldBook(worldBook);

    return mutateLibrary((transaction) => {
      const existingWorldBook = transaction.getWorldBook(id);

      if (!existingWorldBook) {
        return null;
      }

      const updatedWorldBook = {
        ...worldBook,
        id,
        createdAt: existingWorldBook.createdAt || worldBook.createdAt,
        updatedAt: new Date().toISOString(),
      };

      validateWorldBook(updatedWorldBook);
      const replacedWorldBook = transaction.replaceWorldBook(id, updatedWorldBook);
      return withLinkedCharacters(replacedWorldBook, transaction.listCharacters());
    });
  }

  async function updateCharacter(id, patch) {
    if (!id || typeof id !== "string") {
      throw new Error("Character id must be a non-empty string.");
    }

    validateUpdatePatch(patch, "Character");

    return mutateLibrary((transaction) => {
      const existingCharacter = transaction.getCharacter(id);

      if (!existingCharacter) {
        return null;
      }

      const updatedCharacter = {
        ...existingCharacter,
        ...patch,
        id,
        pinned: Object.hasOwn(patch, "pinned") ? Boolean(patch.pinned) : Boolean(existingCharacter.pinned),
        updatedAt: new Date().toISOString(),
      };
      if (Object.hasOwn(patch.extensions ?? {}, "depth_prompt")) {
        updatedCharacter.extensions = { ...existingCharacter.extensions, ...patch.extensions,
          depth_prompt: normalizeCharacterNote(patch.extensions.depth_prompt) };
        updatedCharacter.rawCard = structuredClone(existingCharacter.rawCard ?? { data: {} });
        const data = updatedCharacter.rawCard.data ?? updatedCharacter.rawCard;
        data.extensions = { ...data.extensions, depth_prompt: structuredClone(updatedCharacter.extensions.depth_prompt) };
      }
      validateCharacter(updatedCharacter);

      return transaction.updateCharacter(id, () => withSyncedRawCard(updatedCharacter));
    });
  }

  async function deleteCharacter(id) {
    if (!id || typeof id !== "string") {
      throw new Error("Character id must be a non-empty string.");
    }

    return mutateLibrary((transaction) => transaction.deleteCharacter(id));
  }

  async function updateWorldBook(id, patch) {
    if (!id || typeof id !== "string") {
      throw new Error("World book id must be a non-empty string.");
    }

    validateUpdatePatch(patch, "World book");

    return mutateLibrary((transaction) => {
      const existingWorldBook = transaction.getWorldBook(id);

      if (!existingWorldBook) {
        return null;
      }

      const updatedWorldBook = {
        ...existingWorldBook,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      validateWorldBook(updatedWorldBook);

      const savedWorldBook = transaction.updateWorldBook(id, () => updatedWorldBook);
      return withLinkedCharacters(savedWorldBook, transaction.listCharacters());
    });
  }

  async function deleteWorldBook(id) {
    if (!id || typeof id !== "string") {
      throw new Error("World book id must be a non-empty string.");
    }

    return mutateLibrary((transaction) => transaction.deleteWorldBook(id));
  }

  async function deleteWorldBookIfUnlinked(id) {
    if (!id || typeof id !== "string") {
      throw new Error("World book id must be a non-empty string.");
    }

    return mutateLibrary((transaction) => {
      const worldBook = transaction.getWorldBook(id);

      if (!worldBook) {
        return { deleted: false, worldBook: null, linkedCharacters: [] };
      }

      const linkedCharacters = getLinkedCharacters(id, transaction.listCharacters());

      if (linkedCharacters.length > 0) {
        return { deleted: false, worldBook, linkedCharacters };
      }

      transaction.deleteWorldBook(id);
      return { deleted: true, worldBook, linkedCharacters: [] };
    });
  }

  return Object.freeze({
    readDb,
    readDbSnapshot,
    writeDb,
    mutateLibrary,
    restoreLibrarySnapshot,
    getCharacters,
    getCharacterById,
    getWorldBooks,
    getWorldBookById,
    saveCharacter,
    saveCharacterWithWorldBook,
    replaceCharacter,
    saveWorldBook,
    replaceWorldBook,
    updateCharacter,
    deleteCharacter,
    updateWorldBook,
    deleteWorldBook,
    deleteWorldBookIfUnlinked,
  });
}

const defaultStorage = createJsonStorage();

export const readDb = (...args) => defaultStorage.readDb(...args);
export const readDbSnapshot = (...args) => defaultStorage.readDbSnapshot(...args);
export const writeDb = (...args) => defaultStorage.writeDb(...args);
export const mutateLibrary = (...args) => defaultStorage.mutateLibrary(...args);
export const restoreLibrarySnapshot = (...args) => defaultStorage.restoreLibrarySnapshot(...args);
export const getCharacters = (...args) => defaultStorage.getCharacters(...args);
export const getCharacterById = (...args) => defaultStorage.getCharacterById(...args);
export const getWorldBooks = (...args) => defaultStorage.getWorldBooks(...args);
export const getWorldBookById = (...args) => defaultStorage.getWorldBookById(...args);
export const saveCharacter = (...args) => defaultStorage.saveCharacter(...args);
export const saveCharacterWithWorldBook = (...args) =>
  defaultStorage.saveCharacterWithWorldBook(...args);
export const replaceCharacter = (...args) => defaultStorage.replaceCharacter(...args);
export const saveWorldBook = (...args) => defaultStorage.saveWorldBook(...args);
export const replaceWorldBook = (...args) => defaultStorage.replaceWorldBook(...args);
export const updateCharacter = (...args) => defaultStorage.updateCharacter(...args);
export const deleteCharacter = (...args) => defaultStorage.deleteCharacter(...args);
export const updateWorldBook = (...args) => defaultStorage.updateWorldBook(...args);
export const deleteWorldBook = (...args) => defaultStorage.deleteWorldBook(...args);
export const deleteWorldBookIfUnlinked = (...args) =>
  defaultStorage.deleteWorldBookIfUnlinked(...args);
