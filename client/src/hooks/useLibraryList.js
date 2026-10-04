import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export const pageSizeOptions = [12, 24, 48, "all"];

function getPositiveInteger(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPageSizeValue(value) {
  if (value === "all") {
    return "all";
  }

  const parsed = Number(value);

  return pageSizeOptions.includes(parsed) ? parsed : 24;
}

function createListPath(basePath, { page, pageSize, search, filters, sortMode }) {
  const params = new URLSearchParams();

  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  if (search.trim()) {
    params.set("search", search.trim());
  }

  for (const [name, value] of Object.entries(filters)) {
    // An array is one repeated param per item, so an item may contain commas.
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item) {
        params.append(name, item);
      }
    }
  }

  params.set("sort", sortMode);

  return `${basePath}?${params.toString()}`;
}

// Search, sort and paging state for a library list. It lives in the URL, so a
// detail page can link back to the same view. `filters` are extra URL params
// owned by the page; changing any filter starts again on page 1.
export function useLibraryQuery({ basePath, sortModes, filters = {} }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") || "");
  const [search, setSearch] = useState(searchInput);
  const [sortMode, setSortMode] = useState(() => {
    const value = searchParams.get("sort");
    return sortModes.includes(value) ? value : sortModes[0];
  });
  const [pageSize, setPageSize] = useState(() =>
    getPageSizeValue(searchParams.get("pageSize") || searchParams.get("size")),
  );
  const [currentPage, setCurrentPage] = useState(() =>
    getPositiveInteger(searchParams.get("page"), 1),
  );
  const filterKey = JSON.stringify([search, sortMode, pageSize, filters]);
  const appliedFilterKey = useRef(filterKey);
  const createPath = (page) => createListPath(basePath, { page, pageSize, search, filters, sortMode });
  const currentPath = createPath(currentPage);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (appliedFilterKey.current === filterKey) {
      return;
    }

    appliedFilterKey.current = filterKey;
    setCurrentPage(1);
  }, [filterKey]);

  useEffect(() => {
    setSearchParams(new URLSearchParams(currentPath.split("?")[1]), { replace: true });
  }, [currentPath, setSearchParams]);

  function clearSearch() {
    setSearchInput("");
    setSearch("");
  }

  function cycleSortMode() {
    setSortMode((mode) => sortModes[(sortModes.indexOf(mode) + 1) % sortModes.length]);
  }

  return {
    searchInput,
    setSearchInput,
    search,
    clearSearch,
    sortMode,
    cycleSortMode,
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    createPath,
  };
}

export function usePagination(items, { pageSize, currentPage, setCurrentPage }, loading) {
  const pageSizeValue = pageSize === "all" ? items.length || 1 : Number(pageSize);
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(items.length / pageSizeValue));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = pageSize === "all" ? 0 : (safeCurrentPage - 1) * pageSizeValue;
  const pageEndIndex = pageSize === "all" ? items.length : pageStartIndex + pageSizeValue;

  useEffect(() => {
    if (!loading && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, loading, setCurrentPage, totalPages]);

  return {
    pageItems: items.slice(pageStartIndex, pageEndIndex),
    totalPages,
    safeCurrentPage,
    pageStartIndex,
    pageEndIndex,
  };
}
