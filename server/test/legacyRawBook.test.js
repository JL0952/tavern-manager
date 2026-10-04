import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonStorage } from "../services/jsonStorage.js";
import {
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { createWorldBookExport } from "../services/worldBookParser.js";

const legacy = {
  id: "legacy",
  name: "Legacy",
  entries: [],
  rawBook: { name: "Legacy", entries: {}, scan_depth: 3 },
};
const both = {
  id: "both",
  name: "Both",
  entries: [],
  rawWorldBook: { name: "Both", entries: {}, kept: true },
  rawBook: { name: "Both", entries: {}, stale: true },
};

test("a legacy rawBook is read as rawWorldBook, exported, and persisted by the next write", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "legacy-raw-book-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const dbPath = join(dataDirectory, "db.json");
  await writeFile(dbPath, JSON.stringify({ characters: [], worldbooks: [legacy, both], tagDefinitions: [] }));
  const storage = createJsonStorage({ dataDirectory });

  const [readLegacy, readBoth] = await storage.getWorldBooks();
  assert.deepEqual(readLegacy.rawWorldBook, legacy.rawBook);
  assert.equal(Object.hasOwn(readLegacy, "rawBook"), false);
  assert.deepEqual(readBoth.rawWorldBook, both.rawWorldBook, "an existing rawWorldBook wins");
  assert.equal(Object.hasOwn(readBoth, "rawBook"), false);
  assert.equal(JSON.parse(createWorldBookExport(readLegacy)).scan_depth, 3);

  await storage.saveWorldBook({ id: "new", name: "New", entries: [], rawWorldBook: {} });
  const stored = JSON.parse(await readFile(dbPath, "utf8"));
  assert.deepEqual(stored.worldbooks.map((book) => Object.hasOwn(book, "rawBook")), [false, false, false]);
  assert.deepEqual(stored.worldbooks[0].rawWorldBook, legacy.rawBook);
});

test("renaming rawBook changes no projection hash", async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "legacy-raw-book-hash-"));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  await writeFile(join(dataDirectory, "db.json"), JSON.stringify({ characters: [], worldbooks: [legacy], tagDefinitions: [] }));
  const [renamed] = await createJsonStorage({ dataDirectory }).getWorldBooks();

  assert.equal(
    hashCanonicalProjection(createCanonicalWorldBookProjection(renamed)),
    hashCanonicalProjection(createCanonicalWorldBookProjection(legacy)),
  );
});
