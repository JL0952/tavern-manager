// Copies the isomorphic sync core verbatim into the SillyTavern extension so
// Manager and the browser canonicalize and hash with the exact same source.
// server/test/syncCoreExport.test.js fails when the copy drifts.
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SYNC_CORE_FILES = Object.freeze([
  "characterNote.js",
  "relayContent.js",
  "sha256.js",
  "syncCanonicalMaterializer.js",
  "syncProjection.js",
]);

export const SYNC_CORE_SOURCE = fileURLToPath(new URL("../services/", import.meta.url));

export async function exportSyncCore(extensionRoot) {
  if (typeof extensionRoot !== "string" || !extensionRoot) {
    throw new Error("Pass the tavern-manager-sync extension directory (or set ST_SYNC_BROWSER_ROOT).");
  }

  const target = join(extensionRoot, "sync-core");
  await mkdir(target, { recursive: true });
  for (const file of SYNC_CORE_FILES) {
    await copyFile(join(SYNC_CORE_SOURCE, file), join(target, file));
  }
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = await exportSyncCore(process.argv[2] ?? process.env.ST_SYNC_BROWSER_ROOT);
  console.log(`Exported ${SYNC_CORE_FILES.length} sync-core files to ${target}`);
}
