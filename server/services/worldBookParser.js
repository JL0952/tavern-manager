import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCanonicalWorldBookEntry } from "./syncProjection.js";
import { materializeWorldBookEntry } from "./syncCanonicalMaterializer.js";
import { isPlainObject } from "./objects.js";

export class WorldBookParserError extends Error {}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function repairUtf8Mojibake(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  const hasMojibakeMarkers = /[\u0080-\u009fÃÂÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ]/.test(value);

  if (!hasMojibakeMarkers) {
    return value;
  }

  const bytes = [];

  for (const character of value) {
    const byte = character.codePointAt(0);

    if (byte > 255) {
      return value;
    }

    bytes.push(byte);
  }

  try {
    const decodedValue = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
    const hasReadableCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(decodedValue);

    return hasReadableCjk ? decodedValue : value;
  } catch {
    return value;
  }
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeEntry(id, entry) {
  const rawEntry = isPlainObject(entry) ? structuredClone(entry) : {};

  return {
    ...normalizeCanonicalWorldBookEntry({ ...rawEntry, id: String(rawEntry.uid ?? rawEntry.id ?? id) }, id),
    extensions: normalizeObject(rawEntry.extensions),
    rawEntry,
  };
}

function sanitizeBaseName(fileName) {
  const extension = extname(fileName);
  const baseName = basename(fileName, extension).trim();
  return baseName || "Worldbook";
}

export async function parseWorldBook(file) {
  let rawWorldBook;

  try {
    rawWorldBook = JSON.parse(await readFile(file.path, "utf8"));
  } catch {
    throw new WorldBookParserError("Uploaded world book contains invalid JSON.");
  }

  if (!isPlainObject(rawWorldBook) || !isPlainObject(rawWorldBook.entries)) {
    throw new WorldBookParserError(
      'Standalone world book JSON must contain an "entries" object.',
    );
  }

  const timestamp = new Date().toISOString();
  const rawName = repairUtf8Mojibake(normalizeString(rawWorldBook.name).trim());
  const originalName = repairUtf8Mojibake(file.originalname);

  return {
    id: randomUUID(),
    fileName: file.filename,
    name: rawName || sanitizeBaseName(originalName),
    sourceType: "json",
    source: "standalone",
    entries: Object.entries(rawWorldBook.entries).map(([id, entry]) =>
      normalizeEntry(id, entry),
    ),
    rawWorldBook: structuredClone(rawWorldBook),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function exportEntry(entry, id) {
  return materializeWorldBookEntry(normalizeCanonicalWorldBookEntry(entry, id), entry).rawEntry;
}

export function createWorldBookExport(worldBook) {
  const exportedWorldBook = isPlainObject(worldBook.rawWorldBook)
    ? structuredClone(worldBook.rawWorldBook)
    : {};

  exportedWorldBook.name = normalizeString(worldBook.name);
  delete exportedWorldBook.originalData;
  exportedWorldBook.entries = Object.fromEntries(
    (worldBook.entries || []).map((entry, index) => {
      const id = String(entry.id ?? index);
      return [id, exportEntry(entry, id)];
    }),
  );

  return `${JSON.stringify(exportedWorldBook, null, 2)}\n`;
}

export async function removeWorldBookSourceFile(worldBook) {
  if (
    worldBook?.source !== "standalone" ||
    !worldBook.fileName ||
    basename(worldBook.fileName) !== worldBook.fileName
  ) {
    return;
  }

  const sourceFileUrl = new URL(`../../data/worldbooks/${worldBook.fileName}`, import.meta.url);
  await rm(fileURLToPath(sourceFileUrl), { force: true });
}
