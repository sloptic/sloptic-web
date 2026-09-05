/** GET /api/grade/:id: the poll a waiting visitor and a finished report both read.
 *
 *  Three contracts meet here. The queue explanation must match how the worker actually CLAIMS
 *  (worker/sloptic_web_worker/db.py claim_job: every public grade before every event grade, then by
 *  age), because a number derived from the table's order would tell a single submitter they are
 *  behind a 400 app field they will in fact overtake. The retention fields must match migration
 *  0009, which is the authority on the window and on which rows the sweep can even reach. And a
 *  report that EXPIRED must never be confusable with a read that failed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, getRequest, read } from "../../helpers/route";
import { ANON_REPORT_DAYS } from "@/lib/retention";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { GET } = await import("@/app/api/grade/[id]/route");

const get = (id: string) => GET(getRequest(`http://localhost/api/grade/${id}`), { params: { id } });

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let db: FakeSupabase;
beforeEach(() => {
  db = fakeDb({ store: { grades: [], results: [], worker_status: [], event_runs: [] } });
  setDb(db);
  setUser(null);
});
afterEach(() => resetRouteMocks());

/** A queued public grade, the shape the table actually stores. */
function queued(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    origin: "https://example.com",
    submitted_url: "https://example.com/app",
    status: "queued",
    submitted_at: iso(60_000),
    finished_at: null,
    error: null,
    account_id: null,
    event_run_id: null,
    ...over,
  };
}

describe("GET /api/grade/:id, finding the grade", () => {
  it("is a 404 for an id nothing was ever queued under", async () => {
    const { status, body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it("is a 500, not a 404, when the lookup itself fails", async () => {
    // "We could not read it" and "it does not exist" are different answers, and the second is the
    // one a visitor acts on by giving up.
    db.rows("grades").push(queued());
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status, body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(500);
    expect(body.error).not.toMatch(/not found/i);
  });

  it("returns the submitted URL and the origin that was actually graded", async () => {
    db.rows("grades").push(queued({ submitted_url: "https://example.com/deep/path?q=1" }));
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.url).toBe("https://example.com/deep/path?q=1");
    expect(body.origin).toBe("https://example.com");
  });

  it("never carries the owner's account id or the submitter's address hash out to a link holder", async () => {
    db.rows("grades").push(queued({ account_id: "user-1", submitter_ip_hash: "deadbeef" }));
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(Object.keys(body)).not.toContain("account_id");
    expect(Object.keys(body)).not.toContain("submitter_ip_hash");
    expect(JSON.stringify(body)).not.toContain("deadbeef");
    expect(JSON.stringify(body)).not.toContain("user-1");
  });
});

describe("GET /api/grade/:id, the queue explanation", () => {
  it("counts only older public grades ahead of a public grade", async () => {
    // claim_job takes queued grades oldest first within the public lane, so newer ones and grades
    // already running are not ahead of anybody.
    db.rows("grades").push(
      queued({ id: "44444444-4444-4444-8444-444444444444", submitted_at: iso(300_000) }),
      queued({ id: "55555555-5555-4555-8555-555555555555", submitted_at: iso(200_000) }),
      queued({ id: "33333333-3333-4333-8333-333333333333", submitted_at: iso(10_000) }),
      queued({ id: "running", status: "running", submitted_at: iso(400_000) }),
      queued({ id: "done", status: "done", submitted_at: iso(500_000) }),
      queued({ id: "11111111-1111-4111-8111-111111111111", submitted_at: iso(60_000) }),
    );
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect((body.queue as { ahead: number }).ahead).toBe(2);
  });

  it("does not count event grades ahead of a public grade", async () => {
    // A person waiting on one grade goes before an event grinding through hundreds (claim_job).
    db.rows("grades").push(queued({ id: "11111111-1111-4111-8111-111111111111" }));
    for (let i = 0; i < 50; i++) {
      db.rows("grades").push(queued({ id: `e${i}`, event_run_id: "run-1", submitted_at: iso(600_000) }));
    }
    expect(((await read(await get("11111111-1111-4111-8111-111111111111"))).body.queue as { ahead: number }).ahead).toBe(0);
  });

  it("counts every public grade ahead of an event grade, including ones queued after it", async () => {
    // The public lane always wins, so a public grade submitted later still overtakes this one.
    db.rows("event_runs").push({ id: "run-1", slug: "hack", paused: false, account_id: "org-1" });
    db.rows("grades").push(
      queued({ id: "11111111-1111-4111-8111-111111111111", event_run_id: "run-1", account_id: "org-1", submitted_at: iso(300_000) }),
      queued({ id: "p-older", submitted_at: iso(400_000) }),
      queued({ id: "p-newer", submitted_at: iso(1_000) }),
    );
    expect(((await read(await get("11111111-1111-4111-8111-111111111111"))).body.queue as { ahead: number }).ahead).toBe(2);
  });

  it("adds the same run's older grades, and not another run's, to an event grade's count", async () => {
    db.rows("event_runs").push({ id: "run-1", slug: "hack", paused: false, account_id: "org-1" });
    db.rows("grades").push(
      queued({ id: "11111111-1111-4111-8111-111111111111", event_run_id: "run-1", account_id: "org-1", submitted_at: iso(300_000) }),
      queued({ id: "same-older", event_run_id: "run-1", account_id: "org-1", submitted_at: iso(400_000) }),
      queued({ id: "same-newer", event_run_id: "run-1", account_id: "org-1", submitted_at: iso(10_000) }),
      queued({ id: "other-run", event_run_id: "run-2", account_id: "org-2", submitted_at: iso(500_000) }),
    );
    expect(((await read(await get("11111111-1111-4111-8111-111111111111"))).body.queue as { ahead: number }).ahead).toBe(1);
  });

  it("reports how long the grade has been waiting", async () => {
    db.rows("grades").push(queued({ submitted_at: iso(125_000) }));
    const { queue } = (await read(await get("11111111-1111-4111-8111-111111111111"))).body as { queue: { waiting_seconds: number } };
    expect(queue.waiting_seconds).toBeGreaterThanOrEqual(124);
    expect(queue.waiting_seconds).toBeLessThanOrEqual(127);
  });

  it("calls the worker alive on a fresh heartbeat and stalled on an old one", async () => {
    db.rows("grades").push(queued());
    db.rows("worker_status").push({ id: "worker", last_seen: iso(5_000), state: "idle" });
    let queue = ((await read(await get("11111111-1111-4111-8111-111111111111"))).body as { queue: { worker_alive: boolean; stalled: boolean } }).queue;
    expect(queue).toMatchObject({ worker_alive: true, stalled: false });

    db.rows("worker_status")[0].last_seen = iso(10 * 60_000);
    queue = ((await read(await get("11111111-1111-4111-8111-111111111111"))).body as { queue: { worker_alive: boolean; stalled: boolean } }).queue;
    expect(queue).toMatchObject({ worker_alive: false, stalled: true });
  });

  it("calls it stalled when no worker has ever checked in", async () => {
    db.rows("grades").push(queued());
    const { queue } = (await read(await get("11111111-1111-4111-8111-111111111111"))).body as { queue: { stalled: boolean } };
    expect(queue.stalled).toBe(true);
  });

  it("assumes a worker rather than announcing one is missing when the heartbeat is unreadable", async () => {
    // A missing grant made every heartbeat read a 403 once, and the page told visitors nothing was
    // running while the worker was polling. Being silent beats being confidently wrong.
    db.rows("grades").push(queued());
    db.failures.push({ table: "worker_status", error: { code: "42501", message: "permission denied" } });
    const { queue } = (await read(await get("11111111-1111-4111-8111-111111111111"))).body as { queue: { worker_alive: boolean } };
    expect(queue.worker_alive).toBe(true);
  });

  it("explains the queue only while the grade is queued", async () => {
    db.rows("grades").push(queued({ status: "running", progress: { phase: "probing" } }));
    const running = (await read(await get("11111111-1111-4111-8111-111111111111"))).body;
    expect(running.queue).toBeUndefined();
    expect(running.progress).toEqual({ phase: "probing" });

    db.rows("grades")[0].status = "failed";
    const failed = (await read(await get("11111111-1111-4111-8111-111111111111"))).body;
    expect(failed.queue).toBeUndefined();
    // progress is display state for a run in flight, not something a settled grade carries.
    expect(failed.progress).toBeNull();
  });
});

describe("GET /api/grade/:id, the result payload", () => {
  const done = (over: Record<string, unknown> = {}) =>
    queued({ id: "11111111-1111-4111-8111-111111111111", status: "done", finished_at: iso(DAY), ...over });

  it("hands back the stored result untouched, so a passive grade keeps its own curve", async () => {
    // A passive grade ranks on passive-2026.1 and must never be re-placed against the full curve.
    // The route's job is to pass the stored measurement through, never to derive a placement.
    db.rows("grades").push(done());
    db.rows("results").push({
      grade_id: "11111111-1111-4111-8111-111111111111",
      mode: "passive",
      catalog_version: "sloptic-2.2.0",
      curve_version: "passive-2026.1",
      passive_probe_count: 44,
      slop_score: 12.5,
      percentile: 31,
      percentile_band: "middling",
      axis_slop: { security: 6.5, qa: 4, performance: 2 },
      ranking: { cleaner_than_pct: 69 },
    });
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.result).toMatchObject({
      mode: "passive",
      curve_version: "passive-2026.1",
      passive_probe_count: 44,
      slop_score: 12.5,
      percentile: 31,
      ranking: { cleaner_than_pct: 69 },
    });
  });

  it("does not read a result for a grade that has not finished", async () => {
    db.rows("grades").push(queued({ status: "running" }));
    db.rows("results").push({ grade_id: "11111111-1111-4111-8111-111111111111", slop_score: 1 });
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.result).toBeNull();
    expect(db.calls.some((c) => c.table === "results")).toBe(false);
  });

  it("still renders a finished grade when the challenge columns are not there yet", async () => {
    // 0020 to 0022 may not be applied; a report that already exists must keep rendering.
    db.rows("grades").push(done());
    db.rows("results").push({ grade_id: "11111111-1111-4111-8111-111111111111", slop_score: 3, mode: "passive" });
    db.failures.push({ table: "results", kind: "select", error: { code: "42703", message: "column does not exist" } });
    const { status, body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ slop_score: 3 });
  });

  it("falls back to the core columns when ownership and progress are not there yet, and then claims nothing about retention", async () => {
    // "Unknown" must not render as "expires in 30 days" on a database that expires nothing.
    db.rows("grades").push({
      id: "11111111-1111-4111-8111-111111111111",
      origin: "https://example.com",
      submitted_url: "https://example.com",
      status: "queued",
      submitted_at: iso(1_000),
      finished_at: null,
      error: null,
    });
    db.failures.push({ table: "grades", kind: "select", error: { code: "42703", message: "column does not exist" } });
    const { status, body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(200);
    expect(body.claimed).toBeUndefined();
    expect(body.expires_at).toBeUndefined();
    expect(body.retain_days).toBeUndefined();
    expect(body.mine).toBe(false);
  });

  it("distinguishes a report that expired from a read that failed", async () => {
    // The expired case: the sweep dropped the results row, the grade row remains. That is a 200
    // with no result, which is what lets the page say the report is gone.
    db.rows("grades").push(done({ finished_at: iso(40 * DAY) }));
    const expired = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(expired.status).toBe(200);
    expect(expired.body.result).toBeNull();
    expect(Date.parse(expired.body.expires_at as string)).toBeLessThan(Date.now());

    // The failure case: the same shape would tell someone their report was deleted over a database
    // hiccup, so it must be a 500 instead.
    db.rows("results").push({ grade_id: "11111111-1111-4111-8111-111111111111", slop_score: 3 });
    db.failures.push({ table: "results", kind: "select", error: { code: "08006", message: "connection lost" } });
    db.failures.push({ table: "results", kind: "select", error: { code: "08006", message: "connection lost" } });
    const broken = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(broken.status).toBe(500);
    expect(broken.body.result).toBeUndefined();
  });
});

describe("GET /api/grade/:id, retention", () => {
  it("mirrors the window migration 0009 sweeps on", () => {
    // 0009 is the authority; lib/retention.ts only exists so the UI can say when. If they drift, the
    // page promises a date the database does not keep.
    // vitest roots at web/, so the migrations sit one level up.
    const sql = readFileSync(
      path.join(process.cwd(), "..", "supabase", "migrations", "0009_ownership_and_retention.sql"),
      "utf8",
    );
    const declared = sql.match(/expire_anonymous_reports\(retain_days int default (\d+)\)/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(ANON_REPORT_DAYS);
  });

  it("expires an unclaimed report a window after it finished", async () => {
    const finished = iso(DAY);
    db.rows("grades").push(queued({ status: "done", finished_at: finished, account_id: null }));
    db.rows("results").push({ grade_id: "11111111-1111-4111-8111-111111111111", slop_score: 3 });
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.claimed).toBe(false);
    expect(body.retain_days).toBe(ANON_REPORT_DAYS);
    expect(Date.parse(body.expires_at as string)).toBe(Date.parse(finished) + ANON_REPORT_DAYS * DAY);
  });

  it("gives a claimed report no expiry, which is the whole reason to sign in", async () => {
    db.rows("grades").push(queued({ status: "done", finished_at: iso(DAY), account_id: "user-1" }));
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.claimed).toBe(true);
    expect(body.expires_at).toBeNull();
  });

  it("promises no expiry for a grade with no finished_at, since the sweep cannot reach it either", async () => {
    // 0009 only deletes where finished_at is not null, so an unfinished or crashed grade has no date
    // to count from and the API must not invent one.
    db.rows("grades").push(queued({ status: "done", finished_at: null }));
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.expires_at).toBeNull();
    expect(body.claimed).toBe(false);
  });
});

describe("GET /api/grade/:id, who the viewer is", () => {
  it("tells the owning account the report is theirs", async () => {
    db.rows("grades").push(queued({ account_id: "user-1" }));
    setUser({ id: "user-1", email: "a@example.com" });
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.mine).toBe(true);
  });

  it("tells a different account, and an anonymous link holder, that it is not", async () => {
    db.rows("grades").push(queued({ account_id: "user-1" }));
    setUser({ id: "user-2", email: "b@example.com" });
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.mine).toBe(false);
    setUser(null);
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.mine).toBe(false);
  });

  it("does not call an unowned grade anybody's, even for a signed-in viewer", async () => {
    // The footer used to read "is it claimed" and answer "is it yours", which offered a delete
    // button that then returned a 403.
    db.rows("grades").push(queued({ account_id: null }));
    setUser({ id: "user-1", email: "a@example.com" });
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.mine).toBe(false);
    expect(body.claimed).toBe(false);
  });
});

describe("GET /api/grade/:id, the event a grade came from", () => {
  it("carries the run's slug and pause state to everyone holding the link", async () => {
    db.rows("event_runs").push({ id: "run-1", slug: "hack-2026", paused: true, account_id: "org-1" });
    db.rows("grades").push(queued({ status: "running", event_run_id: "run-1", account_id: "org-1" }));
    const { body } = await read(await get("11111111-1111-4111-8111-111111111111"));
    expect(body.event).toMatchObject({ slug: "hack-2026", runId: "run-1", paused: true, canResume: false });
  });

  it("offers resuming to the organizer alone", async () => {
    db.rows("event_runs").push({ id: "run-1", slug: "hack-2026", paused: true, account_id: "org-1" });
    db.rows("grades").push(queued({ status: "running", event_run_id: "run-1", account_id: "org-1" }));
    setUser({ id: "org-1", email: "org@example.com" });
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.event).toMatchObject({ canResume: true });
    setUser({ id: "someone-else", email: "x@example.com" });
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.event).toMatchObject({ canResume: false });
  });

  it("says nothing about an event for a grade submitted here", async () => {
    db.rows("grades").push(queued());
    expect((await read(await get("11111111-1111-4111-8111-111111111111"))).body.event).toBeNull();
  });
});
