import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const cardsDirectory = fileURLToPath(new URL("../../data/cards", import.meta.url));
const avatarsDirectory = fileURLToPath(new URL("../../data/avatars", import.meta.url));
const worldBooksDirectory = fileURLToPath(new URL("../../data/worldbooks", import.meta.url));

function sanitizeFileName(fileName) {
  const baseName = fileName.slice(0, -extname(fileName).length);
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

  return safeBaseName || "character";
}

const storage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    try {
      await mkdir(cardsDirectory, { recursive: true });
      callback(null, cardsDirectory);
    } catch (error) {
      callback(error);
    }
  },
  filename: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    const fileName = `${randomUUID()}-${sanitizeFileName(file.originalname)}${extension}`;
    callback(null, fileName);
  },
});

function cardFileFilter(_request, file, callback) {
  const extension = extname(file.originalname).toLowerCase();

  if (![".json", ".png"].includes(extension)) {
    return callback(new Error("Only .json and .png character card files are supported."));
  }

  return callback(null, true);
}

const upload = multer({
  storage,
  fileFilter: cardFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const avatarStorage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    try {
      await mkdir(avatarsDirectory, { recursive: true });
      callback(null, avatarsDirectory);
    } catch (error) {
      callback(error);
    }
  },
  filename: (request, file, callback) => {
    const safeId = request.params.id.replace(/[^a-zA-Z0-9_-]+/g, "-") || "character";
    const extension = getAvatarExtension(file) || ".png";

    callback(null, `${safeId}-${Date.now()}-${randomUUID()}${extension}`);
  },
});

const avatarMimeExtension = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/webp", ".webp"],
]);

const avatarExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function getAvatarExtension(file) {
  const extension = extname(file.originalname).toLowerCase();

  if (avatarExtensions.has(extension)) {
    return extension;
  }

  return avatarMimeExtension.get(file.mimetype) || "";
}

function avatarFileFilter(_request, file, callback) {
  if (!getAvatarExtension(file) && !avatarMimeExtension.has(file.mimetype)) {
    return callback(new Error("Only PNG, JPG, JPEG, or WEBP avatar files are supported."));
  }

  return callback(null, true);
}

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const worldBookStorage = multer.diskStorage({
  destination: async (_request, _file, callback) => {
    try {
      await mkdir(worldBooksDirectory, { recursive: true });
      callback(null, worldBooksDirectory);
    } catch (error) {
      callback(error);
    }
  },
  filename: (_request, file, callback) => {
    callback(null, `${randomUUID()}-${sanitizeFileName(file.originalname)}.json`);
  },
});

function worldBookFileFilter(_request, file, callback) {
  if (extname(file.originalname).toLowerCase() !== ".json") {
    return callback(new Error("Only .json world book files are supported."));
  }

  return callback(null, true);
}

const worldBookUpload = multer({
  storage: worldBookStorage,
  fileFilter: worldBookFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export function uploadCard(request, response, next) {
  upload.single("file")(request, response, (error) => {
    if (error) {
      return response.status(400).json({ error: error.message });
    }

    return next();
  });
}

export function uploadAvatar(request, response, next) {
  avatarUpload.single("file")(request, response, (error) => {
    if (error) {
      return response.status(400).json({ error: error.message });
    }

    return next();
  });
}

export function uploadWorldBook(request, response, next) {
  worldBookUpload.single("file")(request, response, (error) => {
    if (error) {
      return response.status(400).json({ error: error.message });
    }

    return next();
  });
}
