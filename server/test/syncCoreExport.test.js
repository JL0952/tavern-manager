import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SYNC_CORE_FILES, SYNC_CORE_SOURCE } from "../scripts/exportSyncCore.js";
import { sha256Hex } from "../services/sha256.js";
import {
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
  stableSerialize,
} from "../services/syncProjection.js";
import { extensionRoot, needsExtension } from "./extensionRoot.js";

const nodeSha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function fixtures() {
  const character = createCanonicalCharacterProjection({
    id: "fixture", name: "Synthetic 角色 🙂", description: "Line\nbreak \u0000 control", tags: ["b", "a", "a "],
    alternate_greetings: ["second", "first"], extensions: { depth_prompt: { prompt: "Note", depth: 0, role: "user" } },
    worldBookId: "book",
  });
  const worldbook = createCanonicalWorldBookProjection({
    id: "book", name: "Synthetic lore",
    entries: [{ id: "1", keys: ["z", "a"], content: "Entry 内容", order: 3, probability: 0, depth: 0 }],
  });
  return [character, worldbook];
}

test("shared sync-core files import only each other and use no Node-only APIs", async () => {
  for (const file of SYNC_CORE_FILES) {
    const source = await readFile(join(SYNC_CORE_SOURCE, file), "utf8");
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)) {
      assert.ok(SYNC_CORE_FILES.includes(specifier.replace(/^\.\//, "")), `${file} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /\bnode:|\brequire\(|\bBuffer\b|\bprocess\./, file);
  }
});

test("the extension's sync-core is a byte-identical export of the Manager source", needsExtension, async () => {
  const exported = (await readdir(join(extensionRoot, "sync-core"))).sort();
  assert.deepEqual(exported, [...SYNC_CORE_FILES].sort(), "run `npm run sync-core:export -- <extension dir>`");
  for (const file of SYNC_CORE_FILES) {
    assert.equal(
      await readFile(join(extensionRoot, "sync-core", file), "utf8"),
      await readFile(join(SYNC_CORE_SOURCE, file), "utf8"),
      `${file} drifted; run npm run sync-core:export`,
    );
  }
});

test("pure SHA-256 matches node:crypto for vectors, block boundaries and random Unicode", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const samples = ["\ud800", "x\udc00y", "\u0000\u007f\u0080߿ࠀ￿", "🙂".repeat(70), "a".repeat(1_000_001)];
  for (let length = 0; length <= 192; length += 1) samples.push("a".repeat(length));
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let index = 0; index < 1500; index += 1) {
    samples.push(Array.from({ length: Math.floor(random() * 400) }, () => String.fromCharCode(Math.floor(random() * 0x10000))).join(""));
  }
  for (const sample of samples) assert.equal(sha256Hex(sample), nodeSha256(sample));
});

test("V5 canonical hashes keep the previous node:crypto formula in Manager and the extension copy", needsExtension, async () => {
  const extension = await import(`${extensionRoot}/sync-core/syncProjection.js`);
  for (const projection of fixtures()) {
    const expected = `sha256:${nodeSha256(stableSerialize(projection))}`;
    assert.equal(hashCanonicalProjection(projection), expected);
    assert.equal(extension.hashCanonicalProjection(projection), expected);
    assert.equal(extension.stableSerialize(projection), stableSerialize(projection));
  }
});

test("extension modules reference no Node-only globals", needsExtension, async () => {
  // The extension's own tests run in Node and are never loaded by SillyTavern.
  const files = (await readdir(extensionRoot, { recursive: true }))
    .filter((file) => file.endsWith(".js") && !file.startsWith("test/"));
  for (const file of files) {
    assert.doesNotMatch(await readFile(join(extensionRoot, file), "utf8"), /\bnode:|\brequire\(|\bBuffer\b|\bprocess\./, file);
  }
});

test("a full Push/Pull/Refresh cycle runs without Web Crypto (non-secure http LAN page)", needsExtension, async () => {
  const script = `
    delete globalThis.crypto;
    const root = process.env.EXTENSION_ROOT;
    const { createMinimalSyncService } = await import(root + "/minimal-service.js");
    const { createMinimalSillyTavernAdapter } = await import(root + "/st-adapter.js");
    const { createFileSidecarStore } = await import(root + "/sidecar-settings.js");
    const { createNativeStGateway } = await import(root + "/st-gateway.js");
    const { hashCanonicalProjection, CANONICAL_PROJECTION_VERSION } = await import(root + "/sync-core/syncProjection.js");
    const json = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    const characters = new Map([["Local.png", { data: { name: "Local", description: "from ST", extensions: {} } }]]);
    const remotes = new Map();
    let seq = 0;
    const st = async (path, { body, method = "POST" }) => {
      // Card files: HEAD tells whether one exists; avatar reads are not modelled.
      if (path.startsWith("/characters/")) {
        const exists = characters.has(decodeURIComponent(path.slice("/characters/".length)));
        return new Response(null, { status: method === "HEAD" && exists ? 200 : 404 });
      }
      const request = JSON.parse(body);
      if (path === "/api/characters/get") {
        const card = characters.get(request.avatar_url);
        return card ? json({ json_data: JSON.stringify(card) }) : json({}, 404);
      }
      if (path === "/api/characters/merge-attributes") {
        const { avatar, data, ...mirrors } = request;
        const current = characters.get(avatar);
        const merged = { ...current, ...mirrors, data: { ...current.data, ...data,
          extensions: { ...current.data.extensions, ...data.extensions } } };
        if (merged.data.extensions.world === "__@@UNSET@@__") delete merged.data.extensions.world;
        characters.set(avatar, merged);
        return json({});
      }
      if (path === "/api/characters/create") {
        characters.set(request.file_name + ".png", { data: { name: request.ch_name, extensions: {} } });
        return json(request.file_name + ".png");
      }
      if (path === "/api/worldinfo/list") return json([]);
      throw new Error("Unexpected ST path " + path);
    };
    const manager = async (url, options = {}) => {
      const path = new URL(url).pathname.replace("/api/sync/v1/", "");
      const method = options.method ?? "GET";
      if (path === "manifest") return json({ projectionVersion: CANONICAL_PROJECTION_VERSION, worldbooks: [],
        characters: [...remotes.values()].map(({ canonical, ...entity }) => ({ ...entity, displayName: canonical.card.name })) });
      if (method === "POST") {
        const canonical = JSON.parse(options.body).canonical;
        const entity = { type: "character", id: "m" + (++seq), revision: 1, canonical, contentHash: hashCanonicalProjection(canonical) };
        remotes.set(entity.id, entity);
        return json({ entity }, 201);
      }
      const id = decodeURIComponent(path.split("/")[1]);
      return remotes.has(id) ? json({ entity: remotes.get(id) }) : json({}, 404);
    };
    let stateFile = null;
    const files = async (path, options = {}) => {
      if (path === "/api/files/upload") {
        const bytes = Uint8Array.from(atob(JSON.parse(options.body).data), (character) => character.charCodeAt(0));
        stateFile = new TextDecoder().decode(bytes);
        return json({});
      }
      return stateFile === null ? json("", 404) : json(stateFile);
    };
    const service = createMinimalSyncService({ fetch: manager,
      sidecarStore: createFileSidecarStore({ fetch: files, requestHeaders: () => ({}) }) });
    const adapter = createMinimalSillyTavernAdapter(createNativeStGateway({ fetch: st, requestHeaders: () => ({}),
      uuid: () => "uuid-" + (++seq) }));
    await service.configure({ endpoint: "http://192.168.1.20:3000/api/sync/v1" });
    const pushed = await service.push({ entityType: "character", localId: "Local.png", adapter });
    const canonical = structuredClone(remotes.get(pushed.managerId).canonical);
    canonical.card.name = "Manager only";
    remotes.set("remote-only", { type: "character", id: "remote-only", revision: 1, canonical,
      contentHash: hashCanonicalProjection(canonical) });
    const pulled = await service.pull({ entityType: "character", managerId: "remote-only", adapter });
    const discovery = { worldbooks: [], characters: [...characters].map(([avatar, rawCard]) => ({
      localId: encodeURIComponent(avatar), avatarFileName: avatar, rawCard })) };
    const { rows } = await service.refresh({ discovery });
    console.log(JSON.stringify({ pushed: pushed.status, pulled: pulled.status, rows: rows.map(row => row.status),
      bindings: Object.keys(JSON.parse(stateFile).bindings).length, crypto: typeof globalThis.crypto }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, EXTENSION_ROOT: extensionRoot },
  });
  assert.deepEqual(JSON.parse(stdout), { pushed: "pushed", pulled: "pulled", rows: ["synced", "synced"], bindings: 2, crypto: "undefined" });
});
