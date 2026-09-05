/** /api/status and /api/health: the two questions about whether grading works.
 *
 *  They are deliberately different. /api/status answers "may I offer the form", which the landing
 *  page asks and which must never start alerting. /api/health answers "would a grade submitted right
 *  now finish", for a monitor too dumb to parse a body, so the verdict is the HTTP status. A slow
 *  queue is not a fault; a queue nobody is draining is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, resetRouteMocks, read } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { GET: status } = await import("@/app/api/status/route");
const { GET: health } = await import("@/app/api/health/route");

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let db: FakeSupabase;
const savedEnv = { ...process.env };
beforeEach(() => {
  db = fakeDb({ store: { grades: [], worker_status: [] } });
  setDb(db);
  process.env.GRADING_OPEN = "1";
});
afterEach(() => {
  resetRouteMocks();
  process.env = { ...savedEnv };
});

const alive = () => db.rows("worker_status").push({ id: "worker", last_seen: iso(3_000), state: "idle", in_flight: 0 });

describe("GET /api/status", () => {
  it("mirrors the flag the POST route enforces", async () => {
    expect((await read(await status())).body.grading_open).toBe(true);
    process.env.GRADING_OPEN = "0";
    expect((await read(await status())).body.grading_open).toBe(false);
  });

  it("is never cached, since a stale answer offers a form that will be refused", async () => {
    expect((await status()).headers.get("cache-control")).toBe("no-store");
  });

  it("stays a 200 even when grading is off, because the landing page must not page anyone", async () => {
    process.env.GRADING_OPEN = "0";
    expect((await status()).status).toBe(200);
  });
});

describe("GET /api/health", () => {
  it("is a 200 with no problems when a worker is checking in and grading is open", async () => {
    alive();
    const { status: code, body } = await read(await health());
    expect(code).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.problems).toEqual([]);
    expect((body.worker as { alive: boolean }).alive).toBe(true);
  });

  it("is a 503 when grading is switched off", async () => {
    alive();
    process.env.GRADING_OPEN = "0";
    const { status: code, body } = await read(await health());
    expect(code).toBe(503);
    expect((body.problems as string[]).join(" ")).toMatch(/switched off/);
  });

  it("is a 503 when the heartbeat is too old to trust, and says how old", async () => {
    db.rows("worker_status").push({ id: "worker", last_seen: iso(10 * 60_000), state: "idle" });
    const { status: code, body } = await read(await health());
    expect(code).toBe(503);
    expect((body.worker as { alive: boolean; heartbeat_age_seconds: number }).alive).toBe(false);
    expect((body.problems as string[]).join(" ")).toMatch(/heartbeat is \d+s old/);
  });

  it("is a 503 when no worker has ever checked in", async () => {
    const { status: code, body } = await read(await health());
    expect(code).toBe(503);
    expect((body.problems as string[]).join(" ")).toMatch(/no worker has ever checked in/);
    expect((body.worker as { heartbeat_age_seconds: number | null }).heartbeat_age_seconds).toBeNull();
  });

  it("tells a monitor the truth about its own blindness when the heartbeat is unreadable", async () => {
    // The grade page assumes a worker in this case, on purpose: there the cost of being wrong is
    // telling a visitor something false. A monitor is the opposite, an unreadable heartbeat is worth
    // waking up for.
    db.failures.push({ table: "worker_status", error: { code: "42501", message: "permission denied" } });
    const { status: code, body } = await read(await health());
    expect(code).toBe(503);
    expect((body.problems as string[]).join(" ")).toMatch(/unreadable/);
    expect((body.worker as { alive: boolean }).alive).toBe(false);
  });

  it("is a 503 when the queue cannot be counted, and reports no count rather than zero", async () => {
    alive();
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status: code, body } = await read(await health());
    expect(code).toBe(503);
    expect(body.queued).toBeNull();
  });

  it("does not fail the check on a deep queue, since the work is getting done", async () => {
    alive();
    for (let i = 0; i < 500; i++) db.rows("grades").push({ id: `g${i}`, status: "queued" });
    const { status: code, body } = await read(await health());
    expect(code).toBe(200);
    expect(body.queued).toBe(500);
  });

  it("counts what is waiting in both lanes, which is what a queue depth means to an operator", async () => {
    alive();
    db.rows("grades").push(
      { id: "p1", status: "queued", event_run_id: null },
      { id: "e1", status: "queued", event_run_id: "run-1" },
      { id: "r1", status: "running", event_run_id: null },
    );
    expect((await read(await health())).body.queued).toBe(2);
  });

  it("is never cached", async () => {
    alive();
    expect((await health()).headers.get("cache-control")).toBe("no-store");
  });
});
