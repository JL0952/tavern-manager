// What the relay compares: a file's JSON content, serialized canonically so
// formatting and key order do not count. A regex script is compared without
// its id, which SillyTavern assigns anew on every import, and a theme without
// its name, which is the file's name in Manager and may differ for a copy kept
// beside another of the same name. Isomorphic: the Manager page and the
// SillyTavern extension hash with this same source; Manager's server stores
// relay files without reading them.
import { sha256Hex } from "./sha256.js";
import { stableSerialize } from "./syncProjection.js";

export function relayContentHash(type, value) {
  if (value === undefined) {
    throw new Error("Relay content is missing.");
  }

  // As saving a file would: undefined fields drop out, dates become strings.
  const json = JSON.parse(JSON.stringify(value));

  if (json && typeof json === "object" && !Array.isArray(json)) {
    if (type === "regex") delete json.id;
    if (type === "themes") delete json.name;
  }

  return `sha256:${sha256Hex(stableSerialize(json))}`;
}
