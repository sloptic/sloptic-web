"use client";

import { useState } from "react";

/** Deleting an account is irreversible and reaches more than the account row, so the page says what
 *  goes and what does not before asking, and asks for the email rather than an OK button. */
export default function AccountActions({ email, grantCount }: { email: string; grantCount: number }) {
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
        Your sign in, your saved grades&apos; link to this account, and{" "}
        {grantCount === 1 ? "your one verification" : `your ${grantCount} verifications`} go
        immediately and cannot be restored.
      </p>
      <p>
        Reports you saved are not destroyed with the account. They lose their owner and become
        ordinary anonymous grades, which means they are deleted 30 days after they ran. Delete any you
        want gone now from <a href="/grades">your grades</a> first.
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
