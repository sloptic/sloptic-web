"use client";

import { useCallback, useEffect, useState } from "react";
import FieldTable, { type FieldEntry } from "./FieldTable";

type Claim = {
  id: string; slug: string; token: string;
  status: "pending" | "verified" | "failed" | "revoked";
  check_status: "ok" | "not_found" | "blocked" | "error" | null;
  check_detail: string | null; checked_at: string | null;
};
type Progress = { done?: number; total?: number; label?: string } | null;
type Grade = { status: string; progress: Progress };
type Entry = {
  project_url: string; app_url: string | null; skip_reason: string | null; grade_id: string | null;
  grades?: Grade | Grade[] | null;
};
type Run = {
  id: string; slug: string; mode: "passive" | "active";
  status: "resolving" | "ready" | "grading" | "done" | "failed" | "cancelled";
  override: boolean; entries_found: number | null; gallery_complete: boolean | null;
  detail: string | null; created_at: string; event_entries: Entry[];
};

const POLL_MS = 4000;
const gradeOf = (e: Entry) => (Array.isArray(e.grades) ? e.grades[0] : e.grades) ?? null;

function checkLine(c: Claim): string {
  if (!c.checked_at) return "Waiting for the first check.";
  if (c.check_status === "error") return "Something went wrong on our side during the last check. We are trying again.";
  if (c.check_status === "blocked") return "Devpost did not answer our last check. We are trying again.";
  if (c.check_status === "not_found") return "We could not find that event on Devpost.";
  return "We read your event's pages and the link was not on them yet.";
}

/** Everything you can do to one event, in one place. The list page is a list; this is where an
 *  event's link, its runs and its actions live, so neither view has to be both. */
export default function EventActions({
  slug,
  verified,
  canOverride,
}: {
  slug: string;
  verified: boolean;
  canOverride: boolean;
}) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch("/api/events/claim", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/api/events/run?slug=${encodeURIComponent(slug)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (c) setClaim((c.claims ?? []).find((x: Claim) => x.slug === slug) ?? null);
    if (r) setRuns(r.runs ?? []);
  }, [slug]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const moving = runs.some((r) => r.status === "resolving" || r.status === "grading") ||
      claim?.status === "pending";
    if (!moving) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [runs, claim, load]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  async function act(fn: () => Promise<string | null>) {
    setBusy(true); setNote(null);
    try { const m = await fn(); if (m) setNote(m); await load(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  const live = runs.find((r) => ["resolving", "ready", "grading"].includes(r.status));
  const pending = claim?.status === "pending";

  return (
    <>
      {pending && (
        <section className="section attached">
          <h2 className="section-head">Verify this event</h2>
          <p className="section-intro">
            Add this link to your event&apos;s rules page on Devpost with visible text such as{" "}
            <b>Grading policy</b>.
          </p>
          <p className="token-link"><code>{`${origin}/e/${claim.token}`}</code></p>
          <p className="section-intro">{checkLine(claim)}</p>
        </section>
      )}

      {/* One row, all the actions. */}
      <div className="cta-row event-actions">
        {pending && (
          <button className="button secondary" type="button" disabled={busy}
                  onClick={() => void act(async () => { await post("/api/events/recheck", { id: claim.id }); return "Checking now."; })}>
            Check now
          </button>
        )}
        {(verified || canOverride) && !live && (
          <button className="button" type="button" disabled={busy}
                  onClick={() => void act(async () => { await post("/api/events/run", { event: slug }); return null; })}>
            {runs.length > 0 ? "Grade it again" : "Grade this event"}
          </button>
        )}
        {live?.status === "ready" && (
          <button className="button" type="button" disabled={busy}
                  onClick={() => void act(async () => {
                    const d = await post("/api/events/run/confirm", { id: live.id });
                    return `Queued ${d.queued}.`;
                  })}>
            Grade {live.event_entries.filter((e) => !e.skip_reason).length} entries
          </button>
        )}

      </div>
      {note && <p className="section-intro">{note}</p>}

      <section className="section">
        <h2 className="section-head">Runs</h2>
        {runs.length === 0 ? (
          <p className="section-intro">None yet.</p>
        ) : (
          <ul className="run-list">
            {runs.map((r) => {
              const entries = r.event_entries ?? [];
              const gradeable = entries.filter((e) => !e.skip_reason);
              const graded = entries.filter((e) => e.grade_id).length;
              const finished = gradeable.filter((e) => ["done", "failed"].includes(gradeOf(e)?.status ?? "")).length;
              const pct = gradeable.length ? Math.round((finished / gradeable.length) * 100) : 0;
              const why = new Map<string, number>();
              for (const e of entries) if (e.skip_reason) why.set(e.skip_reason, (why.get(e.skip_reason) ?? 0) + 1);
              return (
                <li key={r.id}>
                  <p className="run-head">
                    <span className="tag">{r.mode}</span>
                    {r.override ? <span className="tag">override</span> : null}{" "}
                    {r.status === "resolving" && (r.entries_found ? `Reading the gallery, ${r.entries_found} found so far.` : "Reading the gallery.")}
                    {r.status === "ready" && (entries.length === 0 ? "No submissions in the gallery yet." : `${entries.length} entries, ${gradeable.length} gradeable.`)}
                    {r.status === "grading" && `Grading, ${finished} of ${gradeable.length} done.`}
                    {r.status === "done" && `Done, ${graded} graded.`}
                    {r.status === "failed" && (r.detail ?? "Failed.")}
                  </p>
                  {(r.status === "grading") && (
                    <span className="progress-track" aria-hidden>
                      <span className="progress-fill" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                  {why.size > 0 && (
                    <p className="run-skips">
                      {[...why.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join("  ·  ")}
                    </p>
                  )}
                  {r.gallery_complete === false && (
                    <p className="run-skips">Incomplete gallery, so this is not the whole field.</p>
                  )}
                  {(r.status === "grading" || r.status === "done") && (
                    <div className="cta-row claim-check">
                      <a className="button secondary" href={`/events/${slug}/${r.id}`}>See the board</a>
                    </div>
                  )}
                  {entries.length > 0 && (
                    <FieldTable
                      entries={entries.map((e): FieldEntry => ({
                        project_url: e.project_url,
                        skip_reason: e.skip_reason,
                        grade_id: e.grade_id,
                        status: gradeOf(e)?.status ?? null,
                        progress: gradeOf(e)?.progress ?? null,
                      }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
