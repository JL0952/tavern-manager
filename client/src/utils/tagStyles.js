export function createTagMetadataMap(tagSummaries = []) {
  return new Map(
    tagSummaries
      .filter((tag) => tag?.name)
      .map((tag) => [tag.name, tag]),
  );
}

export function getTagTextStyle(tagName, tagMetadataByName) {
  const color = tagMetadataByName.get(tagName)?.color;

  return color ? { color } : undefined;
}
