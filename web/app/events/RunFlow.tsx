"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = { project_url: string; app_url: string | null; skip_reason: string | null; grade_id: string | null };
type Run = {
  id: string;
  slug: string;
  mode: "passive" | "active";
  status: "resolving" | "ready" | "grading" | "done" | "failed" | "cancelled";
  override: boolean;
  entries_found: number | null;
  gallery_complete: boolean | null;
  detail: string | null;
  created_at: string;
  event_entries: Entry[];
};

const POLL_MS = 4000;

type Verified = { slug: string; granted_at: string; expires_at: string };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function RunFlow({
  verified,
  canOverride,
}: {
  verified: Verified[];
  canOverride: boolean;
}) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/events/run", { cache: "no-store" });
      if (!res.ok) return;               // a failed read is not an empty list
      setRuns((await res.json()).runs ?? []);
    } catch {
      /* keep what we had */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is moving.
  useEffect(() => {
    if (!runs?.some((r) => r.status === "resolving" || r.status === "grading")) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [runs, load]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  async function startRun(event: string) {
    setBusy(true);
    setNote(null);
    try {
      await post("/api/events/run", { event });
      setSlug("");
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    setBusy(true);
    setNote(null);
    try {
      const data = await post("/api/events/run/confirm", { id });
      setNote(`Queued ${data.queued}.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not queue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(verified.length > 0 || canOverride) && (
        <section className="section attached">
          <h2 className="section-head">Verified events</h2>
          {verified.length > 0 ? (
            <div className="table-scroll">
              <table className="count-table">
                <thead>
                  <tr>
                    <th>event</th>
                    <th>re-prove by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {verified.map((v) => (
                    <tr key={v.slug}>
                      <th scope="row">
                        <a href={`https://${v.slug}.devpost.com`} rel="noopener noreferrer">
                          {v.slug}.devpost.com
                        </a>
                      </th>
                      <td>{when(v.expires_at)}</td>
                      <td>
                        <button
                          className="link-button"
                          type="button"
                          disabled={busy}
                          onClick={() => void startRun(v.slug)}
                        >
                          grade it
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canOverride && (
            <>
              <p className="section-intro fineprint">
                Override is on for this account: any event, passive only, not an authorized board.
              </p>
              <div className="add-report-row">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="any-event.devpost.com"
                  aria-label="Devpost event address"
                  spellCheck={false}
                />
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy || !slug.trim()}
                  onClick={() => void startRun(slug)}
                >
                  resolve field
                </button>
              </div>
            </>
          )}
          {note && <p className="section-intro">{note}</p>}
        </section>
      )}

      {(runs ?? []).map((r) => {
        const entries = r.event_entries ?? [];
        const gradeable = entries.filter((e) => !e.skip_reason);
        const skipped = entries.filter((e) => e.skip_reason);
        const graded = entries.filter((e) => e.grade_id).length;
        return (
          <section className="section" key={r.id}>
            <h2 className="section-head">
              {r.slug} <span className="tag">{r.mode}</span>
              {r.override ? <span className="tag">override</span> : null}
            </h2>

            <div className="callout" data-tone={r.gallery_complete === false ? "warn" : undefined}>
              <p className="callout-label">{r.status}</p>
              <p>
                {r.status === "resolving" && "Reading the gallery."}
                {r.status === "ready" &&
                  `${entries.length} entries, ${gradeable.length} gradeable, ${skipped.length} skipped.`}
                {r.status === "grading" && `Grading ${graded} entries.`}
                {r.status === "done" && `Done. ${graded} graded.`}
                {r.status === "failed" && (r.detail ?? "Failed.")}
              </p>
              {r.gallery_complete === false && (
                <p className="fineprint">
                  The gallery came back incomplete, so this is not the whole field: {r.detail}
                </p>
              )}
            </div>

            {r.status === "ready" && (
              <div className="cta-row claim-check">
                <button className="button" type="button" disabled={busy} onClick={() => void confirm(r.id)}>
                  Grade {gradeable.length} entries
                </button>
              </div>
            )}

            {entries.length > 0 && (
              <details className="check-detail">
                <summary>the field ({entries.length})</summary>
                <div className="table-scroll">
                  <table className="count-table">
                    <thead>
                      <tr>
                        <th>app</th>
                        <th>status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.project_url}>
                          <th scope="row">
                            {e.app_url ? (
                              <a href={e.app_url} target="_blank" rel="noopener noreferrer">
                                {e.app_url.replace(/^https?:\/\//, "").slice(0, 46)}
                              </a>
                            ) : (
                              <a href={e.project_url} target="_blank" rel="noopener noreferrer">
                                {e.project_url.replace(/^https?:\/\//, "").slice(0, 46)}
                              </a>
                            )}
                          </th>
                          <td className="band-note">
                            {e.skip_reason ? (
                              e.skip_reason
                            ) : e.grade_id ? (
                              <a href={`/grade/${e.grade_id}`}>report</a>
                            ) : (
                              "will be graded"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}
