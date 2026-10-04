import { CANONICAL_CHARACTER_FIELDS } from "./syncProjection.js";
import { isPlainObject } from "./objects.js";

// V2/V3 cards repeat these fields next to `data`; SillyTavern writes them and
// cardExporter.js regenerates them on export.
const rootMirrorFields = ["name", "description", "personality", "scenario", "first_mes", "mes_example", "tags"];

// A character record holds its card fields twice: on the record, which Manager
// edits, exports and hashes, and inside rawCard, the card file shape. Returns a
// copy whose rawCard carries the record's values for those fields (and their
// existing root mirrors), so the two never disagree. Every other rawCard field
// (extensions, vendor data, legacy-only shapes) is left as it was.
export function withSyncedRawCard(character) {
  if (!isPlainObject(character?.rawCard)) {
    return character;
  }

  const rawCard = structuredClone(character.rawCard);
  const data = isPlainObject(rawCard.data) ? rawCard.data : rawCard;

  for (const field of CANONICAL_CHARACTER_FIELDS) {
    if (Object.hasOwn(character, field)) {
      data[field] = structuredClone(character[field]);
    }
  }

  if (data !== rawCard) {
    for (const field of rootMirrorFields) {
      if (Object.hasOwn(rawCard, field) && Object.hasOwn(character, field)) {
        rawCard[field] = structuredClone(character[field]);
      }
    }
  }

  if (Object.hasOwn(rawCard, "creatorcomment") && Object.hasOwn(character, "creator_notes")) {
    rawCard.creatorcomment = character.creator_notes;
  }

  return { ...character, rawCard };
}
