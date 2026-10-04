export default function CharacterNoteFields({ value, onChange }) {
  const note = { prompt: "", depth: 4, role: "system", ...value };
  const change = (field, next) => onChange({ ...note, [field]: next });
  const inputClass = "mt-2 w-full rounded-xl border border-tavern-200 px-3 py-2 text-sm";
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-semibold text-tavern-900">Character’s Note</legend>
      <label className="text-sm">
        Prompt (injected into chat, separate from Creator notes)
        <textarea className={`${inputClass} min-h-24`} value={note.prompt}
          onChange={(event) => change("prompt", event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Depth
          <input className={inputClass} type="number" min="0" step="1" required value={note.depth}
            onChange={(event) => change("depth", event.target.value === "" ? "" : Number(event.target.value))} />
        </label>
        <label className="text-sm">Role
          <select className={inputClass} value={note.role} onChange={(event) => change("role", event.target.value)}>
            <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}
