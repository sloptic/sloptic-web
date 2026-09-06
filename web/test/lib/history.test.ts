import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { forgetEverything, forgetGrade, forgetGrades, readHistory, rememberGrade } from "@/lib/history";
import { ANON_REPORT_DAYS } from "@/lib/retention";

const KEY = "sloptic.grades.v1";
const DAY = 86_400_000;

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const seed = (list: unknown) => window.localStorage.setItem(KEY, JSON.stringify(list));
const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as { id: string }[];
const item = (id: string, days = 0) => ({ id, origin: `https://${id}.example`, at: ago(days) });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readHistory", () => {
  it("is empty for a browser that has never submitted a grade", () => {
    expect(readHistory()).toEqual([]);
  });

  it("is empty rather than broken when the stored value is not what it expects", () => {
    // Anything can end up under a localStorage key, including a half-written value from a killed
    // tab, and losing a convenience list must never take the page down.
    seed({ id: "not-a-list" });
    expect(readHistory()).toEqual([]);
    window.localStorage.setItem(KEY, "{oops");
    expect(readHistory()).toEqual([]);
    window.localStorage.setItem(KEY, "null");
    expect(readHistory()).toEqual([]);
  });

  it("returns nothing when storage itself refuses, as it does in some privacy modes", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    expect(readHistory()).toEqual([]);
  });

  it("orders newest first, whatever order the entries were written in", () => {
    seed([item("b", 2), item("a", 1), item("c", 10)]);
    expect(readHistory().map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("drops an entry past the retention window, since the report it points at is gone", () => {
    // expire_anonymous_reports has already deleted the report by then, so keeping the row would
    // only offer a link to a 404.
    seed([item("fresh", 1), item("expired", ANON_REPORT_DAYS + 1)]);
    expect(readHistory().map((e) => e.id)).toEqual(["fresh"]);
  });

  it("keeps an entry that still has a day of the window left", () => {
    seed([item("nearly", ANON_REPORT_DAYS - 1)]);
    expect(readHistory().map((e) => e.id)).toEqual(["nearly"]);
  });

  it("drops an entry with no usable id or timestamp", () => {
    // A row with no time cannot be pruned or ordered, so it cannot be trusted to be shown either.
    seed([
      item("good"),
      { id: "no-time" },
      { at: ago(1) },
      { id: 7, at: ago(1) },
      { id: "bad-time", at: "sometime last week" },
      null,
    ]);
    expect(readHistory().map((e) => e.id)).toEqual(["good"]);
  });

  it("caps what it hands back, so a list cannot grow without bound", () => {
    seed(Array.from({ length: 150 }, (_, i) => item(`g${i}`, i / 24)));
    expect(readHistory()).toHaveLength(100);
  });
});

describe("rememberGrade", () => {
  it("puts the newest submission at the front", () => {
    rememberGrade(item("first", 1));
    rememberGrade(item("second"));
    expect(readHistory().map((e) => e.id)).toEqual(["second", "first"]);
  });

  it("is idempotent on the id, so a resubmit cannot duplicate a row", () => {
    rememberGrade(item("g1"));
    rememberGrade(item("g1"));
    expect(readHistory().map((e) => e.id)).toEqual(["g1"]);
  });

  it("caps what it stores as well as what it reads", () => {
    for (let i = 0; i < 105; i++) rememberGrade(item(`g${i}`));
    expect(stored()).toHaveLength(100);
  });

  it("does not throw when storage refuses the write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => rememberGrade(item("g1"))).not.toThrow();
  });

  it("prunes the expired entries it happens to pass on the way", () => {
    seed([item("old", ANON_REPORT_DAYS + 5)]);
    rememberGrade(item("new"));
    expect(stored().map((e) => e.id)).toEqual(["new"]);
  });
});

describe("forgetGrade and forgetGrades", () => {
  it("drops the one grade named, after a delete or a claim", () => {
    rememberGrade(item("a"));
    rememberGrade(item("b"));
    forgetGrade("a");
    expect(readHistory().map((e) => e.id)).toEqual(["b"]);
  });

  it("ignores an id the browser never knew", () => {
    rememberGrade(item("a"));
    forgetGrade("nope");
    expect(readHistory().map((e) => e.id)).toEqual(["a"]);
  });

  it("drops a whole batch at once, which is what a claim hands back", () => {
    for (const id of ["a", "b", "c"]) rememberGrade(item(id));
    forgetGrades(["a", "c"]);
    expect(readHistory().map((e) => e.id)).toEqual(["b"]);
  });

  it("leaves the list alone for an empty batch", () => {
    rememberGrade(item("a"));
    forgetGrades([]);
    expect(readHistory().map((e) => e.id)).toEqual(["a"]);
  });
});

describe("what the browser keeps", () => {
  it("stores nothing that identifies the person, only the grade and its origin", () => {
    // The list exists so an anonymous grade is not lost with the tab, without inventing a
    // server-side identity for someone who deliberately did not make an account.
    rememberGrade(item("g1"));
    expect(Object.keys(stored()[0]).sort()).toEqual(["at", "id", "origin"]);
  });
});

describe("signing out empties it", () => {
  // The list is scoped to the BROWSER, which is right for an anonymous submitter whose report URL is
  // otherwise their only handle, and which is exactly why sign-out has to clear it: a browser
  // outlives a session. A report URL is a bearer token, so leaving the list for whoever signs in
  // next is access, not untidiness.
  it("leaves nothing for whoever signs in next", () => {
    rememberGrade(item("a"));
    rememberGrade(item("b"));

    forgetEverything();

    expect(readHistory()).toEqual([]);
  });

  it("removes the key rather than leaving an empty list behind", () => {
    rememberGrade(item("a"));

    forgetEverything();

    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("is safe on a browser that had nothing stored", () => {
    expect(() => forgetEverything()).not.toThrow();
    expect(readHistory()).toEqual([]);
  });
});
