import { useRef, useState } from "react";
import {
  Alert,
  Button,
  DropdownPanel,
  OverlayHeader,
} from "./common/index.js";
import { downloadBackup, importBackup } from "../services/api.js";

function BackupMenu() {
  const fileInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function exportData() {
    setExporting(true);
    setMessage("");
    setError("");

    try {
      await downloadBackup();
      setMessage("Backup export started.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting(false);
    }
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip backup file.");
      setMessage("");
      return;
    }

    if (!window.confirm("Importing a backup will replace current local data. Continue?")) {
      return;
    }

    setImporting(true);
    setMessage("");
    setError("");

    try {
      await importBackup(file);
      setMessage("Backup restored. Reloading...");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="relative min-w-0">
      <Button
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        Backup
      </Button>

      {open && (
        <DropdownPanel className="max-sm:right-auto max-sm:left-0">
          <OverlayHeader
            compact
            headingLevel={2}
            title="Data Backup"
            subtitle="Export or restore local app data."
            onClose={() => setOpen(false)}
          />

          <div className="mt-4 grid gap-2">
            <Button
              size="sm"
              type="button"
              variant="primary"
              disabled={exporting || importing}
              onClick={exportData}
            >
              {exporting ? "Exporting..." : "Export Backup"}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={exporting || importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? "Importing..." : "Import Backup"}
            </Button>
            <input
              className="sr-only"
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={exporting || importing}
              onChange={importData}
            />
          </div>

          {message && (
            <Alert className="mt-3 rounded-xl px-3 py-2 text-xs" variant="success">
              {message}
            </Alert>
          )}
          {error && (
            <Alert className="mt-3 rounded-xl px-3 py-2 text-xs" variant="error">
              {error}
            </Alert>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}

export default BackupMenu;
