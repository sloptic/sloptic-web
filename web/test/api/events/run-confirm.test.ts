import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase, type Row } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { DEFAULTS, ORGANIZER, STRANGER, entry, grade, interleave, organizerGrant, run, stored } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
// The real one resolves DNS. What matters here is the branch, not the resolver.
vi.mock("@/lib/egress", () => ({
  egressPrecheck: async (host: string) => (blocked.has(host) ? "That host cannot be graded." : null),
}));

import { POST } from "@/app/api/events/run/confirm/route";

const blocked = new Set<string>();
let db: FakeSupabase;

const confirm = (body: unknown) =>
  POST(jsonRequest("https://sloptic.org/api/events/run/confirm", body));

const gradesOf = (runId: string) => db.rows("grades").filter((g) => g.event_run_id === runId);

beforeEach(() => {

  // The queueing routes refuse when no worker is running, the same authority /api/grade

  // answers at, so the suite has to open grading before any of them will do anything.

  process.env.GRADING_OPEN = "1";
  blocked.clear();
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
});
afterEach(() => resetRouteMocks());

/** A run the organizer has seen and approved, with a field of `n` gradeable entries. */
function readyField(n: number, over: Row = {}): void {
  db.store.event_runs = [run({ status: "ready", ...over })];
  db.store.event_entries = Array.from({ length: n }, (_, i) =>
    entry({
      id: `entry-${i + 1}`,
      project_url: `https://devpost.com/software/p${i + 1}`,
      app_url: `https://app-${i + 1}.example.com`,
    })
  );
}

describe("POST /api/events/run/confirm: who may authorize", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON", async () => {
    const { status } = await read(
      await POST(malformedRequest("https://sloptic.org/api/events/run/confirm"))
    );
    expect(status).toBe(400);
  });

  it("treats a missing id as no such run", async () => {
    readyField(1);
    const { status } = await read(await confirm({}));
    expect(status).toBe(404);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("cannot see, let alone confirm, another account's run", async () => {
    // Invisible, not merely unmodifiable: 404 is the right answer to a run that is not yours.
    readyField(2, { account_id: STRANGER.id });
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(404);
    expect(db.rows("grades")).toHaveLength(0);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("ready");
  });
});

describe("POST /api/events/run/confirm: which states may queue traffic", () => {
  it("refuses a run that is still resolving, done, failed or cancelled", async () => {
    for (const status of ["resolving", "done", "failed", "cancelled"]) {
      readyField(1, { status });
      const res = await read(await confirm({ id: "run-1" }));
      expect(res.status, status).toBe(409);
      expect(db.rows("grades"), status).toHaveLength(0);
    }
  });

  it("refuses a paused run and queues nothing", async () => {
    // 0024: a pause holds the queue. Adding to it while held is the one thing pause is for.
    readyField(3, { status: "grading", paused: true });
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(409);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("accepts a grading run, so a refresh's new entries can be queued in bulk", async () => {
    readyField(2, { status: "grading" });
    const { status, body } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(200);
    expect(body.queued).toBe(2);
  });
});

describe("POST /api/events/run/confirm: what it queues", () => {
  it("queues one grade per gradeable entry, in the run's own tier and lane", async () => {
    readyField(2);
    const { status, body } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ queued: 2, mode: "passive" });

    const queued = gradesOf("run-1");
    expect(queued).toHaveLength(2);
    for (const g of queued) {
      expect(g).toMatchObject({ status: "queued", mode: "passive", account_id: ORGANIZER.id });
    }
    // Every entry points at its grade, which is also what makes the grade claimable: the worker
    // refuses an event grade with no entry link (db.claim_job).
    const ids = queued.map((g) => g.id);
    expect(db.rows("event_entries").map((e) => e.grade_id).sort()).toEqual([...ids].sort());
  });

  it("grades the origin, not the pasted link", async () => {
    readyField(1);
    db.rows("event_entries")[0].app_url = "https://One.Example.COM:8443/demo?ref=devpost#top";
    await confirm({ id: "run-1" });
    expect(gradesOf("run-1")[0]).toMatchObject({
      origin: "https://one.example.com:8443",
      submitted_url: "https://One.Example.COM:8443/demo?ref=devpost#top",
    });
  });

  it("carries the run's active tier onto its grades", async () => {
    readyField(1, { mode: "active" });
    db.rows("grants").push(organizerGrant());
    await confirm({ id: "run-1" });
    expect(gradesOf("run-1")[0].mode).toBe("active");
  });

  it("never queues an entry the resolver screened out", async () => {
    readyField(2);
    db.rows("event_entries")[0].skip_reason = "asked to be left out";
    const { body } = await read(await confirm({ id: "run-1" }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBeNull();
  });

  it("never queues an entry that already has a grade", async () => {
    readyField(2);
    db.rows("event_entries")[0].grade_id = "grade-old";
    db.rows("grades").push(grade({ id: "grade-old", status: "running", event_run_id: "run-1" }));
    const { body } = await read(await confirm({ id: "run-1" }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("grade-old");
  });

  it("only ever touches its own run's field", async () => {
    readyField(1);
    db.rows("event_runs").push(run({ id: "run-2", status: "ready" }));
    db.rows("event_entries").push(entry({ id: "other-entry", run_id: "run-2" }));
    await confirm({ id: "run-1" });
    expect(stored(db, "event_entries", "other-entry")?.grade_id).toBeNull();
    expect(stored(db, "event_runs", "run-2")?.status).toBe("ready");
  });

  it("says so rather than queueing nothing quietly", async () => {
    readyField(1);
    db.rows("event_entries")[0].grade_id = "grade-old";
    const { status, body } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(409);
    expect(String(body.error)).toMatch(/Nothing left to grade/);
  });

  it("holds a ceiling on one run", async () => {
    // A mistake must not be able to enqueue thousands at other people's apps.
    readyField(700);
    const { body } = await read(await confirm({ id: "run-1" }));
    expect(body.queued).toBe(600);
  });

  it("flips the run into grading and clears nothing else", async () => {
    readyField(1);
    await confirm({ id: "run-1" });
    const after = stored(db, "event_runs", "run-1");
    expect(after?.status).toBe("grading");
    expect(after?.started_at).toBeTruthy();
  });
});

describe("POST /api/events/run/confirm: links that cannot be graded", () => {
  it("marks an unusable link instead of queueing it", async () => {
    readyField(2);
    db.rows("event_entries")[0].app_url = "not a url";
    const { body } = await read(await confirm({ id: "run-1" }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.skip_reason).toBe("unusable link");
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBeNull();
  });

  it("marks a host the egress gate refuses, and queues nothing for it", async () => {
    // CLAUDE.md: every outbound fetch is sandboxed. An internal address must not reach the queue.
    readyField(2);
    blocked.add("app-1.example.com");
    const { body } = await read(await confirm({ id: "run-1" }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.skip_reason).toBe("unusable link");
    expect(gradesOf("run-1")).toHaveLength(1);
  });

  it("refuses the whole confirm when nothing in the field can be graded", async () => {
    readyField(2);
    blocked.add("app-1.example.com");
    blocked.add("app-2.example.com");
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(409);
    expect(db.rows("grades")).toHaveLength(0);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("ready");
  });

  it("leaves the field untouched when the insert fails", async () => {
    // Half a field queued with no links written is worse than none: the worker will not claim a
    // grade with no entry, and the organizer sees a board that never moves.
    readyField(2);
    db.failures.push({ table: "grades", kind: "insert", error: { code: "XX000", message: "down" } });
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(500);
    expect(db.rows("event_entries").every((e) => e.grade_id === null)).toBe(true);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("ready");
  });
});

describe("POST /api/events/run/confirm: regrade", () => {
  beforeEach(() => {
    readyField(3, { status: "grading" });
  });

  it("re-queues entries whose grade has finished, and repoints the entry at the new one", async () => {
    db.rows("event_entries")[0].grade_id = "g-done";
    db.rows("grades").push(grade({ id: "g-done", status: "done", event_run_id: "run-1" }));
    db.rows("event_entries")[1].grade_id = "g-failed";
    db.rows("grades").push(grade({ id: "g-failed", status: "failed", event_run_id: "run-1" }));

    const { body } = await read(await confirm({ id: "run-1", regrade: true }));
    expect(body.queued).toBe(3);
    const first = stored(db, "event_entries", "entry-1")?.grade_id;
    expect(first).not.toBe("g-done");
    // The old report keeps its own link, it is just no longer the board's.
    expect(stored(db, "grades", "g-done")?.status).toBe("done");
  });

  it("never double-queues an entry whose grade is still queued or running", async () => {
    // Two batteries at one app is twice the traffic and twice the budget for one board row.
    db.rows("event_entries")[0].grade_id = "g-running";
    db.rows("grades").push(grade({ id: "g-running", status: "running", event_run_id: "run-1" }));
    db.rows("event_entries")[1].grade_id = "g-queued";
    db.rows("grades").push(grade({ id: "g-queued", status: "queued", event_run_id: "run-1" }));

    const { body } = await read(await confirm({ id: "run-1", regrade: true }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("g-running");
    expect(stored(db, "event_entries", "entry-2")?.grade_id).toBe("g-queued");
  });

  it("kills the superseded grade's booked retry", async () => {
    // Nothing displays that report any more, so recovering its blocked tail would spend the field's
    // budget re-firing at an app no entry points at.
    db.rows("event_entries")[0].grade_id = "g-done";
    db.rows("grades").push(
      grade({ id: "g-done", status: "done", event_run_id: "run-1", retry_due_at: "2026-03-01T00:00:00.000Z" })
    );
    await confirm({ id: "run-1", regrade: true });
    expect(stored(db, "grades", "g-done")?.retry_due_at).toBeNull();
  });

  it("says there is nothing to regrade rather than queueing the field again", async () => {
    db.store.event_entries = [entry({ id: "entry-1", grade_id: "g-running" })];
    db.rows("grades").push(grade({ id: "g-running", status: "running", event_run_id: "run-1" }));
    const { status, body } = await read(await confirm({ id: "run-1", regrade: true }));
    expect(status).toBe(409);
    expect(String(body.error)).toMatch(/Nothing to regrade/);
  });
});

describe("POST /api/events/run/confirm: races", () => {
  it("loses to a cancel that lands mid-flight", async () => {
    // The flip is guarded on the state the check read, so an organizer's stop wins the tie.
    readyField(2);
    interleave(db, "grades", "insert", () => {
      db.rows("event_runs")[0].status = "cancelled";
    });
    await confirm({ id: "run-1" });
    expect(stored(db, "event_runs", "run-1")?.status).toBe("cancelled");
  });

  it.fails("does not release a pause that landed while it was working", async () => {
    // KNOWN DEFECT (confirm/route.ts:149). The confirm writes paused: false unconditionally, so a
    // hold placed after its own paused check is silently released and the worker starts claiming
    // again. The same bug was fixed in refresh ("the hold outranks the refresh"); the write here
    // should either not touch paused at all, having already refused a paused run, or be guarded on
    // it the way the status is.
    readyField(2);
    interleave(db, "event_entries", "select", () => {
      db.rows("event_runs")[0].paused = true;
    });
    await confirm({ id: "run-1" });
    expect(stored(db, "event_runs", "run-1")?.paused).toBe(true);
  });
});

describe("POST /api/events/run/confirm: authorizing the active battery", () => {
  it.fails("refuses to queue active grades for an account with no live grant", async () => {
    // KNOWN DEFECT (confirm/route.ts:24 onward). Confirm is the authorization step by its own doc
    // comment, and it is the only place between the grant check at create time and the traffic
    // itself. It re-reads nothing: a grant expired or revoked while the run sat ready still queues a
    // field of active grades, which the worker then refuses one by one (db.may_grade_actively), so
    // the organizer's board fills with "not authorized to grade actively" instead of a refusal here.
    // CLAUDE.md: grants are time boxed and re-verified before an active grade.
    readyField(2, { mode: "active" });
    const { status } = await read(await confirm({ id: "run-1" }));
    expect(status).toBe(403);
    expect(db.rows("grades")).toHaveLength(0);
  });
});
