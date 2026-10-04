import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import test from "node:test";
import express from "express";
import localHosts, { isLocalHost } from "../middleware/localHosts.js";

test("localhost, IP literals and .local names are local hosts; other names are not", () => {
  for (const host of ["localhost:3000", "LOCALHOST", "manager.localhost:3000", "127.0.0.1:3000",
    "192.168.1.20:3000", "10.0.0.5", "100.64.1.2:3000", "8.8.8.8:3000", "[::1]:3000", "[fd12:3456::1]", "my-mac.local:3000"]) {
    assert.equal(isLocalHost(host), true, host);
  }

  for (const host of ["evil.example", "evil.example:3000", "127.0.0.1.nip.io", "localhost.evil.example",
    "attacker.localtest.me:3000", "local", "", undefined, "bad host", "[not-an-ip]"]) {
    assert.equal(isLocalHost(host), false, String(host));
  }
});

async function server() {
  const app = express();
  app.use(localHosts);
  app.get("/api/cards", (_request, response) => response.json([]));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  return { port: listener.address().port, close: () => listener.close() };
}

function get(port, host) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path: "/api/cards", headers: { host } }, (incoming) => {
      incoming.resume();
      incoming.on("end", () => resolve(incoming.statusCode));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("a rebound domain gets nothing, even for reads", async () => {
  const { port, close } = await server();
  try {
    assert.equal(await get(port, "evil.example:3000"), 403);
    assert.equal(await get(port, `127.0.0.1:${port}`), 200);
    assert.equal(await get(port, "192.168.1.20:3000"), 200);
    assert.equal(await get(port, "localhost:3000"), 200, "the Vite proxy rewrites Host to its target");
  } finally {
    close();
  }
});

test("app.js checks the host right after the peer address, before every other middleware", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const uses = [...source.matchAll(/app\.use\(/g)].map((match) => match.index);
  assert.equal(source.indexOf("app.use(localHosts)"), uses[1]);
});
