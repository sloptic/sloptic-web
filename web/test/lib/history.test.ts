/** The browser's own list of grades it submitted.
 *
 *  It is scoped to the BROWSER, which is right for an anonymous submitter whose report URL is
 *  otherwise their only handle, and which is exactly why signing out has to clear it: a browser
 *  outlives a session. A report URL is a bearer token, so leaving the list behind for whoever signs
 *  in next is not an untidy UI, it is access.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rememberGrade, readHistory, forgetGrades, forgetEverything } from "@/lib/history";

const entry = (id: string, origin = "https://a.example") => ({
  id,
  origin,
  at: new Date().toISOString(),
});

beforeEach(() => window.localStorage.clear());

describe("keeping a handle on anonymous reports", () => {
  it("remembers what this browser submitted", () => {
    rememberGrade(entry("a"));
    expect(readHistory().map((e) => e.id)).toEqual(["a"]);
  });

  it("forgets named entries without touching the rest", () => {
    rememberGrade(entry("a"));
    rememberGrade(entry("b"));

    forgetGrades(["a"]);

    expect(readHistory().map((e) => e.id)).toEqual(["b"]);
  });
});

describe("signing out empties it", () => {
  it("leaves nothing for whoever signs in next", () => {
    rememberGrade(entry("a"));
    rememberGrade(entry("b"));

    forgetEverything();

    expect(readHistory()).toEqual([]);
  });

  it("is safe to call when there was nothing there", () => {
    expect(() => forgetEverything()).not.toThrow();
    expect(readHistory()).toEqual([]);
  });

  it("really removes the key rather than leaving an empty one behind", () => {
    rememberGrade(entry("a"));

    forgetEverything();

    expect(window.localStorage.getItem("sloptic.grades.v1")).toBeNull();
  });
});
