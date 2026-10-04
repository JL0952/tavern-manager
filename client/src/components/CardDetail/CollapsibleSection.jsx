import { useState } from "react";

function CollapsibleSection({ title, summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-tavern-200 bg-tavern-50/50">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-tavern-700">
            {title}
          </h2>
          {summary && <p className="mt-1 text-xs text-slate-500">{summary}</p>}
        </div>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-tavern-200 bg-white text-sm font-bold text-tavern-700 transition hover:border-tavern-700"
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          onClick={() => setOpen((currentOpen) => !currentOpen)}
        >
          {open ? "v" : ">"}
        </button>
      </div>
      {open && <div className="border-t border-tavern-200 p-4">{children}</div>}
    </section>
  );
}

export default CollapsibleSection;
