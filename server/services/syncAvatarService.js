import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  avatarFilePaths,
  avatarImageCandidates,
  defaultAvatarsDirectory,
  defaultCardsDirectory,
  imageMimeType,
  stripCardChunks,
} from "./characterAvatar.js";
import { getCharacterById, readDbSnapshot, updateCharacter } from "./jsonStorage.js";
import { SyncWriteNotFoundError, SyncWriteValidationError } from "./syncWriteService.js";

// Avatars travel beside canonical content: they are never hashed, so writing
// one leaves the sync revision and content hash unchanged.
export function createSyncAvatarService({
  readSnapshot = readDbSnapshot,
  getCharacter = getCharacterById,
  saveCharacter = updateCharacter,
  avatarsDirectory = defaultAvatarsDirectory,
  cardsDirectory = defaultCardsDirectory,
} = {}) {
  const directories = { avatarsDirectory, cardsDirectory };

  async function readImage(character) {
    for (const filePath of avatarImageCandidates(character, directories)) {
      let buffer;

      try {
        buffer = await readFile(filePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }

      const type = imageMimeType(buffer);
      if (type) return { buffer, type };
    }

    return null;
  }

  async function read(id) {
    const db = await readSnapshot();
    const character = db.characters.find((candidate) => candidate.id === id);

    if (!character) {
      throw new SyncWriteNotFoundError("character", id);
    }

    return readImage(character);
  }

  async function write(id, buffer) {
    if (!Buffer.isBuffer(buffer) || imageMimeType(buffer) !== "image/png") {
      throw new SyncWriteValidationError("Avatar must be a PNG image.");
    }

    let image;

    try {
      image = stripCardChunks(buffer);
    } catch {
      throw new SyncWriteValidationError("Avatar is not a readable PNG image.");
    }

    const character = await getCharacter(id);

    if (!character) {
      throw new SyncWriteNotFoundError("character", id);
    }

    if ((await readImage(character))?.buffer.equals(image)) {
      return { outcome: "unchanged" };
    }

    const fileName = `${id.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${Date.now()}-${randomUUID()}.png`;
    const filePath = resolve(avatarsDirectory, fileName);
    await mkdir(avatarsDirectory, { recursive: true });
    await writeFile(filePath, image);

    let saved;

    try {
      saved = await saveCharacter(id, { avatar: `avatars/${fileName}`, avatarPng: `avatars/${fileName}`, avatarSource: "uploaded" });
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }

    if (!saved) {
      await rm(filePath, { force: true });
      throw new SyncWriteNotFoundError("character", id);
    }

    // The replaced avatar files belong to this character only.
    await Promise.all(avatarFilePaths(character, directories)
      .filter((path) => path !== filePath)
      .map((path) => rm(path, { force: true })));

    return { outcome: "updated" };
  }

  return Object.freeze({ read, write });
}
