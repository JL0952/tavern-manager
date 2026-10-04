import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import express from "express";
import localWrites from "../middleware/localWrites.js";
import { relayCors } from "../middleware/syncCors.js";
import { createRelayRouter } from "../routes/relay.js";
import { createRelayStore } from "../services/relayStore.js";

const hash = (digit) => `sha256:${digit.repeat(64)}`;

async function server(t) {
  const directory = await mkdtemp(join(tmpdir(), "relay-route-"));
  // Same order as app.js: CORS, local writes, relay, then the JSON parser.
  const app = express();
  app.use("/api/relay/v1", relayCors);
  app.use(localWrites);
  app.use("/api/relay/v1", createRelayRouter({ store: createRelayStore({ directory }) }));
  app.use(express.json());
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    listener.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${listener.address().port}/api/relay/v1`;
  const upload = (type, name, body, { onConflict, headers = {} } = {}) =>
    fetch(`${base}/${type}?name=${encodeURIComponent(name)}${onConflict ? `&onConflict=${onConflict}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Content-Hash": hash("a"), "X-Relay-Source": "sillytavern", ...headers },
      body,
    });
  return { base, directory, upload };
}

test("an upload is stored and downloaded byte for byte, even sent as JSON", async (t) => {
  const { base, upload } = await server(t);
  const body = '{\n    "temperature": 1,\n    "prompts": []\n}';
  const created = await upload("presets", "三人逆行 v12.0", body);
  assert.equal(created.status, 201);
  const { outcome, item } = await created.json();
  assert.equal(outcome, "created");
  assert.equal(item.source, "sillytavern");
  assert.equal(item.contentHash, hash("a"));

  const download = await fetch(`${base}/presets/${item.id}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), body);
  assert.equal(download.headers.get("content-type"), "application/json");
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("content-disposition"),
    `attachment; filename="____ v12.0.json"; filename*=UTF-8''${encodeURIComponent("三人逆行 v12.0.json")}`);

  const listed = await (await fetch(`${base}/presets`)).json();
  assert.deepEqual(listed, { apiVersion: "relay/v1", type: "presets", items: [item] });
});

test("a same-name upload answers 409 with the existing file until replace or rename is chosen", async (t) => {
  const { upload } = await server(t);
  const first = (await (await upload("themes", "Night", '{"a":1}')).json()).item;

  const conflict = await upload("themes", "Night", '{"a":2}');
  assert.equal(conflict.status, 409);
  const { error } = await conflict.json();
  assert.equal(error.code, "relay_name_conflict");
  assert.equal(error.existing.id, first.id);

  const replaced = await upload("themes", "Night", '{"a":3}', { onConflict: "replace" });
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).item.id, first.id);
  const renamed = await upload("themes", "Night", '{"a":4}', { onConflict: "rename" });
  assert.equal(renamed.status, 201);
  assert.equal((await renamed.json()).item.name, "Night (2)");
});

test("bad requests, unknown types, unknown ids and oversized files are refused clearly", async (t) => {
  const { base, upload } = await server(t);
  for (const response of [
    await upload("presets", "Missing hash", "{}", { headers: { "X-Content-Hash": "" } }),
    await upload("presets", "", "{}"),
    await upload("presets", "Empty", ""),
    await upload("presets", "Odd choice", "{}", { onConflict: "merge" }),
    await upload("styles", "Wrong type", "{}"),
    await fetch(`${base}/styles`),
  ]) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "relay_invalid_request");
  }
  for (const response of [await fetch(`${base}/presets/missing`), await fetch(`${base}/presets/missing`, { method: "DELETE" })]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "relay_not_found");
  }
  const tooLarge = await upload("presets", "Huge", Buffer.alloc(21 * 1024 * 1024, 32));
  assert.equal(tooLarge.status, 413);
  assert.deepEqual((await tooLarge.json()).error, { code: "relay_too_large", message: "A relay file can be at most 20mb." });
});

test("selected files download as one zip with their names; missing ones are listed", async (t) => {
  const { base, directory, upload } = await server(t);
  const a = (await (await upload("regex", "Trim spaces", '{"scriptName":"Trim spaces"}')).json()).item;
  const b = (await (await upload("regex", "a..b", '{"scriptName":"a..b"}')).json()).item;
  const response = await fetch(`${base}/regex/archive`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [a.id, b.id, "gone"] }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /tavern-manager-regex-\d{8}-\d{6}\.zip/);
  const zipPath = join(directory, "download.zip");
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  const run = promisify(execFile);
  const { stdout } = await run("/usr/bin/unzip", ["-Z", "-1", zipPath]);
  assert.deepEqual(stdout.trim().split("\n").sort(), ["EXPORT_ERRORS.txt", "Trim spaces.json", "a.b.json"]);
  assert.equal((await run("/usr/bin/unzip", ["-p", zipPath, "Trim spaces.json"])).stdout, '{"scriptName":"Trim spaces"}');
  assert.match((await run("/usr/bin/unzip", ["-p", zipPath, "EXPORT_ERRORS.txt"])).stdout, /gone: no longer in Manager/);

  const none = await fetch(`${base}/regex/archive`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["gone"] }) });
  assert.equal(none.status, 500);
  const empty = await fetch(`${base}/regex/archive`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [] }) });
  assert.equal(empty.status, 400);
});

test("delete removes a file from the list and from downloads", async (t) => {
  const { base, upload } = await server(t);
  const { item } = await (await upload("presets", "Old", "{}")).json();
  assert.equal((await fetch(`${base}/presets/${item.id}`, { method: "DELETE" })).status, 204);
  assert.deepEqual((await (await fetch(`${base}/presets`)).json()).items, []);
  assert.equal((await fetch(`${base}/presets/${item.id}`)).status, 404);
});

test("SillyTavern and TauriTavern pages may upload with the relay headers; internet pages may not", async (t) => {
  const { base, upload } = await server(t);
  for (const origin of ["http://127.0.0.1:8000", "tauri://localhost"]) {
    const preflight = await fetch(`${base}/presets`, { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-content-hash,x-relay-source" } });
    assert.equal(preflight.status, 204, origin);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Content-Type, X-Content-Hash, X-Relay-Source, X-Manager-Token");
    const created = await upload("presets", `From ${origin}`, "{}", { headers: { Origin: origin } });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("access-control-allow-origin"), origin);
  }

  const refused = await fetch(`${base}/presets`, { method: "OPTIONS", headers: {
    Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  assert.equal(refused.status, 403);
  const write = await upload("presets", "Evil", "{}", { headers: { Origin: "https://evil.example" } });
  assert.equal(write.status, 403, "local writes refuse internet pages before the file is read");
  assert.deepEqual((await (await fetch(`${base}/presets`)).json()).items.map((item) => item.name).sort(),
    ["From http://127.0.0.1:8000", "From tauri://localhost"]);
});

test("app.js puts relay CORS before local writes, and the relay router before the JSON parser", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const at = (text) => {
    const index = source.indexOf(text);
    assert.notEqual(index, -1, text);
    return index;
  };
  assert.ok(at('app.use("/api/relay/v1", relayCors)') < at("app.use(localWrites)"));
  assert.ok(at("app.use(localWrites)") < at('app.use("/api/relay/v1", relayRouter)'));
  assert.ok(at('app.use("/api/relay/v1", relayRouter)') < at("app.use(express.json("));
});
