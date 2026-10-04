import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import CharacterNoteFields from "../components/CharacterNoteFields.jsx";
import ImportSummary from "../components/Library/ImportSummary.jsx";
import PageSizeSelect from "../components/Library/PageSizeSelect.jsx";
import PaginationBar from "../components/Library/PaginationBar.jsx";
import SelectionPanel from "../components/Library/SelectionPanel.jsx";
import { useImportQueue } from "../hooks/useImportQueue.js";
import { useLibraryQuery, usePagination } from "../hooks/useLibraryList.js";
import { useSelection } from "../hooks/useSelection.js";
import {
  createCharacter,
  deleteCharacterBatch,
  deleteCard,
  downloadCharacterBatch,
  getCards,
  getWorldBooks,
  getTags,
  importCharacterCard,
  updateCharacterBatchTags,
} from "../services/api.js";
import { createCharacterPayload, parseTagInput } from "../utils/characterForms.js";
import { compareCreatedOrder, compareLocale, sortLibraryItems } from "../utils/librarySort.js";
import { createTagMetadataMap, getTagTextStyle } from "../utils/tagStyles.js";

const quickTagLimit = 10;
const sortModes = [
  "originalAsc",
  "originalDesc",
  "nameAsc",
  "nameDesc",
  "worldbookAsc",
  "worldbookDesc",
];
const sortLabels = {
  originalAsc: "Original ↑",
  originalDesc: "Original ↓",
  nameAsc: "Name A-Z",
  nameDesc: "Name Z-A",
  worldbookAsc: "Worldbook A-Z",
  worldbookDesc: "Worldbook Z-A",
};

// The record field is the current note; rawCard may still hold a cleared one.
function getCreatorNotesPreview(card) {
  return card.creator_notes || "";
}

function getTagFallbackSummary(name) {
  return {
    name,
    count: 0,
    percentageOfCharacters: 0,
    color: "",
    category: "",
  };
}

function appendTagInput(value, tag) {
  const tags = parseTagInput(value);

  if (!tags.includes(tag)) {
    tags.push(tag);
  }

  return tags.join(", ");
}

function TagChip({ active = false, count, label, onClick, tagMetadataByName, title }) {
  const textStyle = getTagTextStyle(label, tagMetadataByName);

  return (
    <button
      className={`max-w-full rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-tavern-700 bg-tavern-50"
          : "border-tavern-200 bg-white hover:border-tavern-700"
      }`}
      type="button"
      title={title}
      onClick={onClick}
    >
      <span className="break-words" style={textStyle}>{label}</span>
      {count !== undefined && (
        <span className="ml-2 text-xs font-semibold text-slate-500">{count}</span>
      )}
      {active && <span className="ml-2 text-xs text-slate-500">x</span>}
    </button>
  );
}

function TagPickerModal({
  filteredTags,
  onClose,
  onSearchChange,
  onToggleTag,
  search,
  selectedTags,
  tagMetadataByName,
}) {
  return (
    <Modal
      ariaLabel="More tags"
      className="top-3 max-h-[calc(100dvh-1.5rem)] sm:top-20 sm:max-h-[75vh]"
      maxWidthClass="max-w-xl"
      onClose={onClose}
    >
      <OverlayHeader eyebrow="Tag picker" title="More Tags" onClose={onClose}>
        <input
          className="mt-4 w-full rounded-2xl border border-tavern-200 px-4 py-2 text-sm outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search all tags..."
        />
      </OverlayHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-8 [scroll-padding-bottom:2rem]">
        {filteredTags.length === 0 ? (
          <StatusPanel
            className="rounded-2xl p-6"
            message="No matching tags."
            variant="empty"
          />
        ) : (
          <div className="grid gap-2">
            {filteredTags.map((tag) => {
              const active = selectedTags.includes(tag.name);

              return (
                <button
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    active
                      ? "border-tavern-700 bg-tavern-50"
                      : "border-tavern-200 bg-white hover:border-tavern-700"
                  }`}
                  key={tag.name}
                  type="button"
                  onClick={() => onToggleTag(tag.name)}
                >
                  <span className="min-w-0">
                    <span
                      className="block truncate font-bold text-tavern-900"
                      style={getTagTextStyle(tag.name, tagMetadataByName)}
                    >
                      {tag.name}
                    </span>
                    {tag.category && (
                      <span className="mt-1 block text-xs text-slate-500">
                        {tag.category}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-slate-500">
                    {tag.count} characters{active ? " - selected" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function BatchTagsModal({
  addInput,
  applying,
  existingTags,
  onAddInputChange,
  onApply,
  onClose,
  onRemoveInputChange,
  removeInput,
  selectedCount,
}) {
  const [addSearch, setAddSearch] = useState("");
  const [removeSearch, setRemoveSearch] = useState("");
  const addTags = parseTagInput(addInput);
  const removeTags = parseTagInput(removeInput);
  const searchedAddTags = existingTags
    .filter((tag) => tag.name.toLowerCase().includes(addSearch.trim().toLowerCase()))
    .slice(0, 12);
  const searchedRemoveTags = existingTags
    .filter((tag) => tag.name.toLowerCase().includes(removeSearch.trim().toLowerCase()))
    .slice(0, 18);

  return (
    <Modal
      ariaLabel="Batch edit character tags"
      className="top-3 max-h-[calc(100dvh-1.5rem)] sm:top-16 sm:max-h-[82vh]"
      maxWidthClass="max-w-3xl"
      onClose={onClose}
    >
      <OverlayHeader
        eyebrow="Batch tags"
        title="Edit Selected Tags"
        subtitle={`${selectedCount} selected character${selectedCount === 1 ? "" : "s"}`}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-tavern-200 bg-white p-4">
            <h2 className="font-bold text-tavern-900">Add tags</h2>
            <p className="mt-1 text-sm text-slate-600">
              Type comma-separated tags, or pick from existing tags.
            </p>
            <textarea
              className="mt-3 min-h-28 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              value={addInput}
              onChange={(event) => onAddInputChange(event.target.value)}
              placeholder="favorite, fantasy, long-term"
            />
            <input
              className="mt-3 h-10 w-full rounded-full border border-tavern-200 px-4 text-sm outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              value={addSearch}
              onChange={(event) => setAddSearch(event.target.value)}
              placeholder="Search existing tags..."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {searchedAddTags.map((tag) => (
                <button
                  className="rounded-full border border-tavern-200 bg-white px-3 py-1 text-xs font-semibold text-tavern-700 transition hover:border-tavern-700"
                  key={tag.name}
                  type="button"
                  onClick={() => onAddInputChange(appendTagInput(addInput, tag.name))}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-tavern-200 bg-white p-4">
            <h2 className="font-bold text-tavern-900">Remove tags</h2>
            <p className="mt-1 text-sm text-slate-600">
              These tags will be removed from every selected character that has them.
            </p>
            <textarea
              className="mt-3 min-h-28 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              value={removeInput}
              onChange={(event) => onRemoveInputChange(event.target.value)}
              placeholder="old-tag, unused"
            />
            <input
              className="mt-3 h-10 w-full rounded-full border border-tavern-200 px-4 text-sm outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              value={removeSearch}
              onChange={(event) => setRemoveSearch(event.target.value)}
              placeholder="Search existing tags..."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {searchedRemoveTags.map((tag) => (
                <button
                  className="rounded-full border border-tavern-200 bg-white px-3 py-1 text-xs font-semibold text-tavern-700 transition hover:border-tavern-700"
                  key={tag.name}
                  type="button"
                  onClick={() => onRemoveInputChange(appendTagInput(removeInput, tag.name))}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </section>
        </div>

        {(addTags.length > 0 || removeTags.length > 0) && (
          <section className="mt-5 rounded-2xl border border-tavern-200 bg-tavern-50 p-4 text-sm text-slate-700">
            <h2 className="font-bold text-tavern-900">Pending changes</h2>
            {addTags.length > 0 && <p className="mt-2">Add: {addTags.join(", ")}</p>}
            {removeTags.length > 0 && <p className="mt-1">Remove: {removeTags.join(", ")}</p>}
          </section>
        )}
      </div>

      <footer className="border-t border-tavern-200 p-4 sm:p-5">
        <Toolbar className="mobile-full-actions justify-end">
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={applying}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="button"
            variant="primary"
            disabled={applying || (addTags.length === 0 && removeTags.length === 0)}
            onClick={onApply}
          >
            {applying ? "Applying..." : "Apply Tags"}
          </Button>
        </Toolbar>
      </footer>
    </Modal>
  );
}

const initialCharacterCreateForm = {
  depth_prompt: { prompt: "", depth: 4, role: "system" },
  name: "",
  description: "",
  creator_notes: "",
  first_mes: "",
  tags: "",
};

function NewCharacterModal({
  creating,
  error,
  form,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <Modal
      ariaLabel="Create character"
      className="top-3 sm:top-16"
      maxWidthClass="max-w-xl"
      onClose={creating ? undefined : onClose}
    >
      <OverlayHeader
        closeDisabled={creating}
        eyebrow="New card"
        title="New Character"
        subtitle="Start with the core fields, then continue editing on the detail page."
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
            placeholder="Character name"
          />
          <FormField
            label="Description"
            textarea
            value={form.description}
            onChange={(value) => onChange("description", value)}
            placeholder="Short character description"
          />
          <FormField
            label="Creator notes"
            textarea
            value={form.creator_notes}
            onChange={(value) => onChange("creator_notes", value)}
            placeholder="Notes, usage guidance, or author context"
          />
          <FormField
            label="First message"
            textarea
            value={form.first_mes}
            onChange={(value) => onChange("first_mes", value)}
            placeholder="Opening message"
          />
          <CharacterNoteFields value={form.depth_prompt} onChange={(value) => onChange("depth_prompt", value)} />
          <FormField
            label="Tags"
            value={form.tags}
            onChange={(value) => onChange("tags", value)}
            placeholder="fantasy, favorite, original"
          />
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

function HomePage({ onDataChanged, refreshKey = 0 }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [cards, setCards] = useState([]);
  const [tagSummaries, setTagSummaries] = useState([]);
  const [tagPickerSearch, setTagPickerSearch] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  // One `tag` param per tag, since a tag may contain a comma; `tags=a,b` is
  // the older comma-joined form.
  const [selectedTags, setSelectedTags] = useState(() => [
    ...new Set([
      ...searchParams.getAll("tag").map((tag) => tag.trim()).filter(Boolean),
      ...parseTagInput(searchParams.get("tags") || ""),
    ]),
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [worldBooks, setWorldBooks] = useState([]);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [batchExporting, setBatchExporting] = useState("");
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchTagsOpen, setBatchTagsOpen] = useState(false);
  const [batchTagsApplying, setBatchTagsApplying] = useState(false);
  const [batchAddTags, setBatchAddTags] = useState("");
  const [batchRemoveTags, setBatchRemoveTags] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(initialCharacterCreateForm);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [createError, setCreateError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const query = useLibraryQuery({ basePath: "/", sortModes, filters: { tag: selectedTags } });
  const selection = useSelection();
  const importer = useImportQueue({
    importFile: importCharacterCard,
    conflictType: "character",
    noun: "Character",
    onFinished: () => setRefreshVersion((version) => version + 1),
  });
  const { search, sortMode } = query;

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    Promise.all([
      getCards({ search, tags: selectedTags }),
      getTags(),
      getWorldBooks({ summary: true }),
    ])
      .then(([characters, tagSummaries, worldBooks]) => {
        if (!active) {
          return;
        }

        setCards(characters);
        setWorldBooks(worldBooks);
        const nextTagNames = new Set(tagSummaries.map((tag) => tag.name));

        setTagSummaries(tagSummaries);
        setSelectedTags((currentTags) => {
          const filteredTags = currentTags.filter((tag) => nextTagNames.has(tag));

          return filteredTags.length === currentTags.length
            ? currentTags
            : filteredTags;
        });
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
          setCards([]);
          setWorldBooks([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [search, selectedTags, refreshVersion, refreshKey]);

  function openCreateModal() {
    setCreateForm(initialCharacterCreateForm);
    setCreateError("");
    setCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (creatingCharacter) {
      return;
    }

    setCreateModalOpen(false);
    setCreateError("");
  }

  function updateCreateForm(field, value) {
    setCreateError("");
    setCreateForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function submitCreateCharacter(event) {
    event.preventDefault();

    if (!createForm.name.trim()) {
      setCreateError("Character name is required.");
      return;
    }

    setCreatingCharacter(true);
    setCreateError("");
    setActionError("");
    setActionMessage("");

    try {
      const character = await createCharacter(createCharacterPayload(createForm));

      setCreateModalOpen(false);
      setRefreshVersion((version) => version + 1);
      onDataChanged?.();
      navigate(`/cards/${encodeURIComponent(character.id)}`, { state: { from: libraryPath } });
    } catch (requestError) {
      setCreateError(requestError.message);
    } finally {
      setCreatingCharacter(false);
    }
  }

  async function removeCard(card) {
    if (!window.confirm(`Delete ${card.name || "this character card"}? This cannot be undone.`)) {
      return;
    }

    setDeletingId(card.id);
    setActionError("");
    setActionMessage("");

    try {
      await deleteCard(card.id);
      setCards((currentCards) => currentCards.filter(({ id }) => id !== card.id));
      setRefreshVersion((version) => version + 1);
      onDataChanged?.();
    } catch (requestError) {
      setActionError(`Unable to delete ${card.name || "character card"}: ${requestError.message}`);
    } finally {
      setDeletingId("");
    }
  }

  async function deleteSelectedCards() {
    if (selection.selectedIds.length === 0) {
      return;
    }

    if (
      !window.confirm(
        `Delete ${selection.selectedIds.length} selected characters? Linked worldbooks will not be deleted.`,
      )
    ) {
      return;
    }

    const requestedIds = [...selection.selectedIds];

    setBatchDeleting(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await deleteCharacterBatch(requestedIds);
      const failedIds = new Set((result.failed || []).map((failure) => failure.id));

      selection.remove(requestedIds.filter((id) => !failedIds.has(id)));
      setActionMessage(
        `Deleted ${result.deleted} selected character${result.deleted === 1 ? "" : "s"}.${
          result.failed?.length ? ` ${result.failed.length} failed.` : ""
        }`,
      );

      if (result.failed?.length) {
        setActionError(
          result.failed.map((failure) => `${failure.id}: ${failure.error}`).join(" | "),
        );
      }

      setRefreshVersion((version) => version + 1);
      onDataChanged?.();
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchDeleting(false);
    }
  }

  async function applyBatchTags() {
    if (selection.selectedIds.length === 0) {
      return;
    }

    const addTags = parseTagInput(batchAddTags);
    const removeTags = parseTagInput(batchRemoveTags);

    if (addTags.length === 0 && removeTags.length === 0) {
      setActionError("Add or remove at least one tag.");
      return;
    }

    if (!window.confirm(`Apply tag changes to ${selection.selectedIds.length} selected characters?`)) {
      return;
    }

    setBatchTagsApplying(true);
    setActionError("");
    setActionMessage("");

    try {
      const result = await updateCharacterBatchTags({
        ids: selection.selectedIds,
        addTags,
        removeTags,
        createMissingDefinitions: true,
      });

      setActionMessage(
        `Updated tags on ${result.updated} selected character${result.updated === 1 ? "" : "s"}.${
          result.createdTags?.length ? ` Created: ${result.createdTags.join(", ")}.` : ""
        } Selection was kept for review.`,
      );

      if (result.failed?.length) {
        setActionError(
          result.failed.map((failure) => `${failure.id}: ${failure.error}`).join(" | "),
        );
      }

      setBatchAddTags("");
      setBatchRemoveTags("");
      setBatchTagsOpen(false);
      setRefreshVersion((version) => version + 1);
      onDataChanged?.();
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchTagsApplying(false);
    }
  }

  function toggleTag(tag) {
    setSelectedTags((currentTags) =>
      currentTags.includes(tag)
        ? currentTags.filter((selectedTag) => selectedTag !== tag)
        : [...currentTags, tag],
    );
  }

  async function exportSelectedCards(format) {
    if (selection.selectedIds.length === 0) {
      return;
    }

    setBatchExporting(format);
    setActionError("");
    setActionMessage("");

    try {
      await downloadCharacterBatch(selection.selectedIds, format);
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setBatchExporting("");
    }
  }

  const tagMetadataByName = useMemo(() => createTagMetadataMap(tagSummaries), [tagSummaries]);
  const worldBookNameById = useMemo(
    () => new Map(worldBooks.map((worldBook) => [worldBook.id, worldBook.name || "Unnamed worldbook"])),
    [worldBooks],
  );
  const sortedCards = useMemo(() => {
    function compareName(left, right) {
      return compareLocale(left.item.name, right.item.name) || compareCreatedOrder(left, right);
    }

    function compareWorldBook(left, right, direction = 1) {
      const leftWorldBookName = left.item.worldBookId
        ? worldBookNameById.get(left.item.worldBookId) || ""
        : "";
      const rightWorldBookName = right.item.worldBookId
        ? worldBookNameById.get(right.item.worldBookId) || ""
        : "";

      if (left.item.worldBookId && !right.item.worldBookId) {
        return -1;
      }

      if (!left.item.worldBookId && right.item.worldBookId) {
        return 1;
      }

      const worldBookComparison = compareLocale(
        leftWorldBookName || "No worldbook",
        rightWorldBookName || "No worldbook",
      );

      return worldBookComparison * direction || compareName(left, right) * direction;
    }

    return sortLibraryItems(cards, (left, right) => {
      if (Boolean(left.item.pinned) !== Boolean(right.item.pinned)) {
        return left.item.pinned ? -1 : 1;
      }

      if (sortMode === "nameAsc") {
        return compareName(left, right);
      }

      if (sortMode === "nameDesc") {
        return compareName(right, left);
      }

      if (sortMode === "worldbookAsc") {
        return compareWorldBook(left, right);
      }

      if (sortMode === "worldbookDesc") {
        return compareWorldBook(left, right, -1);
      }

      if (sortMode === "originalDesc") {
        return compareCreatedOrder(right, left);
      }

      return compareCreatedOrder(left, right);
    });
  }, [cards, sortMode, worldBookNameById]);
  const pagination = usePagination(sortedCards, query, loading);
  const selectedTagSummaries = selectedTags.map(
    (tag) => tagMetadataByName.get(tag) || getTagFallbackSummary(tag),
  );
  const quickTags = tagSummaries
    .filter((tag) => tag.count > 0 && !selectedTags.includes(tag.name))
    .slice(0, quickTagLimit);
  const filteredPickerTags = tagSummaries.filter((tag) =>
    tag.name.toLowerCase().includes(tagPickerSearch.trim().toLowerCase()),
  );
  const hasFilters = Boolean(search || selectedTags.length);
  const libraryPath = query.createPath(pagination.safeCurrentPage);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <LibraryNav />
        <header className="border-b border-tavern-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tavern-700 sm:tracking-[0.25em]">
            Local character library
          </p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-tavern-900 sm:text-5xl">
                Tavern Manager
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600">
                Browse and organize the character cards stored on this device.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm font-semibold text-tavern-700">
                {cards.length} {cards.length === 1 ? "card" : "cards"}
              </p>
            </div>
          </div>
        </header>

        <section className="py-8" aria-label="Import character cards">
          <div className="flex flex-col gap-4 rounded-3xl border border-dashed border-tavern-200 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-tavern-900">Import a character card</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Add a Tavern or SillyTavern card from a JSON or PNG file.
              </p>
            </div>
            <Toolbar className="mobile-full-actions justify-start lg:justify-end">
              <Button
                type="button"
                variant="primary"
                onClick={openCreateModal}
              >
                New Character
              </Button>
              <FileButton
                accept=".json,.png,application/json,image/png"
                multiple
                disabled={importer.importing}
                onChange={importer.startImport}
              >
                {importer.importing ? "Importing..." : "Choose JSON or PNG"}
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

          {importer.error && (
            <Alert className="mt-3" variant="error">
              Import failed: {importer.error}
            </Alert>
          )}

          {importer.message && (
            <Alert className="mt-3" variant="success">
              {importer.message}
            </Alert>
          )}
        </section>

        {actionError && (
          <Alert className="mb-6" variant="error">
            {actionError}
          </Alert>
        )}

        {actionMessage && (
          <Alert className="mb-6" variant="success">
            {actionMessage}
          </Alert>
        )}

        <ImportSummary summary={importer.summary} />

        <section className="pb-8" aria-label="Character card filters">
          <Toolbar className="mobile-full-actions">
            <label className="block min-w-0 flex-1 sm:max-w-xl">
              <span className="sr-only">Search character cards</span>
              <input
                className="h-11 w-full rounded-full border border-tavern-200 bg-white px-5 text-sm text-tavern-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
                type="search"
                value={query.searchInput}
                onChange={(event) => query.setSearchInput(event.target.value)}
                placeholder="Search character names or creator notes..."
              />
            </label>
            <Button
              className="w-fit max-sm:w-full"
              type="button"
              variant="secondary"
              onClick={query.cycleSortMode}
            >
              Sort: {sortLabels[sortMode]}
            </Button>
            <PageSizeSelect value={query.pageSize} onChange={query.setPageSize} />
          </Toolbar>

          {tagSummaries.length > 0 && (
            <div className="mt-5 space-y-4" aria-label="Filter by tag">
              {selectedTags.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-bold text-tavern-900">Selected Tags</h2>
                    <button
                      className="text-sm font-semibold text-red-700 transition hover:text-red-900"
                      type="button"
                      onClick={() => setSelectedTags([])}
                    >
                      Clear Tags
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTagSummaries.map((tag) => (
                      <TagChip
                        active
                        count={tag.count}
                        key={tag.name}
                        label={tag.name}
                        tagMetadataByName={tagMetadataByName}
                        title={`Remove ${tag.name}`}
                        onClick={() => toggleTag(tag.name)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-tavern-900">Quick Tags</h2>
                  <button
                    className="text-sm font-semibold text-tavern-700 transition hover:text-tavern-900"
                    type="button"
                    onClick={() => setTagPickerOpen(true)}
                  >
                    More tags
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {quickTags.length === 0 ? (
                    <p className="text-sm text-slate-600">Selected tags are shown above.</p>
                  ) : (
                    quickTags.map((tag) => (
                      <TagChip
                        count={tag.count}
                        key={tag.name}
                        label={tag.name}
                        tagMetadataByName={tagMetadataByName}
                        onClick={() => toggleTag(tag.name)}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </section>

        {loading && (
          <StatusPanel
            className="p-6 sm:p-12"
            message="Loading character cards..."
            variant="loading"
          />
        )}

        {!loading && error && (
          <StatusPanel
            title="Unable to load character cards"
            message={error}
            variant="error"
          />
        )}

        {!loading && !error && cards.length === 0 && (
          <StatusPanel
            className="p-6 sm:p-12"
            title={hasFilters ? "No matching character cards" : "Your character library is empty"}
            message={
              hasFilters
                ? "Try a different search term or clear the selected tags."
                : "Choose a JSON or PNG character card above to add it to your library."
            }
          />
        )}

        {!loading && !error && cards.length > 0 && selection.selectionMode && (
          <SelectionPanel
            actionsClassName="xl:grid-cols-[1fr_auto_auto] xl:items-center"
            allIds={sortedCards.map((card) => card.id)}
            pageIds={pagination.pageItems.map((card) => card.id)}
            selection={selection}
          >
            <div className="rounded-2xl border border-tavern-200 bg-tavern-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Batch Export
              </p>
              <Toolbar className="mobile-full-actions">
                <Button
                  size="sm"
                  type="button"
                  variant="primary"
                  disabled={selection.selectedIds.length === 0 || Boolean(batchExporting)}
                  onClick={() => exportSelectedCards("json")}
                >
                  {batchExporting === "json" ? "Exporting..." : "JSON zip"}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="primary"
                  disabled={selection.selectedIds.length === 0 || Boolean(batchExporting)}
                  onClick={() => exportSelectedCards("png")}
                >
                  {batchExporting === "png" ? "Exporting..." : "PNG zip"}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="primary"
                  disabled={selection.selectedIds.length === 0 || Boolean(batchExporting)}
                  onClick={() => exportSelectedCards("both")}
                >
                  {batchExporting === "both" ? "Exporting..." : "Both zip"}
                </Button>
              </Toolbar>
            </div>

            <div className="rounded-2xl border border-tavern-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Batch Tags
              </p>
              <Button
                className="max-sm:w-full"
                size="sm"
                type="button"
                variant="secondary"
                disabled={selection.selectedIds.length === 0}
                onClick={() => setBatchTagsOpen(true)}
              >
                Edit Tags
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
                onClick={deleteSelectedCards}
              >
                {batchDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </div>
          </SelectionPanel>
        )}

        {!loading && !error && cards.length > 0 && (
          <PaginationBar
            noun="character"
            pagination={pagination}
            setCurrentPage={query.setCurrentPage}
            total={sortedCards.length}
          />
        )}

        {!loading && !error && cards.length > 0 && (
          <section
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-label="Character cards"
          >
            {pagination.pageItems.map((card) => {
              const creatorNotesPreview = getCreatorNotesPreview(card);

              return (
              <article
                className={`character-card relative overflow-hidden rounded-3xl shadow-sm transition hover:-translate-y-1 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-tavern-700 focus:ring-offset-2 ${
                  card.pinned ? "pinned-card" : ""
                }`}
                key={card.id}
              >
                {selection.selectionMode && (
                  <label className="flex items-center gap-2 border-b border-tavern-200 px-5 py-3 text-sm font-semibold text-tavern-700">
                    <input
                      type="checkbox"
                      checked={selection.isSelected(card.id)}
                      onChange={() => selection.toggle(card.id)}
                    />
                    Select
                  </label>
                )}
                {card.pinned && (
                  <span
                    className={`pointer-events-none absolute right-3 z-10 rounded-full border border-violet-200 bg-white/90 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-violet-700 shadow-sm ${
                      selection.selectionMode ? "top-14" : "top-3"
                    }`}
                    title="Pinned character"
                  >
                    Pin
                  </span>
                )}
                <Link
                  className="block focus:outline-none focus:ring-2 focus:ring-inset focus:ring-tavern-700"
                  to={`/cards/${encodeURIComponent(card.id)}`}
                  state={{ from: libraryPath }}
                  onClick={(event) => {
                    if (selection.selectionMode) {
                      event.preventDefault();
                      selection.toggle(card.id);
                    }
                  }}
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-tavern-200 text-4xl font-bold text-tavern-700">
                    {card.avatar ? (
                      <img
                        className="h-full w-full object-cover"
                        src={`/${card.avatar}?v=${encodeURIComponent(card.updatedAt || "")}`}
                        alt=""
                      />
                    ) : (
                      card.name?.charAt(0).toUpperCase() || "?"
                    )}
                  </div>
                  <div className="p-5">
                    <h2 className="break-words text-xl font-bold text-tavern-900">
                      {card.name || "Unnamed character"}
                    </h2>
                    {creatorNotesPreview && (
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                        {creatorNotesPreview}
                      </p>
                    )}
                    {card.tags?.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {card.tags.map((tag) => (
                          <span
                            className="max-w-full break-words rounded-full bg-tavern-50 px-3 py-1 text-xs font-semibold text-tavern-700"
                            key={tag}
                            style={getTagTextStyle(tag, tagMetadataByName)}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
                <div className="border-t border-tavern-200 px-5 py-3">
                  <button
                    className="text-sm font-semibold text-red-700 transition hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    disabled={Boolean(deletingId)}
                    onClick={() => removeCard(card)}
                  >
                    {deletingId === card.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
              );
            })}
          </section>
        )}
      </div>
      {tagPickerOpen && (
        <TagPickerModal
          filteredTags={filteredPickerTags}
          onClose={() => setTagPickerOpen(false)}
          onSearchChange={setTagPickerSearch}
          onToggleTag={toggleTag}
          search={tagPickerSearch}
          selectedTags={selectedTags}
          tagMetadataByName={tagMetadataByName}
        />
      )}
      {batchTagsOpen && (
        <BatchTagsModal
          addInput={batchAddTags}
          applying={batchTagsApplying}
          existingTags={tagSummaries}
          onAddInputChange={setBatchAddTags}
          onApply={applyBatchTags}
          onClose={() => setBatchTagsOpen(false)}
          onRemoveInputChange={setBatchRemoveTags}
          removeInput={batchRemoveTags}
          selectedCount={selection.selectedIds.length}
        />
      )}
      <ImportConflictModal
        conflict={importer.conflict}
        resolving={importer.importing}
        onCancel={importer.skipConflict}
        onResolve={importer.resolveConflict}
      />
      {createModalOpen && (
        <NewCharacterModal
          creating={creatingCharacter}
          error={createError}
          form={createForm}
          onChange={updateCreateForm}
          onClose={closeCreateModal}
          onSubmit={submitCreateCharacter}
        />
      )}
    </main>
  );
}

export default HomePage;
