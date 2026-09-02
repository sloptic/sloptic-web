"use client";

import { useCallback, useEffect, useState } from "react";

type Claim = {
  id: string; slug: string; token: string;
  status: "pending" | "verified" | "failed" | "revoked";
  check_status: "ok" | "not_found" | "blocked" | "error" | null;
  check_detail: string | null; checked_at: string | null;
};
type Entry = { project_url: string; app_url: string | null; skip_reason: string | null; grade_id: string | null };
type Run = {
  id: string; slug: string; mode: "passive" | "active";
  status: "resolving" | "ready" | "grading" | "done" | "failed" | "cancelled";
  override: boolean; entries_found: number | null; gallery_complete: boolean | null;
  detail: string | null; created_at: string; event_entries: Entry[];
};
type Verified = { slug: string; granted_at: string; expires_at: string };

/** One row per event, whatever state it is in. Verified events used to live in a table, unverified
 *  ones in a separate list of cards below the runs, so there was nowhere to look to see what was
 *  waiting on you. */
type Row = { slug: string; verified: Verified | null; claim: Claim | null; runs: Run[] };

const POLL_MS = 4000;
/** Rows per page of a field. A 52 entry event inside an expanded row is a wall otherwise. */
const PAGE = 20;

/** The submission's own name, from the end of its Devpost path. The organizer knows their entries by
 *  these, and the submission page carries the app link anyway. */
function projectName(url: string): string {
  const seg = url.replace(/\/+$/, "").split("/").pop() ?? url;
  return seg || url;
}

function when(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What is waiting on whom, said in the row so it does not need opening to find out. */
function state(r: Row): { chip: string; line: string } {
  if (r.verified) return { chip: "verified", line: `Re-prove by ${when(r.verified.expires_at)}.` };
  const c = r.claim;
  if (!c) return { chip: "unknown", line: "" };
  if (c.status === "failed") return { chip: "expired", line: "The link never appeared. Start again to get a new one." };
  if (!c.checked_at) return { chip: "waiting", line: "Waiting for the first check." };
  if (c.check_status === "error") return { chip: "waiting", line: "Something went wrong on our side. We are trying again." };
  if (c.check_status === "blocked") return { chip: "waiting", line: "Devpost did not answer our last check. We are trying again." };
  if (c.check_status === "not_found") return { chip: "waiting", line: "We could not find that event on Devpost." };
  return { chip: "waiting", line: "Add the link to your event's pages. We check every few minutes." };
}

export default function EventList({
  verified,
  canOverride,
  initialEvent = "",
}: {
  verified: Verified[];
  canOverride: boolean;
  initialEvent?: string;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [input, setInput] = useState(initialEvent);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [pages, setPages] = useState<Record<string, number>>({});

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch("/api/events/claim", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch("/api/events/run", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (c) setClaims(c.claims ?? []);
    if (r) setRuns(r.runs ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const moving = claims.some((c) => c.status === "pending") ||
      runs.some((r) => r.status === "resolving" || r.status === "grading");
    if (!moving) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [claims, runs, load]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  async function act(fn: () => Promise<string | null>) {
    setBusy(true); setNote(null);
    try { const msg = await fn(); if (msg) setNote(msg); await load(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  const rows: Row[] = [];
  const bySlug = new Map<string, Row>();
  for (const v of verified) {
    const row = { slug: v.slug, verified: v, claim: null as Claim | null, runs: [] as Run[] };
    bySlug.set(v.slug, row); rows.push(row);
  }
  for (const c of claims) {
    if (c.status === "revoked") continue;
    const row = bySlug.get(c.slug);
    if (row) row.claim = c;
    else { const n = { slug: c.slug, verified: null, claim: c, runs: [] as Run[] }; bySlug.set(c.slug, n); rows.push(n); }
  }
  for (const r of runs) {
    const row = bySlug.get(r.slug);
    if (row) row.runs.push(r);
    else { const n = { slug: r.slug, verified: null, claim: null, runs: [r] }; bySlug.set(r.slug, n); rows.push(n); }
  }

  return (
    <>
      <section className="section attached">
        <h2 className="section-head">Add an event</h2>
        <form
          className="grade-form"
          onSubmit={(e) => { e.preventDefault(); void act(async () => { await post("/api/events/claim", { event: input }); setInput(""); return null; }); }}
        >
          <input
            type="text" inputMode="url" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="https://your-event.devpost.com" aria-label="Devpost event address"
          />
          <button type="submit" disabled={busy || !input.trim()}>{busy ? "..." : "add"}</button>
        </form>
        {canOverride && (
          <p className="section-intro fineprint">
            Override is on for this account: you can grade any event, passive only.
          </p>
        )}
        {note && <p className="section-intro">{note}</p>}
      </section>

      <section className="section">
        <h2 className="section-head">Your events</h2>
        {rows.length === 0 ? (
          <p className="section-intro">None yet.</p>
        ) : (
          <ul className="event-list">
            {rows.map((row) => {
              const st = state(row);
              const canGrade = row.verified || canOverride;
              return (
                <li key={row.slug}>
                  <details>
                    <summary>
                      <span className="event-name">{row.slug}.devpost.com</span>
                      <span className="tag" data-state={st.chip}>{st.chip}</span>
                      <span className="event-line">{st.line}</span>
                    </summary>
                    <div className="event-body">
                      {row.claim && row.claim.status === "pending" && (
                        <>
                          <p className="section-intro">
                            Add this link to your event&apos;s rules page on Devpost with visible text
                            such as <b>Grading policy</b>.
                          </p>
                          <p className="token-link"><code>{`${origin}/e/${row.claim.token}`}</code></p>
                          <div className="cta-row claim-check">
                            <button
                              className="button secondary" type="button" disabled={busy}
                              onClick={() => void act(async () => { await post("/api/events/recheck", { id: row.claim!.id }); return "Checking now."; })}
                            >
                              Check now
                            </button>
                          </div>
                        </>
                      )}

                      {canGrade && (
                        <div className="cta-row claim-check">
                          <button
                            className="button" type="button" disabled={busy}
                            onClick={() => void act(async () => { await post("/api/events/run", { event: row.slug }); return null; })}
                          >
                            Grade this event
                          </button>
                        </div>
                      )}

                      {row.runs.map((r) => {
                        const gradeable = (r.event_entries ?? []).filter((e) => !e.skip_reason);
                        const graded = (r.event_entries ?? []).filter((e) => e.grade_id).length;
                        // Why the field is the size it is, without opening the table. On a real
                        // event most of the gap is one cause, and it is the organizer's to fix:
                        // 27 of BostonHacks' 52 linked only a repo.
                        const why = new Map<string, number>();
                        for (const e of r.event_entries ?? []) {
                          if (e.skip_reason) why.set(e.skip_reason, (why.get(e.skip_reason) ?? 0) + 1);
                        }
                        const reasons = [...why.entries()].sort((a, b) => b[1] - a[1]);
                        return (
                          <div className="event-run" key={r.id}>
                            <p className="event-run-head">
                              <span className="tag">{r.mode}</span>
                              {r.override ? <span className="tag">override</span> : null}
                              <span className="tag">{r.status}</span>{" "}
                              {r.status === "resolving" && "Reading the gallery."}
                              {r.status === "ready" && ((r.event_entries ?? []).length === 0
                                ? "No submissions in the gallery yet."
                                : `${(r.event_entries ?? []).length} entries, ${gradeable.length} gradeable.`)}
                              {r.status === "grading" && `Grading ${graded}.`}
                              {r.status === "done" && `Done, ${graded} graded.`}
                              {(r.status === "grading" || r.status === "done") && (
                                <> <a href={`/events/${r.id}`}>See the board</a>.</>
                              )}
                              {r.status === "failed" && (r.detail ?? "Failed.")}
                            </p>
                            {reasons.length > 0 && (
                              <p className="event-skips">
                                {reasons.map(([reason, n]) => `${n} ${reason}`).join("  ·  ")}
                              </p>
                            )}
                            {r.gallery_complete === false && (
                              <p className="fineprint">Incomplete gallery, so this is not the whole field.</p>
                            )}
                            {r.status === "ready" && gradeable.length > 0 && (
                              <div className="cta-row claim-check">
                                <button
                                  className="button" type="button" disabled={busy}
                                  onClick={() => void act(async () => {
                                    const d = await post("/api/events/run/confirm", { id: r.id });
                                    return `Queued ${d.queued}.`;
                                  })}
                                >
                                  Grade {gradeable.length} {gradeable.length === 1 ? "entry" : "entries"}
                                </button>
                              </div>
                            )}
                            {(() => {
                              const all = r.event_entries ?? [];
                              if (all.length === 0) return null;
                              const page = pages[r.id] ?? 0;
                              const last = Math.max(0, Math.ceil(all.length / PAGE) - 1);
                              const from = page * PAGE;
                              const shown = all.slice(from, from + PAGE);
                              return (
                                <details className="check-detail">
                                  <summary>the field ({all.length})</summary>
                                  <div className="table-scroll">
                                    <table className="count-table">
                                      <thead><tr><th>submission</th><th>status</th></tr></thead>
                                      <tbody>
                                        {shown.map((e) => (
                                          <tr key={e.project_url}>
                                            {/* Always the Devpost submission, even when we have the
                                                app URL. That page is what an organizer recognises,
                                                and it carries the app link already. */}
                                            <th scope="row">
                                              <a href={e.project_url} target="_blank" rel="noopener noreferrer">
                                                {projectName(e.project_url)}
                                              </a>
                                            </th>
                                            <td className="band-note">
                                              {e.skip_reason ? `skipped (${e.skip_reason})`
                                                : e.grade_id ? <a href={`/grade/${e.grade_id}`}>report</a>
                                                : "will be graded"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {all.length > PAGE && (
                                    <div className="pager">
                                      <button
                                        className="link-button" type="button" disabled={page === 0}
                                        onClick={() => setPages((p) => ({ ...p, [r.id]: page - 1 }))}
                                      >
                                        previous
                                      </button>
                                      <span>
                                        {from + 1} to {Math.min(from + PAGE, all.length)} of {all.length}
                                      </span>
                                      <button
                                        className="link-button" type="button" disabled={page >= last}
                                        onClick={() => setPages((p) => ({ ...p, [r.id]: page + 1 }))}
                                      >
                                        next
                                      </button>
                                    </div>
                                  )}
                                </details>
                              );
                            })()}
                          </div>
                        );
                      })}

                      {row.claim?.check_detail && (
                        <details className="check-detail">
                          <summary>what our last check saw</summary>
                          <p>{row.claim.check_detail}</p>
                        </details>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
