"use client";

import { useState } from "react";

/** Deleting an account is irreversible and reaches more than the account row, so the page says what
 *  goes and what does not before asking, and asks for the email rather than an OK button. */
export default function AccountActions({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the account.");
      window.location.href = "/?deleted=1";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="method" data-tone="limits">
      <h2>Delete this account</h2>
      <p>
        You will lose your domain and event verifications upon deletion and they cannot be restored.
      </p>
      <p>
        Note that reports you saved are not destroyed with the account. They are kept for 30 days. If
        you want those deleted, <a href="/grades">do it here</a>.
      </p>
      <form className="delete-form" onSubmit={remove}>
        <label htmlFor="confirm-email">Type {email} to confirm</label>
        <div className="add-report-row">
          <input
            id="confirm-email"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="button secondary" type="submit" disabled={busy || typed.trim() !== email}>
            {busy ? "deleting..." : "delete my account"}
          </button>
        </div>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
