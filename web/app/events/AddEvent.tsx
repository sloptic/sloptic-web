"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddEvent({ initialEvent = "" }: { initialEvent?: string }) {
  const [input, setInput] = useState(initialEvent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add it.");
      // Straight to the event's own page, which is where the link to publish lives.
      router.push(`/events/${data.claim.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add it.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className="grade-form" onSubmit={submit}>
        <input
          type="text" inputMode="url" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="https://your-event.devpost.com" aria-label="Devpost event address"
        />
        <button type="submit" disabled={busy || !input.trim()}>{busy ? "..." : "add"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
