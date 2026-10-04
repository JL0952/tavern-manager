import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import syncCors, { isLocalNetworkOrigin } from "../middleware/syncCors.js";

async function server() {
  // Same mount order as app.js: CORS on the sync path only, before body parsing.
  const app = express();
  app.use("/api/sync/v1", syncCors);
  app.use(express.json());
  app.get("/api/sync/v1/manifest", (_request, response) => response.json({ ok: true }));
  app.put("/api/sync/v1/characters/:id", (request, response) => response.json({ body: request.body }));
  app.get("/api/cards", (_request, response) => response.json([]));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const base = `http://127.0.0.1:${listener.address().port}`;
  return { base, close: () => listener.close() };
}

test("only local-network page origins qualify; internet names and malformed origins do not", () => {
  for (const origin of ["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000", "http://192.168.1.20:8000",
    "http://10.0.0.5:8000", "http://172.20.3.4:8000", "http://169.254.1.1:8000", "https://192.168.1.20",
    "http://[fd12:3456::1]:8000", "http://[fe80::1]:8000", "http://my-mac.local:8000",
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
    assert.equal(isLocalNetworkOrigin(origin), true, origin);
  }
  for (const origin of ["https://evil.example", "http://attacker.localtest.me:8000", "http://8.8.8.8:8000",
    "http://172.32.0.1:8000", "http://100.64.0.1:8000", "http://192.168.1.20:8000/path", "null", "file://", "ftp://127.0.0.1",
    "tauri://evil.example", "tauri://localhost/", "tauri://localhost:8000", "http://tauri.localhost.evil.example",
    "http://evil.tauri.localhost"]) {
    assert.equal(isLocalNetworkOrigin(origin), false, origin);
  }
});

test("sync preflight from a LAN SillyTavern page is answered with that exact origin, never a wildcard", async () => {
  const { base, close } = await server();
  try {
    const response = await fetch(`${base}/api/sync/v1/characters/abc`, { method: "OPTIONS", headers: {
      Origin: "http://192.168.1.20:8000", "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type", "Access-Control-Request-Private-Network": "true" } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://192.168.1.20:8000");
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, PUT");
    assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type, X-Manager-Token");
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    assert.match(response.headers.get("vary"), /Origin/);

    const put = await fetch(`${base}/api/sync/v1/characters/abc`, { method: "PUT",
      headers: { Origin: "http://127.0.0.1:8000", "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: 1 }) });
    assert.equal(put.headers.get("access-control-allow-origin"), "http://127.0.0.1:8000");
    assert.deepEqual(await put.json(), { body: { baseRevision: 1 } });
  } finally {
    close();
  }
});

test("the TauriTavern app's page origin gets the same exact-origin grant as a LAN page", async () => {
  const { base, close } = await server();
  try {
    for (const origin of ["tauri://localhost", "http://tauri.localhost"]) {
      const preflight = await fetch(`${base}/api/sync/v1/characters/abc`, { method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
      assert.equal(preflight.status, 204, origin);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      const read = await fetch(`${base}/api/sync/v1/manifest`, { headers: { Origin: origin } });
      assert.equal(read.headers.get("access-control-allow-origin"), origin);
    }
  } finally {
    close();
  }
});

test("internet origins get no CORS grant; requests without Origin and other routes are unchanged", async () => {
  const { base, close } = await server();
  try {
    const preflight = await fetch(`${base}/api/sync/v1/manifest`, { method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);

    const read = await fetch(`${base}/api/sync/v1/manifest`, { headers: { Origin: "https://evil.example" } });
    assert.equal(read.status, 200, "non-browser semantics are unchanged; the browser withholds the body");
    assert.equal(read.headers.get("access-control-allow-origin"), null);

    const plain = await fetch(`${base}/api/sync/v1/manifest`);
    assert.deepEqual(await plain.json(), { ok: true });
    assert.equal(plain.headers.get("access-control-allow-origin"), null);

    const other = await fetch(`${base}/api/cards`, { headers: { Origin: "http://127.0.0.1:8000" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    close();
  }
});

test("app.js mounts the CORS middleware on /api/sync/v1 only", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/app\.use\(([^,]+),\s*syncCors\)/g)].map((match) => match[1]), ['"/api/sync/v1"']);
  assert.ok(source.indexOf("syncCors)") < source.indexOf("express.json("), "CORS runs before body parsing");
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
});
