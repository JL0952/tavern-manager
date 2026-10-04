import { useState } from "react";
import {
  Alert,
  Button,
  DropdownPanel,
  FormField,
  OverlayHeader,
} from "./common/index.js";
import { removeManagerPassword, setManagerPassword } from "../services/api.js";

// Only on the computer running Manager: the password other devices on the
// network sign in with.
function PasswordMenu({ passwordSet, onChange }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(task, doneMessage) {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const result = await task();
      onChange(result.passwordSet);
      setPassword("");
      setRepeated("");
      setMessage(doneMessage);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function save(event) {
    event.preventDefault();

    if (password !== repeated) {
      setMessage("");
      setError("The two passwords are different.");
      return;
    }

    run(
      () => setManagerPassword(password),
      passwordSet ? "Password changed. Other devices sign in again." : "Password set. Other devices can sign in now.",
    );
  }

  function remove() {
    if (!window.confirm("Remove the password? Other devices can't use Manager until you set a new one.")) {
      return;
    }

    run(removeManagerPassword, "Password removed. Only this computer can use Manager.");
  }

  return (
    <div className="relative min-w-0">
      <Button
        size="sm"
        type="button"
        variant="secondary"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        Password
      </Button>

      {open && (
        <DropdownPanel className="max-sm:right-auto max-sm:left-0">
          <OverlayHeader
            compact
            headingLevel={2}
            title="Manager Password"
            subtitle={
              passwordSet
                ? "Other devices on your network sign in with it."
                : "Set one so other devices on your network can use Manager."
            }
            onClose={() => setOpen(false)}
          />

          <form className="mt-4 grid gap-3" onSubmit={save}>
            <FormField
              autoComplete="new-password"
              label={passwordSet ? "New password" : "Password"}
              type="password"
              value={password}
              onChange={setPassword}
            />
            <FormField
              autoComplete="new-password"
              label="Repeat password"
              type="password"
              value={repeated}
              onChange={setRepeated}
            />
            <Button size="sm" type="submit" variant="primary" disabled={saving || !password}>
              {saving ? "Saving..." : passwordSet ? "Change Password" : "Set Password"}
            </Button>
            {passwordSet && (
              <Button size="sm" type="button" variant="danger" disabled={saving} onClick={remove}>
                Remove Password
              </Button>
            )}
          </form>

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

export default PasswordMenu;
