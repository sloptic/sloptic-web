/** The tri-state, as an organizer reads it.
 *
 *  `sloptic.devpost` answers ok / not_found / blocked, and migration 0012 adds a fourth for faults
 *  of our own, `error`. Only not_found means the token is absent; blocked means Devpost would not
 *  answer us. Collapsing the two is the specific bug the type exists to prevent, and it is worth an
 *  organizer's whole afternoon: told "we could not find that event", they go and edit a rules page
 *  that was already correct. So each state must reach the page as itself, and none of them may read
 *  as a verdict on a token we never got to look for.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EventActions from "@/app/events/[slug]/EventActions";

type CheckStatus = "ok" | "not_found" | "blocked" | "error" | null;

const claim = (check_status: CheckStatus, checked_at: string | null = "2026-02-01T10:00:00.000Z") => ({
  id: "c1",
  slug: "alices-hack",
  token: "the-token",
  status: "pending" as const,
  check_status,
  check_detail: null,
  checked_at,
});

function paint(check_status: CheckStatus, checked_at: string | null = "2026-02-01T10:00:00.000Z") {
  render(
    <EventActions
      slug="alices-hack"
      verified={false}
      canActive={false}
      canOverride={false}
      initialClaim={claim(check_status, checked_at)}
      initialRuns={[]}
    />
  );
  return document.body.textContent ?? "";
}

beforeEach(() => {
  // The component refreshes itself on mount. Nothing here is about that fetch, and letting it fail
  // is what keeps the seeded claim on screen.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what the organizer is told about the last check", () => {
  it("says Devpost did not answer when the fetch was blocked, and does not call the token missing", () => {
    const text = paint("blocked");
    expect(text).toContain("Devpost did not answer our last check");
    expect(text).not.toContain("could not find that event");
    expect(text).not.toContain("could not find our link");
    // "unknown", not "blocked": the attribute carries what the ORGANIZER should read off the slip,
    // and a fetch that failed on our side is not something they can act on. It used to be the raw
    // check_status, which pinned an implementation detail rather than the property this test names.
    // The property itself is unchanged: a blocked look must never be presented as a missing token.
    expect(screen.getByText(/did not answer/).closest(".verdict")).toHaveAttribute("data-state", "unknown");
    expect(screen.getByText(/did not answer/).closest(".verdict")).not.toHaveAttribute("data-state", "missing");
  });

  it("says the event is missing only when Devpost actually said so", () => {
    const text = paint("not_found");
    expect(text).toContain("We could not find that event on Devpost");
    expect(text).not.toContain("did not answer");
  });

  it("owns a fault of ours rather than blaming the remote", () => {
    const text = paint("error");
    expect(text).toContain("on our side");
    expect(text).not.toContain("Devpost did not answer");
    expect(text).not.toContain("could not find that event");
  });

  it("reports a completed look that found no link as exactly that", () => {
    const text = paint("ok");
    expect(text).toContain("We could not find our link on your page yet");
  });

  it("says nothing about a check that has not happened yet", () => {
    const text = paint(null, null);
    expect(text).toContain("Waiting for the first check");
    expect(text).not.toContain("could not find");
  });

  it("never renders a pending claim as a verified one, whatever the check said", () => {
    for (const state of ["ok", "not_found", "blocked", "error", null] as CheckStatus[]) {
      const text = paint(state);
      // The pending panel, and none of the verified slip: "Link found" is what that slip says.
      expect(text).toContain("Verify this event");
      expect(text).not.toContain("Link found");
      cleanup();
    }
  });
});
