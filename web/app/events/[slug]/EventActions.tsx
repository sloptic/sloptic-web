"use client";

import { useCallback, useEffect, useState } from "react";
import FieldTable, { type FieldEntry } from "./FieldTable";
import { estimateLabel } from "@/lib/timing";

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
  override: boolean; priority: number | null; entries_found: number | null; gallery_complete: boolean | null;
  detail: string | null; created_at: string; event_entries: Entry[];
};

const POLL_MS = 4000;
/** While a check is in flight, so the verdict lands within a second or two of the worker writing it. */
const CHECK_POLL_MS = 1500;
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
  // The checked_at we had when Check now was pressed. A check is finished when the row carries a
  // newer one, which is the only signal that distinguishes "still looking" from "looked and found
  // nothing", since both leave the claim pending.
  const [checkingFrom, setCheckingFrom] = useState<string | null | undefined>(undefined);
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
  const checking = checkingFrom !== undefined && claim?.checked_at === checkingFrom;

  useEffect(() => {
    const moving = runs.some((r) => r.status === "resolving" || r.status === "grading") ||
      claim?.status === "pending";
    if (!moving) return;
    const t = setInterval(() => void load(), checking ? CHECK_POLL_MS : POLL_MS);
    return () => clearInterval(t);
  }, [runs, claim, load, checking]);

  // Stop waiting after a while. The worker checks on its own timer regardless, so this only governs
  // how long the page claims to be watching.
  useEffect(() => {
    if (!checking) return;
    const t = setTimeout(() => setCheckingFrom(undefined), 90_000);
    return () => clearTimeout(t);
  }, [checking]);

  // Once the row carries a newer check, the wait is over and the verdict below is that check's.
  useEffect(() => {
    if (checkingFrom !== undefined && claim?.checked_at !== checkingFrom) setCheckingFrom(undefined);
  }, [claim, checkingFrom]);

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

          <div className="verdict" data-state={checking ? "checking" : claim.check_status ?? "none"}>
            <p className="verdict-label">
              {checking ? (
                <>
                  Checking<span className="dots" aria-hidden />
                </>
              ) : (
                "last check"
              )}
            </p>
            <p className="verdict-line">
              {checking
                ? `Reading ${slug}.devpost.com for your link.`
                : checkLine(claim)}
            </p>
            {!checking && claim.checked_at && (
              <p className="verdict-when">
                {new Date(claim.checked_at).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* One row, all the actions. */}
      <div className="cta-row event-actions">
        {pending && (
          <button className="button secondary" type="button" disabled={busy}
                  onClick={() => void act(async () => {
              setCheckingFrom(claim.checked_at ?? null);
              await post("/api/events/recheck", { id: claim.id });
              return null;
            })}>
            {checking ? "Checking" : "Check now"}
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
                    {r.status === "grading" &&
                      // Events drain one after another, so a run confirmed while another is still
                      // going sits at zero for hours. Saying it is queued is the difference between
                      // waiting and looking broken.
                      (finished === 0 && !gradeable.some((e) => gradeOf(e)?.status === "running")
                        ? `Queued with ${gradeable.length} entries waiting (another run is grading first).`
                        : `Grading, ${finished} of ${gradeable.length} done.`)}
                    {r.status === "done" && `Done, ${graded} graded.`}
                    {r.status === "failed" && (r.detail ?? "Failed.")}
                  </p>
                  {(r.status === "ready" || r.status === "grading") && gradeable.length > finished && (
                    <p className="run-skips">
                      {estimateLabel(gradeable.length - finished, r.mode)} left.
                      {r.priority === 0
                        ? " Priority grading active (judging active and submissions closed)."
                        : r.priority === 2
                          ? " Standard grading active."
                          : ""}
                    </p>
                  )}
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
