import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import localWrites from "../middleware/localWrites.js";

async function server() {
  const writes = [];
  const app = express();
  app.use(localWrites);
  app.get("/api/cards", (_request, response) => response.json([]));
  app.post("/api/backup/import", (request, response) => {
    writes.push(request.get("Origin") ?? null);
    response.json({ ok: true });
  });
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const base = `http://127.0.0.1:${listener.address().port}`;
  return { base, writes, close: () => listener.close() };
}

test("internet pages cannot submit preflight-free writes", async () => {
  const { base, writes, close } = await server();
  try {
    const form = new FormData();
    form.append("file", new Blob(["PK"]), "backup.zip");
    const bodies = [form, new URLSearchParams({ newName: "x" }), "text"];

    for (const body of bodies) {
      for (const fetchSite of [undefined, "cross-site"]) {
        const response = await fetch(`${base}/api/backup/import`, {
          method: "POST",
          headers: { Origin: "https://evil.example", ...(fetchSite ? { "Sec-Fetch-Site": fetchSite } : {}) },
          body,
        });
        assert.equal(response.status, 403);
      }
    }

    const opaque = await fetch(`${base}/api/backup/import`, { method: "POST", headers: { Origin: "null" } });
    assert.equal(opaque.status, 403);
    assert.deepEqual(writes, [], "a refused write never reaches the route");
  } finally {
    close();
  }
});

test("the Manager page, local-network pages, and non-browser clients may write; reads are unchanged", async () => {
  const { base, writes, close } = await server();
  try {
    const allowed = [
      { Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-origin" },
      { Origin: "http://100.64.1.2:5173", "Sec-Fetch-Site": "same-origin" },
      { Origin: "http://192.168.1.20:5173" },
      { Origin: "http://127.0.0.1:8000", "Sec-Fetch-Site": "same-site" },
      {},
    ];

    for (const headers of allowed) {
      const response = await fetch(`${base}/api/backup/import`, { method: "POST", headers });
      assert.equal(response.status, 200, JSON.stringify(headers));
    }

    assert.equal(writes.length, allowed.length);

    const read = await fetch(`${base}/api/cards`, { headers: { Origin: "https://evil.example" } });
    assert.equal(read.status, 200);
  } finally {
    close();
  }
});

test("app.js guards writes before any body parser and accepts no urlencoded bodies", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(source.indexOf("app.use(localWrites)") !== -1);
  assert.ok(source.indexOf("app.use(localWrites)") < source.indexOf("express.json("));
  assert.doesNotMatch(source, /express\.urlencoded/);
});
