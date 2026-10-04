import { createHash } from "node:crypto";
import {
  CANONICAL_PROJECTION_VERSION,
  stableSerialize,
} from "./syncProjection.js";
import {
  getCanonicalEntityState,
  listCanonicalEntityStates,
  SyncEntityStateIntegrityError,
} from "./syncEntityState.js";

export { SyncEntityStateIntegrityError as SyncReadIntegrityError };

function compareUnicode(left, right) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const length = Math.min(leftCharacters.length, rightCharacters.length);

  for (let index = 0; index < length; index += 1) {
    const difference = leftCharacters[index].codePointAt(0) - rightCharacters[index].codePointAt(0);

    if (difference !== 0) {
      return difference;
    }
  }

  return leftCharacters.length - rightCharacters.length;
}

const notesPreviewLength = 160;
const htmlEntities = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: " " };

// A plain-text start of the creator notes, so clients can tell same-name
// characters apart. Display only: it is not part of any hash.
function createNotesPreview(notes) {
  const text = String(notes ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name) => htmlEntities[name])
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(text);

  return characters.length > notesPreviewLength
    ? `${characters.slice(0, notesPreviewLength).join("").trimEnd()}…`
    : text;
}

function createManifestEntry(entity) {
  const entry = {
    type: entity.type,
    id: entity.id,
    displayName: entity.type === "character" ? entity.projection.card.name : entity.projection.worldbook.name,
    revision: entity.revision,
    contentHash: entity.contentHash,
    updatedAt: entity.updatedAt,
    metadataSource: entity.metadataSource,
  };

  if (entity.type === "character") {
    entry.relationship = structuredClone(entity.projection.relationship);
    const creatorNotes = createNotesPreview(entity.projection.card.creator_notes);

    if (creatorNotes) {
      entry.creatorNotes = creatorNotes;
    }
  }

  if (entity.diagnostics.length > 0) {
    entry.diagnostics = structuredClone(entity.diagnostics);
  }

  return entry;
}

function createResource(entity) {
  const resource = {
    apiVersion: "sync/v1",
    entity: {
      id: entity.id,
      type: entity.type,
      revision: entity.revision,
      contentHash: entity.contentHash,
      updatedAt: entity.updatedAt,
      metadataSource: entity.metadataSource,
      canonical: entity.projection,
    },
  };

  if (entity.diagnostics.length > 0) {
    resource.entity.diagnostics = structuredClone(entity.diagnostics);
  }

  return resource;
}

export function buildSyncManifest(db) {
  const characters = listCanonicalEntityStates(db, "character")
    .sort((left, right) => compareUnicode(left.id, right.id))
    .map(createManifestEntry);
  const worldbooks = listCanonicalEntityStates(db, "worldbook")
    .sort((left, right) => compareUnicode(left.id, right.id))
    .map(createManifestEntry);

  return {
    apiVersion: "sync/v1",
    projectionVersion: CANONICAL_PROJECTION_VERSION,
    characters,
    worldbooks,
  };
}

export function buildSyncResource(db, entityType, id) {
  const entity = getCanonicalEntityState(db, entityType, id);
  return entity ? createResource(entity) : null;
}

export function serializeSyncResponse(payload) {
  const serialized = stableSerialize(payload);
  const hash = createHash("sha256").update(serialized, "utf8").digest("hex");

  return {
    body: serialized,
    etag: `"sha256:${hash}"`,
  };
}
