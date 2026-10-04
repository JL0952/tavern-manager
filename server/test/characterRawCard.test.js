import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSyncedRawCard } from "../services/characterRawCard.js";
import { createJsonStorage } from "../services/jsonStorage.js";
import { getCanonicalEntityState } from "../services/syncEntityState.js";
import {
  CANONICAL_CHARACTER_FIELDS,
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";

// Record edited in Manager; rawCard still holds the imported values.
function staleCharacter() {
  return {
    id: "c1", name: "Now", description: "", personality: "", scenario: "", first_mes: "hi", mes_example: "",
    creator_notes: "", system_prompt: "", post_history_instructions: "", alternate_greetings: ["a"],
    group_only_greetings: [], creator: "", character_version: "", tags: ["new"], assets: [],
    extensions: { depth_prompt: { prompt: "", depth: 4, role: "system" } },
    pinned: false, worldBookId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    rawCard: {
      spec: "chara_card_v2", spec_version: "2.0", chat: "keep",
      name: "Then", description: "old description", tags: ["old"], creatorcomment: "old note",
      data: {
        name: "Then", description: "old description", creator_notes: "old note", tags: ["old"], alternate_greetings: [],
        creatorNotes: "camel", creatorcomment: "data legacy",
        extensions: { depth_prompt: { prompt: "raw", depth: 2 }, vendor: { keep: true } },
      },
    },
  };
}

function staleV1Character() {
  const character = staleCharacter();
  character.rawCard = { name: "Then", description: "old description", creatorcomment: "old note", talkativeness: 0.5 };
  return character;
}

test("record card fields replace their rawCard copies; other rawCard fields stay", () => {
  const original = staleCharacter();
  const synced = withSyncedRawCard(original);

  for (const field of CANONICAL_CHARACTER_FIELDS) {
    assert.deepEqual(synced.rawCard.data[field], original[field], field);
  }

  assert.equal(synced.rawCard.name, "Now");
  assert.equal(synced.rawCard.description, "");
  assert.deepEqual(synced.rawCard.tags, ["new"]);
  assert.equal(synced.rawCard.creatorcomment, "");
  assert.equal(Object.hasOwn(synced.rawCard, "personality"), false, "absent root mirrors are not added");
  assert.equal(synced.rawCard.chat, "keep");
  assert.equal(synced.rawCard.data.creatorNotes, "camel");
  assert.equal(synced.rawCard.data.creatorcomment, "data legacy");
  assert.deepEqual(synced.rawCard.data.extensions, staleCharacter().rawCard.data.extensions);
  assert.deepEqual(original, staleCharacter(), "the input record is not mutated");

  const v1 = withSyncedRawCard(staleV1Character());
  assert.equal(Object.hasOwn(v1.rawCard, "data"), false);
  assert.equal(v1.rawCard.name, "Now");
  assert.equal(v1.rawCard.creator_notes, "");
  assert.equal(v1.rawCard.creatorcomment, "");
  assert.equal(v1.rawCard.talkativeness, 0.5);

  const withoutRawCard = { id: "c2", name: "Only" };
  assert.equal(withSyncedRawCard(withoutRawCard), withoutRawCard);
});

test("syncing rawCard changes no projection hash", () => {
  for (const character of [staleCharacter(), staleV1Character()]) {
    assert.equal(
      hashCanonicalProjection(createCanonicalCharacterProjection(withSyncedRawCard(character))),
      hashCanonicalProjection(createCanonicalCharacterProjection(character)),
    );
  }
});

test("storage writes keep rawCard in step without touching sync metadata", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "character-raw-card-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const dbPath = join(dataDirectory, "db.json");
  const record = staleCharacter();
  record.sync = {
    schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    revision: 1,
    contentHash: hashCanonicalProjection(createCanonicalCharacterProjection(record)),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await writeFile(dbPath, JSON.stringify({ characters: [record], worldbooks: [], tagDefinitions: [] }));
  const storage = createJsonStorage({ dataDirectory });
  const stored = async () => JSON.parse(await readFile(dbPath, "utf8"));

  await storage.updateCharacter("c1", { pinned: true });
  let db = await stored();
  assert.equal(db.characters[0].rawCard.data.creator_notes, "");
  assert.equal(db.characters[0].rawCard.creatorcomment, "");
  assert.deepEqual(db.characters[0].sync, record.sync, "a pin plus rawCard sync is not a content change");
  assert.equal(getCanonicalEntityState(db, "character", "c1").revision, 1);

  await storage.updateCharacter("c1", { tags: ["edited"] });
  db = await stored();
  assert.deepEqual(db.characters[0].rawCard.data.tags, ["edited"]);
  assert.deepEqual(db.characters[0].rawCard.tags, ["edited"]);
  assert.equal(getCanonicalEntityState(db, "character", "c1").revision, 2);

  await storage.saveCharacter({ ...staleCharacter(), id: "c3" });
  db = await stored();
  assert.equal(db.characters[1].rawCard.data.name, "Now");
});
