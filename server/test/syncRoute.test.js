import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createJsonStorage } from "../services/jsonStorage.js";
import { createSyncRouter } from "../routes/sync.js";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";

function createCharacter(overrides = {}) {
  return {
    id: "character-1",
    name: "Aster",
    description: "Original description",
    personality: "Calm",
    scenario: "Library",
    first_mes: "Hello",
    mes_example: "<START>",
    alternate_greetings: [],
    group_only_greetings: [],
    creator_notes: "Notes",
    system_prompt: "System",
    post_history_instructions: "History",
    creator: "Creator",
    character_version: "1.0",
    tags: ["fantasy"],
    assets: [],
    worldBookId: null,
    rawCard: { spec: "chara_card_v3", spec_version: "3.0", data: {} },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-1",
    name: "Aster Lore",
    entries: [],
    rawWorldBook: { vendor: { enabled: true } },
    ...overrides,
  };
}

function createDb({ characters = [], worldbooks = [], tagDefinitions = [] } = {}) {
  return { characters, worldbooks, tagDefinitions };
}

function withSync(entity, entityType, revision = 1) {
  const projection =
    entityType === "character"
      ? createCanonicalCharacterProjection(entity)
      : createCanonicalWorldBookProjection(entity);

  return {
    ...entity,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashCanonicalProjection(projection),
      updatedAt: "2026-09-28T12:00:00.000Z",
    },
  };
}

async function startTestServer(t, router) {
  const app = express();
  app.use("/api/sync/v1", router);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  return `http://127.0.0.1:${port}/api/sync/v1`;
}

async function createTemporaryStore(t, initialDb = null) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tavern-sync-route-"));
  const dbPath = join(dataDirectory, "db.json");

  if (initialDb) {
    await writeFile(dbPath, `${JSON.stringify(initialDb, null, 2)}\n`, "utf8");
  }

  t.after(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
  });

  return { dbPath, storage: createJsonStorage({ dataDirectory }) };
}

test("sync routes serve manifest and resources with deterministic ETags and 304 responses", async (t) => {
  const worldbook = withSync(createWorldBook(), "worldbook", 2);
  const character = withSync(
    createCharacter({ id: "character-1", worldBookId: worldbook.id }),
    "character",
    3,
  );
  const db = createDb({ characters: [character], worldbooks: [worldbook] });
  const baseUrl = await startTestServer(
    t,
    createSyncRouter({ readSnapshot: async () => structuredClone(db) }),
  );

  const manifestResponse = await fetch(`${baseUrl}/manifest`);
  const etag = manifestResponse.headers.get("etag");
  const manifest = await manifestResponse.json();

  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "private, max-age=0, must-revalidate");
  assert.match(manifestResponse.headers.get("content-type"), /^application\/json/);
  assert.match(etag, /^"sha256:[a-f0-9]{64}"$/);
  assert.equal(manifest.characters[0].relationship.worldBookId, worldbook.id);

  const cachedResponse = await fetch(`${baseUrl}/manifest`, {
    headers: { "If-None-Match": etag },
  });
  assert.equal(cachedResponse.status, 304);
  assert.equal(await cachedResponse.text(), "");

  const characterResponse = await fetch(`${baseUrl}/characters/${character.id}`);
  const characterBody = await characterResponse.json();
  assert.equal(characterResponse.status, 200);
  assert.deepEqual(characterBody.entity.canonical, createCanonicalCharacterProjection(character));

  const worldbookResponse = await fetch(`${baseUrl}/worldbooks/${worldbook.id}`);
  const worldbookBody = await worldbookResponse.json();
  assert.equal(worldbookResponse.status, 200);
  assert.deepEqual(worldbookBody.entity.canonical, createCanonicalWorldBookProjection(worldbook));
});

test("dangling relationships are diagnostic-only for manifest and character resources", async (t) => {
  const character = createCharacter({ id: "dangling", worldBookId: "missing-worldbook" });
  const baseUrl = await startTestServer(
    t,
    createSyncRouter({ readSnapshot: async () => createDb({ characters: [character] }) }),
  );

  const manifestResponse = await fetch(`${baseUrl}/manifest`);
  const manifest = await manifestResponse.json();
  const characterResponse = await fetch(`${baseUrl}/characters/${character.id}`);
  const resource = await characterResponse.json();

  const diagnostic = [{ code: "missing_canonical_worldbook", worldBookId: "missing-worldbook" }];
  assert.equal(manifestResponse.status, 200);
  assert.deepEqual(manifest.characters[0].diagnostics, diagnostic);
  assert.equal(characterResponse.status, 200);
  assert.deepEqual(resource.entity.diagnostics, diagnostic);
});

test("missing entities return 404 and invalid metadata returns a sync integrity 409", async (t) => {
  const missingUrl = await startTestServer(
    t,
    createSyncRouter({ readSnapshot: async () => createDb() }),
  );
  const missingResponse = await fetch(`${missingUrl}/characters/missing`);

  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "Character not found." });

  const malformed = createCharacter({ sync: {} });
  const invalidUrl = await startTestServer(
    t,
    createSyncRouter({ readSnapshot: async () => createDb({ characters: [malformed] }) }),
  );
  const invalidResponse = await fetch(`${invalidUrl}/manifest`);
  const invalidBody = await invalidResponse.json();

  assert.equal(invalidResponse.status, 409);
  assert.equal(invalidBody.error.code, "sync_integrity_error");
  assert.equal(invalidBody.error.entityType, "character");

  const mismatched = withSync(createCharacter({ id: "mismatched" }), "character");
  mismatched.sync.contentHash = `sha256:${"0".repeat(64)}`;
  const mismatchUrl = await startTestServer(
    t,
    createSyncRouter({ readSnapshot: async () => createDb({ characters: [mismatched] }) }),
  );
  const mismatchResponse = await fetch(`${mismatchUrl}/characters/${mismatched.id}`);
  const mismatchBody = await mismatchResponse.json();

  assert.equal(mismatchResponse.status, 409);
  assert.equal(mismatchBody.error.code, "sync_integrity_error");
});

test("legacy GET requests leave an existing synthetic db byte-for-byte unchanged", async (t) => {
  const db = createDb({ characters: [createCharacter({ id: "legacy" })] });
  const { dbPath, storage } = await createTemporaryStore(t, db);
  const before = await readFile(dbPath, "utf8");
  const baseUrl = await startTestServer(t, createSyncRouter({ readSnapshot: storage.readDbSnapshot }));

  const first = await fetch(`${baseUrl}/characters/legacy`);
  const second = await fetch(`${baseUrl}/characters/legacy`);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).entity.metadataSource, "ephemeral");
  assert.equal((await second.json()).entity.revision, 1);
  assert.equal(await readFile(dbPath, "utf8"), before);
});

test("an absent synthetic database yields an empty manifest without creating db.json", async (t) => {
  const { dbPath, storage } = await createTemporaryStore(t);
  const baseUrl = await startTestServer(t, createSyncRouter({ readSnapshot: storage.readDbSnapshot }));
  const response = await fetch(`${baseUrl}/manifest`);
  const manifest = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(manifest.characters, []);
  assert.deepEqual(manifest.worldbooks, []);
  await assert.rejects(stat(dbPath), { code: "ENOENT" });
});
