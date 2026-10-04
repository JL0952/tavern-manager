import { Button, Toolbar } from "../common/index.js";

// Selection controls for a library list; the page supplies its batch actions.
function SelectionPanel({ actionsClassName, allIds, children, pageIds, selection }) {
  return (
    <section className="mb-6 space-y-4 rounded-2xl border border-tavern-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-bold text-tavern-900">
            {selection.selectedIds.length} selected
          </p>
          <Toolbar className="mobile-full-actions">
            <Button size="sm" type="button" variant="secondary" onClick={() => selection.add(pageIds)}>
              Select current page
            </Button>
            <Button size="sm" type="button" variant="secondary" onClick={() => selection.add(allIds)}>
              Select all filtered
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={selection.clear}>
              Clear selection
            </Button>
          </Toolbar>
        </div>
        <Button
          className="self-start max-sm:w-full lg:self-center"
          size="sm"
          type="button"
          variant="ghost"
          onClick={selection.exit}
        >
          Exit selection mode
        </Button>
      </div>

      <div className={`grid gap-3 border-t border-tavern-200 pt-4 ${actionsClassName}`}>{children}</div>
    </section>
  );
}

export default SelectionPanel;
