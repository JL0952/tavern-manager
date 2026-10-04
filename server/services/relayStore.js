import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SillyTavern files relayed between installs: chat completion presets, UI
// themes and global regex scripts. Manager keeps every file exactly as it was
// received and never reads its contents. The index holds what the pages and
// the extension need to list and compare files; the content hash in it is the
// uploader's, computed over the parsed file so formatting does not count.
export const RELAY_TYPES = Object.freeze(["presets", "themes", "regex"]);
export const RELAY_SOURCES = Object.freeze(["sillytavern", "file"]);
export const RELAY_INDEX_SCHEMA_VERSION = 1;
export const defaultRelayDirectory = fileURLToPath(new URL("../../data/relay", import.meta.url));

const contentHashPattern = /^sha256:[a-f0-9]{64}$/;
const maxNameLength = 512;

export class RelayValidationError extends Error {}
export class RelayNotFoundError extends Error {}

export class RelayConflictError extends Error {
  constructor(item) {
    super(`A ${item.type} file named "${item.name}" already exists.`);
    this.item = item;
  }
}

export function assertRelayType(type) {
  if (!RELAY_TYPES.includes(type)) {
    throw new RelayValidationError("Unknown relay file type.");
  }
}

function assertName(name) {
  if (typeof name !== "string" || !name || name.length > maxNameLength || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new RelayValidationError(`A name must be 1 to ${maxNameLength} characters without control characters.`);
  }
}

function createEmptyIndex() {
  return { schemaVersion: RELAY_INDEX_SCHEMA_VERSION, items: [] };
}

function validateIndex(index) {
  if (index?.schemaVersion !== RELAY_INDEX_SCHEMA_VERSION || !Array.isArray(index.items)) {
    throw new Error("Relay index is invalid.");
  }

  return index;
}

// The name after "name (2)", "name (3)", ... that no file of this type uses.
function freeName(items, type, name) {
  const used = new Set(items.filter((item) => item.type === type).map((item) => item.name));

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name} (${suffix})`;
    if (!used.has(candidate)) return candidate;
  }
}

function publicItem({ file: _file, ...item }) {
  return { ...item };
}

export function createRelayStore({ directory = defaultRelayDirectory, now = () => new Date() } = {}) {
  const indexPath = resolve(directory, "index.json");
  let queue = Promise.resolve();

  // One write at a time, including a backup restore of the whole directory.
  function runExclusive(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  async function readIndex() {
    let text;

    try {
      text = await readFile(indexPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return createEmptyIndex();
      throw error;
    }

    return validateIndex(JSON.parse(text));
  }

  async function writeAtomically(path, contents) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, contents);
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  function filePath(item) {
    return resolve(directory, item.type, item.file);
  }

  async function list(type) {
    assertRelayType(type);
    const { items } = await readIndex();
    return items
      .filter((item) => item.type === type)
      .map(publicItem)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function read(type, id) {
    assertRelayType(type);
    const item = (await readIndex()).items.find((candidate) => candidate.type === type && candidate.id === id);

    if (!item) {
      throw new RelayNotFoundError(`No ${type} file with id "${id}".`);
    }

    return { item: publicItem(item), contents: await readFile(filePath(item)) };
  }

  // Saves the bytes under a name. An existing file of the same name is kept
  // ("fail"), replaced in place ("replace") or left beside a renamed copy
  // ("rename"). The index only ever points at a file that is fully written;
  // a replaced file is removed after the index stops naming it.
  function save(type, { name, contents, contentHash, source = "file", onConflict = "fail" }) {
    assertRelayType(type);
    assertName(name);

    if (!Buffer.isBuffer(contents) || contents.length === 0) {
      throw new RelayValidationError("A relay file must not be empty.");
    }

    if (typeof contentHash !== "string" || !contentHashPattern.test(contentHash)) {
      throw new RelayValidationError("A content hash must be sha256:<64 hex characters>.");
    }

    if (!RELAY_SOURCES.includes(source)) {
      throw new RelayValidationError("Unknown relay file source.");
    }

    if (!["fail", "replace", "rename"].includes(onConflict)) {
      throw new RelayValidationError("Unknown conflict choice.");
    }

    return runExclusive(async () => {
      const index = await readIndex();
      const existing = index.items.find((item) => item.type === type && item.name === name);

      if (existing && onConflict === "fail") {
        throw new RelayConflictError(publicItem(existing));
      }

      const timestamp = now().toISOString();
      const file = `${randomUUID()}.json`;
      const replacing = existing && onConflict === "replace" ? existing : null;
      const item = {
        id: replacing?.id ?? randomUUID(),
        type,
        name: existing && !replacing ? freeName(index.items, type, name) : name,
        size: contents.length,
        sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
        contentHash,
        source,
        createdAt: replacing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        file,
      };

      await mkdir(resolve(directory, type), { recursive: true });
      await writeAtomically(filePath(item), contents);

      try {
        index.items = [...index.items.filter((candidate) => candidate !== replacing), item];
        await writeAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
      } catch (error) {
        await rm(filePath(item), { force: true }).catch(() => {});
        throw error;
      }

      if (replacing) {
        await rm(filePath(replacing), { force: true }).catch(() => {});
      }

      return {
        outcome: replacing ? "replaced" : existing ? "renamed" : "created",
        item: publicItem(item),
      };
    });
  }

  function remove(type, id) {
    assertRelayType(type);

    return runExclusive(async () => {
      const index = await readIndex();
      const item = index.items.find((candidate) => candidate.type === type && candidate.id === id);

      if (!item) {
        throw new RelayNotFoundError(`No ${type} file with id "${id}".`);
      }

      index.items = index.items.filter((candidate) => candidate !== item);
      await writeAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
      await rm(filePath(item), { force: true }).catch(() => {});
    });
  }

  async function count() {
    return (await readIndex()).items.length;
  }

  return Object.freeze({ directory, list, read, save, remove, count, runExclusive });
}

export const relayStore = createRelayStore();
