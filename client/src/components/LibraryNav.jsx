import { createContext, useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { Toolbar } from "./common/index.js";

// The app-wide buttons (backup, theme, tags, stats). App provides them so every
// page shows them in its top bar, in line with the page instead of floating.
export const HeaderActionsContext = createContext(null);

// The library's top-level pages; a detail page counts as its library's page.
// The Library Map stays in the Stats drawer.
const pages = [
  { to: "/", label: "Characters", matches: (path) => path === "/" || path.startsWith("/cards/") },
  { to: "/worldbooks", label: "Worldbooks", matches: (path) => path === "/worldbooks" || path.startsWith("/worldbooks/") },
  { to: "/files", label: "ST Files", matches: (path) => path === "/files" },
];

function LibraryNav() {
  const { pathname } = useLocation();
  const actions = useContext(HeaderActionsContext);

  return (
    <div className="mb-8 flex flex-col-reverse gap-3 border-b border-tavern-200 sm:flex-row sm:items-end sm:justify-between">
      <nav aria-label="Library" className="flex flex-wrap gap-x-6 gap-y-2">
        {pages.map(({ label, matches, to }) => {
          const active = matches(pathname);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 pb-3 text-sm font-semibold transition ${
                active
                  ? "border-tavern-700 text-tavern-900"
                  : "border-transparent text-tavern-700 hover:text-tavern-900"
              }`}
              key={to}
              to={to}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {actions && <Toolbar className="justify-end sm:pb-2">{actions}</Toolbar>}
    </div>
  );
}

export default LibraryNav;
