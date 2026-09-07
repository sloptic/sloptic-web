/** The door refuses work the worker has already decided not to do.
 *
 *  The budget belongs to the worker: it counts completions over a rolling 24h and stops claiming a
 *  lane when the allowance is gone. The web tier knew none of that, so it kept accepting public
 *  submissions, held them for the queue window and then failed them with "no worker was available
 *  to run it" -- blaming a worker that was alive and grading the whole time. Publicity produces
 *  exactly that state, at exactly the moment it reads as a broken site rather than a busy one.
 *
 *  The lanes are the reason this cannot be one boolean. Separate budgets exist so that a 250 app
 *  event cannot close the site to a person submitting one URL, so "the event lane is spent" must
 *  never refuse a public grade. That is the case worth a test, because it is the one a simpler fix
 *  would get wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, read } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  return { default: { lookup }, lookup };
});

const { POST } = await import("@/app/api/grade/route");
const { GET: health } = await import("@/app/api/health/route");

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let db: FakeSupabase;
const savedEnv = { ...process.env };

beforeEach(() => {
  db = fakeDb({ store: { grades: [], rate_limits: [], worker_status: [] } });
  setDb(db);
  setUser(null);
  process.env.GRADING_OPEN = "1";
  process.env.RATE_LIMIT_MAX = "50";
  process.env.RATE_LIMIT_WINDOW_SECONDS = "3600";
  process.env.MAX_QUEUE_DEPTH = "30";
});
afterEach(() => {
  resetRouteMocks();
  process.env = { ...savedEnv };
});

/** A live worker, with whatever it has decided not to claim. */
function worker(blocked_lanes: Record<string, string>, state = "grading") {
  db.rows("worker_status").push({
    id: "worker",
    last_seen: iso(3_000),
    state,
    reason: "",
    in_flight: null,
    blocked_lanes,
  });
}

let ip = 0;
function submit() {
  // A fresh address per call: the rate limiter is not what is under test here.
  const req = jsonRequest("http://localhost/api/grade", { url: "https://example.com" });
  req.headers.set("x-forwarded-for", `203.0.113.${(ip = (ip + 1) % 250) + 1}`);
  return POST(req);
}

describe("POST /api/grade, lanes the worker is not claiming", () => {
  it("refuses when the public lane is blocked, rather than queueing into a failure", async () => {
    worker({ public: "daily budget spent (300/300 in 24h)" });
    const { status } = await read(await submit());
    expect(status).toBe(503);
    expect(db.rows("grades")).toEqual([]);
  });

  it("says nothing about why, since the reason is ours and the visitor's next move is the same", async () => {
    worker({ public: "challenge backoff, 3.2h left (25 consecutive challenges)" });
    const { body } = await read(await submit());
    expect(body.error).not.toMatch(/backoff|budget|24h|challenge/i);
    expect(body.error).toMatch(/try again later/i);
  });

  it("still accepts a public grade while only the EVENT lane is spent", async () => {
    // The whole reason the budgets are separate. Getting this wrong would let one large field close
    // the site to everyone, which is the failure the lanes were introduced to prevent.
    worker({ event: "event budget spent (500/500 in 24h)" });
    const { status } = await read(await submit());
    expect(status).toBe(202);
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("accepts when the worker reports nothing blocked", async () => {
    worker({});
    expect((await read(await submit())).status).toBe(202);
  });

  it("accepts when no worker has ever written a heartbeat", async () => {
    // A missing row is not a blocked lane. GRADING_OPEN is the switch for "there is no worker".
    expect((await read(await submit())).status).toBe(202);
  });

  it("fails OPEN when the heartbeat cannot be read", async () => {
    // Same call as the queue depth beside it: an unreadable row is not evidence of a blocked lane,
    // and closing the site on a transient database fault is the worse of the two errors.
    db.failures.push({ table: "worker_status", error: { code: "42501", message: "permission denied" } });
    expect((await read(await submit())).status).toBe(202);
  });
});

describe("GET /api/health, a lane nobody is draining", () => {
  it("reports degraded when the public lane is blocked, even though the worker is grading", async () => {
    // The case `state` alone could not express, and the one a monitor most needs: with event
    // allowance left the worker is honestly 'grading' while every public submission goes nowhere.
    worker({ public: "daily budget spent (300/300 in 24h)" }, "grading");
    const { status, body } = await read(await health());
    expect(status).toBe(503);
    expect((body.worker as { blocked_lanes: string[] }).blocked_lanes).toEqual(["public"]);
    expect((body.problems as string[]).join(" ")).toMatch(/not claiming.*public/i);
  });

  it("names every blocked lane", async () => {
    worker({ public: "daily budget spent", event: "daily budget spent" }, "holding");
    const { body } = await read(await health());
    expect((body.worker as { blocked_lanes: string[] }).blocked_lanes).toEqual(["event", "public"]);
  });

  it("stays healthy when only the event lane is blocked and public still runs", async () => {
    // A monitor that pages because an organizer spent the event allowance exactly as designed is a
    // monitor that gets muted, and a muted monitor protects nothing. The lane is still reported, so
    // whoever goes looking can see it; it just does not constitute an outage.
    worker({ event: "event budget spent (500/500 in 24h)" }, "grading");
    const { status, body } = await read(await health());
    expect(status).toBe(200);
    expect((body.worker as { blocked_lanes: string[] }).blocked_lanes).toEqual(["event"]);
    expect(body.problems).toEqual([]);
  });

  it("falls back to the coarse holding reason for a worker older than the lane map", async () => {
    // Migration and worker deploy do not land at the same instant. Reporting healthy in that gap
    // would be the one moment a monitor is asleep.
    db.rows("worker_status").push({
      id: "worker",
      last_seen: iso(3_000),
      state: "holding",
      reason: "public: daily budget spent (300/300 in 24h)",
      in_flight: null,
    });
    const { status, body } = await read(await health());
    expect(status).toBe(503);
    expect((body.problems as string[]).join(" ")).toMatch(/holding/i);
  });
});
