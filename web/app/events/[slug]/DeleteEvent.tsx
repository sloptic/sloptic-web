"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Removing an event reaches further than the row it deletes, so the page says what goes before
 *  asking, and asks for the name rather than an OK. */
export default function DeleteEvent({
  slug,
  runs,
  graded,
}: {
  slug: string;
  runs: number;
  graded: number;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove it.");
      router.push("/events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove it.");
      setBusy(false);
    }
  }

  return (
    <div className="method" data-tone="limits">
      <h2>Remove this event</h2>
      <p>
        Your verification goes, and so do{" "}
        {runs === 1 ? "its run" : `its ${runs} runs`}
        {graded > 0 ? ` and ${graded === 1 ? "board" : "boards"}` : ""}. The link you published on
        Devpost stops meaning anything, so verifying again needs a new one.
      </p>
      {graded > 0 && (
        <p>
          The {graded} reports already graded are not destroyed. They lose their owner and become
          ordinary anonymous grades, which are deleted 30 days after they ran, and stay readable at
          their own links until then.
        </p>
      )}
      <form className="delete-form" onSubmit={remove}>
        <label htmlFor="confirm-slug">Type {slug} to confirm</label>
        <div className="add-report-row">
          <input
            id="confirm-slug" type="text" value={typed} autoComplete="off" spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button className="button secondary" type="submit" disabled={busy || typed.trim() !== slug}>
            {busy ? "removing..." : "remove this event"}
          </button>
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
