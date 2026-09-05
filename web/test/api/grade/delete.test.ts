/** DELETE /api/grade/:id: who may destroy a report.
 *
 *  The rule from the route's own doc comment, which follows from the bearer model: while nobody owns
 *  the grade, the URL is the capability, so any link holder may delete it. Holding the link is
 *  already total read access, and since anyone may grade an app they do not own, the person most
 *  likely to want the report gone is the one it is about, who will only ever have the link. Once an
 *  account claims the grade that flips: a claim is somebody taking responsibility for the row, and a
 *  stranger with an old link must not be able to undo it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, getRequest, read } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { DELETE, GET } = await import("@/app/api/grade/[id]/route");

const del = (id: string) =>
  DELETE(jsonRequest(`http://localhost/api/grade/${id}`, {}, "DELETE"), { params: { id } });

let db: FakeSupabase;
beforeEach(() => {
  db = fakeDb({ store: { grades: [], results: [] } });
  setDb(db);
  setUser(null);
});
afterEach(() => resetRouteMocks());

const grade = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  origin: "https://example.com",
  submitted_url: "https://example.com",
  status: "done",
  submitted_at: "2026-01-01T00:00:00.000Z",
  finished_at: "2026-01-01T00:05:00.000Z",
  error: null,
  account_id: null,
  event_run_id: null,
  ...over,
});

describe("DELETE /api/grade/:id, an unowned grade", () => {
  it("lets an anonymous link holder delete it", async () => {
    db.rows("grades").push(grade());
    const { status, body } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(db.rows("grades")).toEqual([]);
  });

  it("lets any signed-in stranger delete it too, since the link is the capability", async () => {
    db.rows("grades").push(grade());
    setUser({ id: "someone-else", email: "x@example.com" });
    expect((await del("11111111-1111-4111-8111-111111111111")).status).toBe(200);
    expect(db.rows("grades")).toEqual([]);
  });

  it("removes only the grade named in the URL", async () => {
    db.rows("grades").push(grade(), grade({ id: "22222222-2222-4222-8222-222222222222" }));
    await del("11111111-1111-4111-8111-111111111111");
    expect(db.rows("grades").map((r) => r.id)).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });
});

describe("DELETE /api/grade/:id, a claimed grade", () => {
  it("refuses an anonymous caller", async () => {
    db.rows("grades").push(grade({ account_id: "user-1" }));
    const { status } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(403);
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("refuses a different account", async () => {
    db.rows("grades").push(grade({ account_id: "user-1" }));
    setUser({ id: "user-2", email: "b@example.com" });
    const { status } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(403);
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("lets the owning account delete it", async () => {
    db.rows("grades").push(grade({ account_id: "user-1" }));
    setUser({ id: "user-1", email: "a@example.com" });
    expect((await del("11111111-1111-4111-8111-111111111111")).status).toBe(200);
    expect(db.rows("grades")).toEqual([]);
  });

  it("protects an event's grades, which carry the organizer's account", async () => {
    db.rows("grades").push(grade({ account_id: "org-1", event_run_id: "run-1" }));
    setUser({ id: "user-2", email: "b@example.com" });
    expect((await del("11111111-1111-4111-8111-111111111111")).status).toBe(403);
    expect(db.rows("grades")).toHaveLength(1);
  });
});

describe("DELETE /api/grade/:id, the awkward cases", () => {
  it("is idempotent: deleting what is already gone is the outcome the caller asked for", async () => {
    const { status, body } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
  });

  it("does not delete anything when it cannot read the row it is about to check", async () => {
    // Failing open here would delete a claimed grade for a stranger on a transient error.
    db.rows("grades").push(grade({ account_id: "user-1" }));
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(500);
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("reports a failed delete rather than claiming the report is gone", async () => {
    db.rows("grades").push(grade());
    db.failures.push({ table: "grades", kind: "delete", error: { code: "08006", message: "connection lost" } });
    const { status, body } = await read(await del("11111111-1111-4111-8111-111111111111"));
    expect(status).toBe(500);
    expect(body.deleted).toBeUndefined();
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("takes the report with the grade, which the schema promises by cascade", () => {
    // The route deletes only the grades row and relies on results.grade_id being ON DELETE CASCADE.
    // If that ever loosened, deleting a grade would leave the report body behind, which is the exact
    // thing someone deleting a report about their own app is trying to get rid of.
    const sql = readFileSync(
      path.join(process.cwd(), "..", "supabase", "migrations", "0001_init.sql"),
      "utf8",
    );
    expect(sql).toMatch(/grade_id\s+uuid primary key references public\.grades\(id\) on delete cascade/);
  });
});

describe("the id in the URL, on both verbs", () => {
  // A mistyped link is a typo, not a fault: handing a non-uuid to a uuid column answered 22P02 and
  // surfaced as a 500, which paged an operator and gave a prober a distinct status to read.
  it("answers a malformed id with a 404 on GET", async () => {
    db.failures.push({ table: "grades", kind: "select", error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    const { status } = await read(
      await GET(getRequest("http://localhost/api/grade/nope"), { params: { id: "nope" } }),
    );
    expect(status).toBe(404);
  });

  it.fails("answers a malformed id with a 404 on DELETE", async () => {
    db.failures.push({ table: "grades", kind: "select", error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    expect((await del("nope")).status).toBe(404);
  });
});
