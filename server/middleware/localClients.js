// Only this computer and the local network may connect. Manager has no
// password, so a peer from anywhere else (a public IPv6 address, a forwarded
// port) is refused before it reaches anything. The socket's own address is
// used, never X-Forwarded-For, which any client can send.
import { isLocalNetworkAddress } from "./syncCors.js";

export default function localClients(request, response, next) {
  if (isLocalNetworkAddress(request.socket.remoteAddress)) {
    return next();
  }

  return response.status(403).json({
    error: "Tavern Manager only accepts connections from this computer or the local network.",
  });
}
