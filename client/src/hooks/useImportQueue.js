import { useState } from "react";

function createImportSummary(total) {
  return {
    total,
    imported: 0,
    replaced: 0,
    skipped: 0,
    failed: 0,
    conflictsResolved: 0,
    failures: [],
  };
}

function copySummary(summary, changes = {}) {
  return { ...summary, failures: [...summary.failures], ...changes };
}

// Imports files one at a time. A duplicate pauses the queue on that file until
// the user resolves or skips it; the rest of the queue then continues.
//
// importFile(file, duplicateOptions) uploads one file; a 409 whose body.type is
// conflictType is a duplicate. rejectFile(file) may return a reason to fail a
// file without uploading it. onStart runs when a queue starts, onFinished when
// it ends.
export function useImportQueue({ importFile, conflictType, noun, rejectFile, onStart, onFinished }) {
  const [importing, setImporting] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function isConflict(requestError) {
    return requestError.status === 409 && requestError.body?.type === conflictType;
  }

  async function runQueue(files, startIndex, previousSummary) {
    const nextSummary = copySummary(previousSummary);

    setImporting(true);
    setError("");
    setMessage("");

    for (let index = startIndex; index < files.length; index += 1) {
      const file = files[index];
      const rejection = rejectFile?.(file);

      if (rejection) {
        nextSummary.failed += 1;
        nextSummary.failures.push({ fileName: file.name, message: rejection });
        continue;
      }

      try {
        const imported = await importFile(file);
        nextSummary.imported += 1;
        setMessage(`${imported.name || file.name} imported.`);
      } catch (requestError) {
        if (isConflict(requestError)) {
          setConflict({ ...requestError.body, file, batch: { files, nextIndex: index + 1, summary: nextSummary } });
          setImporting(false);
          return;
        }

        nextSummary.failed += 1;
        nextSummary.failures.push({ fileName: file.name, message: requestError.message });
      }
    }

    setSummary(nextSummary);
    await onFinished?.();
    setMessage(
      files.length > 1
        ? "Batch import complete."
        : nextSummary.imported
          ? `${noun} imported successfully.`
          : `${noun} import finished.`,
    );
    setImporting(false);
  }

  async function startImport(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    onStart?.();
    setConflict(null);
    setSummary(null);
    await runQueue(files, 0, createImportSummary(files.length));
  }

  async function resolveConflict(duplicateAction, replaceId = "") {
    if (!conflict) {
      return;
    }

    const { batch, file } = conflict;

    setImporting(true);
    setError("");
    setMessage("");

    try {
      const result = await importFile(file, { duplicateAction, replaceId });
      const outcome = result.skipped ? "skipped" : duplicateAction === "replace_existing" ? "replaced" : "imported";

      setConflict(null);
      await runQueue(batch.files, batch.nextIndex, copySummary(batch.summary, {
        conflictsResolved: batch.summary.conflictsResolved + 1,
        [outcome]: batch.summary[outcome] + 1,
      }));
    } catch (requestError) {
      if (isConflict(requestError)) {
        setConflict({ ...requestError.body, file, batch });
        return;
      }

      setError(requestError.message);
    } finally {
      setImporting(false);
    }
  }

  function skipConflict() {
    if (!conflict) {
      return;
    }

    const { batch } = conflict;

    setConflict(null);
    runQueue(batch.files, batch.nextIndex, copySummary(batch.summary, { skipped: batch.summary.skipped + 1 }));
  }

  return { importing, conflict, summary, error, message, startImport, resolveConflict, skipConflict };
}
