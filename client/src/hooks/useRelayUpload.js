import { useState } from "react";
import { uploadRelayFile } from "../services/api.js";
import { relayUploadsFromText } from "../utils/relayFiles.js";

function createSummary(total) {
  return { total, imported: 0, replaced: 0, skipped: 0, failed: 0, conflictsResolved: 0, failures: [] };
}

function copySummary(summary) {
  return { ...summary, failures: [...summary.failures] };
}

// "renamed" keeps both files, so it counts as an import.
function countOutcome(summary, outcome) {
  if (outcome === "replaced") summary.replaced += 1;
  else summary.imported += 1;
}

// Uploads the files chosen on the Files page one at a time. A name Manager
// already has pauses the queue until the user replaces that file, keeps both,
// skips it or stops; the choice may cover every later conflict in the upload.
export function useRelayUpload({ onStart, onFinished }) {
  const [uploading, setUploading] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [summary, setSummary] = useState(null);

  async function finish(nextSummary) {
    setSummary(nextSummary);
    setUploading(false);
    await onFinished?.();
  }

  async function runQueue(type, queue, startIndex, currentSummary, standingChoice = null) {
    const nextSummary = copySummary(currentSummary);
    setUploading(true);

    for (let index = startIndex; index < queue.length; index += 1) {
      const { fileName, upload } = queue[index];
      const onConflict = standingChoice === "replace" || standingChoice === "rename" ? standingChoice : "fail";

      try {
        const result = await uploadRelayFile(type, upload, onConflict);
        if (result.outcome !== "created") nextSummary.conflictsResolved += 1;
        countOutcome(nextSummary, result.outcome);
      } catch (requestError) {
        if (requestError.code !== "relay_name_conflict") {
          nextSummary.failed += 1;
          nextSummary.failures.push({ fileName, message: requestError.message });
          continue;
        }

        if (standingChoice === "skip") {
          nextSummary.conflictsResolved += 1;
          nextSummary.skipped += 1;
          continue;
        }

        setConflict({ type, queue, index, summary: nextSummary, existing: requestError.body.error.existing, upload });
        setUploading(false);
        return;
      }
    }

    await finish(nextSummary);
  }

  async function startUpload(type, event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    onStart?.();
    setConflict(null);
    setSummary(null);
    setUploading(true);

    // A bulk regex export becomes several uploads, so count uploads, not files.
    const queue = [];
    const failures = [];

    for (const file of files) {
      try {
        const uploads = relayUploadsFromText(type, file.name, await file.text());
        queue.push(...uploads.map((upload) => ({ fileName: file.name, upload })));
      } catch (readError) {
        failures.push({ fileName: file.name, message: readError.message });
      }
    }

    const initialSummary = { ...createSummary(queue.length + failures.length), failed: failures.length, failures };
    await runQueue(type, queue, 0, initialSummary);
  }

  // choice is "replace", "rename" or "skip".
  async function resolveConflict(choice, applyToRest) {
    if (!conflict) {
      return;
    }

    const { type, queue, index, summary: pausedSummary, upload } = conflict;
    const nextSummary = copySummary(pausedSummary);
    nextSummary.conflictsResolved += 1;
    setConflict(null);
    setUploading(true);

    if (choice === "skip") {
      nextSummary.skipped += 1;
    } else {
      try {
        countOutcome(nextSummary, (await uploadRelayFile(type, upload, choice)).outcome);
      } catch (requestError) {
        nextSummary.failed += 1;
        nextSummary.failures.push({ fileName: queue[index].fileName, message: requestError.message });
      }
    }

    await runQueue(type, queue, index + 1, nextSummary, applyToRest ? choice : null);
  }

  // Stops the upload; what was uploaded before the conflict stays.
  async function stopUpload() {
    if (!conflict) {
      return;
    }

    const nextSummary = copySummary(conflict.summary);
    nextSummary.skipped += conflict.queue.length - conflict.index;
    setConflict(null);
    await finish(nextSummary);
  }

  return { uploading, conflict, summary, startUpload, resolveConflict, stopUpload };
}
