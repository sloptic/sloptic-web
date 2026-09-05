import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { DEFAULTS, ORGANIZER, STRANGER, entry, grade, interleave, run, stored } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
vi.mock("@/lib/egress", () => ({ egressPrecheck: async () => null }));

import { POST as pause } from "@/app/api/events/run/pause/route";
import { POST as cancel } from "@/app/api/events/run/cancel/route";
import { POST as confirm } from "@/app/api/events/run/confirm/route";
import { POST as gradeOne } from "@/app/api/events/run/grade-one/route";
import { POST as refresh } from "@/app/api/events/run/refresh/route";

let db: FakeSupabase;

const call = (handler: (r: never) => Promise<Response>, path: string, body: unknown) =>
  handler(jsonRequest(`https://sloptic.org/api/events/run/${path}`, body) as never);

beforeEach(() => {
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
});
afterEach(() => resetRouteMocks());

/** A run mid-drain: two entries queued, one already running. */
function grading(over: Record<string, unknown> = {}) {
  db.store.event_runs = [run({ status: "grading", started_at: "2026-01-02T00:00:00.000Z", ...over })];
  db.store.event_entries = [
    entry({ id: "entry-1", project_url: "https://devpost.com/software/p1", grade_id: "g-queued-1" }),
    entry({ id: "entry-2", project_url: "https://devpost.com/software/p2", grade_id: "g-queued-2" }),
    entry({ id: "entry-3", project_url: "https://devpost.com/software/p3", grade_id: "g-running" }),
  ];
  db.store.grades = [
    grade({ id: "g-queued-1", status: "queued", event_run_id: "run-1" }),
    grade({ id: "g-queued-2", status: "queued", event_run_id: "run-1", retry_due_at: "2026-03-01T00:00:00.000Z" }),
    grade({ id: "g-running", status: "running", event_run_id: "run-1" }),
  ];
}

describe("POST /api/events/run/pause", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await call(pause, "pause", { id: "run-1" }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON, and a body with no run", async () => {
    expect((await read(await pause(malformedRequest("https://sloptic.org/api/events/run/pause") as never))).status).toBe(400);
    expect((await read(await call(pause, "pause", { paused: true }))).status).toBe(400);
  });

  it("cannot see another account's run", async () => {
    grading({ account_id: STRANGER.id });
    const { status } = await read(await call(pause, "pause", { id: "run-1", paused: true }));
    expect(status).toBe(404);
    expect(stored(db, "event_runs", "run-1")?.paused).toBe(false);
  });

  it("holds the queue of a grading run", async () => {
    grading();
    const { status, body } = await read(await call(pause, "pause", { id: "run-1", paused: true }));
    expect(status).toBe(200);
    expect(body.paused).toBe(true);
    const after = stored(db, "event_runs", "run-1");
    expect(after?.paused).toBe(true);
    // A hold is not a stop: the run is still grading and nothing was dequeued.
    expect(after?.status).toBe("grading");
    expect(db.rows("grades").filter((g) => g.status === "queued")).toHaveLength(2);
  });

  it("defaults to holding when the body does not say", async () => {
    grading();
    await call(pause, "pause", { id: "run-1" });
    expect(stored(db, "event_runs", "run-1")?.paused).toBe(true);
  });

  it("releases on paused: false, and only on that", async () => {
    grading({ paused: true });
    await call(pause, "pause", { id: "run-1", paused: false });
    expect(stored(db, "event_runs", "run-1")?.paused).toBe(false);
  });

  it("refuses to pause a run that is not grading", async () => {
    for (const status of ["resolving", "ready", "done", "failed", "cancelled"]) {
      grading({ status });
      const res = await read(await call(pause, "pause", { id: "run-1", paused: true }));
      expect(res.status, status).toBe(409);
      expect(stored(db, "event_runs", "run-1")?.paused, status).toBe(false);
    }
  });

  it("does not pause a run that settled between the check and the write", async () => {
    // The write is guarded on grading, so a run that finished (or was cancelled) first keeps its
    // state. The response still says paused: true, which is a smaller problem than the write would
    // have been.
    grading();
    interleave(db, "event_runs", "update", () => {
      db.rows("event_runs")[0].status = "done";
    });
    await call(pause, "pause", { id: "run-1", paused: true });
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "done", paused: false });
  });
});

describe("a paused run holds: nothing may add to its queue", () => {
  beforeEach(() => {
    grading({ paused: true });
  });

  it("refuses a confirm", async () => {
    db.rows("event_entries").push(entry({ id: "entry-4", project_url: "https://devpost.com/software/p4" }));
    const { status } = await read(await call(confirm, "confirm", { id: "run-1" }));
    expect(status).toBe(409);
    expect(db.rows("grades")).toHaveLength(3);
  });

  it("refuses a grade-one", async () => {
    db.rows("event_entries").push(entry({ id: "entry-4", project_url: "https://devpost.com/software/p4" }));
    const { status } = await read(
      await call(gradeOne, "grade-one", { runId: "run-1", projectUrls: ["https://devpost.com/software/p4"] })
    );
    expect(status).toBe(409);
    expect(db.rows("grades")).toHaveLength(3);
  });

  it("refuses a refresh, so the hold outranks it", async () => {
    const { status } = await read(await call(refresh, "refresh", { id: "run-1" }));
    expect(status).toBe(409);
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "grading", paused: true });
  });

  it("still allows a cancel, which is the way out", async () => {
    const { status } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(200);
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "cancelled", paused: false });
  });

  it("leaves the held grades exactly where they were", async () => {
    await call(confirm, "confirm", { id: "run-1" });
    await call(refresh, "refresh", { id: "run-1" });
    expect(db.rows("grades").map((g) => g.status)).toEqual(["queued", "queued", "running"]);
    expect(stored(db, "event_runs", "run-1")?.paused).toBe(true);
  });
});

describe("POST /api/events/run/cancel", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON, and a body with no run", async () => {
    expect((await read(await cancel(malformedRequest("https://sloptic.org/api/events/run/cancel") as never))).status).toBe(400);
    expect((await read(await call(cancel, "cancel", {}))).status).toBe(400);
  });

  it("cannot see or stop another account's run", async () => {
    grading({ account_id: STRANGER.id });
    const { status } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(404);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("grading");
    expect(db.rows("grades").filter((g) => g.status === "queued")).toHaveLength(2);
  });

  it("stops a grading run: the queue is cancelled, not failed", async () => {
    // 0024: 'cancelled' is its own status because "did not respond" would be a lie about who stopped.
    grading();
    const { status, body } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ cancelled: true, dequeued: 2 });
    for (const id of ["g-queued-1", "g-queued-2"]) {
      const g = stored(db, "grades", id);
      expect(g?.status, id).toBe("cancelled");
      expect(g?.finished_at, id).toBeTruthy();
      expect(String(g?.error), id).toMatch(/organizer/);
    }
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "cancelled", paused: false });
    expect(stored(db, "event_runs", "run-1")?.finished_at).toBeTruthy();
  });

  it("makes the dequeued apps gradeable again", async () => {
    grading();
    await call(cancel, "cancel", { id: "run-1" });
    expect(stored(db, "event_entries", "entry-1")).toMatchObject({ grade_id: null, skip_reason: null });
    expect(stored(db, "event_entries", "entry-2")?.grade_id).toBeNull();
  });

  it("leaves a running grade alone: the worker owns the kill", async () => {
    // The API's job is to mark the run cancelled. The worker then finds the children of a cancelled
    // run (db.running_on_cancelled_runs), kills them, marks them cancelled and unlinks their
    // entries, so nothing here should pre-empt a report that may land in the same breath.
    grading();
    await call(cancel, "cancel", { id: "run-1" });
    expect(stored(db, "grades", "g-running")?.status).toBe("running");
    expect(stored(db, "event_entries", "entry-3")?.grade_id).toBe("g-running");
  });

  it("kills the booked retries, matching the worker's own cancel_run", async () => {
    grading();
    await call(cancel, "cancel", { id: "run-1" });
    expect(db.rows("grades").every((g) => g.retry_due_at === null)).toBe(true);
  });

  it("touches no other run's queue", async () => {
    grading();
    db.rows("event_runs").push(run({ id: "run-2", status: "grading" }));
    db.rows("grades").push(grade({ id: "g-elsewhere", status: "queued", event_run_id: "run-2" }));
    await call(cancel, "cancel", { id: "run-1" });
    expect(stored(db, "grades", "g-elsewhere")?.status).toBe("queued");
    expect(stored(db, "event_runs", "run-2")?.status).toBe("grading");
  });

  it("stops a ready run that has not queued anything yet", async () => {
    grading({ status: "ready" });
    db.store.grades = [];
    const { status, body } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(200);
    expect(body.dequeued).toBe(0);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("cancelled");
  });

  it("refuses to re-cancel, or to cancel a settled run", async () => {
    for (const status of ["cancelled", "done", "failed"]) {
      grading({ status });
      const res = await read(await call(cancel, "cancel", { id: "run-1" }));
      expect(res.status, status).toBe(409);
      expect(stored(db, "event_runs", "run-1")?.status, status).toBe(status);
      expect(db.rows("grades").filter((g) => g.status === "queued"), status).toHaveLength(2);
    }
  });

  it("does not cancel a grade the worker claimed in the same breath", async () => {
    // The claim loop is one statement and can flip a grade to running between this route's snapshot
    // and its write, so the write re-checks the predicate. Cancelling under a child that is about to
    // land a done report would leave the report on a cancelled row.
    grading();
    interleave(db, "grades", "update", () => {
      db.rows("grades")[0].status = "running";
    });
    await call(cancel, "cancel", { id: "run-1" });
    expect(stored(db, "grades", "g-queued-1")?.status).toBe("running");
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("g-queued-1");
    expect(stored(db, "grades", "g-queued-2")?.status).toBe("cancelled");
  });

  it.fails("counts what it actually dequeued, not what it hoped to", async () => {
    // KNOWN DEFECT (cancel/route.ts:83). `dequeued` is the size of the pre-write snapshot, while the
    // write itself re-checks status and may cancel fewer. The route already reads back the rows it
    // really cancelled (cancelledRows), so the honest number is in hand.
    grading();
    interleave(db, "grades", "update", () => {
      db.rows("grades")[0].status = "running";
    });
    const { body } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(body.dequeued).toBe(1);
  });

  it.fails("stops a run that is still resolving", async () => {
    // KNOWN DEFECT (cancel/route.ts:35). Migration 0024 opens with "an organizer must be able to
    // stop what they started", and the worker's own cancel_run has no status guard. A resolving run
    // holds the account's one live slot for that event (0025), and no other route will release it:
    // refresh refuses a resolving run, POST hands back the same run, and mode refuses it. So a
    // gallery pull that never lands (a dead worker, a blocked Devpost) locks the organizer out of
    // their own event with no way back.
    grading({ status: "resolving" });
    db.store.grades = [];
    const { status } = await read(await call(cancel, "cancel", { id: "run-1" }));
    expect(status).toBe(200);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("cancelled");
  });
});
