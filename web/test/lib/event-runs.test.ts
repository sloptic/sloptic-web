import { describe, it, expect, beforeEach, vi } from "vitest";

// The compaction is module-private, so the only door to it is runsForAccount. The stub stands in for
// the query alone: what these tests are about is the row shape PostgREST hands back and the compact
// field the browser is given in its place, not the filters (another suite owns those).
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit"]) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ data: db.rows, error: null }).then(res, rej);
  return { supabaseAdmin: () => q };
});

const { runsForAccount } = await import("@/lib/event-runs");

/** A run row as the select in RUN_SELECT would return it, with only the differences spelled out. */
function runRow(extra: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    slug: "some-hackathon",
    mode: "passive",
    status: "grading",
    override: false,
    admin: false,
    priority: null,
    entries_found: 12,
    gallery_complete: true,
    detail: null,
    created_at: "2026-09-01T00:00:00Z",
    resolved_at: "2026-09-01T00:05:00Z",
    paused: false,
    refresh_new_submissions: null,
    refresh_modified_submissions: null,
    event_entries: [],
    ...extra,
  };
}

function entry(extra: Record<string, unknown> = {}) {
  return {
    project_url: "https://devpost.com/software/thing",
    app_url: "https://thing.example",
    skip_reason: null,
    grade_id: "grade-1",
    ...extra,
  };
}

function grade(extra: Record<string, unknown> = {}) {
  return {
    status: "done",
    progress: { done: 44, total: 44 },
    claimed_at: "2026-09-01T00:06:00Z",
    finished_at: "2026-09-01T00:08:00Z",
    retry_due_at: null,
    retry_passes: 0,
    ...extra,
  };
}

const first = async () => (await runsForAccount("acct-1"))[0];
const firstGrade = async () => (await first()).event_entries[0].grades as Record<string, unknown>;

beforeEach(() => {
  db.rows = [];
});

describe("compacting a run row", () => {
  it("carries the run's own fields through unchanged", async () => {
    db.rows = [runRow({ mode: "active", status: "done", detail: "resolved" })];
    const run = await first();
    expect(run).toMatchObject({
      id: "run-1",
      slug: "some-hackathon",
      mode: "active",
      status: "done",
      detail: "resolved",
      entries_found: 12,
      gallery_complete: true,
    });
  });

  it("reads a run with no entries as an empty field, not a missing one", async () => {
    // A run is created before it has resolved anything, so this is the first shape the page sees.
    db.rows = [runRow({ event_entries: null })];
    expect((await first()).event_entries).toEqual([]);
  });

  it("keeps a partial gallery as false rather than collapsing it to unknown", async () => {
    // gallery_complete false means devpost.submissions raised Blocked partway. Presenting that as
    // null (never checked) is the exact "could not check" to "nothing there" slip the tri-state
    // exists to prevent.
    db.rows = [runRow({ gallery_complete: false })];
    expect((await first()).gallery_complete).toBe(false);
  });

  it("keeps a zero entry count and a zero priority, which both mean something", async () => {
    // priority 0 is the front of the queue, not the absence of a priority, and entries_found 0 is a
    // resolved but empty gallery.
    db.rows = [runRow({ entries_found: 0, priority: 0 })];
    const run = await first();
    expect(run.entries_found).toBe(0);
    expect(run.priority).toBe(0);
  });

  it("defaults a row written before the pause column existed to not paused", async () => {
    // Migration 0024 added paused with a NOT NULL default, but a select against an older database
    // returns the row without the key at all.
    const { paused: _p, ...older } = runRow();
    db.rows = [older];
    expect((await first()).paused).toBe(false);
  });

  it("treats only a literal true as paused, override or admin", async () => {
    // These three gate what a run may do (an admin override is the one thing that can send the
    // active battery), so anything less than an explicit true has to read as false.
    db.rows = [runRow({ paused: "true", override: "yes", admin: 1 })];
    const run = await first();
    expect(run).toMatchObject({ paused: false, override: false, admin: false });
  });

  it("falls back to the weaker battery and the earliest status when a row omits them", async () => {
    db.rows = [runRow({ mode: undefined, status: undefined })];
    const run = await first();
    expect(run.mode).toBe("passive");
    expect(run.status).toBe("resolving");
  });

  it("compacts every row it is given, not just the first", async () => {
    db.rows = [runRow({ id: "a" }), runRow({ id: "b" })];
    expect((await runsForAccount("acct-1")).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("compacting a grade row", () => {
  it("reads the embedded grade whether it arrives as an object or an array", async () => {
    db.rows = [runRow({ event_entries: [entry({ grades: grade() })] })];
    const asObject = await firstGrade();
    db.rows = [runRow({ event_entries: [entry({ grades: [grade()] })] })];
    expect(await firstGrade()).toEqual(asObject);
  });

  it("leaves an entry with no grade as null", async () => {
    // An entry is written when the field resolves, before any grade exists for it, and a skipped
    // entry never gets one at all.
    db.rows = [
      runRow({
        event_entries: [entry({ grade_id: null, grades: null, skip_reason: "nothing deployed" })],
      }),
    ];
    const e = (await first()).event_entries[0];
    expect(e.grades).toBeNull();
    expect(e.skip_reason).toBe("nothing deployed");
  });

  it("never ships the heavy jsonb the browser polls past", async () => {
    // A 110-entry field polled every few seconds should carry kilobytes, not tens of them per
    // grade, so the ranking and the blocked probe list are read here and dropped.
    db.rows = [
      runRow({
        event_entries: [
          entry({
            grades: grade({
              results: [
                {
                  blocked_probes: ["sec-sqli-001", "sec-xss-001"],
                  retry_blocked_initial: 2,
                  challenge_stage: null,
                  reporting: { status: "completed", why: ["a long explanation"] },
                },
              ],
            }),
          }),
        ],
      }),
    ];
    const g = await firstGrade();
    expect(Object.keys(g).sort()).toEqual(
      ["claimed_at", "finished_at", "marks", "progress", "retry_due_at", "retry_passes", "status"].sort()
    );
    expect(JSON.stringify(g)).not.toContain("sec-sqli-001");
  });

  it("reads the marks from a results row that arrives as a bare object", async () => {
    db.rows = [
      runRow({
        event_entries: [
          entry({
            grades: grade({
              retry_passes: 1,
              results: { blocked_probes: [], retry_blocked_initial: 6 },
            }),
          }),
        ],
      }),
    ];
    expect((await firstGrade()).marks).toMatchObject({ full: true, partial: false, none: false });
  });

  it("marks a partial recovery from what is still blocked", async () => {
    db.rows = [
      runRow({
        event_entries: [
          entry({
            grades: grade({
              retry_passes: 1,
              results: [{ blocked_probes: ["a", "b"], retry_blocked_initial: 6 }],
            }),
          }),
        ],
      }),
    ];
    expect((await firstGrade()).marks).toMatchObject({ partial: true, full: false, none: false });
  });

  it("marks a booked pass ahead of any recovery letter", async () => {
    db.rows = [
      runRow({
        event_entries: [
          entry({
            grades: grade({
              retry_due_at: "2026-09-01T00:20:00Z",
              retry_passes: 1,
              results: [{ blocked_probes: ["a"], retry_blocked_initial: 6 }],
            }),
          }),
        ],
      }),
    ];
    const marks = (await firstGrade()).marks as Record<string, boolean>;
    expect(marks.retry).toBe(true);
    expect([marks.none, marks.partial, marks.full]).toEqual([false, false, false]);
  });

  it("marks limited engagement from the grader's reporting bundle", async () => {
    db.rows = [
      runRow({
        event_entries: [entry({ grades: grade({ results: [{ reporting: { status: "limited_engagement" } }] }) })],
      }),
    ];
    expect((await firstGrade()).marks).toMatchObject({ limited: true });
  });

  it("marks limited engagement when a challenge cut the battery short", async () => {
    // sloptic/eligibility.py calls challenge_stage "limited" a limited battery, and one L covers
    // both causes: a small surface, or a challenge that stopped the run.
    db.rows = [
      runRow({ event_entries: [entry({ grades: grade({ results: [{ challenge_stage: "limited" }] }) })] }),
    ];
    expect((await firstGrade()).marks).toMatchObject({ limited: true });
  });

  it("marks nothing on a completed grade nothing blocked", async () => {
    db.rows = [
      runRow({
        event_entries: [
          entry({ grades: grade({ results: [{ blocked_probes: [], reporting: { status: "completed" } }] }) }),
        ],
      }),
    ];
    expect((await firstGrade()).marks).toEqual({
      retry: false,
      none: false,
      partial: false,
      full: false,
      limited: false,
    });
  });

  it("survives a grade whose results row is gone or was never written", async () => {
    // A queued grade has no results row yet, and the retention sweep deletes one from under an
    // unclaimed grade. Neither may take the field down.
    for (const results of [undefined, null, []]) {
      db.rows = [runRow({ event_entries: [entry({ grades: grade({ status: "queued", results }) })] })];
      const g = await firstGrade();
      expect(g.status).toBe("queued");
      expect(g.marks).toMatchObject({ retry: false, none: false, partial: false, full: false });
    }
  });

  it("defaults a missing pass count to zero rather than letting it read as a recovery", async () => {
    db.rows = [
      runRow({
        event_entries: [
          entry({ grades: grade({ retry_passes: null, results: [{ retry_blocked_initial: 4 }] }) }),
        ],
      }),
    ];
    const g = await firstGrade();
    expect(g.retry_passes).toBe(0);
    expect(g.marks).toMatchObject({ none: false, partial: false, full: false });
  });

  it("keeps the progress the worker last wrote, and null once it is cleared", async () => {
    db.rows = [runRow({ event_entries: [entry({ grades: grade({ progress: null }) })] })];
    expect((await firstGrade()).progress).toBeNull();
    db.rows = [
      runRow({ event_entries: [entry({ grades: grade({ progress: { done: 3, total: 44, label: "headers" } }) })] }),
    ];
    expect((await firstGrade()).progress).toEqual({ done: 3, total: 44, label: "headers" });
  });
});
