import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PROJECTION_VERSION,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  hashCanonicalProjection,
} from "../services/syncProjection.js";
import {
  SYNC_METADATA_SCHEMA_VERSION,
  SyncMetadataIntegrityError,
  SyncMetadataValidationError,
  reconcileSyncMetadata,
  validateSyncMetadata,
} from "../services/syncMetadata.js";

const timestamp = "2026-09-28T12:00:00.000Z";

function clone(value) {
  return structuredClone(value);
}

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
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        cardVendor: {
          nested: "preserved",
        },
        extensions: {
          vendor: {
            enabled: true,
          },
        },
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
        rawEntry: {
          entryVendor: {
            nested: "preserved",
          },
        },
      },
    ],
    rawWorldBook: {
      worldVendor: {
        nested: "preserved",
      },
    },
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

function withSync(entity, entityType, revision = 1, extra = {}) {
  return {
    ...entity,
    sync: {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision,
      contentHash: hashEntity(entity, entityType),
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    },
  };
}

test("reconciliation initializes new characters and worldbooks at revision 1", () => {
  const character = createCharacter();
  const worldbook = createWorldBook();
  const reconciliation = reconcileSyncMetadata({
    beforeDb: createDb(),
    afterDb: createDb({ characters: [character], worldbooks: [worldbook] }),
    now: timestamp,
  });

  assert.deepEqual(reconciliation.changes.created, {
    characters: [character.id],
    worldbooks: [worldbook.id],
  });
  assert.equal(reconciliation.db.characters[0].sync.revision, 1);
  assert.equal(reconciliation.db.worldbooks[0].sync.revision, 1);
  assert.equal(reconciliation.db.characters[0].sync.contentHash, hashEntity(character, "character"));
  assert.equal(reconciliation.db.worldbooks[0].sync.contentHash, hashEntity(worldbook, "worldbook"));
  assert.equal(reconciliation.db.characters[0].sync.updatedAt, timestamp);
});

test("legacy canonical changes use an ephemeral revision 1 baseline", () => {
  const beforeCharacter = createCharacter();
  const afterCharacter = clone(beforeCharacter);
  afterCharacter.description = "Changed description";

  const reconciliation = reconcileSyncMetadata({
    beforeDb: createDb({ characters: [beforeCharacter] }),
    afterDb: createDb({ characters: [afterCharacter] }),
    now: timestamp,
  });

  assert.deepEqual(reconciliation.changes.advanced.characters, [beforeCharacter.id]);
  assert.deepEqual(reconciliation.db.characters[0].sync, {
    schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    revision: 2,
    contentHash: hashEntity(afterCharacter, "character"),
    updatedAt: timestamp,
  });
});

test("legacy local-only changes remain without sync metadata", () => {
  const beforeCharacter = createCharacter();
  const afterCharacter = clone(beforeCharacter);
  afterCharacter.pinned = true;
  afterCharacter.avatarPath = "/another/avatar.png";
  afterCharacter.updatedAt = "2030-01-01T00:00:00.000Z";

  const reconciliation = reconcileSyncMetadata({
    beforeDb: createDb({ characters: [beforeCharacter] }),
    afterDb: createDb({ characters: [afterCharacter] }),
    now: timestamp,
  });

  assert.deepEqual(reconciliation.changes.unchanged.characters, [beforeCharacter.id]);
  assert.equal(Object.hasOwn(reconciliation.db.characters[0], "sync"), false);
});

test("synced canonical changes increment once and canonical no-ops preserve metadata", () => {
  const beforeCharacter = withSync(createCharacter(), "character", 7, { futureField: "preserve" });
  const changedCharacter = clone(beforeCharacter);
  changedCharacter.name = "Aster Prime";

  const changed = reconcileSyncMetadata({
    beforeDb: createDb({ characters: [beforeCharacter] }),
    afterDb: createDb({ characters: [changedCharacter] }),
    now: timestamp,
  });

  assert.deepEqual(changed.db.characters[0].sync, {
    ...beforeCharacter.sync,
    revision: 8,
    contentHash: hashEntity(changedCharacter, "character"),
    updatedAt: timestamp,
  });

  const localOnlyCharacter = clone(beforeCharacter);
  localOnlyCharacter.pinned = true;
  localOnlyCharacter.avatarPng = "/avatars/aster.png";
  localOnlyCharacter.updatedAt = "2030-01-01T00:00:00.000Z";
  const unchanged = reconcileSyncMetadata({
    beforeDb: createDb({ characters: [beforeCharacter] }),
    afterDb: createDb({ characters: [localOnlyCharacter] }),
    now: timestamp,
  });

  assert.deepEqual(unchanged.db.characters[0].sync, beforeCharacter.sync);
});

test("worldbook canonical changes increment independently", () => {
  const beforeWorldbook = withSync(createWorldBook(), "worldbook", 3);
  const afterWorldbook = clone(beforeWorldbook);
  afterWorldbook.name = "Aster Lore Revised";
  afterWorldbook.entries[0].content = "Changed lore";

  const reconciliation = reconcileSyncMetadata({
    beforeDb: createDb({ worldbooks: [beforeWorldbook] }),
    afterDb: createDb({ worldbooks: [afterWorldbook] }),
    now: timestamp,
  });

  assert.equal(reconciliation.db.worldbooks[0].sync.revision, 4);
  assert.equal(
    reconciliation.db.worldbooks[0].sync.contentHash,
    hashEntity(afterWorldbook, "worldbook"),
  );
});

test("a changed synced entity rejects a mismatched pre-mutation hash", () => {
  const beforeCharacter = withSync(createCharacter(), "character");
  beforeCharacter.sync.contentHash = `sha256:${"0".repeat(64)}`;
  const afterCharacter = clone(beforeCharacter);
  afterCharacter.tags = ["fantasy", "revised"];

  assert.throws(
    () =>
      reconcileSyncMetadata({
        beforeDb: createDb({ characters: [beforeCharacter] }),
        afterDb: createDb({ characters: [afterCharacter] }),
        now: timestamp,
      }),
    SyncMetadataIntegrityError,
  );
});

test("deletions are reported without tombstones", () => {
  const character = withSync(createCharacter(), "character");
  const worldbook = withSync(createWorldBook(), "worldbook");
  const reconciliation = reconcileSyncMetadata({
    beforeDb: createDb({ characters: [character], worldbooks: [worldbook] }),
    afterDb: createDb({ worldbooks: [worldbook] }),
    now: timestamp,
  });

  assert.deepEqual(reconciliation.changes.deleted.characters, [character.id]);
  assert.equal(Object.hasOwn(reconciliation.db, "tombstones"), false);
  assert.deepEqual(reconciliation.db.worldbooks[0].sync, worldbook.sync);
});

test("sync metadata validation rejects malformed record-level metadata", () => {
  assert.throws(
    () =>
      validateSyncMetadata(
        {
          schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
          revision: 0,
          contentHash: `sha256:${"a".repeat(64)}`,
          updatedAt: timestamp,
        },
        { entityType: "character", id: "character-1" },
      ),
    SyncMetadataValidationError,
  );
});

test("validation accepts only V5 metadata", () => {
  for (const sync of [
    { schemaVersion: 3, projectionVersion: 3 },
    { schemaVersion: SYNC_METADATA_SCHEMA_VERSION, projectionVersion: 4 },
    { schemaVersion: SYNC_METADATA_SCHEMA_VERSION, projectionVersion: 6 },
  ]) {
    assert.throws(
      () => validateSyncMetadata({ ...sync, revision: 1, contentHash: `sha256:${"a".repeat(64)}`, updatedAt: timestamp }),
      SyncMetadataValidationError,
    );
  }
});

test("metadata from before V5 stays on unchanged copies and gives way to V5 metadata on the next change", () => {
  // An old backup's hashes came from projections that no longer exist, so
  // they are never checked: these would fail any check.
  const unverifiable = `sha256:${"0".repeat(64)}`;
  const outdated = [
    { schemaVersion: 1, revision: 7, contentHash: unverifiable, updatedAt: "2026-01-01T00:00:00.000Z" },
    { schemaVersion: 2, projectionVersion: 2, revision: 7, contentHash: unverifiable, updatedAt: "2026-01-01T00:00:00.000Z" },
    { schemaVersion: 3, projectionVersion: 3, revision: 7, contentHash: unverifiable, updatedAt: "2026-01-01T00:00:00.000Z" },
    { schemaVersion: SYNC_METADATA_SCHEMA_VERSION, projectionVersion: 4, revision: 7, contentHash: unverifiable,
      updatedAt: "2026-01-01T00:00:00.000Z" },
  ];

  for (const sync of outdated) {
    const beforeCharacter = createCharacter({ sync });
    const beforeWorldbook = { ...createWorldBook(), sync };
    const localOnlyCharacter = clone(beforeCharacter);
    localOnlyCharacter.pinned = true;
    const changedCharacter = clone(beforeCharacter);
    changedCharacter.description = "Changed after restore";
    const changedWorldbook = clone(beforeWorldbook);
    changedWorldbook.entries[0].content = "Changed after restore";

    const unchanged = reconcileSyncMetadata({
      beforeDb: createDb({ characters: [beforeCharacter], worldbooks: [beforeWorldbook] }),
      afterDb: createDb({ characters: [localOnlyCharacter], worldbooks: [beforeWorldbook] }),
      now: timestamp,
    });
    assert.deepEqual(unchanged.db.characters[0].sync, sync);
    assert.deepEqual(unchanged.db.worldbooks[0].sync, sync);

    const changed = reconcileSyncMetadata({
      beforeDb: createDb({ characters: [beforeCharacter], worldbooks: [beforeWorldbook] }),
      afterDb: createDb({ characters: [changedCharacter], worldbooks: [changedWorldbook] }),
      now: timestamp,
    });
    assert.deepEqual(changed.db.characters[0].sync, {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision: 2,
      contentHash: hashEntity(changedCharacter, "character"),
      updatedAt: timestamp,
    });
    assert.deepEqual(changed.db.worldbooks[0].sync, {
      schemaVersion: SYNC_METADATA_SCHEMA_VERSION,
      projectionVersion: CANONICAL_PROJECTION_VERSION,
      revision: 2,
      contentHash: hashEntity(changedWorldbook, "worldbook"),
      updatedAt: timestamp,
    });
  }
});
