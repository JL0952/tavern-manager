import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import extractChunks from "png-chunks-extract";
import encodeChunks from "png-chunks-encode";
import textChunk from "png-chunk-text";
import { avatarImageCandidates } from "./characterAvatar.js";
import { createEmbeddedCharacterBook } from "./syncCanonicalMaterializer.js";
import { normalizeCharacterNote } from "./characterNote.js";
import { embedManagerId } from "./embeddedManagerId.js";
import { isPlainObject } from "./objects.js";
export { createEmbeddedCharacterBook };

const defaultCardPath = fileURLToPath(new URL("../assets/default-card.png", import.meta.url));
const characterChunkKeywords = ["ccv3", "chara"];
const exportFields = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "group_only_greetings",
  "creator",
  "character_version",
  "tags",
  "extensions",
  "character_book",
  "assets",
];

export class CardExportError extends Error {}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function createExportCard(character, linkedWorldBook = null) {
  const exportedCard = isPlainObject(character.rawCard) ? structuredClone(character.rawCard) : {};
  const cardData = Object.fromEntries(exportFields.map((field) => [field, character[field]]));
  cardData.extensions = { ...character.extensions,
    depth_prompt: normalizeCharacterNote(character.extensions?.depth_prompt) };
  const linkedCharacterBook = createEmbeddedCharacterBook(linkedWorldBook);

  if (linkedCharacterBook) {
    cardData.character_book = linkedCharacterBook;
  }

  if (isPlainObject(exportedCard.data)) {
    exportedCard.data = { ...exportedCard.data, ...cardData };
    for (const field of ["name", "description", "personality", "scenario", "first_mes", "mes_example", "tags"]) {
      exportedCard[field] = structuredClone(exportedCard.data[field] ?? (field === "tags" ? [] : ""));
    }
    exportedCard.creatorcomment = exportedCard.data.creator_notes ?? "";
    for (const field of ["fav", "talkativeness"]) {
      if (exportedCard.data.extensions?.[field] !== undefined) exportedCard[field] = exportedCard.data.extensions[field];
    }
  } else {
    Object.assign(exportedCard, cardData);
  }

  if (Object.hasOwn(exportedCard, "tags")) {
    exportedCard.tags = normalizeArray(character.tags);
  }

  if (character.spec) {
    exportedCard.spec = character.spec;
  }

  if (character.spec_version) {
    exportedCard.spec_version = character.spec_version;
  }

  delete exportedCard.pinned;
  if (isPlainObject(exportedCard.data)) {
    delete exportedCard.data.pinned;
  }

  return embedManagerId(exportedCard, character.id);
}

async function readValidPngChunks(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    return extractChunks(await readFile(filePath));
  } catch {
    return null;
  }
}

async function getPngExportChunks(character) {
  for (const filePath of [...avatarImageCandidates(character), defaultCardPath]) {
    const chunks = await readValidPngChunks(filePath);

    if (chunks) {
      return chunks;
    }
  }

  throw new CardExportError("Unable to find a valid PNG image for this character card.");
}

function getTextChunkKeyword(chunk) {
  if (chunk.name !== "tEXt") {
    return "";
  }

  try {
    return textChunk.decode(chunk.data).keyword.toLowerCase();
  } catch {
    return "";
  }
}

export function createJsonExport(character, linkedWorldBook = null) {
  return `${JSON.stringify(createExportCard(character, linkedWorldBook), null, 2)}\n`;
}

export async function createPngExport(character, linkedWorldBook = null) {
  const chunks = await getPngExportChunks(character);
  const existingKeywords = chunks.map(getTextChunkKeyword);
  const keyword =
    character.spec === "chara_card_v3"
      ? "ccv3"
      : characterChunkKeywords.find((candidate) => existingKeywords.includes(candidate)) ||
        "chara";
  const encodedCard = Buffer.from(JSON.stringify(createExportCard(character, linkedWorldBook))).toString("base64");
  const replacement = textChunk.encode(keyword, encodedCard);
  const outputChunks = [];
  let inserted = false;

  for (const chunk of chunks) {
    const chunkKeyword = getTextChunkKeyword(chunk);

    if (characterChunkKeywords.includes(chunkKeyword)) {
      if (!inserted && chunkKeyword === keyword) {
        outputChunks.push(replacement);
        inserted = true;
      }

      continue;
    }

    if (!inserted && chunk.name === "IEND") {
      outputChunks.push(replacement);
      inserted = true;
    }

    outputChunks.push(chunk);
  }

  return Buffer.from(encodeChunks(outputChunks));
}
