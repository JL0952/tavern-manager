import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonStorage } from "../services/jsonStorage.js";
import {
  createSyncWriteService,
  SyncWriteConflictError,
  SyncWriteIntegrityError,
  SyncWriteValidationError,
} from "../services/syncWriteService.js";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";

const now = "2026-09-28T15:00:00.000Z";

function createCharacter(overrides = {}) {
  return {
    id: "character-1",
    fileName: "local-card.png",
    avatar: "avatars/local.png",
    pinned: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    name: "Aster",
    description: "Original description",
    personality: "Calm",
    scenario: "Library",
    first_mes: "Hello",
    mes_example: "",
    creator_notes: "Notes",
    system_prompt: "System",
    post_history_instructions: "History",
    alternate_greetings: [],
    group_only_greetings: [],
    creator: "Creator",
    character_version: "1.0",
    tags: ["fantasy"],
    assets: [],
    worldBookId: null,
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { extensions: { vendor: { sync: { opaque: true } } } },
    },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-1",
    fileName: "local-worldbook.json",
    source: "standalone",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    name: "Aster Lore",
    entries: [
      {
        id: "entry-1",
        keys: ["aster"],
        secondaryKeys: [],
        comment: "Aster",
        content: "Original lore",
        enabled: true,
        rawEntry: { entryVendor: { sync: { opaque: true } } },
      },
    ],
    rawWorldBook: { worldVendor: { sync: { opaque: true } } },
    ...overrides,
  };
}

function withSync(entity, entityType, revision = 1) {
  const canonical =
    entityType === "character"
      ? createCanonicalCharacterProjection(entity)
      : createCanonicalWorldBookProjection(entity);

  return {
    ...entity,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashCanonicalProjection(canonical),
      updatedAt: "2026-09-28T12:00:00.000Z",
    },
  };
}

function createDb({ characters = [], worldbooks = [] } = {}) {
  return { characters, worldbooks, tagDefinitions: [] };
}

async function createStore(t, db, options = {}) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tavern-sync-write-"));
  const dbPath = join(dataDirectory, "db.json");
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const { syncOptions = {}, ...storageOptions } = options;
  const storage = createJsonStorage({ dataDirectory, ...storageOptions });
  return {
    dbPath,
    storage,
    service: createSyncWriteService({ mutateLibrary: storage.mutateLibrary, now, ...syncOptions }),
    read: async () => JSON.parse(await readFile(dbPath, "utf8")),
  };
}

function request(baseRevision, canonical) {
  return { baseRevision, canonical };
}

test("canonical creates allocate Manager UUIDs, materialize content, and return sync resources", async (t) => {
  const ids = ["worldbook-created", "character-created"];
  const store = await createStore(t, createDb(), {
    syncOptions: { generateId: () => ids.shift() },
  });
  const worldBookCanonical = createCanonicalWorldBookProjection(createWorldBook());
  const worldBookResult = await store.service.createWorldBook({ canonical: worldBookCanonical });
  const characterCanonical = createCanonicalCharacterProjection(createCharacter({ worldBookId: "worldbook-created" }));
  const characterResult = await store.service.createCharacter({ canonical: characterCanonical });
  const db = await store.read();

  assert.equal(worldBookResult.write.outcome, "created");
  assert.equal(worldBookResult.entity.id, "worldbook-created");
  assert.equal(worldBookResult.entity.revision, 1);
  assert.deepEqual(worldBookResult.entity.canonical, worldBookCanonical);
  assert.equal(characterResult.write.outcome, "created");
  assert.equal(characterResult.entity.id, "character-created");
  assert.equal(characterResult.entity.revision, 1);
  assert.deepEqual(characterResult.entity.canonical, characterCanonical);
  assert.equal(db.characters[0].worldBookId, "worldbook-created");
  assert.equal(db.characters[0].sync.revision, 1);
  assert.equal(db.worldbooks[0].sync.revision, 1);
});

test("canonical create rejects non-canonical request fields before storage mutation", async (t) => {
  const store = await createStore(t, createDb(), {
    syncOptions: { generateId: () => "unused" },
  });
  const before = await readFile(store.dbPath, "utf8");

  await assert.rejects(
    store.service.createCharacter({ canonical: createCanonicalCharacterProjection(createCharacter()), id: "caller-supplied" }),
    SyncWriteValidationError,
  );
  assert.equal(await readFile(store.dbPath, "utf8"), before);
});

test("character writes use authoritative OCC, preserve local fields, and return reconciled metadata", async (t) => {
  const character = withSync(createCharacter(), "character", 3);
  const worldBook = withSync(createWorldBook(), "worldbook", 4);
  const store = await createStore(t, createDb({ characters: [character], worldbooks: [worldBook] }));
  const canonical = createCanonicalCharacterProjection(character);
  canonical.card.description = "Remote description";
  canonical.relationship.worldBookId = worldBook.id;

  const response = await store.service.updateCharacter(character.id, request(3, canonical));
  const db = await store.read();

  assert.equal(response.write.outcome, "updated");
  assert.equal(response.entity.revision, 4);
  assert.match(response.entity.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.characters[0].description, "Remote description");
  assert.equal(db.characters[0].updatedAt, now);
  assert.equal(db.characters[0].fileName, character.fileName);
  assert.equal(db.characters[0].avatar, character.avatar);
  assert.equal(db.characters[0].pinned, character.pinned);
  assert.equal(db.characters[0].worldBookId, worldBook.id);
  assert.equal(db.characters[0].rawCard.data.extensions.world, worldBook.name);
  assert.equal(db.worldbooks[0].sync.revision, 4);

  const noOp = await store.service.updateCharacter(character.id, request(4, canonical));
  assert.equal(noOp.write.outcome, "unchanged");
  assert.equal(noOp.entity.revision, 4);
  assert.equal((await store.read()).characters[0].sync.revision, 4);
});

test("legacy virtual revision 1 is unchanged on no-op and advances to persisted revision 2 on change", async (t) => {
  const character = createCharacter();
  const store = await createStore(t, createDb({ characters: [character] }));
  const noOpCanonical = createCanonicalCharacterProjection(character);

  const noOp = await store.service.updateCharacter(character.id, request(1, noOpCanonical));
  assert.equal(noOp.write.outcome, "unchanged");
  assert.equal(noOp.entity.metadataSource, "ephemeral");
  assert.equal(Object.hasOwn((await store.read()).characters[0], "sync"), false);

  const changedCanonical = structuredClone(noOpCanonical);
  changedCanonical.card.name = "Aster Remote";
  const changed = await store.service.updateCharacter(character.id, request(1, changedCanonical));
  assert.equal(changed.write.outcome, "updated");
  assert.equal(changed.entity.revision, 2);
  assert.equal((await store.read()).characters[0].sync.revision, 2);
});

test("stale, future, concurrent, and corrupt writes do not overwrite authoritative state", async (t) => {
  const character = withSync(createCharacter(), "character", 2);
  const store = await createStore(t, createDb({ characters: [character] }));
  const changed = createCanonicalCharacterProjection(character);
  changed.card.description = "First";

  await assert.rejects(
    store.service.updateCharacter(character.id, request(1, changed)),
    (error) => error instanceof SyncWriteConflictError && error.code === "sync_revision_conflict",
  );
  await assert.rejects(
    store.service.updateCharacter(character.id, request(3, changed)),
    (error) => error instanceof SyncWriteConflictError && error.code === "sync_future_base_revision",
  );

  const second = structuredClone(changed);
  second.card.description = "Second";
  const results = await Promise.allSettled([
    store.service.updateCharacter(character.id, request(2, changed)),
    store.service.updateCharacter(character.id, request(2, second)),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await store.read()).characters[0].sync.revision, 3);

  const corrupt = withSync(createCharacter({ id: "corrupt" }), "character");
  corrupt.sync.contentHash = `sha256:${"0".repeat(64)}`;
  const corruptStore = await createStore(t, createDb({ characters: [corrupt] }));
  const before = await readFile(corruptStore.dbPath, "utf8");
  await assert.rejects(
    corruptStore.service.updateCharacter(corrupt.id, request(1, createCanonicalCharacterProjection(corrupt))),
    SyncWriteIntegrityError,
  );
  assert.equal(await readFile(corruptStore.dbPath, "utf8"), before);
});

test("worldbook writes remain independent and failed materialization leaves local state intact", async (t) => {
  const character = withSync(createCharacter(), "character", 5);
  const worldBook = withSync(createWorldBook(), "worldbook", 2);
  const store = await createStore(t, createDb({ characters: [character], worldbooks: [worldBook] }));
  const worldBookCanonical = createCanonicalWorldBookProjection(worldBook);
  worldBookCanonical.worldbook.entries[0].content = "Remote lore";

  const worldBookResult = await store.service.updateWorldBook(
    worldBook.id,
    request(2, worldBookCanonical),
  );
  assert.equal(worldBookResult.entity.revision, 3);
  assert.equal((await store.read()).characters[0].sync.revision, 5);

  const badCharacterCanonical = createCanonicalCharacterProjection((await store.read()).characters[0]);
  badCharacterCanonical.card.avatar = "attempted-overwrite.png";
  const before = await readFile(store.dbPath, "utf8");
  await assert.rejects(
    store.service.updateCharacter(character.id, request(5, badCharacterCanonical)),
    SyncWriteValidationError,
  );
  assert.equal(await readFile(store.dbPath, "utf8"), before);
});

test("request-level id and sync injection is rejected before the writer slot", async (t) => {
  const character = withSync(createCharacter(), "character", 2);
  let writerCalls = 0;
  const service = createSyncWriteService({
    mutateLibrary: async () => {
      writerCalls += 1;
    },
  });
  const canonical = createCanonicalCharacterProjection(character);

  await assert.rejects(
    service.updateCharacter(character.id, { baseRevision: 2, canonical, id: "replacement" }),
    SyncWriteValidationError,
  );
  await assert.rejects(
    service.updateCharacter(character.id, { baseRevision: 2, canonical, sync: { revision: 99 } }),
    SyncWriteValidationError,
  );
  assert.equal(writerCalls, 0);
});

test("sync writes reject a canonical projection from an older version", async (t) => {
  const character = withSync(createCharacter(), "character", 2);
  const store = await createStore(t, createDb({ characters: [character] }));
  const historical = { ...createCanonicalCharacterProjection(character), projectionVersion: 4 };
  const before = await readFile(store.dbPath, "utf8");

  await assert.rejects(
    store.service.updateCharacter(character.id, request(2, historical)),
    (error) => error instanceof SyncWriteValidationError && /Unsupported canonical projectionVersion/.test(error.message),
  );
  assert.equal(await readFile(store.dbPath, "utf8"), before);
});

test("an entity with metadata from before V5 writes as revision 1 and then starts V5 metadata", async (t) => {
  const character = createCharacter();
  character.sync = {
    schemaVersion: 1,
    revision: 5,
    contentHash: `sha256:${"f".repeat(64)}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const store = await createStore(t, createDb({ characters: [character] }));
  const canonical = createCanonicalCharacterProjection(character);

  await assert.rejects(store.service.updateCharacter(character.id, request(5, canonical)), SyncWriteConflictError);

  const unchanged = await store.service.updateCharacter(character.id, request(1, canonical));
  assert.equal(unchanged.write.outcome, "unchanged");
  assert.deepEqual((await store.read()).characters[0].sync, character.sync);

  const changed = structuredClone(canonical);
  changed.card.description = "Edited after restore";
  const updated = await store.service.updateCharacter(character.id, request(1, changed));
  const sync = (await store.read()).characters[0].sync;
  assert.equal(updated.entity.revision, 2);
  assert.equal(sync.schemaVersion, SYNC_METADATA_SCHEMA_VERSION);
  assert.equal(sync.projectionVersion, CANONICAL_PROJECTION_VERSION);
  assert.equal(sync.revision, 2);
  assert.equal(sync.contentHash, hashCanonicalProjection(changed));
});

test("character relation updates link, unlink, and preserve dangling canonical ids without worldbook writes", async (t) => {
  const character = withSync(createCharacter(), "character", 1);
  const worldBook = withSync(createWorldBook(), "worldbook", 7);
  const store = await createStore(t, createDb({ characters: [character], worldbooks: [worldBook] }));
  const linked = createCanonicalCharacterProjection(character);
  linked.relationship.worldBookId = worldBook.id;
  const linkResult = await store.service.updateCharacter(character.id, request(1, linked));
  assert.equal(linkResult.entity.revision, 2);
  assert.equal((await store.read()).worldbooks[0].sync.revision, 7);

  const unlinked = structuredClone(linked);
  unlinked.relationship.worldBookId = null;
  await store.service.updateCharacter(character.id, request(2, unlinked));
  let db = await store.read();
  assert.equal(db.characters[0].worldBookId, null);
  assert.equal("character_book" in db.characters[0].rawCard.data, false);

  const dangling = structuredClone(unlinked);
  dangling.relationship.worldBookId = "missing-worldbook";
  const danglingResult = await store.service.updateCharacter(character.id, request(3, dangling));
  db = await store.read();
  assert.deepEqual(danglingResult.entity.diagnostics, [
    { code: "missing_canonical_worldbook", worldBookId: "missing-worldbook" },
  ]);
  assert.equal(db.characters[0].worldBookId, "missing-worldbook");
  assert.equal(db.worldbooks.length, 1);
});
