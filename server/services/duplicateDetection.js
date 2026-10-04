import { createHash } from "node:crypto";
import { isPlainObject } from "./objects.js";
import { normalizeTagList } from "./tagList.js";

const volatileKeys = new Set([
  "id",
  "uid",
  "createdAt",
  "updatedAt",
  "fileName",
  "avatar",
  "avatarSource",
]);

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !volatileKeys.has(key))
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim())
    : [];
}

function getCharacterComparableData(character) {
  return {
    name: normalizeText(character?.name),
    description: normalizeText(character?.description),
    personality: normalizeText(character?.personality),
    scenario: normalizeText(character?.scenario),
    first_mes: normalizeText(character?.first_mes),
    mes_example: normalizeText(character?.mes_example),
    creator_notes: normalizeText(character?.creator_notes),
    system_prompt: normalizeText(character?.system_prompt),
    post_history_instructions: normalizeText(character?.post_history_instructions),
    alternate_greetings: normalizeStringArray(character?.alternate_greetings),
    group_only_greetings: normalizeStringArray(character?.group_only_greetings),
    creator: normalizeText(character?.creator),
    character_version: normalizeText(character?.character_version),
    tags: normalizeTagList(character?.tags).sort((left, right) => left.localeCompare(right)),
  };
}

function getWorldBookEntriesComparableData(worldBook) {
  return (Array.isArray(worldBook?.entries) ? worldBook.entries : []).map((entry) => ({
    keys: normalizeStringArray(entry?.keys).sort((left, right) => left.localeCompare(right)),
    secondaryKeys: normalizeStringArray(entry?.secondaryKeys).sort((left, right) =>
      left.localeCompare(right),
    ),
    comment: normalizeText(entry?.comment),
    content: normalizeText(entry?.content),
    constant: Boolean(entry?.constant),
    selective: entry?.selective !== false,
    enabled: entry?.enabled !== false,
    position: entry?.position ?? "",
    order: entry?.order ?? "",
  }));
}

function getCharacterExactHash(character) {
  return stableHash(character?.rawCard || getCharacterComparableData(character));
}

function getCharacterFallbackHash(character) {
  return stableHash(getCharacterComparableData(character));
}

function getWorldBookRawHash(worldBook) {
  return stableHash(worldBook?.rawWorldBook || getWorldBookEntriesComparableData(worldBook));
}

function getWorldBookEntriesHash(worldBook) {
  return stableHash({
    name: normalizeText(worldBook?.name),
    entries: getWorldBookEntriesComparableData(worldBook),
  });
}

function addCandidate(candidates, candidate) {
  if (candidates.some((existingCandidate) => existingCandidate.id === candidate.id)) {
    return;
  }

  candidates.push(candidate);
}

// An embedded Manager UUID identifies the exact card a file was exported from.
export function findManagerIdCandidate(embeddedManagerId, characters) {
  const character = embeddedManagerId
    ? characters.find((candidate) => candidate.id === embeddedManagerId)
    : null;

  if (!character) {
    return null;
  }

  return {
    id: character.id,
    name: character.name || "Unnamed character",
    avatar: character.avatar || "",
    tags: Array.isArray(character.tags) ? character.tags : [],
    reason: "exported from this Manager character",
    confidence: "exact",
  };
}

export function findCharacterDuplicateCandidates(importedCharacter, characters) {
  const candidates = [];
  const importedRawHash = getCharacterExactHash(importedCharacter);
  const importedFallbackHash = getCharacterFallbackHash(importedCharacter);
  const importedName = normalizeText(importedCharacter.name);
  const importedFirstMessage = normalizeText(importedCharacter.first_mes);
  const importedDescription = normalizeText(importedCharacter.description);

  for (const character of characters) {
    const existingRawHash = getCharacterExactHash(character);
    const existingFallbackHash = getCharacterFallbackHash(character);
    const existingName = normalizeText(character.name);
    const existingFirstMessage = normalizeText(character.first_mes);
    const existingDescription = normalizeText(character.description);

    let match = null;

    if (
      importedRawHash === existingRawHash ||
      importedFallbackHash === existingFallbackHash
    ) {
      match = { reason: "same card data", confidence: "exact" };
    } else if (
      importedName &&
      importedName === existingName &&
      importedFirstMessage &&
      importedFirstMessage === existingFirstMessage
    ) {
      match = { reason: "same name and first message", confidence: "likely" };
    } else if (
      importedName &&
      importedName === existingName &&
      importedDescription &&
      importedDescription === existingDescription
    ) {
      match = { reason: "same name and description", confidence: "likely" };
    } else if (importedName && importedName === existingName) {
      match = { reason: "same name", confidence: "likely" };
    }

    if (match) {
      addCandidate(candidates, {
        id: character.id,
        name: character.name || "Unnamed character",
        avatar: character.avatar || "",
        tags: Array.isArray(character.tags) ? character.tags : [],
        reason: match.reason,
        confidence: match.confidence,
      });
    }
  }

  return candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return left.confidence === "exact" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function findWorldBookDuplicateCandidates(importedWorldBook, worldBooks) {
  const candidates = [];
  const importedRawHash = getWorldBookRawHash(importedWorldBook);
  const importedEntriesHash = getWorldBookEntriesHash(importedWorldBook);
  const importedName = normalizeText(importedWorldBook.name);
  const importedEntryCount = Array.isArray(importedWorldBook.entries)
    ? importedWorldBook.entries.length
    : 0;

  for (const worldBook of worldBooks) {
    const existingRawHash = getWorldBookRawHash(worldBook);
    const existingEntriesHash = getWorldBookEntriesHash(worldBook);
    const existingName = normalizeText(worldBook.name);
    const existingEntryCount = Array.isArray(worldBook.entries)
      ? worldBook.entries.length
      : 0;

    let match = null;

    if (
      importedRawHash === existingRawHash ||
      importedEntriesHash === existingEntriesHash
    ) {
      match = { reason: "same worldbook data", confidence: "exact" };
    } else if (
      importedName &&
      importedName === existingName &&
      importedEntryCount === existingEntryCount
    ) {
      match = { reason: "same name and entry count", confidence: "likely" };
    } else if (importedName && importedName === existingName) {
      match = { reason: "same name", confidence: "likely" };
    }

    if (match) {
      addCandidate(candidates, {
        id: worldBook.id,
        name: worldBook.name || "Unnamed worldbook",
        entryCount: existingEntryCount,
        reason: match.reason,
        confidence: match.confidence,
      });
    }
  }

  return candidates.sort((left, right) => {
    if (left.confidence !== right.confidence) {
      return left.confidence === "exact" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}
