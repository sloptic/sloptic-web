import { describe, it, expect } from "vitest";
import { ANON_REPORT_DAYS, daysUntil, reportExpiresAt } from "@/lib/retention";

const DAY = 86_400_000;

describe("the anonymous retention window", () => {
  it("is the 30 days migration 0009 sweeps on", () => {
    // expire_anonymous_reports(retain_days int default 30) is the authority. If that default moves
    // and this does not, the site tells people a date the sweep will not honour.
    expect(ANON_REPORT_DAYS).toBe(30);
  });
});

describe("reportExpiresAt", () => {
  it("drops an unclaimed report exactly one window after it finished", () => {
    // The sweep deletes where finished_at < now() - 30 days, so the expiry hangs off the finish,
    // not the submission.
    const at = reportExpiresAt("2026-09-01T00:00:00Z", false);
    expect(at?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("gives a claimed grade no expiry, which is the whole reason to sign in", () => {
    expect(reportExpiresAt("2026-09-01T00:00:00Z", true)).toBeNull();
  });

  it("gives no expiry to a grade that has not finished", () => {
    // The sweep only reaches rows with a finish time, so a queued or running grade has no date to
    // quote and must not be given a made-up one.
    expect(reportExpiresAt(null, false)).toBeNull();
    expect(reportExpiresAt("", false)).toBeNull();
  });

  it("gives no expiry rather than an Invalid Date when the timestamp is unparseable", () => {
    expect(reportExpiresAt("not a timestamp", false)).toBeNull();
    expect(reportExpiresAt("0000-13-45", false)).toBeNull();
  });

  it("reads a finish time that is already older than the window", () => {
    // The sweep runs on the worker's maintenance tick, so a row can sit past its date briefly. The
    // date is still the truth about when it goes.
    const at = reportExpiresAt("2020-01-01T00:00:00Z", false);
    expect(at?.getTime()).toBe(Date.parse("2020-01-01T00:00:00Z") + ANON_REPORT_DAYS * DAY);
  });

  it("accepts the timestamp shape Postgres actually returns", () => {
    // timestamptz comes back with a +00:00 offset and microseconds, not a Z.
    const at = reportExpiresAt("2026-09-01T00:00:00.123456+00:00", false);
    expect(at?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("daysUntil", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");

  it("floors, so a report with a day and a half left reads as one day", () => {
    // Rounding up would promise a day the sweep may already have taken.
    expect(daysUntil(new Date(now + 1.5 * DAY), now)).toBe(1);
    expect(daysUntil(new Date(now + 30 * DAY), now)).toBe(30);
  });

  it("never goes negative on a date that has passed", () => {
    expect(daysUntil(new Date(now - DAY), now)).toBe(0);
    expect(daysUntil(new Date(now - 400 * DAY), now)).toBe(0);
  });

  it("reads the last hours of the window as zero days, not one", () => {
    expect(daysUntil(new Date(now + 1000), now)).toBe(0);
    expect(daysUntil(new Date(now), now)).toBe(0);
  });

  it("defaults to the current clock", () => {
    expect(daysUntil(new Date(Date.now() + 5 * DAY))).toBe(5);
  });
});
