import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeCanonicalCharacter,
  materializeCanonicalWorldBook,
  SyncCanonicalMaterializationError,
} from "../services/syncCanonicalMaterializer.js";
import {
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  stableSerialize,
} from "../services/syncProjection.js";

function createCharacter(overrides = {}) {
  return {
    id: "character-1",
    fileName: "local-card.png",
    sourceType: "png",
    avatar: "avatars/local.png",
    avatarPng: "avatars/local-upload.png",
    avatarSource: "uploaded",
    pinned: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    name: "Aster",
    description: "Original description",
    personality: "Calm",
    scenario: "Library",
    first_mes: "Hello",
    mes_example: "",
    creator_notes: "Notes",
    system_prompt: "System",
    post_history_instructions: "History",
    alternate_greetings: ["First", "Second"],
    group_only_greetings: [],
    creator: "Creator",
    character_version: "1.0",
    tags: ["fantasy"],
    assets: [],
    worldBookId: null,
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      avatar: "legacy-local-avatar.png",
      data: {
        avatar: "data-local-avatar.png",
        character_book: { stale: true },
        extensions: { vendor: { sync: { retained: true } }, world: "Stale world" },
        vendor: { future: { retained: true } },
      },
    },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-1",
    fileName: "local-worldbook.json",
    source: "standalone",
    sourceType: "json",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    name: "Aster Lore",
    entries: [
      {
        id: "entry-1",
        keys: ["aster", "aster"],
        secondaryKeys: ["lore"],
        comment: "Aster",
        content: "Original lore",
        enabled: true,
        rawEntry: { entryVendor: { sync: { retained: true } } },
      },
    ],
    rawWorldBook: { worldVendor: { sync: { retained: true } } },
    ...overrides,
  };
}

test("V3 character materialization updates semantic fields while preserving local raw state", () => {
  const existing = createCharacter();
  const canonical = createCanonicalCharacterProjection(existing);
  canonical.card.description = "Remote description";
  const linkedWorldBook = createWorldBook();
  canonical.relationship.worldBookId = linkedWorldBook.id;

  const { character, diagnostics } = materializeCanonicalCharacter({
    existingCharacter: existing,
    canonical,
    linkedWorldBook,
  });

  assert.equal(character.id, existing.id);
  assert.equal(character.fileName, existing.fileName);
  assert.equal(character.avatar, existing.avatar);
  assert.equal(character.avatarPng, existing.avatarPng);
  assert.equal(character.avatarSource, existing.avatarSource);
  assert.equal(character.pinned, existing.pinned);
  assert.equal(character.createdAt, existing.createdAt);
  assert.equal(character.updatedAt, existing.updatedAt);
  assert.equal(character.description, "Remote description");
  assert.deepEqual(character.rawCard.data.vendor.future, { retained: true });
  assert.deepEqual(character.rawCard.data.extensions.vendor.sync, { retained: true });
  assert.equal(character.rawCard.data.extensions.world, linkedWorldBook.name);
  assert.equal(character.rawCard.data.character_book.name, linkedWorldBook.name);
  assert.deepEqual(diagnostics, []);
  assert.equal(
    stableSerialize(createCanonicalCharacterProjection(character)),
    stableSerialize(canonical),
  );
});

test("character materialization clears derived links and reports dangling canonical links", () => {
  const existing = createCharacter({ worldBookId: "old-worldbook" });
  const canonical = createCanonicalCharacterProjection(existing);
  canonical.relationship.worldBookId = null;

  const unlinked = materializeCanonicalCharacter({ existingCharacter: existing, canonical }).character;
  assert.equal(unlinked.worldBookId, null);
  assert.equal("character_book" in unlinked, false);
  assert.equal("character_book" in unlinked.rawCard.data, false);
  assert.equal("world" in unlinked.rawCard.data.extensions, false);

  const danglingCanonical = structuredClone(canonical);
  danglingCanonical.relationship.worldBookId = "missing-worldbook";
  const dangling = materializeCanonicalCharacter({
    existingCharacter: existing,
    canonical: danglingCanonical,
  });
  assert.equal(dangling.character.worldBookId, "missing-worldbook");
  assert.equal("character_book" in dangling.character.rawCard.data, false);
  assert.deepEqual(dangling.diagnostics, [
    { code: "missing_canonical_worldbook", worldBookId: "missing-worldbook" },
  ]);
});

test("V3 character materialization preserves every local extension sibling", () => {
  const existing = createCharacter({
    extensions: { fav: true },
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      extensions: { fav: false, rootOnly: { retained: true } },
      data: {
        extensions: { fav: false, vendor: { old: true, sync: { local: true } } },
      },
    },
  });
  const canonical = createCanonicalCharacterProjection(existing);
  canonical.card.description = "Remote description";

  const { character } = materializeCanonicalCharacter({ existingCharacter: existing, canonical });

  assert.equal(character.rawCard.data.extensions.fav, false);
  assert.deepEqual(character.rawCard.data.extensions.vendor, {
    old: true,
    sync: { local: true },
  });
  assert.deepEqual(canonical.card.extensions, { depth_prompt: { prompt: "", depth: 4, role: "system" } });
  assert.equal(character.description, "Remote description");
  assert.equal(
    stableSerialize(createCanonicalCharacterProjection(character)),
    stableSerialize(canonical),
  );
});

test("character materialization rejects writable excluded fields and root record fields", () => {
  const existing = createCharacter();
  const canonical = createCanonicalCharacterProjection(existing);
  canonical.card.avatar = "attacker-avatar.png";

  assert.throws(
    () => materializeCanonicalCharacter({ existingCharacter: existing, canonical }),
    SyncCanonicalMaterializationError,
  );

  const rootInjection = createCanonicalCharacterProjection(existing);
  rootInjection.id = "another-id";
  assert.throws(
    () => materializeCanonicalCharacter({ existingCharacter: existing, canonical: rootInjection }),
    /unsupported field "id"/,
  );
});

test("V4 worldbook materialization preserves local raw fields outside the canonical allowlist", () => {
  const existing = createWorldBook();
  const canonical = createCanonicalWorldBookProjection(existing);
  canonical.worldbook.name = "Remote Lore";
  canonical.worldbook.entries[0].content = "Remote canonical lore";

  const { worldBook } = materializeCanonicalWorldBook({ existingWorldBook: existing, canonical });

  assert.equal(worldBook.id, existing.id);
  assert.equal(worldBook.fileName, existing.fileName);
  assert.equal(worldBook.source, existing.source);
  assert.equal(worldBook.createdAt, existing.createdAt);
  assert.equal(worldBook.updatedAt, existing.updatedAt);
  assert.equal(worldBook.name, "Remote Lore");
  assert.equal(worldBook.entries[0].content, "Remote canonical lore");
  assert.deepEqual(worldBook.rawWorldBook.worldVendor, { sync: { retained: true } });
  assert.deepEqual(worldBook.entries[0].rawEntry.entryVendor, { sync: { retained: true } });
  assert.equal(
    stableSerialize(createCanonicalWorldBookProjection(worldBook)),
    stableSerialize(canonical),
  );
});
