// Character's Note is an in-chat depth prompt, not the card author's notes.
export function normalizeCharacterNote(value) {
  if (value == null) return { prompt: "", depth: 4, role: "system" };
  if (typeof value !== "object" || Array.isArray(value)
    || (value.prompt !== undefined && typeof value.prompt !== "string")
    || (value.depth !== undefined && (!Number.isSafeInteger(value.depth) || value.depth < 0))
    || (value.role !== undefined && !["system", "user", "assistant"].includes(value.role))) {
    throw new Error("Character's Note requires a text prompt, non-negative integer depth and system/user/assistant role.");
  }
  return { prompt: value.prompt ?? "", depth: value.depth ?? 4, role: value.role ?? "system" };
}
