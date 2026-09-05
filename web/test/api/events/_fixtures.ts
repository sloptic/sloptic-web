/** Seed shared by the event run state machine tests.
 *
 *  The column defaults matter as much as the rows do: `event_runs.status` defaults to 'resolving' in
 *  the schema, which is what makes a freshly inserted run LIVE, and therefore what
 *  event_runs_one_live_idx (migration 0025) sees. A fake without the default would let a route insert
 *  a second live run and call it clean.
 *
 *  Not a *.test.ts file, so vitest does not collect it.
 */
import type { FakeSupabase, Row } from "../../helpers/supabase";

export const ORGANIZER = { id: "acct-organizer", email: "organizer@example.com" };
export const STRANGER = { id: "acct-stranger", email: "stranger@example.com" };
export const SLUG = "hacknight";

/** now() bracketed, so a fixture can be plainly live or plainly expired. */
export const PAST = "2020-01-01T00:00:00.000Z";
export const FUTURE = "2099-01-01T00:00:00.000Z";

export const DEFAULTS: Record<string, Row> = {
  event_runs: {
    status: "resolving",
    mode: "passive",
    paused: false,
    override: false,
    admin: false,
    priority: 1,
    refresh_requested: false,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    resolved_at: null,
    entries_found: null,
    gallery_complete: null,
    detail: null,
    refresh_new_submissions: null,
    refresh_modified_submissions: null,
  },
  event_entries: { app_url: null, skip_reason: null, grade_id: null },
  grades: {
    status: "queued",
    event_run_id: null,
    retry_due_at: null,
    finished_at: null,
    error: null,
  },
};

export function run(over: Row = {}): Row {
  return {
    id: "run-1",
    account_id: ORGANIZER.id,
    slug: SLUG,
    ...DEFAULTS.event_runs,
    ...over,
  };
}

export function entry(over: Row = {}): Row {
  return {
    id: "entry-1",
    run_id: "run-1",
    project_url: "https://devpost.com/software/one",
    app_url: "https://one.example.com",
    ...DEFAULTS.event_entries,
    ...over,
  };
}

export function grade(over: Row = {}): Row {
  return {
    id: "grade-1",
    account_id: ORGANIZER.id,
    origin: "https://one.example.com",
    submitted_url: "https://one.example.com",
    mode: "passive",
    ...DEFAULTS.grades,
    ...over,
  };
}

/** A live organizer grant: account bound, unrevoked, unexpired. The only shape that authorizes. */
export function organizerGrant(over: Row = {}): Row {
  return {
    id: "grant-1",
    account_id: ORGANIZER.id,
    kind: "organizer_event",
    scope: SLUG,
    revoked_at: null,
    expires_at: FUTURE,
    ...over,
  };
}

/** A verified claim whose disclosure predates the submission deadline, which is what the active
 *  tier reads as participant consent. */
export function verifiedClaim(over: Row = {}): Row {
  return {
    id: "claim-1",
    account_id: ORGANIZER.id,
    slug: SLUG,
    status: "verified",
    window_open_at_verification: true,
    ...over,
  };
}

/** Stage a race deterministically: `effect` runs immediately before the FIRST query on (table, kind)
 *  executes, which is where a concurrent writer would land, between the route's read and its write.
 *  Nothing else about the query changes. */
export function interleave(
  db: FakeSupabase,
  table: string,
  kind: "select" | "insert" | "update" | "delete",
  effect: () => void
): void {
  const realFrom = db.from.bind(db);
  let fired = false;
  db.from = (t: string) => {
    const builder = realFrom(t) as unknown as {
      kind: string;
      then: (...args: unknown[]) => unknown;
    };
    const realThen = builder.then.bind(builder);
    builder.then = (...args: unknown[]) => {
      if (!fired && t === table && builder.kind === kind) {
        fired = true;
        effect();
      }
      return realThen(...args);
    };
    return builder as unknown as ReturnType<FakeSupabase["from"]>;
  };
}

/** The run row as it stands now, read straight from the store rather than through a query, so an
 *  assertion about state cannot be fooled by the same filter bug it is looking for. */
export function stored(db: FakeSupabase, table: string, id: string): Row | undefined {
  return db.rows(table).find((r) => r.id === id);
}

export type Query = { table: string; kind: string; columns: string; payload: Row[] };

/** Record every query the route issues, including its column list and insert payload, which the
 *  call log on the fake does not keep. Needed where the projection is load-bearing: the fake returns
 *  whole rows (deliberately), so a route that relies on PostgREST projecting columns away can only
 *  be checked by what it asked for. */
export function spyQueries(db: FakeSupabase): Query[] {
  const log: Query[] = [];
  const realFrom = db.from.bind(db);
  db.from = (t: string) => {
    const builder = realFrom(t) as unknown as {
      kind: string;
      columns: string;
      payload: Row[];
      then: (...args: unknown[]) => unknown;
    };
    const realThen = builder.then.bind(builder);
    builder.then = (...args: unknown[]) => {
      log.push({
        table: t,
        kind: builder.kind,
        columns: builder.columns,
        payload: JSON.parse(JSON.stringify(builder.payload)) as Row[],
      });
      return realThen(...args);
    };
    return builder as unknown as ReturnType<FakeSupabase["from"]>;
  };
  return log;
}
