import { createHash } from "node:crypto";
import { stableSerialize } from "./syncProjection.js";

// The same value as syncProjection.js hashCanonicalProjection. The shared sync
// core hashes with a pure-JS SHA-256 so non-secure browser pages can run it;
// Manager runs in Node, whose native SHA-256 is about ten times faster.
export function hashCanonicalProjection(projection) {
  return `sha256:${createHash("sha256").update(stableSerialize(projection), "utf8").digest("hex")}`;
}
