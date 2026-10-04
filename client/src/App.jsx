import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import BackupMenu from "./components/BackupMenu.jsx";
import { Button } from "./components/common/index.js";
import { HeaderActionsContext } from "./components/LibraryNav.jsx";
import RpStatsDrawer from "./components/RpStatsDrawer.jsx";
import TagManagerDrawer from "./components/TagManagerDrawer.jsx";
import DetailPage from "./pages/DetailPage.jsx";
import FilesPage from "./pages/FilesPage.jsx";
import GraphPage from "./pages/GraphPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import WorldBookDetailPage from "./pages/WorldBookDetailPage.jsx";
import WorldBookPage from "./pages/WorldBookPage.jsx";

const themeStorageKey = "tavern-manager-theme";

function getInitialTheme() {
  const savedTheme = window.localStorage.getItem(themeStorageKey);

  return savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light";
}

function App() {
  const [statsOpen, setStatsOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [theme, setTheme] = useState(getInitialTheme);

  function markDataChanged() {
    setDataVersion((version) => version + 1);
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  // Shown in each page's top bar.
  const headerActions = (
    <>
      <BackupMenu />
      <Button
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        size="sm"
        type="button"
        variant="secondary"
        onClick={toggleTheme}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </Button>
      <Button size="sm" type="button" variant="secondary" onClick={() => setTagManagerOpen(true)}>
        Tags
      </Button>
      <Button size="sm" type="button" variant="primary" onClick={() => setStatsOpen(true)}>
        Stats
      </Button>
    </>
  );

  return (
    <BrowserRouter>
      <HeaderActionsContext.Provider value={headerActions}>
      <Routes>
        <Route
          path="/"
          element={<HomePage refreshKey={dataVersion} onDataChanged={markDataChanged} />}
        />
        <Route path="/cards/:id" element={<DetailPage refreshKey={dataVersion} />} />
        <Route path="/graph" element={<GraphPage refreshKey={dataVersion} />} />
        <Route path="/worldbooks" element={<WorldBookPage />} />
        <Route path="/worldbooks/:id" element={<WorldBookDetailPage />} />
        <Route path="/files" element={<FilesPage />} />
      </Routes>
      </HeaderActionsContext.Provider>
      <RpStatsDrawer
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        refreshKey={dataVersion}
      />
      <TagManagerDrawer
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        onDataChanged={markDataChanged}
      />
    </BrowserRouter>
  );
}

export default App;
