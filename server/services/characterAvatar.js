import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import extractChunks from "png-chunks-extract";
import encodeChunks from "png-chunks-encode";
import textChunk from "png-chunk-text";

export const defaultAvatarsDirectory = fileURLToPath(new URL("../../data/avatars/", import.meta.url));
export const defaultCardsDirectory = fileURLToPath(new URL("../../data/cards/", import.meta.url));

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const cardChunkKeywords = new Set(["ccv3", "chara"]);

function avatarFilePath(value, avatarsDirectory) {
  if (typeof value !== "string" || !value.startsWith("avatars/")) {
    return null;
  }

  const fileName = value.slice("avatars/".length);
  return fileName && basename(fileName) === fileName ? resolve(avatarsDirectory, fileName) : null;
}

// Image files a character's avatar can come from, best first: an uploaded or
// synced avatar (its PNG form first), the imported PNG card file, then the
// avatar copied from that import.
export function avatarImageCandidates(character, {
  avatarsDirectory = defaultAvatarsDirectory,
  cardsDirectory = defaultCardsDirectory,
} = {}) {
  const uploaded = character?.avatarSource === "uploaded";
  const cardFile = character?.sourceType === "png" && typeof character.fileName === "string" &&
    character.fileName && basename(character.fileName) === character.fileName
    ? resolve(cardsDirectory, character.fileName)
    : null;

  return [...new Set([
    uploaded ? avatarFilePath(character.avatarPng, avatarsDirectory) : null,
    uploaded ? avatarFilePath(character.avatar, avatarsDirectory) : null,
    cardFile,
    avatarFilePath(character?.avatar, avatarsDirectory),
  ].filter(Boolean))];
}

export function avatarFilePaths(character, { avatarsDirectory = defaultAvatarsDirectory } = {}) {
  return [...new Set([character?.avatar, character?.avatarPng].map((value) => avatarFilePath(value, avatarsDirectory)).filter(Boolean))];
}

export function imageMimeType(buffer) {
  if (buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return "image/png";
  }

  if (buffer.subarray(0, jpegSignature.length).equals(jpegSignature)) {
    return "image/jpeg";
  }

  return null;
}

function cardChunkKeyword(chunk) {
  if (chunk.name !== "tEXt") {
    return "";
  }

  try {
    return textChunk.decode(chunk.data).keyword.toLowerCase();
  } catch {
    return "";
  }
}

// A card PNG used as an avatar still carries the card it came from. That copy
// goes stale at once, and exports write fresh card chunks anyway.
export function stripCardChunks(png) {
  return Buffer.from(encodeChunks(extractChunks(png).filter((chunk) => !cardChunkKeywords.has(cardChunkKeyword(chunk)))));
}
