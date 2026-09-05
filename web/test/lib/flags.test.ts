import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  GRADING_CLOSED_MESSAGE,
  QUEUE_FULL_MESSAGE,
  adminAccounts,
  eventOverrideAccounts,
  gradingOpen,
  isAdmin,
  maxQueueDepth,
  mayOverrideEvents,
} from "@/lib/flags";

const KEYS = ["GRADING_OPEN", "MAX_QUEUE_DEPTH", "SLOPTIC_EVENT_OVERRIDE", "SLOPTIC_ADMIN_ACCOUNTS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("gradingOpen", () => {
  it("is closed when nothing has been set", () => {
    // A queued grade only finishes if a worker is polling the same database, and the web side cannot
    // tell whether one is. Open by default would mean 202 followed by a pending page forever.
    expect(gradingOpen()).toBe(false);
  });

  it("opens only on a switch someone deliberately set", () => {
    for (const v of ["1", "true", "yes", "TRUE", " Yes "]) {
      process.env.GRADING_OPEN = v;
      expect([v, gradingOpen()]).toEqual([v, true]);
    }
  });

  it("stays closed on anything that is not one of those", () => {
    for (const v of ["", "0", "false", "no", "on", "maybe", "  "]) {
      process.env.GRADING_OPEN = v;
      expect([v, gradingOpen()]).toEqual([v, false]);
    }
  });
});

describe("maxQueueDepth", () => {
  it("caps the queue at 30 when the host says nothing", () => {
    // The worker fails a grade that has sat queued past QUEUE_TIMEOUT_SECONDS (60 minutes), and 30
    // waiting is roughly 35 to 50 minutes at the measured throughput, which lands inside it.
    expect(maxQueueDepth()).toBe(30);
  });

  it("takes the number the host sets", () => {
    process.env.MAX_QUEUE_DEPTH = "12";
    expect(maxQueueDepth()).toBe(12);
  });

  it("falls back to the default rather than accepting a cap that would disable the refusal", () => {
    // Zero or a negative would refuse everyone; a non-number would make the comparison meaningless.
    for (const v of ["0", "-5", "", "  ", "lots", "NaN"]) {
      process.env.MAX_QUEUE_DEPTH = v;
      expect([v, maxQueueDepth()]).toEqual([v, 30]);
    }
  });

  it("refuses an unbounded cap", () => {
    process.env.MAX_QUEUE_DEPTH = "Infinity";
    expect(maxQueueDepth()).toBe(30);
  });
});

describe("the refusal messages", () => {
  it("say what happened without an em dash, as the house style requires", () => {
    for (const m of [GRADING_CLOSED_MESSAGE, QUEUE_FULL_MESSAGE]) {
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toMatch(/[—–]/);
    }
  });

  it("tells someone turned away by a full queue what to do", () => {
    expect(QUEUE_FULL_MESSAGE).toMatch(/try again/i);
  });
});

// The matching rules for these two lists (case, trimming, lookalike domains) are covered in
// test/security/flags.test.ts, which owns the privilege boundary. What is tested here is only that
// both lists start empty and stay independent of each other.
describe("the two account lists", () => {
  it("hold nobody unless someone set them on the server", () => {
    expect(eventOverrideAccounts()).toEqual([]);
    expect(adminAccounts()).toEqual([]);
    expect(mayOverrideEvents("anyone@example.com")).toBe(false);
    expect(isAdmin("anyone@example.com")).toBe(false);
  });

  it("read a comma separated list, dropping the blanks", () => {
    process.env.SLOPTIC_EVENT_OVERRIDE = " Ian@Example.com , other@example.com ,, ";
    expect(eventOverrideAccounts()).toEqual(["ian@example.com", "other@example.com"]);
  });

  it("stay separate switches, which is what keeps the active battery gated", () => {
    // The override buys a batch of PASSIVE grades and no new capability. Admin is the only thing
    // that can send the active battery, so holding one must never confer the other.
    process.env.SLOPTIC_EVENT_OVERRIDE = "ian@example.com";
    expect(isAdmin("ian@example.com")).toBe(false);
    delete process.env.SLOPTIC_EVENT_OVERRIDE;
    process.env.SLOPTIC_ADMIN_ACCOUNTS = "ian@example.com";
    expect(mayOverrideEvents("ian@example.com")).toBe(false);
  });

  it("are read per call, so removing an address takes effect without a redeploy", () => {
    process.env.SLOPTIC_ADMIN_ACCOUNTS = "ian@example.com";
    expect(isAdmin("ian@example.com")).toBe(true);
    process.env.SLOPTIC_ADMIN_ACCOUNTS = "";
    expect(isAdmin("ian@example.com")).toBe(false);
  });
});
