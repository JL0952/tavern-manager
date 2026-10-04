export function formatTimestamp(value) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function getWorldBookSourceLabel(source) {
  return source === "character_embedded" ? "Embedded lorebook" : "Standalone worldbook";
}
