import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalCharacterProjection } from "../services/syncProjection.js";
import { normalizeTagList } from "../services/tagList.js";

const byCodePoint = (left, right) => {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index].codePointAt(0) - b[index].codePointAt(0);
  }
  return a.length - b.length;
};

test("stored tags are trimmed, non-empty strings, each once, in first-seen order, commas kept", () => {
  assert.deepEqual(normalizeTagList([" b ", "a,b", "b", "", "   ", 7, null, "a,b ", "A"]), ["b", "a,b", "A"]);
  assert.deepEqual(normalizeTagList("a,b"), []);
  assert.deepEqual(normalizeTagList(undefined), []);
});

test("the sync hash sees the same tags as Manager, only sorted", () => {
  const pool = ["a", " a", "a ", "b", "B", "a,b", "", " ", "😀", "日本", "z", 3, null, { tag: "x" }];
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647);

  for (let round = 0; round < 500; round += 1) {
    const tags = Array.from({ length: next() % 8 }, () => pool[next() % pool.length]);
    assert.deepEqual(
      createCanonicalCharacterProjection({ tags }).card.tags,
      [...normalizeTagList(tags)].sort(byCodePoint),
      JSON.stringify(tags),
    );
  }
});
