/** The three list routes: /api/grades, /api/grades/lookup and /api/grades/claim.
 *
 *  They share one model and it is worth stating before the tests: a grade id is a bearer capability,
 *  so anyone holding an id may read that grade's summary, and nothing more. lookup is therefore
 *  deliberately unauthenticated, and what has to be proved about it is that it cannot be turned into
 *  a scan (ids validated as uuids, the batch capped) and that a batch leaks nothing a single id did
 *  not already grant, in particular never WHO owns a grade. claim is first come, and its one hard
 *  rule is that it can never take a grade off an account already holding it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, GRADES_RESULTS, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";
import { MAX_IDS } from "@/lib/grades";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { GET: listMine } = await import("@/app/api/grades/route");
const { POST: lookup } = await import("@/app/api/grades/lookup/route");
const { POST: claim } = await import("@/app/api/grades/claim/route");

const uuid = (n: number) => `0000${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`.slice(-36);
const post = (path: string, body: unknown) => jsonRequest(`http://localhost${path}`, body);

let db: FakeSupabase;
beforeEach(() => {
  db = fakeDb({ store: { grades: [], results: [] }, relations: [GRADES_RESULTS] });
  setDb(db);
  setUser(null);
});
afterEach(() => resetRouteMocks());

const grade = (over: Record<string, unknown> = {}) => ({
  id: uuid(1),
  origin: "https://example.com",
  submitted_url: "https://example.com",
  mode: "passive",
  status: "done",
  submitted_at: "2026-01-01T00:00:00.000Z",
  finished_at: "2026-01-01T00:05:00.000Z",
  account_id: null,
  event_run_id: null,
  ...over,
});

type Summary = { id: string; claimed: boolean; slop_score: number | null; cleaner_than_pct: number | null };
const summaries = (body: Record<string, unknown>) => body.grades as Summary[];

describe("GET /api/grades, an account's own grades", () => {
  it("answers an anonymous caller with an empty list and never queries the table", async () => {
    const { status, body } = await read(await listMine());
    expect(status).toBe(200);
    expect(body.grades).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("returns the caller's grades and nobody else's", async () => {
    db.rows("grades").push(
      grade({ id: uuid(1), account_id: "user-1" }),
      grade({ id: uuid(2), account_id: "user-2" }),
      grade({ id: uuid(3), account_id: null }),
    );
    setUser({ id: "user-1", email: "a@example.com" });
    const { body } = await read(await listMine());
    expect(summaries(body).map((g) => g.id)).toEqual([uuid(1)]);
  });

  it("leaves an event's field on the event's board, not in the submitter's list", async () => {
    // Event grades carry the organizer's account so their reports never expire, which would
    // otherwise land a 52 app field here as though they had been graded one by one.
    db.rows("grades").push(
      grade({ id: uuid(1), account_id: "org-1" }),
      grade({ id: uuid(2), account_id: "org-1", event_run_id: "run-1" }),
    );
    setUser({ id: "org-1", email: "org@example.com" });
    expect(summaries((await read(await listMine())).body).map((g) => g.id)).toEqual([uuid(1)]);
  });

  it("puts the newest first", async () => {
    db.rows("grades").push(
      grade({ id: uuid(1), account_id: "user-1", submitted_at: "2026-01-01T00:00:00.000Z" }),
      grade({ id: uuid(2), account_id: "user-1", submitted_at: "2026-03-01T00:00:00.000Z" }),
      grade({ id: uuid(3), account_id: "user-1", submitted_at: "2026-02-01T00:00:00.000Z" }),
    );
    setUser({ id: "user-1", email: "a@example.com" });
    expect(summaries((await read(await listMine())).body).map((g) => g.id)).toEqual([uuid(2), uuid(3), uuid(1)]);
  });

  it("bounds the page rather than handing back an unbounded list", async () => {
    for (let i = 1; i <= 250; i++) db.rows("grades").push(grade({ id: uuid(i), account_id: "user-1" }));
    setUser({ id: "user-1", email: "a@example.com" });
    expect(summaries((await read(await listMine())).body)).toHaveLength(200);
  });

  it("reports a read failure as a server error, not as an empty history", async () => {
    setUser({ id: "user-1", email: "a@example.com" });
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status, body } = await read(await listMine());
    expect(status).toBe(500);
    expect(body.grades).toBeUndefined();
  });
});

describe("POST /api/grades/lookup, a browser's own history", () => {
  it("rejects a body that is not JSON", async () => {
    expect((await lookup(malformedRequest("http://localhost/api/grades/lookup"))).status).toBe(400);
  });

  it("returns an empty list without querying when there are no usable ids", async () => {
    for (const ids of [undefined, [], "not-an-array", 7, [""], ["../../etc/passwd"], [{ id: uuid(1) }]]) {
      const { body } = await read(await lookup(post("/api/grades/lookup", { ids })));
      expect(body.grades, JSON.stringify(ids)).toEqual([]);
    }
    expect(db.calls).toEqual([]);
  });

  it("drops a malformed id instead of blanking the whole batch", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }));
    const { body } = await read(
      await lookup(post("/api/grades/lookup", { ids: [uuid(1), "nope", "1; drop table grades", null] })),
    );
    expect(summaries(body).map((g) => g.id)).toEqual([uuid(1)]);
  });

  it("caps the batch, so the endpoint cannot be driven as a bulk query", async () => {
    const many = Array.from({ length: 5_000 }, (_, i) => uuid(i + 1));
    await lookup(post("/api/grades/lookup", { ids: many }));
    const asked = db.calls.find((c) => c.table === "grades")!;
    const inFilter = asked.filters.find((f) => f.op === "in")!;
    expect((inFilter.value as string[]).length).toBe(MAX_IDS);
    expect(MAX_IDS).toBeLessThanOrEqual(100);
  });

  it("deduplicates, so a repeated id cannot buy extra room in the batch", async () => {
    const ids = Array.from({ length: 300 }, () => uuid(1)).concat(Array.from({ length: 50 }, (_, i) => uuid(i + 2)));
    await lookup(post("/api/grades/lookup", { ids }));
    const inFilter = db.calls.find((c) => c.table === "grades")!.filters.find((f) => f.op === "in")!;
    expect(new Set(inFilter.value as string[]).size).toBe((inFilter.value as string[]).length);
  });

  it("says nothing at all about an id that names no grade", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }));
    const { body } = await read(await lookup(post("/api/grades/lookup", { ids: [uuid(1), uuid(2)] })));
    expect(summaries(body)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(uuid(2));
  });

  it("never says who owns a grade, only that somebody does", async () => {
    // The id is a read capability for the report. It is not a capability for the owner's identity,
    // and a browser's history list has no use for one.
    db.rows("grades").push(grade({ id: uuid(1), account_id: "user-1" }));
    const { body } = await read(await lookup(post("/api/grades/lookup", { ids: [uuid(1)] })));
    expect(summaries(body)[0].claimed).toBe(true);
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(Object.keys(summaries(body)[0])).not.toContain("account_id");
  });

  it("carries the score and the ranking the grader stored, not a re-derived one", async () => {
    // Passive and full grades rank on different frozen curves, so a number computed here rather than
    // read back is how the two get mixed.
    db.rows("grades").push(grade({ id: uuid(1) }));
    db.rows("results").push({
      grade_id: uuid(1),
      slop_score: 18.25,
      percentile: 22,
      percentile_band: "middling",
      ranking: { cleaner_than_pct: 77 },
    });
    const row = summaries((await read(await lookup(post("/api/grades/lookup", { ids: [uuid(1)] })))).body)[0];
    expect(row.slop_score).toBe(18.25);
    expect(row.cleaner_than_pct).toBe(77);
  });

  it("reports a read failure rather than an empty history", async () => {
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status } = await read(await lookup(post("/api/grades/lookup", { ids: [uuid(1)] })));
    expect(status).toBe(500);
  });
});

describe("POST /api/grades/claim, attaching a browser's grades to an account", () => {
  it("refuses a caller with no session, and changes nothing", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }));
    const { status } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1)] })));
    expect(status).toBe(401);
    expect(db.rows("grades")[0].account_id).toBeNull();
  });

  it("rejects a body that is not JSON", async () => {
    setUser({ id: "user-1", email: "a@example.com" });
    expect((await claim(malformedRequest("http://localhost/api/grades/claim"))).status).toBe(400);
  });

  it("claims the unowned grades it was given", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }), grade({ id: uuid(2) }));
    setUser({ id: "user-1", email: "a@example.com" });
    const { body } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1), uuid(2)] })));
    expect((body.claimed as string[]).sort()).toEqual([uuid(1), uuid(2)]);
    expect(db.rows("grades").every((g) => g.account_id === "user-1")).toBe(true);
  });

  it("never takes a grade off the account already holding it", async () => {
    // Claiming is first come. Anyone with the URL can already read the report, so a claim buys
    // persistence, never the ability to unhook somebody else's.
    db.rows("grades").push(grade({ id: uuid(1), account_id: "user-1" }), grade({ id: uuid(2) }));
    setUser({ id: "attacker", email: "m@example.com" });
    const { body } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1), uuid(2)] })));
    expect(body.claimed).toEqual([uuid(2)]);
    expect(db.rows("grades")[0].account_id).toBe("user-1");
  });

  it("is a no-op when re-run by the same account", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }));
    setUser({ id: "user-1", email: "a@example.com" });
    await claim(post("/api/grades/claim", { ids: [uuid(1)] }));
    const { body } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1)] })));
    expect(body.claimed).toEqual([]);
    expect(db.rows("grades")[0].account_id).toBe("user-1");
  });

  it("applies the same id validation and cap as the lookup", async () => {
    setUser({ id: "user-1", email: "a@example.com" });
    const { body } = await read(await claim(post("/api/grades/claim", { ids: ["nope", 5, null] })));
    expect(body.claimed).toEqual([]);
    expect(db.calls).toEqual([]);

    await claim(post("/api/grades/claim", { ids: Array.from({ length: 400 }, (_, i) => uuid(i + 1)) }));
    const inFilter = db.calls.find((c) => c.table === "grades")!.filters.find((f) => f.op === "in")!;
    expect((inFilter.value as string[]).length).toBe(MAX_IDS);
  });

  it("reports a failed claim rather than pretending it worked", async () => {
    db.rows("grades").push(grade({ id: uuid(1) }));
    setUser({ id: "user-1", email: "a@example.com" });
    db.failures.push({ table: "grades", kind: "update", error: { code: "08006", message: "connection lost" } });
    const { status } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1)] })));
    expect(status).toBe(500);
    expect(db.rows("grades")[0].account_id).toBeNull();
  });

  // Claiming exists for a browser's own anonymous history, which an event grade was never in.
  // Deleting an organizer's account nulls account_id across a whole field (0009), and without the
  // event_run_id guard every entry link would carry the right to delete its row off the board.
  it("does not let a stranger claim an event's grade", async () => {
    db.rows("grades").push(grade({ id: uuid(1), account_id: null, event_run_id: "run-1" }));
    setUser({ id: "stranger", email: "m@example.com" });
    const { body } = await read(await claim(post("/api/grades/claim", { ids: [uuid(1)] })));
    expect(body.claimed).toEqual([]);
    expect(db.rows("grades")[0].account_id).toBeNull();
  });
});
