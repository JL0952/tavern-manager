import assert from "node:assert/strict";
import test from "node:test";
import { createManualWorldBook } from "../routes/worldbooks.js";
import { materializeWorldBookEntry } from "../services/syncCanonicalMaterializer.js";
import {
  CANONICAL_WORLDBOOK_ENTRY_FIELDS,
  WORLDBOOK_ENTRY_DEFAULTS,
  WORLDBOOK_ENTRY_FIELD_TABLE,
  createCanonicalWorldBookProjection,
  normalizeCanonicalWorldBookEntry,
} from "../services/syncProjection.js";

const nullableBooleans = new Set(["caseSensitive", "matchWholeWords", "useGroupScoring"]);

// A value the field can hold that differs from its default.
function changedValue(field) {
  const fallback = WORLDBOOK_ENTRY_DEFAULTS[field];
  if (field === "id") return "entry-7";
  if (field === "position") return 1;
  if (Array.isArray(fallback)) return ["x"];
  if (typeof fallback === "boolean") return !fallback;
  if (typeof fallback === "number") return fallback + 7;
  if (typeof fallback === "string") return "set";
  return nullableBooleans.has(field) ? true : 7;
}

test("the field table lists every canonical field, and only id has no default", () => {
  assert.deepEqual(Object.keys(WORLDBOOK_ENTRY_FIELD_TABLE), [...CANONICAL_WORLDBOOK_ENTRY_FIELDS]);
  assert.deepEqual(CANONICAL_WORLDBOOK_ENTRY_FIELDS.filter((field) => !Object.hasOwn(WORLDBOOK_ENTRY_DEFAULTS, field)), ["id"]);
  const { id, ...bare } = normalizeCanonicalWorldBookEntry({ id: "bare" }, 0);
  assert.equal(id, "bare");
  assert.deepEqual(bare, { ...WORLDBOOK_ENTRY_DEFAULTS });
});

test("every name and Character Book key in the table is read and wins over the default", () => {
  for (const [field, { names, extension }] of Object.entries(WORLDBOOK_ENTRY_FIELD_TABLE)) {
    const value = changedValue(field);

    for (const name of names) {
      // ST stores `enabled` inverted, as `disable`.
      const raw = name === "disable" ? !value : value;
      assert.deepEqual(normalizeCanonicalWorldBookEntry({ rawEntry: { [name]: raw } }, 0)[field], value, `${field} as ${name}`);
    }

    if (extension) {
      assert.deepEqual(normalizeCanonicalWorldBookEntry({ rawEntry: { extensions: { [extension]: value } } }, 0)[field], value,
        `${field} as extensions.${extension}`);
      assert.deepEqual(normalizeCanonicalWorldBookEntry({ extensions: { [extension]: value } }, 0)[field], value,
        `${field} as the record's extensions.${extension}`);
    }
  }
});

test("the ST writer emits each field once under its ST name and drops every alias", () => {
  const rawEntry = { unknown: 1, extensions: { vendor: 2 } };
  for (const { names, extension } of Object.values(WORLDBOOK_ENTRY_FIELD_TABLE)) {
    for (const name of names) rawEntry[name] = "stale";
    if (extension) rawEntry.extensions[extension] = "stale";
  }
  const entry = normalizeCanonicalWorldBookEntry({ id: "entry-1" }, 0);
  const written = materializeWorldBookEntry(entry, { rawEntry }).rawEntry;
  const stNames = Object.entries(WORLDBOOK_ENTRY_FIELD_TABLE).map(([field, { stName = field }]) => stName);

  assert.deepEqual(Object.keys(written).sort(), [...stNames, "unknown", "extensions"].sort());
  assert.deepEqual(written.extensions, { vendor: 2 });
  assert.equal(written.disable, false);
  assert.deepEqual(normalizeCanonicalWorldBookEntry({ rawEntry: written }, 0), entry, "the written entry reads back unchanged");
});

test("a new WorldBook's first entry takes ST's defaults and keeps the typed key order", () => {
  const book = createManualWorldBook({ name: "Lore", firstEntry: { comment: "Title", content: "Text", keys: "b, a" } });
  const [entry] = book.entries;

  assert.equal(entry.order, 100);
  assert.equal(entry.useProbability, true);
  assert.equal(entry.role, 0);
  assert.deepEqual(entry.keys, ["b", "a"]);
  assert.deepEqual(book.rawWorldBook.entries[entry.id], entry.rawEntry);
  assert.deepEqual(createCanonicalWorldBookProjection(book).worldbook.entries[0],
    { ...WORLDBOOK_ENTRY_DEFAULTS, id: entry.id, keys: ["a", "b"], comment: "Title", content: "Text" });
});
