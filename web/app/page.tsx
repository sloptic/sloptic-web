"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setBusy(false);
        return;
      }
      router.push(`/grade/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <h1>Grade a deployed web app.</h1>
      <p className="lede">
        Point Sloptic at a live URL and get one comparable number: its <strong>slop score</strong>{" "}
        (lower is better), broken down across security, qa, and performance. No source, no spec, just
        the hygiene floor every app should have.
      </p>

      <form onSubmit={submit} className="grade-form">
        <input
          type="text"
          inputMode="url"
          placeholder="https://your-app.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Deployed web app URL"
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Grade it"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <p className="fineprint">
        This is a <strong>passive grade</strong>: only observational probes (headers, TLS,
        accessibility, performance, soft-404) run on an unverified target. Active/injection probing is
        never run on a URL you have not proven you own. Only submit targets you own or are authorized
        to test.
      </p>
    </section>
  );
}
