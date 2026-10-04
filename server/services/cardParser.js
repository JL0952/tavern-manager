import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import extractChunks from "png-chunks-extract";
import textChunk from "png-chunk-text";
import { normalizeCanonicalWorldBookEntry } from "./syncProjection.js";
import { normalizeCharacterNote } from "./characterNote.js";
import { isPlainObject } from "./objects.js";
import { normalizeTagList } from "./tagList.js";

const avatarsDirectory = fileURLToPath(new URL("../../data/avatars", import.meta.url));
const sipsPath = "/usr/bin/sips";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const characterChunkKeywords = ["ccv3", "chara"];

export class CardParserError extends Error {}

// An invalid Character's Note is a request error (400), not a server error.
export function parseCharacterNote(value) {
  try {
    return normalizeCharacterNote(value);
  } catch (error) {
    throw new CardParserError(error.message);
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function normalizeEmbeddedWorldBookEntry(entry, index) {
  const rawEntry = isPlainObject(entry) ? structuredClone(entry) : {};
  const extensions = normalizeObject(rawEntry.extensions);

  return {
    ...normalizeCanonicalWorldBookEntry({ ...rawEntry, id: String(rawEntry.uid ?? rawEntry.id ?? index),
      position: extensions.position ?? rawEntry.position }, index, { embeddedCharacterBook: true }),
    extensions,
    rawEntry,
  };
}

function getCompatibleValue(source, rawCard, field, isValid) {
  for (const value of [source[field], rawCard[field]]) {
    if (isValid(value)) {
      return value;
    }
  }

  return undefined;
}

function getString(source, rawCard, field) {
  return normalizeString(
    getCompatibleValue(source, rawCard, field, (value) => typeof value === "string"),
  );
}

function getCreatorNotes(source, rawCard) {
  return (
    getString(source, rawCard, "creator_notes") ||
    getString(source, rawCard, "creatorNotes") ||
    normalizeString(source.creatorcomment) ||
    normalizeString(rawCard.creatorcomment)
  );
}

function getArray(source, rawCard, field) {
  return normalizeArray(getCompatibleValue(source, rawCard, field, Array.isArray));
}

function getObject(source, rawCard, field) {
  return normalizeObject(getCompatibleValue(source, rawCard, field, isPlainObject));
}

function getLegacyValue(source, rawCard, field, fallback) {
  return rawCard[field] ?? source[field] ?? fallback;
}

function parseJson(contents, errorMessage) {
  try {
    return JSON.parse(contents);
  } catch {
    throw new CardParserError(errorMessage);
  }
}

function decodeCharacterChunk(contents) {
  try {
    return JSON.parse(contents);
  } catch {
    let decoded;

    try {
      decoded = Buffer.from(contents, "base64").toString("utf8");
    } catch {
      throw new CardParserError("PNG character data could not be decoded from base64.");
    }

    try {
      return JSON.parse(decoded);
    } catch {
      throw new CardParserError("PNG character data does not contain valid JSON.");
    }
  }
}

function parsePng(buffer) {
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new CardParserError("Uploaded .png file is not a valid PNG image.");
  }

  let chunks;

  try {
    chunks = extractChunks(buffer);
  } catch {
    throw new CardParserError("Uploaded .png file could not be parsed.");
  }

  const characterChunks = new Map();

  for (const chunk of chunks) {
    if (chunk.name === "tEXt") {
      try {
        const decodedChunk = textChunk.decode(chunk.data);
        characterChunks.set(decodedChunk.keyword.toLowerCase(), decodedChunk.text);
      } catch {
        // Ignore unrelated or malformed PNG text chunks.
      }
    }
  }

  for (const keyword of characterChunkKeywords) {
    if (characterChunks.has(keyword)) {
      return decodeCharacterChunk(characterChunks.get(keyword));
    }
  }

  throw new CardParserError(
    'PNG character card does not contain a supported "chara" or "ccv3" text chunk.',
  );
}

function getAvatarImageType(buffer) {
  if (buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return "png";
  }

  if (buffer.subarray(0, jpegSignature.length).equals(jpegSignature)) {
    return "jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return "";
}

function normalizeCharacterCard(rawCard, { fileName, sourceType, avatar }) {
  if (!isPlainObject(rawCard)) {
    throw new CardParserError("Character card JSON must contain an object.");
  }

  const source = isPlainObject(rawCard.data) ? rawCard.data : rawCard;
  const timestamp = new Date().toISOString();
  const creatorNotes = getCreatorNotes(source, rawCard);

  return {
    id: randomUUID(),
    fileName,
    sourceType,
    avatar,
    spec: getString(source, rawCard, "spec"),
    spec_version: getString(source, rawCard, "spec_version"),
    name: getString(source, rawCard, "name"),
    description: getString(source, rawCard, "description"),
    personality: getString(source, rawCard, "personality"),
    scenario: getString(source, rawCard, "scenario"),
    first_mes: getString(source, rawCard, "first_mes"),
    mes_example: getString(source, rawCard, "mes_example"),
    creator_notes: creatorNotes,
    system_prompt: getString(source, rawCard, "system_prompt"),
    post_history_instructions: getString(source, rawCard, "post_history_instructions"),
    alternate_greetings: getArray(source, rawCard, "alternate_greetings"),
    group_only_greetings: getArray(source, rawCard, "group_only_greetings"),
    creator: getString(source, rawCard, "creator"),
    character_version: getString(source, rawCard, "character_version"),
    tags: normalizeTagList(getCompatibleValue(source, rawCard, "tags", Array.isArray)),
    extensions: { ...getObject(source, rawCard, "extensions"),
      depth_prompt: parseCharacterNote(getObject(source, rawCard, "extensions").depth_prompt) },
    character_book:
      getCompatibleValue(source, rawCard, "character_book", isPlainObject) ?? null,
    assets: getArray(source, rawCard, "assets"),
    legacy: {
      creatorcomment: getLegacyValue(source, rawCard, "creatorcomment", ""),
      avatar: getLegacyValue(source, rawCard, "avatar", ""),
      chat: getLegacyValue(source, rawCard, "chat", ""),
      talkativeness: getLegacyValue(source, rawCard, "talkativeness", null),
      fav: getLegacyValue(source, rawCard, "fav", false),
      create_date: getLegacyValue(source, rawCard, "create_date", ""),
    },
    rawCard: structuredClone(rawCard),
    worldBookId: null,
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createPngAvatar(filePath) {
  await mkdir(avatarsDirectory, { recursive: true });

  const avatarFileName = `${randomUUID()}.png`;
  const avatarPath = fileURLToPath(new URL(`../../data/avatars/${avatarFileName}`, import.meta.url));

  try {
    await copyFile(filePath, avatarPath);
  } catch (error) {
    await rm(avatarPath, { force: true }).catch(() => {});
    throw error;
  }

  return `avatars/${avatarFileName}`;
}

export async function parseCharacterCard(file) {
  const extension = extname(file.originalname).toLowerCase();
  const contents = await readFile(file.path);

  if (extension === ".json") {
    const rawCard = parseJson(contents.toString("utf8"), "Uploaded character card contains invalid JSON.");
    return normalizeCharacterCard(rawCard, {
      fileName: file.filename,
      sourceType: "json",
      avatar: null,
    });
  }

  if (extension === ".png") {
    const rawCard = parsePng(contents);
    const character = normalizeCharacterCard(rawCard, {
      fileName: file.filename,
      sourceType: "png",
      avatar: null,
    });
    const avatar = await createPngAvatar(file.path);

    character.avatar = avatar;
    character.avatarSource = "imported";
    return character;
  }

  throw new CardParserError("Only .json and .png character card files are supported.");
}

export function createEmbeddedWorldBook(character) {
  const embeddedBook = character.character_book;

  if (!isPlainObject(embeddedBook) || !Array.isArray(embeddedBook.entries)) {
    return null;
  }

  if (embeddedBook.entries.length === 0) {
    return null;
  }

  const timestamp = new Date().toISOString();

  return {
    id: randomUUID(),
    source: "character_embedded",
    name:
      normalizeString(embeddedBook.name).trim() ||
      `${character.name || "Character"} Lorebook`,
    entries: embeddedBook.entries.map(normalizeEmbeddedWorldBookEntry),
    tags: [],
    rawWorldBook: structuredClone(embeddedBook),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function validateAvatarImage(filePath) {
  const contents = await readFile(filePath);
  const imageType = getAvatarImageType(contents);

  if (!imageType) {
    throw new CardParserError("Uploaded avatar must be a valid PNG, JPG, JPEG, or WEBP image.");
  }

  if (imageType === "png") {
    try {
      extractChunks(contents);
    } catch {
      throw new CardParserError("Uploaded avatar must be a valid PNG image.");
    }
  }

  return imageType;
}

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function createAvatarPngExportSource(filePath, avatarFileName) {
  if (!avatarFileName || basename(avatarFileName) !== avatarFileName) {
    return null;
  }

  const extension = extname(avatarFileName).toLowerCase();

  if (extension === ".png") {
    return `avatars/${avatarFileName}`;
  }

  const pngFileName = `${avatarFileName.slice(0, -extension.length)}.png`;
  const pngFilePath = fileURLToPath(new URL(`../../data/avatars/${pngFileName}`, import.meta.url));

  try {
    await runFile(sipsPath, ["-s", "format", "png", filePath, "--out", pngFilePath]);
    await validateAvatarImage(pngFilePath);
    return `avatars/${pngFileName}`;
  } catch {
    await rm(pngFilePath, { force: true }).catch(() => {});
    return null;
  }
}

export async function removeAvatarFile(avatarPath) {
  if (!avatarPath?.startsWith("avatars/")) {
    return;
  }

  const avatarFileName = avatarPath.slice("avatars/".length);

  if (!avatarFileName || basename(avatarFileName) !== avatarFileName) {
    return;
  }

  const avatarUrl = new URL(`../../data/avatars/${avatarFileName}`, import.meta.url);
  await rm(fileURLToPath(avatarUrl), { force: true });
}

export async function removeCharacterAvatar(character) {
  const avatarPaths = new Set([character?.avatar, character?.avatarPng].filter(Boolean));
  await Promise.all([...avatarPaths].map((avatarPath) => removeAvatarFile(avatarPath)));
}

export async function removeCharacterSourceFile(character) {
  if (!character?.fileName || basename(character.fileName) !== character.fileName) {
    return;
  }

  const sourceFileUrl = new URL(`../../data/cards/${character.fileName}`, import.meta.url);
  await rm(fileURLToPath(sourceFileUrl), { force: true });
}
