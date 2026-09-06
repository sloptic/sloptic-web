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
/** `negated` is PostgREST's `not.`: the same comparison, inverted, which is how a route asks for
 *  "grade_id is not null". */
type Filter = { op: Op; column: string; value: unknown; negated?: boolean };

function matches(row: Row, f: Filter): boolean {
  const hit = compares(row, f);
  return f.negated ? !hit : hit;
}

function compares(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "eq":
      // PostgREST renders .eq(col, null) as col=eq.null, which never matches SQL NULL (on a uuid
      // column it is rejected outright). Matching it here the way JS compares null to null made
      // this fake MORE forgiving than the database, and a real dedup bug in /api/grade passed its
      // tests green for exactly that reason. Throw rather than return false: the mistake is the
      // query, and a silent miss is what hid it the first time.
      if (f.value === null) {
        throw new Error(
          `eq("${f.column}", null) is not a NULL test. PostgREST reads it as the string "null". ` +
            `Use .is("${f.column}", null).`
        );
      }
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
  /** Per-table column defaults, filled in on insert when the payload omits the column. The schema's
   *  DEFAULTs are load-bearing for the routes: a run inserted without a status is 'resolving' in the
   *  database, which is what makes it live, and therefore what event_runs_one_live_idx sees. */
  defaults: Record<string, Row>;
  /** Every query the code ran, in order. Useful for asserting a route did NOT touch a table. */
  calls: { table: string; kind: string; filters: Filter[] }[] = [];
  /** Set to fail the next matching operation, to test error paths. */
  failures: { table: string; kind?: string; error: PostgrestError }[] = [];

  constructor(
    opts: {
      store?: Store;
      uniques?: UniqueIndex[];
      relations?: Relation[];
      defaults?: Record<string, Row>;
    } = {}
  ) {
    this.store = opts.store ? clone(opts.store) : {};
    this.uniques = opts.uniques ?? [];
    this.relations = opts.relations ?? [];
    this.defaults = opts.defaults ?? {};
  }

  rows(table: string): Row[] {
    if (!this.store[table]) this.store[table] = [];
    return this.store[table];
  }

  from(table: string) {
    return new Builder(this, table);
  }

  /** Postgres functions the code calls through PostgREST. `bump_rate_limit` ships implemented,
   *  because the point of moving the rate limit into a function was atomicity and a fake that
   *  cannot be raced would hide exactly the bug that motivated it. Register others as needed. */
  rpcHandlers: Record<string, (args: Record<string, unknown>) => Result<unknown>> = {
    bump_rate_limit: (args) => {
      const ipHash = String(args.p_ip_hash);
      const windowStart = String(args.p_window_start);
      const max = Number(args.p_max);
      const rows = this.rows("rate_limits");
      let row = rows.find((r) => r.ip_hash === ipHash && r.window_start === windowStart);
      if (!row) {
        row = { ip_hash: ipHash, window_start: windowStart, count: 0 };
        rows.push(row);
      }
      // Read and increment in one step, as INSERT ... ON CONFLICT DO UPDATE does under its row
      // lock. The refused attempt is charged too, matching migration 0026.
      row.count = Number(row.count ?? 0) + 1;
      return { data: Number(row.count) <= max, error: null };
    },
  };

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result<unknown>> {
    this.calls.push({ table: `rpc:${name}`, kind: "rpc", filters: [] });
    const failure = this.failures.findIndex((f) => f.table === `rpc:${name}`);
    if (failure !== -1) {
      return { data: null, error: this.failures.splice(failure, 1)[0].error };
    }
    const handler = this.rpcHandlers[name];
    if (!handler) throw new Error(`no fake for rpc "${name}": register one on rpcHandlers`);
    return handler(args);
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

    if (b.kind === "upsert") {
      const touched: Row[] = [];
      for (const raw of b.payload) {
        const existing = this.rows(b.table).find((r) => b.conflict.every((c) => r[c] === raw[c]));
        if (existing) {
          Object.assign(existing, raw);
          touched.push(existing);
        } else {
          const row: Row = {
            id: raw.id ?? `id-${this.rows(b.table).length + 1}`,
            ...(this.defaults[b.table] ?? {}),
            ...raw,
          };
          this.rows(b.table).push(row);
          touched.push(row);
        }
      }
      return this.shape(b, touched);
    }

    if (b.kind === "insert") {
      const inserted: Row[] = [];
      for (const raw of b.payload) {
        const row: Row = {
          id: raw.id ?? `id-${this.rows(b.table).length + 1}`,
          ...(this.defaults[b.table] ?? {}),
          ...raw,
        };
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
  kind: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  columns = "*";
  filters: Filter[] = [];
  payload: Row[] = [];
  orderBy: { column: string; ascending: boolean } | null = null;
  limitTo: number | null = null;
  headOnly = false;
  cardinality: "many" | "single" | "maybeSingle" = "many";
  /** Columns an upsert conflicts on, the PostgREST `onConflict` argument. */
  conflict: string[] = ["id"];
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
  /** Insert or merge on a conflict target, which is how the rate limiter counts a window. */
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.kind = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.conflict = (opts?.onConflict ?? "id").split(",").map((c) => c.trim()).filter(Boolean);
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
  /** `.not("grade_id", "is", null)`, the one negated form the routes write. */
  not(column: string, op: Op, value: unknown) {
    this.filters.push({ op, column, value, negated: true });
    return this;
  }
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
  opts: {
    store?: Store;
    uniques?: UniqueIndex[];
    relations?: Relation[];
    defaults?: Record<string, Row>;
  } = {}
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
