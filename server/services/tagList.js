// Character tags as Manager stores, counts and compares them: trimmed,
// non-empty strings, each once, in first-seen order. A comma belongs to the
// tag, as in SillyTavern; only text typed into a tag field is split on commas,
// and that happens in the client. The sync hash applies the same rule and then
// sorts (syncProjection.js keeps its own copy, since sync-core has no imports).
export function normalizeTagList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const tags = [];

  for (const tag of value) {
    if (typeof tag !== "string") {
      continue;
    }

    const normalizedTag = tag.trim();

    if (!normalizedTag || seen.has(normalizedTag)) {
      continue;
    }

    seen.add(normalizedTag);
    tags.push(normalizedTag);
  }

  return tags;
}
