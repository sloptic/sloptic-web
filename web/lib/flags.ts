// Runtime switches. Read per request, never inlined at build, so flipping one in the host's env
// takes effect without a redeploy.

/**
 * Whether the site should accept grade submissions at all.
 *
 * FAILS CLOSED. A queued grade only ever finishes if a worker is running and polling the same
 * database, and there is no way for the web side to know whether one is. With no worker, a
 * submission returns 202 and then sits on the pending page forever telling the visitor it will
 * update on its own, which is a worse outcome than a plain refusal.
 *
 * So the default is closed, and the flag is set only once a worker is genuinely running.
 */
export function gradingOpen(): boolean {
  const v = (process.env.GRADING_OPEN ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const GRADING_CLOSED_MESSAGE =
  "Grading is not open yet. The site is up but the grader is not accepting submissions, so nothing would come back. Check back shortly.";
