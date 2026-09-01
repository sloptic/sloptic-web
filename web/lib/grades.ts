// Shared shape for grade LIST views (the browser's own history, and an account's grades). The single
// report view has its own richer route; this is deliberately just enough to render a row.

export const SUMMARY_SELECT =
  "id, origin, submitted_url, status, submitted_at, finished_at, account_id, results(slop_score, percentile, percentile_band)";

export type GradeSummary = {
  id: string;
  origin: string;
  submitted_url: string;
  status: "queued" | "running" | "done" | "failed";
  submitted_at: string;
  finished_at: string | null;
  /** Whether an account owns it, which is what decides if the report expires. Never the account id:
   *  who owns a grade is nobody else's business, and the id would leak it to any bearer of the URL. */
  claimed: boolean;
  slop_score: number | null;
  percentile: number | null;
  percentile_band: string | null;
};

type Row = Record<string, unknown> & { results?: unknown };

/** PostgREST returns an embedded one-to-one as an object on some versions and a single-element array
 *  on others, and the difference is invisible until a list renders every score as blank. */
export function toSummary(row: Row): GradeSummary {
  const embedded = Array.isArray(row.results) ? row.results[0] : row.results;
  const r = (embedded ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    origin: String(row.origin ?? ""),
    submitted_url: String(row.submitted_url ?? ""),
    status: row.status as GradeSummary["status"],
    submitted_at: String(row.submitted_at),
    finished_at: (row.finished_at as string) ?? null,
    claimed: row.account_id !== null && row.account_id !== undefined,
    slop_score: num(r.slop_score),
    percentile: num(r.percentile),
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
