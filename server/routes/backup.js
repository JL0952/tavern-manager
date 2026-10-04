import { Router } from "express";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  lstat,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { extractZip, listZipEntries, writeZip } from "../services/backupZip.js";
import { readDb, restoreLibrarySnapshot, validateDb } from "../services/jsonStorage.js";
import { readRelayBackup, RelayBackupError, restoreRelayBackup } from "../services/relayBackup.js";
import { relayStore } from "../services/relayStore.js";
import { createTimestamp } from "../services/zipExport.js";
import { unexpectedErrorSender } from "./routeHelpers.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("Backup API");
const dataDirectory = fileURLToPath(new URL("../../data", import.meta.url));
const backupsDirectory = resolve(dataDirectory, "backups");
const uploadDirectory = resolve(tmpdir(), "tavern-manager-backup-uploads");
const allowedTargets = ["db.json", "cards", "worldbooks", "avatars", "relay"];

class BackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function ensureDataLayout() {
  await readDb();
  await Promise.all([
    mkdir(resolve(dataDirectory, "cards"), { recursive: true }),
    mkdir(resolve(dataDirectory, "worldbooks"), { recursive: true }),
    mkdir(resolve(dataDirectory, "avatars"), { recursive: true }),
    mkdir(resolve(dataDirectory, "relay"), { recursive: true }),
  ]);
}

async function createBackupZip(zipPath) {
  await ensureDataLayout();
  await rm(zipPath, { force: true }).catch(() => {});
  await writeZip(zipPath, dataDirectory, allowedTargets);
}

export function isAllowedBackupEntry(entryName) {
  if (
    !entryName ||
    entryName.includes("\\") ||
    entryName.startsWith("/") ||
    /^[a-zA-Z]:/.test(entryName)
  ) {
    return false;
  }

  const rawParts = entryName.split("/");

  if (rawParts.includes("..")) {
    return false;
  }

  let normalizedEntry = path.posix.normalize(entryName);

  if (normalizedEntry === "." || normalizedEntry.startsWith("../") || normalizedEntry.includes("/../")) {
    return false;
  }

  if (normalizedEntry === "data") {
    return true;
  }

  if (normalizedEntry.startsWith("data/")) {
    normalizedEntry = normalizedEntry.slice("data/".length);
  }

  if (!normalizedEntry || normalizedEntry === ".") {
    return true;
  }

  return (
    normalizedEntry === "db.json" ||
    normalizedEntry.startsWith("cards/") ||
    normalizedEntry === "cards" ||
    normalizedEntry.startsWith("worldbooks/") ||
    normalizedEntry === "worldbooks" ||
    normalizedEntry.startsWith("avatars/") ||
    normalizedEntry === "avatars" ||
    normalizedEntry.startsWith("relay/") ||
    normalizedEntry === "relay"
  );
}

async function validateZipFile(filePath) {
  const signature = await readFile(filePath).then((buffer) =>
    buffer.subarray(0, 4).toString("hex"),
  );

  if (!["504b0304", "504b0506", "504b0708"].includes(signature)) {
    throw new BackupError("Uploaded backup must be a .zip file.");
  }

  let entries;

  try {
    entries = (await listZipEntries(filePath)).filter(Boolean);
  } catch {
    throw new BackupError("Uploaded backup zip could not be read.");
  }

  if (entries.length === 0) {
    throw new BackupError("Uploaded backup zip is empty.");
  }

  const invalidEntry = entries.find((entry) => !isAllowedBackupEntry(entry.replace(/\/$/, "")));

  if (invalidEntry) {
    throw new BackupError(`Backup contains an unsafe or unsupported path: ${invalidEntry}`);
  }

  const hasDb = entries.some((entry) => entry === "db.json" || entry === "data/db.json");

  if (!hasDb) {
    throw new BackupError("Backup must contain db.json.");
  }

  return entries;
}

async function countFiles(targetPath) {
  let targetStat;

  try {
    targetStat = await stat(targetPath);
  } catch {
    return 0;
  }

  if (targetStat.isFile()) {
    return 1;
  }

  if (!targetStat.isDirectory()) {
    return 0;
  }

  const entries = await readdir(targetPath);
  const counts = await Promise.all(
    entries.map((entry) => countFiles(resolve(targetPath, entry))),
  );

  return counts.reduce((sum, count) => sum + count, 0);
}

async function getRestoreSourceBase(extractDirectory) {
  const dataRoot = resolve(extractDirectory, "data");

  try {
    const dataRootStat = await stat(dataRoot);

    if (dataRootStat.isDirectory()) {
      return dataRoot;
    }
  } catch {
    // Backups exported by this app extract directly into the temp directory.
  }

  return extractDirectory;
}

async function assertNoSymlinks(targetPath) {
  let targetStats;

  try {
    targetStats = await lstat(targetPath);
  } catch {
    return;
  }

  if (targetStats.isSymbolicLink()) {
    throw new BackupError("Backup contains unsupported symbolic links.");
  }

  if (!targetStats.isDirectory()) {
    return;
  }

  const entries = await readdir(targetPath);

  await Promise.all(
    entries.map((entry) => assertNoSymlinks(resolve(targetPath, entry))),
  );
}

async function restoreFromExtractedBackup(sourceBase) {
  const dbPath = resolve(sourceBase, "db.json");

  await Promise.all(
    allowedTargets.map((target) => assertNoSymlinks(resolve(sourceBase, target))),
  );

  let restoredDb;

  try {
    restoredDb = JSON.parse(await readFile(dbPath, "utf8"));
    validateDb(restoredDb);
  } catch {
    throw new BackupError("Backup db.json is missing or contains invalid JSON.");
  }

  let relayBackup;

  try {
    relayBackup = await readRelayBackup(sourceBase);
  } catch (error) {
    if (error instanceof RelayBackupError) throw new BackupError(error.message);
    throw error;
  }

  await restoreLibrarySnapshot(restoredDb, async () => {
    await Promise.all(
      ["cards", "worldbooks", "avatars"].map((target) =>
        rm(resolve(dataDirectory, target), { recursive: true, force: true }),
      ),
    );

    for (const directory of ["cards", "worldbooks", "avatars"]) {
      const sourceDirectory = resolve(sourceBase, directory);
      const destinationDirectory = resolve(dataDirectory, directory);

      try {
        const sourceStat = await stat(sourceDirectory);

        if (sourceStat.isDirectory()) {
          await cp(sourceDirectory, destinationDirectory, { recursive: true });
        } else {
          await mkdir(destinationDirectory, { recursive: true });
        }
      } catch {
        await mkdir(destinationDirectory, { recursive: true });
      }
    }
  });

  // Kept as they are when the backup predates relay files.
  const relayFiles = await restoreRelayBackup(relayBackup, relayStore);

  return {
    dbJson: 1,
    cards: await countFiles(resolve(dataDirectory, "cards")),
    worldbooks: await countFiles(resolve(dataDirectory, "worldbooks")),
    avatars: await countFiles(resolve(dataDirectory, "avatars")),
    relay: relayFiles ?? await relayStore.count(),
  };
}

const backupUpload = multer({
  storage: multer.diskStorage({
    destination: async (_request, _file, callback) => {
      try {
        await mkdir(uploadDirectory, { recursive: true });
        callback(null, uploadDirectory);
      } catch (error) {
        callback(error);
      }
    },
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}-${basename(file.originalname)}`);
    },
  }),
  fileFilter: (_request, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== ".zip") {
      callback(new Error("Only .zip backup files are supported."));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

function uploadBackup(request, response, next) {
  backupUpload.single("file")(request, response, (error) => {
    if (error) {
      return response.status(400).json({ error: error.message });
    }

    return next();
  });
}

router.get("/export", async (_request, response) => {
  const timestamp = createTimestamp();
  const fileName = `tavern-manager-backup-${timestamp}.zip`;
  const zipPath = resolve(tmpdir(), `${randomUUID()}-${fileName}`);

  try {
    await createBackupZip(zipPath);

    response.set("Content-Type", "application/zip");
    response.set("Content-Disposition", `attachment; filename="${fileName}"`);

    const stream = createReadStream(zipPath);
    stream.pipe(response);
    response.on("finish", () => {
      rm(zipPath, { force: true }).catch(() => {});
    });
  } catch (error) {
    await rm(zipPath, { force: true }).catch(() => {});
    return sendUnexpectedError(response, error);
  }
});

router.post("/import", uploadBackup, async (request, response) => {
  if (!request.file) {
    return response.status(400).json({ error: 'Upload a .zip backup using the "file" field.' });
  }

  const extractDirectory = resolve(tmpdir(), `tavern-manager-restore-${randomUUID()}`);

  try {
    await validateZipFile(request.file.path);
    await mkdir(backupsDirectory, { recursive: true });

    const preRestoreFileName = `pre-restore-${createTimestamp()}.zip`;
    await createBackupZip(resolve(backupsDirectory, preRestoreFileName));

    await mkdir(extractDirectory, { recursive: true });
    try {
      await extractZip(request.file.path, extractDirectory);
    } catch (error) {
      throw new BackupError(`Uploaded backup zip could not be extracted: ${error.message}`);
    }

    const restoredFiles = await restoreFromExtractedBackup(
      await getRestoreSourceBase(extractDirectory),
    );

    return response.json({
      message: "Backup restored successfully.",
      preRestoreBackup: preRestoreFileName,
      restoredFiles,
    });
  } catch (error) {
    if (error instanceof BackupError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  } finally {
    await Promise.all([
      rm(request.file.path, { force: true }).catch(() => {}),
      rm(extractDirectory, { recursive: true, force: true }).catch(() => {}),
    ]);
  }
});

export default router;
