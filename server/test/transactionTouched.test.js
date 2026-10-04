import assert from "node:assert/strict";
import test from "node:test";
import { createSerializedLibraryWriter } from "../services/libraryTransaction.js";
import { hashCanonicalProjection } from "../services/canonicalHash.js";
import { createCanonicalCharacterProjection } from "../services/syncProjection.js";

const now = "2026-01-02T00:00:00.000Z";

function character(id, overrides = {}) {
  return { id, name: id, description: "", tags: [], extensions: { depth_prompt: { prompt: "", depth: 4, role: "system" } }, ...overrides };
}

function synced(record, revision = 3) {
  return {
    ...record,
    sync: {
      schemaVersion: 4, projectionVersion: 5, revision,
      contentHash: hashCanonicalProjection(createCanonicalCharacterProjection(record)), updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function memoryWriter(db) {
  const store = { db };
  const writer = createSerializedLibraryWriter({
    readDb: async () => structuredClone(store.db),
    writeDb: async (next) => { store.db = next; },
    now: () => now,
  });
  return { store, writer };
}

test("only touched records are reconciled; untouched ones keep their metadata exactly", async () => {
  const kept = synced(character("kept"));
  const edited = synced(character("edited"));
  const { store, writer } = memoryWriter({ characters: [kept, edited], worldbooks: [], tagDefinitions: [] });

  await writer.mutateLibrary((transaction) => {
    transaction.updateCharacter("edited", (record) => ({ ...record, description: "changed" }));
    transaction.createCharacter(character("created"));
  });

  const [storedKept, storedEdited, storedCreated] = store.db.characters;
  assert.deepEqual(storedKept, kept);
  assert.equal(storedEdited.sync.revision, 4);
  assert.equal(storedEdited.sync.updatedAt, now);
  assert.equal(storedCreated.sync.revision, 1);

  await writer.mutateLibrary((transaction) => transaction.deleteCharacter("created"));
  assert.deepEqual(store.db.characters.map(({ id }) => id), ["kept", "edited"]);
});

test("a record that cannot be projected blocks only writes to itself", async () => {
  const broken = character("broken", { extensions: { depth_prompt: { depth: "4" } } });
  const { store, writer } = memoryWriter({ characters: [broken, character("other")], worldbooks: [], tagDefinitions: [] });

  await writer.mutateLibrary((transaction) => {
    transaction.updateCharacter("other", (record) => ({ ...record, description: "changed" }));
  });
  assert.equal(store.db.characters[1].description, "changed");
  assert.deepEqual(store.db.characters[0], broken);

  await assert.rejects(writer.mutateLibrary((transaction) => {
    transaction.updateCharacter("broken", (record) => ({ ...record, description: "changed" }));
  }), /Character's Note/);
});
