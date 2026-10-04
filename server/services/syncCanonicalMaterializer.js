import {
  CANONICAL_CHARACTER_FIELDS,
  CANONICAL_CHARACTER_CARD_KEYS,
  CANONICAL_WORLDBOOK_ENTRY_FIELDS,
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  normalizeCanonicalWorldBookEntry,
  stableSerialize,
  WORLDBOOK_ENTRY_FIELD_TABLE,
} from "./syncProjection.js";
import { normalizeCharacterNote } from "./characterNote.js";

const characterStringFields = new Set(
  CANONICAL_CHARACTER_FIELDS.filter(
    (field) => !["tags", "assets", "alternate_greetings", "group_only_greetings"].includes(field),
  ),
);

export class SyncCanonicalMaterializationError extends Error {}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new SyncCanonicalMaterializationError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const expected = new Set(keys);

  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new SyncCanonicalMaterializationError(`${label} contains unsupported field "${key}".`);
    }
  }

  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new SyncCanonicalMaterializationError(`${label} is missing required field "${key}".`);
    }
  }
}

function assertProjectionHeader(canonical, entityType) {
  if (canonical.projectionVersion !== CANONICAL_PROJECTION_VERSION) {
    throw new SyncCanonicalMaterializationError(
      `Unsupported canonical projectionVersion ${JSON.stringify(canonical.projectionVersion)}; sync writes require ${CANONICAL_PROJECTION_VERSION}.`,
    );
  }

  if (canonical.entityType !== entityType) {
    throw new SyncCanonicalMaterializationError(
      `canonical.entityType must be "${entityType}".`,
    );
  }
}

function assertSerializable(canonical) {
  try {
    stableSerialize(canonical);
  } catch (error) {
    throw new SyncCanonicalMaterializationError(
      `Canonical projection is not serializable: ${error.message}`,
    );
  }
}

function getActiveCardData(card) {
  return isPlainObject(card.data) ? card.data : card;
}

function deleteDerivedWorldExtension(container) {
  if (isPlainObject(container?.extensions)) {
    delete container.extensions.world;
  }
}

function clearCharacterRelationshipRepresentation(character) {
  delete character.character_book;

  if (!isPlainObject(character.rawCard)) {
    return;
  }

  delete character.rawCard.character_book;
  deleteDerivedWorldExtension(character.rawCard);

  if (isPlainObject(character.rawCard.data)) {
    delete character.rawCard.data.character_book;
    deleteDerivedWorldExtension(character.rawCard.data);
  }

  deleteDerivedWorldExtension(character);
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function createEmbeddedCharacterBookEntry(entry, index) {
  const value = normalizeCanonicalWorldBookEntry(entry, index);
  const rawEntry = materializeWorldBookEntry(value, entry).rawEntry;
  const extensions = { ...rawEntry.extensions };
  // ST convertCharacterBook reads these fields from extensions, not the root.
  for (const [field, alias] of Object.entries(worldBookExtensionAliases)) extensions[alias] = clone(value[field]);
  return {
    ...rawEntry,
    id: Number.isInteger(Number(value.id)) ? Number(value.id) : value.id,
    keys: clone(value.keys),
    secondary_keys: clone(value.secondaryKeys),
    insertion_order: value.order,
    enabled: value.enabled,
    position: value.position === 0 ? "before_char" : "after_char",
    use_regex: value.useRegex,
    extensions,
  };
}

export function createEmbeddedCharacterBook(worldBook) {
  if (!isPlainObject(worldBook)) return null;
  const rawWorldBook = isPlainObject(worldBook?.rawWorldBook)
    ? clone(worldBook.rawWorldBook)
    : isPlainObject(worldBook?.rawBook)
      ? clone(worldBook.rawBook)
      : {};

  delete rawWorldBook.originalData;
  return {
    ...rawWorldBook,
    name: normalizeString(worldBook?.name),
    entries: normalizeArray(worldBook?.entries).map(createEmbeddedCharacterBookEntry),
  };
}

function applyCharacterRelationship(character, worldBookId, linkedWorldBook) {
  clearCharacterRelationshipRepresentation(character);
  character.worldBookId = worldBookId;

  if (!worldBookId || !linkedWorldBook) {
    return worldBookId
      ? [{ code: "missing_canonical_worldbook", worldBookId }]
      : [];
  }

  if (linkedWorldBook.id !== worldBookId) {
    throw new SyncCanonicalMaterializationError("Linked worldbook does not match canonical relationship.");
  }

  const embeddedCharacterBook = createEmbeddedCharacterBook(linkedWorldBook);
  const activeCardData = getActiveCardData(character.rawCard);
  const extensions = isPlainObject(activeCardData.extensions) ? clone(activeCardData.extensions) : {};

  extensions.world = normalizeString(linkedWorldBook.name);
  activeCardData.character_book = clone(embeddedCharacterBook);
  activeCardData.extensions = extensions;
  character.character_book = embeddedCharacterBook;
  character.extensions = {
    ...(isPlainObject(character.extensions) ? character.extensions : {}),
    world: extensions.world,
  };

  return [];
}

function assertRoundTrip(canonical, projection, entityType) {
  let expected;
  let actual;

  try {
    expected = stableSerialize(canonical);
    actual = stableSerialize(projection);
  } catch (error) {
    throw new SyncCanonicalMaterializationError(
      `Unable to serialize canonical ${entityType} projection: ${error.message}`,
    );
  }

  if (expected !== actual) {
    throw new SyncCanonicalMaterializationError(
      `Canonical ${entityType} projection cannot be materialized without changing its content.`,
    );
  }
}

function validateCharacterCanonical(canonical) {
  assertExactKeys(canonical, ["projectionVersion", "entityType", "card", "relationship"], "canonical");
  assertProjectionHeader(canonical, "character");
  assertExactKeys(canonical.card, CANONICAL_CHARACTER_CARD_KEYS, "canonical.card");
  assertExactKeys(canonical.card.extensions, ["depth_prompt"], "canonical.card.extensions");
  assertExactKeys(canonical.card.extensions.depth_prompt, ["prompt", "depth", "role"], "canonical.card.extensions.depth_prompt");
  try {
    normalizeCharacterNote(canonical.card.extensions.depth_prompt);
  } catch (error) {
    throw new SyncCanonicalMaterializationError(error.message);
  }
  assertExactKeys(canonical.relationship, ["worldBookId"], "canonical.relationship");

  if (
    canonical.relationship.worldBookId !== null &&
    (typeof canonical.relationship.worldBookId !== "string" ||
      !canonical.relationship.worldBookId ||
      canonical.relationship.worldBookId.trim() !== canonical.relationship.worldBookId)
  ) {
    throw new SyncCanonicalMaterializationError(
      "canonical.relationship.worldBookId must be a non-empty trimmed string or null.",
    );
  }

  assertSerializable(canonical);
}

function getCharacterFieldValues(card) {
  const values = {};

  for (const field of CANONICAL_CHARACTER_FIELDS) {
    if (characterStringFields.has(field)) {
      values[field] = normalizeString(card[field]);
    } else {
      values[field] = normalizeArray(card[field]);
    }
  }

  return values;
}

export function materializeCanonicalCharacter({
  existingCharacter,
  canonical,
  linkedWorldBook = null,
}) {
  assertPlainObject(existingCharacter, "Existing character");
  validateCharacterCanonical(canonical);

  // Only the depth prompt extension is semantic in V5; keep other local state.
  // Start with the local raw representation so ignored vendor/UI state survives
  // a remote semantic update, then replace only supported semantic fields.
  const rawCard = isPlainObject(existingCharacter.rawCard) ? clone(existingCharacter.rawCard) : {};
  const cardData = getActiveCardData(rawCard);
  const fields = getCharacterFieldValues(canonical.card);

  for (const [field, value] of Object.entries(fields)) {
    cardData[field] = clone(value);
  }
  cardData.extensions = { ...cardData.extensions, depth_prompt: clone(canonical.card.extensions.depth_prompt) };

  const relationshipId = canonical.relationship.worldBookId;
  const character = {
    ...clone(existingCharacter),
    ...fields,
    extensions: { ...clone(existingCharacter.extensions ?? {}), depth_prompt: clone(canonical.card.extensions.depth_prompt) },
    rawCard,
  };

  const diagnostics = applyCharacterRelationship(character, relationshipId, linkedWorldBook);
  assertRoundTrip(canonical, createCanonicalCharacterProjection(character), "character");

  return { character, diagnostics };
}

function validateWorldBookCanonical(canonical) {
  assertExactKeys(canonical, ["projectionVersion", "entityType", "worldbook"], "canonical");
  assertProjectionHeader(canonical, "worldbook");
  assertExactKeys(canonical.worldbook, ["name", "entries"], "canonical.worldbook");

  if (typeof canonical.worldbook.name !== "string") {
    throw new SyncCanonicalMaterializationError("canonical.worldbook.name must be a string.");
  }

  if (!Array.isArray(canonical.worldbook.entries)) {
    throw new SyncCanonicalMaterializationError("canonical.worldbook.entries must be an array.");
  }

  for (const [index, entry] of canonical.worldbook.entries.entries()) {
    assertExactKeys(entry, CANONICAL_WORLDBOOK_ENTRY_FIELDS, `canonical.worldbook.entries[${index}]`);

    if (typeof entry.id !== "string" || !entry.id) {
      throw new SyncCanonicalMaterializationError(
        `canonical.worldbook.entries[${index}].id must be a non-empty string.`,
      );
    }
  }

  assertSerializable(canonical);
}

// All from the projection's field table: every entry key it reads, every
// Character Book extension key, and the name ST World Info writes for a field.
const worldBookFieldSpecs = Object.entries(WORLDBOOK_ENTRY_FIELD_TABLE);
const worldBookSemanticRawFields = Object.freeze(worldBookFieldSpecs.flatMap(([, spec]) => spec.names));
const worldBookExtensionAliases = Object.freeze(Object.fromEntries(
  worldBookFieldSpecs.filter(([, spec]) => spec.extension).map(([field, spec]) => [field, spec.extension]),
));
const worldBookSemanticExtensionFields = Object.freeze(Object.values(worldBookExtensionAliases));

function omitKnownSemanticRawFields(rawEntry) {
  const materialized = isPlainObject(rawEntry) ? clone(rawEntry) : {};

  for (const key of worldBookSemanticRawFields) delete materialized[key];

  if (isPlainObject(materialized.extensions)) {
    for (const key of worldBookSemanticExtensionFields) delete materialized.extensions[key];
  }

  return materialized;
}

export function materializeWorldBookEntry(entry, existingEntry) {
  const rawEntry = omitKnownSemanticRawFields(existingEntry?.rawEntry);
  const extensionSiblings = isPlainObject(rawEntry.extensions) ? clone(rawEntry.extensions) : {};

  // Emit the portable ST World Info dialect. Any unknown raw data stays in the
  // cloned entry, but all supported semantic aliases are authored once here.
  for (const [field, { stName = field }] of worldBookFieldSpecs) {
    rawEntry[stName] = field === "enabled" ? !entry.enabled : clone(entry[field]);
  }

  if (Object.keys(extensionSiblings).length > 0) rawEntry.extensions = extensionSiblings;
  else delete rawEntry.extensions;

  return {
    id: entry.id,
    keys: clone(entry.keys),
    secondaryKeys: clone(entry.secondaryKeys),
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    enabled: entry.enabled,
    position: entry.position,
    order: entry.order,
    useRegex: entry.useRegex,
    probability: entry.probability,
    useProbability: entry.useProbability,
    depth: entry.depth,
    role: entry.role,
    extensions: extensionSiblings,
    rawEntry,
  };
}

function createRawWorldBook(existingWorldBook, name, entries) {
  const rawWorldBook = isPlainObject(existingWorldBook?.rawWorldBook)
    ? clone(existingWorldBook.rawWorldBook)
    : isPlainObject(existingWorldBook?.rawBook)
      ? clone(existingWorldBook.rawBook)
      : {};

  // ST may export originalData instead of entries. Never retain a stale copy.
  delete rawWorldBook.originalData;
  return {
    ...rawWorldBook,
    name,
    entries: Object.fromEntries(entries.map((entry) => [entry.id, clone(entry.rawEntry)])),
  };
}

export function materializeCanonicalWorldBook({ existingWorldBook, canonical }) {
  assertPlainObject(existingWorldBook, "Existing worldbook");
  validateWorldBookCanonical(canonical);

  const existingEntries = new Map(
    (Array.isArray(existingWorldBook.entries) ? existingWorldBook.entries : [])
      .map((entry) => [String(entry?.id), entry]),
  );
  const entries = canonical.worldbook.entries.map((entry) =>
    materializeWorldBookEntry(entry, existingEntries.get(entry.id)),
  );
  const worldBook = {
    ...clone(existingWorldBook),
    name: canonical.worldbook.name,
    entries,
    rawWorldBook: createRawWorldBook(existingWorldBook, canonical.worldbook.name, entries),
  };

  delete worldBook.rawBook;
  assertRoundTrip(canonical, createCanonicalWorldBookProjection(worldBook), "worldbook");
  return { worldBook };
}
