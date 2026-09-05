import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, getRequest, read } from "../../helpers/route";
import { DEFAULTS, FUTURE, ORGANIZER, PAST, SLUG, STRANGER, interleave, organizerGrant, run, verifiedClaim } from "./_fixtures";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST, GET } from "@/app/api/events/run/route";

let db: FakeSupabase;

/** The invariant migration 0025 states, checked against the table rather than against a response:
 *  at most one run per (account, event) may be in a live state. */
function liveRuns(account: string, slug: string) {
  return db
    .rows("event_runs")
    .filter(
      (r) =>
        r.account_id === account &&
        r.slug === slug &&
        ["resolving", "ready", "grading"].includes(String(r.status))
    );
}

beforeEach(() => {
  db = fakeDb({ uniques: [ONE_LIVE_RUN], defaults: DEFAULTS });
  setDb(db);
  setUser(ORGANIZER);
  delete process.env.SLOPTIC_EVENT_OVERRIDE;
  delete process.env.SLOPTIC_ADMIN_ACCOUNTS;
});
afterEach(() => {
  resetRouteMocks();
  delete process.env.SLOPTIC_EVENT_OVERRIDE;
  delete process.env.SLOPTIC_ADMIN_ACCOUNTS;
});

const post = (body: unknown) => POST(jsonRequest("https://sloptic.org/api/events/run", body));

describe("POST /api/events/run: refusing before doing anything", () => {
  it("refuses a caller who is not signed in, without reading the database", async () => {
    setUser(null);
    const { status } = await read(await post({ event: SLUG }));
    expect(status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a body that is not JSON", async () => {
    const { status } = await read(await POST(malformedRequest("https://sloptic.org/api/events/run")));
    expect(status).toBe(400);
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("refuses a missing event", async () => {
    const { status, body } = await read(await post({}));
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/Devpost address/);
  });

  it("refuses a host that only looks like Devpost", async () => {
    // The slug becomes a hostname the worker fetches, so a suffix match on the wrong boundary is a
    // fetch at someone else's server.
    for (const event of ["evil-devpost.com", "hacknight.devpost.com.attacker.net", "devpost", "www"]) {
      const { status } = await read(await post({ event }));
      expect(status, event).toBe(400);
    }
    expect(db.rows("event_runs")).toHaveLength(0);
  });
});

describe("POST /api/events/run: the grant is account bound", () => {
  it("refuses an account with no grant at all", async () => {
    const { status, body } = await read(await post({ event: SLUG }));
    expect(status).toBe(403);
    expect(String(body.error)).toMatch(/Verify/);
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("refuses when the only grant for this event belongs to somebody else", async () => {
    // CLAUDE.md: a verified event is never globally open. Someone else's proof authorizes them.
    db.rows("grants").push(organizerGrant({ account_id: STRANGER.id }));
    const { status } = await read(await post({ event: SLUG }));
    expect(status).toBe(403);
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("refuses an expired grant, a revoked one, and one for a different event or kind", async () => {
    const cases = [
      organizerGrant({ id: "g-expired", expires_at: PAST }),
      organizerGrant({ id: "g-revoked", revoked_at: "2026-02-02T00:00:00.000Z" }),
      organizerGrant({ id: "g-elsewhere", scope: "another-event" }),
      organizerGrant({ id: "g-wrong-kind", kind: "app_origin" }),
    ];
    for (const g of cases) {
      db.store.grants = [g];
      const { status } = await read(await post({ event: SLUG }));
      expect(status, String(g.id)).toBe(403);
    }
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("starts a passive run for a live grant, owned by the caller", async () => {
    db.rows("grants").push(organizerGrant());
    const { status, body } = await read(await post({ event: `https://${SLUG}.devpost.com/` }));
    expect(status).toBe(201);
    expect(body.existing).toBe(false);
    const created = db.rows("event_runs")[0];
    expect(created).toMatchObject({
      account_id: ORGANIZER.id,
      slug: SLUG,
      mode: "passive",
      status: "resolving",
      override: false,
      admin: false,
    });
  });
});

describe("POST /api/events/run: passive by default", () => {
  beforeEach(() => {
    db.rows("grants").push(organizerGrant());
  });

  it("treats anything but the exact string 'active' as passive", async () => {
    for (const mode of ["ACTIVE", "aggressive", true, 1, null, undefined]) {
      db.store.event_runs = [];
      const { status } = await read(await post({ event: SLUG, mode }));
      expect(status, String(mode)).toBe(201);
      expect(db.rows("event_runs")[0].mode, String(mode)).toBe("passive");
    }
  });

  it("refuses active when the event was not verified before its deadline", async () => {
    db.rows("event_claims").push(verifiedClaim({ window_open_at_verification: false }));
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(409);
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("refuses active when there is no verified claim at all", async () => {
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(409);
    expect(db.rows("event_runs")).toHaveLength(0);
  });

  it("refuses active on somebody else's verified claim", async () => {
    db.rows("event_claims").push(verifiedClaim({ account_id: STRANGER.id }));
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(409);
  });

  it("refuses active on a claim that is not verified yet", async () => {
    db.rows("event_claims").push(verifiedClaim({ status: "pending" }));
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(409);
  });

  it("allows active for a live grant plus a claim verified inside the window", async () => {
    db.rows("event_claims").push(verifiedClaim());
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(201);
    expect(db.rows("event_runs")[0].mode).toBe("active");
  });
});

describe("POST /api/events/run: override and admin", () => {
  it("gives a plain override account a passive run whatever it asked for", async () => {
    // 0014's check constraint says the same thing: not override or mode = 'passive'.
    process.env.SLOPTIC_EVENT_OVERRIDE = ORGANIZER.email;
    db.rows("event_claims").push(verifiedClaim());
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(201);
    expect(db.rows("event_runs")[0]).toMatchObject({ mode: "passive", override: true, admin: false });
  });

  it("lets operator admin start an active run without a claim, and records it as an admin run", async () => {
    process.env.SLOPTIC_ADMIN_ACCOUNTS = ORGANIZER.email.toUpperCase();
    const { status } = await read(await post({ event: SLUG, mode: "active" }));
    expect(status).toBe(201);
    expect(db.rows("event_runs")[0]).toMatchObject({ mode: "active", override: true, admin: true });
  });

  it("never writes a run that 0019's constraint would reject", async () => {
    process.env.SLOPTIC_EVENT_OVERRIDE = ORGANIZER.email;
    process.env.SLOPTIC_ADMIN_ACCOUNTS = ORGANIZER.email;
    await post({ event: SLUG, mode: "active" });
    for (const r of db.rows("event_runs")) {
      expect(!r.override || r.mode === "passive" || r.admin).toBe(true);
    }
  });
});

describe("POST /api/events/run: one live run per event per account", () => {
  beforeEach(() => {
    db.rows("grants").push(organizerGrant());
  });

  it("hands back the run already in flight instead of starting a second one", async () => {
    for (const status of ["resolving", "ready", "grading"]) {
      db.store.event_runs = [run({ id: `run-${status}`, status })];
      const res = await read(await post({ event: SLUG }));
      expect(res.status, status).toBe(200);
      expect(res.body.existing, status).toBe(true);
      expect(liveRuns(ORGANIZER.id, SLUG), status).toHaveLength(1);
    }
  });

  it("starts a fresh run once the last one settled", async () => {
    for (const status of ["done", "failed", "cancelled"]) {
      db.store.event_runs = [run({ id: `run-${status}`, status })];
      const res = await read(await post({ event: SLUG }));
      expect(res.status, status).toBe(201);
      expect(liveRuns(ORGANIZER.id, SLUG), status).toHaveLength(1);
    }
  });

  it("is not blocked by somebody else's live run on the same event", async () => {
    db.store.event_runs = [run({ id: "theirs", account_id: STRANGER.id, status: "grading" })];
    const { status, body } = await read(await post({ event: SLUG }));
    expect(status).toBe(201);
    expect(body.existing).toBe(false);
  });

  it("is not blocked by this account's live run on a different event", async () => {
    db.store.event_runs = [run({ id: "other-event", slug: "another-hack", status: "grading" })];
    const { status } = await read(await post({ event: SLUG }));
    expect(status).toBe(201);
  });

  it("does not breed a third run when duplicates already exist", async () => {
    // The reason the check is not maybeSingle(): PGRST116 hands back a null row, which reads as
    // "nothing live" and starts another. One duplicate would then become many.
    db.store.event_runs = [
      run({ id: "dup-a", status: "grading", created_at: "2026-01-01T00:00:00.000Z" }),
      run({ id: "dup-b", status: "grading", created_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const { status, body } = await read(await post({ event: SLUG }));
    expect(status).toBe(200);
    expect((body.run as { id: string }).id).toBe("dup-a");
    expect(db.rows("event_runs")).toHaveLength(2);
  });

  it("loses the insert race gracefully: the winner is returned, not a 500", async () => {
    // Two tabs, one event. The check passes in both, then the partial unique index decides.
    interleave(db, "event_runs", "insert", () => {
      db.rows("event_runs").push(run({ id: "won-the-race", status: "resolving" }));
    });
    const { status, body } = await read(await post({ event: SLUG }));
    expect(status).toBe(200);
    expect(body.existing).toBe(true);
    expect((body.run as { id: string }).id).toBe("won-the-race");
    expect(liveRuns(ORGANIZER.id, SLUG)).toHaveLength(1);
  });
});

describe("GET /api/events/run", () => {
  beforeEach(() => {
    db.relations = [{ parent: "event_runs", child: "event_entries", foreignKey: "run_id" }];
  });

  it("returns an empty list for a caller who is not signed in", async () => {
    setUser(null);
    const { status, body } = await read(await GET(getRequest("https://sloptic.org/api/events/run")));
    expect(status).toBe(200);
    expect(body.runs).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it("lists only the caller's own runs", async () => {
    db.store.event_runs = [
      run({ id: "mine", status: "grading" }),
      run({ id: "theirs", account_id: STRANGER.id, status: "grading" }),
    ];
    const { body } = await read(await GET(getRequest("https://sloptic.org/api/events/run")));
    expect((body.runs as { id: string }[]).map((r) => r.id)).toEqual(["mine"]);
  });

  it("narrows to one event when a slug is given", async () => {
    db.store.event_runs = [run({ id: "mine" }), run({ id: "elsewhere", slug: "another-hack" })];
    const { body } = await read(
      await GET(getRequest("https://sloptic.org/api/events/run?slug=another-hack"))
    );
    expect((body.runs as { id: string }[]).map((r) => r.id)).toEqual(["elsewhere"]);
  });

  it("reports a read failure rather than an empty field", async () => {
    // An empty list would read as "this account has no runs", which is a different statement.
    db.failures.push({ table: "event_runs", error: { code: "XX000", message: "down" } });
    const { status } = await read(await GET(getRequest("https://sloptic.org/api/events/run")));
    expect(status).toBe(500);
  });
});

describe("POST /api/events/run: what the response promises", () => {
  it("does not let a stale expiry pass: the grant is filtered by expires_at, not read and trusted", async () => {
    db.rows("grants").push(organizerGrant({ expires_at: FUTURE }));
    await post({ event: SLUG });
    const grantQuery = db.calls.find((c) => c.table === "grants");
    expect(grantQuery?.filters.some((f) => f.column === "expires_at" && f.op === "gt")).toBe(true);
    expect(grantQuery?.filters.some((f) => f.column === "account_id" && f.value === ORGANIZER.id)).toBe(true);
  });
});
