import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { extractZip, listZipEntries, writeZip } from "../services/backupZip.js";
import { getCrc32 } from "../services/zipExport.js";

const run = promisify(execFile);
const hasZipTools = existsSync("/usr/bin/zip") && existsSync("/usr/bin/unzip");

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "backup-zip-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// A data folder shaped like Manager's, with compressible and binary files.
async function dataFolder(directory) {
  const files = {
    "db.json": JSON.stringify({ characters: [], worldbooks: [], note: "x".repeat(5000) }),
    "cards/角色 一.png": Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 7919) % 256)),
    "relay/presets/a.json": '{\n    "temperature": 1\n}',
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(directory, name, ".."), { recursive: true });
    await writeFile(join(directory, name), contents);
  }
  await mkdir(join(directory, "avatars"));
  return files;
}

// A stored zip with any entry names, for archives this app would never write.
function handMadeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const fields = Buffer.alloc(26);
    fields.writeUInt16LE(20, 0); fields.writeUInt16LE(0x0800, 2); fields.writeUInt32LE(getCrc32(data), 10);
    fields.writeUInt32LE(data.length, 14); fields.writeUInt32LE(data.length, 18); fields.writeUInt16LE(nameBytes.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), fields, nameBytes, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); fields.copy(central, 6, 0, 26);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("a backup zip extracts back to the same files, folders included, without zip tools", async (t) => {
  const source = await temporaryDirectory(t);
  const files = await dataFolder(source);
  const zipPath = join(source, "..", `${basename(source)}.zip`);
  t.after(() => rm(zipPath, { force: true }));

  await writeZip(zipPath, source, ["db.json", "cards", "worldbooks", "avatars", "relay"]);
  assert.deepEqual(await listZipEntries(zipPath), [
    "db.json", "cards/", "cards/角色 一.png", "avatars/", "relay/", "relay/presets/", "relay/presets/a.json",
  ], "a missing target is left out");

  const target = await temporaryDirectory(t);
  await extractZip(zipPath, target);
  for (const [name, contents] of Object.entries(files)) {
    assert.deepEqual(await readFile(join(target, name)), Buffer.from(contents), name);
  }
  assert.ok(existsSync(join(target, "avatars")), "an empty folder is kept");
  assert.ok((await readFile(zipPath)).length < 5000, "text is compressed");
});

test("backups made with zip tools still restore, and zip tools read the new backups", { skip: !hasZipTools && "zip tools not installed" }, async (t) => {
  const source = await temporaryDirectory(t);
  const files = await dataFolder(source);

  const oldBackup = join(source, "old.zip");
  await run("/usr/bin/zip", ["-qr", oldBackup, "db.json", "cards", "avatars", "relay"], { cwd: source });
  const restored = await temporaryDirectory(t);
  await extractZip(oldBackup, restored);
  for (const [name, contents] of Object.entries(files)) {
    assert.deepEqual(await readFile(join(restored, name)), Buffer.from(contents), name);
  }

  const newBackup = join(source, "new.zip");
  await writeZip(newBackup, source, ["db.json", "cards", "avatars", "relay"]);
  const { stdout } = await run("/usr/bin/unzip", ["-t", newBackup]);
  assert.match(stdout, /No errors detected/);
});

test("damaged, foreign and escaping archives are refused", async (t) => {
  const directory = await temporaryDirectory(t);
  const source = join(directory, "source");
  await mkdir(source);
  await dataFolder(source);

  const zipPath = join(directory, "damaged.zip");
  await writeZip(zipPath, source, ["relay"]);
  const bytes = await readFile(zipPath);
  const data = bytes.indexOf(Buffer.from('{\n    "temperature"'));
  bytes[data + 5] ^= 0xff;
  await writeFile(zipPath, bytes);
  await assert.rejects(extractZip(zipPath, join(directory, "out-damaged")), /damaged/);

  await writeFile(join(directory, "not.zip"), "just text");
  await assert.rejects(listZipEntries(join(directory, "not.zip")), /Not a zip file/);

  await writeFile(join(directory, "escape.zip"), handMadeZip([["../escaped.txt", "nope"]]));
  await assert.rejects(extractZip(join(directory, "escape.zip"), join(directory, "out")), /outside the extraction folder/);
  assert.equal(existsSync(join(directory, "escaped.txt")), false);

  // A name that only starts with two dots is still inside.
  await writeFile(join(directory, "dots.zip"), handMadeZip([["..notes.txt", "fine"]]));
  await extractZip(join(directory, "dots.zip"), join(directory, "dots"));
  assert.equal(await readFile(join(directory, "dots", "..notes.txt"), "utf8"), "fine");
});

test("backup routes run no external zip programs", async () => {
  const source = await readFile(new URL("../routes/backup.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /child_process|\/usr\/bin|execFile/);
});
