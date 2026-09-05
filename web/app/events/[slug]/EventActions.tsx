"use client";

import { useCallback, useEffect, useState } from "react";
import FieldTable, { type FieldEntry } from "./FieldTable";
import type { Entry, Run } from "@/lib/event-runs";
import { liveEtaLabel } from "@/lib/timing";

type Claim = {
  id: string; slug: string; token: string;
  status: "pending" | "verified" | "failed" | "revoked";
  check_status: "ok" | "not_found" | "blocked" | "error" | null;
  check_detail: string | null; checked_at: string | null;
};

const POLL_MS = 4000;
/** While a check is in flight, so the verdict lands within a second or two of the worker writing it. */
const CHECK_POLL_MS = 1500;
const gradeOf = (e: Entry) => (Array.isArray(e.grades) ? e.grades[0] : e.grades) ?? null;
const gradeableOf = (r: Run) => r.event_entries.filter((e) => !e.skip_reason);
const ungradedCount = (r: Run) =>
  r.event_entries.filter((e) => !e.skip_reason && !e.grade_id).length;
const doneCount = (r: Run) => r.event_entries.filter((e) => gradeOf(e)?.status === "done").length;
const runningCount = (r: Run) => r.event_entries.filter((e) => gradeOf(e)?.status === "running").length;
const queuedCount = (r: Run) => r.event_entries.filter((e) => gradeOf(e)?.status === "queued").length;
const inFlightCount = (r: Run) => queuedCount(r) + runningCount(r);
/** What a regrade actually re-queues: entries whose grade has FINISHED, in any of the three ways it
 *  can. The button used to count only the done ones, so a run holding ten failed grades offered to
 *  regrade 29 and queued 39. */
const regradableCount = (r: Run) =>
  r.event_entries.filter((e) => !e.skip_reason && ["done", "failed", "cancelled"].includes(gradeOf(e)?.status ?? "")).length;
const finishedCount = (r: Run) => r.event_entries.filter((e) => ["done", "failed"].includes(gradeOf(e)?.status ?? "")).length;

/** What the accent bar should say, which is NOT check_status.
 *
 *  check_status is the outcome of the FETCH: 'ok' means we managed to read the event's pages, and it
 *  is exactly the case that then reports "we could not find our link on your page yet". Passing it
 *  through painted that green, because the value says the reading went fine and says nothing at all
 *  about whether the token was there. Whether the proof holds is claim.status.
 *
 *    ok       the token is published and the claim is verified
 *    missing  we looked and it is not there, which is the organizer's to fix
 *    unknown  nothing is known yet: never checked, in flight, or a look that failed on OUR side
 */
function verdictState(c: Claim, checking: boolean): "ok" | "missing" | "unknown" {
  if (c.status === "verified") return "ok";
  if (checking || !c.checked_at) return "unknown";
  if (c.check_status === "blocked" || c.check_status === "error") return "unknown";
  return "missing";
}

function checkLine(c: Claim): string {
  if (!c.checked_at) return "Waiting for the first check.";
  if (c.check_status === "error") return "Something went wrong on our side during the last check. We are trying again.";
  if (c.check_status === "blocked") return "Devpost did not answer our last check. We are trying again.";
  if (c.check_status === "not_found") return "We could not find that event on Devpost.";
  return "We could not find our link on your page yet.";
}

/** Where a run stands, in one line. The card names the state; the controls below it are the ones
 *  that state actually offers. */
function runLine(r: Run): string {
  const gradeable = gradeableOf(r).length;
  const finished = doneCount(r);
  switch (r.status) {
    case "resolving":
      return `reading the gallery${r.entries_found ? `, ${r.entries_found} found so far` : ""}`;
    case "ready":
      return r.event_entries.length === 0
        ? "ready, nothing in the gallery yet"
        : `ready, ${r.event_entries.length} entries`;
    case "grading":
      if (r.paused)
        return `paused, ${queuedCount(r)} waiting, ${runningCount(r)} running`;
      // A run confirmed while another is still going sits at zero for hours. Saying it is queued is
      // the difference between waiting and looking broken.
      if (inFlightCount(r) === 0)
        return finishedCount(r) === finished
          ? `grading, ${finished} of ${gradeable} graded`
          : `grading, ${finished} of ${gradeable} graded, ${finishedCount(r) - finished} could not be reached`;
      if (finished === 0 && runningCount(r) === 0)
        return `queued with ${inFlightCount(r)} entries waiting, another run is grading first`;
      return `grading, ${finished} of ${gradeable} done, ${runningCount(r)} running`;
    case "done":
      return `done, ${finished} graded`;
    case "failed":
      return r.detail ?? "failed";
    default:
      return r.status;
  }
}

/** Everything you can do to one event, in one place. The list page is a list; this is where an
 *  event's link, its current run and its run history live.
 *
 *  The server seeds the first claim and runs (the same shape /api/events/run returns), so the field
 *  paints with the page instead of waiting for a fetch that would redo auth and the whole query
 *  after hydration. */
export default function EventActions({
  slug,
  verified,
  canActive,
  canOverride,
  initialClaim,
  initialRuns,
  grantExpiry,
  verifiedLink,
}: {
  slug: string;
  verified: boolean;
  /** Whether the full battery may be asked for. Decided on the server; this only draws the button. */
  canActive: boolean;
  canOverride: boolean;
  initialClaim?: Claim | null;
  initialRuns?: Run[];
  /** The grant's expiry, shown on the verified slip. */
  grantExpiry?: string | null;
  /** Where the policy link was found and the text it carries, recorded at verification. Null on
   *  grants verified before this was captured. */
  verifiedLink?: { page: string | null; text: string | null } | null;
}) {
  const [claim, setClaim] = useState<Claim | null>(initialClaim ?? null);
  const [runs, setRuns] = useState<Run[]>(initialRuns ?? []);
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

  // The seed is for the first paint only: one fetch on mount replaces it with live truth, so a
  // page opened on a ready run does not sit on the render-time snapshot for ever.
  useEffect(() => { void load(); }, [load]);
  const checking = checkingFrom !== undefined && claim?.checked_at === checkingFrom;

  useEffect(() => {
    // Any live run (even one sitting ready) can change behind the page: the worker resolves, a
    // refresh lands, states flip. A finished run can too, one way: its retry passes land after
    // settle, turning B into N/P/F. Those are polled at the same cadence; nothing else polls.
    const liveRun = runs.find((r) => ["resolving", "ready", "grading"].includes(r.status));
    const recovering = runs.some((r) => r.event_entries.some((e) => gradeOf(e)?.retry_due_at));
    if (!liveRun && !recovering && claim?.status !== "pending") return;
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
    try {
      const m = await fn();
      if (m) {
        setNote(m);
        // A note describes the moment it was produced. The poll refreshes the state around it, so
        // the note retires itself instead of contradicting what the card now says.
        setTimeout(() => setNote((cur) => (cur === m ? null : cur)), 12_000);
      }
      await load();
    }
    catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  const live = runs.find((r) => ["resolving", "ready", "grading"].includes(r.status));
  const pending = claim?.status === "pending";
  const history = runs.filter((r) => r !== live);
  const lastRun = runs[0];
  // The field stays mounted for a finished run while its recovery passes are outstanding: the
  // letters land there, and unmounting it the moment the run settles is how B froze at "shortly".
  const fieldRun =
    live ??
    runs.find((r) => r.status === "done" && r.event_entries.some((e) => gradeOf(e)?.retry_due_at)) ??
    null;

  /** The estimate under the card. Ready means the whole ungraded field if it is confirmed; grading
   *  means what is in flight, since apps nobody has ticked yet wait on a person, not the worker. */
  function etaOf(r: Run): string | null {
    const durations = r.event_entries
      .map((e) => gradeOf(e))
      .filter((g) => g?.status === "done" && g.claimed_at && g.finished_at)
      .map((g) => (Date.parse(g!.finished_at!) - Date.parse(g!.claimed_at!)) / 1000)
      .filter((d) => d > 0 && d < 3600);
    const remaining = r.status === "ready" ? ungradedCount(r) : inFlightCount(r);
    if (remaining <= 0 || r.paused) return null;
    return (
      liveEtaLabel(remaining, r.mode, durations) +
      (r.priority === 0 ? ", priority grading active" : "")
    );
  }

  /** Why entries were skipped, most common first, as the card's chips. */
  function skipChips(r: Run) {
    const why = new Map<string, number>();
    for (const e of r.event_entries) if (e.skip_reason) why.set(e.skip_reason, (why.get(e.skip_reason) ?? 0) + 1);
    return [...why.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: `${n} ${k}` }));
  }

  function refresh(r: Run) {
    return act(async () => {
      await post("/api/events/run/refresh", { id: r.id });
      return null;
    });
  }

  const refreshable = (r: Run) => ["ready", "grading", "done", "failed"].includes(r.status);

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

          <div className="verdict" data-state={verdictState(claim, checking)}>
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
          <div className="cta-row event-actions">
            <button className="button secondary" type="button" disabled={busy}
                    onClick={() => void act(async () => {
              setCheckingFrom(claim.checked_at ?? null);
              await post("/api/events/recheck", { id: claim.id });
              return null;
            })}>
              {checking ? "Checking" : "Check now"}
            </button>
          </div>
        </section>
      )}

      {/* A verified event keeps the same slip the pending flow has, telling the organizer their
          own link back to them: which page it was found on, the text it carries, and how long the
          grant runs. */}
      {claim?.status === "verified" && (
        <section className="section attached">
          <div className="verdict" data-state="ok">
            <p className="verdict-label">
              {claim.checked_at
                ? `last check ${new Date(claim.checked_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                : "verified"}
            </p>
            <p className="verdict-line">
              {verifiedLink?.page || verifiedLink?.text ? (
                <>
                  Link found{verifiedLink?.page ? ` on the ${verifiedLink.page} page` : ""}
                  {verifiedLink?.text ? `, with text saying "${verifiedLink.text}"` : ""}.
                </>
              ) : (
                claim.check_detail || "Link found."
              )}
            </p>
            {grantExpiry && (
              <p className="verdict-when">
                Active until {new Date(grantExpiry).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* THE CURRENT RUN. One card names the state and offers only what that state allows: the mode
          toggle when nothing is measured, the confirm button when the field is approved, a refresh
          when the gallery could have grown. */}
      {(live || ((verified || canOverride || claim?.status === "verified") && !live)) && (
        <section className="section attached">
          <div className="run-card">
            {live ? (
              <>
                <div className="runhead">
                  <span className="st">
                    {live.status === "resolving" ? (
                      <>
                        {runLine(live)}
                        <span className="dots" aria-hidden />
                      </>
                    ) : (
                      <>run of {new Date(live.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, {live.mode}, {runLine(live)}</>
                    )}
                  </span>
                  <span className="grow" />
                  {etaOf(live) && <span className="st">{etaOf(live)}</span>}
                </div>

                {live.status === "ready" && live.event_entries.length === 0 && (
                  <div className="run-controls">
                    <button className="button" type="button" disabled={busy}
                            onClick={() => refresh(live)}>
                      Read the gallery again
                    </button>
                    <button className="button secondary" type="button" disabled={busy}
                            onClick={() => void act(async () => {
                              await post("/api/events/run/cancel", { id: live.id });
                              return "Run cancelled.";
                            })}>
                      Cancel run
                    </button>
                  </div>
                )}

                {live.status === "ready" && live.event_entries.length > 0 && (() => {
                  const toGrade = ungradedCount(live);
                  const graded = regradableCount(live);
                  return (
                  <div className="run-controls">
                    <span className="mode-toggle" role="group" aria-label="battery for this run">
                      <button
                        type="button"
                        className={live.mode === "passive" ? "on" : ""}
                        aria-pressed={live.mode === "passive"}
                        disabled={busy || live.mode === "passive"}
                        onClick={() => void act(async () => {
                          await post("/api/events/run/mode", { id: live.id, mode: "passive" });
                          return "Switched to passive.";
                        })}
                      >
                        passive
                      </button>
                      <button
                        type="button"
                        className={live.mode === "active" ? "on" : ""}
                        aria-pressed={live.mode === "active"}
                        disabled={busy || live.mode === "active" || !canActive}
                        title={!canActive ? "Active grading needs the disclosure verified before the deadline." : undefined}
                        onClick={() => void act(async () => {
                          await post("/api/events/run/mode", { id: live.id, mode: "active" });
                          return "Switched to active.";
                        })}
                      >
                        active
                      </button>
                    </span>
                    {toGrade > 0 && (
                      <button className="button" type="button" disabled={busy}
                              onClick={() => void act(async () => {
                                const d = await post("/api/events/run/confirm", { id: live.id });
                                return `Queued ${d.queued}.`;
                              })}>
                        Grade {toGrade} entries
                      </button>
                    )}
                    {graded > 0 && (
                      <button className={"button" + (toGrade > 0 ? " secondary" : "")} type="button" disabled={busy}
                              title={`Queue fresh grades for every entry under this run's battery, the ${graded} already graded included. The board follows the new reports.`}
                              onClick={() => void act(async () => {
                                const d = await post("/api/events/run/confirm", { id: live.id, regrade: true });
                                return `Queued ${d.queued} regrades.`;
                              })}>
                        Regrade all {graded + toGrade}
                      </button>
                    )}
                    <button className="button secondary" type="button" disabled={busy}
                            onClick={() => refresh(live)}>
                      Refresh gallery
                    </button>
                  </div>
                  );
                })()}

                {["grading", "done"].includes(live.status) && (
                  <div className="run-controls">
                    <a className="button secondary" href={`/events/${slug}/${live.id}`}>
                      Leaderboard
                    </a>
                  </div>
                )}

                {live.status === "grading" && (
                  <>
                    {/* A paused run refuses confirm, and refresh would silently release the hold,
                        so neither is offered until grading resumes. */}
                    {!live.paused && ungradedCount(live) > 0 && (
                      <div className="run-controls">
                        <button className="button" type="button" disabled={busy}
                                onClick={() => void act(async () => {
                                  const d = await post("/api/events/run/confirm", { id: live.id });
                                  return `Queued ${d.queued}.`;
                                })}>
                          Grade {ungradedCount(live)} new entries
                        </button>
                      </div>
                    )}
                    <span className="progress-track" aria-hidden>
                      <span
                        className="progress-fill"
                        style={{
                          width: `${Math.round(
                            (doneCount(live) /
                              Math.max(1, doneCount(live) + inFlightCount(live))) * 100
                          )}%`,
                        }}
                      />
                    </span>
                    <div className="run-controls">
                      <button className="button secondary" type="button" disabled={busy}
                              onClick={() => void act(async () => {
                                await post("/api/events/run/pause", { id: live.id, paused: !live.paused });
                                return null;
                              })}>
                        {live.paused ? "Resume grading" : "Pause grading"}
                      </button>
                      {!live.paused && (
                        <button className="button secondary" type="button" disabled={busy}
                                onClick={() => refresh(live)}>
                          Refresh gallery
                        </button>
                      )}
                      <button className="button secondary" type="button" disabled={busy}
                              onClick={() => {
                                if (!window.confirm(
                                  `Cancel this run? The ${queuedCount(live)} queued grades stop and their apps become gradeable again. Grades already running are stopped too.`
                                )) return;
                                void act(async () => {
                                  await post("/api/events/run/cancel", { id: live.id });
                                  return "Run cancelled.";
                                });
                              }}>
                        Cancel run
                      </button>
                    </div>
                  </>
                )}

                {live.refresh_new_submissions !== null && (
                  <p className="section-intro fineprint">
                    {live.refresh_new_submissions === 0 && live.refresh_modified_submissions === 0
                      ? "The last refresh found nothing new: the gallery has not changed."
                      : `The last refresh found ${live.refresh_new_submissions} new ${live.refresh_new_submissions === 1 ? "submission" : "submissions"} and ${live.refresh_modified_submissions} ${live.refresh_modified_submissions === 1 ? "update" : "updates"}.`}
                  </p>
                )}

                {live.status === "ready" && live.mode === "active" && (
                  <p className="section-intro fineprint">
                    Avoid running this during live demos. Active checks create accounts and test records on each
                    app and load it repeatedly, which can affect demo quality.
                  </p>
                )}
                {live.gallery_complete === false && (
                  <p className="section-intro fineprint">Incomplete gallery, so this is not the whole field.</p>
                )}

                {live.event_entries.length > 0 && (
                  <div className="chips">
                    <span className="tag">{live.event_entries.length} entries</span>
                    {(() => {
                      const toGrade = ungradedCount(live);
                      const graded = doneCount(live);
                      return (
                        <>
                          {toGrade > 0 && <span className="tag">{toGrade} to grade</span>}
                          {graded > 0 && <span className="tag">{graded} graded</span>}
                        </>
                      );
                    })()}
                    {skipChips(live).map((c) => (
                      <span className="tag" key={c.label}>{c.label}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="runhead">
                  <span className="st">
                    {lastRun
                      ? `last run of ${new Date(lastRun.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${lastRun.mode}, ${lastRun.status}`
                      : "no runs yet"}
                  </span>
                </div>
                <div className="run-controls">
                  <button className="button" type="button" disabled={busy}
                          onClick={() => void act(async () => { await post("/api/events/run", { event: slug }); return null; })}>
                    {lastRun ? "Grade it again" : "Grade this event"}
                  </button>
                  {canActive && (
                    <button className="button secondary" type="button" disabled={busy}
                            onClick={() => void act(async () => {
                              await post("/api/events/run", { event: slug, mode: "active" });
                              return null;
                            })}>
                      Grade actively
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {note && <p className="section-intro">{note}</p>}
        </section>
      )}

      {/* The live run's field sits with its card. A settled run keeps its field only while its
          recovery passes are outstanding, and that one needs a heading: with no live card above it,
          an unlabelled table reads as the field of the run you are about to start. */}
      {fieldRun && fieldRun !== live && fieldRun.event_entries.length > 0 && (
        <h2 className="section-head">
          Field of the run from{" "}
          {new Date(fieldRun.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </h2>
      )}
      {fieldRun && fieldRun.event_entries.length > 0 && (
        <FieldTable
          runId={fieldRun.id}
          paused={fieldRun.paused}
          canGrade={fieldRun.status === "ready" || fieldRun.status === "grading"}
          onGraded={() => void load()}
          entries={fieldRun.event_entries.map((e): FieldEntry => ({
            project_url: e.project_url,
            skip_reason: e.skip_reason,
            grade_id: e.grade_id,
            status: gradeOf(e)?.status ?? null,
            progress: gradeOf(e)?.progress ?? null,
            retryDueAt: gradeOf(e)?.retry_due_at ?? null,
            marks: gradeOf(e)?.marks ?? null,
          }))}
        />
      )}

      <section className="section">
        <h2 className="section-head">Runs</h2>
        {history.length === 0 ? (
          <p className="section-intro">{live ? "The run above is the only one." : "None yet."}</p>
        ) : (
          <div className="table-scroll">
          <table className="count-table history-table">
            <thead>
              <tr>
                <th>date</th><th>battery</th><th className="num">entries</th>
                <th className="num">graded</th><th>gallery</th><th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>
                    <span className="tag">{r.mode}</span>
                    {r.admin ? <span className="tag"> admin</span> : r.override ? <span className="tag"> override</span> : null}
                  </td>
                  <td className="num">{r.entries_found ?? r.event_entries.length}</td>
                  <td className="num">{doneCount(r)} / {gradeableOf(r).length}</td>
                  <td>{r.gallery_complete === false ? "short" : r.gallery_complete === true ? "complete" : "unknown"}</td>
                  <td>
                    {r.status !== "resolving" && r.status !== "ready" && (
                      <><a href={`/events/${slug}/${r.id}`}>leaderboard</a>{refreshable(r) ? ", " : ""}</>
                    )}
                    {refreshable(r) && (
                      // Refusing this server-side is not enough on its own: a refresh puts the run
                      // back into resolving, and a second live run on one event is a thing no card
                      // can steer, so the button says why before it is pressed.
                      <button className="link-button" type="button" disabled={busy || !!live}
                              title={live ? "Another run on this event is still going." : undefined}
                              onClick={() => refresh(r)}>
                        refresh
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

    </>
  );
}
