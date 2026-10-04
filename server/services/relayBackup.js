import { cp, readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { RELAY_INDEX_SCHEMA_VERSION, RELAY_TYPES } from "./relayStore.js";

const storedFilePattern = /^[0-9a-f-]{36}\.json$/;

export class RelayBackupError extends Error {}

// The relay folder of an extracted backup, checked before anything is
// restored. A backup made before relay files existed has none; restoring it
// leaves the current relay files alone instead of deleting them.
export async function readRelayBackup(sourceBase) {
  const directory = resolve(sourceBase, "relay");

  try {
    if (!(await stat(directory)).isDirectory()) return null;
  } catch {
    return null;
  }

  let index;

  try {
    index = JSON.parse(await readFile(resolve(directory, "index.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { directory, files: 0 };
    throw new RelayBackupError("Backup relay index is not valid JSON.");
  }

  if (index?.schemaVersion !== RELAY_INDEX_SCHEMA_VERSION || !Array.isArray(index.items)) {
    throw new RelayBackupError("Backup relay index is not supported.");
  }

  for (const item of index.items) {
    if (!RELAY_TYPES.includes(item?.type) || typeof item.file !== "string" || !storedFilePattern.test(item.file)) {
      throw new RelayBackupError("Backup relay index lists an invalid file.");
    }

    try {
      if (!(await stat(resolve(directory, item.type, item.file))).isFile()) throw new Error();
    } catch {
      throw new RelayBackupError(`Backup relay file ${item.type}/${item.file} is missing.`);
    }
  }

  return { directory, files: index.items.length };
}

// Replaces the relay folder while no relay write can run.
export async function restoreRelayBackup(relayBackup, store) {
  if (!relayBackup) return null;

  await store.runExclusive(async () => {
    await rm(store.directory, { recursive: true, force: true });
    await cp(relayBackup.directory, store.directory, { recursive: true });
  });

  return relayBackup.files;
}
