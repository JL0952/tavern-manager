import Button from "./Button.jsx";

const backdropClass = "fixed inset-0 z-50 overflow-y-auto bg-slate-950/35 backdrop-blur-[1px]";
const panelClass = "border border-tavern-200 bg-white shadow-2xl";

function stopOverlayClose(event) {
  event.stopPropagation();
}

function OverlayCloseButton({ disabled = false, onClick, ariaLabel = "Close" }) {
  return (
    <Button
      aria-label={ariaLabel}
      className="h-9 min-h-9 w-9 px-0 py-0 text-base font-bold leading-none"
      disabled={disabled}
      size="sm"
      type="button"
      variant="secondary"
      onClick={onClick}
    >
      X
    </Button>
  );
}

function OverlayHeader({
  children,
  className = "",
  closeDisabled = false,
  closeLabel = "Close",
  compact = false,
  eyebrow,
  headingLevel = 2,
  onClose,
  subtitle,
  title,
}) {
  const Heading = `h${headingLevel}`;

  return (
    <header
      className={`border-b border-tavern-200 bg-white ${
        compact ? "pb-3" : "px-5 py-4"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tavern-700">
              {eyebrow}
            </p>
          )}
          {title && (
            <Heading
              className={`mt-1 font-bold text-tavern-900 ${
                compact ? "text-base" : "text-2xl"
              }`}
            >
              {title}
            </Heading>
          )}
          {subtitle && <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>}
          {children}
        </div>
        {onClose && (
          <OverlayCloseButton
            ariaLabel={closeLabel}
            disabled={closeDisabled}
            onClick={onClose}
          />
        )}
      </div>
    </header>
  );
}

function Drawer({
  ariaLabel,
  children,
  className = "",
  onClose,
  widthClass = "max-w-xl",
}) {
  return (
    <div className={backdropClass} role="presentation" onMouseDown={onClose}>
      <aside
        className={`relative ml-auto flex h-full max-h-dvh w-full flex-col overflow-hidden bg-tavern-50 shadow-2xl ${widthClass} ${className}`}
        aria-label={ariaLabel}
        onMouseDown={stopOverlayClose}
      >
        {children}
      </aside>
    </div>
  );
}

function Modal({
  ariaLabel,
  children,
  className = "",
  maxWidthClass = "max-w-2xl",
  onClose,
}) {
  return (
    <div className={backdropClass} role="presentation" onMouseDown={onClose}>
      <section
        className={`absolute left-1/2 top-3 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl sm:top-12 sm:max-h-[85vh] sm:w-[calc(100vw-2rem)] ${panelClass} ${maxWidthClass} ${className}`}
        aria-label={ariaLabel}
        onMouseDown={stopOverlayClose}
      >
        {children}
      </section>
    </div>
  );
}

function DropdownPanel({ children, className = "" }) {
  return (
    <section
      className={`absolute right-0 mt-2 w-[min(18rem,calc(100vw-1rem))] rounded-2xl ${panelClass} p-4 text-sm ${className}`}
    >
      {children}
    </section>
  );
}

export { Drawer, DropdownPanel, Modal, OverlayCloseButton, OverlayHeader };
