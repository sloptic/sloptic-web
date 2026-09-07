/** The event board as an organizer reads it, and specifically what it says when nothing scored.
 *
 *  A field where every app was unreachable is the run that most needs looking at: it is the
 *  difference between "the grader has not got there yet" and "every app in my event is down". The
 *  page used to answer both with one sentence and an empty page, because the didn't-finish list
 *  lives inside BoardTable and BoardTable was swapped out whenever the ranking was empty.
 *
 *  The other half is arithmetic the organizer does without being asked: the header counts the whole
 *  field, so every entry in that count has to be accounted for somewhere below it. Entries with a
 *  skip reason were computed and then never rendered, so a two-entry field showed one row and looked
 *  like a bug in the count.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
import { setDb, setUser, resetRouteMocks } from "../helpers/route";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  // AutoRefresh sits in this page and reaches for the router on render. It is left real rather than
  // stubbed out, since a component the page mounts is part of what is being asserted to render.
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser } = await import("../helpers/route");
  return { currentUser: async () => getUser() };
});

import BoardPage from "@/app/events/[slug]/[runId]/page";

const ORGANIZER = { id: "acct-1", email: "organizer@example.com" };
const RUN = "run-1";

let db: FakeSupabase;

/** A settled passive run, and whatever field the test wants under it. */
function seed({
  entries = [],
  grades = [],
  results = [],
}: {
  entries?: Record<string, unknown>[];
  grades?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
} = {}) {
  db = fakeDb({
    store: {
      event_runs: [{
        id: RUN,
        slug: "sloptic-test",
        account_id: ORGANIZER.id,
        mode: "passive",
        status: "done",
        override: false,
        paused: false,
        entries_found: entries.length,
        gallery_complete: true,
        created_at: "2026-09-07T16:22:00.000Z",
      }],
      // run_id is what the page filters on, so it is attached here rather than repeated in
      // every seed and forgotten in one of them.
      event_entries: entries.map((e) => ({ run_id: RUN, ...e })),
      grades,
      results,
    },
  });
  setDb(db);
  setUser(ORGANIZER);
}

const markup = async () =>
  renderToStaticMarkup(
    (await BoardPage({ params: { slug: "sloptic-test", runId: RUN } })) as ReactElement,
  );

beforeEach(() => {
  resetRouteMocks();
});

describe("the event board when nothing scored", () => {
  it("still names the entries that could not be reached", async () => {
    // The reported case: one gradeable entry, its grade failed, nothing ranked. The old page drew
    // "nothing has finished grading yet" and stopped, so the organizer could not tell which app
    // failed, or that one had.
    seed({
      entries: [{ project_url: "https://devpost.com/software/plant-doctor", skip_reason: null, grade_id: "g1" }],
      grades: [{ id: "g1", status: "failed", retry_due_at: null, retry_passes: 0 }],
    });
    const html = await markup();
    expect(html).toMatch(/didn&#x27;t finish|didn't finish/);
    expect(html).toContain("plant-doctor");
    expect(html).not.toContain("Nothing has finished grading yet");
  });

  it("accounts for entries nobody tried to grade", async () => {
    // The header counts the whole field, so an entry missing from every list below it reads as the
    // count being wrong rather than as the entry having nothing behind it.
    seed({
      entries: [
        { project_url: "https://devpost.com/software/decisionlite", skip_reason: "github only", grade_id: null },
      ],
    });
    const html = await markup();
    expect(html).toContain("Nothing to grade");
    expect(html).toContain("decisionlite");
    expect(html).toContain("github only");
  });

  it("keeps the two answers apart", async () => {
    // "We tried and could not" and "there was nothing to try" are different things to tell an
    // organizer, and only the first is about an app being unwell.
    seed({
      entries: [
        { project_url: "https://devpost.com/software/plant-doctor", skip_reason: null, grade_id: "g1" },
        { project_url: "https://devpost.com/software/decisionlite", skip_reason: "github only", grade_id: null },
      ],
      grades: [{ id: "g1", status: "failed", retry_due_at: null, retry_passes: 0 }],
    });
    const html = await markup();
    expect(html).toContain("plant-doctor");
    expect(html).toContain("decisionlite");
    expect(html).toContain("Nothing to grade");
    expect(html).toMatch(/didn&#x27;t finish|didn't finish/);
  });

  it("says nothing has finished only when the run really has produced nothing at all", async () => {
    // The sentence still has a job: a field that is queued and untouched has no failures to show
    // either, and an empty page there is the truth.
    seed({
      entries: [{ project_url: "https://devpost.com/software/plant-doctor", skip_reason: null, grade_id: "g1" }],
      grades: [{ id: "g1", status: "queued", retry_due_at: null, retry_passes: 0 }],
    });
    const html = await markup();
    expect(html).toContain("Nothing has finished grading yet");
  });
});
