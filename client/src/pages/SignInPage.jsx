import { useState } from "react";
import { Alert, Button, FormField } from "../components/common/index.js";
import { signIn } from "../services/api.js";

// Another device sees this until it signs in with the Manager password.
function SignInPage({ passwordSet, onSignedIn }) {
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSigningIn(true);
    setError("");

    try {
      await signIn(password);
      onSignedIn();
    } catch (requestError) {
      setError(requestError.message);
      setSigningIn(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-sm rounded-3xl border border-tavern-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-tavern-900">Tavern Manager</h1>

        {passwordSet ? (
          <form className="mt-5 grid gap-4" onSubmit={submit}>
            <FormField
              autoComplete="current-password"
              autoFocus
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
            />
            <Button type="submit" variant="primary" disabled={signingIn || !password}>
              {signingIn ? "Signing in..." : "Sign In"}
            </Button>
            {error && <Alert variant="error">{error}</Alert>}
          </form>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Manager has no password yet. On the computer running Manager, set one with the Password
            button, then reload this page.
          </p>
        )}
      </section>
    </main>
  );
}

export default SignInPage;
