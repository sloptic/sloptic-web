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
  const [reports, setReports] = useState<"keep" | "delete">("keep");
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
        body: JSON.stringify({ slug, reports }),
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
        This will <b>permanently</b> remove the event and all its associated data. You need to reverify if you 
        want to add this event again.
      </p>
      {graded > 0 && (
        <>
          <p>What should happen to the {graded} reports?</p>
          <div className="report-choice">
            <label>
              <input
                type="radio" name="reports" value="keep" checked={reports === "keep"}
                onChange={() => setReports("keep")}
              />
              <span>
                <b>Let them expire.</b> They become ordinary anonymous grades deleted 30 days after they ran.
              </span>
            </label>
            <label>
              <input
                type="radio" name="reports" value="delete" checked={reports === "delete"}
                onChange={() => setReports("delete")}
              />
              <span>
                <b>Delete them now.</b> The {graded} reports are removed immediately.
              </span>
            </label>
          </div>
        </>
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
