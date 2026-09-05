/** An in-memory stand-in for the PostgREST client, faithful on the parts the routes depend on.
 *
 *  Programmed-response fakes ("the next select returns these rows") were the obvious alternative and
 *  the wrong one here: the bugs this suite exists to catch are filter and cardinality bugs, and a
 *  fake that hands back whatever the test says cannot have those. So filters really filter, and
 *  maybeSingle really fails on two rows the way PostgREST does, which is the exact shape of the
 *  duplicate-run bug (0025).
 *
 *  Not implemented, deliberately: column projection (a select returns whole rows), RLS (the service
 *  role bypasses it in production too), and joins beyond the one embedded-relation form the code
 *  actually writes.
 */

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

export type PostgrestError = { code: string; message: string; details?: string };
export type Result<T> = { data: T; error: PostgrestError | null; count?: number | null };

/** A unique constraint to enforce on insert, as the database would. `where` narrows it to a partial
 *  index, which is what event_runs_one_live_idx is. */
export type UniqueIndex = {
  table: string;
  columns: string[];
  where?: (row: Row) => boolean;
};

/** An embedded select, `grades(..., results(slop_score))`: the child rows that hang off a parent. */
export type Relation = {
  parent: string;
  child: string;
  /** Column on the child pointing at the parent's id. */
  foreignKey: string;
  /** Column on the parent it points to. Defaults to "id". */
  parentKey?: string;
};

type Op = "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte";
type Filter = { op: Op; column: string; value: unknown };

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "eq":
      return v === f.value;
    case "neq":
      return v !== f.value;
    case "in":
      return Array.isArray(f.value) && f.value.includes(v as never);
    case "is":
      // PostgREST `is` takes null or a boolean; identity is the right comparison for both.
      return v === f.value || (f.value === null && v === undefined);
    case "lt":
      return compare(v, f.value) < 0;
    case "lte":
      return compare(v, f.value) <= 0;
    case "gt":
      return compare(v, f.value) > 0;
    case "gte":
      return compare(v, f.value) >= 0;
  }
}

/** Dates arrive as ISO strings, which compare correctly as strings; numbers must not. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class FakeSupabase {
  store: Store;
  uniques: UniqueIndex[];
  relations: Relation[];
  /** Every query the code ran, in order. Useful for asserting a route did NOT touch a table. */
  calls: { table: string; kind: string; filters: Filter[] }[] = [];
  /** Set to fail the next matching operation, to test error paths. */
  failures: { table: string; kind?: string; error: PostgrestError }[] = [];

  constructor(opts: { store?: Store; uniques?: UniqueIndex[]; relations?: Relation[] } = {}) {
    this.store = opts.store ? clone(opts.store) : {};
    this.uniques = opts.uniques ?? [];
    this.relations = opts.relations ?? [];
  }

  rows(table: string): Row[] {
    if (!this.store[table]) this.store[table] = [];
    return this.store[table];
  }

  from(table: string) {
    return new Builder(this, table);
  }

  /** The auth surface the routes use. Only what they call. */
  auth = {
    admin: {
      deleteUser: async (_id: string) => ({ data: null, error: null as PostgrestError | null }),
    },
    signOut: async () => ({ error: null as PostgrestError | null }),
  };

  private failureFor(table: string, kind: string): PostgrestError | null {
    const i = this.failures.findIndex((f) => f.table === table && (!f.kind || f.kind === kind));
    if (i === -1) return null;
    return this.failures.splice(i, 1)[0].error;
  }

  /** Internal: run a builder to completion. */
  run(b: Builder): Result<unknown> {
    this.calls.push({ table: b.table, kind: b.kind, filters: b.filters });
    const failure = this.failureFor(b.table, b.kind);
    if (failure) return { data: null, error: failure, count: null };

    if (b.kind === "insert") {
      const inserted: Row[] = [];
      for (const raw of b.payload) {
        const row: Row = { id: raw.id ?? `id-${this.rows(b.table).length + 1}`, ...raw };
        const violated = this.uniques.find(
          (u) =>
            u.table === b.table &&
            (!u.where || u.where(row)) &&
            this.rows(b.table).some(
              (existing) =>
                (!u.where || u.where(existing)) &&
                u.columns.every((c) => existing[c] === row[c])
            )
        );
        if (violated) {
          return {
            data: null,
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint "${violated.table}_unique"`,
            },
            count: null,
          };
        }
        this.rows(b.table).push(row);
        inserted.push(row);
      }
      return this.shape(b, inserted);
    }

    const hit = this.rows(b.table).filter((r) => b.filters.every((f) => matches(r, f)));

    if (b.kind === "update") {
      for (const r of hit) Object.assign(r, b.payload[0]);
      return this.shape(b, hit);
    }
    if (b.kind === "delete") {
      this.store[b.table] = this.rows(b.table).filter((r) => !hit.includes(r));
      return this.shape(b, hit);
    }

    // select
    let out = hit;
    if (b.orderBy) {
      const { column, ascending } = b.orderBy;
      out = [...out].sort((x, y) => compare(x[column], y[column]) * (ascending ? 1 : -1));
    }
    if (b.limitTo !== null) out = out.slice(0, b.limitTo);
    return this.shape(b, out);
  }

  /** Apply embedded relations, head/count, and single/maybeSingle cardinality. */
  private shape(b: Builder, rows: Row[]): Result<unknown> {
    const embedded = rows.map((r) => {
      const copy: Row = { ...r };
      for (const rel of this.relations) {
        if (rel.parent !== b.table) continue;
        if (!b.columns.includes(`${rel.child}(`)) continue;
        const key = rel.parentKey ?? "id";
        copy[rel.child] = this.rows(rel.child).filter((c) => c[rel.foreignKey] === r[key]);
      }
      return copy;
    });

    if (b.headOnly) return { data: null, error: null, count: rows.length };

    if (b.cardinality === "maybeSingle") {
      if (embedded.length === 0) return { data: null, error: null, count: null };
      if (embedded.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: `Results contain ${embedded.length} rows`,
          },
          count: null,
        };
      }
      return { data: clone(embedded[0]), error: null, count: 1 };
    }
    if (b.cardinality === "single") {
      if (embedded.length !== 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: `Results contain ${embedded.length} rows`,
          },
          count: null,
        };
      }
      return { data: clone(embedded[0]), error: null, count: 1 };
    }
    return { data: clone(embedded), error: null, count: embedded.length };
  }
}

/** The chainable query builder. Thenable, so `await db.from(...).select(...)` works, and every
 *  filter method returns `this` the way PostgREST's does. */
class Builder implements PromiseLike<Result<unknown>> {
  kind: "select" | "insert" | "update" | "delete" = "select";
  columns = "*";
  filters: Filter[] = [];
  payload: Row[] = [];
  orderBy: { column: string; ascending: boolean } | null = null;
  limitTo: number | null = null;
  headOnly = false;
  cardinality: "many" | "single" | "maybeSingle" = "many";
  /** Set once select() is called after insert/update/delete, which is how PostgREST returns rows. */
  private returning = false;

  constructor(private db: FakeSupabase, public table: string) {}

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.kind === "select") this.kind = "select";
    else this.returning = true;
    this.columns = columns;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.kind = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  update(patch: Row) {
    this.kind = "update";
    this.payload = [patch];
    return this;
  }
  delete() {
    this.kind = "delete";
    return this;
  }
  eq(column: string, value: unknown) { return this.filter("eq", column, value); }
  neq(column: string, value: unknown) { return this.filter("neq", column, value); }
  in(column: string, value: unknown[]) { return this.filter("in", column, value); }
  is(column: string, value: unknown) { return this.filter("is", column, value); }
  lt(column: string, value: unknown) { return this.filter("lt", column, value); }
  lte(column: string, value: unknown) { return this.filter("lte", column, value); }
  gt(column: string, value: unknown) { return this.filter("gt", column, value); }
  gte(column: string, value: unknown) { return this.filter("gte", column, value); }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }
  single() {
    this.cardinality = "single";
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybeSingle";
    return this;
  }

  private filter(op: Op, column: string, value: unknown) {
    this.filters.push({ op, column, value });
    return this;
  }

  then<A, B>(
    onfulfilled?: ((v: Result<unknown>) => A | PromiseLike<A>) | null,
    onrejected?: ((r: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    void this.returning;
    return Promise.resolve(this.db.run(this)).then(onfulfilled, onrejected);
  }
}

/** The usual shape: build a client over a seeded store. */
export function fakeDb(
  opts: { store?: Store; uniques?: UniqueIndex[]; relations?: Relation[] } = {}
): FakeSupabase {
  return new FakeSupabase(opts);
}

/** The partial unique index migration 0025 adds, so a test can run against the real invariant. */
export const ONE_LIVE_RUN: UniqueIndex = {
  table: "event_runs",
  columns: ["account_id", "slug"],
  where: (r) => ["resolving", "ready", "grading"].includes(String(r.status)),
};

/** grades -> results, the one embedded select the code writes. */
export const GRADES_RESULTS: Relation = { parent: "grades", child: "results", foreignKey: "grade_id" };
