import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The password other devices on the network enter to use Manager. Only its
// scrypt hash is stored, beside a random access token that the correct
// password hands out: the Manager page keeps it in a cookie, the SillyTavern
// extension sends it in a header. Changing or removing the password replaces
// the token, so every device signs in again. This computer needs neither.

const scrypt = promisify(scryptCallback);
const keyLength = 32;

export const defaultAuthFile = fileURLToPath(new URL("../../data/auth.json", import.meta.url));
export const minPasswordLength = 6;

export class PasswordError extends Error {}

function sameBytes(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value) {
  return value?.scheme === "scrypt" && ["salt", "hash", "token"].every((key) => typeof value[key] === "string" && value[key]);
}

export function createManagerAuth({ file = defaultAuthFile } = {}) {
  // undefined until read; null when no password is set.
  let record;
  let queue = Promise.resolve();

  // A missing or unreadable file means no password, so other devices stay out
  // until one is set again.
  async function load() {
    if (record !== undefined) return record;

    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      record = isRecord(parsed) ? parsed : null;
    } catch (error) {
      if (error.code !== "ENOENT") console.error("Manager password file is unreadable:", error.message);
      record = null;
    }

    return record;
  }

  function save(next) {
    const task = queue.then(async () => {
      if (next) {
        await mkdir(dirname(file), { recursive: true });
        const temporaryPath = `${file}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, file);
      } else {
        await rm(file, { force: true });
      }
      record = next;
    });
    queue = task.catch(() => {});
    return task;
  }

  async function setPassword(password) {
    if (typeof password !== "string" || [...password].length < minPasswordLength) {
      throw new PasswordError(`A password needs at least ${minPasswordLength} characters.`);
    }

    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, keyLength);
    await save({
      scheme: "scrypt",
      salt: salt.toString("base64"),
      hash: hash.toString("base64"),
      token: randomBytes(32).toString("base64url"),
    });
  }

  function removePassword() {
    return save(null);
  }

  // The access token for the right password, otherwise null.
  async function logIn(password) {
    const current = await load();

    if (!current || typeof password !== "string" || !password) {
      return null;
    }

    const hash = await scrypt(password, Buffer.from(current.salt, "base64"), keyLength);
    return sameBytes(hash, Buffer.from(current.hash, "base64")) ? current.token : null;
  }

  async function acceptsToken(token) {
    const current = await load();
    return Boolean(current && typeof token === "string" && token && sameBytes(Buffer.from(token), Buffer.from(current.token)));
  }

  async function hasPassword() {
    return Boolean(await load());
  }

  return Object.freeze({ hasPassword, setPassword, removePassword, logIn, acceptsToken });
}

export const managerAuth = createManagerAuth();
