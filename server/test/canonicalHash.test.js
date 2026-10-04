import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalProjection as nativeHash } from "../services/canonicalHash.js";
import {
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection as sharedHash,
} from "../services/syncProjection.js";

const tricky = ["", "plain", "凯尔・中文", "emoji 🧙‍♀️🏳️‍🌈", "é combining", "lone \uD800 surrogate", "nul \u0000 byte",
  "x".repeat(100_000)];

test("Manager's native canonical hash equals the shared pure-JS one", () => {
  for (const value of tricky) {
    assert.equal(nativeHash({ value, nested: [value, { value }] }), sharedHash({ value, nested: [value, { value }] }), value.slice(0, 20));
  }

  const character = {
    id: "c", name: "凯尔", description: "🧙 description", tags: ["b", "a"], alternate_greetings: ["hi"],
    extensions: { depth_prompt: { prompt: "note", depth: 2, role: "user" } }, worldBookId: "w",
    rawCard: { data: { name: "凯尔", extensions: { vendor: { keep: "\uD800" } } } },
  };
  const worldBook = {
    id: "w", name: "Lore", entries: [{ id: "1", keys: ["k"], content: "lore", order: 5, extensions: { scan_depth: 2 } }],
    rawWorldBook: { name: "Lore", scan_depth: 3, entries: {} },
  };

  const characterProjection = createCanonicalCharacterProjection(character);
  const worldBookProjection = createCanonicalWorldBookProjection(worldBook);
  assert.equal(nativeHash(characterProjection), sharedHash(characterProjection), "character");
  assert.equal(nativeHash(worldBookProjection), sharedHash(worldBookProjection), "worldbook");
});

test("both hashes reject what stableSerialize rejects", () => {
  for (const value of [{ value: undefined }, { value: Number.NaN }, { value: () => {} }]) {
    assert.throws(() => nativeHash(value));
    assert.throws(() => sharedHash(value));
  }
});
