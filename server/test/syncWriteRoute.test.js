import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createJsonStorage } from "../services/jsonStorage.js";
import { createSyncRouter } from "../routes/sync.js";
import { createSyncWriteService } from "../services/syncWriteService.js";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
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
    fileName: "local-card.png",
    avatar: "avatars/local.png",
    pinned: true,
    worldBookId: null,
    rawCard: { spec: "chara_card_v3", spec_version: "3.0", data: {} },
    ...overrides,
  };
}

function withSync(character, revision = 1) {
  return {
    ...character,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashCanonicalProjection(createCanonicalCharacterProjection(character)),
      updatedAt: "2026-09-28T12:00:00.000Z",
    },
  };
}

function createDb(characters = []) {
  return { characters, worldbooks: [], tagDefinitions: [] };
}

async function startServer(t, router) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync/v1", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${port}/api/sync/v1`;
}

async function createStore(t, db) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "tavern-sync-write-route-"));
  const dbPath = join(dataDirectory, "db.json");
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const storage = createJsonStorage({ dataDirectory });
  return { dbPath, storage };
}

function request(baseRevision, canonical) {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, canonical }),
  };
}

test("PUT requests do not require authentication", async (t) => {
  let received = null;
  const readSnapshot = async () => {
    return createDb();
  };
  const writeService = {
    async updateCharacter(id, body) {
      received = { id, body };
      return { ok: true };
    },
    async updateWorldBook() {
      return { ok: true };
    },
    async createCharacter() {
      return { ok: true };
    },
    async createWorldBook() {
      return { ok: true };
    },
  };
  const url = await startServer(t, createSyncRouter({ readSnapshot, writeService }));
  const response = await fetch(`${url}/characters/character-1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision: 1, canonical: {} }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    id: "character-1",
    body: { baseRevision: 1, canonical: {} },
  });
});

test("POST sync creates delegate canonical-only bodies and return created resources", async (t) => {
  const received = [];
  const writeService = {
    async updateCharacter() { return { ok: true }; },
    async updateWorldBook() { return { ok: true }; },
    async createCharacter(body) {
      received.push({ entityType: "character", body });
      return { apiVersion: "sync/v1", write: { outcome: "created" }, entity: { id: "character-created" } };
    },
    async createWorldBook(body) {
      received.push({ entityType: "worldbook", body });
      return { apiVersion: "sync/v1", write: { outcome: "created" }, entity: { id: "worldbook-created" } };
    },
  };
  const url = await startServer(t, createSyncRouter({ readSnapshot: async () => createDb(), writeService }));

  const character = await fetch(`${url}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canonical: { entityType: "character" } }),
  });
  const worldbook = await fetch(`${url}/worldbooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canonical: { entityType: "worldbook" } }),
  });

  assert.equal(character.status, 201);
  assert.equal(worldbook.status, 201);
  assert.deepEqual(received, [
    { entityType: "character", body: { canonical: { entityType: "character" } } },
    { entityType: "worldbook", body: { canonical: { entityType: "worldbook" } } },
  ]);
  assert.equal((await character.json()).write.outcome, "created");
  assert.equal((await worldbook.json()).write.outcome, "created");
});

test("GET and PUT return current metadata and conflicts without authentication", async (t) => {
  const character = withSync(createCharacter(), 3);
  const { storage } = await createStore(t, createDb([character]));
  const writeService = createSyncWriteService({
    mutateLibrary: storage.mutateLibrary,
    now: "2026-09-28T16:00:00.000Z",
  });
  const url = await startServer(
    t,
    createSyncRouter({ readSnapshot: storage.readDbSnapshot, writeService }),
  );
  const get = await fetch(`${url}/characters/${character.id}`);
  assert.equal(get.status, 200);
  assert.equal((await get.json()).entity.revision, 3);

  const canonical = createCanonicalCharacterProjection(character);
  canonical.card.description = "Remote description";
  const success = await fetch(`${url}/characters/${character.id}`, request(3, canonical));
  const successBody = await success.json();
  assert.equal(success.status, 200);
  assert.equal(successBody.write.outcome, "updated");
  assert.equal(successBody.entity.revision, 4);

  const stale = await fetch(`${url}/characters/${character.id}`, request(3, canonical));
  const staleBody = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(staleBody.error.code, "sync_revision_conflict");
  assert.equal(staleBody.error.current.revision, 4);
  assert.equal(staleBody.error.current.resource, `/api/sync/v1/characters/${character.id}`);

  const future = await fetch(`${url}/characters/${character.id}`, request(5, canonical));
  assert.equal(future.status, 409);
  assert.equal((await future.json()).error.code, "sync_future_base_revision");
});

test("invalid canonical request cannot change synthetic local fields and a no-op reports current resource", async (t) => {
  const character = withSync(createCharacter(), 2);
  const { dbPath, storage } = await createStore(t, createDb([character]));
  const writeService = createSyncWriteService({ mutateLibrary: storage.mutateLibrary });
  const url = await startServer(
    t,
    createSyncRouter({ readSnapshot: storage.readDbSnapshot, writeService }),
  );
  const canonical = createCanonicalCharacterProjection(character);
  const noOp = await fetch(`${url}/characters/${character.id}`, request(2, canonical));
  const noOpBody = await noOp.json();
  assert.equal(noOp.status, 200);
  assert.equal(noOpBody.write.outcome, "unchanged");
  assert.equal(noOpBody.entity.revision, 2);

  const before = await readFile(dbPath, "utf8");
  const injected = structuredClone(canonical);
  injected.card.avatar = "remote-avatar.png";
  const rejected = await fetch(`${url}/characters/${character.id}`, request(2, injected));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, "sync_invalid_request");
  assert.equal(await readFile(dbPath, "utf8"), before);
});

test("PUT reports malformed persisted metadata as a sync integrity error", async (t) => {
  const character = createCharacter({ sync: {} });
  const { storage } = await createStore(t, createDb([character]));
  const writeService = createSyncWriteService({ mutateLibrary: storage.mutateLibrary });
  const url = await startServer(
    t,
    createSyncRouter({ readSnapshot: storage.readDbSnapshot, writeService }),
  );
  const response = await fetch(
    `${url}/characters/${character.id}`,
    request(1, createCanonicalCharacterProjection(character)),
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "sync_integrity_error");
  assert.equal(body.error.entityType, "character");
});
