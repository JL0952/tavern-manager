import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extractChunks from "png-chunks-extract";
import textChunk from "png-chunk-text";
import { createJsonExport, createPngExport } from "../services/cardExporter.js";
import { parseCharacterCard } from "../services/cardParser.js";
import { findManagerIdCandidate } from "../services/duplicateDetection.js";
import {
  embedManagerId,
  readEmbeddedManagerId,
  takeEmbeddedManagerId,
} from "../services/embeddedManagerId.js";
import { createCanonicalCharacterProjection, hashCanonicalProjection } from "../services/syncProjection.js";

function character(overrides = {}) {
  return {
    id: "manager-uuid",
    name: "Hero",
    description: "desc",
    personality: "",
    scenario: "",
    first_mes: "hi",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    group_only_greetings: [],
    creator: "",
    character_version: "",
    tags: [],
    extensions: { depth_prompt: { prompt: "", depth: 4, role: "system" }, regex_scripts: ["keep me"] },
    character_book: null,
    assets: [],
    spec: "chara_card_v3",
    spec_version: "3.0",
    rawCard: { spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "Hero", extensions: { tavern_manager: { id: "stale-uuid" } } } },
    worldBookId: null,
    ...overrides,
  };
}

test("JSON and PNG exports embed the record's own UUID and keep other extension fields", async () => {
  const exported = JSON.parse(createJsonExport(character()));
  assert.deepEqual(exported.data.extensions.tavern_manager, { id: "manager-uuid" });
  assert.deepEqual(exported.data.extensions.regex_scripts, ["keep me"]);

  const png = await createPngExport(character());
  const chunk = extractChunks(png).filter((c) => c.name === "tEXt").map((c) => textChunk.decode(c.data))
    .find((c) => ["ccv3", "chara"].includes(c.keyword));
  const card = JSON.parse(Buffer.from(chunk.text, "base64").toString("utf8"));
  assert.equal(readEmbeddedManagerId(card), "manager-uuid");
});

test("a V1-shaped export without a data container embeds the UUID at the root", () => {
  const exported = JSON.parse(createJsonExport(character({ rawCard: { name: "Hero" } })));
  assert.deepEqual(exported.extensions.tavern_manager, { id: "manager-uuid" });
  assert.equal(readEmbeddedManagerId(exported), "manager-uuid");
});

test("the marker is outside the canonical sync projection", () => {
  const record = character();
  const before = hashCanonicalProjection(createCanonicalCharacterProjection(record));
  embedManagerId(record.rawCard, "another-uuid");
  record.extensions.tavern_manager = { id: "another-uuid" };
  assert.equal(hashCanonicalProjection(createCanonicalCharacterProjection(record)), before);
});

test("import strips the marker from every stored copy and reports the id it carried", async () => {
  const directory = await mkdtemp(join(tmpdir(), "embedded-id-"));
  try {
    const path = join(directory, "card.json");
    await writeFile(path, createJsonExport(character()));
    const parsed = await parseCharacterCard({ originalname: "card.json", path, filename: "card.json" });
    assert.notEqual(parsed.id, "manager-uuid", "a parsed card always gets a fresh UUID");
    assert.equal(takeEmbeddedManagerId(parsed), "manager-uuid");
    assert.equal(readEmbeddedManagerId(parsed.rawCard), null);
    assert.equal(Object.hasOwn(parsed.extensions, "tavern_manager"), false);
    assert.deepEqual(parsed.extensions.regex_scripts, ["keep me"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only a well-formed marker is read, and only an existing UUID becomes a candidate", () => {
  for (const value of ["text", null, { id: "" }, { id: 7 }, []]) {
    assert.equal(readEmbeddedManagerId({ data: { extensions: { tavern_manager: value } } }), null);
  }
  const characters = [{ id: "a", name: "A", tags: ["t"] }, { id: "b", name: "A" }];
  assert.equal(findManagerIdCandidate(null, characters), null);
  assert.equal(findManagerIdCandidate("missing", characters), null);
  assert.deepEqual(findManagerIdCandidate("a", characters), { id: "a", name: "A", avatar: "", tags: ["t"],
    reason: "exported from this Manager character", confidence: "exact" });
});
