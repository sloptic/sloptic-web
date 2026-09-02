"use client";

import { useCallback, useEffect, useState } from "react";

type Claim = {
  slug: string;
  status: "pending" | "verified" | "failed" | "revoked";
  check_status: "ok" | "not_found" | "blocked" | "error" | null;
  checked_at: string | null;
};
type Run = {
  slug: string;
  status: "resolving" | "ready" | "grading" | "done" | "failed" | "cancelled";
  entries_found: number | null;
  event_entries: { grade_id: string | null; skip_reason: string | null }[];
};
type Verified = { slug: string; expires_at: string };

const POLL_MS = 5000;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** One line per event. Anything more belongs on the event's own page: this list exists to answer
 *  "which of my events needs something from me", and it cannot do that while it also carries tokens,
 *  fields and buttons. */
function state(v: Verified | undefined, c: Claim | undefined, runs: Run[]): { chip: string; line: string } {
  const live = runs.find((r) => r.status === "resolving" || r.status === "grading");
  if (live) {
    const done = live.event_entries?.filter((e) => e.grade_id).length ?? 0;
    return live.status === "resolving"
      ? { chip: "resolving", line: live.entries_found ? `${live.entries_found} entries found so far` : "reading the gallery" }
      : { chip: "grading", line: `${done} graded so far` };
  }
  const ready = runs.find((r) => r.status === "ready");
  if (ready) {
    const n = ready.event_entries?.filter((e) => !e.skip_reason).length ?? 0;
    return { chip: "ready", line: `${n} entries ready to grade` };
  }
  const done = runs.find((r) => r.status === "done");
  if (done) {
    const n = done.event_entries?.filter((e) => e.grade_id).length ?? 0;
    return { chip: "graded", line: `${n} entries graded` };
  }
  if (v) return { chip: "verified", line: `re-prove by ${when(v.expires_at)}` };
  if (c?.status === "failed") return { chip: "expired", line: "the link never appeared" };
  if (c) return { chip: "waiting", line: c.checked_at ? "waiting for the link" : "waiting for the first check" };
  return { chip: "unknown", line: "" };
}

export default function EventRows({ verified }: { verified: Verified[] }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch("/api/events/claim", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch("/api/events/run", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (c) setClaims(c.claims ?? []);
    if (r) setRuns(r.runs ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const moving = runs.some((r) => r.status === "resolving" || r.status === "grading") ||
      claims.some((c) => c.status === "pending");
    if (!moving) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [runs, claims, load]);

  const slugs = [...new Set([
    ...verified.map((v) => v.slug),
    ...claims.filter((c) => c.status !== "revoked").map((c) => c.slug),
    ...runs.map((r) => r.slug),
  ])];

  if (!loaded && slugs.length === 0) return <p className="section-intro">Looking...</p>;
  if (slugs.length === 0) return <p className="section-intro">None yet.</p>;

  return (
    <ul className="event-list">
      {slugs.map((slug) => {
        const st = state(
          verified.find((v) => v.slug === slug),
          claims.find((c) => c.slug === slug),
          runs.filter((r) => r.slug === slug)
        );
        return (
          <li key={slug}>
            <a className="event-row" href={`/events/${slug}`}>
              <span className="event-name">{slug}.devpost.com</span>
              <span className="tag" data-state={st.chip}>{st.chip}</span>
              <span className="event-line">{st.line}</span>
              <span className="event-go" aria-hidden>→</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
