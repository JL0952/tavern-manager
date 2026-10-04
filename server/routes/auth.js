import { Router } from "express";
import { fromThisComputer, requestToken, sessionCookie } from "../middleware/requirePassword.js";
import { managerAuth, PasswordError } from "../services/managerAuth.js";

// Signing in from another device, and setting the password on this computer.
// Errors are { error: { code, message } }, like the sync API's.

const maxFailures = 10;
const failureWindowMs = 10 * 60 * 1000;
const cookieMaxAgeMs = 365 * 24 * 60 * 60 * 1000;

function sendError(response, status, code, message) {
  return response.status(status).json({ error: { code, message } });
}

// Only the Manager page itself, or a script without a browser, may change the
// password; another page open on this computer may not.
function fromManagerPage(request) {
  return request.get("Origin") === undefined || request.get("Sec-Fetch-Site") === "same-origin";
}

export function createAuthRouter({ auth = managerAuth, isLocal = fromThisComputer, now = () => Date.now() } = {}) {
  const router = Router();
  // Wrong passwords per address, so the password cannot be guessed at speed.
  const failures = new Map();

  function lockedOut(address) {
    const entry = failures.get(address);

    if (entry && now() - entry.since > failureWindowMs) {
      failures.delete(address);
      return false;
    }

    return (entry?.count ?? 0) >= maxFailures;
  }

  function countFailure(address) {
    const entry = failures.get(address) ?? { count: 0, since: now() };
    entry.count += 1;
    failures.set(address, entry);
  }

  function passwordChange(handler) {
    return async (request, response) => {
      if (!isLocal(request) || !fromManagerPage(request)) {
        return sendError(response, 403, "manager_local_only", "Change the password in Manager on the computer running it.");
      }

      return handler(request, response);
    };
  }

  router.get("/status", async (request, response) => {
    const local = isLocal(request);
    response.set("Cache-Control", "no-store");
    return response.json({
      local,
      passwordSet: await auth.hasPassword(),
      signedIn: local || await auth.acceptsToken(requestToken(request)),
    });
  });

  router.post("/login", async (request, response) => {
    const address = request.socket.remoteAddress;

    if (lockedOut(address)) {
      return sendError(response, 429, "manager_login_locked", "Too many wrong passwords. Try again in a few minutes.");
    }

    if (!(await auth.hasPassword())) {
      return sendError(response, 401, "manager_password_not_set", "Set a Manager password on the computer running Manager first.");
    }

    const token = await auth.logIn(request.body?.password);

    if (!token) {
      countFailure(address);
      return sendError(response, 403, "manager_wrong_password", "Wrong password.");
    }

    failures.delete(address);
    response.cookie(sessionCookie, token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: cookieMaxAgeMs });
    return response.json({ token });
  });

  router.put("/password", passwordChange(async (request, response) => {
    try {
      await auth.setPassword(request.body?.password);
      return response.json({ passwordSet: true });
    } catch (error) {
      if (error instanceof PasswordError) {
        return sendError(response, 400, "manager_password_invalid", error.message);
      }

      throw error;
    }
  }));

  router.delete("/password", passwordChange(async (_request, response) => {
    await auth.removePassword();
    return response.json({ passwordSet: false });
  }));

  return router;
}

export default createAuthRouter();
