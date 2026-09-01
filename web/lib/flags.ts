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

export const GRADING_CLOSED_MESSAGE = "Grading is not open yet.";

/**
 * How many grades may be WAITING before the site stops accepting more.
 *
 * The arithmetic this has to satisfy: the worker runs 4 grades at once at roughly 4 to 7 minutes
 * each, so it clears somewhere around 35 to 50 an hour, and the worker fails any grade that has sat
 * queued longer than QUEUE_TIMEOUT_SECONDS (now 60 minutes). A cap of 30 means the back of the queue
 * waits about 35 to 50 minutes, which lands inside that window with room to spare.
 *
 * The point is WHERE the refusal happens. Without a cap the queue accepts everyone and then fails
 * whoever it could not reach, so the visitor learns they were turned away after watching a progress
 * page for the length of the timeout. Refusing in one second is the kinder half of the same answer,
 * and it is the difference between a launch that looks busy and one that looks broken.
 */
export function maxQueueDepth(): number {
  const n = Number(process.env.MAX_QUEUE_DEPTH ?? 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export const QUEUE_FULL_MESSAGE =
  "Too many grades are already waiting. Try again in a few minutes.";
