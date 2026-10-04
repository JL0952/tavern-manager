import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSerializedLibraryWriter, LibraryTransactionError } from "../services/libraryTransaction.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";

const timestamp = "2026-09-28T13:00:00.000Z";

function clone(value) {
  return structuredClone(value);
}

function createCharacter(overrides = {}) {
  return {
    id: "character-1",
    name: "Aster",
    description: "Original description",
    personality: "Calm",
    scenario: "Library",
    first_mes: "Hello",
    mes_example: "<START>",
    alternate_greetings: ["Greeting one", "Greeting two"],
    group_only_greetings: [],
    creator_notes: "Notes",
    system_prompt: "System",
    post_history_instructions: "History",
    creator: "Creator",
    character_version: "1.0",
    tags: ["fantasy"],
    assets: [],
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        cardVendor: { nested: "preserved" },
        extensions: { vendor: { enabled: true } },
      },
    },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-1",
    name: "Aster Lore",
    entries: [
      {
        id: "entry-1",
        keys: ["aster"],
        secondaryKeys: [],
        comment: "Aster",
        content: "Original lore",
        enabled: true,
        rawEntry: { entryVendor: { nested: "preserved" } },
      },
    ],
    rawWorldBook: { worldVendor: { nested: "preserved" } },
    ...overrides,
  };
}

function createDb({ characters = [], worldbooks = [], tagDefinitions = [] } = {}) {
  return { characters, worldbooks, tagDefinitions };
}

function hashEntity(entity, entityType) {
  return hashCanonicalProjection(
    entityType === "character"
      ? createCanonicalCharacterProjection(entity)
      : createCanonicalWorldBookProjection(entity),
  );
}

function withSync(entity, entityType, revision = 1) {
  return {
    ...entity,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashEntity(entity, entityType),
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

async function createTemporaryStore(t, initialDb) {
  const directory = await mkdtemp(join(tmpdir(), "tavern-sync-transaction-"));
  const dbPath = join(directory, "db.json");
  let writeCount = 0;

  await writeFile(dbPath, `${JSON.stringify(initialDb, null, 2)}\n`, "utf8");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function readDb() {
    return JSON.parse(await readFile(dbPath, "utf8"));
  }

  async function writeDb(db) {
    writeCount += 1;
    const temporaryPath = join(directory, `.db.${randomUUID()}.tmp`);

    await writeFile(temporaryPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    await rename(temporaryPath, dbPath);
  }

  return {
    readDb,
    getWriteCount: () => writeCount,
    writer: createSerializedLibraryWriter({ readDb, writeDb, now: timestamp }),
  };
}

test("new character and worldbook transactions initialize revision 1", async (t) => {
  const store = await createTemporaryStore(t, createDb());
  const character = createCharacter();
  const worldbook = createWorldBook();

  await store.writer.mutateLibrary((tx) => {
    tx.createCharacter(character);
    tx.createWorldBook(worldbook);
  });

  const db = await store.readDb();
  assert.equal(store.getWriteCount(), 1);
  assert.equal(db.characters[0].sync.revision, 1);
  assert.equal(db.worldbooks[0].sync.revision, 1);
});

test("legacy canonical changes persist revision 2 while local changes stay legacy", async (t) => {
  const legacyCharacter = createCharacter();
  const store = await createTemporaryStore(t, createDb({ characters: [legacyCharacter] }));

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(legacyCharacter.id, (character) => ({
      ...character,
      pinned: true,
      avatarPng: "/avatars/aster.png",
      updatedAt: "2030-01-01T00:00:00.000Z",
    }));
  });

  let db = await store.readDb();
  assert.equal(Object.hasOwn(db.characters[0], "sync"), false);

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(legacyCharacter.id, (character) => ({
      ...character,
      description: "Changed description",
    }));
  });

  db = await store.readDb();
  assert.equal(db.characters[0].sync.revision, 2);
});

test("character name, tag, and content changes increment once while canonical no-ops do not", async (t) => {
  const character = withSync(createCharacter(), "character");
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, name: "Aster Prime" }));
  });
  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, tags: ["fantasy", "revised"] }));
  });
  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, description: "Changed content" }));
  });

  let db = await store.readDb();
  assert.equal(db.characters[0].sync.revision, 4);
  const syncBeforeNoOp = clone(db.characters[0].sync);

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, description: "Changed content" }));
  });

  db = await store.readDb();
  assert.deepEqual(db.characters[0].sync, syncBeforeNoOp);
});

test("local pin, avatar, path, and Manager timestamps preserve synced metadata", async (t) => {
  const character = withSync(createCharacter(), "character", 5);
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({
      ...current,
      pinned: true,
      avatarPng: "/avatars/aster.png",
      avatarPath: "/avatars/aster.png",
      fileName: "imported-card.png",
      updatedAt: "2030-01-01T00:00:00.000Z",
    }));
  });

  const db = await store.readDb();
  assert.deepEqual(db.characters[0].sync, character.sync);
});

test("worldbook name and content changes increment worldbook metadata", async (t) => {
  const worldbook = withSync(createWorldBook(), "worldbook");
  const store = await createTemporaryStore(t, createDb({ worldbooks: [worldbook] }));

  await store.writer.mutateLibrary((tx) => {
    tx.updateWorldBook(worldbook.id, (current) => ({ ...current, name: "Aster Lore Revised" }));
  });
  await store.writer.mutateLibrary((tx) => {
    tx.updateWorldBook(worldbook.id, (current) => ({
      ...current,
      entries: current.entries.map((entry) => ({ ...entry, content: "Changed lore" })),
    }));
  });

  const db = await store.readDb();
  assert.equal(db.worldbooks[0].sync.revision, 3);
});

test("linking and unlinking changes only the character revision", async (t) => {
  const character = withSync(createCharacter({ worldBookId: null }), "character");
  const worldbook = withSync(createWorldBook(), "worldbook");
  const store = await createTemporaryStore(
    t,
    createDb({ characters: [character], worldbooks: [worldbook] }),
  );

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({
      ...current,
      worldBookId: worldbook.id,
      rawCard: {
        ...current.rawCard,
        data: {
          ...current.rawCard.data,
          character_book: { name: worldbook.name },
          extensions: {
            ...current.rawCard.data.extensions,
            world: worldbook.name,
          },
        },
      },
    }));
  });

  let db = await store.readDb();
  assert.equal(db.characters[0].sync.revision, 2);
  assert.deepEqual(db.worldbooks[0].sync, worldbook.sync);

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({
      ...current,
      worldBookId: null,
      rawCard: {
        ...current.rawCard,
        data: {
          ...current.rawCard.data,
          character_book: { name: "stale export representation" },
          extensions: {
            ...current.rawCard.data.extensions,
            world: "stale derived value",
          },
        },
      },
    }));
  });

  db = await store.readDb();
  assert.equal(db.characters[0].sync.revision, 3);
  assert.deepEqual(db.worldbooks[0].sync, worldbook.sync);
});

test("a multi-character tag mutation advances each changed character exactly once", async (t) => {
  const characters = Array.from({ length: 30 }, (_, index) =>
    withSync(createCharacter({ id: `character-${index}`, name: `Character ${index}` }), "character"),
  );
  const store = await createTemporaryStore(t, createDb({ characters }));

  await store.writer.mutateLibrary((tx) => {
    for (const character of tx.listCharacters()) {
      tx.updateCharacter(character.id, (current) => ({
        ...current,
        tags: [...current.tags, "renamed-tag"],
      }));
    }
  });

  const db = await store.readDb();
  assert.equal(db.characters.length, 30);
  assert.ok(db.characters.every((character) => character.sync.revision === 2));
});

test("transaction callbacks cannot change ids or record-level sync metadata", async (t) => {
  const character = withSync(createCharacter(), "character");
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));

  await assert.rejects(
    store.writer.mutateLibrary((tx) => {
      tx.updateCharacter(character.id, (current) => ({ ...current, id: "different-id" }));
    }),
    LibraryTransactionError,
  );
  await assert.rejects(
    store.writer.mutateLibrary((tx) => {
      tx.updateCharacter(character.id, (current) => ({
        ...current,
        sync: { revision: 999 },
      }));
    }),
    LibraryTransactionError,
  );
  await assert.rejects(
    store.writer.mutateLibrary((tx) => {
      tx.createCharacter({
        ...createCharacter({ id: "character-2" }),
        sync: { revision: 1 },
      });
    }),
    LibraryTransactionError,
  );

  assert.equal(store.getWriteCount(), 0);
  assert.deepEqual((await store.readDb()).characters[0], character);
});

test("opaque nested raw sync fields remain legal and preserved", async (t) => {
  const character = createCharacter({
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        extensions: {
          vendor: {
            sync: {
              vendorRevision: "opaque",
            },
          },
        },
        rawVendor: {
          sync: "also opaque",
        },
      },
    },
  });
  const worldbook = createWorldBook({
    rawWorldBook: {
      worldVendor: {
        sync: {
          vendorRevision: "opaque-worldbook",
        },
      },
    },
  });
  const store = await createTemporaryStore(t, createDb());

  await store.writer.mutateLibrary((tx) => {
    tx.createCharacter(character);
    tx.createWorldBook(worldbook);
  });

  const db = await store.readDb();
  assert.deepEqual(db.characters[0].rawCard.data.extensions.vendor.sync, {
    vendorRevision: "opaque",
  });
  assert.equal(db.characters[0].rawCard.data.rawVendor.sync, "also opaque");
  assert.equal(db.characters[0].sync.revision, 1);
  assert.deepEqual(db.worldbooks[0].rawWorldBook.worldVendor.sync, {
    vendorRevision: "opaque-worldbook",
  });
  assert.equal(db.worldbooks[0].sync.revision, 1);
});

test("concurrent mutations serialize against the latest complete database", async (t) => {
  const character = createCharacter();
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));
  let releaseFirstMutation;
  let signalFirstMutation;
  const firstMutationReached = new Promise((resolve) => {
    signalFirstMutation = resolve;
  });

  const first = store.writer.mutateLibrary(async (tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, name: "Aster Prime" }));
    signalFirstMutation();
    await new Promise((resolve) => {
      releaseFirstMutation = resolve;
    });
  });

  await firstMutationReached;
  const second = store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({
      ...current,
      description: "Changed by second mutation",
    }));
  });

  releaseFirstMutation();
  await Promise.all([first, second]);

  const db = await store.readDb();
  assert.equal(db.characters[0].name, "Aster Prime");
  assert.equal(db.characters[0].description, "Changed by second mutation");
  assert.equal(db.characters[0].sync.revision, 3);
  assert.equal(store.getWriteCount(), 2);
});

test("failed callbacks and projection failures do not write and do not stall the queue", async (t) => {
  const character = createCharacter();
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));

  await assert.rejects(
    store.writer.mutateLibrary(() => {
      throw new Error("planned callback failure");
    }),
    /planned callback failure/,
  );
  await assert.rejects(
    store.writer.mutateLibrary((tx) => {
      tx.updateCharacter(character.id, (current) => ({
        ...current,
        assets: [undefined],
      }));
    }),
    /Unsupported value/,
  );

  assert.equal(store.getWriteCount(), 0);
  assert.deepEqual((await store.readDb()).characters[0], character);

  await store.writer.mutateLibrary((tx) => {
    tx.updateCharacter(character.id, (current) => ({ ...current, name: "Recovered mutation" }));
  });

  const db = await store.readDb();
  assert.equal(store.getWriteCount(), 1);
  assert.equal(db.characters[0].name, "Recovered mutation");
  assert.equal(db.characters[0].sync.revision, 2);
});

test("deleting a record creates no tombstone", async (t) => {
  const character = withSync(createCharacter(), "character");
  const store = await createTemporaryStore(t, createDb({ characters: [character] }));

  await store.writer.mutateLibrary((tx) => {
    assert.equal(tx.deleteCharacter(character.id), true);
  });

  const db = await store.readDb();
  assert.deepEqual(db.characters, []);
  assert.equal(Object.hasOwn(db, "tombstones"), false);
});
