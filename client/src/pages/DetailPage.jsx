import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import CollapsibleSection from "../components/CardDetail/CollapsibleSection.jsx";
import GreetingSection from "../components/CardDetail/GreetingSection.jsx";
import {
  Alert,
  Button,
  FileButton,
  Modal,
  OverlayHeader,
  StatusPanel,
  Toolbar,
} from "../components/common/index.js";
import {
  deleteCard,
  downloadCharacterCard,
  getCard,
  getTags,
  getWorldBook,
  getWorldBooks,
  updateCard,
  updateCardPin,
  updateCharacterWorldBook,
  uploadCharacterAvatar,
} from "../services/api.js";
import { createCardFormState, createCardUpdatePayload } from "../utils/characterForms.js";
import { formatTimestamp } from "../utils/format.js";
import { createTagMetadataMap, getTagTextStyle } from "../utils/tagStyles.js";
import CharacterNoteFields from "../components/CharacterNoteFields.jsx";
import LibraryNav from "../components/LibraryNav.jsx";

const basicEditableFields = [
  ["name", "Name", "input"],
  ["creator", "Creator", "input"],
  ["character_version", "Character version", "input"],
];

const promptEditableFields = [
  ["description", "Description", "textarea"],
  ["personality", "Personality", "textarea"],
  ["scenario", "Scenario", "textarea"],
  ["mes_example", "Message examples", "textarea"],
  ["creator_notes", "Creator notes", "textarea"],
  ["system_prompt", "System prompt", "textarea"],
  ["post_history_instructions", "Post-history instructions", "textarea"],
];

const profileDetailFields = [
  ["creator", "Creator"],
  ["character_version", "Character version"],
];

const promptDetailFields = [
  ["description", "Description"],
  ["personality", "Personality"],
  ["scenario", "Scenario"],
  ["mes_example", "Message examples"],
  ["creator_notes", "Creator notes"],
  ["system_prompt", "System prompt"],
  ["post_history_instructions", "Post-history instructions"],
];

const supportedAvatarExtensions = [".png", ".jpg", ".jpeg", ".webp"];
const supportedAvatarTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function isSupportedAvatarFile(file) {
  const fileName = file.name.toLowerCase();

  return (
    supportedAvatarTypes.has(file.type) ||
    supportedAvatarExtensions.some((extension) => fileName.endsWith(extension))
  );
}

function DetailPage({ refreshKey = 0 }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [form, setForm] = useState(null);
  const [tagSummaries, setTagSummaries] = useState([]);
  const [linkedWorldBook, setLinkedWorldBook] = useState(null);
  const [worldBookPickerOpen, setWorldBookPickerOpen] = useState(false);
  const [worldBookOptions, setWorldBookOptions] = useState([]);
  const [worldBookPickerSearch, setWorldBookPickerSearch] = useState("");
  const [selectedWorldBookId, setSelectedWorldBookId] = useState("");
  const [loadingWorldBookOptions, setLoadingWorldBookOptions] = useState(false);
  const [worldBookPickerError, setWorldBookPickerError] = useState("");
  const [worldBookUpdating, setWorldBookUpdating] = useState(false);
  const [unlinkingWorldBook, setUnlinkingWorldBook] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const backToLibrary = typeof location.state?.from === "string" ? location.state.from : "/";

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");
    setNotFound(false);

    Promise.all([getCard(id), getTags()])
      .then(([character, nextTagSummaries]) => {
        if (active) {
          setCard(character);
          setForm(createCardFormState(character));
          setTagSummaries(nextTagSummaries);
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
  }, [id, refreshKey]);

  useEffect(
    () => () => {
      if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl);
      }
    },
    [pendingAvatarPreviewUrl],
  );

  const tagMetadataByName = useMemo(() => createTagMetadataMap(tagSummaries), [tagSummaries]);
  const filteredWorldBookOptions = useMemo(() => {
    const query = worldBookPickerSearch.trim().toLowerCase();

    if (!query) {
      return worldBookOptions;
    }

    return worldBookOptions.filter((worldBook) =>
      String(worldBook.name || "").toLowerCase().includes(query),
    );
  }, [worldBookOptions, worldBookPickerSearch]);

  useEffect(() => {
    let active = true;

    setLinkedWorldBook(null);

    if (!card?.worldBookId) {
      return () => {
        active = false;
      };
    }

    getWorldBook(card.worldBookId)
      .then((worldBook) => {
        if (active) {
          setLinkedWorldBook(worldBook);
        }
      })
      .catch(() => {
        if (active) {
          setLinkedWorldBook(null);
        }
      });

    return () => {
      active = false;
    };
  }, [card?.worldBookId]);

  function updateForm(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function clearPendingAvatar() {
    setPendingAvatarFile(null);
    setPendingAvatarPreviewUrl("");
  }

  function cancelEditing() {
    setForm(createCardFormState(card));
    setError("");
    clearPendingAvatar();
    setEditing(false);
  }

  async function saveChanges(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      let updatedCard = await updateCard(id, createCardUpdatePayload(form));

      if (pendingAvatarFile) {
        updatedCard = await uploadCharacterAvatar(id, pendingAvatarFile);
      }

      setCard(updatedCard);
      setForm(createCardFormState(updatedCard));
      clearPendingAvatar();
      setEditing(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function downloadCard(format) {
    setDownloading(format);
    setError("");

    try {
      await downloadCharacterCard(id, format);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading("");
    }
  }

  async function togglePinned() {
    const nextPinned = !card.pinned;

    setPinning(true);
    setError("");
    setCard((currentCard) => ({ ...currentCard, pinned: nextPinned }));

    try {
      const updatedCard = await updateCardPin(id, nextPinned);
      setCard(updatedCard);
      setForm(createCardFormState(updatedCard));
    } catch (requestError) {
      setCard((currentCard) => ({ ...currentCard, pinned: !nextPinned }));
      setError(requestError.message);
    } finally {
      setPinning(false);
    }
  }

  async function openWorldBookPicker() {
    setWorldBookPickerOpen(true);
    setWorldBookPickerSearch("");
    setSelectedWorldBookId(card.worldBookId || "");
    setWorldBookPickerError("");
    setLoadingWorldBookOptions(true);

    try {
      const books = await getWorldBooks();
      setWorldBookOptions(books);
    } catch (requestError) {
      setWorldBookPickerError(requestError.message);
      setWorldBookOptions([]);
    } finally {
      setLoadingWorldBookOptions(false);
    }
  }

  function closeWorldBookPicker() {
    if (worldBookUpdating) {
      return;
    }

    setWorldBookPickerOpen(false);
    setWorldBookPickerError("");
  }

  async function applyWorldBookLink() {
    if (!selectedWorldBookId) {
      setWorldBookPickerError("Select a worldbook to link.");
      return;
    }

    setWorldBookUpdating(true);
    setWorldBookPickerError("");
    setError("");

    try {
      const updatedCard = await updateCharacterWorldBook(id, selectedWorldBookId);
      setCard(updatedCard);
      setForm(createCardFormState(updatedCard));
      setLinkedWorldBook(
        worldBookOptions.find((worldBook) => worldBook.id === updatedCard.worldBookId) || null,
      );
      setWorldBookPickerOpen(false);
    } catch (requestError) {
      setWorldBookPickerError(requestError.message);
    } finally {
      setWorldBookUpdating(false);
    }
  }

  async function unlinkWorldBook() {
    if (
      !window.confirm(
        "This removes the worldbook link and removes embedded character_book from future exports.",
      )
    ) {
      return;
    }

    setUnlinkingWorldBook(true);
    setError("");

    try {
      const updatedCard = await updateCharacterWorldBook(id, null);
      setCard(updatedCard);
      setForm(createCardFormState(updatedCard));
      setLinkedWorldBook(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUnlinkingWorldBook(false);
    }
  }

  function stageAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedAvatarFile(file)) {
      setError("Choose a PNG, JPG, JPEG, or WEBP avatar.");
      return;
    }

    setError("");
    setPendingAvatarFile(file);
    setPendingAvatarPreviewUrl(URL.createObjectURL(file));
  }

  async function removeCard() {
    if (!window.confirm(`Delete ${card.name || "this character card"}? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      await deleteCard(id);
      navigate(backToLibrary);
    } catch (requestError) {
      setError(requestError.message);
      setDeleting(false);
    }
  }

  if (loading) {
    return <StatusPage backToLibrary={backToLibrary} message="Loading character details..." />;
  }

  if (notFound) {
    return (
      <StatusPage
        backToLibrary={backToLibrary}
        title="Character card not found"
        message="This card may have been deleted or the link may be incorrect."
      />
    );
  }

  if (!card) {
    return (
      <StatusPage
        backToLibrary={backToLibrary}
        title="Unable to load character card"
        message={error}
      />
    );
  }

  const avatarPreviewSrc =
    editing && pendingAvatarPreviewUrl
      ? pendingAvatarPreviewUrl
      : card.avatar
        ? `/${card.avatar}?v=${encodeURIComponent(card.updatedAt || "")}`
        : "";

  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <LibraryNav />
        <Link className="text-sm font-semibold text-tavern-700 hover:text-tavern-900" to={backToLibrary}>
          Back to library
        </Link>

        <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr] lg:gap-8">
          <aside className="space-y-5">
            <section className="rounded-3xl border border-tavern-200 bg-white p-4 shadow-sm">
              <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl border border-tavern-200 bg-tavern-200 text-6xl font-bold text-tavern-700">
              {avatarPreviewSrc ? (
                <img
                  className="h-full w-full object-cover"
                  src={avatarPreviewSrc}
                  alt=""
                />
              ) : (
                card.name?.charAt(0).toUpperCase() || "?"
              )}
              </div>

              {editing && (
                <FileButton
                  className="mt-4 w-full"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  disabled={saving}
                  onChange={stageAvatar}
                  variant="secondary"
                >
                  {pendingAvatarFile ? "Change Avatar Preview" : "Change Avatar"}
                </FileButton>
              )}
            </section>

            <LinkedWorldBookPanel
              onChange={openWorldBookPicker}
              onUnlink={unlinkWorldBook}
              unlinking={unlinkingWorldBook}
              worldBook={linkedWorldBook}
              worldBookId={card.worldBookId}
            />

            <CollapsibleSection title="Card File Details" summary="Source and timestamps">
              <dl className="space-y-3 text-sm">
                <Metadata label="Source type" value={card.sourceType || "Not available"} />
                <Metadata label="File name" value={card.fileName || "Not available"} />
                <Metadata label="Created" value={formatTimestamp(card.createdAt)} />
                <Metadata label="Updated" value={formatTimestamp(card.updatedAt)} />
              </dl>
            </CollapsibleSection>
          </aside>

          <section className="rounded-3xl border border-tavern-200 bg-white p-4 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 border-b border-tavern-200 pb-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-tavern-700 sm:tracking-[0.2em]">
                  {editing ? "Editing character" : "Character details"}
                </p>
                <h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-tavern-900 sm:text-4xl">
                  {(editing ? form?.name : card.name) || "Unnamed character"}
                </h1>
                {editing && (
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Review each section, then save the character card changes.
                  </p>
                )}
              </div>

              <div className="mobile-full-actions flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap lg:justify-end">
                {editing ? (
                  <>
                    <Button
                      className="whitespace-nowrap"
                      form="character-edit-form"
                      size="sm"
                      type="submit"
                      variant="primary"
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant="secondary"
                      disabled={saving}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant={card.pinned ? "primary" : "secondary"}
                      disabled={pinning || Boolean(downloading || deleting)}
                      onClick={togglePinned}
                    >
                      {pinning ? "..." : card.pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant="secondary"
                      disabled={Boolean(downloading || deleting)}
                      onClick={() => downloadCard("json")}
                    >
                      {downloading === "json" ? "Downloading JSON..." : "Download JSON"}
                    </Button>
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant="secondary"
                      disabled={Boolean(downloading || deleting)}
                      onClick={() => downloadCard("png")}
                    >
                      {downloading === "png" ? "Downloading PNG..." : "Download PNG"}
                    </Button>
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant="primary"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                    <span className="hidden h-6 w-px bg-tavern-200 lg:block" aria-hidden="true" />
                    <Button
                      className="whitespace-nowrap"
                      size="sm"
                      type="button"
                      variant="danger"
                      disabled={Boolean(downloading || deleting)}
                      onClick={removeCard}
                    >
                      {deleting ? "Deleting..." : "Delete"}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {error && (
              <Alert className="mt-6" variant="error">
                {error}
              </Alert>
            )}

            {editing ? (
              <form id="character-edit-form" className="mt-6 space-y-7" onSubmit={saveChanges}>
                <FormSection
                  title="Basic Info"
                  description="Names and creator-facing information."
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    {basicEditableFields.map(([field, label, type]) => (
                      <EditableField
                        key={field}
                        field={field}
                        label={label}
                        type={type}
                        value={form[field]}
                        onChange={updateForm}
                      />
                    ))}
                  </div>
                </FormSection>

                <FormSection
                  title="Prompts / Instructions"
                  description="Character text, roleplay setup, and instruction fields."
                >
                  <div className="grid gap-5">
                    {promptEditableFields.map(([field, label, type]) => (
                      <EditableField
                        key={field}
                        field={field}
                        label={label}
                        type={type}
                        value={form[field]}
                        onChange={updateForm}
                      />
                    ))}
                    <CharacterNoteFields value={form.depth_prompt} onChange={(value) => updateForm("depth_prompt", value)} />
                  </div>
                </FormSection>

                <FormSection
                  title="Greetings"
                  description="Collapsed by default; expand to edit greetings and carousels."
                >
                  <GreetingSection
                    firstMes={form.first_mes}
                    alternateGreetings={form.alternate_greetings}
                    groupOnlyGreetings={form.group_only_greetings}
                    editing
                    onFirstMesChange={(value) => updateForm("first_mes", value)}
                    onAlternateGreetingsChange={(value) =>
                      updateForm("alternate_greetings", value)
                    }
                    onGroupOnlyGreetingsChange={(value) =>
                      updateForm("group_only_greetings", value)
                    }
                  />
                </FormSection>

                <FormSection
                  title="Tags"
                  description="Comma-separated tags saved back into the card data."
                >
                  <EditableField
                    field="tags"
                    label="Tags"
                    value={form.tags}
                    onChange={updateForm}
                    placeholder="fantasy, original, favorite"
                  />
                </FormSection>

                <FormSection
                  title="Metadata / Advanced"
                  description="Read-only preserved card data for compatibility."
                  quiet
                >
                  <ReadOnlySections card={card} />
                </FormSection>

                <Toolbar className="mobile-full-actions border-t border-tavern-200 pt-6">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                </Toolbar>
              </form>
            ) : (
              <div className="mt-6 space-y-7">
                {card.tags?.length > 0 && (
                  <section className="flex flex-wrap gap-2" aria-label="Character tags">
                    {card.tags.map((tag) => (
                      <TagBadge key={tag} tag={tag} tagMetadataByName={tagMetadataByName} />
                    ))}
                  </section>
                )}

                <DisplaySection title="Basic Info">
                  <div className="grid gap-5 sm:grid-cols-2">
                    {profileDetailFields.map(([field, label]) => (
                      <DetailField key={field} label={label} value={card[field]} />
                    ))}
                  </div>
                </DisplaySection>

                <DisplaySection title="Prompts / Instructions">
                  <div className="space-y-6">
                    {promptDetailFields.map(([field, label]) => (
                      <DetailField key={field} label={label} value={card[field]} />
                    ))}
                    <DetailField label="Character’s Note" value={card.extensions?.depth_prompt?.prompt} />
                    <DetailField label="Note depth / role" value={`${card.extensions?.depth_prompt?.depth ?? 4} / ${card.extensions?.depth_prompt?.role ?? "system"}`} />
                  </div>
                </DisplaySection>

                <GreetingSection
                  firstMes={card.first_mes || ""}
                  alternateGreetings={card.alternate_greetings || []}
                  groupOnlyGreetings={card.group_only_greetings || []}
                />

                <DisplaySection
                  title="Metadata / Advanced"
                  description="Read-only preserved card data."
                  quiet
                >
                  <ReadOnlySections card={card} />
                </DisplaySection>
              </div>
            )}
          </section>
        </div>
      </div>
      {worldBookPickerOpen && (
        <WorldBookPickerModal
          applying={worldBookUpdating}
          currentWorldBookId={card.worldBookId || ""}
          error={worldBookPickerError}
          filteredWorldBooks={filteredWorldBookOptions}
          loading={loadingWorldBookOptions}
          onApply={applyWorldBookLink}
          onClose={closeWorldBookPicker}
          onSearchChange={setWorldBookPickerSearch}
          onSelect={setSelectedWorldBookId}
          search={worldBookPickerSearch}
          selectedWorldBookId={selectedWorldBookId}
        />
      )}
    </main>
  );
}

function FormSection({ children, description, quiet = false, title }) {
  return (
    <section className="border-t border-tavern-200 pt-6 first:border-t-0 first:pt-0">
      <div className="mb-4">
        <h2 className={`font-bold ${quiet ? "text-base text-tavern-900" : "text-lg text-tavern-900"}`}>
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function DisplaySection({ children, description, quiet = false, title }) {
  return (
    <section className="border-t border-tavern-200 pt-6 first:border-t-0 first:pt-0">
      <h2
        className={`font-bold ${
          quiet ? "text-base text-tavern-900" : "text-lg text-tavern-900"
        }`}
      >
        {title}
      </h2>
      {description && <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EditableField({ field, label, onChange, placeholder = "", type = "input", value }) {
  const fieldClasses =
    "mt-2 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200";

  return (
    <label className="block">
      <span className="text-sm font-semibold text-tavern-900">{label}</span>
      {type === "textarea" ? (
        <textarea
          className={`${fieldClasses} min-h-32 leading-6`}
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={fieldClasses}
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

function TagBadge({ tag, tagMetadataByName }) {
  return (
    <span
      className="rounded-full bg-tavern-50 px-3 py-1 text-xs font-semibold text-tavern-700"
      style={getTagTextStyle(tag, tagMetadataByName)}
    >
      {tag}
    </span>
  );
}

function DetailField({ label, value }) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-tavern-700">{label}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
        {value || "Not provided."}
      </p>
    </section>
  );
}

function WorldBookPickerModal({
  applying,
  currentWorldBookId,
  error,
  filteredWorldBooks,
  loading,
  onApply,
  onClose,
  onSearchChange,
  onSelect,
  search,
  selectedWorldBookId,
}) {
  return (
    <Modal
      ariaLabel="Choose linked worldbook"
      className="top-3 max-h-[calc(100dvh-1.5rem)] sm:top-16 sm:max-h-[82vh]"
      maxWidthClass="max-w-2xl"
      onClose={onClose}
    >
      <OverlayHeader
        eyebrow="Character worldbook"
        title="Link Worldbook"
        subtitle="Choose an existing worldbook for this character."
        closeDisabled={applying}
        onClose={onClose}
      >
        <input
          className="mt-4 h-10 w-full rounded-full border border-tavern-200 px-4 text-sm text-tavern-900 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search worldbooks..."
        />
      </OverlayHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error && (
          <Alert className="mb-4" variant="error">
            {error}
          </Alert>
        )}

        {loading ? (
          <StatusPanel message="Loading worldbooks..." variant="loading" />
        ) : filteredWorldBooks.length === 0 ? (
          <StatusPanel
            title={search ? "No matching worldbooks" : "No worldbooks available"}
            message={
              search
                ? "Try a different worldbook search."
                : "Import a worldbook before linking one to this character."
            }
          />
        ) : (
          <div className="grid gap-3">
            {filteredWorldBooks.map((worldBook) => {
              const selected = selectedWorldBookId === worldBook.id;
              const current = currentWorldBookId === worldBook.id;
              const entryCount = Array.isArray(worldBook.entries) ? worldBook.entries.length : 0;
              const linkedCount = Array.isArray(worldBook.linkedCharacters)
                ? worldBook.linkedCharacters.length
                : null;

              return (
                <button
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-tavern-700 bg-tavern-50"
                      : "border-tavern-200 bg-white hover:border-tavern-700"
                  }`}
                  key={worldBook.id}
                  type="button"
                  onClick={() => onSelect(worldBook.id)}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-tavern-900">
                        {worldBook.name || "Unnamed worldbook"}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">
                        {entryCount} {entryCount === 1 ? "entry" : "entries"}
                        {linkedCount !== null
                          ? ` | ${linkedCount} linked ${linkedCount === 1 ? "character" : "characters"}`
                          : ""}
                      </span>
                    </span>
                    {current && (
                      <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-bold text-tavern-700">
                        Current
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
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
            disabled={applying || loading || !selectedWorldBookId}
            onClick={onApply}
          >
            {applying ? "Applying..." : "Apply"}
          </Button>
        </Toolbar>
      </footer>
    </Modal>
  );
}

function LinkedWorldBookPanel({ onChange, onUnlink, unlinking, worldBook, worldBookId }) {
  const entryCount = Array.isArray(worldBook?.entries) ? worldBook.entries.length : null;
  const hasLinkedWorldBook = Boolean(worldBookId);

  return (
    <section className="rounded-3xl border border-tavern-200 bg-white p-5 text-sm shadow-sm">
      <h2 className="font-bold text-tavern-900">Linked Worldbook</h2>

      {hasLinkedWorldBook ? (
        <>
          <p className="mt-2 text-sm font-semibold text-tavern-700">
            {worldBook?.name || "Loading linked worldbook..."}
          </p>
          {entryCount !== null && (
            <p className="mt-1 text-xs text-slate-500">
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600">No linked worldbook.</p>
      )}

      <Toolbar className="mobile-full-actions mt-4">
        {hasLinkedWorldBook && (
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-tavern-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-tavern-700"
            to={`/worldbooks/${encodeURIComponent(worldBookId)}`}
          >
            Open Worldbook
          </Link>
        )}
        <Button size="sm" type="button" variant="secondary" onClick={onChange}>
          {hasLinkedWorldBook ? "Change" : "Link Worldbook"}
        </Button>
        {hasLinkedWorldBook && (
          <Button
            size="sm"
            type="button"
            variant="danger"
            disabled={unlinking}
            onClick={onUnlink}
          >
            {unlinking ? "Unlinking..." : "Unlink"}
          </Button>
        )}
      </Toolbar>
    </section>
  );
}

function ReadOnlySections({ card }) {
  return (
    <>
      <CollapsibleSection title="Extensions JSON" summary="Read-only JSON preview">
        <JsonPreview value={card.extensions || {}} />
      </CollapsibleSection>
      <CollapsibleSection title="SillyTavern Metadata" summary="Read-only legacy fields">
        <dl className="space-y-3 text-sm">
          <Metadata label="Chat" value={card.legacy?.chat || "Not available"} />
          <Metadata
            label="Talkativeness"
            value={formatMetadataValue(card.legacy?.talkativeness)}
          />
          <Metadata label="Favorite" value={formatMetadataValue(card.legacy?.fav)} />
          <Metadata
            label="Creator comment"
            value={card.legacy?.creatorcomment || "Not available"}
          />
          <Metadata label="Create date" value={card.legacy?.create_date || "Not available"} />
        </dl>
      </CollapsibleSection>
    </>
  );
}

function JsonPreview({ value }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatMetadataValue(value) {
  if (value === undefined || value === null || value === "") {
    return "Not available";
  }

  return String(value);
}

function Metadata({ label, value }) {
  return (
    <div>
      <dt className="font-semibold text-tavern-700">{label}</dt>
      <dd className="mt-1 break-words text-slate-600">{value}</dd>
    </div>
  );
}

function StatusPage({ backToLibrary = "/", title, message }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <LibraryNav />
        <div className="mx-auto w-full max-w-lg pt-10">
        <StatusPanel
          title={title}
          message={message}
          variant={title ? "empty" : "loading"}
        />
        <Link
          className="mt-6 block text-center text-sm font-semibold text-tavern-700 hover:text-tavern-900"
          to={backToLibrary}
        >
          Back to library
        </Link>
        </div>
      </div>
    </main>
  );
}

export default DetailPage;
