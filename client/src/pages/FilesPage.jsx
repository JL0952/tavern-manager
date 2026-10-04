import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  FileButton,
  Modal,
  OverlayHeader,
  StatusPanel,
  Toolbar,
} from "../components/common/index.js";
import ImportSummary from "../components/Library/ImportSummary.jsx";
import LibraryNav from "../components/LibraryNav.jsx";
import PageSizeSelect from "../components/Library/PageSizeSelect.jsx";
import PaginationBar from "../components/Library/PaginationBar.jsx";
import SelectionPanel from "../components/Library/SelectionPanel.jsx";
import { useLibraryQuery, usePagination } from "../hooks/useLibraryList.js";
import { useRelayUpload } from "../hooks/useRelayUpload.js";
import { useSelection } from "../hooks/useSelection.js";
import { deleteRelayFile, downloadRelayBatch, downloadRelayFile, getRelayFiles } from "../services/api.js";
import { formatTimestamp } from "../utils/format.js";
import { compareLocale, sortLibraryItems } from "../utils/librarySort.js";
import { formatFileSize, relayTypes } from "../utils/relayFiles.js";

const sortModes = ["nameAsc", "nameDesc", "updatedDesc", "updatedAsc", "sizeDesc", "sizeAsc"];
const sortLabels = {
  nameAsc: "Name A-Z",
  nameDesc: "Name Z-A",
  updatedDesc: "Updated New-Old",
  updatedAsc: "Updated Old-New",
  sizeDesc: "Size Large-Small",
  sizeAsc: "Size Small-Large",
};
const emptyFiles = Object.fromEntries(relayTypes.map(({ id }) => [id, []]));
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function sourceLabel(source) {
  return source === "sillytavern" ? "From SillyTavern" : "Uploaded file";
}

function RelayConflictModal({ conflict, noun, onResolve, onStop, resolving }) {
  const [applyToRest, setApplyToRest] = useState(false);

  if (!conflict) {
    return null;
  }

  const { existing, index, queue, upload } = conflict;
  const remaining = queue.length - index - 1;

  function replace() {
    if (!window.confirm(`Replace the ${noun} "${existing.name}" in Manager with the uploaded file?`)) {
      return;
    }

    onResolve("replace", applyToRest);
  }

  return (
    <Modal ariaLabel="Name already used" maxWidthClass="max-w-xl" onClose={resolving ? undefined : onStop}>
      <OverlayHeader
        closeDisabled={resolving}
        closeLabel="Stop upload"
        eyebrow="Name already used"
        title={`${noun[0].toUpperCase()}${noun.slice(1)} "${upload.name}" is already in Manager`}
        subtitle={`In Manager: ${formatFileSize(existing.size)} · Updated ${formatTimestamp(existing.updatedAt)} · ${sourceLabel(existing.source)}`}
        onClose={onStop}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="text-sm leading-6 text-slate-600">
          {existing.contentHash === upload.contentHash
            ? "Both files have the same content. "
            : "The two files differ. "}
          Replace swaps in the uploaded file; keep both saves it as &quot;{upload.name} (2)&quot;. Nothing has changed yet.
        </p>
        {remaining > 0 && (
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-tavern-700">
            <input
              type="checkbox"
              checked={applyToRest}
              onChange={(event) => setApplyToRest(event.target.checked)}
            />
            Do the same for later name conflicts in this upload
          </label>
        )}
      </div>

      <footer className="border-t border-tavern-200 p-4 sm:p-5">
        <Toolbar className="mobile-full-actions justify-end">
          <Button size="sm" type="button" variant="secondary" disabled={resolving} onClick={onStop}>
            Stop upload
          </Button>
          <Button size="sm" type="button" variant="secondary" disabled={resolving} onClick={() => onResolve("skip", applyToRest)}>
            Skip
          </Button>
          <Button size="sm" type="button" variant="secondary" disabled={resolving} onClick={replace}>
            Replace
          </Button>
          <Button size="sm" type="button" variant="primary" disabled={resolving} onClick={() => onResolve("rename", applyToRest)}>
            Keep both
          </Button>
        </Toolbar>
      </footer>
    </Modal>
  );
}

function FilesPage() {
  const [searchParams] = useSearchParams();
  const [type, setType] = useState(() => {
    const requested = searchParams.get("type");
    return relayTypes.some(({ id }) => id === requested) ? requested : relayTypes[0].id;
  });
  const query = useLibraryQuery({ basePath: "/files", sortModes, filters: { type } });
  const selection = useSelection();
  const [filesByType, setFilesByType] = useState(emptyFiles);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const { search, sortMode } = query;
  const activeType = relayTypes.find(({ id }) => id === type);

  // Every tab shows its count, so all three lists load together.
  async function loadFiles(active = () => true) {
    setLoading(true);
    setError("");

    try {
      const lists = await Promise.all(relayTypes.map(({ id }) => getRelayFiles(id)));

      if (active()) {
        setFilesByType(Object.fromEntries(relayTypes.map(({ id }, index) => [id, lists[index]])));
      }
    } catch (requestError) {
      if (active()) {
        setError(requestError.message);
        setFilesByType(emptyFiles);
      }
    } finally {
      if (active()) {
        setLoading(false);
      }
    }
  }

  const uploader = useRelayUpload({
    onStart: () => {
      setActionError("");
      setStatus("");
    },
    onFinished: () => loadFiles(),
  });

  useEffect(() => {
    let active = true;

    loadFiles(() => active);

    return () => {
      active = false;
    };
  }, []);

  function chooseType(nextType) {
    if (nextType === type) {
      return;
    }

    setType(nextType);
    selection.exit();
    setStatus("");
    setActionError("");
  }

  async function downloadFile(file) {
    setDownloadingId(file.id);
    setActionError("");
    setStatus("");

    try {
      await downloadRelayFile(type, file.id, file.name);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setDownloadingId("");
    }
  }

  async function removeFile(file) {
    if (!window.confirm(`Delete ${activeType.noun} "${file.name}" from Manager? This cannot be undone.`)) {
      return;
    }

    setDeletingId(file.id);
    setActionError("");
    setStatus("");

    try {
      await deleteRelayFile(type, file.id);
      await loadFiles();
      setStatus(`Deleted ${file.name}.`);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setDeletingId("");
    }
  }

  async function exportSelectedFiles() {
    setBatchExporting(true);
    setActionError("");
    setStatus("");

    try {
      await downloadRelayBatch(type, selection.selectedIds);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchExporting(false);
    }
  }

  async function deleteSelectedFiles() {
    const requestedIds = [...selection.selectedIds];

    if (!window.confirm(`Delete ${plural(requestedIds.length, activeType.noun)} from Manager? This cannot be undone.`)) {
      return;
    }

    setBatchDeleting(true);
    setActionError("");
    setStatus("");
    const failures = [];

    for (const id of requestedIds) {
      try {
        await deleteRelayFile(type, id);
      } catch (requestError) {
        failures.push(`${filesByType[type].find((file) => file.id === id)?.name || id}: ${requestError.message}`);
      }
    }

    selection.clear();
    await loadFiles();
    setBatchDeleting(false);
    setStatus(`Deleted ${plural(requestedIds.length - failures.length, activeType.noun)}.`);

    if (failures.length) {
      setActionError(`Not deleted: ${failures.join(" | ")}`);
    }
  }

  const files = filesByType[type];
  const sortedFiles = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const matches = term ? files.filter((file) => file.name.toLocaleLowerCase().includes(term)) : files;

    function compareName(left, right) {
      return compareLocale(left.item.name, right.item.name) || left.index - right.index;
    }

    return sortLibraryItems(matches, (left, right) => {
      if (sortMode === "nameDesc") return compareName(right, left);
      if (sortMode === "updatedDesc") return right.item.updatedAt.localeCompare(left.item.updatedAt) || compareName(left, right);
      if (sortMode === "updatedAsc") return left.item.updatedAt.localeCompare(right.item.updatedAt) || compareName(left, right);
      if (sortMode === "sizeDesc") return right.item.size - left.item.size || compareName(left, right);
      if (sortMode === "sizeAsc") return left.item.size - right.item.size || compareName(left, right);
      return compareName(left, right);
    });
  }, [files, search, sortMode]);
  const pagination = usePagination(sortedFiles, query, loading);
  const totalFiles = relayTypes.reduce((sum, { id }) => sum + filesByType[id].length, 0);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <LibraryNav />
        <header className="border-b border-tavern-200 pb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tavern-700 sm:tracking-[0.2em]">
                SillyTavern relay
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-tavern-900 sm:text-4xl">
                ST Files
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                Chat completion presets, UI themes and regex scripts, kept exactly as they were saved.
                Push and pull them from the SillyTavern extension, or upload files here.
              </p>
            </div>
            <p className="text-sm font-semibold text-tavern-700">{plural(totalFiles, "file")}</p>
          </div>
        </header>

        <section className="space-y-5 py-8" aria-label="File tools">
          <div
            className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-tavern-200 bg-white p-1"
            role="tablist"
            aria-label="File type"
          >
            {relayTypes.map(({ id, label }) => (
              <button
                aria-selected={id === type}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-tavern-200 ${
                  id === type ? "bg-tavern-900 text-white" : "text-tavern-700 hover:text-tavern-900"
                }`}
                key={id}
                role="tab"
                type="button"
                onClick={() => chooseType(id)}
              >
                {label} {loading ? "" : filesByType[id].length}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1 lg:max-w-xl">
              <label className="block">
                <span className="sr-only">Search {activeType.noun}s by name</span>
                <input
                  className="h-11 w-full rounded-full border border-tavern-200 bg-white px-5 text-sm text-tavern-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
                  type="search"
                  value={query.searchInput}
                  onChange={(event) => query.setSearchInput(event.target.value)}
                  placeholder={`Search ${activeType.noun}s...`}
                />
              </label>
              <p className="mt-2 text-sm text-slate-600">{activeType.description}, by name.</p>
            </div>

            <Toolbar className="mobile-full-actions justify-start lg:justify-end">
              <Button type="button" variant="secondary" onClick={query.cycleSortMode}>
                Sort: {sortLabels[sortMode]}
              </Button>
              <PageSizeSelect value={query.pageSize} onChange={query.setPageSize} />
              <FileButton
                accept=".json,application/json"
                multiple
                disabled={uploader.uploading}
                onChange={(event) => uploader.startUpload(type, event)}
              >
                {uploader.uploading ? "Uploading..." : "Upload Files"}
              </FileButton>
              <Button type="button" variant="secondary" onClick={selection.enter}>
                Select
              </Button>
            </Toolbar>
          </div>
        </section>

        {status && (
          <Alert className="mb-6" variant="success">
            {status}
          </Alert>
        )}

        {actionError && (
          <Alert className="mb-6" variant="error">
            {actionError}
          </Alert>
        )}

        <ImportSummary summary={uploader.summary} />

        {loading && <StatusPanel message="Loading files..." variant="loading" />}

        {!loading && error && <StatusPanel title="Unable to load files" message={error} variant="error" />}

        {!loading && !error && sortedFiles.length === 0 && (
          <StatusPanel
            title={search ? `No matching ${activeType.noun}s` : `No ${activeType.noun}s yet`}
            message={
              search
                ? "Try a different name."
                : `Push ${activeType.noun}s from the SillyTavern extension, or upload .json files here.`
            }
          />
        )}

        {!loading && !error && files.length > 0 && selection.selectionMode && (
          <SelectionPanel
            actionsClassName="lg:grid-cols-[1fr_auto] lg:items-center"
            allIds={sortedFiles.map((file) => file.id)}
            pageIds={pagination.pageItems.map((file) => file.id)}
            selection={selection}
          >
            <div className="rounded-2xl border border-tavern-200 bg-tavern-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Batch Export</p>
              <Button
                className="max-sm:w-full"
                size="sm"
                type="button"
                variant="primary"
                disabled={selection.selectedIds.length === 0 || batchExporting || batchDeleting}
                onClick={exportSelectedFiles}
              >
                {batchExporting ? "Exporting..." : "Download zip"}
              </Button>
            </div>

            <div className="rounded-2xl border border-red-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-red-700">Danger Zone</p>
              <Button
                className="max-sm:w-full"
                size="sm"
                type="button"
                variant="danger"
                disabled={selection.selectedIds.length === 0 || batchDeleting}
                onClick={deleteSelectedFiles}
              >
                {batchDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </div>
          </SelectionPanel>
        )}

        {!loading && !error && sortedFiles.length > 0 && (
          <PaginationBar
            noun={activeType.noun}
            pagination={pagination}
            setCurrentPage={query.setCurrentPage}
            total={sortedFiles.length}
          />
        )}

        {!loading && !error && sortedFiles.length > 0 && (
          <ul className="grid gap-3" aria-label={`${activeType.label} in Manager`}>
            {pagination.pageItems.map((file) => {
              const busy = downloadingId === file.id || deletingId === file.id;

              return (
                <li
                  className={`flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm transition sm:flex-row sm:items-center sm:px-5 ${
                    selection.isSelected(file.id) ? "border-tavern-700" : "border-tavern-200 hover:border-tavern-700"
                  }`}
                  key={file.id}
                >
                  <label
                    className={`flex min-w-0 flex-1 items-center gap-3 ${selection.selectionMode ? "cursor-pointer" : ""}`}
                  >
                    {selection.selectionMode && (
                      <input
                        type="checkbox"
                        checked={selection.isSelected(file.id)}
                        onChange={() => selection.toggle(file.id)}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-tavern-900" title={file.name}>
                        {file.name}
                      </span>
                      <span className="mt-1 block text-sm text-slate-600">
                        {formatFileSize(file.size)} · Updated {formatTimestamp(file.updatedAt)} · {sourceLabel(file.source)}
                      </span>
                    </span>
                  </label>
                  <Toolbar className="mobile-full-actions">
                    <Button size="sm" type="button" variant="secondary" disabled={busy} onClick={() => downloadFile(file)}>
                      {downloadingId === file.id ? "Downloading..." : "Download"}
                    </Button>
                    <Button size="sm" type="button" variant="danger" disabled={busy} onClick={() => removeFile(file)}>
                      {deletingId === file.id ? "Deleting..." : "Delete"}
                    </Button>
                  </Toolbar>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <RelayConflictModal
        key={uploader.conflict ? `${uploader.conflict.index}-${uploader.conflict.upload.name}` : "none"}
        conflict={uploader.conflict}
        noun={relayTypes.find(({ id }) => id === uploader.conflict?.type)?.noun ?? activeType.noun}
        resolving={uploader.uploading}
        onResolve={uploader.resolveConflict}
        onStop={uploader.stopUpload}
      />
    </main>
  );
}

export default FilesPage;
