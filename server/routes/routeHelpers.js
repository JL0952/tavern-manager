import { createStoredZip, createTimestamp } from "../services/zipExport.js";

const duplicateActions = new Set(["import_anyway", "replace_existing", "skip"]);

export function unexpectedErrorSender(label) {
  return function sendUnexpectedError(response, error) {
    console.error(`${label} error:`, error);
    response.status(500).json({ error: "Unexpected server error." });
  };
}

// An import that hit a duplicate is resent with the user's choice.
export function getDuplicateAction(request, RequestError) {
  const action = request.body?.duplicateAction || "";

  if (action && !duplicateActions.has(action)) {
    throw new RequestError("Unsupported duplicate action.");
  }

  return action;
}

// Batch exports zip every file that succeeded and list the failures in
// EXPORT_ERRORS.txt; when nothing succeeded they answer 500 instead.
export function sendExportZip(response, { files, errors, baseName, allFailedMessage }) {
  if (files.length === 0) {
    return response.status(500).json({ error: allFailedMessage, errors });
  }

  const entries = errors.length > 0
    ? [...files, { name: "EXPORT_ERRORS.txt", contents: `${errors.join("\n")}\n` }]
    : files;
  const zipFileName = `${baseName}-${createTimestamp()}.zip`;

  response.set("Content-Type", "application/zip");
  response.set("Content-Disposition", `attachment; filename="${zipFileName}"`);
  return response.send(createStoredZip(entries));
}
