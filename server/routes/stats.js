import { Router } from "express";
import { readDb } from "../services/jsonStorage.js";
import { unexpectedErrorSender } from "./routeHelpers.js";
import { normalizeTagList } from "../services/tagList.js";

const router = Router();
const sendUnexpectedError = unexpectedErrorSender("Stats API");

// Sorted for display; counting and matching follow the stored-tag rule.
function getUniqueTags(character) {
  return normalizeTagList(character.tags).sort((left, right) => left.localeCompare(right));
}

function roundPercentage(value) {
  return Math.round(value * 10) / 10;
}

function getTagCounts(characters) {
  const tagCounts = new Map();

  for (const character of characters) {
    for (const tag of getUniqueTags(character)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return tagCounts;
}

function getSortedTagCounts(tagCounts) {
  return [...tagCounts.entries()].sort((left, right) => {
    const countDifference = right[1] - left[1];
    return countDifference || left[0].localeCompare(right[0]);
  });
}

function createTagDistributionForPie(sortedTagCounts) {
  const totalAssignments = sortedTagCounts.reduce((sum, [, count]) => sum + count, 0);
  const topTags = sortedTagCounts.slice(0, 8);
  const remainingTags = sortedTagCounts.slice(8);
  const distribution = topTags.map(([tag, count]) => ({
    tag,
    count,
    percentageOfAllTagAssignments: totalAssignments
      ? roundPercentage((count / totalAssignments) * 100)
      : 0,
  }));

  if (remainingTags.length > 0) {
    const otherCount = remainingTags.reduce((sum, [, count]) => sum + count, 0);
    distribution.push({
      tag: "Other",
      count: otherCount,
      percentageOfAllTagAssignments: totalAssignments
        ? roundPercentage((otherCount / totalAssignments) * 100)
        : 0,
    });
  }

  return distribution;
}

function createTagCoverage(sortedTagCounts, totalCharacters) {
  return sortedTagCounts.map(([tag, characterCount]) => ({
    tag,
    characterCount,
    percentageOfCharacters: totalCharacters
      ? roundPercentage((characterCount / totalCharacters) * 100)
      : 0,
  }));
}

function createTopTagCombinations(characters) {
  const combinationCounts = new Map();

  for (const character of characters) {
    const tags = getUniqueTags(character);

    for (let leftIndex = 0; leftIndex < tags.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < tags.length; rightIndex += 1) {
        const key = `${tags[leftIndex]}\u0000${tags[rightIndex]}`;
        combinationCounts.set(key, (combinationCounts.get(key) || 0) + 1);
      }
    }
  }

  return [...combinationCounts.entries()]
    .map(([key, count]) => ({
      tags: key.split("\u0000"),
      count,
      percentageOfCharacters: characters.length
        ? roundPercentage((count / characters.length) * 100)
        : 0,
    }))
    .sort((left, right) => {
      const countDifference = right.count - left.count;
      return countDifference || left.tags.join(" + ").localeCompare(right.tags.join(" + "));
    })
    .slice(0, 20);
}

function createWorldbookUsage(characters, worldbooks) {
  return worldbooks
    .map((worldBook) => ({
      worldBookId: worldBook.id,
      name: worldBook.name || "Unnamed worldbook",
      linkedCharacterCount: characters.filter(
        (character) => character.worldBookId === worldBook.id,
      ).length,
    }))
    .sort((left, right) => {
      const countDifference = right.linkedCharacterCount - left.linkedCharacterCount;
      return countDifference || left.name.localeCompare(right.name);
    });
}

function createRpStats(db) {
  const characters = Array.isArray(db.characters) ? db.characters : [];
  const worldbooks = Array.isArray(db.worldbooks) ? db.worldbooks : [];
  const totalCharacters = characters.length;
  const totalWorldbooks = worldbooks.length;
  const worldbookLinkedCharacters = characters.filter((character) => character.worldBookId).length;
  const uniqueTagsByCharacter = characters.map(getUniqueTags);
  const totalUniqueTagAssignments = uniqueTagsByCharacter.reduce(
    (sum, tags) => sum + tags.length,
    0,
  );
  const tagCounts = getTagCounts(characters);
  const sortedTagCounts = getSortedTagCounts(tagCounts);

  return {
    totalCharacters,
    totalWorldbooks,
    worldbookLinkedCharacters,
    worldbookCoveragePercentage: totalCharacters
      ? roundPercentage((worldbookLinkedCharacters / totalCharacters) * 100)
      : 0,
    averageTagsPerCharacter: totalCharacters
      ? roundPercentage(totalUniqueTagAssignments / totalCharacters)
      : 0,
    tagDistributionForPie: createTagDistributionForPie(sortedTagCounts),
    tagCoverage: createTagCoverage(sortedTagCounts, totalCharacters),
    topTagCombinations: createTopTagCombinations(characters),
    worldbookUsage: createWorldbookUsage(characters, worldbooks),
  };
}

function createTagDetail(db, selectedTag) {
  const characters = Array.isArray(db.characters) ? db.characters : [];
  const worldbooks = Array.isArray(db.worldbooks) ? db.worldbooks : [];
  const matchingCharacters = characters.filter((character) =>
    getUniqueTags(character).includes(selectedTag),
  );
  const commonCombinationCounts = new Map();
  const linkedWorldBookCounts = new Map();

  for (const character of matchingCharacters) {
    for (const tag of getUniqueTags(character)) {
      if (tag !== selectedTag) {
        commonCombinationCounts.set(tag, (commonCombinationCounts.get(tag) || 0) + 1);
      }
    }

    if (character.worldBookId) {
      linkedWorldBookCounts.set(
        character.worldBookId,
        (linkedWorldBookCounts.get(character.worldBookId) || 0) + 1,
      );
    }
  }

  return {
    tag: selectedTag,
    characterCount: matchingCharacters.length,
    percentageOfCharacters: characters.length
      ? roundPercentage((matchingCharacters.length / characters.length) * 100)
      : 0,
    characters: matchingCharacters
      .map((character) => ({
        id: character.id,
        name: character.name || "Unnamed character",
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    commonCombinations: [...commonCombinationCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
    linkedWorldbooks: [...linkedWorldBookCounts.entries()]
      .map(([id, characterCount]) => {
        const worldBook = worldbooks.find((candidate) => candidate.id === id);
        return {
          id,
          name: worldBook?.name || "Unnamed worldbook",
          characterCount,
        };
      })
      .sort((left, right) => {
        const countDifference = right.characterCount - left.characterCount;
        return countDifference || left.name.localeCompare(right.name);
      }),
  };
}

router.get("/rp", async (_request, response) => {
  try {
    return response.json(createRpStats(await readDb()));
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

router.get("/rp/tags/:tag", async (request, response) => {
  try {
    return response.json(createTagDetail(await readDb(), request.params.tag));
  } catch (error) {
    return sendUnexpectedError(response, error);
  }
});

export default router;
