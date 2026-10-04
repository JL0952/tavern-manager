import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import { SYNC_METADATA_SCHEMA_VERSION } from "../services/syncMetadata.js";
import {
  buildSyncManifest,
  buildSyncResource,
  serializeSyncResponse,
  SyncReadIntegrityError,
} from "../services/syncReadModel.js";

const timestamp = "2026-09-28T12:00:00.000Z";

function createCharacter(overrides = {}) {
  return {
    id: "character-1",
    name: "Aster",
    description: "Original description",
    personality: "Calm",
    scenario: "Library",
    first_mes: "Hello",
    mes_example: "<START>",
    alternate_greetings: ["Greeting one", "Greeting two"],
    group_only_greetings: [],
    creator_notes: "Notes",
    system_prompt: "System",
    post_history_instructions: "History",
    creator: "Creator",
    character_version: "1.0",
    tags: ["fantasy"],
    assets: [],
    worldBookId: null,
    pinned: false,
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        cardVendor: { nested: "preserved" },
        extensions: { vendor: { enabled: true } },
      },
    },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-1",
    name: "Aster Lore",
    entries: [
      {
        id: "entry-1",
        keys: ["aster"],
        secondaryKeys: [],
        comment: "Aster",
        content: "Original lore",
        enabled: true,
        rawEntry: { entryVendor: { nested: "preserved" } },
      },
    ],
    rawWorldBook: { worldVendor: { nested: "preserved" } },
    ...overrides,
  };
}

function createDb({ characters = [], worldbooks = [], tagDefinitions = [] } = {}) {
  return { characters, worldbooks, tagDefinitions };
}

function hashEntity(entity, entityType) {
  return hashCanonicalProjection(
    entityType === "character"
      ? createCanonicalCharacterProjection(entity)
      : createCanonicalWorldBookProjection(entity),
  );
}

function withSync(entity, entityType, revision = 1) {
  return {
    ...entity,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashEntity(entity, entityType),
      updatedAt: timestamp,
    },
  };
}

test("manifest exposes valid persisted metadata in deterministic id order", () => {
  const characterZ = withSync(createCharacter({ id: "z-character" }), "character", 3);
  const characterA = withSync(createCharacter({ id: "a-character" }), "character", 2);
  const worldbook = withSync(createWorldBook({ id: "worldbook-z" }), "worldbook", 4);

  const manifest = buildSyncManifest(
    createDb({ characters: [characterZ, characterA], worldbooks: [worldbook] }),
  );

  assert.equal(manifest.apiVersion, "sync/v1");
  assert.equal(manifest.projectionVersion, CANONICAL_PROJECTION_VERSION);
  assert.deepEqual(manifest.characters.map((entry) => entry.id), ["a-character", "z-character"]);
  assert.deepEqual(manifest.worldbooks.map((entry) => entry.id), ["worldbook-z"]);
  assert.equal(manifest.characters[0].revision, 2);
  assert.equal(manifest.characters[0].metadataSource, "persisted");
  assert.equal(manifest.worldbooks[0].updatedAt, timestamp);
  assert.equal(manifest.characters[0].displayName, "Aster");
  assert.equal(manifest.worldbooks[0].displayName, "Aster Lore");
});

test("legacy character resources use virtual metadata without leaking local fields", () => {
  const character = createCharacter({
    id: "legacy-character",
    pinned: true,
    fileName: "local-card.png",
    avatarPng: "/avatars/local.png",
    source: "/private/import/card.json",
    updatedAt: "2030-01-01T00:00:00.000Z",
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        character_book: { entries: [{ id: "embedded" }] },
        extensions: {
          world: "Derived Worldbook",
          vendor: { sync: { opaque: true } },
        },
        futureVendor: { retained: ["yes"] },
      },
    },
  });
  const db = createDb({ characters: [character] });
  const before = structuredClone(db);

  const resource = buildSyncResource(db, "character", character.id);
  const canonical = resource.entity.canonical;

  assert.equal(resource.entity.revision, 1);
  assert.equal(resource.entity.metadataSource, "ephemeral");
  assert.equal(resource.entity.updatedAt, null);
  assert.equal(resource.entity.contentHash, hashEntity(character, "character"));
  assert.equal("pinned" in canonical, false);
  assert.equal("fileName" in canonical, false);
  assert.equal("avatarPng" in canonical, false);
  assert.equal("source" in canonical, false);
  assert.equal("character_book" in canonical.card, false);
  assert.deepEqual(canonical.card.extensions, { depth_prompt: { prompt: "", depth: 4, role: "system" } });
  assert.equal("futureVendor" in canonical.card, false);
  assert.deepEqual(db, before);
});

test("metadata from before V5, as an old backup holds, reads as absent and blocks nothing", () => {
  const outdated = [
    { schemaVersion: 1, revision: 9, contentHash: `sha256:${"f".repeat(64)}`, updatedAt: timestamp },
    { schemaVersion: 2, projectionVersion: 2, revision: 9, contentHash: `sha256:${"f".repeat(64)}`, updatedAt: timestamp },
    { schemaVersion: 3, projectionVersion: 3, revision: 12, contentHash: `sha256:${"f".repeat(64)}`, updatedAt: timestamp },
    { schemaVersion: SYNC_METADATA_SCHEMA_VERSION, projectionVersion: 4, revision: 3, contentHash: `sha256:${"f".repeat(64)}`, updatedAt: timestamp },
  ];
  const characters = outdated.map((sync, index) => ({ ...createCharacter({ id: `old-${index}` }), sync }));
  const worldbook = { ...createWorldBook({ id: "old-book" }), sync: outdated[2] };
  const db = createDb({ characters, worldbooks: [worldbook] });
  const before = JSON.stringify(db);

  const manifest = buildSyncManifest(db);

  for (const entry of [...manifest.characters, ...manifest.worldbooks]) {
    assert.equal(entry.revision, 1, entry.id);
    assert.equal(entry.updatedAt, null, entry.id);
    assert.equal(entry.metadataSource, "ephemeral", entry.id);
  }
  const resource = buildSyncResource(db, "worldbook", "old-book");
  assert.equal(resource.entity.contentHash, hashCanonicalProjection(createCanonicalWorldBookProjection(worldbook)));
  assert.equal(JSON.stringify(db), before, "reading never rewrites metadata");
});

test("worldbook resources expose the exact canonical projection without Manager fields", () => {
  const worldbook = createWorldBook({
    fileName: "local-worldbook.json",
    source: "/private/import/lore.json",
    linkedCharacters: [{ id: "character-1", name: "Aster" }],
    rawWorldBook: {
      name: "Discarded raw name",
      entries: [{ ignored: true }],
      vendor: { sync: { opaque: "retained" } },
    },
  });
  const resource = buildSyncResource(createDb({ worldbooks: [worldbook] }), "worldbook", worldbook.id);

  assert.equal(resource.entity.metadataSource, "ephemeral");
  assert.deepEqual(resource.entity.canonical, createCanonicalWorldBookProjection(worldbook));
  assert.equal("fileName" in resource.entity.canonical, false);
  assert.equal("linkedCharacters" in resource.entity.canonical, false);
  assert.equal("envelope" in resource.entity.canonical.worldbook, false);
  assert.equal("vendor" in resource.entity.canonical.worldbook, false);
});

test("dangling worldbook relationships remain readable and produce diagnostics", () => {
  const character = createCharacter({ id: "dangling-character", worldBookId: "missing-worldbook" });
  const db = createDb({ characters: [character] });

  const manifest = buildSyncManifest(db);
  const resource = buildSyncResource(db, "character", character.id);

  const expectedDiagnostics = [
    { code: "missing_canonical_worldbook", worldBookId: "missing-worldbook" },
  ];

  assert.deepEqual(manifest.characters[0].relationship, { worldBookId: "missing-worldbook" });
  assert.deepEqual(manifest.characters[0].diagnostics, expectedDiagnostics);
  assert.deepEqual(resource.entity.canonical.relationship, { worldBookId: "missing-worldbook" });
  assert.deepEqual(resource.entity.diagnostics, expectedDiagnostics);
});

test("read model rejects malformed metadata, hash mismatches, and projection failures", () => {
  const malformed = createCharacter({ sync: {} });
  const mismatched = withSync(createCharacter({ id: "mismatched" }), "character");
  mismatched.sync.contentHash = `sha256:${"0".repeat(64)}`;
  const invalidProjection = createCharacter({
    id: "invalid-projection",
    assets: [undefined],
  });

  assert.throws(
    () => buildSyncManifest(createDb({ characters: [malformed] })),
    SyncReadIntegrityError,
  );
  assert.throws(
    () => buildSyncResource(createDb({ characters: [mismatched] }), "character", mismatched.id),
    SyncReadIntegrityError,
  );
  assert.throws(
    () =>
      buildSyncResource(
        createDb({ characters: [invalidProjection] }),
        "character",
        invalidProjection.id,
      ),
    SyncReadIntegrityError,
  );
});

test("resource lookup returns null for a missing canonical entity", () => {
  const db = createDb({ characters: [createCharacter()] });

  assert.equal(buildSyncResource(db, "character", "missing"), null);
  assert.equal(buildSyncResource(db, "worldbook", "missing"), null);
});

test("sync response serialization and ETags are deterministic", () => {
  const first = buildSyncManifest(createDb({ characters: [createCharacter()] }));
  const second = buildSyncManifest(createDb({ characters: [createCharacter()] }));

  assert.deepEqual(serializeSyncResponse(first), serializeSyncResponse(second));
});
