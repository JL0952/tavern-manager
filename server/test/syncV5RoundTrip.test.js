import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCardFormState, createCardUpdatePayload, createCharacterPayload } from "../../client/src/utils/characterForms.js";
import { createManualCharacter } from "../routes/cards.js";
import { createCanonicalCharacterProjection as characterProjection,
  createCanonicalWorldBookProjection as bookProjection,
  hashCanonicalProjection as hash, getCanonicalWorldBookProjectionDiagnostics } from "../services/syncProjection.js";
import { materializeCanonicalCharacter, materializeCanonicalWorldBook } from "../services/syncCanonicalMaterializer.js";
import { parseCharacterCard, createEmbeddedWorldBook } from "../services/cardParser.js";
import { parseWorldBook, createWorldBookExport } from "../services/worldBookParser.js";
import { createJsonExport, createPngExport, createEmbeddedCharacterBook } from "../services/cardExporter.js";
import { createJsonStorage } from "../services/jsonStorage.js";
import { createSyncWriteService } from "../services/syncWriteService.js";
import { buildSyncManifest, buildSyncResource } from "../services/syncReadModel.js";
import extractChunks from "png-chunks-extract";
import textChunk from "png-chunk-text";
import { extensionRoot, needsExtension } from "./extensionRoot.js";

const { normalizeSillyTavernWorldbook } = extensionRoot ? await import(`${extensionRoot}/st-adapter.js`) : {};
const note = { prompt: "Synthetic in-chat instruction", depth: 0, role: "assistant" };
const card = () => ({ id: "fixture-card", name: "Synthetic", creator_notes: "Author, not in-chat instruction",
  extensions: { depth_prompt: structuredClone(note), vendor: { keep: true } },
  rawCard: { spec: "chara_card_v2", spec_version: "2.0", name: "stale",
    data: { name: "stale", extensions: { depth_prompt: { prompt: "old", depth: 4, role: "system" }, vendor: { keep: true } } } } });
const rawBook = () => ({ name: "Synthetic lore", entries: { 0: {
  uid: 0, key: ["lore"], keysecondary: ["second"], comment: "Entry title", content: "Current content",
  constant: false, vectorized: true, selective: false, selectiveLogic: 0, disable: false,
  position: 4, order: 0, probability: 0, useProbability: false, depth: 0, role: null,
  excludeRecursion: true, preventRecursion: false, delayUntilRecursion: false, ignoreBudget: true,
  matchPersonaDescription: true, matchCharacterDescription: false, matchCharacterPersonality: true,
  matchCharacterDepthPrompt: true, matchScenario: false, matchCreatorNotes: true,
  scanDepth: 0, caseSensitive: false, matchWholeWords: null, useGroupScoring: false,
  outletName: "synthetic outlet", group: "g", groupOverride: false, groupWeight: 0,
  sticky: 0, cooldown: null, delay: 0, triggers: ["normal", "continue"], useRegex: false,
} }, originalData: { name: "stale", entries: [{ id: 0, comment: "STALE", content: "STALE" }] } });
const book = () => normalizeSillyTavernWorldbook(rawBook(), "local", "Synthetic lore");

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), "sync-v5-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function parseJson(t, value, parse) {
  const directory = await temp(t); const path = join(directory, "synthetic.json");
  await writeFile(path, JSON.stringify(value));
  return parse({ path, filename: "synthetic.json", originalname: "synthetic.json" });
}

test("V5 character and WB hashes remain exactly frozen, note and entry title included", () => {
  const c = { name: "Synthetic", extensions: { depth_prompt: { prompt: "note", depth: 0, role: "user" } } };
  const w = { name: "Synthetic", entries: [{ id: "0", comment: "title", content: "text", role: null, keys: ["k"], useProbability: false }] };
  // Every Manager and every ST client must agree on these bytes.
  assert.equal(hash(characterProjection(c)), "sha256:30ceffa4f217c88f32bfd2c4ac6f4b1dc9daf78d0c90e14415f9069dcd2016ac");
  assert.equal(hash(bookProjection(w)), "sha256:3f760431c764a29bf29e23aa04d82ec388ff88a58e6931b20cd8586f9637219a");
  assert.equal(characterProjection(c).projectionVersion, 5); assert.equal(bookProjection(w).projectionVersion, 5);
  const changed = structuredClone(c); changed.extensions.depth_prompt.prompt = "changed";
  assert.notEqual(hash(characterProjection(c)), hash(characterProjection(changed)));
  const renamed = structuredClone(w); renamed.entries[0].comment = "new title";
  assert.notEqual(hash(bookProjection(w)), hash(bookProjection(renamed)));
});

for (const field of ["prompt", "depth", "role"]) test(`V5 hashes Character's Note ${field}`, () => {
  const c = card(); const changed = structuredClone(c);
  changed.extensions.depth_prompt[field] = { prompt: "changed", depth: 1, role: "user" }[field];
  assert.notEqual(hash(characterProjection(c)), hash(characterProjection(changed)));
});

test("Manager note import, save, JSON/PNG export and explicit clear preserve independent creator notes", async t => {
  const imported = await parseJson(t, JSON.parse(createJsonExport(card())), parseCharacterCard);
  assert.deepEqual(imported.extensions.depth_prompt, note);
  const directory = await temp(t);
  const storage = createJsonStorage({ dataDirectory: directory });
  await storage.saveCharacter(imported);
  const next = { prompt: "Edited", depth: 8, role: "user" };
  const edited = await storage.updateCharacter(imported.id, { extensions: { depth_prompt: next } });
  assert.deepEqual(edited.extensions.depth_prompt, next);
  assert.deepEqual(edited.extensions.vendor, { keep: true });
  assert.deepEqual(edited.rawCard.data.extensions.depth_prompt, next);
  for (const exported of [JSON.parse(createJsonExport(edited)), ...extractChunks(await createPngExport({ ...edited, sourceType: "json", avatarSource: null }))
    .filter(c => c.name === "tEXt").map(c => textChunk.decode(c)).filter(c => ["chara", "ccv3"].includes(c.keyword))
    .map(c => JSON.parse(Buffer.from(c.text, "base64").toString()))]) {
    assert.deepEqual(exported.data.extensions.depth_prompt, next);
    assert.equal(exported.name, exported.data.name);
  }
  const cleared = await storage.updateCharacter(imported.id, { extensions: { depth_prompt: { prompt: "", depth: 0, role: "system" } } });
  assert.equal(cleared.creator_notes, card().creator_notes);
  assert.equal(characterProjection(cleared).card.extensions.depth_prompt.prompt, "");
  assert.equal(JSON.parse(createJsonExport(cleared)).data.extensions.depth_prompt.prompt, "");
  assert.notEqual(hash(characterProjection(edited)), hash(characterProjection(cleared)));
});

test("Manager sync create/update materializes note and clearing overrides existing raw note", async t => {
  const storage = createJsonStorage({ dataDirectory: await temp(t) });
  const service = createSyncWriteService({ mutateLibrary: storage.mutateLibrary, generateId: () => "generated" });
  const canonical = characterProjection(card());
  const created = await service.createCharacter({ canonical });
  assert.deepEqual(created.entity.canonical.card.extensions.depth_prompt, note);
  canonical.card.extensions.depth_prompt = { prompt: "", depth: 0, role: "user" };
  await service.updateCharacter("generated", { canonical, baseRevision: 1 });
  const saved = await storage.getCharacterById("generated");
  assert.deepEqual(saved.extensions.depth_prompt, canonical.card.extensions.depth_prompt);
  assert.deepEqual(saved.rawCard.data.extensions.depth_prompt, saved.extensions.depth_prompt);
  assert.equal(saved.creator_notes, card().creator_notes);
});

test("Manager create/edit payloads carry the note, and manual create stores it in data.extensions", () => {
  const payload = createCharacterPayload({ name: " Synthetic ", tags: "tag, tag", creator_notes: "Author notes", depth_prompt: note });
  assert.deepEqual(payload.extensions.depth_prompt, note);
  assert.deepEqual(payload.tags, ["tag"]);
  const record = createManualCharacter(payload);
  assert.equal(record.name, "Synthetic");
  assert.deepEqual(record.extensions.depth_prompt, note);
  assert.deepEqual(record.rawCard.data.extensions.depth_prompt, note);
  const form = createCardFormState(record);
  form.depth_prompt.prompt = "";
  const update = createCardUpdatePayload(form);
  assert.equal(update.extensions.depth_prompt.prompt, "");
  assert.equal(update.extensions.depth_prompt.depth, 0);
  assert.equal(update.creator_notes, "Author notes");
  assert.deepEqual(record.extensions.depth_prompt, note, "editing the form leaves the record unchanged");
});

test("saving the edit form keeps a tag with a comma unless the tag text is edited", () => {
  const form = createCardFormState({ name: "Synthetic", tags: ["a,b", "x"] });
  form.description = "Edited elsewhere";
  assert.deepEqual(createCardUpdatePayload(form).tags, ["a,b", "x"]);
  form.tags = "a,b, x, new";
  assert.deepEqual(createCardUpdatePayload(form).tags, ["a", "b", "x", "new"], "typed text splits on commas");
  assert.deepEqual(createCardUpdatePayload(createCardFormState({ name: "Plain" })).tags, []);
});

test("WB native -> canonical -> Manager create/update -> export/import retains every semantic field", needsExtension, async t => {
  const source = book(); const canonical = bookProjection(source); const before = structuredClone(rawBook());
  const materialized = materializeCanonicalWorldBook({ existingWorldBook: { id: "fixture" }, canonical }).worldBook;
  assert.deepEqual(materialized.entries[0].comment, "Entry title");
  assert.deepEqual(bookProjection(materialized), canonical);
  const storage = createJsonStorage({ dataDirectory: await temp(t) });
  const service = createSyncWriteService({ mutateLibrary: storage.mutateLibrary, generateId: () => "book" });
  await service.createWorldBook({ canonical });
  const changed = structuredClone(canonical); changed.worldbook.entries[0].comment = "Edited title";
  const result = await service.updateWorldBook("book", { baseRevision: 1, canonical: changed });
  assert.deepEqual(result.entity.canonical, changed);
  const saved = await storage.getWorldBookById("book");
  const exported = JSON.parse(createWorldBookExport(saved));
  assert.equal(Object.hasOwn(exported, "originalData"), false);
  assert.equal(exported.entries[0].comment, "Edited title");
  const imported = await parseJson(t, exported, parseWorldBook);
  assert.deepEqual(bookProjection(imported), changed);
  const native = exported.entries[0];
  for (const [key, value] of Object.entries(before.entries[0])) {
    if (["uid", "comment"].includes(key)) continue;
    assert.deepEqual(native[key], Array.isArray(value) ? [...value].sort() : value, key);
  }
});

test("WB standalone and embedded exports use current entries, not stale originalData", needsExtension, async t => {
  const source = book();
  source.entries[0].comment = "Current title"; source.entries[0].content = "Current edited content";
  const standalone = JSON.parse(createWorldBookExport(source));
  assert.equal(standalone.entries[0].comment, "Current title");
  assert.equal(standalone.entries[0].content, "Current edited content");
  assert.equal("originalData" in standalone, false);
  const embedded = createEmbeddedCharacterBook(source);
  assert.equal(embedded.entries[0].extensions.position, 4);
  assert.equal(embedded.entries[0].extensions.probability, 0);
  assert.equal(embedded.entries[0].extensions.useProbability, false);
  assert.equal(embedded.entries[0].extensions.role, null);
  const importedCard = await parseJson(t, { data: { name: "Synthetic", character_book: embedded } }, parseCharacterCard);
  const importedBook = createEmbeddedWorldBook(importedCard);
  assert.deepEqual(bookProjection(importedBook), bookProjection(source));
});

test("nonempty unportable WB fields are reported without their values", needsExtension, () => {
  for (const field of ["automationId", "characterFilter", "futureSemantic"]) {
    const source = book();
    source.entries[0].rawEntry[field] = field === "characterFilter" ? { names: ["SENSITIVE"] } : "SENSITIVE";
    const diagnostics = getCanonicalWorldBookProjectionDiagnostics(source);
    assert.ok(diagnostics.length);
    assert.doesNotMatch(JSON.stringify(diagnostics), /SENSITIVE/);
  }
});

test("V4 metadata reads as revision 1 without a rewrite and gives way to V5 metadata on a note/title change", needsExtension, async t => {
  const directory = await temp(t);
  const character = card(); const worldbook = { ...book(), id: "book" };
  for (const record of [character, worldbook]) {
    record.sync = { schemaVersion: 4, projectionVersion: 4, revision: 7, contentHash: `sha256:${"0".repeat(64)}`, updatedAt: "2026-09-30T00:00:00.000Z" };
  }
  const db = { characters: [character], worldbooks: [worldbook], tagDefinitions: [] };
  const path = join(directory, "db.json"); await writeFile(path, JSON.stringify(db));
  const before = await readFile(path, "utf8");
  assert.equal(buildSyncManifest(db).projectionVersion, 5);
  assert.equal(buildSyncResource(db, "character", character.id).entity.canonical.projectionVersion, 5);
  assert.equal(buildSyncResource(db, "character", character.id).entity.revision, 1);
  assert.equal(await readFile(path, "utf8"), before);
  const storage = createJsonStorage({ dataDirectory: directory });
  const updated = await storage.updateCharacter(character.id, { extensions: { depth_prompt: { ...note, prompt: "new" } } });
  const persisted = (await storage.readDbSnapshot()).characters[0];
  assert.equal(persisted.sync.revision, 2); assert.equal(persisted.sync.projectionVersion, 5);
  const service = createSyncWriteService({ mutateLibrary: storage.mutateLibrary });
  const canonical = bookProjection(worldbook); canonical.worldbook.entries[0].comment = "new title";
  const result = await service.updateWorldBook("book", { canonical, baseRevision: 1 });
  assert.equal(result.entity.revision, 2);
  assert.equal((await storage.getWorldBookById("book")).sync.projectionVersion, 5);
});
