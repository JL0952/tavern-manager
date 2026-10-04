import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  FileButton,
  FormField,
  Modal,
  OverlayHeader,
  StatusPanel,
  Toolbar,
} from "../components/common/index.js";
import ImportConflictModal from "../components/ImportConflictModal.jsx";
import LibraryNav from "../components/LibraryNav.jsx";
import ImportSummary from "../components/Library/ImportSummary.jsx";
import PageSizeSelect from "../components/Library/PageSizeSelect.jsx";
import PaginationBar from "../components/Library/PaginationBar.jsx";
import SelectionPanel from "../components/Library/SelectionPanel.jsx";
import { useImportQueue } from "../hooks/useImportQueue.js";
import { useLibraryQuery, usePagination } from "../hooks/useLibraryList.js";
import { useSelection } from "../hooks/useSelection.js";
import {
  createWorldBook,
  deleteWorldBookBatch,
  deleteWorldBook,
  downloadWorldBook,
  downloadWorldBookBatch,
  getWorldBooks,
  importWorldBook,
} from "../services/api.js";
import { getWorldBookSourceLabel } from "../utils/format.js";
import { compareCreatedOrder, compareLocale, sortLibraryItems } from "../utils/librarySort.js";

const initialWorldBookCreateForm = {
  name: "",
  entryComment: "",
  entryKeys: "",
  entryContent: "",
};

const sortModes = [
  "originalAsc",
  "originalDesc",
  "nameAsc",
  "nameDesc",
  "linkedDesc",
  "linkedAsc",
  "entriesDesc",
  "entriesAsc",
];
const sortLabels = {
  originalAsc: "Original ↑",
  originalDesc: "Original ↓",
  nameAsc: "Name A-Z",
  nameDesc: "Name Z-A",
  linkedDesc: "Linked High-Low",
  linkedAsc: "Linked Low-High",
  entriesDesc: "Entries High-Low",
  entriesAsc: "Entries Low-High",
};

function parseEntryKeys(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/\r?\n|,/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

function NewWorldBookModal({
  creating,
  error,
  form,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <Modal
      ariaLabel="Create worldbook"
      className="top-3 sm:top-16"
      maxWidthClass="max-w-xl"
      onClose={creating ? undefined : onClose}
    >
      <OverlayHeader
        closeDisabled={creating}
        eyebrow="New lore"
        title="New Worldbook"
        subtitle="Create the book now, then continue editing entries on its detail page."
        onClose={onClose}
      />

      <form className="min-h-0 overflow-y-auto p-5" onSubmit={onSubmit}>
        {error && (
          <Alert className="mb-4" variant="error">
            {error}
          </Alert>
        )}

        <div className="grid gap-4">
          <FormField
            autoFocus
            label="Name"
            required
            value={form.name}
            onChange={(value) => onChange("name", value)}
            placeholder="Worldbook name"
          />
          <div className="rounded-2xl border border-tavern-200 bg-tavern-50 p-4">
            <h2 className="text-sm font-bold text-tavern-900">Optional first entry</h2>
            <div className="mt-4 grid gap-4">
              <FormField
                label="Comment"
                value={form.entryComment}
                onChange={(value) => onChange("entryComment", value)}
                placeholder="Entry label"
              />
              <FormField
                label="Keys"
                value={form.entryKeys}
                onChange={(value) => onChange("entryKeys", value)}
                placeholder="keyword, another keyword"
              />
              <FormField
                label="Content"
                textarea
                value={form.entryContent}
                onChange={(value) => onChange("entryContent", value)}
                placeholder="Lore text"
              />
            </div>
          </div>
        </div>

        <Toolbar className="mobile-full-actions mt-5 justify-end border-t border-tavern-200 pt-5">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={creating}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            variant="primary"
            disabled={creating}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </Toolbar>
      </form>
    </Modal>
  );
}

function WorldBookPage() {
  const navigate = useNavigate();
  const query = useLibraryQuery({ basePath: "/worldbooks", sortModes });
  const selection = useSelection();
  const [worldBooks, setWorldBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(initialWorldBookCreateForm);
  const [creatingWorldBook, setCreatingWorldBook] = useState(false);
  const [createError, setCreateError] = useState("");
  const { search, sortMode } = query;

  async function loadWorldBooks(searchTerm, active = () => true) {
    setLoading(true);
    setError("");

    return getWorldBooks({ search: searchTerm })
      .then((books) => {
        if (active()) {
          setWorldBooks(books);
        }
      })
      .catch((requestError) => {
        if (active()) {
          setError(requestError.message);
          setWorldBooks([]);
        }
      })
      .finally(() => {
        if (active()) {
          setLoading(false);
        }
      });
  }

  const importer = useImportQueue({
    importFile: importWorldBook,
    conflictType: "worldbook",
    noun: "Worldbook",
    rejectFile: (file) => (file.name.toLowerCase().endsWith(".json") ? "" : "Upload a .json worldbook file."),
    onStart: () => {
      setActionError("");
      setStatus("");
    },
    onFinished: async () => {
      query.clearSearch();
      await loadWorldBooks("");
    },
  });

  useEffect(() => {
    let active = true;

    loadWorldBooks(search, () => active);

    return () => {
      active = false;
    };
  }, [search]);

  function openCreateModal() {
    setCreateForm(initialWorldBookCreateForm);
    setCreateError("");
    setCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (creatingWorldBook) {
      return;
    }

    setCreateModalOpen(false);
    setCreateError("");
  }

  function updateCreateForm(field, value) {
    setCreateError("");
    setCreateForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function submitCreateWorldBook(event) {
    event.preventDefault();

    const name = createForm.name.trim();

    if (!name) {
      setCreateError("Worldbook name is required.");
      return;
    }

    setCreatingWorldBook(true);
    setCreateError("");
    setActionError("");
    setStatus("");

    try {
      const worldBook = await createWorldBook({
        name,
        firstEntry: {
          comment: createForm.entryComment,
          keys: parseEntryKeys(createForm.entryKeys),
          content: createForm.entryContent,
        },
      });

      setCreateModalOpen(false);
      navigate(`/worldbooks/${encodeURIComponent(worldBook.id)}`, {
        state: { from: worldBookLibraryPath },
      });
    } catch (requestError) {
      setCreateError(requestError.message);
    } finally {
      setCreatingWorldBook(false);
    }
  }

  async function downloadBook(worldBook) {
    setDownloadingId(worldBook.id);
    setActionError("");
    setStatus("");

    try {
      await downloadWorldBook(worldBook.id, worldBook.name || "worldbook");
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setDownloadingId("");
    }
  }

  async function removeBook(worldBook) {
    if (!window.confirm(`Delete worldbook ${worldBook.name || "this worldbook"}? This cannot be undone.`)) {
      return;
    }

    setDeletingId(worldBook.id);
    setActionError("");
    setStatus("");

    try {
      await deleteWorldBook(worldBook.id);
      await loadWorldBooks(search);
      setStatus(`Deleted ${worldBook.name || "worldbook"}.`);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setDeletingId("");
    }
  }

  async function exportSelectedWorldBooks() {
    if (selection.selectedIds.length === 0) {
      return;
    }

    setBatchExporting(true);
    setActionError("");
    setStatus("");

    try {
      await downloadWorldBookBatch(selection.selectedIds);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchExporting(false);
    }
  }

  async function deleteSelectedWorldBooks() {
    if (selection.selectedIds.length === 0) {
      return;
    }

    if (!window.confirm(`Delete ${selection.selectedIds.length} selected worldbooks? Linked worldbooks will be blocked.`)) {
      return;
    }

    const requestedIds = [...selection.selectedIds];

    setBatchDeleting(true);
    setActionError("");
    setStatus("");

    try {
      const result = await deleteWorldBookBatch(requestedIds);
      const blockedIds = new Set((result.blocked || []).map((worldBook) => worldBook.id));
      const failedIds = new Set((result.failed || []).map((failure) => failure.id));

      selection.remove(requestedIds.filter((id) => !blockedIds.has(id) && !failedIds.has(id)));
      await loadWorldBooks(search);

      const blockedText = result.blocked?.length
        ? ` Blocked: ${result.blocked
            .map((worldBook) => {
              const linkedNames = (worldBook.linkedCharacters || [])
                .map((character) => character.name || character.id)
                .join(", ");

              return `${worldBook.name || worldBook.id} linked to ${linkedNames || "characters"}`;
            })
            .join(" | ")}.`
        : "";
      const failedText = result.failed?.length
        ? ` Failed: ${result.failed.map((failure) => `${failure.id}: ${failure.error}`).join(" | ")}.`
        : "";

      setStatus(
        `Deleted ${result.deleted} selected worldbook${result.deleted === 1 ? "" : "s"}.${blockedText}${failedText}`,
      );
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchDeleting(false);
    }
  }

  const sortedWorldBooks = useMemo(() => {
    const linkedCount = (worldBook) => (worldBook.linkedCharacters || []).length;
    const entryCount = (worldBook) => (worldBook.entries || []).length;

    function compareName(left, right) {
      return compareLocale(left.item.name, right.item.name) || compareCreatedOrder(left, right);
    }

    function compareCount(left, right, getCount, direction = 1) {
      return (getCount(left.item) - getCount(right.item)) * direction || compareName(left, right);
    }

    return sortLibraryItems(worldBooks, (left, right) => {
      if (sortMode === "nameAsc") {
        return compareName(left, right);
      }

      if (sortMode === "nameDesc") {
        return compareName(right, left);
      }

      if (sortMode === "linkedDesc") {
        return compareCount(left, right, linkedCount, -1);
      }

      if (sortMode === "linkedAsc") {
        return compareCount(left, right, linkedCount);
      }

      if (sortMode === "entriesDesc") {
        return compareCount(left, right, entryCount, -1);
      }

      if (sortMode === "entriesAsc") {
        return compareCount(left, right, entryCount);
      }

      if (sortMode === "originalDesc") {
        return compareCreatedOrder(right, left);
      }

      return compareCreatedOrder(left, right);
    });
  }, [sortMode, worldBooks]);
  const pagination = usePagination(sortedWorldBooks, query, loading);
  const worldBookLibraryPath = query.createPath(pagination.safeCurrentPage);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <LibraryNav />
        <header className="border-b border-tavern-200 pb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tavern-700 sm:tracking-[0.2em]">
                Local lore library
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-tavern-900 sm:text-4xl">
                Worldbooks
              </h1>
            </div>
            <p className="text-sm font-semibold text-tavern-700">
              {worldBooks.length} {worldBooks.length === 1 ? "worldbook" : "worldbooks"}
            </p>
          </div>
        </header>

        <section className="py-8" aria-label="Worldbook tools">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1 lg:max-w-xl">
              <label className="block">
                <span className="sr-only">Search worldbooks by name</span>
                <input
                  className="h-11 w-full rounded-full border border-tavern-200 bg-white px-5 text-sm text-tavern-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
                  type="search"
                  value={query.searchInput}
                  onChange={(event) => query.setSearchInput(event.target.value)}
                  placeholder="Search worldbooks..."
                />
              </label>
              <p className="mt-2 text-sm text-slate-600">
                Search by worldbook name or source. Open a worldbook to search its entries.
              </p>
            </div>

            <Toolbar className="mobile-full-actions justify-start lg:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={query.cycleSortMode}
              >
                Sort: {sortLabels[sortMode]}
              </Button>
              <PageSizeSelect value={query.pageSize} onChange={query.setPageSize} />
              <Button
                type="button"
                variant="primary"
                onClick={openCreateModal}
              >
                New Worldbook
              </Button>
              <FileButton
                accept=".json,application/json"
                multiple
                disabled={importer.importing}
                onChange={importer.startImport}
              >
                {importer.importing ? "Importing..." : "Import Worldbook"}
              </FileButton>
              <Button
                type="button"
                variant="secondary"
                onClick={selection.enter}
              >
                Select
              </Button>
            </Toolbar>
          </div>
        </section>

        {importer.message && (
          <Alert className="mb-6" variant="success">
            {importer.message}
          </Alert>
        )}

        {importer.error && (
          <Alert className="mb-6" variant="error">
            Import failed: {importer.error}
          </Alert>
        )}

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

        <ImportSummary summary={importer.summary} />

        {loading && <StatusPanel message="Loading worldbooks..." variant="loading" />}

        {!loading && error && (
          <StatusPanel title="Unable to load worldbooks" message={error} variant="error" />
        )}

        {!loading && !error && worldBooks.length === 0 && (
          <StatusPanel
            title={search ? "No matching worldbooks" : "No worldbooks yet"}
            message={
              search
                ? "Try a different worldbook name or source."
                : "Import a standalone worldbook or a character card with an embedded lorebook."
            }
          />
        )}

        {!loading && !error && worldBooks.length > 0 && selection.selectionMode && (
          <SelectionPanel
            actionsClassName="lg:grid-cols-[1fr_auto] lg:items-center"
            allIds={sortedWorldBooks.map((worldBook) => worldBook.id)}
            pageIds={pagination.pageItems.map((worldBook) => worldBook.id)}
            selection={selection}
          >
            <div className="rounded-2xl border border-tavern-200 bg-tavern-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Batch Export
              </p>
              <Button
                className="max-sm:w-full"
                size="sm"
                type="button"
                variant="primary"
                disabled={selection.selectedIds.length === 0 || batchExporting || batchDeleting}
                onClick={exportSelectedWorldBooks}
              >
                {batchExporting ? "Exporting..." : "Export zip"}
              </Button>
            </div>

            <div className="rounded-2xl border border-red-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-red-700">
                Danger Zone
              </p>
              <Button
                className="max-sm:w-full"
                size="sm"
                type="button"
                variant="danger"
                disabled={selection.selectedIds.length === 0 || batchDeleting}
                onClick={deleteSelectedWorldBooks}
              >
                {batchDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </div>
          </SelectionPanel>
        )}

        {!loading && !error && worldBooks.length > 0 && (
          <PaginationBar
            noun="worldbook"
            pagination={pagination}
            setCurrentPage={query.setCurrentPage}
            total={sortedWorldBooks.length}
          />
        )}

        {!loading && !error && worldBooks.length > 0 && (
          <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Worldbooks">
            {pagination.pageItems.map((worldBook) => (
              <article
                className="flex min-h-full flex-col rounded-3xl border border-tavern-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:border-tavern-700 hover:shadow-md sm:p-6"
                key={worldBook.id}
              >
                {selection.selectionMode && (
                  <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-tavern-700">
                    <input
                      type="checkbox"
                      checked={selection.isSelected(worldBook.id)}
                      onChange={() => selection.toggle(worldBook.id)}
                    />
                    Select
                  </label>
                )}
                <Link
                  className="block min-h-0 flex-1 focus:outline-none focus:ring-2 focus:ring-tavern-700 focus:ring-offset-2"
                  to={`/worldbooks/${encodeURIComponent(worldBook.id)}`}
                  state={{ from: worldBookLibraryPath }}
                  onClick={(event) => {
                    if (selection.selectionMode) {
                      event.preventDefault();
                      selection.toggle(worldBook.id);
                    }
                  }}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tavern-700">
                    {getWorldBookSourceLabel(worldBook.source)}
                  </p>
                  <h2 className="mt-3 line-clamp-2 min-h-14 break-words text-xl font-bold leading-7 text-tavern-900">
                    {worldBook.name || "Unnamed worldbook"}
                  </h2>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="font-semibold text-tavern-700">Entries</dt>
                      <dd className="mt-1 text-slate-600">
                        {(worldBook.entries || []).length}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-tavern-700">Linked</dt>
                      <dd className="mt-1 text-slate-600">
                        {(worldBook.linkedCharacters || []).length}{" "}
                        {(worldBook.linkedCharacters || []).length === 1
                          ? "character"
                          : "characters"}
                      </dd>
                    </div>
                  </dl>
                </Link>
                <Toolbar className="mobile-full-actions mt-5">
                  <Button
                    size="sm"
                    type="button"
                    variant="secondary"
                    disabled={downloadingId === worldBook.id || deletingId === worldBook.id}
                    onClick={() => downloadBook(worldBook)}
                  >
                    {downloadingId === worldBook.id ? "Downloading..." : "Download JSON"}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="danger"
                    disabled={downloadingId === worldBook.id || deletingId === worldBook.id}
                    onClick={() => removeBook(worldBook)}
                  >
                    {deletingId === worldBook.id ? "Deleting..." : "Delete"}
                  </Button>
                </Toolbar>
              </article>
            ))}
          </section>
        )}
      </div>
      <ImportConflictModal
        conflict={importer.conflict}
        resolving={importer.importing}
        onCancel={importer.skipConflict}
        onResolve={importer.resolveConflict}
      />
      {createModalOpen && (
        <NewWorldBookModal
          creating={creatingWorldBook}
          error={createError}
          form={createForm}
          onChange={updateCreateForm}
          onClose={closeCreateModal}
          onSubmit={submitCreateWorldBook}
        />
      )}
    </main>
  );
}

export default WorldBookPage;
