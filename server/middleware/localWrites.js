// Writes to Manager are refused when a browser sends them from an internet
// page. HTML forms and no-cors fetches (urlencoded, multipart, text/plain)
// reach the server without a CORS preflight, so CORS alone does not stop a
// page from submitting them; the browser does, however, always attach Origin
// and Sec-Fetch-Site, which page script cannot forge. A write is accepted from
// the Manager page itself, from a local-network page (the sync trust model),
// or without Origin (curl, scripts). Reads are unaffected.
import { isLocalNetworkOrigin } from "./syncCors.js";

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export default function localWrites(request, response, next) {
  const origin = request.get("Origin");

  if (
    readMethods.has(request.method) ||
    origin === undefined ||
    request.get("Sec-Fetch-Site") === "same-origin" ||
    isLocalNetworkOrigin(origin)
  ) {
    return next();
  }

  return response.status(403).json({ error: "Only local-network pages may modify the Manager library." });
}
