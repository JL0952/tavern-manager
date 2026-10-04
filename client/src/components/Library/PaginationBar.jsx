import { Button, Toolbar } from "../common/index.js";

function PaginationBar({ noun, pagination, setCurrentPage, total }) {
  const { pageEndIndex, pageStartIndex, safeCurrentPage, totalPages } = pagination;

  return (
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-tavern-200 bg-white px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {total === 0 ? 0 : pageStartIndex + 1}
        {" - "}
        {Math.min(pageEndIndex, total)} of {total} filtered
        {" "}
        {noun}{total === 1 ? "" : "s"}
      </p>
      <Toolbar className="mobile-full-actions justify-start sm:justify-end">
        <Button
          size="sm"
          type="button"
          variant="secondary"
          disabled={safeCurrentPage <= 1}
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <span className="text-sm font-semibold text-tavern-900">
          Page {safeCurrentPage} of {totalPages}
        </span>
        <Button
          size="sm"
          type="button"
          variant="secondary"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </Toolbar>
    </section>
  );
}

export default PaginationBar;
