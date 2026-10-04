const alertClasses = {
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-tavern-200 bg-white text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function Alert({ children, className = "", title, variant = "info" }) {
  return (
    <section
      className={`rounded-2xl border px-4 py-3 text-sm ${
        alertClasses[variant] || alertClasses.info
      } ${className}`}
    >
      {title && (
        <h2 className={variant === "error" ? "font-bold text-red-900" : "font-bold text-tavern-900"}>
          {title}
        </h2>
      )}
      <div className={title ? "mt-2" : ""}>{children}</div>
    </section>
  );
}

export default Alert;
