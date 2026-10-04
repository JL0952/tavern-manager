import { Router } from "express";
import { readDb } from "../services/jsonStorage.js";
import { unexpectedErrorSender } from "./routeHelpers.js";
import { normalizeTagList } from "../services/tagList.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("Library graph API");

class LibraryGraphQueryError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLabel(value, fallback) {
  return normalizeText(value) || fallback;
}

function normalizeId(value) {
  return normalizeText(value);
}

function normalizeAvatarPath(value) {
  const path = normalizeText(value);

  if (!path.startsWith("avatars/")) {
    return "";
  }

  const fileName = path.slice("avatars/".length);

  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    return "";
  }

  return path;
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseBooleanQuery(query, name, defaultValue) {
  const value = query[name];

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string") {
    throw new LibraryGraphQueryError(`Query parameter "${name}" must be true or false.`);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new LibraryGraphQueryError(`Query parameter "${name}" must be true or false.`);
}

function parseQuery(query) {
  const search = query.search;

  if (search !== undefined && typeof search !== "string") {
    throw new LibraryGraphQueryError('Query parameter "search" must be a string.');
  }

  return {
    includeOrphans: parseBooleanQuery(query, "includeOrphans", true),
    pinnedOnly: parseBooleanQuery(query, "pinnedOnly", false),
    search: normalizeText(search).toLowerCase(),
  };
}

function createWorldBookLookup(worldbooks) {
  return new Map(
    worldbooks
      .map((worldBook) => [normalizeId(worldBook?.id), worldBook])
      .filter(([id]) => id),
  );
}

function createWorldBookLinkCounts(characters, worldBookById) {
  const counts = new Map();

  for (const character of characters) {
    const worldBookId = normalizeId(character?.worldBookId);

    if (worldBookById.has(worldBookId)) {
      counts.set(worldBookId, (counts.get(worldBookId) || 0) + 1);
    }
  }

  return counts;
}

function matchesSearch(label, search) {
  return !search || label.toLowerCase().includes(search);
}

function getCharacterProjection(character, worldBookById) {
  const id = normalizeId(character?.id);
  const worldBookId = normalizeId(character?.worldBookId);
  const hasValidWorldBook = Boolean(worldBookId && worldBookById.has(worldBookId));

  return {
    id,
    nodeId: `character:${id}`,
    label: normalizeLabel(character?.name, "Untitled character"),
    pinned: Boolean(character?.pinned),
    orphan: !hasValidWorldBook,
    worldBookId: hasValidWorldBook ? worldBookId : null,
    tags: normalizeTagList(character?.tags),
    avatar: normalizeAvatarPath(character?.avatar),
  };
}

function getWorldBookProjection(worldBook, linkedCharacterCount) {
  const id = normalizeId(worldBook?.id);

  return {
    id,
    nodeId: `worldbook:${id}`,
    label: normalizeLabel(worldBook?.name, "Untitled worldbook"),
    linkedCharacterCount,
    entryCount: getArray(worldBook?.entries).length,
  };
}

function shouldIncludeCharacter(character, worldBookLabels, options) {
  if (options.pinnedOnly && !character.pinned) {
    return false;
  }

  if (!options.includeOrphans && character.orphan) {
    return false;
  }

  if (!options.search) {
    return true;
  }

  if (matchesSearch(character.label, options.search)) {
    return true;
  }

  return (
    character.worldBookId &&
    matchesSearch(worldBookLabels.get(character.worldBookId) || "", options.search)
  );
}

function createCharacterNode(character) {
  return {
    id: character.nodeId,
    type: "character",
    entityId: character.id,
    label: character.label,
    route: `/cards/${encodeURIComponent(character.id)}`,
    pinned: character.pinned,
    orphan: character.orphan,
    worldBookId: character.worldBookId,
    tags: character.tags,
    avatar: character.avatar,
  };
}

function createWorldBookNode(worldBook) {
  return {
    id: worldBook.nodeId,
    type: "worldbook",
    entityId: worldBook.id,
    label: worldBook.label,
    route: `/worldbooks/${encodeURIComponent(worldBook.id)}`,
    metadata: {
      linkedCharacterCount: worldBook.linkedCharacterCount,
      entryCount: worldBook.entryCount,
    },
  };
}

function createCharacterWorldBookEdge(character) {
  return {
    id: `${character.nodeId}--worldbook:${character.worldBookId}`,
    type: "character_worldbook",
    source: character.nodeId,
    target: `worldbook:${character.worldBookId}`,
    weight: 1,
  };
}

export function createLibraryGraph(db, options = {}) {
  const parsedOptions = {
    includeOrphans: options.includeOrphans !== false,
    pinnedOnly: Boolean(options.pinnedOnly),
    search: normalizeText(options.search).toLowerCase(),
  };
  const characters = getArray(db?.characters);
  const worldbooks = getArray(db?.worldbooks);
  const worldBookById = createWorldBookLookup(worldbooks);
  const worldBookLinkCounts = createWorldBookLinkCounts(characters, worldBookById);
  const worldBookProjections = worldbooks
    .map((worldBook) =>
      getWorldBookProjection(
        worldBook,
        worldBookLinkCounts.get(normalizeId(worldBook?.id)) || 0,
      ),
    )
    .filter((worldBook) => worldBook.id);
  const worldBookLabels = new Map(
    worldBookProjections.map((worldBook) => [worldBook.id, worldBook.label]),
  );
  const characterProjections = characters
    .map((character) => getCharacterProjection(character, worldBookById))
    .filter((character) => character.id);
  const visibleCharacters = characterProjections.filter((character) =>
    shouldIncludeCharacter(character, worldBookLabels, parsedOptions),
  );
  const visibleCharacterWorldBookIds = new Set(
    visibleCharacters.map((character) => character.worldBookId).filter(Boolean),
  );
  const visibleWorldBooks = worldBookProjections.filter((worldBook) => {
    if (parsedOptions.pinnedOnly) {
      return visibleCharacterWorldBookIds.has(worldBook.id);
    }

    if (parsedOptions.search) {
      return (
        visibleCharacterWorldBookIds.has(worldBook.id) ||
        matchesSearch(worldBook.label, parsedOptions.search)
      );
    }

    return true;
  });
  const visibleWorldBookIds = new Set(visibleWorldBooks.map((worldBook) => worldBook.id));
  const nodes = [
    ...visibleCharacters.map(createCharacterNode),
    ...visibleWorldBooks.map(createWorldBookNode),
  ];
  const edges = visibleCharacters
    .filter((character) => character.worldBookId && visibleWorldBookIds.has(character.worldBookId))
    .map(createCharacterWorldBookEdge);

  return {
    nodes,
    edges,
    metadata: {
      generatedAt: new Date().toISOString(),
      counts: {
        characters: visibleCharacters.length,
        worldbooks: visibleWorldBooks.length,
        orphans: visibleCharacters.filter((character) => character.orphan).length,
      },
    },
  };
}

router.get("/", async (request, response) => {
  try {
    const options = parseQuery(request.query);

    return response.json(createLibraryGraph(await readDb(), options));
  } catch (error) {
    if (error instanceof LibraryGraphQueryError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

export default router;
