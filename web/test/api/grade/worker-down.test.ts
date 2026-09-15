/** What every worker-backed route does when there is no worker.
 *
 *  The grade door was gated and nine others were not, so during an outage a visitor could not queue a
 *  grade but could still start a gallery resolve that spins on "Reading the gallery" until somebody
 *  comes back, or file a domain claim nothing ever checks. The v3 corpus sprint stops the worker for
 *  7.6 days on purpose, which is long enough for every one of those to be reported as a bug.
 *
 *  The helper is tested directly because that is where the decision lives, and two routes are tested
 *  through it because a decision nothing calls is worth nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, read, liveWorker } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { gradingUnavailable, CHECKS_PAUSED_MESSAGE } = await import("@/lib/worker-status");
const { GRADING_PAUSED_MESSAGE, GRADING_CLOSED_MESSAGE } = await import("@/lib/flags");
const { POST: startRun } = await import("@/app/api/events/run/route");

const ORGANIZER = { id: "acct-1", email: "o@example.com" };
const DOWN = 10 * 60;      // ten minutes of silence, well past the 90s window

let db: FakeSupabase;
const savedEnv = { ...process.env };

beforeEach(() => {
  db = fakeDb({ store: { worker_status: [], event_runs: [], grants: [], event_claims: [] } });
  setDb(db);
  setUser(ORGANIZER);
  process.env.GRADING_OPEN = "1";
});
afterEach(() => {
  resetRouteMocks();
  process.env = { ...savedEnv };
});

const seat = (over: Record<string, unknown> = {}, age = 2) => {
  db.rows("worker_status").length = 0;
  db.rows("worker_status").push(liveWorker(over, age));
};

describe("gradingUnavailable", () => {
  it("lets work through while the worker is beating", async () => {
    seat();
    expect(await gradingUnavailable(db as never, "grade")).toBeNull();
    expect(await gradingUnavailable(db as never, "check")).toBeNull();
  });

  it("refuses both kinds once the heartbeat is stale", async () => {
    seat({}, DOWN);
    expect((await gradingUnavailable(db as never, "grade"))?.status).toBe(503);
    expect((await gradingUnavailable(db as never, "check"))?.status).toBe(503);
  });

  it("refuses when no worker has ever checked in", async () => {
    expect((await gradingUnavailable(db as never, "check"))?.status).toBe(503);
  });

  it("says the right generic for each kind, since a verifier is not grading", async () => {
    seat({}, DOWN);
    const grade = await (await gradingUnavailable(db as never, "grade"))!.json();
    const check = await (await gradingUnavailable(db as never, "check"))!.json();
    expect(grade.error).toBe(GRADING_PAUSED_MESSAGE);
    expect(check.error).toBe(CHECKS_PAUSED_MESSAGE);
  });

  it("prefers the operator's note to either generic, because only it can say how long", async () => {
    seat({ paused_note: "Down for the corpus re-run. Back next week." }, DOWN);
    const res = await (await gradingUnavailable(db as never, "check"))!.json();
    expect(res.error).toBe("Down for the corpus re-run. Back next week.");
  });

  it("applies GRADING_OPEN to grading only", async () => {
    // The flag means what it has always meant. Folding it into the check routes would switch
    // verification off on every deployment with grading deliberately closed, which is a behaviour
    // change dressed as an outage fix.
    seat();
    process.env.GRADING_OPEN = "0";
    const grade = await gradingUnavailable(db as never, "grade");
    expect(grade?.status).toBe(503);
    expect((await grade!.json()).error).toBe(GRADING_CLOSED_MESSAGE);
    expect(await gradingUnavailable(db as never, "check")).toBeNull();
  });

  it("fails OPEN when the heartbeat cannot be read", async () => {
    // An unreadable row is not evidence of a missing worker, and closing the site on a database blip
    // is the worse of the two mistakes. Same call the queue depth beside it makes.
    db.failures.push({ table: "worker_status", error: { code: "42501", message: "permission denied" } });
    expect(await gradingUnavailable(db as never, "check")).toBeNull();
  });
});

describe("POST /api/events/run, wired to it", () => {
  const start = () => startRun(jsonRequest("http://x/api/events/run", { event: "hacknight" }));

  const authorize = () =>
    db.rows("grants").push({
      id: "g1",
      account_id: ORGANIZER.id,
      kind: "organizer_event",
      scope: "hacknight",
      revoked_at: null,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

  it("starts the run while the worker is up", async () => {
    authorize();
    seat();
    expect((await read(await start())).status).toBe(201);
  });

  it("refuses to start one nothing will resolve", async () => {
    // Without this the run is inserted as 'resolving' and the page spins on "Reading the gallery"
    // for as long as the outage lasts, which is the failure that reads as a broken feature.
    authorize();
    seat({}, DOWN);
    const { status } = await read(await start());
    expect(status).toBe(503);
    expect(db.rows("event_runs")).toEqual([]);
  });

  it("still answers about the CALLER before it answers about itself", async () => {
    // The availability check sits last on purpose: an account with no grant must hear 403, not 503,
    // or an outage would hide every authorization answer the route owes.
    seat({}, DOWN);
    expect((await read(await start())).status).toBe(403);
  });
});
