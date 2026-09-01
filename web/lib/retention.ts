/** How long the report body of a grade no account has claimed is kept.
 *
 *  Mirrors the default of `expire_anonymous_reports()` in migration 0009, which is the authority:
 *  this constant only exists so the UI can tell someone when their report goes. Change both together.
 *
 *  Claimed grades have no expiry, which is the whole reason to sign in. */
export const ANON_REPORT_DAYS = 30;

/** When an unclaimed report will be dropped, or null once an account owns it. */
export function reportExpiresAt(finishedAt: string | null, claimed: boolean): Date | null {
  if (claimed || !finishedAt) return null;
  const t = Date.parse(finishedAt);
  if (Number.isNaN(t)) return null;
  return new Date(t + ANON_REPORT_DAYS * 86_400_000);
}

/** Whole days left, floored, never negative. */
export function daysUntil(when: Date, now: number = Date.now()): number {
  return Math.max(0, Math.floor((when.getTime() - now) / 86_400_000));
}
