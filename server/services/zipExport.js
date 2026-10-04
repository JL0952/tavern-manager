export function createTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function sanitizeExportFileName(name, fallbackName) {
  const sanitizedName = String(name || fallbackName)
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();

  return sanitizedName || fallbackName;
}

export function createUniqueExportName(name, extension, usedNames, fallbackName) {
  const baseName = sanitizeExportFileName(name, fallbackName);
  let candidateName = `${baseName}.${extension}`;
  let suffix = 2;

  while (usedNames.has(candidateName)) {
    candidateName = `${baseName} (${suffix}).${extension}`;
    suffix += 1;
  }

  usedNames.add(candidateName);
  return candidateName;
}

const crcTable = new Uint32Array(256).map((_value, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

export function getCrc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createDosDateTime(date = new Date()) {
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosDate, dosTime };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function createStoredZip(files) {
  for (const file of files) {
    // Entry names must not let an extractor leave its target directory.
    if (file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
      throw new Error(`Unsafe export filename: ${file.name}`);
    }
  }

  const localParts = [];
  const centralParts = [];
  const { dosDate, dosTime } = createDosDateTime();
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const contents = Buffer.isBuffer(file.contents)
      ? file.contents
      : Buffer.from(String(file.contents), "utf8");
    const crc = getCrc32(contents);
    const generalPurposeFlag = 0x0800;
    const compressionMethod = 0;
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(generalPurposeFlag),
      writeUInt16(compressionMethod),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(crc),
      writeUInt32(contents.length),
      writeUInt32(contents.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer,
    ]);
    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(generalPurposeFlag),
      writeUInt16(compressionMethod),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(crc),
      writeUInt32(contents.length),
      writeUInt32(contents.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      nameBuffer,
    ]);

    localParts.push(localHeader, contents);
    centralParts.push(centralHeader);
    offset += localHeader.length + contents.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}
