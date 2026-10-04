import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createRequirePassword } from "../middleware/requirePassword.js";
import { createAuthRouter } from "../routes/auth.js";
import { createManagerAuth } from "../services/managerAuth.js";

// Every test connection comes from 127.0.0.1, so a header stands in for
// "another device" here.
const isLocal = (request) => request.get("X-Test-Device") !== "other";
const other = { "X-Test-Device": "other" };
const json = { "Content-Type": "application/json" };

async function server(t, { now } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "manager-auth-route-"));
  const auth = createManagerAuth({ file: join(directory, "auth.json") });
  const routed = [];
  const app = express();
  app.use(createRequirePassword({ auth, isLocal }));
  app.use(express.json());
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.use("/api/auth", createAuthRouter({ auth, isLocal, now }));
  app.post("/api/cards", (_request, response) => { routed.push("cards"); response.json({ ok: true }); });
  app.get("/avatars/a.png", (_request, response) => response.type("png").send("png"));
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    listener.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const call = (path, options = {}) => fetch(`${base}${path}`, options);
  return { auth, call, routed };
}

test("this computer needs no password; another device is refused until a password is set", async (t) => {
  const { call, routed } = await server(t);

  assert.equal((await call("/api/cards", { method: "POST" })).status, 200);
  const refused = await call("/api/cards", { method: "POST", headers: other });
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error.code, "manager_password_not_set");
  assert.equal((await call("/avatars/a.png", { headers: other })).status, 401);
  assert.equal((await call("/api/health", { headers: other })).status, 200);
  assert.deepEqual(routed, ["cards"], "a refused request never reaches the route");

  const status = await (await call("/api/auth/status", { headers: other })).json();
  assert.deepEqual(status, { local: false, passwordSet: false, signedIn: false });
  const login = await call("/api/auth/login", { method: "POST", headers: { ...other, ...json }, body: JSON.stringify({ password: "x" }) });
  assert.equal(login.status, 401);
});

test("only the Manager page on this computer sets or removes the password", async (t) => {
  const { call } = await server(t);
  const body = JSON.stringify({ password: "synthetic pass" });

  assert.equal((await call("/api/auth/password", { method: "PUT", headers: { ...other, ...json }, body })).status, 401);
  assert.equal((await call("/api/auth/password", { method: "PUT", headers: { ...json, Origin: "http://192.168.1.30:8000", "Sec-Fetch-Site": "cross-site" }, body })).status, 403);
  const short = await call("/api/auth/password", { method: "PUT", headers: json, body: JSON.stringify({ password: "123" }) });
  assert.equal(short.status, 400);
  assert.equal((await short.json()).error.code, "manager_password_invalid");

  const set = await call("/api/auth/password", { method: "PUT", headers: { ...json, Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-origin" }, body });
  assert.deepEqual(await set.json(), { passwordSet: true });
  assert.deepEqual(await (await call("/api/auth/status")).json(), { local: true, passwordSet: true, signedIn: true });

  const { token } = await (await call("/api/auth/login", { method: "POST", headers: { ...other, ...json }, body })).json();
  const signedIn = { ...other, "X-Manager-Token": token };
  const fromOther = await call("/api/auth/password", { method: "DELETE", headers: signedIn });
  assert.equal(fromOther.status, 403, "a signed-in device still cannot change the password");
  assert.equal((await fromOther.json()).error.code, "manager_local_only");
  assert.equal((await call("/api/auth/password", { method: "PUT", headers: { ...signedIn, ...json }, body })).status, 403);
  assert.deepEqual(await (await call("/api/auth/password", { method: "DELETE" })).json(), { passwordSet: false });
});

test("another device signs in once, then uses the token header or the session cookie", async (t) => {
  const { auth, call } = await server(t);
  await auth.setPassword("synthetic pass");

  const wrong = await call("/api/auth/login", { method: "POST", headers: { ...other, ...json }, body: JSON.stringify({ password: "nope" }) });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error.code, "manager_wrong_password");
  assert.equal((await call("/api/cards", { method: "POST", headers: other })).status, 401);

  const login = await call("/api/auth/login", { method: "POST", headers: { ...other, ...json }, body: JSON.stringify({ password: "synthetic pass" }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, new RegExp(`^tm_session=${token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  assert.equal((await call("/api/cards", { method: "POST", headers: { ...other, "X-Manager-Token": token } })).status, 200);
  assert.equal((await call("/avatars/a.png", { headers: { ...other, Cookie: `theme=dark; tm_session=${token}` } })).status, 200);
  assert.equal((await call("/api/cards", { method: "POST", headers: { ...other, "X-Manager-Token": "forged" } })).status, 401);
  assert.deepEqual(await (await call("/api/auth/status", { headers: { ...other, Cookie: `tm_session=${token}` } })).json(),
    { local: false, passwordSet: true, signedIn: true });

  await auth.setPassword("changed pass");
  const stale = await call("/api/cards", { method: "POST", headers: { ...other, "X-Manager-Token": token } });
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).error.code, "manager_password_required");
});

test("ten wrong passwords lock that device out for ten minutes", async (t) => {
  let clock = 0;
  const { auth, call } = await server(t, { now: () => clock });
  await auth.setPassword("synthetic pass");
  const attempt = (password) => call("/api/auth/login", { method: "POST", headers: { ...other, ...json }, body: JSON.stringify({ password }) });

  for (let index = 0; index < 10; index += 1) assert.equal((await attempt("wrong")).status, 403);
  const locked = await attempt("synthetic pass");
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).error.code, "manager_login_locked");

  clock += 10 * 60 * 1000 + 1;
  assert.equal((await attempt("synthetic pass")).status, 200);
});

test("app.js asks for the password after serving the page and before every library route", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const gate = source.indexOf("app.use(requirePassword)");
  assert.ok(gate > source.indexOf("app.use(express.static(pageDirectory))"));
  assert.ok(gate > source.indexOf("app.use(localWrites)"));
  for (const route of ["relayRouter", "authRouter", "cardsRouter", "backupRouter", "libraryGraphRouter", "statsRouter",
    "syncRouter", "tagsRouter", "worldbooksRouter", '"/avatars"']) {
    assert.ok(source.indexOf(route, source.indexOf("const app = express()")) > gate, route);
  }
});
