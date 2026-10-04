// Only this computer and the local network may connect; a peer from anywhere
// else (a public IPv6 address, a forwarded port) is refused before it reaches
// anything. Other devices on the network still need the Manager password
// (requirePassword.js). The socket's own address is used, never
// X-Forwarded-For, which any client can send.
import { networkInterfaces } from "node:os";
import { isLocalNetworkAddress } from "./syncCors.js";

// One spelling per address: no IPv4-mapped prefix, no IPv6 zone.
function plainAddress(address) {
  return address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1").replace(/%.*$/, "").toLowerCase();
}

// Loopback, or one of this computer's own addresses: opening Manager by the
// computer's network address from the computer itself is still local.
export function isThisComputer(address, interfaces = networkInterfaces()) {
  if (typeof address !== "string" || !address) {
    return false;
  }

  const plain = plainAddress(address);

  if (plain === "::1" || /^127\.\d+\.\d+\.\d+$/.test(plain)) {
    return true;
  }

  return Object.values(interfaces).flat().some((entry) => entry && plainAddress(entry.address) === plain);
}

export default function localClients(request, response, next) {
  if (isLocalNetworkAddress(request.socket.remoteAddress)) {
    return next();
  }

  return response.status(403).json({
    error: "Tavern Manager only accepts connections from this computer or the local network.",
  });
}
