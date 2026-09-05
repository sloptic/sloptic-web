import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase, type Row } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { DEFAULTS, ORGANIZER, STRANGER, entry, grade, run, stored } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
vi.mock("@/lib/egress", () => ({
  egressPrecheck: async (host: string) => (blocked.has(host) ? "That host cannot be graded." : null),
}));

import { POST } from "@/app/api/events/run/grade-one/route";

const blocked = new Set<string>();
let db: FakeSupabase;

const P1 = "https://devpost.com/software/p1";
const P2 = "https://devpost.com/software/p2";
const P3 = "https://devpost.com/software/p3";

const gradeOne = (body: unknown) =>
  POST(jsonRequest("https://sloptic.org/api/events/run/grade-one", body));

const queuedFor = (runId: string) => db.rows("grades").filter((g) => g.event_run_id === runId);

function field(over: Row = {}): void {
  db.store.event_runs = [run({ status: "ready", ...over })];
  db.store.event_entries = [
    entry({ id: "entry-1", project_url: P1, app_url: "https://one.example.com" }),
    entry({ id: "entry-2", project_url: P2, app_url: "https://two.example.com" }),
    entry({ id: "entry-3", project_url: P3, app_url: "https://three.example.com" }),
  ];
}

beforeEach(() => {
  blocked.clear();
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
});
afterEach(() => resetRouteMocks());

describe("POST /api/events/run/grade-one: who may point traffic", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON", async () => {
    const { status } = await read(
      await POST(malformedRequest("https://sloptic.org/api/events/run/grade-one"))
    );
    expect(status).toBe(400);
  });

  it("treats a missing run as no such run", async () => {
    field();
    const { status } = await read(await gradeOne({ projectUrls: [P1] }));
    expect(status).toBe(404);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("cannot see another account's run", async () => {
    field({ account_id: STRANGER.id });
    const { status } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(404);
    expect(db.rows("grades")).toHaveLength(0);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBeNull();
  });

  it("refuses an empty selection", async () => {
    field();
    for (const body of [{ runId: "run-1" }, { runId: "run-1", projectUrls: [] }]) {
      const res = await read(await gradeOne(body));
      expect(res.status).toBe(400);
    }
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("refuses a run that is not ready or grading", async () => {
    for (const status of ["resolving", "done", "failed", "cancelled"]) {
      field({ status });
      const res = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
      expect(res.status, status).toBe(409);
      expect(db.rows("grades"), status).toHaveLength(0);
    }
  });

  it("refuses while the run is paused", async () => {
    field({ status: "grading", paused: true });
    const { status } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(409);
    expect(db.rows("grades")).toHaveLength(0);
  });
});

describe("POST /api/events/run/grade-one: the drip feed", () => {
  it("queues exactly the entries that were ticked", async () => {
    field();
    const { status, body } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1, P3] }));
    expect(status).toBe(200);
    expect(body.queued).toBe(2);
    expect(queuedFor("run-1")).toHaveLength(2);
    expect(stored(db, "event_entries", "entry-2")?.grade_id).toBeNull();
    for (const id of ["entry-1", "entry-3"]) {
      expect(stored(db, "event_entries", id)?.grade_id, id).toBeTruthy();
    }
  });

  it("takes a single projectUrl too, since one is just a list of one", async () => {
    field();
    const { body } = await read(await gradeOne({ runId: "run-1", projectUrl: P2 }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-2")?.grade_id).toBeTruthy();
  });

  it("queues in the run's own tier, lane and account", async () => {
    field({ mode: "active" });
    await gradeOne({ runId: "run-1", projectUrls: [P1] });
    expect(queuedFor("run-1")[0]).toMatchObject({
      status: "queued",
      mode: "active",
      account_id: ORGANIZER.id,
      event_run_id: "run-1",
      origin: "https://one.example.com",
    });
  });

  it("ignores a project that belongs to somebody else's run", async () => {
    // The selection comes from a page the caller controls, so the only thing keeping it inside the
    // run is the run_id filter.
    field();
    db.rows("event_runs").push(run({ id: "run-2", account_id: STRANGER.id, status: "grading" }));
    db.rows("event_entries").push(entry({ id: "theirs", run_id: "run-2", project_url: "https://devpost.com/software/theirs" }));
    const { body } = await read(
      await gradeOne({ runId: "run-1", projectUrls: [P1, "https://devpost.com/software/theirs"] })
    );
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "theirs")?.grade_id).toBeNull();
  });

  it("cannot double-queue from a stale page", async () => {
    field();
    db.rows("event_entries")[0].grade_id = "g-existing";
    db.rows("grades").push(grade({ id: "g-existing", status: "running", event_run_id: "run-1" }));
    const { body } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1, P2] }));
    expect(body.queued).toBe(1);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("g-existing");
  });

  it("never queues an entry the resolver screened out", async () => {
    field();
    db.rows("event_entries")[0].skip_reason = "a vendor surface";
    const { status, body } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(409);
    expect(String(body.error)).toMatch(/Nothing left to grade/);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("marks an unusable link rather than leaving it tickable for ever", async () => {
    field();
    blocked.add("one.example.com");
    db.rows("event_entries")[1].app_url = "not a url";
    const { status, body } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1, P2] }));
    expect(status).toBe(200);
    expect(body.queued).toBe(0);
    expect(stored(db, "event_entries", "entry-1")?.skip_reason).toBe("unusable link");
    expect(stored(db, "event_entries", "entry-2")?.skip_reason).toBe("unusable link");
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("leaves the field unlinked when the insert fails", async () => {
    field();
    db.failures.push({ table: "grades", kind: "insert", error: { code: "XX000", message: "down" } });
    const { status } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(500);
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBeNull();
    expect(stored(db, "event_runs", "run-1")?.status).toBe("ready");
  });
});

describe("POST /api/events/run/grade-one: the run's state", () => {
  it("enters grading on the first one", async () => {
    field();
    await gradeOne({ runId: "run-1", projectUrls: [P1] });
    const after = stored(db, "event_runs", "run-1");
    expect(after?.status).toBe("grading");
    expect(after?.started_at).toBeTruthy();
  });

  it("does not restart the clock on a run already grading", async () => {
    field({ status: "grading", started_at: "2026-01-02T00:00:00.000Z" });
    await gradeOne({ runId: "run-1", projectUrls: [P1] });
    expect(stored(db, "event_runs", "run-1")?.started_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("does not settle a run just because a gap follows", async () => {
    // The long gaps between demos must not read as a finished board: settling is the worker's, from
    // the rows, and only once every gradeable entry has a grade.
    field();
    await gradeOne({ runId: "run-1", projectUrls: [P1] });
    expect(stored(db, "event_runs", "run-1")?.status).toBe("grading");
    expect(stored(db, "event_entries", "entry-2")?.grade_id).toBeNull();
  });
});

describe("POST /api/events/run/grade-one: authorizing the active battery", () => {
  it.fails("refuses to queue active grades for an account with no live grant", async () => {
    // KNOWN DEFECT, the same one as confirm: the drip feed reads the run's mode and queues attack
    // traffic on it without re-reading the grant, so a revoked or expired organizer still points
    // active grades at other people's apps and the worker refuses them one at a time
    // (db.may_grade_actively). CLAUDE.md: active probing is gated on an account-bound grant.
    field({ mode: "active" });
    const { status } = await read(await gradeOne({ runId: "run-1", projectUrls: [P1] }));
    expect(status).toBe(403);
    expect(db.rows("grades")).toHaveLength(0);
  });
});
