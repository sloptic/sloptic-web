/** Deleting an account, and deleting an event.
 *
 *  Both are destructive and both act on rows the caller does not exclusively own, so there are two
 *  properties to hold apart. What MUST go: the caller's authorization (the grant), their claim and
 *  their session. What must deliberately SURVIVE: the grade rows, which migration 0009 keeps as
 *  anonymous stubs precisely so that deleting an account cannot erase the rate-limiting and abuse
 *  history attached to what it graded. A delete that took those with it would make "grade a
 *  stranger's app, then delete the account" a way to launder the record of having done it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST as deleteAccount } from "@/app/api/account/delete/route";
import { POST as deleteEvent } from "@/app/api/events/delete/route";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };

/** The auth surface both routes reach, with the calls recorded. */
function withAuth(store: FakeSupabase, opts: { deleteError?: { code: string; message: string }; signOutThrows?: boolean } = {}) {
  const seen = { deleted: [] as string[], signOuts: 0 };
  store.auth = {
    admin: {
      deleteUser: async (id: string) => {
        seen.deleted.push(id);
        return { data: null, error: opts.deleteError ?? null };
      },
    },
    signOut: async () => {
      if (opts.signOutThrows) throw new Error("cookie store is read only");
      seen.signOuts += 1;
      return { error: null };
    },
  } as FakeSupabase["auth"];
  return seen;
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    resetRouteMocks();
    setUser(ALICE);
  });

  it("refuses a signed-out caller and deletes nobody", async () => {
    const store = fakeDb();
    const seen = withAuth(store);
    setDb(store);
    setUser(null);
    const res = await read(await deleteAccount());
    expect(res.status).toBe(401);
    expect(seen.deleted).toEqual([]);
  });

  it("deletes the session's own account and nothing a request could name", async () => {
    const store = fakeDb();
    const seen = withAuth(store);
    setDb(store);
    const res = await read(await deleteAccount());
    expect(res.status).toBe(200);
    expect(seen.deleted).toEqual([ALICE.id]);
    expect(seen.deleted).not.toContain(MALLORY.id);
  });

  it("clears the session, so the masthead stops drawing a deleted account", async () => {
    const store = fakeDb();
    const seen = withAuth(store);
    setDb(store);
    await deleteAccount();
    expect(seen.signOuts).toBe(1);
  });

  it("keeps the session when the delete itself failed", async () => {
    const store = fakeDb();
    const seen = withAuth(store, { deleteError: { code: "500", message: "nope" } });
    setDb(store);
    const res = await read(await deleteAccount());
    expect(res.status).toBe(500);
    expect(seen.signOuts).toBe(0);
  });

  it("still reports success when clearing the cookie fails", async () => {
    const store = fakeDb();
    withAuth(store, { signOutThrows: true });
    setDb(store);
    const res = await read(await deleteAccount());
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("deletes no grade or report row itself: the abuse history is not the account's to erase", async () => {
    const store = fakeDb({
      store: {
        grades: [{ id: "g1", account_id: ALICE.id, origin: "https://someone-elses-app.com" }],
        results: [{ grade_id: "g1", slop_score: 12 }],
      },
    });
    withAuth(store);
    setDb(store);
    await deleteAccount();
    expect(store.calls.filter((c) => c.kind === "delete")).toEqual([]);
    expect(store.rows("grades")).toHaveLength(1);
    expect(store.rows("results")).toHaveLength(1);
  });
});

const YEAR_AWAY = "2099-01-01T00:00:00.000Z";

/** Alice runs one event, has graded two entries of it, and holds the grant that let her. */
function eventStore(): FakeSupabase {
  return fakeDb({
    store: {
      event_runs: [
        { id: "run-1", account_id: ALICE.id, slug: "alices-hack", status: "done" },
        { id: "run-2", account_id: MALLORY.id, slug: "mallorys-hack", status: "done" },
      ],
      event_entries: [{ id: "e1", run_id: "run-1", app_url: "https://entry.example.com" }],
      grades: [
        { id: "g1", account_id: ALICE.id, event_run_id: "run-1", origin: "https://entry.example.com", status: "done" },
        { id: "g2", account_id: MALLORY.id, event_run_id: "run-2", origin: "https://other.example.com", status: "done" },
      ],
      results: [
        { grade_id: "g1", slop_score: 30 },
        { grade_id: "g2", slop_score: 40 },
      ],
      grants: [
        { id: "gr1", account_id: ALICE.id, kind: "organizer_event", scope: "alices-hack", expires_at: YEAR_AWAY, revoked_at: null },
        { id: "gr2", account_id: ALICE.id, kind: "organizer_event", scope: "other-hack", expires_at: YEAR_AWAY, revoked_at: null },
        { id: "gr3", account_id: ALICE.id, kind: "app_origin", scope: "https://alices-hack", expires_at: YEAR_AWAY, revoked_at: null },
        { id: "gr4", account_id: MALLORY.id, kind: "organizer_event", scope: "alices-hack", expires_at: YEAR_AWAY, revoked_at: null },
      ],
      event_claims: [
        { id: "c1", account_id: ALICE.id, slug: "alices-hack", token: "tok-alice", status: "verified" },
        { id: "c2", account_id: MALLORY.id, slug: "alices-hack", token: "tok-mallory", status: "verified" },
      ],
    },
  });
}

describe("POST /api/events/delete", () => {
  beforeEach(() => {
    resetRouteMocks();
    setUser(ALICE);
  });

  it("refuses a signed-out caller", async () => {
    const store = eventStore();
    setDb(store);
    setUser(null);
    const res = await read(await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack" })));
    expect(res.status).toBe(401);
    expect(store.rows("event_runs")).toHaveLength(2);
  });

  it("rejects a malformed body and an empty slug", async () => {
    setDb(eventStore());
    expect((await read(await deleteEvent(malformedRequest("http://x/delete")))).status).toBe(400);
    expect((await read(await deleteEvent(jsonRequest("http://x/delete", {})))).status).toBe(400);
    expect((await read(await deleteEvent(jsonRequest("http://x/delete", { slug: "  " })))).status).toBe(400);
  });

  it("leaves every trace of another account's event exactly where it was", async () => {
    const store = eventStore();
    setDb(store);
    setUser(MALLORY);
    // Mallory holds her own (grant, claim) pair on Alice's slug, which authorizes her own rows and
    // nothing of Alice's.
    await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack" }));
    expect(store.rows("event_runs").map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(store.rows("grades").find((g) => g.id === "g1")!.account_id).toBe(ALICE.id);
    expect(store.rows("grants").find((g) => g.id === "gr1")!.revoked_at).toBeNull();
    expect(store.rows("event_claims").find((c) => c.id === "c1")!.status).toBe("verified");
    // Her own pair is the one that goes.
    expect(store.rows("grants").find((g) => g.id === "gr4")!.revoked_at).toBeTruthy();
    expect(store.rows("event_claims").find((c) => c.id === "c2")!.status).toBe("revoked");
  });

  it("revokes the caller's grant for that event only", async () => {
    const store = eventStore();
    setDb(store);
    await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack" }));
    const byId = Object.fromEntries(store.rows("grants").map((g) => [g.id, g]));
    expect(byId.gr1.revoked_at).toBeTruthy();
    // Another event of hers, an app-origin grant that happens to share the string, and another
    // account's grant on the same event are all untouched.
    expect(byId.gr2.revoked_at).toBeNull();
    expect(byId.gr3.revoked_at).toBeNull();
    expect(byId.gr4.revoked_at).toBeNull();
    // Revoked, not deleted: the record that this account once proved this event survives.
    expect(store.rows("grants")).toHaveLength(4);
  });

  it("retires the token by revoking the claim, so a published link stops meaning anything", async () => {
    const store = eventStore();
    setDb(store);
    await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack" }));
    expect(store.rows("event_claims").find((c) => c.id === "c1")!.status).toBe("revoked");
    expect(store.rows("event_claims").find((c) => c.id === "c2")!.status).toBe("verified");
  });

  it("detaches the grades instead of destroying them, and keeps the reports by default", async () => {
    const store = eventStore();
    setDb(store);
    const res = await read(await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack" })));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, detached: 1, purged: 0 });
    const g1 = store.rows("grades").find((g) => g.id === "g1")!;
    expect(g1.account_id).toBeNull();
    expect(store.rows("results").map((r) => r.grade_id)).toEqual(["g1", "g2"]);
    expect(store.rows("event_runs").map((r) => r.id)).toEqual(["run-2"]);
  });

  it("takes the reports on request but keeps the grade rows as anonymous stubs", async () => {
    const store = eventStore();
    setDb(store);
    const res = await read(
      await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack", reports: "delete" }))
    );
    expect(res.body).toMatchObject({ detached: 1, purged: 1 });
    expect(store.rows("results").map((r) => r.grade_id)).toEqual(["g2"]);
    // The grade row survives: the daily budget counts finished grades, so removing them would
    // refund the quota an event already spent.
    expect(store.rows("grades").map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("never reaches another account's reports through the purge", async () => {
    const store = eventStore();
    setDb(store);
    setUser(MALLORY);
    await deleteEvent(jsonRequest("http://x/delete", { slug: "alices-hack", reports: "delete" }));
    expect(store.rows("results").map((r) => r.grade_id)).toEqual(["g1", "g2"]);
  });

  it("matches the slug the way it is stored, trimmed and lowercased", async () => {
    const store = eventStore();
    setDb(store);
    await deleteEvent(jsonRequest("http://x/delete", { slug: "  ALICES-HACK " }));
    expect(store.rows("event_runs").map((r) => r.id)).toEqual(["run-2"]);
    expect(store.rows("grants").find((g) => g.id === "gr1")!.revoked_at).toBeTruthy();
  });
});
