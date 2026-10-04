// CORS for the two APIs the SillyTavern extension calls directly from the
// browser: /api/sync/v1 and /api/relay/v1. Manager's access model is the
// trusted LAN, so a page served from the local network (localhost, a
// loopback/private/link-local IP literal, or a .local mDNS name) or by a
// TauriTavern app may read their responses. Internet origins stay blocked by
// the browser exactly as before. No wildcard, no credentials, no
// configuration, and no other Manager route is affected.

// TauriTavern, like any Tauri app, serves its page from tauri://localhost
// (macOS, iOS, Linux) or http(s)://tauri.localhost (Windows, Android). Only an
// app installed on a device sends these; no internet page can.
const tauriOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);

function isLocalIPv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return false;
  }

  const [first, second] = parts.map(Number);
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isLocalIPv6(hostname) {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) {
    return false;
  }

  const address = hostname.slice(1, -1).toLowerCase();
  // Loopback, unique local fc00::/7, link-local fe80::/10.
  return address === "::1" || /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address);
}

export function isLocalNetworkOrigin(origin) {
  // tauri: is not a special URL scheme, so its URL origin is "null".
  if (tauriOrigins.has(origin)) {
    return true;
  }

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // Browsers send a serialized origin; anything else (paths, "null") is refused.
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
    return false;
  }

  // Public DNS names are excluded because they can be rebound to LAN addresses.
  return (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    isLocalIPv4(url.hostname) ||
    isLocalIPv6(url.hostname)
  );
}

export function createLocalNetworkCors({ methods, headers }) {
  return function localNetworkCors(request, response, next) {
    const origin = request.get("Origin");
    const allowed = origin !== undefined && isLocalNetworkOrigin(origin);

    response.vary("Origin");
    if (allowed) {
      response.set("Access-Control-Allow-Origin", origin);
    }

    const isPreflight = request.method === "OPTIONS" && origin !== undefined && request.get("Access-Control-Request-Method");
    if (!isPreflight) {
      return next();
    }

    if (!allowed) {
      return response.status(403).json({ error: "Only local-network pages may use this API cross-origin." });
    }

    response.set({
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": headers,
      "Access-Control-Max-Age": "600",
    });
    // Chromium Private Network Access preflights from a LAN page.
    if (request.get("Access-Control-Request-Private-Network") === "true") {
      response.set("Access-Control-Allow-Private-Network", "true");
    }
    return response.sendStatus(204);
  };
}

const syncCors = createLocalNetworkCors({ methods: "GET, POST, PUT", headers: "Content-Type" });

// Relay uploads name their file and hash in headers; Manager deletes them only
// from its own page.
export const relayCors = createLocalNetworkCors({
  methods: "GET, POST",
  headers: "Content-Type, X-Content-Hash, X-Relay-Source",
});

export default syncCors;
