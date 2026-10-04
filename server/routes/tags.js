import { Router } from "express";
import { withSyncedRawCard } from "../services/characterRawCard.js";
import { mutateLibrary, readDb } from "../services/jsonStorage.js";
import { unexpectedErrorSender } from "./routeHelpers.js";
import { isPlainObject } from "../services/objects.js";
import { normalizeTagList } from "../services/tagList.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("Tag API");

class TagError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeTagName(value, fieldName = "Tag name") {
  if (typeof value !== "string") {
    throw new TagError(`${fieldName} must be a string.`);
  }

  const name = value.trim();

  if (!name) {
    throw new TagError(`${fieldName} is required.`);
  }

  return name;
}

function roundPercentage(value) {
  return Math.round(value * 10) / 10;
}

function getDefinitionIndex(db, name) {
  return db.tagDefinitions.findIndex((definition) => definition?.name === name);
}

function getDefinition(db, name) {
  return db.tagDefinitions.find((definition) => definition?.name === name) || {};
}

function createTagSummary(db, name) {
  const characters = db.characters
    .filter((character) => normalizeTagList(character.tags).includes(name))
    .map((character) => ({
      id: character.id,
      name: character.name || "Unnamed character",
    }));
  const definition = getDefinition(db, name);

  return {
    name,
    count: characters.length,
    percentageOfCharacters: db.characters.length
      ? roundPercentage((characters.length / db.characters.length) * 100)
      : 0,
    color: typeof definition.color === "string" ? definition.color : "",
    category: typeof definition.category === "string" ? definition.category : "",
    characters,
  };
}

function createTagSummaries(db) {
  const tagNames = new Set();

  for (const character of db.characters) {
    for (const tag of normalizeTagList(character.tags)) {
      tagNames.add(tag);
    }
  }

  for (const definition of db.tagDefinitions) {
    if (typeof definition?.name === "string" && definition.name.trim()) {
      tagNames.add(definition.name.trim());
    }
  }

  return [...tagNames]
    .map((name) => createTagSummary(db, name))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function replaceTags(tags, sourceTags, targetTag = null) {
  const sourceSet = new Set(sourceTags);
  const nextTags = [];

  for (const tag of normalizeTagList(tags)) {
    const nextTag = sourceSet.has(tag) ? targetTag : tag;

    if (nextTag && !nextTags.includes(nextTag)) {
      nextTags.push(nextTag);
    }
  }

  return nextTags;
}

function tagArraysMatch(left, right) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function mutateCharacterTags(db, mutateTags) {
  const updatedAt = new Date().toISOString();
  const updatedCharacters = [];

  for (const character of db.characters) {
    const currentTags = normalizeTagList(character.tags);
    const nextTags = mutateTags(currentTags);

    if (tagArraysMatch(currentTags, nextTags)) {
      continue;
    }

    character.tags = nextTags;
    character.updatedAt = updatedAt;
    updatedCharacters.push(character);
  }

  return updatedCharacters;
}

function createMutableTagDb(transaction) {
  return {
    characters: transaction.listCharacters(),
    tagDefinitions: transaction.getTagDefinitions(),
  };
}

function commitTagChanges(transaction, db, updatedCharacters) {
  for (const character of updatedCharacters) {
    transaction.updateCharacter(character.id, () => withSyncedRawCard(character));
  }

  transaction.replaceTagDefinitions(db.tagDefinitions);
}

function readMetadata(body) {
  if (!isPlainObject(body)) {
    throw new TagError("Request body must be a JSON object.");
  }

  return {
    color: typeof body.color === "string" ? body.color.trim() : "",
    category: typeof body.category === "string" ? body.category.trim() : "",
  };
}

function upsertDefinition(db, name, metadata) {
  const index = getDefinitionIndex(db, name);

  if (index === -1) {
    db.tagDefinitions.push({ name, ...metadata });
    return;
  }

  db.tagDefinitions[index] = {
    ...db.tagDefinitions[index],
    name,
    ...metadata,
  };
}

function moveDefinition(db, oldName, newName) {
  const oldIndex = getDefinitionIndex(db, oldName);
  const newIndex = getDefinitionIndex(db, newName);

  if (oldIndex === -1) {
    return;
  }

  const oldDefinition = db.tagDefinitions[oldIndex];

  if (newIndex === -1) {
    db.tagDefinitions[oldIndex] = { ...oldDefinition, name: newName };
    return;
  }

  db.tagDefinitions[newIndex] = {
    ...oldDefinition,
    ...db.tagDefinitions[newIndex],
    name: newName,
  };
  db.tagDefinitions.splice(oldIndex, 1);
}

function mergeDefinitions(db, sourceTags, targetTag) {
  const targetIndex = getDefinitionIndex(db, targetTag);
  const sourceDefinitions = sourceTags
    .map((sourceTag) => getDefinition(db, sourceTag))
    .filter((definition) => definition.name);

  if (targetIndex === -1) {
    const fallbackDefinition = sourceDefinitions[0] || {};
    db.tagDefinitions.push({
      ...fallbackDefinition,
      name: targetTag,
      color: typeof fallbackDefinition.color === "string" ? fallbackDefinition.color : "",
      category: typeof fallbackDefinition.category === "string" ? fallbackDefinition.category : "",
    });
  }

  db.tagDefinitions = db.tagDefinitions.filter(
    (definition) => !sourceTags.includes(definition?.name),
  );
}

router.get("/", async (_request, response) => {
  try {
    return response.json(createTagSummaries(await readDb()));
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.post("/", async (request, response) => {
  try {
    const name = normalizeTagName(request.body?.name);
    const metadata = readMetadata(request.body);
    const tag = await mutateLibrary((transaction) => {
      const db = createMutableTagDb(transaction);

      if (getDefinitionIndex(db, name) !== -1) {
        throw new TagError(`Tag definition "${name}" already exists.`, 409);
      }

      db.tagDefinitions.push({ name, ...metadata });
      commitTagChanges(transaction, db, []);
      return createTagSummary(db, name);
    });

    return response.status(201).json(tag);
  } catch (error) {
    if (error instanceof TagError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.put("/:name", async (request, response) => {
  try {
    const name = normalizeTagName(request.params.name);
    const metadata = readMetadata(request.body);
    const tag = await mutateLibrary((transaction) => {
      const db = createMutableTagDb(transaction);
      upsertDefinition(db, name, metadata);
      commitTagChanges(transaction, db, []);
      return createTagSummary(db, name);
    });

    return response.json(tag);
  } catch (error) {
    if (error instanceof TagError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.post("/:name/rename", async (request, response) => {
  try {
    const oldName = normalizeTagName(request.params.name);
    const newName = normalizeTagName(request.body?.newName, "New tag name");
    const result = await mutateLibrary((transaction) => {
      const db = createMutableTagDb(transaction);

      if (oldName === newName) {
        return {
          affectedCharacterCount: 0,
          tag: createTagSummary(db, newName),
        };
      }

      const updatedCharacters = mutateCharacterTags(db, (tags) =>
        replaceTags(tags, [oldName], newName),
      );
      moveDefinition(db, oldName, newName);
      commitTagChanges(transaction, db, updatedCharacters);

      return {
        affectedCharacterCount: updatedCharacters.length,
        tag: createTagSummary(db, newName),
      };
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof TagError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.post("/merge", async (request, response) => {
  try {
    const sourceTags = [
      ...new Set((Array.isArray(request.body?.sourceTags) ? request.body.sourceTags : [])
        .map((tag) => normalizeTagName(tag, "Source tag"))),
    ];
    const targetTag = normalizeTagName(request.body?.targetTag, "Target tag");
    const mergedSourceTags = sourceTags.filter((sourceTag) => sourceTag !== targetTag);

    if (mergedSourceTags.length === 0) {
      throw new TagError("Choose at least one source tag different from the target tag.");
    }
    const result = await mutateLibrary((transaction) => {
      const db = createMutableTagDb(transaction);
      const updatedCharacters = mutateCharacterTags(db, (tags) =>
        replaceTags(tags, mergedSourceTags, targetTag),
      );
      mergeDefinitions(db, mergedSourceTags, targetTag);
      commitTagChanges(transaction, db, updatedCharacters);

      return {
        affectedCharacterCount: updatedCharacters.length,
        tag: createTagSummary(db, targetTag),
      };
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof TagError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

router.delete("/:name", async (request, response) => {
  try {
    const name = normalizeTagName(request.params.name);
    const result = await mutateLibrary((transaction) => {
      const db = createMutableTagDb(transaction);
      const updatedCharacters = mutateCharacterTags(db, (tags) => replaceTags(tags, [name]));
      db.tagDefinitions = db.tagDefinitions.filter((definition) => definition?.name !== name);
      commitTagChanges(transaction, db, updatedCharacters);

      return {
        affectedCharacterCount: updatedCharacters.length,
        deleted: true,
      };
    });

    return response.json(result);
  } catch (error) {
    if (error instanceof TagError) {
      return response.status(error.status).json({ error: error.message });
    }

    return sendUnexpectedError(response, error);
  }
});

export default router;
