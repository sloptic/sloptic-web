// Shared shape for grade LIST views (the browser's own history, and an account's grades). The single
// report view has its own richer route; this is deliberately just enough to render a row.

export const SUMMARY_SELECT =
  "id, origin, submitted_url, mode, status, submitted_at, finished_at, account_id, results(slop_score, percentile, percentile_band, ranking)";

export type GradeSummary = {
  id: string;
  origin: string;
  submitted_url: string;
  /** Which battery ran. The two rank on different frozen curves, so a list that mixes them without
   *  saying which is which invites comparing numbers that are not comparable. */
  mode: "passive" | "active";
  status: "queued" | "running" | "done" | "failed";
  submitted_at: string;
  finished_at: string | null;
  /** Whether an account owns it, which is what decides if the report expires. Never the account id:
   *  who owns a grade is nobody else's business, and the id would leak it to any bearer of the URL. */
  claimed: boolean;
  slop_score: number | null;
  /** The grader's own percentile: the share of apps BETTER than this one, so lower is better.
   *  Kept because it is what the row stores, but never shown raw: "19" reads as the bottom fifth
   *  when it means the top fifth. */
  percentile: number | null;
  /** The share strictly worse, which is the direction every reader expects from a percentile and
   *  the number the report page shows. Read from the stored ranking rather than derived, so the list
   *  and the report cannot drift apart on ties. */
  cleaner_than_pct: number | null;
  percentile_band: string | null;
};

type Row = Record<string, unknown> & { results?: unknown };

/** PostgREST returns an embedded one-to-one as an object on some versions and a single-element array
 *  on others, and the difference is invisible until a list renders every score as blank. */
export function toSummary(row: Row): GradeSummary {
  const embedded = Array.isArray(row.results) ? row.results[0] : row.results;
  const r = (embedded ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const ranking = (r.ranking ?? {}) as Record<string, unknown>;
  // Fall back to the complement only for rows written before ranking was stored; the stored value is
  // authoritative because the grader decides how ties count.
  const cleaner =
    ranking.cleaner_than_pct !== undefined && ranking.cleaner_than_pct !== null
      ? Number(ranking.cleaner_than_pct)
      : r.percentile === null || r.percentile === undefined
        ? null
        : 100 - Number(r.percentile);
  return {
    id: String(row.id),
    origin: String(row.origin ?? ""),
    submitted_url: String(row.submitted_url ?? ""),
    mode: (row.mode as GradeSummary["mode"]) ?? "passive",
    status: row.status as GradeSummary["status"],
    submitted_at: String(row.submitted_at),
    finished_at: (row.finished_at as string) ?? null,
    claimed: row.account_id !== null && row.account_id !== undefined,
    slop_score: num(r.slop_score),
    percentile: num(r.percentile),
    cleaner_than_pct: cleaner,
    percentile_band: (r.percentile_band as string) ?? null,
  };
}

/** Cap on a batch lookup or claim. A browser's history is capped at 100 client-side; this stops a
 *  caller posting an unbounded id list at the database. */
export const MAX_IDS = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept only well-formed uuids, deduplicated and capped. A malformed id is dropped rather than
 *  failing the batch: one bad entry in a browser's history should not blank the whole list. */
export function cleanIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(
    0,
    MAX_IDS
  );
}


/** English ordinal suffix, shared so the list and the report cannot disagree about "81st".
 *  The teens are the exception that catches naive versions: 11th, 12th and 13th, not 11st/12nd/13rd,
 *  and they recur at 111, 112, 113. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The challenge-recovery superscripts a list row can carry.
 *
 *  B: a retry is booked (the score is provisional). N: recovery ran to completion and recovered
 *  NOTHING. P: it recovered some but not all. L: the grader noted limited engagement (fewer than
 *  40 checks applied), whatever the cause. N and P are mutually exclusive; L can sit beside either,
 *  and B outranks them while a pass is still pending, since the score may still change. */
export type RecoveryMarks = {
  retry: boolean;
  none: boolean;
  partial: boolean;
  limited: boolean;
};

export function recoveryMarks(input: {
  retryDueAt?: string | null;
  retryPasses?: number | null;
  initial?: number | null;
  blocked?: number | null;
  limitedEngagement?: boolean | null;
}): RecoveryMarks {
  const pending = Boolean(input.retryDueAt);
  const initial = input.initial ?? 0;
  const passes = input.retryPasses ?? 0;
  const recovered = Math.max(0, initial - (input.blocked ?? 0));
  const done = !pending && passes > 0 && initial > 0;
  return {
    retry: pending,
    none: done && recovered === 0,
    partial: done && recovered > 0 && recovered < initial,
    limited: input.limitedEngagement === true,
  };
}

/** Whether the grader's stored ranking noted limited engagement on this record. */
export function isLimitedEngagement(ranking: unknown): boolean {
  const status = (ranking as { reporting?: { status?: string } } | null)?.reporting?.status;
  return status === "limited_engagement";
}
