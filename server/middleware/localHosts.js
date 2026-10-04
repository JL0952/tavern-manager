// Requests must name Manager by localhost, an IP address or a .local name.
// A DNS-rebinding page reaches 127.0.0.1 under its own domain, so the browser
// treats it as same-origin and sends that domain as Host; refusing unknown
// hosts keeps such a page from reading or changing the library. IP literals
// are always accepted because rebinding cannot produce one.
import { isIP } from "node:net";

export function isLocalHost(host) {
  if (typeof host !== "string" || !host) {
    return false;
  }

  let hostname;

  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }

  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isIP(hostname.replace(/^\[(.*)\]$/, "$1")) !== 0
  );
}

export default function localHosts(request, response, next) {
  if (isLocalHost(request.get("Host"))) {
    return next();
  }

  return response.status(403).json({
    error: "Open Tavern Manager by localhost, an IP address or a .local name.",
  });
}
