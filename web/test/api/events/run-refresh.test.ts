import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { DEFAULTS, ORGANIZER, SLUG, STRANGER, interleave, run, stored } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST } from "@/app/api/events/run/refresh/route";

let db: FakeSupabase;
const refresh = (body: unknown) =>
  POST(jsonRequest("https://sloptic.org/api/events/run/refresh", body));

beforeEach(() => {
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
});
afterEach(() => resetRouteMocks());

describe("POST /api/events/run/refresh", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON, and a body with no run", async () => {
    expect((await read(await POST(malformedRequest("https://sloptic.org/api/events/run/refresh")))).status).toBe(400);
    expect((await read(await refresh({}))).status).toBe(400);
  });

  it("cannot see another account's run", async () => {
    db.store.event_runs = [run({ status: "done", account_id: STRANGER.id })];
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(404);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("done");
  });

  it("re-resolves a run that has settled or is mid-drain", async () => {
    for (const status of ["ready", "grading", "done", "failed"]) {
      db.store.event_runs = [
        run({ status, started_at: "2026-01-02T00:00:00.000Z", finished_at: "2026-01-03T00:00:00.000Z" }),
      ];
      const res = await read(await refresh({ id: "run-1" }));
      expect(res.status, status).toBe(200);
      // started_at is what marks a resolving run as claimed, so clearing it is what makes the worker
      // pick this one up again.
      expect(stored(db, "event_runs", "run-1"), status).toMatchObject({
        status: "resolving",
        started_at: null,
        finished_at: null,
        refresh_requested: true,
      });
    }
  });

  it("refuses a run that is already reading the gallery", async () => {
    db.store.event_runs = [run({ status: "resolving", started_at: "2026-01-02T00:00:00.000Z" })];
    const { status, body } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(409);
    expect(String(body.error)).toMatch(/Already reading/);
    expect(stored(db, "event_runs", "run-1")?.started_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("keeps a cancelled run cancelled", async () => {
    db.store.event_runs = [run({ status: "cancelled", finished_at: "2026-01-03T00:00:00.000Z" })];
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(409);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("cancelled");
  });

  it("refuses while the run is paused, and does not release the hold", async () => {
    // A refresh used to clear paused on its way through, releasing a hold the organizer still
    // believed was in effect.
    db.store.event_runs = [run({ status: "grading", paused: true })];
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(409);
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "grading", paused: true });
  });

  it("refuses when another run of the same event is still live", async () => {
    // A refresh puts a finished run back into resolving, which makes it live. Two live runs on one
    // event grade the field twice and the event page can only steer one of them (0025).
    for (const status of ["resolving", "ready", "grading"]) {
      db.store.event_runs = [
        run({ id: "run-1", status: "done" }),
        run({ id: "run-2", status }),
      ];
      const res = await read(await refresh({ id: "run-1" }));
      expect(res.status, status).toBe(409);
      expect(stored(db, "event_runs", "run-1")?.status, status).toBe("done");
    }
  });

  it("is not blocked by a settled sibling, or by one on another event or account", async () => {
    db.store.event_runs = [
      run({ id: "run-1", status: "done" }),
      run({ id: "settled", status: "cancelled" }),
      run({ id: "other-event", slug: "another-hack", status: "grading" }),
      run({ id: "theirs", account_id: STRANGER.id, status: "grading" }),
    ];
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(200);
    expect(stored(db, "event_runs", "run-1")?.status).toBe("resolving");
  });

  it("does not count itself as its own sibling", async () => {
    db.store.event_runs = [run({ status: "grading" })];
    const { status } = await read(await refresh({ id: "run-1" }));
    expect(status).toBe(200);
  });

  it("leaves the field in place: a refresh is a merge, not a reset", async () => {
    // The worker's save_field keeps graded entries and only drops ones the gallery lost, so the
    // route must not pre-emptively clear anything.
    db.store.event_runs = [run({ status: "done" })];
    db.store.event_entries = [
      { id: "entry-1", run_id: "run-1", project_url: "https://devpost.com/software/p1", app_url: "https://one.example.com", skip_reason: null, grade_id: "g-1" },
    ];
    await refresh({ id: "run-1" });
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("g-1");
  });

  it.fails("loses to a cancel that lands mid-flight", async () => {
    // KNOWN DEFECT (refresh/route.ts:68 to 71). The write is not guarded on the state its check
    // read, unlike confirm's and cancel's, so a cancel arriving between the two resurrects the run
    // into resolving. The route's own doc comment says a cancelled run stays cancelled, and the
    // resurrected run is live again, which is the one-live-run invariant 0025 exists to hold.
    db.store.event_runs = [run({ status: "done" })];
    interleave(db, "event_runs", "update", () => {
      db.rows("event_runs")[0].status = "cancelled";
    });
    await refresh({ id: "run-1" });
    expect(stored(db, "event_runs", "run-1")?.status).toBe("cancelled");
  });

  it("scopes its sibling check to the caller's own account and event", async () => {
    db.store.event_runs = [run({ status: "done" })];
    await refresh({ id: "run-1" });
    const siblingQuery = db.calls.filter((c) => c.table === "event_runs" && c.kind === "select")[1];
    expect(siblingQuery.filters.some((f) => f.column === "account_id" && f.value === ORGANIZER.id)).toBe(true);
    expect(siblingQuery.filters.some((f) => f.column === "slug" && f.value === SLUG)).toBe(true);
  });
});
