const baseClasses =
  "inline-flex shrink-0 items-center justify-center rounded-full text-center font-semibold transition focus:outline-none focus:ring-2 focus:ring-tavern-200 disabled:cursor-not-allowed disabled:opacity-60";

const variantClasses = {
  primary: "bg-tavern-900 text-white hover:bg-tavern-700",
  secondary: "border border-tavern-200 bg-white text-tavern-700 hover:border-tavern-700",
  danger: "border border-red-200 bg-white text-red-700 hover:border-red-700",
  ghost: "text-tavern-700 hover:text-tavern-900",
};

const sizeClasses = {
  sm: "min-h-10 px-4 py-2 text-sm",
  md: "min-h-11 px-5 py-2.5 text-sm",
};

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function getButtonClasses({
  className = "",
  disabled = false,
  size = "md",
  variant = "secondary",
} = {}) {
  return joinClasses(
    baseClasses,
    variantClasses[variant] || variantClasses.secondary,
    sizeClasses[size] || sizeClasses.md,
    disabled && "cursor-not-allowed opacity-60",
    className,
  );
}

function Button({
  children,
  className = "",
  size = "md",
  type = "button",
  variant = "secondary",
  ...props
}) {
  return (
    <button
      className={getButtonClasses({
        className,
        disabled: props.disabled,
        size,
        variant,
      })}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
