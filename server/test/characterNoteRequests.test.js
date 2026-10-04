import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardParserError, parseCharacterCard, parseCharacterNote } from "../services/cardParser.js";

const invalidNotes = [
  { prompt: 7 },
  { depth: "4" },
  { depth: -1 },
  { depth: 1.5 },
  { role: "narrator" },
  "note",
  [],
];

test("an invalid Character's Note is a CardParserError, so routes answer 400", () => {
  assert.deepEqual(parseCharacterNote(undefined), { prompt: "", depth: 4, role: "system" });
  assert.deepEqual(parseCharacterNote({ prompt: "p", depth: 0, role: "user" }), { prompt: "p", depth: 0, role: "user" });

  for (const value of invalidNotes) {
    assert.throws(() => parseCharacterNote(value), CardParserError, JSON.stringify(value));
  }
});

test("importing a card with an invalid Character's Note is rejected as a parser error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "character-note-"));
  try {
    const path = join(directory, "card.json");
    await writeFile(path, JSON.stringify({ data: { name: "Hero", extensions: { depth_prompt: { depth: "4" } } } }));
    await assert.rejects(
      parseCharacterCard({ originalname: "card.json", path, filename: "card.json" }),
      CardParserError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
