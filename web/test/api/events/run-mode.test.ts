import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase, type Row } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { DEFAULTS, ORGANIZER, PAST, SLUG, STRANGER, entry, organizerGrant, run, spyQueries, stored, verifiedClaim } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST } from "@/app/api/events/run/mode/route";

let db: FakeSupabase;
const setMode = (body: unknown) => POST(jsonRequest("https://sloptic.org/api/events/run/mode", body));

/** The invariant 0019's check constraint holds: a non-admin override run may never be active. */
function constraintHolds(): boolean {
  return db.rows("event_runs").every((r) => !r.override || r.mode === "passive" || r.admin);
}

function liveRunCount(): number {
  return db
    .rows("event_runs")
    .filter((r) => ["resolving", "ready", "grading"].includes(String(r.status))).length;
}

function seed(over: Row = {}): void {
  db.store.event_runs = [run({ status: "ready", mode: "passive", ...over })];
  db.store.event_entries = [
    entry({ id: "entry-1", project_url: "https://devpost.com/software/p1", app_url: "https://one.example.com" }),
    entry({ id: "entry-2", project_url: "https://devpost.com/software/p2", app_url: "https://two.example.com", skip_reason: "nothing deployed" }),
  ];
}

/** The full, live authorization for an active event grade: an unexpired account-bound grant plus a
 *  disclosure that predates the submission deadline. */
function authorized(): void {
  db.rows("grants").push(organizerGrant());
  db.rows("event_claims").push(verifiedClaim());
}

beforeEach(() => {
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
  delete process.env.SLOPTIC_ADMIN_ACCOUNTS;
  delete process.env.SLOPTIC_EVENT_OVERRIDE;
});
afterEach(() => {
  resetRouteMocks();
  delete process.env.SLOPTIC_ADMIN_ACCOUNTS;
  delete process.env.SLOPTIC_EVENT_OVERRIDE;
});

describe("POST /api/events/run/mode: the basics", () => {
  it("refuses a caller who is not signed in, before reading anything", async () => {
    setUser(null);
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON, and a body with no run", async () => {
    expect((await read(await POST(malformedRequest("https://sloptic.org/api/events/run/mode")))).status).toBe(400);
    expect((await read(await setMode({ mode: "active" }))).status).toBe(400);
  });

  it("cannot see another account's run", async () => {
    seed({ account_id: STRANGER.id });
    authorized();
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(404);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
    expect(db.rows("event_runs")).toHaveLength(1);
  });

  it("refuses a run that is not ready or done", async () => {
    // Mid-grading a switch would mix two batteries in one ranking (0013), and they rank on
    // different curves.
    for (const status of ["resolving", "grading", "failed", "cancelled"]) {
      seed({ status });
      authorized();
      const res = await read(await setMode({ id: "run-1", mode: "active" }));
      expect(res.status, status).toBe(409);
      expect(stored(db, "event_runs", "run-1")?.mode, status).toBe("passive");
    }
  });

  it("refuses a switch to the mode it already has", async () => {
    seed();
    authorized();
    const { status } = await read(await setMode({ id: "run-1", mode: "passive" }));
    expect(status).toBe(409);
  });
});

describe("POST /api/events/run/mode: a ready run flips in place", () => {
  it("changes the tier and nothing else", async () => {
    seed();
    authorized();
    const { status, body } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ flipped: true, mode: "active" });
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ mode: "active", status: "ready" });
    expect(db.rows("event_runs")).toHaveLength(1);
  });

  it("refuses once anything in the field has been graded", async () => {
    // A board with some entries on 44 checks and others on 102 is two measurements in one column.
    seed();
    authorized();
    db.rows("event_entries")[0].grade_id = "g-1";
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(409);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
  });

  it("lets a downgrade to passive through without a grant, which is the safe direction", async () => {
    seed({ mode: "active" });
    const { status } = await read(await setMode({ id: "run-1", mode: "passive" }));
    expect(status).toBe(200);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
  });

  it("treats anything but the exact string 'active' as passive", async () => {
    seed({ mode: "active" });
    const { body } = await read(await setMode({ id: "run-1", mode: "ACTIVE" }));
    expect(body.mode).toBe("passive");
  });
});

describe("POST /api/events/run/mode: going active re-checks authorization", () => {
  it("refuses without a claim verified before the deadline", async () => {
    seed();
    db.rows("grants").push(organizerGrant());
    db.rows("event_claims").push(verifiedClaim({ window_open_at_verification: false }));
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(409);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
  });

  it("refuses on somebody else's claim", async () => {
    seed();
    db.rows("grants").push(organizerGrant());
    db.rows("event_claims").push(verifiedClaim({ account_id: STRANGER.id }));
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(409);
  });

  it("keeps an override run passive for everyone but an operator", async () => {
    seed({ override: true });
    authorized();
    const { status, body } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(409);
    expect(String(body.error)).toMatch(/override run stays passive/);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
  });

  // The same authority /api/events/run answers at: without this the two routes disagreed about who
    // may reach the attack battery.
  it("refuses when the account no longer holds a live grant", async () => {
    // KNOWN DEFECT (mode/route.ts:48 to 78). The route reads the grant and then never tests it: the
    // only gates it applies are the claim window and the override rule, so an account whose grant
    // expired, was revoked, or never existed still takes a run active. Its own doc comment says
    // "the same gate as starting a run", and POST /api/events/run answers 403 here. CLAUDE.md:
    // active probing is gated on an account-bound grant, re-verified before an active grade.
    seed();
    db.rows("grants").push(organizerGrant({ expires_at: PAST }));
    db.rows("event_claims").push(verifiedClaim());
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(403);
    expect(stored(db, "event_runs", "run-1")?.mode).toBe("passive");
  });

  it.fails("records the privilege the switch was made under", async () => {
    // KNOWN DEFECT (mode/route.ts:93 and 105 to 120). An operator may take an override run active,
    // but neither path writes admin = true: the in-place flip updates mode alone, and the fork
    // copies the source run's admin flag. Both leave override = true with mode = 'active' and
    // admin = false, which migration 0019's check constraint (not override or mode = 'passive' or
    // admin) rejects outright, so the switch fails with a 500 in production and the row would
    // misreport who authorized it if it ever landed.
    process.env.SLOPTIC_ADMIN_ACCOUNTS = ORGANIZER.email;
    for (const status of ["ready", "done"]) {
      db.store.event_runs = [];
      seed({ status, override: true, admin: false });
      await setMode({ id: "run-1", mode: "active" });
      expect(constraintHolds(), status).toBe(true);
    }
  });
});

describe("POST /api/events/run/mode: a finished run forks", () => {
  beforeEach(() => {
    seed({ status: "done", finished_at: "2026-01-03T00:00:00.000Z" });
    db.rows("event_entries")[0].grade_id = "g-1";
    authorized();
  });

  it("starts a fresh run on the same field, with no grades carried over", async () => {
    const log = spyQueries(db);
    const { status, body } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(200);
    const created = String(body.created);
    expect(stored(db, "event_runs", created)).toMatchObject({
      account_id: ORGANIZER.id,
      slug: SLUG,
      mode: "active",
      status: "ready",
    });

    // Checked at the query rather than in the store: the copy is written as
    // { run_id: created.id, ...entry }, so the ONLY thing keeping the old run's id and grade links
    // out of the new field is the projection this select asks for. The fake does not project
    // columns, so the store cannot show the difference, but the column list can.
    const readField = log.find((q) => q.table === "event_entries" && q.kind === "select");
    expect(readField?.columns).not.toMatch(/grade_id/);
    expect(readField?.columns).not.toMatch(/run_id/);

    const copy = log.find((q) => q.table === "event_entries" && q.kind === "insert");
    expect(copy?.payload).toHaveLength(2);
    // The skip decisions travel: an entry the resolver screened out is still screened out.
    expect(copy?.payload.find((e) => e.project_url === "https://devpost.com/software/p2")?.skip_reason)
      .toBe("nothing deployed");
    expect(db.rows("event_entries")).toHaveLength(4);
  });

  it("leaves the old board exactly as it was", async () => {
    await setMode({ id: "run-1", mode: "active" });
    expect(stored(db, "event_runs", "run-1")).toMatchObject({ status: "done", mode: "passive" });
    expect(stored(db, "event_entries", "entry-1")?.grade_id).toBe("g-1");
  });

  it("does not fork a second live run onto an event that already has one", async () => {
    db.rows("event_runs").push(run({ id: "run-2", status: "grading" }));
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBeGreaterThanOrEqual(400);
    expect(liveRunCount()).toBe(1);
  });

  it.fails("does not leave a live run standing when the field could not be copied", async () => {
    // KNOWN DEFECT (mode/route.ts:105 to 131). The new run is inserted first and the entries second,
    // with no transaction and no cleanup, so a failed copy leaves a live, empty run: it holds the
    // event's one live slot (0025), and confirming it would grade a field of nothing while the
    // organizer reads it as the field. 0013 on partial fields: an organizer ranking 40 of 60 entries
    // without being told is worse than no board at all.
    db.failures.push({ table: "event_entries", kind: "insert", error: { code: "XX000", message: "down" } });
    const { status } = await read(await setMode({ id: "run-1", mode: "active" }));
    expect(status).toBe(500);
    expect(liveRunCount()).toBe(0);
  });
});
