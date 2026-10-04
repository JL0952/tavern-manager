import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isAllowedBackupEntry } from "../routes/backup.js";
import { readRelayBackup, RelayBackupError, restoreRelayBackup } from "../services/relayBackup.js";
import { createRelayStore } from "../services/relayStore.js";

const hash = `sha256:${"e".repeat(64)}`;

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// A backup's relay folder, made the way Manager itself writes one.
async function backupWith(t, files) {
  const sourceBase = await temporaryDirectory(t, "relay-backup-");
  const store = createRelayStore({ directory: join(sourceBase, "relay") });
  for (const [type, name] of files) await store.save(type, { name, contents: Buffer.from(`{"name":"${name}"}`), contentHash: hash });
  return sourceBase;
}

test("backups carry the relay folder; other paths stay refused", () => {
  for (const entry of ["relay", "relay/index.json", "relay/presets/x.json", "data/relay/themes/y.json"]) {
    assert.equal(isAllowedBackupEntry(entry), true, entry);
  }
  for (const entry of ["relayx/a.json", "relay/../db.json", "../relay/a.json", "/relay/a.json", "settings/a.json"]) {
    assert.equal(isAllowedBackupEntry(entry), false, entry);
  }
});

test("restoring a backup replaces the relay files with the backup's", async (t) => {
  const sourceBase = await backupWith(t, [["presets", "From backup"], ["regex", "Trim"]]);
  const relayBackup = await readRelayBackup(sourceBase);
  assert.equal(relayBackup.files, 2);

  const current = createRelayStore({ directory: join(await temporaryDirectory(t, "relay-current-"), "relay") });
  await current.save("themes", { name: "Current only", contents: Buffer.from("{}"), contentHash: hash });
  assert.equal(await restoreRelayBackup(relayBackup, current), 2);
  assert.deepEqual((await current.list("presets")).map((item) => item.name), ["From backup"]);
  assert.deepEqual(await current.list("themes"), []);
  const [preset] = await current.list("presets");
  assert.equal((await current.read("presets", preset.id)).contents.toString(), '{"name":"From backup"}');
});

test("a backup from before relay files leaves the current relay files alone", async (t) => {
  const sourceBase = await temporaryDirectory(t, "relay-old-backup-");
  assert.equal(await readRelayBackup(sourceBase), null);
  const current = createRelayStore({ directory: join(await temporaryDirectory(t, "relay-current-"), "relay") });
  await current.save("themes", { name: "Kept", contents: Buffer.from("{}"), contentHash: hash });
  assert.equal(await restoreRelayBackup(null, current), null);
  assert.deepEqual((await current.list("themes")).map((item) => item.name), ["Kept"]);

  await mkdir(join(sourceBase, "relay"));
  assert.deepEqual(await readRelayBackup(sourceBase), { directory: join(sourceBase, "relay"), files: 0 });
});

test("a damaged relay folder is refused before anything is restored", async (t) => {
  for (const [label, index] of [
    ["invalid JSON", "{"],
    ["unknown schema", JSON.stringify({ schemaVersion: 9, items: [] })],
    ["unknown type", JSON.stringify({ schemaVersion: 1, items: [{ type: "styles", file: `${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}.json` }] })],
    ["path outside its folder", JSON.stringify({ schemaVersion: 1, items: [{ type: "presets", file: "../../db.json" }] })],
    ["missing file", JSON.stringify({ schemaVersion: 1, items: [{ type: "presets", file: `${"b".repeat(8)}-bbbb-bbbb-bbbb-${"b".repeat(12)}.json` }] })],
  ]) {
    const sourceBase = await temporaryDirectory(t, "relay-damaged-");
    await mkdir(join(sourceBase, "relay", "presets"), { recursive: true });
    await writeFile(join(sourceBase, "relay", "index.json"), index);
    await assert.rejects(readRelayBackup(sourceBase), RelayBackupError, label);
  }
});
