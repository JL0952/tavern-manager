// Shared verbatim with the SillyTavern extension (see server/scripts/exportSyncCore.js):
// imports must stay relative and dependency-free so Node and the browser hash identically.
import { normalizeCharacterNote } from "./characterNote.js";
import { sha256Hex } from "./sha256.js";

export const CANONICAL_PROJECTION_VERSION = 5;

// Sync carries Manager-supported card semantics, not a raw Character Card
// container. Keep this explicit rather than inheriting arbitrary raw-card or
// extension fields into the sync contract.
export const CANONICAL_CHARACTER_FIELDS = Object.freeze([
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
  "assets",
]);

// The exact keys of canonical.card: the content fields and the Character's Note.
export const CANONICAL_CHARACTER_CARD_KEYS = Object.freeze([...CANONICAL_CHARACTER_FIELDS, "extensions"]);

export class SyncProjectionError extends Error {}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function normalizeObject(value) {
  return isPlainObject(value) ? clone(value) : {};
}

function compareUnicode(left, right) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);

  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftCharacters[index].codePointAt(0);
    const rightCodePoint = rightCharacters[index].codePointAt(0);

    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }
  }

  return leftCharacters.length - rightCharacters.length;
}

function normalizeTags(value) {
  const seen = new Set();
  const tags = [];

  for (const tag of Array.isArray(value) ? value : []) {
    if (typeof tag !== "string") {
      continue;
    }

    const normalizedTag = tag.trim();

    if (!normalizedTag || seen.has(normalizedTag)) {
      continue;
    }

    seen.add(normalizedTag);
    tags.push(normalizedTag);
  }

  return tags.sort(compareUnicode);
}

function normalizeUnorderedArray(value) {
  return normalizeArray(value).sort((left, right) =>
    compareUnicode(stableSerialize(left), stableSerialize(right)),
  );
}

function materializeCharacterCard(character) {
  const card = {};

  for (const field of CANONICAL_CHARACTER_FIELDS) {
    if (field === "tags") {
      card.tags = normalizeTags(character?.tags);
    } else if (field === "assets") {
      card.assets = normalizeArray(character?.assets);
    } else if (field === "alternate_greetings" || field === "group_only_greetings") {
      card[field] = normalizeArray(character?.[field]);
    } else {
      card[field] = normalizeString(character?.[field]);
    }
  }

  return card;
}

function hasOwn(value, key) {
  return isPlainObject(value) && Object.hasOwn(value, key);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNullableBoolean(value, fallback) {
  return value === null || typeof value === "boolean" ? value : fallback;
}

function normalizeFiniteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeNullableNumber(value, fallback) {
  return value === null || (typeof value === "number" && Number.isFinite(value)) ? value : fallback;
}

function normalizeWorldBookPosition(value, fallback) {
  if (value === "before_char" || value === "before") return 0;
  if (value === "after_char" || value === "after") return 1;
  return normalizeFiniteNumber(value, fallback);
}

function normalizeEntryId(entry, index) {
  return String(entry?.id ?? entry?.rawEntry?.uid ?? entry?.rawEntry?.id ?? index);
}

function getRawWorldBook(worldBook) {
  return isPlainObject(worldBook?.rawWorldBook)
    ? worldBook.rawWorldBook
    : isPlainObject(worldBook?.rawBook)
      ? worldBook.rawBook
      : {};
}

function isEmbeddedCharacterBook(worldBook) {
  return Array.isArray(getRawWorldBook(worldBook).entries);
}

function getEntryRawValue(entry, rawEntry, aliases, extensionAliases = []) {
  // The normalized Manager entry is the current editable record. rawEntry is
  // retained for import/export fidelity and only fills dialects the Manager
  // record does not materialize. This lets a Manager edit change sync semantics
  // without requiring an unrelated raw-container rewrite.
  for (const alias of aliases) {
    if (hasOwn(entry, alias)) return entry[alias];
  }

  const entryExtensions = normalizeObject(entry?.extensions);
  for (const alias of extensionAliases) {
    if (hasOwn(entryExtensions, alias)) return entryExtensions[alias];
  }

  for (const alias of aliases) {
    if (hasOwn(rawEntry, alias)) return rawEntry[alias];
  }

  const rawExtensions = normalizeObject(rawEntry?.extensions);
  for (const alias of extensionAliases) {
    if (hasOwn(rawExtensions, alias)) return rawExtensions[alias];
  }

  return undefined;
}

function normalizeText(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeTriggers(value) {
  return normalizeUnorderedArray(value);
}

// An explicit null, true or false is kept as written; otherwise it is a number.
function normalizeDelayUntilRecursion(value, fallback) {
  return value === null || typeof value === "boolean" ? value : normalizeFiniteNumber(value, fallback);
}

// Every portable entry field once, in canonical order: the names it is read
// under (Manager record and ST World Info alike, first match wins), its key
// under `extensions` in a Character Book, the name ST World Info writes when
// that is not the field name, and its value when absent, which is ST's own
// new-entry template for a standalone book. Fields without `normalize` have
// dedicated rules in normalizeCanonicalWorldBookEntry. Raw envelopes, entry
// containers, editor ordering and extension bags never enter the content hash.
export const WORLDBOOK_ENTRY_FIELD_TABLE = Object.freeze({
  id: { names: ["id", "uid"], stName: "uid" },
  keys: { names: ["keys", "key"], stName: "key", fallback: Object.freeze([]) },
  secondaryKeys: { names: ["secondaryKeys", "secondary_keys", "keysecondary"], stName: "keysecondary", fallback: Object.freeze([]) },
  content: { names: ["content"], fallback: "" },
  constant: { names: ["constant"], fallback: false, normalize: normalizeBoolean },
  vectorized: { names: ["vectorized"], extension: "vectorized", fallback: false, normalize: normalizeBoolean },
  selective: { names: ["selective"], fallback: true },
  selectiveLogic: { names: ["selectiveLogic"], extension: "selectiveLogic", fallback: 0, normalize: normalizeFiniteNumber },
  enabled: { names: ["disable", "enabled"], stName: "disable", fallback: true },
  position: { names: ["position"], extension: "position", fallback: 0 },
  order: { names: ["order", "insertion_order"], fallback: 100 },
  probability: { names: ["probability"], extension: "probability", fallback: 100, normalize: normalizeFiniteNumber },
  useProbability: { names: ["useProbability"], extension: "useProbability", fallback: true, normalize: normalizeBoolean },
  depth: { names: ["depth"], extension: "depth", fallback: 4, normalize: normalizeFiniteNumber },
  role: { names: ["role"], extension: "role", fallback: 0, normalize: normalizeNullableNumber },
  excludeRecursion: { names: ["excludeRecursion"], extension: "exclude_recursion", fallback: false, normalize: normalizeBoolean },
  preventRecursion: { names: ["preventRecursion"], extension: "prevent_recursion", fallback: false, normalize: normalizeBoolean },
  delayUntilRecursion: { names: ["delayUntilRecursion"], extension: "delay_until_recursion", fallback: 0, normalize: normalizeDelayUntilRecursion },
  ignoreBudget: { names: ["ignoreBudget"], extension: "ignore_budget", fallback: false, normalize: normalizeBoolean },
  matchPersonaDescription: { names: ["matchPersonaDescription"], extension: "match_persona_description", fallback: false, normalize: normalizeBoolean },
  matchCharacterDescription: { names: ["matchCharacterDescription"], extension: "match_character_description", fallback: false, normalize: normalizeBoolean },
  matchCharacterPersonality: { names: ["matchCharacterPersonality"], extension: "match_character_personality", fallback: false, normalize: normalizeBoolean },
  matchCharacterDepthPrompt: { names: ["matchCharacterDepthPrompt"], extension: "match_character_depth_prompt", fallback: false, normalize: normalizeBoolean },
  matchScenario: { names: ["matchScenario"], extension: "match_scenario", fallback: false, normalize: normalizeBoolean },
  matchCreatorNotes: { names: ["matchCreatorNotes"], extension: "match_creator_notes", fallback: false, normalize: normalizeBoolean },
  scanDepth: { names: ["scanDepth"], extension: "scan_depth", fallback: null, normalize: normalizeNullableNumber },
  caseSensitive: { names: ["caseSensitive"], extension: "case_sensitive", fallback: null, normalize: normalizeNullableBoolean },
  matchWholeWords: { names: ["matchWholeWords"], extension: "match_whole_words", fallback: null, normalize: normalizeNullableBoolean },
  useGroupScoring: { names: ["useGroupScoring"], extension: "use_group_scoring", fallback: null, normalize: normalizeNullableBoolean },
  outletName: { names: ["outletName"], extension: "outlet_name", fallback: "", normalize: normalizeText },
  group: { names: ["group"], extension: "group", fallback: "", normalize: normalizeText },
  groupOverride: { names: ["groupOverride"], extension: "group_override", fallback: false, normalize: normalizeBoolean },
  groupWeight: { names: ["groupWeight"], extension: "group_weight", fallback: 100, normalize: normalizeFiniteNumber },
  sticky: { names: ["sticky"], extension: "sticky", fallback: null, normalize: normalizeNullableNumber },
  cooldown: { names: ["cooldown"], extension: "cooldown", fallback: null, normalize: normalizeNullableNumber },
  delay: { names: ["delay"], extension: "delay", fallback: null, normalize: normalizeNullableNumber },
  triggers: { names: ["triggers"], extension: "triggers", fallback: Object.freeze([]), normalize: normalizeTriggers },
  comment: { names: ["comment"], fallback: "", normalize: normalizeText },
  useRegex: { names: ["useRegex", "use_regex"], fallback: false, normalize: normalizeBoolean },
});

export const CANONICAL_WORLDBOOK_ENTRY_FIELDS = Object.freeze(Object.keys(WORLDBOOK_ENTRY_FIELD_TABLE));

// A new standalone entry; arrays are frozen, so copy them before editing.
export const WORLDBOOK_ENTRY_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(WORLDBOOK_ENTRY_FIELD_TABLE)
    .filter(([, spec]) => Object.hasOwn(spec, "fallback"))
    .map(([field, spec]) => [field, spec.fallback]),
));

function normalizeEntryEnabled(entry, rawEntry) {
  if (hasOwn(entry, "disable")) return !normalizeBoolean(entry.disable, false);
  if (hasOwn(entry, "enabled")) return normalizeBoolean(entry.enabled, WORLDBOOK_ENTRY_DEFAULTS.enabled);
  if (hasOwn(rawEntry, "disable")) return !normalizeBoolean(rawEntry.disable, false);
  if (hasOwn(rawEntry, "enabled")) return normalizeBoolean(rawEntry.enabled, WORLDBOOK_ENTRY_DEFAULTS.enabled);
  return WORLDBOOK_ENTRY_DEFAULTS.enabled;
}

export function normalizeCanonicalWorldBookEntry(entry, index, { embeddedCharacterBook = false } = {}) {
  const rawEntry = isPlainObject(entry?.rawEntry) ? entry.rawEntry : {};
  const hasRawEntry = isPlainObject(entry?.rawEntry);
  const read = (field) => {
    const { names, extension } = WORLDBOOK_ENTRY_FIELD_TABLE[field];
    return getEntryRawValue(entry, rawEntry, names, extension ? [extension] : []);
  };
  const dedicated = {
    id: () => normalizeEntryId(entry, index),
    keys: () => normalizeUnorderedArray(firstDefined(read("keys"), entry?.keys)),
    secondaryKeys: () => normalizeUnorderedArray(firstDefined(read("secondaryKeys"), entry?.secondaryKeys)),
    content: () => normalizeString(firstDefined(read("content"), entry?.content)),
    // A Character Book entry defaults to non-selective and after the character.
    selective: () => normalizeBoolean(read("selective"), embeddedCharacterBook ? false : WORLDBOOK_ENTRY_DEFAULTS.selective),
    enabled: () => normalizeEntryEnabled(entry, rawEntry),
    position: () => normalizeWorldBookPosition(
      firstDefined(read("position"), hasRawEntry ? undefined : entry?.position),
      embeddedCharacterBook ? 1 : WORLDBOOK_ENTRY_DEFAULTS.position,
    ),
    order: () => normalizeFiniteNumber(
      firstDefined(read("order"), hasRawEntry ? undefined : entry?.order),
      WORLDBOOK_ENTRY_DEFAULTS.order,
    ),
  };

  return Object.fromEntries(CANONICAL_WORLDBOOK_ENTRY_FIELDS.map((field) => {
    const { fallback, normalize } = WORLDBOOK_ENTRY_FIELD_TABLE[field];
    return [field, normalize ? normalize(read(field), fallback) : dedicated[field]()];
  }));
}

function isEffectiveCharacterFilter(value) {
  if (!isPlainObject(value)) return false;
  return value.isExclude === true ||
    (Array.isArray(value.names) && value.names.length > 0) ||
    (Array.isArray(value.tags) && value.tags.length > 0);
}

// Known names that carry no portable semantics: they never count as unsupported.
const worldBookTableSpecs = Object.values(WORLDBOOK_ENTRY_FIELD_TABLE);
const worldBookExtensionNames = new Set([...worldBookTableSpecs.flatMap((spec) => spec.extension ?? []),
  "display_index", "character_filter", "automation_id"]);
const worldBookEntryNames = new Set([...worldBookTableSpecs.flatMap((spec) => spec.names),
  "rawEntry", "extensions", "displayIndex", "addMemo", "characterFilter", "automationId"]);
const hasPayload = value => value !== undefined && value !== null && value !== ""
  && (typeof value !== "object" || Object.keys(value).length > 0);

export function getCanonicalWorldBookProjectionDiagnostics(worldBook) {
  const diagnostics = [];

  for (const [index, entry] of (Array.isArray(worldBook?.entries) ? worldBook.entries : []).entries()) {
    const rawEntry = isPlainObject(entry?.rawEntry) ? entry.rawEntry : {};
    const characterFilter = getEntryRawValue(entry, rawEntry, ["characterFilter"], ["character_filter"]);
    const automationId = getEntryRawValue(entry, rawEntry, ["automationId"], ["automation_id"]);
    const entryId = normalizeEntryId(entry, index);

    if (isEffectiveCharacterFilter(characterFilter)) {
      diagnostics.push({ code: "unsupported_nonportable_character_filter", entryId });
    }

    if (typeof automationId === "string" && automationId.trim()) {
      diagnostics.push({ code: "unsupported_nonportable_automation_id", entryId });
    }
    for (const field of new Set([...Object.keys(rawEntry), ...Object.keys(entry)])) {
      if (!worldBookEntryNames.has(field) && hasPayload(entry[field] ?? rawEntry[field])) {
        diagnostics.push({ code: "unsupported_nonportable_entry_field", entryId, field });
      }
    }
    for (const field of new Set([...Object.keys(rawEntry.extensions ?? {}), ...Object.keys(entry.extensions ?? {})])) {
      if (!worldBookExtensionNames.has(field) && hasPayload(entry.extensions?.[field] ?? rawEntry.extensions?.[field])) {
        diagnostics.push({ code: "unsupported_nonportable_entry_extension", entryId, field });
      }
    }
  }

  for (const [field, value] of Object.entries(getRawWorldBook(worldBook))) {
    if (!["name", "entries", "originalData"].includes(field) && hasPayload(value)) {
      diagnostics.push({ code: "unsupported_nonportable_worldbook_field", field });
    }
  }

  return diagnostics;
}

export function createCanonicalCharacterProjection(character) {
  // Prefer the current Manager record, including an explicitly cleared note.
  const extensions = character?.extensions ?? character?.rawCard?.data?.extensions ?? character?.rawCard?.extensions;
  const card = materializeCharacterCard(character);
  card.extensions = { depth_prompt: normalizeCharacterNote(extensions?.depth_prompt) };

  return {
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    entityType: "character",
    card,
    relationship: {
      worldBookId:
        typeof character?.worldBookId === "string" && character.worldBookId.trim()
          ? character.worldBookId.trim()
          : null,
    },
  };
}

export function createCanonicalWorldBookProjection(worldBook) {
  const embeddedCharacterBook = isEmbeddedCharacterBook(worldBook);

  return {
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    entityType: "worldbook",
    worldbook: {
      name: normalizeString(worldBook?.name),
      // ST evaluates entries after a stable descending `order` sort. Source
      // sequence is therefore relevant only as the tie-breaker for equal
      // orders; displayIndex is editor UI and does not participate.
      entries: (Array.isArray(worldBook?.entries) ? worldBook.entries : [])
        .map((entry, index) => normalizeCanonicalWorldBookEntry(entry, index, { embeddedCharacterBook }))
        .sort((left, right) => right.order - left.order),
    },
  };
}
function serializeJsonValue(value, path) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SyncProjectionError(`Non-finite number at ${path}.`);
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serializeJsonValue(item, `${path}[${index}]`)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort(compareUnicode)
      .map((key) => {
        if (value[key] === undefined) {
          throw new SyncProjectionError(`Undefined value at ${path}.${key}.`);
        }

        return `${JSON.stringify(key)}:${serializeJsonValue(value[key], `${path}.${key}`)}`;
      })
      .join(",")}}`;
  }

  throw new SyncProjectionError(`Unsupported value at ${path}.`);
}

export function stableSerialize(value) {
  return serializeJsonValue(value, "$");
}

export function hashCanonicalProjection(projection) {
  return `sha256:${sha256Hex(stableSerialize(projection))}`;
}
