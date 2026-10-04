import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PROJECTION_VERSION,
  CANONICAL_CHARACTER_FIELDS,
  CANONICAL_CHARACTER_CARD_KEYS,
  CANONICAL_WORLDBOOK_ENTRY_FIELDS,
  SyncProjectionError,
  createCanonicalCharacterProjection,
  createCanonicalWorldBookProjection,
  getCanonicalWorldBookProjectionDiagnostics,
  hashCanonicalProjection,
  stableSerialize,
} from "../services/syncProjection.js";

function clone(value) {
  return structuredClone(value);
}

function createCharacter(overrides = {}) {
  return {
    id: "character-id",
    spec: "chara_card_v3",
    spec_version: "3.0",
    name: "Canonical name",
    description: "Canonical description",
    personality: "",
    scenario: "",
    first_mes: "Hello",
    mes_example: "",
    creator_notes: "Canonical notes",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: ["First", "Second"],
    group_only_greetings: [],
    creator: "Creator",
    character_version: "1.0",
    tags: ["beta", "alpha", "beta"],
    extensions: {
      vendor: {
        normalized: true,
        nested: { managerValue: "kept" },
      },
      world: "Stale world name",
    },
    assets: [{ type: "vendor_asset", uri: "asset://one", metadata: { keep: true } }],
    character_book: { name: "Embedded", entries: [] },
    worldBookId: "worldbook-id",
    pinned: true,
    avatar: "avatars/local-avatar.png",
    avatarPng: "avatars/local-avatar-export.png",
    avatarSource: "uploaded",
    fileName: "imported-card.png",
    sourceType: "png",
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T01:00:00.000Z",
    rawCard: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      name: "Stale top-level name",
      avatar: "legacy-local-avatar.png",
      chat: "legacy-chat.jsonl",
      rootVendor: { preserved: true },
      extensions: {
        rootVendor: { sibling: true },
        vendor: { nested: { rootValue: "kept" } },
        world: "Top-level derived world",
      },
      data: {
        name: "Stale data name",
        description: "Stale data description",
        creatorcomment: "Stale creator comment",
        character_book: { name: "Raw embedded", entries: [{ id: 1 }] },
        pinned: true,
        dataVendor: { futureField: ["keep", "order"] },
        extensions: {
          dataVendor: { sibling: "kept" },
          vendor: { nested: { dataValue: "kept" } },
          world: "Data derived world",
        },
      },
    },
    ...overrides,
  };
}

function createWorldBook(overrides = {}) {
  return {
    id: "worldbook-id",
    name: "Canonical worldbook",
    source: "standalone",
    sourceType: "json",
    fileName: "imported-worldbook.json",
    linkedCharacterId: null,
    tags: ["manager-only"],
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T01:00:00.000Z",
    rawWorldBook: {
      name: "Stale worldbook name",
      topLevelVendor: { retain: true },
      entries: {
        first: {
          id: "stale-id",
          keys: ["b", "a", "a"],
          secondary_keys: ["z", "m"],
          enabled: false,
          insertion_order: 99,
          use_regex: true,
          entryVendor: { nested: "retained" },
        },
      },
    },
    entries: [
      {
        id: "first",
        keys: ["a", "b", "a"],
        secondaryKeys: ["m", "z"],
        comment: "Canonical entry",
        content: "Canonical content",
        constant: false,
        selective: true,
        enabled: true,
        position: 0,
        order: 100,
        useRegex: false,
        probability: 100,
        useProbability: false,
        depth: 4,
        role: null,
        rawEntry: {
          id: "stale-id",
          keys: ["b", "a", "a"],
          secondary_keys: ["z", "m"],
          enabled: false,
          insertion_order: 99,
          use_regex: true,
          entryVendor: { nested: "retained" },
        },
      },
    ],
    ...overrides,
  };
}

function createPortableWorldBookEntry(overrides = {}) {
  return {
    id: "entry-42",
    keys: ["alpha", "beta"],
    secondaryKeys: ["secondary"],
    content: "Portable lore content",
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    enabled: true,
    position: 0,
    order: 100,
    probability: 100,
    useProbability: true,
    depth: 4,
    role: 0,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    outletName: "",
    group: "",
    groupOverride: false,
    groupWeight: 100,
    sticky: null,
    cooldown: null,
    delay: null,
    triggers: [],
    rawEntry: {
      uid: "entry-42",
      key: ["alpha", "beta"],
      keysecondary: ["secondary"],
      content: "Portable lore content",
      constant: false,
      selective: true,
      disable: false,
      position: 0,
      order: 100,
      probability: 100,
      useProbability: true,
      depth: 4,
      role: 0,
      extensions: {
        vectorized: false,
        exclude_recursion: false,
        prevent_recursion: false,
        delay_until_recursion: 0,
        ignore_budget: false,
        match_persona_description: false,
        match_character_description: false,
        match_character_personality: false,
        match_character_depth_prompt: false,
        match_scenario: false,
        match_creator_notes: false,
        scan_depth: null,
        case_sensitive: null,
        match_whole_words: null,
        use_group_scoring: null,
        outlet_name: "",
        group: "",
        group_override: false,
        group_weight: 100,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
      },
      vendor: { sync: { preserved: true } },
    },
    ...overrides,
  };
}

function createPortableWorldBook(overrides = {}) {
  return {
    id: "portable-worldbook",
    name: "Portable Lore",
    entries: [createPortableWorldBookEntry()],
    rawWorldBook: {
      name: "Portable Lore",
      entries: {},
      vendor: { preserved: true },
    },
    ...overrides,
  };
}

test("character projection contains only supported semantic fields and the canonical relationship", () => {
  const character = createCharacter();
  const rawCardBeforeProjection = clone(character.rawCard);
  const projection = createCanonicalCharacterProjection(character);

  assert.deepEqual(character.rawCard, rawCardBeforeProjection);
  assert.deepEqual(Object.keys(projection.card).sort(), [...CANONICAL_CHARACTER_CARD_KEYS].sort());
  assert.equal(projection.card.name, "Canonical name");
  assert.deepEqual(projection.card.tags, ["alpha", "beta"]);
  assert.deepEqual(projection.card.extensions, { depth_prompt: { prompt: "", depth: 4, role: "system" } });
  assert.equal("character_book" in projection.card, false);
  assert.equal("spec" in projection.card, false);
  assert.equal("data" in projection.card, false);
  assert.deepEqual(projection.relationship, { worldBookId: "worldbook-id" });
});

test("duplicate top-level known values and Manager-only fields do not change a character hash", () => {
  const baseline = createCharacter();
  const variant = clone(baseline);

  variant.rawCard.name = "A different stale top-level name";
  variant.pinned = false;
  variant.avatar = "avatars/another-local-file.png";
  variant.avatarPng = null;
  variant.avatarSource = "imported";
  variant.fileName = "another-import.png";
  variant.sourceType = "json";
  variant.createdAt = "2020-01-01T00:00:00.000Z";
  variant.updatedAt = "2030-01-01T00:00:00.000Z";
  variant.tags = ["alpha", "beta"];

  assert.equal(
    hashCanonicalProjection(createCanonicalCharacterProjection(baseline)),
    hashCanonicalProjection(createCanonicalCharacterProjection(variant)),
  );
});

test("character semantic changes affect hashes while raw vendor fields are local-preserved", () => {
  const baseline = createCharacter();
  const descriptionChanged = clone(baseline);
  const greetingReordered = clone(baseline);
  const vendorChanged = clone(baseline);

  descriptionChanged.description = "Changed description";
  greetingReordered.alternate_greetings.reverse();
  vendorChanged.rawCard.data.dataVendor.futureField.push("changed");

  const baselineHash = hashCanonicalProjection(createCanonicalCharacterProjection(baseline));

  assert.notEqual(
    baselineHash,
    hashCanonicalProjection(createCanonicalCharacterProjection(descriptionChanged)),
  );
  assert.notEqual(
    baselineHash,
    hashCanonicalProjection(createCanonicalCharacterProjection(greetingReordered)),
  );
  assert.equal(
    baselineHash,
    hashCanonicalProjection(createCanonicalCharacterProjection(vendorChanged)),
  );
});

test("worldbook relationship owns embedded character books", () => {
  const baseline = createCharacter();
  const embeddedOnlyChanged = clone(baseline);
  const worldBookChanged = clone(baseline);
  const unlinked = clone(baseline);

  embeddedOnlyChanged.rawCard.data.character_book.entries.push({ id: 2 });
  embeddedOnlyChanged.rawCard.data.extensions.world = "Different derived name";
  worldBookChanged.worldBookId = "another-worldbook-id";
  unlinked.worldBookId = null;

  assert.equal(
    hashCanonicalProjection(createCanonicalCharacterProjection(baseline)),
    hashCanonicalProjection(createCanonicalCharacterProjection(embeddedOnlyChanged)),
  );
  assert.notEqual(
    hashCanonicalProjection(createCanonicalCharacterProjection(baseline)),
    hashCanonicalProjection(createCanonicalCharacterProjection(worldBookChanged)),
  );
  assert.deepEqual(createCanonicalCharacterProjection(unlinked).relationship, { worldBookId: null });
});

test("worldbook projection separates raw fidelity from supported lore semantics", () => {
  const baseline = createWorldBook();
  const reorderedKeys = clone(baseline);
  const reorderedEntries = clone(baseline);
  const vendorChanged = clone(baseline);

  reorderedKeys.entries[0].keys = ["b", "a", "a"];
  reorderedKeys.entries[0].secondaryKeys = ["z", "m"];
  reorderedEntries.entries.push({ ...clone(baseline.entries[0]), id: "second" });
  reorderedEntries.entries.reverse();
  vendorChanged.entries[0].rawEntry.entryVendor.nested = "changed";

  const projection = createCanonicalWorldBookProjection(baseline);
  const entryValue = projection.worldbook.entries[0];
  const baselineHash = hashCanonicalProjection(projection);

  assert.deepEqual(Object.keys(projection.worldbook).sort(), ["entries", "name"]);
  assert.deepEqual(Object.keys(entryValue).sort(), [...CANONICAL_WORLDBOOK_ENTRY_FIELDS].sort());
  assert.deepEqual(entryValue.keys, ["a", "a", "b"]);
  assert.deepEqual(entryValue.secondaryKeys, ["m", "z"]);
  assert.equal(entryValue.comment, "Canonical entry");
  assert.equal(entryValue.useRegex, false, "the Manager record wins over rawEntry use_regex");
  assert.equal("entryVendor" in entryValue, false);
  assert.equal("topLevelVendor" in projection.worldbook, false);
  assert.equal(
    baselineHash,
    hashCanonicalProjection(createCanonicalWorldBookProjection(reorderedKeys)),
  );
  assert.notEqual(
    baselineHash,
    hashCanonicalProjection(createCanonicalWorldBookProjection(reorderedEntries)),
  );
  assert.equal(
    baselineHash,
    hashCanonicalProjection(createCanonicalWorldBookProjection(vendorChanged)),
  );
});

test("stable serialization is insertion-order independent while preserving null and exact Unicode", () => {
  assert.equal(stableSerialize({ b: 1, a: 2 }), stableSerialize({ a: 2, b: 1 }));
  assert.notEqual(stableSerialize({ value: null }), stableSerialize({}));
  assert.notEqual(stableSerialize({ value: "é" }), stableSerialize({ value: "e\u0301" }));
  assert.throws(() => stableSerialize({ value: undefined }), SyncProjectionError);
  assert.throws(() => stableSerialize({ value: Number.POSITIVE_INFINITY }), SyncProjectionError);
});

test("character projection hashes every supported semantic field and preserves meaningful array ordering", () => {
  const baseline = createCharacter();
  const baselineHash = hashCanonicalProjection(createCanonicalCharacterProjection(baseline));

  for (const field of CANONICAL_CHARACTER_FIELDS) {
    const changed = clone(baseline);
    if (field === "tags") {
      changed.tags = ["changed-tag"];
    } else if (field === "assets") {
      changed.assets = [{ type: "icon", uri: "changed" }];
    } else if (field === "alternate_greetings" || field === "group_only_greetings") {
      changed[field] = ["changed", "other"];
    } else {
      changed[field] = `${changed[field]} changed`;
    }

    assert.notEqual(
      baselineHash,
      hashCanonicalProjection(createCanonicalCharacterProjection(changed)),
      field,
    );
  }

  const reordered = clone(baseline);
  reordered.alternate_greetings.reverse();
  assert.notEqual(
    baselineHash,
    hashCanonicalProjection(createCanonicalCharacterProjection(reordered)),
  );
});

test("character projection ignores extension and raw-container differences without weakening semantic differences", () => {
  const baseline = createCharacter();
  const variant = clone(baseline);
  variant.rawCard.spec = "chara_card_v2";
  variant.rawCard.spec_version = "2.0";
  variant.rawCard.name = "stale root alias";
  variant.rawCard.data.extensions = {
    fav: true,
    plugin_x: { cache: "changed", sync: { nested: true } },
  };
  variant.extensions = { fav: true, plugin_x: { cache: "changed" } };
  variant.rawCard.data.vendor_cache = { value: "changed" };

  assert.equal(
    hashCanonicalProjection(createCanonicalCharacterProjection(baseline)),
    hashCanonicalProjection(createCanonicalCharacterProjection(variant)),
  );

  const genuine = clone(variant);
  genuine.system_prompt = "changed supported prompt";
  assert.notEqual(
    hashCanonicalProjection(createCanonicalCharacterProjection(baseline)),
    hashCanonicalProjection(createCanonicalCharacterProjection(genuine)),
  );
});

test("worldbook projection normalizes Manager standalone and ST World Info aliases to identical lore semantics", () => {
  const manager = createPortableWorldBook({
    entries: [createPortableWorldBookEntry({
      position: "before_char",
      order: 73,
      rawEntry: {
        uid: "entry-42",
        keys: ["beta", "alpha"],
        secondary_keys: ["secondary"],
        content: "Portable lore content",
        constant: false,
        selective: true,
        enabled: true,
        insertion_order: 73,
        use_regex: true,
        extensions: {
          position: "before_char",
          vectorized: false,
          probability: 100,
          useProbability: true,
          depth: 4,
          role: 0,
          exclude_recursion: false,
          prevent_recursion: false,
          delay_until_recursion: 0,
          ignore_budget: false,
          match_persona_description: false,
          match_character_description: false,
          match_character_personality: false,
          match_character_depth_prompt: false,
          match_scenario: false,
          match_creator_notes: false,
          scan_depth: null,
          case_sensitive: null,
          match_whole_words: null,
          use_group_scoring: null,
          outlet_name: "",
          group: "",
          group_override: false,
          group_weight: 100,
          sticky: null,
          cooldown: null,
          delay: null,
          triggers: [],
        },
      },
    })],
  });
  const stWorldInfo = createPortableWorldBook({
    entries: [createPortableWorldBookEntry({
      keys: ["beta", "alpha"],
      position: 0,
      order: 73,
      rawEntry: {
        uid: "entry-42",
        key: ["beta", "alpha"],
        keysecondary: ["secondary"],
        content: "Portable lore content",
        constant: false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        disable: false,
        position: 0,
        order: 73,
        probability: 100,
        useProbability: true,
        depth: 4,
        role: 0,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: 0,
        ignoreBudget: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        outletName: "",
        group: "",
        groupOverride: false,
        groupWeight: 100,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
        displayIndex: 400,
        addMemo: true,
        useRegex: true,
        vendor: { changed: true },
      },
    })],
  });

  assert.equal(
    hashCanonicalProjection(createCanonicalWorldBookProjection(manager)),
    hashCanonicalProjection(createCanonicalWorldBookProjection(stWorldInfo)),
  );
});

test("worldbook projection normalizes embedded Character Book and ST convertCharacterBook output", () => {
  const embeddedEntry = {
    id: "embedded-1",
    keys: ["alpha", "beta"],
    secondary_keys: ["secondary"],
    content: "Embedded lore",
    constant: false,
    selective: false,
    enabled: true,
    insertion_order: 51,
    position: "before_char",
    extensions: {
      probability: 100,
      useProbability: true,
      depth: 4,
      role: 0,
      vectorized: false,
      exclude_recursion: false,
      prevent_recursion: false,
      delay_until_recursion: false,
      ignore_budget: false,
      match_persona_description: false,
      match_character_description: false,
      match_character_personality: false,
      match_character_depth_prompt: false,
      match_scenario: false,
      match_creator_notes: false,
      scan_depth: null,
      case_sensitive: null,
      match_whole_words: null,
      use_group_scoring: null,
      outlet_name: "",
      group: "",
      group_override: false,
      group_weight: 100,
      sticky: null,
      cooldown: null,
      delay: null,
      triggers: [],
    },
  };
  const managerEmbedded = {
    id: "embedded-book",
    name: "Embedded Lore",
    entries: [{
      id: "embedded-1",
      keys: ["alpha", "beta"],
      secondaryKeys: ["secondary"],
      content: "Embedded lore",
      selective: false,
      enabled: true,
      position: "before_char",
      order: 51,
      extensions: clone(embeddedEntry.extensions),
      rawEntry: clone(embeddedEntry),
    }],
    rawWorldBook: { name: "Embedded Lore", entries: [clone(embeddedEntry)] },
  };
  const converted = {
    id: "embedded-book",
    name: "Embedded Lore",
    entries: [{
      ...createPortableWorldBookEntry({
        id: "embedded-1",
        keys: ["alpha", "beta"],
        secondaryKeys: ["secondary"],
        content: "Embedded lore",
        selective: false,
        position: 0,
        order: 51,
        delayUntilRecursion: false,
      }),
      rawEntry: {
        uid: "embedded-1",
        key: ["alpha", "beta"],
        keysecondary: ["secondary"],
        content: "Embedded lore",
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        disable: false,
        position: 0,
        order: 51,
        probability: 100,
        useProbability: true,
        depth: 4,
        role: 0,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        ignoreBudget: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        outletName: "",
        group: "",
        groupOverride: false,
        groupWeight: 100,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
        displayIndex: 9,
        addMemo: true,
      },
    }],
    rawWorldBook: {
      name: "Embedded Lore",
      originalData: { entries: [clone(embeddedEntry)] },
      entries: { "embedded-1": { converted: true } },
    },
  };

  assert.deepEqual(
    createCanonicalWorldBookProjection(managerEmbedded),
    createCanonicalWorldBookProjection(converted),
  );
});

test("worldbook projection ignores representation-only fields and fills only missing ST defaults", () => {
  const managerDefaulted = createPortableWorldBook({
    entries: [{
      id: "defaulted",
      keys: ["alpha"],
      secondaryKeys: [],
      content: "Defaulted lore",
      selective: true,
      enabled: true,
      position: 0,
      order: 100,
      rawEntry: { uid: "defaulted", key: ["alpha"], content: "Defaulted lore" },
    }],
  });
  const stMaterialized = createPortableWorldBook({
    entries: [createPortableWorldBookEntry({
      id: "defaulted",
      keys: ["alpha"],
      secondaryKeys: [],
      content: "Defaulted lore",
      rawEntry: {
        ...createPortableWorldBookEntry().rawEntry,
        uid: "defaulted",
        key: ["alpha"],
        keysecondary: [],
        content: "Defaulted lore",
      },
    })],
  });
  const representationVariant = clone(stMaterialized);
  representationVariant.rawWorldBook.originalData = { source: "character-card" };
  representationVariant.rawWorldBook.vendor = { changed: true };
  representationVariant.entries[0].rawEntry.displayIndex = 999;
  representationVariant.entries[0].rawEntry.addMemo = true;
  representationVariant.entries[0].rawEntry.extensions.vendor = { arbitrary: "preserved" };

  const defaultHash = hashCanonicalProjection(createCanonicalWorldBookProjection(managerDefaulted));
  assert.equal(defaultHash, hashCanonicalProjection(createCanonicalWorldBookProjection(stMaterialized)));
  assert.equal(defaultHash, hashCanonicalProjection(createCanonicalWorldBookProjection(representationVariant)));

  // An explicit choice is never replaced by a default.
  for (const [field, value] of [["useProbability", false], ["role", null], ["delayUntilRecursion", true],
    ["comment", "Entry title"], ["useRegex", true]]) {
    const explicit = clone(managerDefaulted);
    explicit.entries[0][field] = value;
    assert.notEqual(defaultHash, hashCanonicalProjection(createCanonicalWorldBookProjection(explicit)), field);
  }
});

test("worldbook projection hashes every supported World Info semantic field", () => {
  const baseline = createPortableWorldBook();
  const baselineHash = hashCanonicalProjection(createCanonicalWorldBookProjection(baseline));

  for (const field of CANONICAL_WORLDBOOK_ENTRY_FIELDS) {
    const changed = clone(baseline);
    const entry = changed.entries[0];

    if (field === "id") entry.id = "entry-43";
    else if (field === "keys") entry.keys = ["changed-primary"];
    else if (field === "secondaryKeys") entry.secondaryKeys = ["changed-secondary"];
    else if (field === "content") entry.content = "Changed lore content";
    else if (["constant", "vectorized", "selective", "enabled", "excludeRecursion", "preventRecursion", "ignoreBudget", "matchPersonaDescription", "matchCharacterDescription", "matchCharacterPersonality", "matchCharacterDepthPrompt", "matchScenario", "matchCreatorNotes", "groupOverride"].includes(field)) entry[field] = !entry[field];
    else if (["selectiveLogic", "position", "order", "probability", "depth", "role", "delayUntilRecursion", "groupWeight"].includes(field)) entry[field] = entry[field] + 1;
    else if (["scanDepth", "sticky", "cooldown", "delay"].includes(field)) entry[field] = 1;
    else if (["caseSensitive", "matchWholeWords", "useGroupScoring"].includes(field)) entry[field] = true;
    else if (["outletName", "group"].includes(field)) entry[field] = "changed";
    else if (field === "triggers") entry.triggers = ["normal"];
    else if (field === "useProbability") entry.useProbability = false;
    else if (field === "comment") entry.comment = "Changed title";
    else if (field === "useRegex") entry.useRegex = true;
    else throw new Error(`Missing mutation fixture for ${field}.`);

    assert.notEqual(
      baselineHash,
      hashCanonicalProjection(createCanonicalWorldBookProjection(changed)),
      field,
    );
  }

  const nameChanged = clone(baseline);
  nameChanged.name = "Changed Worldbook Name";
  assert.notEqual(
    baselineHash,
    hashCanonicalProjection(createCanonicalWorldBookProjection(nameChanged)),
    "name",
  );
});

test("worldbook projection treats keys as unordered multisets and uses ST runtime order semantics", () => {
  const baseline = createPortableWorldBook({
    entries: [
      createPortableWorldBookEntry({ id: "low", order: 10, rawEntry: { uid: "low" } }),
      createPortableWorldBookEntry({ id: "high", order: 90, rawEntry: { uid: "high" } }),
    ],
  });
  const storageReordered = clone(baseline);
  storageReordered.entries.reverse();
  const keysReordered = clone(baseline);
  keysReordered.entries[0].keys.reverse();
  keysReordered.entries[0].secondaryKeys.reverse();
  const duplicateKey = clone(baseline);
  duplicateKey.entries[0].keys.push("alpha");
  const equalOrder = clone(baseline);
  equalOrder.entries[0].order = 50;
  equalOrder.entries[1].order = 50;
  const equalOrderReordered = clone(equalOrder);
  equalOrderReordered.entries.reverse();

  const baselineHash = hashCanonicalProjection(createCanonicalWorldBookProjection(baseline));
  assert.equal(baselineHash, hashCanonicalProjection(createCanonicalWorldBookProjection(storageReordered)));
  assert.equal(baselineHash, hashCanonicalProjection(createCanonicalWorldBookProjection(keysReordered)));
  assert.notEqual(baselineHash, hashCanonicalProjection(createCanonicalWorldBookProjection(duplicateKey)));
  assert.notEqual(
    hashCanonicalProjection(createCanonicalWorldBookProjection(equalOrder)),
    hashCanonicalProjection(createCanonicalWorldBookProjection(equalOrderReordered)),
  );
});

test("worldbook projection reports nonportable character filters and automation without hashing them", () => {
  const worldbook = createPortableWorldBook();
  worldbook.entries[0].rawEntry.characterFilter = {
    isExclude: false,
    names: ["local-avatar.png"],
    tags: ["local-tag-id"],
  };
  worldbook.entries[0].rawEntry.extensions.automation_id = "third-party-plugin-rule";
  const variant = clone(worldbook);
  variant.entries[0].rawEntry.characterFilter.names = ["another-local-avatar.png"];
  variant.entries[0].rawEntry.extensions.automation_id = "another-rule";

  assert.equal(
    hashCanonicalProjection(createCanonicalWorldBookProjection(worldbook)),
    hashCanonicalProjection(createCanonicalWorldBookProjection(variant)),
  );
  assert.deepEqual(getCanonicalWorldBookProjectionDiagnostics(worldbook), [
    { code: "unsupported_nonportable_character_filter", entryId: "entry-42" },
    { code: "unsupported_nonportable_automation_id", entryId: "entry-42" },
    { code: "unsupported_nonportable_entry_field", entryId: "entry-42", field: "vendor" },
    { code: "unsupported_nonportable_worldbook_field", field: "vendor" },
  ]);
});
