import { useEffect, useState } from "react";

function GreetingCarousel({
  title,
  items,
  emptyMessage,
  editing,
  addLabel,
  deleteLabel,
  onChange,
  onAdd,
  onDelete,
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length === 0) {
      setIndex(0);
    } else if (index >= items.length) {
      setIndex(items.length - 1);
    }
  }, [index, items.length]);

  function showPrevious() {
    setIndex((currentIndex) => (currentIndex === 0 ? items.length - 1 : currentIndex - 1));
  }

  function showNext() {
    setIndex((currentIndex) => (currentIndex === items.length - 1 ? 0 : currentIndex + 1));
  }

  function addItem() {
    setIndex(items.length);
    onAdd();
  }

  function deleteItem() {
    const nextIndex = Math.min(index, items.length - 2);
    onDelete(index);
    setIndex(Math.max(0, nextIndex));
  }

  return (
    <section className="rounded-2xl border border-tavern-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-tavern-900">{title}</h3>
        {editing && (
          <div className="mobile-full-actions flex flex-wrap gap-2 sm:w-auto">
            <button
              className="rounded-full border border-tavern-200 px-3 py-1.5 text-xs font-semibold text-tavern-700 transition hover:border-tavern-700"
              type="button"
              onClick={addItem}
            >
              {addLabel}
            </button>
            <button
              className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={items.length === 0}
              onClick={deleteItem}
            >
              {deleteLabel}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-tavern-200 text-sm font-bold text-tavern-700 transition hover:border-tavern-700"
              type="button"
              aria-label={`Previous ${title}`}
              onClick={showPrevious}
            >
              {"<"}
            </button>
            <span className="text-xs font-semibold text-slate-500">
              {index + 1} / {items.length}
            </span>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border border-tavern-200 text-sm font-bold text-tavern-700 transition hover:border-tavern-700"
              type="button"
              aria-label={`Next ${title}`}
              onClick={showNext}
            >
              {">"}
            </button>
          </div>

          {editing ? (
            <textarea
              className="mt-3 min-h-36 w-full rounded-2xl border border-tavern-200 px-4 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
              aria-label={`${title} ${index + 1}`}
              value={items[index]}
              onChange={(event) => onChange(index, event.target.value)}
            />
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {items[index] || "Empty greeting."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default GreetingCarousel;
