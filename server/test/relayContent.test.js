import assert from "node:assert/strict";
import test from "node:test";
import { relayUploadsFromText } from "../../client/src/utils/relayFiles.js";
import { relayContentHash } from "../services/relayContent.js";

test("the content hash ignores formatting and key order, but not content", () => {
  const preset = { temperature: 1, prompts: [{ identifier: "main", content: "Hi" }] };
  const reordered = JSON.parse('{ "prompts": [ { "content": "Hi", "identifier": "main" } ],\n  "temperature": 1 }');
  assert.equal(relayContentHash("presets", preset), relayContentHash("presets", reordered));
  assert.match(relayContentHash("presets", preset), /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(relayContentHash("presets", preset), relayContentHash("presets", { ...preset, temperature: 0.9 }));
  // Array order is content.
  assert.notEqual(relayContentHash("presets", { a: [1, 2] }), relayContentHash("presets", { a: [2, 1] }));
});

test("the content hash counts what a saved file would hold", () => {
  assert.equal(relayContentHash("themes", { name: "Night", blur: undefined }), relayContentHash("themes", { name: "Night" }));
  assert.throws(() => relayContentHash("themes", undefined), /missing/);
});

test("a regex script is compared without the id SillyTavern replaces on import", () => {
  const script = { id: "one", scriptName: "Trim", findRegex: "/\\s+$/" };
  assert.equal(relayContentHash("regex", script), relayContentHash("regex", { ...script, id: "two" }));
  assert.notEqual(relayContentHash("regex", script), relayContentHash("regex", { ...script, findRegex: "/x/" }));
  // Only regex scripts drop it.
  assert.notEqual(relayContentHash("presets", { id: "one" }), relayContentHash("presets", { id: "two" }));
});

test("a theme is compared without its name, which a kept copy changes", () => {
  const theme = { name: "Night", blur_strength: 10 };
  assert.equal(relayContentHash("themes", theme), relayContentHash("themes", { ...theme, name: "Night (2)" }));
  assert.notEqual(relayContentHash("themes", theme), relayContentHash("themes", { ...theme, blur_strength: 5 }));
  assert.notEqual(relayContentHash("presets", { name: "a" }), relayContentHash("presets", { name: "b" }));
});

test("a preset is named by its file, a theme by its name field, and kept as uploaded", () => {
  const presetText = '{\n  "temperature": 1\n}';
  assert.deepEqual(relayUploadsFromText("presets", "三人逆行v12.0——色魔.json", presetText), [{
    name: "三人逆行v12.0——色魔", contents: presetText, contentHash: relayContentHash("presets", { temperature: 1 }) }]);

  const themeText = '{"name":"Night","custom_css":"body{}"}';
  assert.deepEqual(relayUploadsFromText("themes", "whatever.json", themeText).map(({ name, contents }) => [name, contents]),
    [["Night", themeText]]);
});

test("a bulk regex export becomes one upload per script, written as a single export", () => {
  const scripts = [{ id: "a", scriptName: "Trim" }, { id: "b", scriptName: "Hide" }];
  const uploads = relayUploadsFromText("regex", "regex-2026.json", JSON.stringify(scripts));
  assert.deepEqual(uploads.map(({ name }) => name), ["Trim", "Hide"]);
  assert.equal(uploads[0].contents, JSON.stringify(scripts[0], null, 4));
  assert.equal(uploads[1].contentHash, relayContentHash("regex", scripts[1]));

  const singleText = '{ "id": "c", "scriptName": "Solo" }';
  assert.equal(relayUploadsFromText("regex", "regex-Solo.json", singleText)[0].contents, singleText);
});

test("files the relay cannot name are refused with a reason", () => {
  for (const [type, text, reason] of [
    ["presets", "{oops", /Not a JSON file/],
    ["presets", "[1]", /one JSON object/],
    ["themes", '{"custom_css":""}', /name field/],
    ["themes", '{"name":""}', /name field/],
    ["regex", "[]", /no regex scripts/],
    ["regex", '[{"scriptName":"Ok"},{"findRegex":"x"}]', /scriptName/],
    ["styles", "{}", /Unknown file type/],
  ]) {
    assert.throws(() => relayUploadsFromText(type, "file.json", text), reason, `${type} ${text}`);
  }
});
