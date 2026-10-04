import { relayContentHash } from "../../../server/services/relayContent.js";

export const relayTypes = Object.freeze([
  { id: "presets", label: "Presets", noun: "preset", description: "Chat completion presets" },
  { id: "themes", label: "Themes", noun: "theme", description: "UI themes" },
  { id: "regex", label: "Regex", noun: "regex script", description: "Global regex scripts" },
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function upload(type, name, contents, value) {
  return { name, contents, contentHash: relayContentHash(type, value) };
}

// The uploads one chosen file becomes, named the way SillyTavern names them:
// a preset by its file name, a theme by its "name" field, a regex script by
// its scriptName. A regex file exported in bulk holds several scripts; each
// becomes its own file, written as SillyTavern exports a single script. The
// file is only read here, in the browser; Manager stores what it is sent.
export function relayUploadsFromText(type, fileName, text) {
  let value;

  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Not a JSON file.");
  }

  if (type === "presets") {
    if (!isPlainObject(value)) throw new Error("A preset file holds one JSON object.");
    const name = String(fileName).replace(/\.[^/.]+$/, "");
    if (!name) throw new Error("The file needs a name.");
    return [upload(type, name, text, value)];
  }

  if (type === "themes") {
    if (!isPlainObject(value) || typeof value.name !== "string" || !value.name) {
      throw new Error("A theme file needs a name field.");
    }
    return [upload(type, value.name, text, value)];
  }

  if (type === "regex") {
    const scripts = Array.isArray(value) ? value : [value];
    if (scripts.length === 0) throw new Error("The file holds no regex scripts.");
    if (scripts.some((script) => !isPlainObject(script) || typeof script.scriptName !== "string" || !script.scriptName)) {
      throw new Error("Every regex script needs a scriptName.");
    }
    return scripts.map((script) =>
      upload(type, script.scriptName, Array.isArray(value) ? JSON.stringify(script, null, 4) : text, script));
  }

  throw new Error("Unknown file type.");
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
