const statusClasses = {
  empty: "border-dashed border-tavern-200 bg-white text-slate-600",
  error: "border-red-200 bg-red-50 text-red-700",
  loading: "border-dashed border-tavern-200 bg-white text-slate-600",
};

function StatusPanel({ children, className = "", message, title, variant = "empty" }) {
  const isError = variant === "error";

  return (
    <section
      className={`rounded-3xl border p-8 text-center ${
        statusClasses[variant] || statusClasses.empty
      } ${className}`}
    >
      {title && (
        <h2 className={`font-bold ${isError ? "text-red-900" : "text-tavern-900"}`}>
          {title}
        </h2>
      )}
      {message && (
        <p
          className={`mx-auto max-w-lg text-sm leading-6 ${
            title ? "mt-2" : "font-semibold text-tavern-900"
          } ${isError ? "text-red-700" : ""}`}
        >
          {message}
        </p>
      )}
      {children}
    </section>
  );
}

export default StatusPanel;
