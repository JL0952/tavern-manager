import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Drawer,
  OverlayHeader,
  StatusPanel as CommonStatusPanel,
} from "./common/index.js";
import {
  createTagDefinition,
  deleteTag,
  getTags,
  mergeTags,
  renameTag,
  updateTagDefinition,
} from "../services/api.js";
import { createTagMetadataMap, getTagTextStyle } from "../utils/tagStyles.js";

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
}

function TagManagerDrawer({ onClose, onDataChanged, open }) {
  const [tags, setTags] = useState([]);
  const [selectedName, setSelectedName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [metadata, setMetadata] = useState({ color: "", category: "" });
  const [newDefinition, setNewDefinition] = useState({ name: "", color: "", category: "" });
  const [renameValue, setRenameValue] = useState("");
  const [mergeSources, setMergeSources] = useState([]);
  const [mergeTarget, setMergeTarget] = useState("");

  const filteredTags = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return tags;
    }

    return tags.filter((tag) => tag.name.toLowerCase().includes(normalizedSearch));
  }, [search, tags]);

  const tagMetadataByName = useMemo(() => createTagMetadataMap(tags), [tags]);
  const selectedTag = tags.find((tag) => tag.name === selectedName) || null;

  async function loadTags(nextSelectedName = selectedName) {
    setLoading(true);
    setError("");

    try {
      const nextTags = await getTags();
      setTags(nextTags);

      if (nextSelectedName && nextTags.some((tag) => tag.name === nextSelectedName)) {
        setSelectedName(nextSelectedName);
      } else {
        setSelectedName(nextTags[0]?.name || "");
      }
    } catch (requestError) {
      setError(requestError.message);
      setTags([]);
      setSelectedName("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    loadTags();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    setMetadata({
      color: selectedTag?.color || "",
      category: selectedTag?.category || "",
    });
    setRenameValue("");
    setMergeSources(selectedTag ? [selectedTag.name] : []);
    setMergeTarget("");
  }, [selectedTag?.name, selectedTag?.color, selectedTag?.category]);

  function markDataChanged() {
    onDataChanged?.();
  }

  async function runAction(action, actionName, nextSelectedName = selectedName) {
    setSaving(actionName);
    setError("");
    setMessage("");

    try {
      const result = await action();
      setMessage(
        result?.affectedCharacterCount !== undefined
          ? `${result.affectedCharacterCount} character${result.affectedCharacterCount === 1 ? "" : "s"} updated.`
          : "Tag metadata saved.",
      );
      markDataChanged();
      await loadTags(nextSelectedName);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving("");
    }
  }

  async function createDefinition(event) {
    event.preventDefault();
    const name = newDefinition.name.trim();

    if (!name) {
      setError("Tag name is required.");
      return;
    }

    await runAction(
      () => createTagDefinition(newDefinition),
      "create",
      name,
    );
    setNewDefinition({ name: "", color: "", category: "" });
  }

  async function saveMetadata(event) {
    event.preventDefault();

    if (!selectedTag) {
      return;
    }

    await runAction(
      () => updateTagDefinition(selectedTag.name, metadata),
      "metadata",
      selectedTag.name,
    );
  }

  async function renameSelectedTag(event) {
    event.preventDefault();

    if (!selectedTag) {
      return;
    }

    const nextName = renameValue.trim();

    if (!nextName) {
      setError("New tag name is required.");
      return;
    }

    if (!window.confirm("This will rename the tag on all affected characters.")) {
      return;
    }

    await runAction(() => renameTag(selectedTag.name, nextName), "rename", nextName);
  }

  async function mergeSelectedTags(event) {
    event.preventDefault();

    const sourceTags = mergeSources.filter(Boolean);
    const targetTag = mergeTarget.trim();

    if (sourceTags.length === 0 || !targetTag) {
      setError("Choose at least one source tag and a target tag.");
      return;
    }

    if (!window.confirm("This will replace source tags on all affected characters.")) {
      return;
    }

    await runAction(() => mergeTags(sourceTags, targetTag), "merge", targetTag);
  }

  async function deleteSelectedTag() {
    if (!selectedTag) {
      return;
    }

    if (!window.confirm("This will remove the tag from all affected characters.")) {
      return;
    }

    await runAction(() => deleteTag(selectedTag.name), "delete", "");
  }

  function toggleMergeSource(name) {
    setMergeSources((currentSources) =>
      currentSources.includes(name)
        ? currentSources.filter((sourceName) => sourceName !== name)
        : [...currentSources, name],
    );
  }

  if (!open) {
    return null;
  }

  return (
    <Drawer
      ariaLabel="Tag manager drawer"
      onClose={onClose}
      widthClass="max-w-5xl md:w-[760px]"
    >
      <OverlayHeader eyebrow="Tag manager" title="Library Tags" onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto pb-10 md:grid md:grid-cols-[280px_1fr] md:overflow-hidden md:pb-0">
        <section className="border-b border-tavern-200 bg-white p-4 md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r">
          <input
            className="w-full rounded-2xl border border-tavern-200 px-4 py-2 text-sm outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tags..."
          />

          <form className="mt-4 rounded-2xl border border-tavern-200 p-3 md:shrink-0" onSubmit={createDefinition}>
            <h3 className="font-bold text-tavern-900">Create Definition</h3>
            <div className="mobile-full-actions mt-3 grid gap-2">
              <input
                className="rounded-xl border border-tavern-200 px-3 py-2 text-sm"
                value={newDefinition.name}
                onChange={(event) =>
                  setNewDefinition((definition) => ({ ...definition, name: event.target.value }))
                }
                placeholder="Tag name"
              />
              <input
                className="rounded-xl border border-tavern-200 px-3 py-2 text-sm"
                value={newDefinition.color}
                onChange={(event) =>
                  setNewDefinition((definition) => ({ ...definition, color: event.target.value }))
                }
                placeholder="#color"
              />
              <input
                className="rounded-xl border border-tavern-200 px-3 py-2 text-sm"
                value={newDefinition.category}
                onChange={(event) =>
                  setNewDefinition((definition) => ({
                    ...definition,
                    category: event.target.value,
                  }))
                }
                placeholder="Category"
              />
              <Button
                size="sm"
                type="submit"
                variant="primary"
                disabled={Boolean(saving)}
              >
                {saving === "create" ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>

          <div className="mt-4 grid gap-2 pb-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-10 md:pr-1 md:[scroll-padding-bottom:2.5rem]">
              {loading && <p className="text-sm text-slate-600">Loading tags...</p>}
              {!loading && filteredTags.length === 0 && (
                <p className="text-sm text-slate-600">No tags found.</p>
              )}
              {filteredTags.map((tag) => (
                <button
                  className={`w-full rounded-2xl border px-3 py-2 text-left text-sm transition ${
                    selectedName === tag.name
                      ? "border-tavern-700 bg-tavern-50"
                      : "border-tavern-200 bg-white hover:border-tavern-700"
                  }`}
                  key={tag.name}
                  type="button"
                  onClick={() => setSelectedName(tag.name)}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-tavern-200 bg-white"
                    />
                    <span
                      className="truncate font-bold text-tavern-900"
                      style={getTagTextStyle(tag.name, tagMetadataByName)}
                    >
                      {tag.name}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {tag.count} characters - {formatPercent(tag.percentageOfCharacters)}
                  </span>
                </button>
              ))}
          </div>
        </section>

        <section className="p-4 pb-10 md:min-h-0 md:overflow-y-auto md:p-5 md:pb-10 md:[scroll-padding-bottom:2.5rem]">
            {error && (
              <Alert className="mb-4" variant="error">
                {error}
              </Alert>
            )}
            {message && (
              <Alert className="mb-4" variant="success">
                {message}
              </Alert>
            )}

            {!selectedTag && !loading && (
              <CommonStatusPanel
                message="Select a tag to inspect it."
                variant="empty"
              />
            )}

            {selectedTag && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-tavern-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-600">Selected tag</p>
                      <h3 className="mt-1 text-2xl font-bold text-tavern-900">{selectedTag.name}</h3>
                    </div>
                    <div className="text-left text-sm text-slate-600 sm:text-right">
                      <p className="font-bold text-tavern-900">{selectedTag.count} characters</p>
                      <p>{formatPercent(selectedTag.percentageOfCharacters)} of library</p>
                    </div>
                  </div>
                  {selectedTag.category && (
                    <p className="mt-2 text-sm text-slate-600">Category: {selectedTag.category}</p>
                  )}
                </section>

                <section className="rounded-2xl border border-tavern-200 bg-white p-4">
                  <h4 className="font-bold text-tavern-900">Characters</h4>
                  {selectedTag.characters.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">No characters currently use this tag.</p>
                  ) : (
                    <div className="mt-3 grid gap-2 pb-2 md:max-h-72 md:overflow-y-auto md:pb-4 md:pr-1 md:[scroll-padding-bottom:1rem]">
                      {selectedTag.characters.map((character) => (
                        <Link
                          className="rounded-xl border border-tavern-200 px-3 py-2 text-sm font-semibold text-tavern-700 transition hover:border-tavern-700"
                          key={character.id}
                          to={`/cards/${encodeURIComponent(character.id)}`}
                          onClick={onClose}
                        >
                          {character.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                <form className="rounded-2xl border border-tavern-200 bg-white p-4" onSubmit={saveMetadata}>
                  <h4 className="font-bold text-tavern-900">Metadata</h4>
                  <div className="mobile-full-actions mt-3 grid gap-3 sm:grid-cols-[120px_1fr_auto]">
                    <input
                      className="h-10 rounded-xl border border-tavern-200 px-3 text-sm"
                      value={metadata.color}
                      onChange={(event) =>
                        setMetadata((currentMetadata) => ({
                          ...currentMetadata,
                          color: event.target.value,
                        }))
                      }
                      placeholder="#color"
                    />
                    <input
                      className="h-10 rounded-xl border border-tavern-200 px-3 text-sm"
                      value={metadata.category}
                      onChange={(event) =>
                        setMetadata((currentMetadata) => ({
                          ...currentMetadata,
                          category: event.target.value,
                        }))
                      }
                      placeholder="Category"
                    />
                    <Button
                      size="sm"
                      type="submit"
                      variant="primary"
                      disabled={Boolean(saving)}
                    >
                      {saving === "metadata" ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>

                <form className="rounded-2xl border border-tavern-200 bg-white p-4" onSubmit={renameSelectedTag}>
                  <h4 className="font-bold text-tavern-900">Rename Tag</h4>
                  <div className="mobile-full-actions mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-tavern-200 px-3 py-2 text-sm"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      placeholder="New tag name"
                    />
                    <Button
                      size="sm"
                      type="submit"
                      variant="primary"
                      disabled={Boolean(saving)}
                    >
                      {saving === "rename" ? "Renaming..." : "Rename"}
                    </Button>
                  </div>
                </form>

                <form className="rounded-2xl border border-tavern-200 bg-white p-4" onSubmit={mergeSelectedTags}>
                  <h4 className="font-bold text-tavern-900">Merge Tags</h4>
                  <div className="mt-3 max-h-36 overflow-y-auto rounded-2xl border border-tavern-200 p-3">
                    {tags.map((tag) => (
                      <label className="mb-2 flex items-center gap-2 text-sm" key={tag.name}>
                        <input
                          type="checkbox"
                          checked={mergeSources.includes(tag.name)}
                          onChange={() => toggleMergeSource(tag.name)}
                        />
                        <span>{tag.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mobile-full-actions mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-tavern-200 px-3 py-2 text-sm"
                      value={mergeTarget}
                      onChange={(event) => setMergeTarget(event.target.value)}
                      placeholder="Target tag"
                      list="tag-manager-target-tags"
                    />
                    <datalist id="tag-manager-target-tags">
                      {tags.map((tag) => (
                        <option value={tag.name} key={tag.name} />
                      ))}
                    </datalist>
                    <Button
                      size="sm"
                      type="submit"
                      variant="primary"
                      disabled={Boolean(saving)}
                    >
                      {saving === "merge" ? "Merging..." : "Merge"}
                    </Button>
                  </div>
                </form>

                <section className="rounded-2xl border border-red-200 bg-white p-4">
                  <h4 className="font-bold text-red-900">Delete Tag</h4>
                  <Button
                    className="mt-3 max-sm:w-full"
                    size="sm"
                    type="button"
                    variant="danger"
                    disabled={Boolean(saving)}
                    onClick={deleteSelectedTag}
                  >
                    {saving === "delete" ? "Deleting..." : "Delete Tag"}
                  </Button>
                </section>
              </div>
            )}
        </section>
      </div>
    </Drawer>
  );
}

export default TagManagerDrawer;
