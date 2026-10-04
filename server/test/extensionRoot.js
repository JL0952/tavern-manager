// The tavern-manager-sync checkout some tests compare against. Set
// ST_SYNC_BROWSER_ROOT to it; those tests are skipped without it.
export const extensionRoot = process.env.ST_SYNC_BROWSER_ROOT || "";
export const needsExtension = { skip: extensionRoot ? false : "set ST_SYNC_BROWSER_ROOT to the tavern-manager-sync folder" };
