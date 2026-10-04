// Other devices on the network must sign in with the Manager password; this
// computer never has to. A signed-in request carries the access token in the
// X-Manager-Token header (the SillyTavern extension) or in the session cookie
// (the Manager page). Signing in and the health check stay open, and the
// page's own files are served before this, so a device can reach the form.
import { isThisComputer } from "./localClients.js";
import { managerAuth } from "../services/managerAuth.js";

export const sessionCookie = "tm_session";
export const tokenHeader = "X-Manager-Token";

const openPaths = new Set(["/api/auth/status", "/api/auth/login", "/api/health"]);

function readCookie(request, name) {
  for (const part of (request.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");

    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function requestToken(request) {
  return request.get(tokenHeader) ?? readCookie(request, sessionCookie);
}

export function fromThisComputer(request) {
  return isThisComputer(request.socket.remoteAddress);
}

export function createRequirePassword({ auth = managerAuth, isLocal = fromThisComputer } = {}) {
  return async function requirePassword(request, response, next) {
    if (isLocal(request) || openPaths.has(request.path)) {
      return next();
    }

    if (await auth.acceptsToken(requestToken(request))) {
      return next();
    }

    const error = (await auth.hasPassword())
      ? { code: "manager_password_required", message: "Enter the Manager password." }
      : { code: "manager_password_not_set", message: "Set a Manager password on the computer running Manager first." };
    return response.status(401).json({ error });
  };
}

export default createRequirePassword();
