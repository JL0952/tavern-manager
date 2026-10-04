import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import localClients, { isThisComputer } from "../middleware/localClients.js";
import { isLocalNetworkAddress } from "../middleware/syncCors.js";

test("loopback, private and link-local peers are local; public and malformed addresses are not", () => {
  for (const address of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.1.1",
    "::1", "::ffff:127.0.0.1", "::ffff:192.168.1.20", "::FFFF:10.1.2.3", "fd12:3456::1", "fc00::1", "fe80::1",
    "fe80::1%en0", "FE80::abcd"]) {
    assert.equal(isLocalNetworkAddress(address), true, address);
  }

  for (const address of ["8.8.8.8", "100.64.0.1", "172.32.0.1", "192.169.0.1", "2607:f8b0::1", "::ffff:8.8.8.8",
    "::ffff:c0a8:114", "fec0::1", "ff02::1", "::", "0.0.0.0", "", "localhost", undefined, null]) {
    assert.equal(isLocalNetworkAddress(address), false, String(address));
  }
});

function run(remoteAddress) {
  let status = 200;
  let passed = false;
  const response = { status(code) { status = code; return this; }, json() { return this; } };
  localClients({ socket: { remoteAddress }, get: () => "8.8.8.8" }, response, () => { passed = true; });
  return { status, passed };
}

test("a peer outside the local network is refused whatever it claims in headers", () => {
  assert.deepEqual(run("2607:f8b0::1"), { status: 403, passed: false });
  assert.deepEqual(run("203.0.113.9"), { status: 403, passed: false });
  assert.deepEqual(run("::ffff:192.168.1.20"), { status: 200, passed: true });
  assert.deepEqual(run("::1"), { status: 200, passed: true });
});

test("a real loopback connection gets through", async () => {
  const app = express();
  app.use(localClients);
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/health`, {
      headers: { "X-Forwarded-For": "8.8.8.8" },
    });
    assert.equal(response.status, 200);
  } finally {
    listener.close();
  }
});

test("app.js checks the peer address before every other middleware", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.equal(source.indexOf("app.use(localClients)"), source.indexOf("app.use("));
});

test("this computer is loopback or one of its own addresses, however Node spells them", () => {
  const interfaces = {
    lo0: [{ address: "127.0.0.1" }, { address: "::1" }],
    en0: [{ address: "192.168.1.20" }, { address: "fe80::1c2b:3d4e:5f60:7182", scopeid: 4 }, { address: "fd12:3456::20" }],
  };

  for (const address of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1", "192.168.1.20", "::ffff:192.168.1.20",
    "fe80::1c2b:3d4e:5f60:7182%en0", "FD12:3456::20"]) {
    assert.equal(isThisComputer(address, interfaces), true, address);
  }

  for (const address of ["192.168.1.21", "::ffff:192.168.1.21", "fd12:3456::21", "10.0.0.1", "", undefined, null]) {
    assert.equal(isThisComputer(address, interfaces), false, String(address));
  }
});
