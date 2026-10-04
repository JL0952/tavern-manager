import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRelayStore,
  RelayConflictError,
  RelayNotFoundError,
  RelayValidationError,
} from "../services/relayStore.js";

const hash = (digit) => `sha256:${digit.repeat(64)}`;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "relay-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let tick = 0;
  const store = createRelayStore({ directory, now: () => new Date(Date.UTC(2026, 9, 3, 0, 0, tick++)) });
  return { directory, store };
}

async function storedFiles(directory, type) {
  return (await readdir(join(directory, type))).sort();
}

test("a file is kept byte for byte, listed by name, and never parsed", async (t) => {
  const { store } = await fixture(t);
  // Formatting, key order and even invalid JSON are the uploader's business.
  const contents = Buffer.from('{ "b": 1,\n  "a": [ 2 ] }\n');
  const { outcome, item } = await store.save("presets", {
    name: "三人逆行 v12.0", contents, contentHash: hash("a"), source: "sillytavern" });
  assert.equal(outcome, "created");
  assert.deepEqual(Object.keys(item).sort(),
    ["contentHash", "createdAt", "id", "name", "sha256", "size", "source", "type", "updatedAt"]);
  assert.equal(item.size, contents.length);
  assert.match(item.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual((await store.read("presets", item.id)).contents, contents);

  await store.save("presets", { name: "not json", contents: Buffer.from("{oops"), contentHash: hash("b") });
  assert.deepEqual((await store.list("presets")).map((entry) => entry.name), ["not json", "三人逆行 v12.0"]);
  assert.deepEqual(await store.list("themes"), []);
});

test("a same-name file is refused, replaced in place, or kept beside a renamed copy", async (t) => {
  const { directory, store } = await fixture(t);
  const first = (await store.save("themes", { name: "Night", contents: Buffer.from("1"), contentHash: hash("1") })).item;

  await assert.rejects(store.save("themes", { name: "Night", contents: Buffer.from("2"), contentHash: hash("2") }),
    (error) => error instanceof RelayConflictError && error.item.id === first.id);

  const replaced = await store.save("themes", {
    name: "Night", contents: Buffer.from("3"), contentHash: hash("3"), onConflict: "replace" });
  assert.equal(replaced.outcome, "replaced");
  assert.equal(replaced.item.id, first.id);
  assert.equal(replaced.item.createdAt, first.createdAt);
  assert.notEqual(replaced.item.updatedAt, first.updatedAt);
  assert.equal((await store.read("themes", first.id)).contents.toString(), "3");
  assert.equal((await storedFiles(directory, "themes")).length, 1, "the replaced file is removed");

  const renamed = await store.save("themes", {
    name: "Night", contents: Buffer.from("4"), contentHash: hash("4"), onConflict: "rename" });
  assert.equal(renamed.outcome, "renamed");
  assert.equal(renamed.item.name, "Night (2)");
  assert.equal((await store.save("themes", {
    name: "Night", contents: Buffer.from("5"), contentHash: hash("5"), onConflict: "rename" })).item.name, "Night (3)");
  // The same name under another type is a different file.
  assert.equal((await store.save("regex", { name: "Night", contents: Buffer.from("6"), contentHash: hash("6") })).outcome, "created");
});

test("delete removes the file and its index entry; unknown ids are not found", async (t) => {
  const { directory, store } = await fixture(t);
  const { item } = await store.save("regex", { name: "Trim", contents: Buffer.from("{}"), contentHash: hash("c") });
  await store.remove("regex", item.id);
  assert.deepEqual(await store.list("regex"), []);
  assert.deepEqual(await storedFiles(directory, "regex"), []);
  await assert.rejects(store.remove("regex", item.id), RelayNotFoundError);
  await assert.rejects(store.read("regex", item.id), RelayNotFoundError);
  await assert.rejects(store.read("presets", "missing"), RelayNotFoundError);
});

test("names, types, hashes, sources and empty files are validated before anything is written", async (t) => {
  const { directory, store } = await fixture(t);
  const valid = { name: "Ok", contents: Buffer.from("{}"), contentHash: hash("d") };
  for (const [type, overrides] of [
    ["styles", {}],
    ["presets", { name: "" }],
    ["presets", { name: "a\nb" }],
    ["presets", { name: "x".repeat(513) }],
    ["presets", { name: 7 }],
    ["presets", { contents: Buffer.alloc(0) }],
    ["presets", { contents: "{}" }],
    ["presets", { contentHash: "md5:abc" }],
    ["presets", { contentHash: undefined }],
    ["presets", { source: "web" }],
    ["presets", { onConflict: "merge" }],
  ]) {
    assert.throws(() => store.save(type, { ...valid, ...overrides }), RelayValidationError, JSON.stringify(overrides));
  }
  assert.deepEqual(await readdir(directory), [], "no index or type folder was created");
});

test("the index survives a new store, and concurrent saves of one name never both create", async (t) => {
  const { directory, store } = await fixture(t);
  const results = await Promise.allSettled(["1", "2", "3"].map((digit) =>
    store.save("presets", { name: "Same", contents: Buffer.from(digit), contentHash: hash(digit) })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.reason instanceof RelayConflictError).length, 2);

  const reopened = createRelayStore({ directory });
  assert.deepEqual((await reopened.list("presets")).map((entry) => entry.name), ["Same"]);
  assert.equal(await reopened.count(), 1);
  const index = JSON.parse(await readFile(join(directory, "index.json"), "utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.match(index.items[0].file, /^[0-9a-f-]{36}\.json$/);
});
