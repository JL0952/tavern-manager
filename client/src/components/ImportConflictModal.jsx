import { useState } from "react";
import { Button, Modal, OverlayHeader, Toolbar } from "./common/index.js";

function ImportConflictModal({ conflict, onCancel, onResolve, resolving }) {
  const [selectedId, setSelectedId] = useState("");

  if (!conflict) {
    return null;
  }

  const isCharacter = conflict.type === "character";
  const cancelLabel = conflict.batch ? "Cancel this file" : "Cancel";
  const pendingName = conflict.pendingImport?.name || (isCharacter ? "Unnamed character" : "Unnamed worldbook");
  const candidates = Array.isArray(conflict.candidates) ? conflict.candidates : [];
  // A file exported from a Manager card can only update that exact card.
  const managerIdMatch = conflict.managerIdMatch || "";
  const chosenId = managerIdMatch || selectedId;

  function replaceSelected() {
    if (!chosenId) {
      return;
    }

    if (!window.confirm("Replace the selected existing item? This will update that record.")) {
      return;
    }

    onResolve("replace_existing", chosenId);
  }

  return (
    <Modal
      ariaLabel="Duplicate import conflict"
      className="top-3 max-h-[calc(100dvh-1.5rem)] sm:top-12 sm:max-h-[85vh]"
      onClose={onCancel}
    >
      <OverlayHeader
        closeDisabled={resolving}
        closeLabel="Cancel duplicate import"
        eyebrow="Duplicate check"
        title={managerIdMatch
          ? "Character already in Manager"
          : `Possible duplicate ${isCharacter ? "character" : "worldbook"}`}
        subtitle={
          <>
            Pending import: <span className="font-semibold text-tavern-900">{pendingName}</span>
            {!isCharacter && (
              <span> - {conflict.pendingImport?.entryCount || 0} entries</span>
            )}
          </>
        }
        onClose={onCancel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="text-sm leading-6 text-slate-600">
          {managerIdMatch
            ? "This file was exported from the Manager character below. Update that character with the file, or import it as a separate new character. Nothing has been added yet."
            : "Choose how to handle this import. Nothing has been added yet."}
        </p>

        <div className="mt-4 grid gap-3">
          {candidates.map((candidate) => (
            <label
              className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${
                chosenId === candidate.id
                  ? "border-tavern-700 bg-tavern-50"
                  : "border-tavern-200 bg-white hover:border-tavern-700"
              }`}
              key={candidate.id}
            >
              <input
                className="mt-1"
                type="radio"
                name="duplicate-candidate"
                value={candidate.id}
                checked={chosenId === candidate.id}
                disabled={Boolean(managerIdMatch)}
                onChange={() => setSelectedId(candidate.id)}
              />
              {isCharacter && candidate.avatar && (
                <img
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  src={`/${candidate.avatar}`}
                  alt=""
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-tavern-900">
                  {candidate.name || (isCharacter ? "Unnamed character" : "Unnamed worldbook")}
                </span>
                <span className="mt-1 block text-sm text-slate-600">
                  {candidate.reason} - {candidate.confidence}
                  {!isCharacter && (
                    <span> - {candidate.entryCount || 0} entries</span>
                  )}
                </span>
                {isCharacter && candidate.tags?.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-2">
                    {candidate.tags.map((tag) => (
                      <span
                        className="rounded-full bg-tavern-50 px-2 py-1 text-xs font-semibold text-tavern-700"
                        key={tag}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <footer className="border-t border-tavern-200 p-4 sm:p-5">
        <Toolbar className="mobile-full-actions justify-end">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={resolving}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={resolving}
            onClick={() => onResolve("skip")}
          >
            Skip
          </Button>
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={resolving || !chosenId}
            onClick={replaceSelected}
          >
            {managerIdMatch ? "Update existing" : "Replace selected"}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="primary"
            disabled={resolving}
            onClick={() => onResolve("import_anyway")}
          >
            {managerIdMatch ? "Import as new" : "Import anyway"}
          </Button>
        </Toolbar>
      </footer>
    </Modal>
  );
}

export default ImportConflictModal;
