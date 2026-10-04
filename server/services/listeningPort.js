import { connect } from "node:net";

const loopbackAddresses = ["127.0.0.1", "::1"];

function acceptsConnection(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (accepted) => {
      socket.destroy();
      resolve(accepted);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// The first loopback address where something already accepts connections on
// `port`, or null. macOS lets an IPv4 and an IPv6 server share one port, so a
// bind alone does not reveal a server still running on the other family.
export async function findListeningAddress(port, { addresses = loopbackAddresses, timeoutMs = 500 } = {}) {
  for (const address of addresses) {
    if (await acceptsConnection(address, port, timeoutMs)) {
      return address;
    }
  }

  return null;
}
