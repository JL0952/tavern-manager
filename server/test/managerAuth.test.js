import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createManagerAuth, PasswordError } from "../services/managerAuth.js";

async function authFile(t) {
  const directory = await mkdtemp(join(tmpdir(), "manager-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "auth.json");
}

test("without a password nobody signs in and no token is accepted", async (t) => {
  const auth = createManagerAuth({ file: await authFile(t) });
  assert.equal(await auth.hasPassword(), false);
  assert.equal(await auth.logIn("anything"), null);
  assert.equal(await auth.acceptsToken("anything"), false);
});

test("the right password hands out the token; only a hash is stored, readable by the owner only", async (t) => {
  const file = await authFile(t);
  const auth = createManagerAuth({ file });
  await auth.setPassword("synthetic pass");

  const token = await auth.logIn("synthetic pass");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await auth.logIn("synthetic pas"), null);
  assert.equal(await auth.logIn(""), null);
  assert.equal(await auth.logIn(undefined), null);
  assert.equal(await auth.acceptsToken(token), true);
  assert.equal(await auth.acceptsToken(`${token}x`), false);
  assert.equal(await auth.acceptsToken(undefined), false);

  const stored = await readFile(file, "utf8");
  assert.doesNotMatch(stored, /synthetic pass/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const restarted = createManagerAuth({ file });
  assert.equal(await restarted.acceptsToken(token), true, "a restart keeps devices signed in");
});

test("changing or removing the password signs every device out", async (t) => {
  const file = await authFile(t);
  const auth = createManagerAuth({ file });
  await auth.setPassword("first password");
  const first = await auth.logIn("first password");

  await auth.setPassword("second password");
  assert.equal(await auth.acceptsToken(first), false);
  assert.equal(await auth.logIn("first password"), null);
  const second = await auth.logIn("second password");
  assert.notEqual(second, first);

  await auth.removePassword();
  assert.equal(await auth.hasPassword(), false);
  assert.equal(await auth.acceptsToken(second), false);
  await assert.rejects(readFile(file), { code: "ENOENT" });
});

test("a short password is refused and a damaged file means no password", async (t) => {
  const file = await authFile(t);
  const auth = createManagerAuth({ file });
  await assert.rejects(auth.setPassword("12345"), PasswordError);
  await assert.rejects(auth.setPassword(123456), PasswordError);
  assert.equal(await auth.hasPassword(), false);

  await writeFile(file, "{ not json");
  const damaged = createManagerAuth({ file });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await damaged.hasPassword(), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(await damaged.acceptsToken(""), false);
});
