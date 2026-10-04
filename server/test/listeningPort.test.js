import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { findListeningAddress } from "../services/listeningPort.js";

function listen(options) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(options, () => resolve(server));
  });
}

test("a server on either loopback family makes the port busy; a closed port is free", async (t) => {
  const ipv4 = await listen({ host: "127.0.0.1", port: 0 });
  const { port } = ipv4.address();
  t.after(() => ipv4.close());
  assert.equal(await findListeningAddress(port), "127.0.0.1");

  let ipv6;
  try {
    ipv6 = await listen({ host: "::1", port: 0, ipv6Only: true });
  } catch {
    t.diagnostic("IPv6 loopback unavailable; IPv6-only case skipped");
  }
  if (ipv6) {
    t.after(() => ipv6.close());
    assert.equal(await findListeningAddress(ipv6.address().port), "::1");
  }

  const closed = await listen({ host: "127.0.0.1", port: 0 });
  const closedPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  assert.equal(await findListeningAddress(closedPort), null);
});
