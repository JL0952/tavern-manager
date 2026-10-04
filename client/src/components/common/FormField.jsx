function FormField({
  autoComplete,
  autoFocus = false,
  label,
  onChange,
  placeholder = "",
  required = false,
  textarea = false,
  type = "text",
  value,
}) {
  const sharedClasses =
    "mt-2 w-full rounded-2xl border border-tavern-200 bg-white px-4 py-3 text-sm leading-6 text-tavern-900 outline-none transition placeholder:text-slate-400 focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200";

  return (
    <label className="block">
      <span className="text-sm font-semibold text-tavern-900">
        {label}
        {required ? " *" : ""}
      </span>
      {textarea ? (
        <textarea
          autoFocus={autoFocus}
          className={`${sharedClasses} min-h-24 resize-y`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
      ) : (
        <input
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className={sharedClasses}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
    </label>
  );
}

export default FormField;
