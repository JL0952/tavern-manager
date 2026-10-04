import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, StatusPanel, Toolbar } from "../components/common/index.js";
import LibraryNav from "../components/LibraryNav.jsx";
import {
  deleteWorldBook,
  downloadWorldBook,
  getWorldBook,
  updateWorldBook,
} from "../services/api.js";
import { formatTimestamp, getWorldBookSourceLabel } from "../utils/format.js";
// Sync's own entry defaults (SillyTavern's new-entry template), so an entry
// made or saved here means what it means in SillyTavern.
import { WORLDBOOK_ENTRY_DEFAULTS as entryDefaults } from "../../../server/services/syncProjection.js";

const sortModes = ["original", "asc", "desc"];

function createEntryId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeText(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)) : [];
}

function parseListInput(value) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberInput(value) {
  if (value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRoleInput(value) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsed = Number(trimmedValue);
  return Number.isNaN(parsed) ? trimmedValue : parsed;
}

function formatInputValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeEntryForForm(entry, index) {
  const normalizedEntry = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};

  return {
    ...normalizedEntry,
    id: normalizeText(normalizedEntry.id || index),
    keys: normalizeList(normalizedEntry.keys),
    secondaryKeys: normalizeList(normalizedEntry.secondaryKeys),
    comment: normalizeText(normalizedEntry.comment),
    content: normalizeText(normalizedEntry.content),
    enabled: normalizedEntry.enabled !== false,
    constant: Boolean(normalizedEntry.constant),
    selective: normalizedEntry.selective !== false,
    position: normalizedEntry.position ?? entryDefaults.position,
    order: normalizedEntry.order ?? entryDefaults.order,
    useRegex: Boolean(normalizedEntry.useRegex),
    probability: normalizedEntry.probability ?? entryDefaults.probability,
    useProbability: typeof normalizedEntry.useProbability === "boolean"
      ? normalizedEntry.useProbability
      : entryDefaults.useProbability,
    depth: normalizedEntry.depth ?? entryDefaults.depth,
    // An explicit null role is a choice; only a missing one takes the default.
    role: normalizedEntry.role === undefined ? entryDefaults.role : normalizedEntry.role,
  };
}

function createFormState(worldBook) {
  return {
    name: worldBook.name || "",
    entries: Array.isArray(worldBook.entries)
      ? worldBook.entries.map(normalizeEntryForForm)
      : [],
  };
}

function getFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getNextEntryOrder(entries) {
  const existingOrders = entries
    .map((entry, index) => getFiniteNumber(entry.order) ?? index)
    .filter((value) => Number.isFinite(value));

  return existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : entryDefaults.order;
}

function createBlankEntry(entries) {
  const id = createEntryId();

  return {
    id,
    keys: [],
    secondaryKeys: [],
    comment: entryDefaults.comment,
    content: entryDefaults.content,
    enabled: entryDefaults.enabled,
    constant: entryDefaults.constant,
    selective: entryDefaults.selective,
    position: entryDefaults.position,
    order: getNextEntryOrder(entries),
    useRegex: entryDefaults.useRegex,
    probability: entryDefaults.probability,
    useProbability: entryDefaults.useProbability,
    depth: entryDefaults.depth,
    role: entryDefaults.role,
  };
}

function entryMatchesSearch(entry, search) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return [
    entry.comment,
    entry.content,
    ...(Array.isArray(entry.keys) ? entry.keys : []),
    ...(Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []),
  ].some((value) => normalizeText(value).toLowerCase().includes(query));
}

function getSortLabel(entry) {
  return (
    normalizeText(entry.keys?.[0]).trim() ||
    normalizeText(entry.comment).trim() ||
    normalizeText(entry.id).trim()
  );
}

function compareText(leftValue, rightValue) {
  const leftText = normalizeText(leftValue).trim();
  const rightText = normalizeText(rightValue).trim();

  if (!leftText && !rightText) {
    return 0;
  }

  if (!leftText) {
    return 1;
  }

  if (!rightText) {
    return -1;
  }

  return leftText.localeCompare(rightText, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getImportOrderValue(entry, fields) {
  for (const field of fields) {
    const value = field.split(".").reduce((current, key) => current?.[key], entry);
    const numericValue = getFiniteNumber(value);

    if (numericValue !== null) {
      return numericValue;
    }
  }

  return null;
}

function compareOriginalOrder(left, right) {
  const fieldGroups = [
    ["order", "rawEntry.order", "rawEntry.insertion_order"],
    ["displayIndex", "display_index", "rawEntry.displayIndex", "rawEntry.display_index"],
    ["id", "uid", "rawEntry.id", "rawEntry.uid"],
  ];

  for (const fields of fieldGroups) {
    const leftValue = getImportOrderValue(left.entry, fields);
    const rightValue = getImportOrderValue(right.entry, fields);

    if (leftValue === null && rightValue === null) {
      continue;
    }

    if (leftValue === null) {
      return 1;
    }

    if (rightValue === null) {
      return -1;
    }

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return left.index - right.index;
}

function compareAlphabetical(left, right) {
  const fieldComparisons = [compareText(getSortLabel(left.entry), getSortLabel(right.entry))];

  return fieldComparisons.find((comparison) => comparison !== 0) ?? compareOriginalOrder(left, right);
}

function sortEntryView(entries, sortMode) {
  const nextEntries = [...entries];

  if (sortMode === "asc") {
    return nextEntries.sort(compareAlphabetical);
  }

  if (sortMode === "desc") {
    return nextEntries.sort((left, right) => compareAlphabetical(right, left));
  }

  return nextEntries.sort(compareOriginalOrder);
}

function getNextSortMode(sortMode) {
  const currentIndex = sortModes.indexOf(sortMode);
  return sortModes[(currentIndex + 1) % sortModes.length];
}

function getSortModeLabel(sortMode) {
  if (sortMode === "asc") {
    return "Order: A-Z";
  }

  if (sortMode === "desc") {
    return "Order: Z-A";
  }

  return "Order: Original";
}

function getEntryIdentity(entry, index) {
  return `${normalizeText(entry.id) || "entry"}-${index}`;
}

function getEntryTitle(entry) {
  return normalizeText(entry.comment).trim();
}

function getEntryKeySummary(entry) {
  const keys = Array.isArray(entry.keys) ? entry.keys.filter(Boolean) : [];

  if (keys[0]) {
    return keys[0];
  }

  return `${keys.length} ${keys.length === 1 ? "key" : "keys"}`;
}

function getEntryFlags(entry) {
  return [
    entry.enabled === false ? "Disabled" : "Enabled",
    entry.constant ? "Constant" : "",
    entry.selective ? "Selective" : "",
  ].filter(Boolean);
}

function WorldBookDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [worldBook, setWorldBook] = useState(null);
  const [form, setForm] = useState(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [sortMode, setSortMode] = useState("original");
  const [expandedEntries, setExpandedEntries] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const backToWorldBooks =
    typeof location.state?.from === "string" ? location.state.from : "/worldbooks";

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");
    setStatus("");
    setNotFound(false);

    getWorldBook(id)
      .then((book) => {
        if (active) {
          setWorldBook(book);
          setForm(createFormState(book));
          setSortMode("original");
          setExpandedEntries(new Set());
        }
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        if (requestError.status === 404) {
          setNotFound(true);
        } else {
          setError(requestError.message);
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
  }, [id]);

  const visibleEntries = useMemo(() => {
    if (!form) {
      return [];
    }

    const matchingEntries = form.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entryMatchesSearch(entry, entrySearch));

    return sortEntryView(matchingEntries, sortMode);
  }, [entrySearch, form, sortMode]);

  function updateName(value) {
    setStatus("");
    setForm((currentForm) => ({ ...currentForm, name: value }));
  }

  function updateEntry(index, field, value) {
    setStatus("");
    setForm((currentForm) => ({
      ...currentForm,
      entries: currentForm.entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  }

  function addEntry() {
    setStatus("");
    setForm((currentForm) => ({
      ...currentForm,
      entries: [...currentForm.entries, createBlankEntry(currentForm.entries)],
    }));
  }

  function deleteEntry(index) {
    setStatus("");
    setForm((currentForm) => ({
      ...currentForm,
      entries: currentForm.entries.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function cycleSortMode() {
    setStatus("");
    setSortMode((currentSortMode) => getNextSortMode(currentSortMode));
  }

  function toggleEntry(entry, index) {
    const identity = getEntryIdentity(entry, index);

    setExpandedEntries((currentEntries) => {
      const nextEntries = new Set(currentEntries);

      if (nextEntries.has(identity)) {
        nextEntries.delete(identity);
      } else {
        nextEntries.add(identity);
      }

      return nextEntries;
    });
  }

  function expandVisibleEntries() {
    setExpandedEntries((currentEntries) => {
      const nextEntries = new Set(currentEntries);

      visibleEntries.forEach(({ entry, index }) => {
        nextEntries.add(getEntryIdentity(entry, index));
      });

      return nextEntries;
    });
  }

  function collapseAllEntries() {
    setExpandedEntries(new Set());
  }

  function resetForm() {
    setError("");
    setStatus("");
    setEntrySearch("");
    setSortMode("original");
    setExpandedEntries(new Set());
    setForm(createFormState(worldBook));
  }

  async function saveChanges(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");

    try {
      const updatedWorldBook = await updateWorldBook(id, {
        name: form.name,
        entries: form.entries,
      });

      setWorldBook(updatedWorldBook);
      setForm(createFormState(updatedWorldBook));
      setStatus("Saved.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadBook() {
    setDownloading(true);
    setError("");
    setStatus("");

    try {
      await downloadWorldBook(id, form.name || worldBook.name || "worldbook");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading(false);
    }
  }

  async function removeBook() {
    if (!window.confirm(`Delete worldbook ${form.name || worldBook.name || "this worldbook"}? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setError("");
    setStatus("");

    try {
      await deleteWorldBook(id);
      navigate(backToWorldBooks);
    } catch (requestError) {
      setError(requestError.message);
      setDeleting(false);
    }
  }

  if (loading) {
    return <StatusPage backToWorldBooks={backToWorldBooks} message="Loading worldbook..." />;
  }

  if (notFound) {
    return (
      <StatusPage
        backToWorldBooks={backToWorldBooks}
        title="Worldbook not found"
        message="This worldbook may have been deleted or the link may be incorrect."
      />
    );
  }

  if (!worldBook || !form) {
    return (
      <StatusPage
        backToWorldBooks={backToWorldBooks}
        title="Unable to load worldbook"
        message={error}
        error
      />
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <LibraryNav />
        <Link
          className="text-sm font-semibold text-tavern-700 hover:text-tavern-900"
          to={backToWorldBooks}
        >
          Back to worldbooks
        </Link>

        <form className="mt-6" onSubmit={saveChanges}>
          <header className="rounded-3xl border border-tavern-200 bg-white p-4 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tavern-700 sm:tracking-[0.2em]">
                  {getWorldBookSourceLabel(worldBook.source)}
                </p>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-tavern-900">Worldbook name</span>
                  <input
                    className="mt-2 w-full rounded-2xl border border-tavern-200 bg-white px-4 py-3 text-2xl font-bold text-tavern-900 outline-none transition focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200 sm:text-4xl"
                    value={form.name}
                    onChange={(event) => updateName(event.target.value)}
                    placeholder="Unnamed worldbook"
                  />
                </label>
              </div>

              <Toolbar className="mobile-full-actions justify-start lg:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={downloading || saving || deleting}
                  onClick={downloadBook}
                >
                  {downloading ? "Downloading..." : "Download JSON"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving || deleting}
                  onClick={resetForm}
                >
                  Reset
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving || deleting}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={downloading || saving || deleting}
                  onClick={removeBook}
                >
                  {deleting ? "Deleting..." : "Delete Worldbook"}
                </Button>
              </Toolbar>
            </div>

            <dl className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
              <Metadata label="Source" value={getWorldBookSourceLabel(worldBook.source)} />
              <Metadata
                label="Entries"
                value={`${form.entries.length} ${form.entries.length === 1 ? "entry" : "entries"}`}
              />
              <Metadata
                label="Linked characters"
                value={`${(worldBook.linkedCharacters || []).length} ${
                  (worldBook.linkedCharacters || []).length === 1
                    ? "character"
                    : "characters"
                }`}
              />
              <Metadata label="Updated" value={formatTimestamp(worldBook.updatedAt)} />
            </dl>

            <LinkedCharactersPanel linkedCharacters={worldBook.linkedCharacters || []} />
          </header>

          {error && (
            <Alert className="mt-6" variant="error">
              {error}
            </Alert>
          )}

          {status && (
            <Alert className="mt-6" variant="success">
              {status}
            </Alert>
          )}

          <section className="py-8" aria-label="Worldbook entry tools">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="block min-w-0 flex-1 lg:max-w-xl">
                <span className="sr-only">Search entries</span>
                <input
                  className="h-11 w-full rounded-full border border-tavern-200 bg-white px-5 text-sm text-tavern-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
                  type="search"
                  value={entrySearch}
                  onChange={(event) => setEntrySearch(event.target.value)}
                  placeholder="Search entries..."
                />
              </label>

              <Toolbar className="mobile-full-actions justify-start lg:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cycleSortMode}
                >
                  {getSortModeLabel(sortMode)}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={expandVisibleEntries}
                >
                  Expand all
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={collapseAllEntries}
                >
                  Collapse all
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={addEntry}
                >
                  Add entry
                </Button>
              </Toolbar>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Showing {visibleEntries.length} of {form.entries.length} entries.
            </p>
          </section>

          {visibleEntries.length === 0 ? (
            <StatusPanel
              title={entrySearch ? "No matching entries" : "This worldbook has no entries"}
              message={entrySearch ? "Try a different entry search term." : "Add an entry to begin editing."}
            />
          ) : (
            <section className="space-y-5" aria-label="Worldbook entries">
              {visibleEntries.map(({ entry, index }) => (
                <EntryEditor
                  entry={entry}
                  expanded={expandedEntries.has(getEntryIdentity(entry, index))}
                  index={index}
                  key={`${entry.id}-${index}`}
                  onDelete={() => deleteEntry(index)}
                  onFieldChange={(field, value) => updateEntry(index, field, value)}
                  onToggle={() => toggleEntry(entry, index)}
                />
              ))}
            </section>
          )}
        </form>
      </div>
    </main>
  );
}

function EntryEditor({ entry, expanded, index, onDelete, onFieldChange, onToggle }) {
  const flags = getEntryFlags(entry);

  return (
    <article className="overflow-hidden rounded-3xl border border-tavern-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <button
          className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-2 py-2 text-left transition hover:bg-tavern-50 focus:outline-none focus:ring-2 focus:ring-tavern-200"
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tavern-50 text-sm font-bold text-tavern-700">
            {expanded ? "v" : ">"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block min-h-6 truncate text-base font-bold text-tavern-900">
              {getEntryTitle(entry)}
            </span>
            <span className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              <span className="max-w-full truncate">{getEntryKeySummary(entry)}</span>
              {flags.map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
            </span>
          </span>
        </button>

        <Button
          className="self-start max-sm:w-full sm:self-center"
          size="sm"
          type="button"
          variant="danger"
          onClick={onDelete}
        >
          Delete Entry
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-tavern-200 p-4 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <TextField
              label="Comment"
              value={entry.comment}
              onChange={(value) => onFieldChange("comment", value)}
            />
            <TextField
              label="Role"
              value={formatInputValue(entry.role)}
              onChange={(value) => onFieldChange("role", parseRoleInput(value))}
              placeholder="0, 1, or custom role"
            />
            <TextField
              label="Content"
              value={entry.content}
              textarea
              onChange={(value) => onFieldChange("content", value)}
            />
            <div className="grid gap-5">
              <ListField
                label="Keys"
                values={entry.keys}
                onChange={(value) => onFieldChange("keys", parseListInput(value))}
              />
              <ListField
                label="Secondary keys"
                values={entry.secondaryKeys}
                onChange={(value) => onFieldChange("secondaryKeys", parseListInput(value))}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["enabled", "constant", "selective", "useRegex", "useProbability"].map((field) => (
              <CheckboxField
                checked={Boolean(entry[field])}
                key={field}
                label={fieldLabels[field]}
                onChange={(value) => onFieldChange(field, value)}
              />
            ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["position", "order", "probability", "depth"].map((field) => (
              <NumberField
                key={field}
                label={fieldLabels[field]}
                value={entry[field]}
                onChange={(value) => onFieldChange(field, value)}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function LinkedCharactersPanel({ linkedCharacters }) {
  return (
    <section className="mt-5 rounded-2xl border border-tavern-200 bg-tavern-50 px-4 py-3">
      <h2 className="text-sm font-bold text-tavern-900">
        {linkedCharacters.length}{" "}
        {linkedCharacters.length === 1 ? "linked character" : "linked characters"}
      </h2>
      {linkedCharacters.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">No linked characters.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {linkedCharacters.map((character) => (
            <Link
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-tavern-700 transition hover:text-tavern-900"
              key={character.id}
              to={`/cards/${encodeURIComponent(character.id)}`}
            >
              {character.name || "Unnamed character"}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const fieldLabels = {
  enabled: "Enabled",
  constant: "Constant",
  selective: "Selective",
  useRegex: "Use regex",
  useProbability: "Use probability",
  position: "Position",
  order: "Order",
  probability: "Probability",
  depth: "Depth",
};

function TextField({ label, value, textarea = false, placeholder = "", onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-tavern-900">{label}</span>
      {textarea ? (
        <textarea
          className="mt-2 min-h-44 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="mt-2 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function ListField({ label, values, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-tavern-900">{label}</span>
      <textarea
        className="mt-2 min-h-24 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
        value={normalizeList(values).join("\n")}
        onChange={(event) => onChange(event.target.value)}
        placeholder="One key per line"
      />
    </label>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-tavern-200 bg-tavern-50 px-4 py-3 text-sm font-semibold text-tavern-900">
      <input
        className="h-4 w-4 accent-tavern-700"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-tavern-900">{label}</span>
      <input
        className="mt-2 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
        type="number"
        value={formatInputValue(value)}
        onChange={(event) => onChange(parseNumberInput(event.target.value))}
      />
    </label>
  );
}

function Metadata({ label, value }) {
  return (
    <div>
      <dt className="font-semibold text-tavern-900">{label}</dt>
      <dd className="mt-1 break-all">{value}</dd>
    </div>
  );
}

function StatusPage({ backToWorldBooks = "/worldbooks", title, message, error = false }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
      <LibraryNav />
      <StatusPanel
        className="mx-auto max-w-3xl text-left"
        title={title}
        message={message}
        variant={error ? "error" : "empty"}
      >
        <Link
          className="mt-5 inline-block text-sm font-semibold text-tavern-700"
          to={backToWorldBooks}
        >
          Back to worldbooks
        </Link>
      </StatusPanel>
      </div>
    </main>
  );
}

export default WorldBookDetailPage;
