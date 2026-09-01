"use client";

// The browser's own list of grades it submitted. CLIENT ONLY.
//
// An anonymous grade has no owner, so the report URL is the only handle on it and closing the tab
// loses it for good. This keeps a list in the browser so that stops being true, without inventing a
// server-side identity for someone who deliberately did not make an account: no cookie, no email,
// nothing that follows them. WebPageTest solves the same problem the same way, and is honest about
// the limits, which are real. One browser, gone when site data is cleared, not synced across
// devices. Those limits ARE what anonymous means, and signing in is the fix.

import { ANON_REPORT_DAYS } from "./retention";

const KEY = "sloptic.grades.v1";
const CAP = 100;

export type HistoryEntry = {
  id: string;
  origin: string;
  /** ISO time the grade was submitted, used for pruning and for ordering before the server answers. */
  at: string;
};

/** Every read and write is wrapped: storage throws outright in some privacy modes, and losing a
 *  convenience list must never take the page down with it. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Entries this browser knows about, newest first, with anything past the retention window dropped.
 *  Pruning locally matches the server: the report is gone by then, so an entry pointing at it would
 *  only be a link to a 404. */
export function readHistory(): HistoryEntry[] {
  return safe(() => {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - ANON_REPORT_DAYS * 86_400_000;
    return (parsed as HistoryEntry[])
      .filter((e) => e && typeof e.id === "string" && typeof e.at === "string")
      .filter((e) => Date.parse(e.at) > cutoff)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, CAP);
  }, []);
}

function write(list: HistoryEntry[]) {
  safe(() => window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP))), undefined);
}

/** Record a submitted grade. Idempotent on id, so a resubmit or a double-fire cannot duplicate. */
export function rememberGrade(entry: HistoryEntry) {
  write([entry, ...readHistory().filter((e) => e.id !== entry.id)]);
}

/** Drop one, after a delete or once an account has claimed it and the server list carries it. */
export function forgetGrade(id: string) {
  write(readHistory().filter((e) => e.id !== id));
}

export function forgetGrades(ids: string[]) {
  const drop = new Set(ids);
  write(readHistory().filter((e) => !drop.has(e.id)));
}
