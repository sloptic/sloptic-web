"use client";

import { useCallback, useEffect, useState } from "react";

type Claim = {
  id: string;
  slug: string;
  token: string;
  status: "pending" | "verified" | "failed" | "revoked";
  check_status: "ok" | "not_found" | "blocked" | null;
  check_detail: string | null;
  checked_at: string | null;
  verified_at: string | null;
};

const POLL_MS = 5000;

/** What the last check means, in the organizer's terms.
 *
 *  The three check states are kept apart here exactly as they are in the database, because the whole
 *  point is that they mean different things. "blocked" is OUR failure to look and must never be
 *  reported as the link being absent, which would send an organizer off to re-edit a page that was
 *  already correct. */
function checkMessage(c: Claim): string {
  if (c.status === "verified") return "Verified. This account can now grade this event.";
  if (c.status === "failed") return "This claim expired. Start it again when the link is published.";
  if (!c.checked_at) return "Waiting for the first check.";
  if (c.check_status === "blocked")
    return "Devpost did not answer our last check, so we could not look. We are trying again.";
  if (c.check_status === "not_found")
    return "We could not find that event on Devpost. Check the address.";
  return "We read your event's pages and the link was not on them yet.";
}

export default function ClaimFlow({ initialEvent = "" }: { initialEvent?: string }) {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [input, setInput] = useState(initialEvent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/events/claim", { cache: "no-store" });
      if (!res.ok) return;                    // a failed read is not an empty list
      const data = await res.json();
      setClaims(data.claims ?? []);
    } catch {
      /* leave what we had; the poll will try again */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is pending, so a settled page stops asking.
  useEffect(() => {
    if (!claims?.some((c) => c.status === "pending")) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [claims, load]);

  async function start(e: React.FormEvent) {
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
      if (!res.ok) throw new Error(data.error || "Could not start the claim.");
      setInput("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the claim.");
    } finally {
      setBusy(false);
    }
  }

  async function recheck(id: string) {
    await fetch("/api/events/recheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    await load();
  }

  return (
    <>
      <section className="section attached">
        <h2 className="section-head">Your event</h2>
        <form className="grade-form" onSubmit={start}>
          <input
            type="text"
            inputMode="url"
            placeholder="https://your-event.devpost.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Devpost event address"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? "starting..." : "get my link"}
          </button>
        </form>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {(claims ?? []).map((c) => {
        const link = `${origin}/e/${c.token}`;
        return (
          <section className="section" key={c.id}>
            <h2 className="section-head">{c.slug}.devpost.com</h2>

            <div className="callout" data-tone={c.status === "verified" ? "award" : undefined}>
              <p className="callout-label">{c.status}</p>
              <p>{checkMessage(c)}</p>
            </div>

            {c.status === "pending" ? (
              <>
                <p className="section-intro">
                  Add this link to your event&apos;s rules page on Devpost with visible text such as{" "}
                  <b>Grading policy</b>.
                </p>
                <p className="token-link">
                  <code>{link}</code>
                </p>
                <p className="section-intro">
                  This link will open a page informing participants that Sloptic will grade this app
                  and what that entails.
                </p>
                <div className="cta-row">
                  <button className="button secondary" type="button" onClick={() => void recheck(c.id)}>
                    Check now
                  </button>
                </div>
                <p className="section-intro fineprint">
                  (We check on our own every few minutes, so no need to keep this page open.)
                </p>
                <p className="section-intro fineprint">
                  Publish it before your submission deadline if you want active grading.
                </p>
              </>
            ) : null}

            {c.check_detail ? (
              <details className="check-detail">
                <summary>what our last check saw</summary>
                <p>{c.check_detail}</p>
              </details>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
