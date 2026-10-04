import { useState } from "react";

export function useSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  function toggle(id) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((selectedId) => selectedId !== id) : [...ids, id]));
  }

  function add(ids) {
    setSelectedIds((currentIds) => [...new Set([...currentIds, ...ids])]);
  }

  function remove(ids) {
    setSelectedIds((currentIds) => currentIds.filter((id) => !ids.includes(id)));
  }

  function exit() {
    setSelectionMode(false);
    setSelectedIds([]);
  }

  return {
    selectionMode,
    enter: () => setSelectionMode(true),
    exit,
    selectedIds,
    isSelected: (id) => selectedIds.includes(id),
    toggle,
    add,
    remove,
    clear: () => setSelectedIds([]),
  };
}
