import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { getCrc32 } from "./zipExport.js";

// Backup archives, written and read by Node itself so backups work on every
// platform without zip tools installed. Plain zip only: stored or deflated
// entries, UTF-8 names, no zip64 and no encryption, which covers what this app
// writes and what common zip tools produce for a library of this size.

const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endSignature = 0x06054b50;
const utf8NameFlag = 0x0800;
const maxEntries = 0xffff;
const maxSize = 0xffffffff;

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function header(fields) {
  const buffer = Buffer.alloc(fields.reduce((size, [bytes]) => size + bytes, 0));
  let offset = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value >>> 0, offset);
    offset += bytes;
  }
  return buffer;
}

// The files and folders under each target, folders first, in a stable order.
async function collectEntries(baseDirectory, targets) {
  const entries = [];

  async function collect(name) {
    const fullPath = join(baseDirectory, name);
    let info;
    try {
      info = await stat(fullPath);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    if (info.isDirectory()) {
      entries.push({ name: `${name}/`, info });
      for (const child of (await readdir(fullPath)).sort()) await collect(`${name}/${child}`);
    } else if (info.isFile()) {
      entries.push({ name, info, fullPath });
    }
  }

  for (const target of targets) await collect(target);
  return entries;
}

// Writes the targets under baseDirectory (paths relative to it) to zipPath,
// one file at a time.
export async function writeZip(zipPath, baseDirectory, targets) {
  const entries = await collectEntries(baseDirectory, targets);
  if (entries.length > maxEntries) throw new Error("The backup has too many files for a zip archive.");

  const handle = await open(zipPath, "w");
  const centralHeaders = [];
  let offset = 0;

  try {
    for (const entry of entries) {
      const contents = entry.fullPath ? await readFile(entry.fullPath) : Buffer.alloc(0);
      const deflated = contents.length ? deflateRawSync(contents) : contents;
      const method = deflated.length < contents.length ? 8 : 0;
      const data = method === 8 ? deflated : contents;
      const name = Buffer.from(entry.name, "utf8");
      const crc = getCrc32(contents);
      const { time, date } = dosDateTime(entry.info.mtime);

      if (contents.length > maxSize || offset + data.length > maxSize) {
        throw new Error("The backup is too large for a zip archive.");
      }

      const shared = [[2, utf8NameFlag], [2, method], [2, time], [2, date], [4, crc], [4, data.length],
        [4, contents.length], [2, name.length], [2, 0]];
      const localHeader = header([[4, localHeaderSignature], [2, 20], ...shared]);
      await handle.write(Buffer.concat([localHeader, name]));
      await handle.write(data);
      centralHeaders.push(Buffer.concat([header([[4, centralHeaderSignature], [2, 20], [2, 20], ...shared,
        [2, 0], [2, 0], [2, 0], [4, entry.name.endsWith("/") ? 0x10 : 0], [4, offset]]), name]));
      offset += localHeader.length + name.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralHeaders);
    await handle.write(centralDirectory);
    await handle.write(header([[4, endSignature], [2, 0], [2, 0], [2, entries.length], [2, entries.length],
      [4, centralDirectory.length], [4, offset], [2, 0]]));
  } finally {
    await handle.close();
  }
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("The zip file is truncated.");
  return buffer;
}

// The entries a zip's central directory lists.
async function readCentralDirectory(handle) {
  const { size } = await handle.stat();
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = await readAt(handle, size - tailLength, tailLength);
  const endOffset = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("Not a zip file.");

  const count = tail.readUInt16LE(endOffset + 10);
  const directorySize = tail.readUInt32LE(endOffset + 12);
  const directoryOffset = tail.readUInt32LE(endOffset + 16);
  if (count === maxEntries || directorySize === maxSize || directoryOffset === maxSize) {
    throw new Error("Zip64 archives are not supported.");
  }

  const directory = await readAt(handle, directoryOffset, directorySize);
  const entries = [];
  let offset = 0;

  for (let index = 0; index < count; index += 1) {
    if (directory.readUInt32LE(offset) !== centralHeaderSignature) throw new Error("The zip directory is damaged.");
    const nameLength = directory.readUInt16LE(offset + 28);
    entries.push({
      flags: directory.readUInt16LE(offset + 8),
      method: directory.readUInt16LE(offset + 10),
      crc: directory.readUInt32LE(offset + 16),
      compressedSize: directory.readUInt32LE(offset + 20),
      size: directory.readUInt32LE(offset + 24),
      localOffset: directory.readUInt32LE(offset + 42),
      name: directory.toString("utf8", offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
  }

  return entries;
}

export async function listZipEntries(zipPath) {
  const handle = await open(zipPath, "r");
  try {
    return (await readCentralDirectory(handle)).map((entry) => entry.name);
  } finally {
    await handle.close();
  }
}

// Extracts every entry under destination. Names were checked before; an
// entry that would still land outside destination stops the extraction.
export async function extractZip(zipPath, destination) {
  const root = resolve(destination);
  const handle = await open(zipPath, "r");

  try {
    for (const entry of await readCentralDirectory(handle)) {
      const target = resolve(root, entry.name);
      const inside = relative(root, target);
      if (inside === "" && entry.name.endsWith("/")) continue;
      if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
        throw new Error(`Zip entry ${entry.name} is outside the extraction folder.`);
      }

      if (entry.name.endsWith("/")) {
        await mkdir(target, { recursive: true });
        continue;
      }

      if (entry.flags & 1) throw new Error(`Zip entry ${entry.name} is encrypted.`);
      if (![0, 8].includes(entry.method)) throw new Error(`Zip entry ${entry.name} uses an unsupported compression.`);

      const local = await readAt(handle, entry.localOffset, 30);
      if (local.readUInt32LE(0) !== localHeaderSignature) throw new Error(`Zip entry ${entry.name} is damaged.`);
      const dataOffset = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const data = await readAt(handle, dataOffset, entry.compressedSize);
      const contents = entry.method === 8 ? inflateRawSync(data) : data;

      if (contents.length !== entry.size || getCrc32(contents) !== entry.crc) {
        throw new Error(`Zip entry ${entry.name} is damaged.`);
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
  } finally {
    await handle.close();
  }
}
