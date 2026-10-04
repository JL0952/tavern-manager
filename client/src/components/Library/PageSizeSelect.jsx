import { pageSizeOptions } from "../../hooks/useLibraryList.js";

function PageSizeSelect({ onChange, value }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-tavern-700 max-sm:justify-between">
      Page size
      <select
        className="h-10 rounded-full border border-tavern-200 bg-white px-3 text-sm text-tavern-900 outline-none focus:border-tavern-700 focus:ring-2 focus:ring-tavern-200"
        value={value}
        onChange={(event) => onChange(event.target.value === "all" ? "all" : Number(event.target.value))}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default PageSizeSelect;
