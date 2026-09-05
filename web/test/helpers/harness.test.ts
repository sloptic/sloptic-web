import { describe, it, expect } from "vitest";
import { fakeDb, ONE_LIVE_RUN, GRADES_RESULTS } from "./supabase";

// The fake is the foundation the rest of the suite stands on, so it is tested first: a fake that
// quietly disagrees with PostgREST would make every test built on it meaningless.
describe("the Supabase fake", () => {
  it("filters, orders and limits like a query would", async () => {
    const db = fakeDb({
      store: {
        grades: [
          { id: "a", status: "queued", submitted_at: "2026-01-02" },
          { id: "b", status: "done", submitted_at: "2026-01-01" },
          { id: "c", status: "queued", submitted_at: "2026-01-03" },
        ],
      },
    });
    const { data } = await db
      .from("grades")
      .select("id")
      .eq("status", "queued")
      .order("submitted_at", { ascending: true })
      .limit(1);
    expect(data).toEqual([{ id: "a", status: "queued", submitted_at: "2026-01-02" }]);
  });

  it("returns PGRST116 from maybeSingle on more than one row, as PostgREST does", async () => {
    const db = fakeDb({ store: { event_runs: [{ id: "1", slug: "x" }, { id: "2", slug: "x" }] } });
    const { data, error } = await db.from("event_runs").select("id").eq("slug", "x").maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST116");
  });

  it("counts with head, without returning rows", async () => {
    const db = fakeDb({ store: { grades: [{ id: "a" }, { id: "b" }] } });
    const { data, count } = await db.from("grades").select("id", { count: "exact", head: true });
    expect(data).toBeNull();
    expect(count).toBe(2);
  });

  it("enforces a partial unique index the way migration 0025 does", async () => {
    const db = fakeDb({
      store: { event_runs: [{ id: "1", account_id: "u1", slug: "hack", status: "grading" }] },
      uniques: [ONE_LIVE_RUN],
    });
    const dup = await db
      .from("event_runs")
      .insert({ account_id: "u1", slug: "hack", status: "resolving" })
      .select("id")
      .single();
    expect(dup.error?.code).toBe("23505");

    // The index is partial: a finished run on the same event is not a duplicate.
    const settled = await db
      .from("event_runs")
      .insert({ account_id: "u1", slug: "hack", status: "done" })
      .select("id")
      .single();
    expect(settled.error).toBeNull();
  });

  it("embeds a child relation only when the select asks for it", async () => {
    const db = fakeDb({
      store: {
        grades: [{ id: "g1" }],
        results: [{ grade_id: "g1", slop_score: 42 }],
      },
      relations: [GRADES_RESULTS],
    });
    const withChild = await db.from("grades").select("id, results(slop_score)").eq("id", "g1").maybeSingle();
    expect((withChild.data as { results: unknown[] }).results).toEqual([{ grade_id: "g1", slop_score: 42 }]);

    const without = await db.from("grades").select("id").eq("id", "g1").maybeSingle();
    expect((without.data as Record<string, unknown>).results).toBeUndefined();
  });

  it("updates and deletes only the rows the filters select", async () => {
    const db = fakeDb({
      store: { grades: [{ id: "a", status: "queued" }, { id: "b", status: "running" }] },
    });
    await db.from("grades").update({ status: "cancelled" }).eq("status", "queued");
    expect(db.rows("grades")).toEqual([
      { id: "a", status: "cancelled" },
      { id: "b", status: "running" },
    ]);

    await db.from("grades").delete().eq("id", "b");
    expect(db.rows("grades").map((r) => r.id)).toEqual(["a"]);
  });
});
