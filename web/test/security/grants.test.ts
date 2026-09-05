/** The grant gate: who may start an event run, and who may point the ACTIVE battery at a field.
 *
 *  The rule these tests are written from (CLAUDE.md, "Domain-ownership verification") is one
 *  sentence: the grant is ACCOUNT-BOUND, and a verified scope is NEVER globally open. So every case
 *  here asks the question the code must be asking, "may THIS account actively grade THIS scope",
 *  and none of them may ever be satisfiable by "someone verified this scope".
 *
 *  The second rule is liveness: a grant is time-boxed and re-checked before an active grade, so an
 *  expired or revoked grant authorizes exactly nothing, whatever else is still on file.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fakeDb, ONE_LIVE_RUN, type FakeSupabase } from "../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
// The run route reads the resolved field back through this helper, which opens its own client.
vi.mock("@/lib/event-runs", () => ({ runsForAccount: async () => [] }));

import { POST as startRun } from "@/app/api/events/run/route";
import { POST as setMode } from "@/app/api/events/run/mode/route";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };
const SLUG = "alices-hack";

const YEAR_AWAY = "2099-01-01T00:00:00.000Z";
const LONG_GONE = "2020-01-01T00:00:00.000Z";

const DEFAULTS = {
  event_runs: { status: "resolving", override: false, admin: false, paused: false },
  event_claims: { status: "pending" },
};

type GrantSeed = { account_id: string; scope: string; expires_at: string; revoked_at?: string | null; kind?: string };
type ClaimSeed = { account_id: string; slug: string; status: string; window_open_at_verification: boolean | null };
type RunSeed = Record<string, unknown>;

function db({ grants = [], claims = [], runs = [], entries = [] }: {
  grants?: GrantSeed[];
  claims?: ClaimSeed[];
  runs?: RunSeed[];
  entries?: Record<string, unknown>[];
}): FakeSupabase {
  return fakeDb({
    store: {
      grants: grants.map((g, i) => ({
        id: `grant-${i}`,
        kind: "organizer_event",
        revoked_at: null,
        granted_at: LONG_GONE,
        ...g,
      })),
      event_claims: claims.map((c, i) => ({ id: `claim-${i}`, token: `token-${i}`, ...c })),
      event_runs: runs,
      event_entries: entries,
    },
    uniques: [ONE_LIVE_RUN],
    defaults: DEFAULTS,
  });
}

/** A live grant for Alice on her own event, and a claim verified while the window was open, which
 *  is the only combination that reaches the active battery without operator privilege. */
const ALICE_LIVE = { account_id: ALICE.id, scope: SLUG, expires_at: YEAR_AWAY };
const ALICE_VERIFIED: ClaimSeed = {
  account_id: ALICE.id,
  slug: SLUG,
  status: "verified",
  window_open_at_verification: true,
};

afterEach(() => {
  delete process.env.SLOPTIC_ADMIN_ACCOUNTS;
  delete process.env.SLOPTIC_EVENT_OVERRIDE;
});

describe("POST /api/events/run: starting a run at all", () => {
  beforeEach(() => {
    resetRouteMocks();
    setUser(ALICE);
  });

  it("refuses a signed-out caller", async () => {
    const store = db({ grants: [ALICE_LIVE] });
    setDb(store);
    setUser(null);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(401);
    expect(store.rows("event_runs")).toHaveLength(0);
  });

  it("rejects a malformed body", async () => {
    setDb(db({}));
    const res = await read(await startRun(malformedRequest("http://x/api/events/run")));
    expect(res.status).toBe(400);
  });

  it("refuses an account holding no grant for the event", async () => {
    const store = db({});
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
    expect(store.rows("event_runs")).toHaveLength(0);
  });

  it("does not let Alice's grant authorize Mallory: a verified event is not an open one", async () => {
    const store = db({ grants: [ALICE_LIVE], claims: [ALICE_VERIFIED] });
    setDb(store);
    setUser(MALLORY);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(403);
    expect(store.rows("event_runs")).toHaveLength(0);
  });

  it("does not let a grant on one event carry to another", async () => {
    const store = db({ grants: [{ account_id: ALICE.id, scope: "other-hack", expires_at: YEAR_AWAY }] });
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
  });

  it("does not let an app_origin grant stand in for an event grant", async () => {
    const store = db({
      grants: [{ account_id: ALICE.id, kind: "app_origin", scope: SLUG, expires_at: YEAR_AWAY }],
    });
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
  });

  it("refuses an expired grant: time-boxed means time-boxed", async () => {
    const store = db({
      grants: [{ account_id: ALICE.id, scope: SLUG, expires_at: LONG_GONE }],
      claims: [ALICE_VERIFIED],
    });
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
    expect(store.rows("event_runs")).toHaveLength(0);
  });

  it("refuses a revoked grant", async () => {
    const store = db({
      grants: [{ account_id: ALICE.id, scope: SLUG, expires_at: YEAR_AWAY, revoked_at: LONG_GONE }],
      claims: [ALICE_VERIFIED],
    });
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
  });

  it("starts the run for the account that holds the live grant", async () => {
    const store = db({ grants: [ALICE_LIVE] });
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(201);
    const run = store.rows("event_runs")[0];
    expect(run.account_id).toBe(ALICE.id);
    expect(run.mode).toBe("passive");
  });
});

describe("POST /api/events/run: which battery it may point at the field", () => {
  beforeEach(() => {
    resetRouteMocks();
    setUser(ALICE);
  });

  it("allows active only for a grant holder whose event was verified before submissions closed", async () => {
    const store = db({ grants: [ALICE_LIVE], claims: [ALICE_VERIFIED] });
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(201);
    expect(store.rows("event_runs")[0].mode).toBe("active");
  });

  it("refuses active when the disclosure went up after the window closed", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [{ ...ALICE_VERIFIED, window_open_at_verification: false }],
    });
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")).toHaveLength(0);
  });

  it("refuses active when we could not tell whether the window was open", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [{ ...ALICE_VERIFIED, window_open_at_verification: null }],
    });
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(409);
  });

  it("does not read another account's verified claim as this account's consent record", async () => {
    const store = db({
      // Alice holds the grant, but the claim that says the window was open is Mallory's row.
      grants: [ALICE_LIVE],
      claims: [{ account_id: MALLORY.id, slug: SLUG, status: "verified", window_open_at_verification: true }],
    });
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(409);
  });

  it("keeps a plain override run passive however it is asked for", async () => {
    process.env.SLOPTIC_EVENT_OVERRIDE = ALICE.email;
    const store = db({ claims: [ALICE_VERIFIED] });
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({ mode: "passive", override: true });
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("gives the override to the listed address only", async () => {
    process.env.SLOPTIC_EVENT_OVERRIDE = "someone-else@example.com";
    const store = db({});
    setDb(store);
    const res = await read(await startRun(jsonRequest("http://x/api/events/run", { event: SLUG })));
    expect(res.status).toBe(403);
  });

  it("lets operator admin start an active run, and records it as admin", async () => {
    process.env.SLOPTIC_ADMIN_ACCOUNTS = "ALICE@example.com";
    const store = db({});
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(201);
    expect(store.rows("event_runs")[0]).toMatchObject({ mode: "active", admin: true, override: true });
  });

  it("does not give admin to an address that merely looks like the listed one", async () => {
    process.env.SLOPTIC_ADMIN_ACCOUNTS = "alice@example.com";
    setUser({ id: "u-x", email: "alice@example.com.evil.com" });
    const store = db({});
    setDb(store);
    const res = await read(
      await startRun(jsonRequest("http://x/api/events/run", { event: SLUG, mode: "active" }))
    );
    expect(res.status).toBe(403);
    expect(store.rows("event_runs")).toHaveLength(0);
  });
});

describe("POST /api/events/run/mode: switching an existing run to the active battery", () => {
  const readyRun = (over: Record<string, unknown> = {}) => ({
    id: "run-1",
    account_id: ALICE.id,
    slug: SLUG,
    mode: "passive",
    status: "ready",
    override: false,
    admin: false,
    ...over,
  });

  beforeEach(() => {
    resetRouteMocks();
    setUser(ALICE);
  });

  it("refuses a signed-out caller", async () => {
    const store = db({ runs: [readyRun()] });
    setDb(store);
    setUser(null);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(401);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("answers for another account's run exactly as for a run that does not exist", async () => {
    const store = db({ grants: [ALICE_LIVE], claims: [ALICE_VERIFIED], runs: [readyRun()] });
    setDb(store);
    setUser(MALLORY);
    const mine = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    const absent = await read(await setMode(jsonRequest("http://x/mode", { id: "run-nope", mode: "active" })));
    expect(mine.status).toBe(404);
    expect(mine.body).toEqual(absent.body);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("flips a ready run for the grant holder whose window was open", async () => {
    const store = db({ grants: [ALICE_LIVE], claims: [ALICE_VERIFIED], runs: [readyRun()] });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(200);
    expect(store.rows("event_runs")[0].mode).toBe("active");
  });

  it("refuses active when the window was closed at verification", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [{ ...ALICE_VERIFIED, window_open_at_verification: false }],
      runs: [readyRun()],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("refuses active when the window state is unknown", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [{ ...ALICE_VERIFIED, window_open_at_verification: null }],
      runs: [readyRun()],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("keeps an override run passive for a non-admin", async () => {
    process.env.SLOPTIC_EVENT_OVERRIDE = ALICE.email;
    const store = db({
      claims: [ALICE_VERIFIED],
      runs: [readyRun({ override: true })],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("will not switch a run that is already grading", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [ALICE_VERIFIED],
      runs: [readyRun({ status: "grading" })],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("will not switch a field that has already been measured", async () => {
    const store = db({
      grants: [ALICE_LIVE],
      claims: [ALICE_VERIFIED],
      runs: [readyRun()],
      entries: [{ id: "e1", run_id: "run-1", grade_id: "g1" }],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(409);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  // 403, not 409: holding no grant is a failure of authorization, not a conflict with the state of
  // the run. The claim window is the later question, and it is only reached by an account that has
  // the standing to ask it.
  it("refuses active for an account with no grant and no verified claim", async () => {
    const store = db({ runs: [readyRun()] });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(403);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  // CLAUDE.md: grants are time-boxed and re-verified before an active grade.
  it("refuses active on an expired grant, whatever the claim still says", async () => {
    const store = db({
      grants: [{ account_id: ALICE.id, scope: SLUG, expires_at: LONG_GONE }],
      claims: [ALICE_VERIFIED],
      runs: [readyRun()],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).not.toBe(200);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  // Revocation has to be immediate and total, which is the whole point of being able to revoke.
  it("refuses active on a revoked grant, whatever the claim still says", async () => {
    const store = db({
      grants: [{ account_id: ALICE.id, scope: SLUG, expires_at: YEAR_AWAY, revoked_at: LONG_GONE }],
      claims: [ALICE_VERIFIED],
      runs: [readyRun()],
    });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).not.toBe(200);
    expect(store.rows("event_runs")[0].mode).toBe("passive");
  });

  it("lets operator admin switch a run, since admin is the documented exception", async () => {
    process.env.SLOPTIC_ADMIN_ACCOUNTS = ALICE.email;
    const store = db({ runs: [readyRun({ override: true, admin: true })] });
    setDb(store);
    const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode: "active" })));
    expect(res.status).toBe(200);
    expect(store.rows("event_runs")[0].mode).toBe("active");
  });

  it("treats anything that is not the word active as passive", async () => {
    const store = db({ grants: [ALICE_LIVE], claims: [ALICE_VERIFIED], runs: [readyRun({ mode: "active" })] });
    setDb(store);
    for (const mode of ["ACTIVE", "active ", "aktive", true, 1, null]) {
      const res = await read(await setMode(jsonRequest("http://x/mode", { id: "run-1", mode })));
      // A run that is already active, asked for passive, flips to passive. Never the other way.
      expect(res.status).toBe(200);
      expect(store.rows("event_runs")[0].mode).toBe("passive");
      store.rows("event_runs")[0].mode = "active";
    }
  });
});
