// Fired when Manager asks this device for its password (a request from
// another device that has not signed in, or whose password was changed).
export const signedOutEvent = "manager:signed-out";

async function apiFetch(path, options) {
  const response = await fetch(path, options);

  if (response.status !== 401) {
    return response;
  }

  const body = await response.json().catch(() => null);
  window.dispatchEvent(new Event(signedOutEvent));
  const error = new Error(body?.error?.message || "Enter the Manager password.");
  error.status = 401;
  error.body = body;
  throw error;
}

async function request(path, options) {
  const response = await apiFetch(path, options);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
}

export function getLibraryGraph({
  includeOrphans = true,
  pinnedOnly = false,
  search = "",
} = {}) {
  const query = new URLSearchParams();

  query.set("includeOrphans", includeOrphans ? "true" : "false");
  query.set("pinnedOnly", pinnedOnly ? "true" : "false");

  if (search.trim()) {
    query.set("search", search.trim());
  }

  return request(`/api/library-graph?${query.toString()}`);
}

function getDownloadFileName(response, fallbackName) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (encodedFileName) {
    return decodeURIComponent(encodedFileName);
  }

  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
}

async function downloadResponse(response, fallbackName) {
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = getDownloadFileName(response, fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadBackup() {
  const response = await apiFetch("/api/backup/export");

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  await downloadResponse(response, "tavern-manager-backup.zip");
}

export function importBackup(file) {
  const formData = new FormData();
  formData.append("file", file);

  return request("/api/backup/import", {
    method: "POST",
    body: formData,
  });
}

export function getCards({ search, tags } = {}) {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  // One `tag` param per tag, so a tag may contain commas.
  for (const tag of Array.isArray(tags) ? tags : []) {
    query.append("tag", tag);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/cards${suffix}`);
}

export function getCard(id) {
  return request(`/api/cards/${encodeURIComponent(id)}`);
}

export function createCharacter(payload) {
  return request("/api/cards", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// summary: only { id, name } per worldbook, without entries or raw data.
export function getWorldBooks({ search, summary = false } = {}) {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  if (summary) {
    query.set("summary", "true");
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/worldbooks${suffix}`);
}

export function getWorldBook(id) {
  return request(`/api/worldbooks/${encodeURIComponent(id)}`);
}

export function createWorldBook(payload) {
  return request("/api/worldbooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function getWorldBookEntries(id, { search } = {}) {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/worldbooks/${encodeURIComponent(id)}/entries${suffix}`);
}

export function getRpStats() {
  return request("/api/stats/rp");
}

export function getRpTagDetail(tag) {
  return request(`/api/stats/rp/tags/${encodeURIComponent(tag)}`);
}

export function getTags() {
  return request("/api/tags");
}

export function createTagDefinition(tag) {
  return request("/api/tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tag),
  });
}

export function updateTagDefinition(name, metadata) {
  return request(`/api/tags/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
}

export function renameTag(name, newName) {
  return request(`/api/tags/${encodeURIComponent(name)}/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ newName }),
  });
}

export function mergeTags(sourceTags, targetTag) {
  return request("/api/tags/merge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceTags, targetTag }),
  });
}

export function deleteTag(name) {
  return request(`/api/tags/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

function appendDuplicateFields(formData, duplicateOptions = {}) {
  if (duplicateOptions.duplicateAction) {
    formData.append("duplicateAction", duplicateOptions.duplicateAction);
  }

  if (duplicateOptions.replaceId) {
    formData.append("replaceId", duplicateOptions.replaceId);
  }
}

export function importWorldBook(file, duplicateOptions = {}) {
  const formData = new FormData();
  formData.append("file", file);
  appendDuplicateFields(formData, duplicateOptions);

  return request("/api/worldbooks/import", {
    method: "POST",
    body: formData,
  });
}

export function updateWorldBook(id, patch) {
  return request(`/api/worldbooks/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export function deleteWorldBook(id) {
  return request(`/api/worldbooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

function sanitizeDownloadName(name, fallbackName) {
  const sanitizedName = String(name || fallbackName || "worldbook")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();

  return sanitizedName || "worldbook";
}

export async function downloadWorldBook(id, fallbackName) {
  const response = await apiFetch(`/api/worldbooks/${encodeURIComponent(id)}/export`);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  await downloadResponse(response, `${sanitizeDownloadName(fallbackName)}.json`);
}

export async function downloadWorldBookBatch(ids) {
  const response = await apiFetch("/api/worldbooks/export/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  await downloadResponse(response, "worldbooks-export.zip");
}

export function deleteWorldBookBatch(ids) {
  return request("/api/worldbooks/batch-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });
}

export function importCharacterCard(file, duplicateOptions = {}) {
  const formData = new FormData();
  formData.append("file", file);
  appendDuplicateFields(formData, duplicateOptions);

  return request("/api/cards/import", {
    method: "POST",
    body: formData,
  });
}

export async function downloadCharacterCard(id, format) {
  const response = await apiFetch(
    `/api/cards/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`,
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  await downloadResponse(response, `character-card.${format}`);
}

export async function downloadCharacterBatch(ids, format) {
  const response = await apiFetch("/api/cards/export/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids, format }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  await downloadResponse(response, "characters-export.zip");
}

export function deleteCharacterBatch(ids) {
  return request("/api/cards/batch-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });
}

export function updateCharacterBatchTags({
  ids,
  addTags,
  removeTags,
  createMissingDefinitions = true,
}) {
  return request("/api/cards/batch-tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ids,
      addTags,
      removeTags,
      createMissingDefinitions,
    }),
  });
}

export function uploadCharacterAvatar(id, file) {
  const formData = new FormData();
  formData.append("file", file);

  return request(`/api/cards/${encodeURIComponent(id)}/avatar`, {
    method: "POST",
    body: formData,
  });
}

export function updateCard(id, patch) {
  return request(`/api/cards/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export function updateCardPin(id, pinned) {
  return request(`/api/cards/${encodeURIComponent(id)}/pin`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pinned }),
  });
}

export function updateCharacterWorldBook(characterId, worldBookId) {
  return request(`/api/cards/${encodeURIComponent(characterId)}/worldbook`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ worldBookId }),
  });
}

export function deleteCard(id) {
  return request(`/api/cards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Relay files: Manager stores presets, themes and regex scripts unchanged.
// Its errors are { error: { code, message, ... } }.
async function relayFetch(path, options) {
  const response = await apiFetch(path, options);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = body?.error?.code;
    error.body = body;
    throw error;
  }

  return response;
}

const relayPath = (type, suffix = "") => `/api/relay/v1/${encodeURIComponent(type)}${suffix}`;

export async function getRelayFiles(type) {
  return (await (await relayFetch(relayPath(type))).json()).items;
}

// onConflict: "fail" answers a relay_name_conflict error with the existing
// file; "replace" or "rename" settle it.
export async function uploadRelayFile(type, { name, contents, contentHash }, onConflict = "fail") {
  const query = new URLSearchParams({ name, onConflict });
  const response = await relayFetch(relayPath(type, `?${query.toString()}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Content-Hash": contentHash,
      "X-Relay-Source": "file",
    },
    body: contents,
  });

  return response.json();
}

export async function downloadRelayFile(type, id, fallbackName) {
  const response = await relayFetch(relayPath(type, `/${encodeURIComponent(id)}`));
  await downloadResponse(response, `${sanitizeDownloadName(fallbackName, type)}.json`);
}

export async function downloadRelayBatch(type, ids) {
  const response = await relayFetch(relayPath(type, "/archive"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });

  await downloadResponse(response, `${type}-export.zip`);
}

export async function deleteRelayFile(type, id) {
  await relayFetch(relayPath(type, `/${encodeURIComponent(id)}`), { method: "DELETE" });
}

// Signing in from another device and the password itself, which only this
// computer changes. Their errors are { error: { code, message } }; a wrong
// password is not a sign-out, so these skip apiFetch.
async function authRequest(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(body?.error?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }

  return body;
}

export function getAuthStatus() {
  return authRequest("/api/auth/status", { cache: "no-store" });
}

export function signIn(password) {
  return authRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function setManagerPassword(password) {
  return authRequest("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function removeManagerPassword() {
  return authRequest("/api/auth/password", { method: "DELETE" });
}
