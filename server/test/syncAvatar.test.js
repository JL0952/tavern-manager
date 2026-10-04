import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import extractChunks from "png-chunks-extract";
import encodeChunks from "png-chunks-encode";
import textChunk from "png-chunk-text";
import { createSyncRouter } from "../routes/sync.js";
import { hashCanonicalProjection } from "../services/canonicalHash.js";
import { createJsonStorage } from "../services/jsonStorage.js";
import { createSyncAvatarService } from "../services/syncAvatarService.js";
import { buildSyncManifest } from "../services/syncReadModel.js";
import { createSyncWriteService, SyncWriteNotFoundError, SyncWriteValidationError } from "../services/syncWriteService.js";
import { createCanonicalCharacterProjection } from "../services/syncProjection.js";

const basePng = await readFile(new URL("../assets/default-card.png", import.meta.url));

function withCardChunk(png, text) {
  const chunks = extractChunks(png);
  chunks.splice(-1, 0, textChunk.encode("chara", Buffer.from(text).toString("base64")));
  return Buffer.from(encodeChunks(chunks));
}

function cardKeywords(png) {
  return extractChunks(png).filter((chunk) => chunk.name === "tEXt").map((chunk) => textChunk.decode(chunk.data).keyword);
}

function character(id, overrides = {}) {
  const record = {
    id, name: id, description: "", creator_notes: "", tags: [],
    extensions: { depth_prompt: { prompt: "", depth: 4, role: "system" } }, avatar: null, ...overrides,
  };
  return {
    ...record,
    sync: {
      schemaVersion: 4, projectionVersion: 5, revision: 7, updatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: hashCanonicalProjection(createCanonicalCharacterProjection(record)),
    },
  };
}

async function fixture(t, characters) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "sync-avatar-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const avatarsDirectory = join(dataDirectory, "avatars");
  const cardsDirectory = join(dataDirectory, "cards");
  await writeFile(join(dataDirectory, "db.json"), JSON.stringify({ characters, worldbooks: [], tagDefinitions: [] }));
  const storage = createJsonStorage({ dataDirectory });
  const service = createSyncAvatarService({
    readSnapshot: storage.readDbSnapshot,
    getCharacter: storage.getCharacterById,
    saveCharacter: storage.updateCharacter,
    avatarsDirectory,
    cardsDirectory,
  });
  return { dataDirectory, avatarsDirectory, cardsDirectory, storage, service };
}

test("a pushed avatar is stored without card chunks and leaves sync metadata alone", async (t) => {
  const f = await fixture(t, [character("hero")]);
  assert.equal(await f.service.read("hero"), null);
  const before = buildSyncManifest(await f.storage.readDbSnapshot()).characters[0];

  assert.deepEqual(await f.service.write("hero", withCardChunk(basePng, "{\"stale\":true}")), { outcome: "updated" });
  const image = await f.service.read("hero");
  assert.equal(image.type, "image/png");
  assert.deepEqual(cardKeywords(image.buffer), [], "the stale embedded card is dropped");

  const after = buildSyncManifest(await f.storage.readDbSnapshot()).characters[0];
  assert.equal(after.contentHash, before.contentHash);
  assert.equal(after.revision, before.revision, "an avatar is not a content change");
  const record = await f.storage.getCharacterById("hero");
  assert.equal(record.avatarSource, "uploaded");
  assert.equal(record.avatar, record.avatarPng);

  assert.deepEqual(await f.service.write("hero", withCardChunk(basePng, "{\"other\":true}")), { outcome: "unchanged" },
    "the same picture with other card data is not a new avatar");
  assert.equal((await readdir(f.avatarsDirectory)).length, 1);
});

test("replacing an avatar removes only the replaced files", async (t) => {
  const f = await fixture(t, [character("hero"), character("other")]);
  await f.service.write("hero", basePng);
  await f.service.write("other", basePng);
  const [first] = await readdir(f.avatarsDirectory).then((names) => names.filter((name) => name.startsWith("hero-")));

  const changed = Buffer.from(encodeChunks([...extractChunks(basePng).slice(0, -1),
    textChunk.encode("Comment", "different picture"), extractChunks(basePng).at(-1)]));
  await f.service.write("hero", changed);
  const names = await readdir(f.avatarsDirectory);
  assert.equal(names.includes(first), false);
  assert.equal(names.filter((name) => name.startsWith("other-")).length, 1);
});

test("reads fall back to the imported card file and reject unknown characters", async (t) => {
  const f = await fixture(t, [character("imported", { sourceType: "png", fileName: "card.png" })]);
  await mkdir(f.cardsDirectory, { recursive: true });
  await writeFile(join(f.cardsDirectory, "card.png"), basePng);
  assert.deepEqual((await f.service.read("imported")).buffer, basePng);
  await assert.rejects(f.service.read("missing"), SyncWriteNotFoundError);
  await assert.rejects(f.service.write("missing", basePng), SyncWriteNotFoundError);
  await assert.rejects(f.service.write("imported", Buffer.from([0xff, 0xd8, 0xff, 0x00])), SyncWriteValidationError);
});

test("the sync API serves and accepts avatars", async (t) => {
  const f = await fixture(t, [character("hero"), character("plain")]);
  const app = express();
  app.use("/api/sync/v1", createSyncRouter({
    readSnapshot: f.storage.readDbSnapshot,
    writeService: createSyncWriteService({ mutateLibrary: f.storage.mutateLibrary }),
    avatarService: f.service,
  }));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}/api/sync/v1/characters`;

  const put = await fetch(`${base}/hero/avatar`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: basePng });
  assert.deepEqual(await put.json(), { apiVersion: "sync/v1", avatar: { outcome: "updated" } });

  const get = await fetch(`${base}/hero/avatar`);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/png");
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.ok(Buffer.from(await get.arrayBuffer()).equals(basePng));

  const none = await fetch(`${base}/plain/avatar`);
  assert.equal(none.status, 404);
  assert.equal((await none.json()).error.code, "sync_avatar_not_found");
  assert.equal((await fetch(`${base}/missing/avatar`)).status, 404);

  const wrongType = await fetch(`${base}/hero/avatar`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(wrongType.status, 400);
});

test("the manifest carries a plain-text creator notes preview", () => {
  const long = "word ".repeat(100);
  const manifest = buildSyncManifest({
    characters: [
      character("html", { creator_notes: "<p>Made by <b>me</b> &amp; friends</p>\n\n<br>Second&nbsp;line" }),
      character("long", { creator_notes: long }),
      character("empty"),
    ],
    worldbooks: [],
    tagDefinitions: [],
  });
  const byId = Object.fromEntries(manifest.characters.map((entry) => [entry.id, entry]));
  assert.equal(byId.html.creatorNotes, "Made by me & friends Second line");
  assert.equal(Array.from(byId.long.creatorNotes).length, 160);
  assert.ok(byId.long.creatorNotes.endsWith("…"));
  assert.equal(Object.hasOwn(byId.empty, "creatorNotes"), false);
});
