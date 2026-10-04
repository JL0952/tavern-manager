import { getButtonClasses } from "./Button.jsx";

function FileButton({
  accept,
  children,
  className = "",
  disabled = false,
  label,
  multiple = false,
  onChange,
  size = "md",
  variant = "primary",
}) {
  return (
    <label
      className={getButtonClasses({
        className: `${disabled ? "" : "cursor-pointer"} has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${className}`,
        disabled,
        size,
        variant,
      })}
    >
      <span>{children || label}</span>
      <input
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}

export default FileButton;
