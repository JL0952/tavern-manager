import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";
import { createJsonStorage } from "../services/jsonStorage.js";

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
    worldBookId: null,
    pinned: false,
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

async function createTemporaryStore(t, initialDb, options = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tavern-json-storage-sync-"));
  const dbPath = join(dataDirectory, "db.json");

  await writeFile(dbPath, `${JSON.stringify(initialDb, null, 2)}\n`, "utf8");
  t.after(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
  });

  return {
    dbPath,
    readStoredDb: async () => JSON.parse(await readFile(dbPath, "utf8")),
    storage: createJsonStorage({ dataDirectory, ...options }),
  };
}

function replaceTags(tags, sourceTags, targetTag = null) {
  const sourceSet = new Set(sourceTags);
  const nextTags = [];

  for (const tag of tags) {
    const nextTag = sourceSet.has(tag) ? targetTag : tag;

    if (nextTag && !nextTags.includes(nextTag)) {
      nextTags.push(nextTag);
    }
  }

  return nextTags;
}

async function mutateTags(storage, sourceTags, targetTag = null) {
  return storage.mutateLibrary((transaction) => {
    const changedIds = [];

    for (const character of transaction.listCharacters()) {
      const nextTags = replaceTags(character.tags, sourceTags, targetTag);

      if (JSON.stringify(nextTags) === JSON.stringify(character.tags)) {
        continue;
      }

      transaction.updateCharacter(character.id, (current) => ({
        ...current,
        tags: nextTags,
        rawCard: {
          ...current.rawCard,
          data: {
            ...current.rawCard.data,
            tags: nextTags,
          },
        },
      }));
      changedIds.push(character.id);
    }

    const tagDefinitions = transaction.getTagDefinitions().filter(
      (definition) => !sourceTags.includes(definition.name),
    );

    if (targetTag && !tagDefinitions.some((definition) => definition.name === targetTag)) {
      tagDefinitions.push({ name: targetTag, color: "", category: "" });
    }

    transaction.replaceTagDefinitions(tagDefinitions);
    return changedIds;
  });
}

test("character storage helpers delegate through sync reconciliation", async (t) => {
  const { storage, readStoredDb } = await createTemporaryStore(t, createDb());
  const character = createCharacter();

  await storage.saveCharacter(character);
  let db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 1);

  await storage.updateCharacter(character.id, { name: "Aster Prime" });
  db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 2);

  await storage.replaceCharacter(character.id, createCharacter({
    id: "incoming-character-id",
    description: "Replacement description",
  }));
  db = await readStoredDb();
  assert.equal(db.characters[0].id, character.id);
  assert.equal(db.characters[0].sync.revision, 3);

  assert.equal(await storage.deleteCharacter(character.id), true);
  db = await readStoredDb();
  assert.deepEqual(db.characters, []);
  assert.equal(Object.hasOwn(db, "tombstones"), false);
});

test("character imports with embedded worldbooks initialize both new entities", async (t) => {
  const { storage, readStoredDb } = await createTemporaryStore(t, createDb());
  const character = createCharacter({ id: "character-with-worldbook" });
  const worldbook = createWorldBook({ id: "embedded-worldbook" });

  await storage.saveCharacterWithWorldBook(character, worldbook);

  const db = await readStoredDb();
  assert.equal(db.characters[0].worldBookId, worldbook.id);
  assert.equal(db.characters[0].sync.revision, 1);
  assert.equal(db.worldbooks[0].sync.revision, 1);
});

test("worldbook storage helpers delegate through sync reconciliation", async (t) => {
  const { storage, readStoredDb } = await createTemporaryStore(t, createDb());
  const worldbook = createWorldBook();

  await storage.saveWorldBook(worldbook);
  let db = await readStoredDb();
  assert.equal(db.worldbooks[0].sync.revision, 1);

  await storage.updateWorldBook(worldbook.id, { name: "Aster Lore Revised" });
  db = await readStoredDb();
  assert.equal(db.worldbooks[0].sync.revision, 2);

  await storage.replaceWorldBook(worldbook.id, createWorldBook({
    id: "incoming-worldbook-id",
    entries: [{ ...createWorldBook().entries[0], content: "Replacement lore" }],
  }));
  db = await readStoredDb();
  assert.equal(db.worldbooks[0].id, worldbook.id);
  assert.equal(db.worldbooks[0].sync.revision, 3);

  assert.equal(await storage.deleteWorldBook(worldbook.id), true);
  db = await readStoredDb();
  assert.deepEqual(db.worldbooks, []);
});

test("legacy entities initialize only after their first canonical mutation", async (t) => {
  const legacyCharacter = createCharacter();
  const { storage, readStoredDb } = await createTemporaryStore(
    t,
    createDb({ characters: [legacyCharacter] }),
  );

  await storage.updateCharacter(legacyCharacter.id, {
    pinned: true,
    avatarPng: "/avatars/aster.png",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });
  let db = await readStoredDb();
  assert.equal(Object.hasOwn(db.characters[0], "sync"), false);

  await storage.updateCharacter(legacyCharacter.id, { description: "Changed description" });
  db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 2);
});

test("root-level id and sync patches are rejected while nested opaque sync remains preserved", async (t) => {
  const character = createCharacter({
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        extensions: { vendor: { sync: { opaque: true } } },
      },
    },
  });
  const { storage, readStoredDb } = await createTemporaryStore(t, createDb());

  await storage.saveCharacter(character);
  await storage.saveWorldBook(createWorldBook());
  await assert.rejects(storage.updateCharacter(character.id, { id: "different" }), /cannot modify "id"/);
  await assert.rejects(storage.updateCharacter(character.id, { sync: {} }), /cannot modify "sync"/);
  await assert.rejects(storage.updateWorldBook("worldbook-1", { id: "different" }), /cannot modify "id"/);
  await assert.rejects(storage.updateWorldBook("worldbook-1", { sync: {} }), /cannot modify "sync"/);

  const db = await readStoredDb();
  assert.deepEqual(db.characters[0].rawCard.data.extensions.vendor.sync, { opaque: true });
  assert.equal(db.characters[0].sync.revision, 1);
});

test("link and unlink update only the character revision", async (t) => {
  const character = withSync(createCharacter(), "character");
  const worldbook = withSync(createWorldBook(), "worldbook");
  const { storage, readStoredDb } = await createTemporaryStore(
    t,
    createDb({ characters: [character], worldbooks: [worldbook] }),
  );

  await storage.mutateLibrary((transaction) => {
    transaction.updateCharacter(character.id, (current) => ({
      ...current,
      worldBookId: worldbook.id,
      rawCard: {
        ...current.rawCard,
        data: {
          ...current.rawCard.data,
          character_book: { name: worldbook.name },
          extensions: { ...current.rawCard.data.extensions, world: worldbook.name },
        },
      },
    }));
  });
  let db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 2);
  assert.deepEqual(db.worldbooks[0].sync, worldbook.sync);

  await storage.mutateLibrary((transaction) => {
    transaction.updateCharacter(character.id, (current) => ({
      ...current,
      worldBookId: null,
      rawCard: {
        ...current.rawCard,
        data: {
          ...current.rawCard.data,
          character_book: { name: "derived only" },
          extensions: { ...current.rawCard.data.extensions, world: "derived only" },
        },
      },
    }));
  });
  db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 3);
  assert.deepEqual(db.worldbooks[0].sync, worldbook.sync);
});

test("tag rename, merge, and delete advance every changed character once", async (t) => {
  const characters = Array.from({ length: 3 }, (_, index) =>
    withSync(
      createCharacter({
        id: `character-${index}`,
        tags: index === 0 ? ["old", "shared"] : index === 1 ? ["merge-a"] : ["merge-b"],
      }),
      "character",
    ),
  );
  const { storage, readStoredDb } = await createTemporaryStore(
    t,
    createDb({
      characters,
      tagDefinitions: [
        { name: "old", color: "", category: "" },
        { name: "merge-a", color: "", category: "" },
        { name: "merge-b", color: "", category: "" },
      ],
    }),
  );

  await mutateTags(storage, ["old"], "renamed");
  let db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 2);

  await mutateTags(storage, ["merge-a", "merge-b"], "merged");
  db = await readStoredDb();
  assert.equal(db.characters[1].sync.revision, 2);
  assert.equal(db.characters[2].sync.revision, 2);

  await mutateTags(storage, ["renamed"]);
  db = await readStoredDb();
  assert.equal(db.characters[0].sync.revision, 3);
  assert.equal(db.characters[1].sync.revision, 2);
  assert.equal(db.characters[2].sync.revision, 2);
});

test("concurrent production storage writes preserve both canonical changes", async (t) => {
  const character = createCharacter();
  const { storage, readStoredDb } = await createTemporaryStore(
    t,
    createDb({ characters: [character] }),
  );
  let releaseFirst;
  let signalFirst;
  const firstReached = new Promise((resolve) => {
    signalFirst = resolve;
  });

  const first = storage.mutateLibrary(async (transaction) => {
    transaction.updateCharacter(character.id, (current) => ({ ...current, name: "Aster Prime" }));
    signalFirst();
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
  });

  await firstReached;
  const second = storage.updateCharacter(character.id, { description: "Second write" });
  releaseFirst();
  await Promise.all([first, second]);

  const db = await readStoredDb();
  assert.equal(db.characters[0].name, "Aster Prime");
  assert.equal(db.characters[0].description, "Second write");
  assert.equal(db.characters[0].sync.revision, 3);
});

test("guarded worldbook deletion observes queued links", async (t) => {
  const character = createCharacter();
  const worldbook = createWorldBook();
  const { storage, readStoredDb } = await createTemporaryStore(
    t,
    createDb({ characters: [character], worldbooks: [worldbook] }),
  );
  let releaseLink;
  let signalLink;
  const linkReached = new Promise((resolve) => {
    signalLink = resolve;
  });

  const link = storage.mutateLibrary(async (transaction) => {
    transaction.updateCharacter(character.id, (current) => ({ ...current, worldBookId: worldbook.id }));
    signalLink();
    await new Promise((resolve) => {
      releaseLink = resolve;
    });
  });

  await linkReached;
  const deletion = storage.deleteWorldBookIfUnlinked(worldbook.id);
  releaseLink();
  await link;
  const outcome = await deletion;

  assert.equal(outcome.deleted, false);
  assert.equal(outcome.linkedCharacters.length, 1);
  assert.equal((await readStoredDb()).worldbooks.length, 1);
});

test("modern restores preserve metadata and legacy restores remain legacy", async (t) => {
  const original = createDb({ characters: [createCharacter()] });
  const { storage, readStoredDb } = await createTemporaryStore(t, original);
  const modern = createDb({
    characters: [withSync(createCharacter({ name: "Modern" }), "character", 4)],
    worldbooks: [withSync(createWorldBook(), "worldbook", 3)],
  });
  let modernFilesRestored = false;

  await storage.restoreLibrarySnapshot(modern, async () => {
    modernFilesRestored = true;
  });
  assert.equal(modernFilesRestored, true);
  assert.deepEqual(await readStoredDb(), modern);

  const legacy = createDb({ characters: [createCharacter({ name: "Legacy" })] });
  await storage.restoreLibrarySnapshot(legacy, async () => {});
  const restoredLegacy = await readStoredDb();
  assert.equal(Object.hasOwn(restoredLegacy.characters[0], "sync"), false);
});

test("a failed storage write leaves the previous database untouched", async (t) => {
  const character = createCharacter();
  const initialDb = createDb({ characters: [character] });
  const { storage, readStoredDb } = await createTemporaryStore(t, initialDb, {
    writeDatabase: async () => {
      throw new Error("planned database write failure");
    },
  });

  await assert.rejects(
    storage.updateCharacter(character.id, { description: "Should not persist" }),
    /planned database write failure/,
  );
  assert.deepEqual(await readStoredDb(), initialDb);
});
