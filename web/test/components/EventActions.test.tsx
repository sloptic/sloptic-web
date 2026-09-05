import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventActions from "@/app/events/[slug]/EventActions";
import type { Entry, Grade, Run } from "@/lib/event-runs";
import type { RecoveryMarks } from "@/lib/grades";

// The run card is the only place an organizer authorises traffic at other people's apps, so a
// number on a button has to be the number that button queues. The confirm route decides what is
// actually enqueued (skip_reason null, plus either no grade or a FINISHED one: done, failed or
// cancelled), and the card's counts are tested against that rule rather than against themselves.

const NO_MARKS: RecoveryMarks = { retry: false, none: false, partial: false, full: false, limited: false };

function grade(status: string, over: Partial<Grade> = {}): Grade {
  return {
    status,
    progress: null,
    claimed_at: null,
    finished_at: null,
    retry_due_at: null,
    retry_passes: 0,
    marks: { ...NO_MARKS },
    ...over,
  };
}
let seq = 0;
function entry(over: Partial<Entry> = {}): Entry {
  seq += 1;
  return {
    project_url: `https://devpost.example/software/app-${seq}`,
    app_url: `https://app-${seq}.example`,
    skip_reason: null,
    grade_id: null,
    grades: null,
    ...over,
  };
}
/** An entry whose grade reached `status`. A grade always leaves a link behind it. */
function withGrade(status: string, over: Partial<Grade> = {}): Entry {
  seq += 1;
  return {
    project_url: `https://devpost.example/software/app-${seq}`,
    app_url: `https://app-${seq}.example`,
    skip_reason: null,
    grade_id: `grade-${seq}`,
    grades: grade(status, over),
  };
}
function skipped(reason = "no live link"): Entry {
  return entry({ skip_reason: reason });
}
function run(over: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    slug: "hackathon",
    mode: "passive",
    status: "ready",
    override: false,
    admin: false,
    priority: null,
    entries_found: null,
    gallery_complete: null,
    detail: null,
    created_at: "2026-09-01T10:00:00.000Z",
    resolved_at: null,
    paused: false,
    refresh_new_submissions: null,
    refresh_modified_submissions: null,
    event_entries: [],
    ...over,
  };
}

let posted: { url: string; body: Record<string, unknown> }[] = [];
function stubFetch(reply: { ok?: boolean; body?: Record<string, unknown> } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: reply.ok ?? true, json: async () => reply.body ?? { queued: 0 } } as Response;
    }
    // The mount fetch is refused so the seeded run stays put and each test controls its own state.
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The one line under the run card that names where the run stands. */
function runLine(): string {
  return document.querySelector(".runhead .st")?.textContent ?? "";
}
function button(name: string | RegExp) {
  return screen.getByRole("button", { name });
}
function maybeButton(name: string | RegExp) {
  return screen.queryByRole("button", { name });
}
function chips(): string[] {
  return Array.from(document.querySelectorAll(".chips .tag")).map((t) => t.textContent?.trim() ?? "");
}
function show(props: Partial<Parameters<typeof EventActions>[0]> = {}) {
  return render(
    <EventActions slug="hackathon" verified canActive={false} canOverride={false} initialRuns={[]} {...props} />
  );
}

beforeEach(() => {
  posted = [];
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runLine, where a run stands", () => {
  it("says the gallery is being read, with the count so far", () => {
    show({ initialRuns: [run({ status: "resolving", entries_found: 12 })] });
    expect(runLine()).toContain("reading the gallery, 12 found so far");
  });

  it("says the gallery is being read before any count exists", () => {
    show({ initialRuns: [run({ status: "resolving", entries_found: null })] });
    expect(runLine()).toBe("reading the gallery");
  });

  it("says an empty gallery is empty rather than showing a ready field of nothing", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [] })] });
    expect(runLine()).toContain("ready, nothing in the gallery yet");
  });

  it("counts the whole resolved field on a ready run", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), entry(), skipped()] })] });
    expect(runLine()).toContain("ready, 3 entries");
  });

  it("names the battery the run will use", () => {
    show({ initialRuns: [run({ status: "ready", mode: "active", event_entries: [entry()] })] });
    expect(runLine()).toContain("active");
  });

  it("never calls a passive run anything but passive", () => {
    show({ initialRuns: [run({ status: "ready", mode: "passive", event_entries: [entry()] })] });
    expect(runLine()).toContain("passive");
    expect(runLine()).not.toContain("active");
  });

  it("says what a paused run is holding", () => {
    show({
      initialRuns: [
        run({
          status: "grading",
          paused: true,
          event_entries: [withGrade("queued"), withGrade("queued"), withGrade("running"), withGrade("done")],
        }),
      ],
    });
    expect(runLine()).toContain("paused, 2 waiting, 1 running");
  });

  // "A run confirmed while another is still going sits at zero for hours. Saying it is queued is
  //  the difference between waiting and looking broken."
  it("says a run is queued behind another when nothing of it has started", () => {
    show({
      initialRuns: [run({ status: "grading", event_entries: [withGrade("queued"), withGrade("queued"), withGrade("queued")] })],
    });
    expect(runLine()).toContain("queued with 3 entries waiting, another run is grading first");
  });

  it("counts done against the gradeable field while grades are in flight", () => {
    show({
      initialRuns: [
        run({
          status: "grading",
          event_entries: [withGrade("done"), withGrade("done"), withGrade("queued"), withGrade("queued"), withGrade("running"), entry(), skipped()],
        }),
      ],
    });
    expect(runLine()).toContain("grading, 2 of 6 done, 1 running");
  });

  it("says how many could not be reached once nothing is left in flight", () => {
    show({
      initialRuns: [
        run({
          status: "grading",
          event_entries: [withGrade("done"), withGrade("done"), withGrade("failed"), withGrade("failed"), entry(), skipped()],
        }),
      ],
    });
    expect(runLine()).toContain("grading, 2 of 5 graded, 2 could not be reached");
  });

  it("keeps the could-not-be-reached clause away when everything landed", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("done"), withGrade("done")] })] });
    expect(runLine()).toContain("grading, 2 of 2 graded");
    expect(runLine()).not.toContain("could not be reached");
  });

  it("excludes skipped entries from the field a run is measured against", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("done"), skipped(), skipped()] })] });
    expect(runLine()).toContain("1 of 1 graded");
  });

  it("uses no em dash in the run line", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("done"), withGrade("running")] })] });
    expect(runLine()).not.toContain("\u2014");
  });
});

describe("the ready run's controls", () => {
  // The mixed field the counts have to survive: 2 never tried, 3 done, 1 failed, 1 cancelled, 1
  // queued, 1 running, 1 skipped. The confirm route regrades the finished ones and the untried
  // ones, never the two in flight and never the skipped one, so 2 + 5 = 7.
  const mixed = () =>
    run({
      status: "ready",
      event_entries: [
        entry(),
        entry(),
        withGrade("done"),
        withGrade("done"),
        withGrade("done"),
        withGrade("failed"),
        withGrade("cancelled"),
        withGrade("queued"),
        withGrade("running"),
        skipped(),
      ],
    });

  it("offers to grade exactly the entries that have never been tried", () => {
    show({ initialRuns: [mixed()] });
    expect(button(/^Grade \d+ entries$/)).toHaveTextContent("Grade 2 entries");
  });

  it("counts a regrade as the untried plus every finished grade, in-flight excluded", () => {
    show({ initialRuns: [mixed()] });
    expect(button(/^Regrade all/)).toHaveTextContent("Regrade all 7");
  });

  it("counts a cancelled grade as regradable, as the confirm route does", () => {
    const a = run({ status: "ready", event_entries: [withGrade("done"), withGrade("cancelled")] });
    const b = run({ status: "ready", event_entries: [withGrade("done")] });
    const { unmount } = show({ initialRuns: [a] });
    expect(button(/^Regrade all/)).toHaveTextContent("Regrade all 2");
    unmount();
    show({ initialRuns: [b] });
    expect(button(/^Regrade all/)).toHaveTextContent("Regrade all 1");
  });

  it("never counts a skipped entry into either button", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), skipped(), skipped(), withGrade("done")] })] });
    expect(button(/^Grade \d+ entries$/)).toHaveTextContent("Grade 1 entries");
    expect(button(/^Regrade all/)).toHaveTextContent("Regrade all 2");
  });

  it("hides the grade button when nothing is left untried", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [withGrade("done")] })] });
    expect(maybeButton(/^Grade \d+ entries$/)).toBeNull();
    expect(button(/^Regrade all/)).toBeInTheDocument();
  });

  it("hides the regrade button when nothing has been graded yet", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), entry()] })] });
    expect(maybeButton(/^Regrade all/)).toBeNull();
    expect(button(/^Grade \d+ entries$/)).toBeInTheDocument();
  });

  it("confirms the run without a regrade when the grade button is pressed", async () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry()] })] });
    fireEvent.click(button(/^Grade \d+ entries$/));
    await waitFor(() => expect(posted.some((p) => p.url === "/api/events/run/confirm")).toBe(true));
    expect(posted[0].body).toEqual({ id: "run-1" });
  });

  it("asks for a regrade explicitly when the regrade button is pressed", async () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [withGrade("done")] })] });
    fireEvent.click(button(/^Regrade all/));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ id: "run-1", regrade: true });
  });

  it("reports the server's own queued count rather than the button's", async () => {
    stubFetch({ body: { queued: 7 } });
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), entry()] })] });
    fireEvent.click(button(/^Grade \d+ entries$/));
    expect(await screen.findByText("Queued 7.")).toBeInTheDocument();
  });

  it("offers only a re-read and a cancel when the gallery came back empty", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [] })] });
    expect(button("Read the gallery again")).toBeInTheDocument();
    expect(button("Cancel run")).toBeInTheDocument();
    expect(maybeButton(/^Grade \d+ entries$/)).toBeNull();
    expect(maybeButton("passive")).toBeNull();
  });

  it("keeps a refresh on offer while the gallery could still grow", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry()] })] });
    fireEvent.click(button("Refresh gallery"));
    expect(posted[0]?.url).toBe("/api/events/run/refresh");
  });
});

describe("the battery toggle", () => {
  const ready = (over: Partial<Run> = {}) => run({ status: "ready", event_entries: [entry()], ...over });

  it("says which battery is selected, in a way a screen reader can hear", () => {
    show({ initialRuns: [ready({ mode: "passive" })], canActive: true });
    expect(button("passive")).toHaveAttribute("aria-pressed", "true");
    expect(button("active")).toHaveAttribute("aria-pressed", "false");
  });

  it("names the group so the two buttons read as one choice", () => {
    show({ initialRuns: [ready()], canActive: true });
    expect(screen.getByRole("group", { name: "battery for this run" })).toBeInTheDocument();
  });

  it("does not offer to re-select the battery already chosen", () => {
    show({ initialRuns: [ready({ mode: "passive" })], canActive: true });
    expect(button("passive")).toBeDisabled();
    expect(button("active")).toBeEnabled();
  });

  // Active probing is a gated tier: without the verified disclosure the button must not be usable,
  // and it must say why rather than failing silently on the server.
  it("refuses the active battery without the disclosure, and says why", () => {
    show({ initialRuns: [ready()], canActive: false });
    expect(button("active")).toBeDisabled();
    expect(button("active").getAttribute("title")).toMatch(/disclosure verified before the deadline/);
  });

  it("carries no title when active is genuinely on offer", () => {
    show({ initialRuns: [ready()], canActive: true });
    expect(button("active")).not.toHaveAttribute("title");
  });

  it("switches the battery through the run's own endpoint", async () => {
    show({ initialRuns: [ready({ mode: "passive" })], canActive: true });
    fireEvent.click(button("active"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/events/run/mode", body: { id: "run-1", mode: "active" } });
  });

  it("warns about live demos only when the run will actually probe actively", () => {
    const { unmount } = show({ initialRuns: [ready({ mode: "active" })], canActive: true });
    expect(screen.getByText(/Avoid running this during live demos/)).toBeInTheDocument();
    unmount();
    show({ initialRuns: [ready({ mode: "passive" })], canActive: true });
    expect(screen.queryByText(/Avoid running this during live demos/)).toBeNull();
  });
});

describe("the grading run's controls", () => {
  const grading = (over: Partial<Run> = {}) =>
    run({
      status: "grading",
      event_entries: [withGrade("done"), withGrade("running"), withGrade("queued"), withGrade("queued"), entry()],
      ...over,
    });

  it("offers to queue entries a refresh added mid-run", () => {
    show({ initialRuns: [grading()] });
    expect(button(/^Grade \d+ new entries$/)).toHaveTextContent("Grade 1 new entries");
  });

  it("keeps that offer away when nothing new arrived", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("running")] })] });
    expect(maybeButton(/new entries$/)).toBeNull();
  });

  // "A paused run refuses confirm, and refresh would silently release the hold."
  it("offers neither a confirm nor a refresh while paused", () => {
    show({ initialRuns: [grading({ paused: true })] });
    expect(maybeButton(/new entries$/)).toBeNull();
    expect(maybeButton("Refresh gallery")).toBeNull();
  });

  it("offers to resume a paused run and to pause a running one", () => {
    const { unmount } = show({ initialRuns: [grading({ paused: true })] });
    expect(button("Resume grading")).toBeInTheDocument();
    unmount();
    show({ initialRuns: [grading()] });
    expect(button("Pause grading")).toBeInTheDocument();
  });

  it("flips the pause the other way when pressed", async () => {
    show({ initialRuns: [grading({ paused: true })] });
    fireEvent.click(button("Resume grading"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/events/run/pause", body: { id: "run-1", paused: false } });
  });

  it("leads to the leaderboard while grading", () => {
    show({ initialRuns: [grading()] });
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/events/hackathon/run-1");
  });

  it("fills the progress bar by what has landed of what was committed", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("done"), withGrade("done"), withGrade("queued"), withGrade("running")] })] });
    expect(document.querySelector(".progress-fill")).toHaveStyle({ width: "50%" });
  });

  it("counts the queued grades a cancel would stop", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show({ initialRuns: [grading()] });
    fireEvent.click(button("Cancel run"));
    expect(confirm.mock.calls[0][0]).toContain("The 2 queued grades stop");
    confirm.mockRestore();
  });

  it("does not cancel when the organizer backs out of the dialog", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show({ initialRuns: [grading()] });
    fireEvent.click(button("Cancel run"));
    expect(posted).toHaveLength(0);
    confirm.mockRestore();
  });

  it("cancels once the dialog is accepted", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show({ initialRuns: [grading()] });
    fireEvent.click(button("Cancel run"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/events/run/cancel", body: { id: "run-1" } });
    confirm.mockRestore();
  });

  // Migration 0024 and the cancel route both keep running grades: "a grade is minutes, and killing
  // children mid-flight is worse than letting them land". The dialog must not promise otherwise.
  it.fails("does not promise that running grades are stopped, because they are not", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show({ initialRuns: [grading()] });
    fireEvent.click(button("Cancel run"));
    const text = String(confirm.mock.calls[0][0]);
    confirm.mockRestore();
    expect(text).not.toMatch(/already running are stopped/);
  });

  it("uses no em dash in the cancel dialog", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show({ initialRuns: [grading()] });
    fireEvent.click(button("Cancel run"));
    expect(String(confirm.mock.calls[0][0])).not.toContain("\u2014");
    confirm.mockRestore();
  });
});

describe("the estimate under the card", () => {
  const eta = () => Array.from(document.querySelectorAll(".runhead .st")).slice(1).map((s) => s.textContent ?? "")[0];

  // "Ready means the whole ungraded field if it is confirmed."
  it("estimates the whole untried field on a ready run", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), entry(), entry()] })] });
    expect(eta()).toMatch(/minute|hour/);
  });

  it("offers no estimate for a ready run with nothing left to grade", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [withGrade("done")] })] });
    expect(eta()).toBeUndefined();
  });

  // "Grading means what is in flight, since apps nobody has ticked yet wait on a person."
  it("estimates only what is in flight on a grading run", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [entry(), entry(), entry()] })] });
    expect(eta()).toBeUndefined();
  });

  it("estimates the queue once entries are actually in flight", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("queued"), withGrade("running")] })] });
    expect(eta()).toMatch(/minute|hour/);
  });

  // A paused run's queue waits on a person, so a countdown would be counting down to nothing.
  it("offers no estimate while the run is paused", () => {
    show({ initialRuns: [run({ status: "grading", paused: true, event_entries: [withGrade("queued")] })] });
    expect(eta()).toBeUndefined();
  });

  it("says when priority grading is on", () => {
    show({ initialRuns: [run({ status: "grading", priority: 0, event_entries: [withGrade("queued")] })] });
    expect(eta()).toContain("priority grading active");
  });

  it("stays quiet about priority when the run is in the ordinary lane", () => {
    show({ initialRuns: [run({ status: "grading", priority: 5, event_entries: [withGrade("queued")] })] });
    expect(eta()).not.toContain("priority");
  });
});

describe("the run card's chips", () => {
  it("counts the field, what is left and what is graded", () => {
    show({
      initialRuns: [run({ status: "ready", event_entries: [entry(), entry(), withGrade("done"), skipped("no live link")] })],
    });
    expect(chips()).toEqual(["4 entries", "2 to grade", "1 graded", "1 no live link"]);
  });

  it("leaves out a count of nothing rather than showing a zero", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry()] })] });
    expect(chips()).toEqual(["1 entries", "1 to grade"]);
  });

  it("puts the commonest skip reason first", () => {
    show({
      initialRuns: [
        run({
          status: "ready",
          event_entries: [skipped("no live link"), skipped("duplicate"), skipped("duplicate"), entry()],
        }),
      ],
    });
    expect(chips().slice(2)).toEqual(["2 duplicate", "1 no live link"]);
  });

  it("shows no chips for an empty field", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [] })] });
    expect(chips()).toEqual([]);
  });

  it("notes an incomplete gallery, so the field is not read as the whole one", () => {
    show({ initialRuns: [run({ status: "ready", gallery_complete: false, event_entries: [entry()] })] });
    expect(screen.getByText("Incomplete gallery, so this is not the whole field.")).toBeInTheDocument();
  });

  it("says nothing about the gallery when it came back whole", () => {
    show({ initialRuns: [run({ status: "ready", gallery_complete: true, event_entries: [entry()] })] });
    expect(screen.queryByText(/Incomplete gallery/)).toBeNull();
  });

  it("says plainly when a refresh changed nothing", () => {
    show({
      initialRuns: [run({ status: "ready", refresh_new_submissions: 0, refresh_modified_submissions: 0, event_entries: [entry()] })],
    });
    expect(screen.getByText(/the gallery has not changed/)).toBeInTheDocument();
  });

  it("counts one new submission in the singular", () => {
    show({
      initialRuns: [run({ status: "ready", refresh_new_submissions: 1, refresh_modified_submissions: 1, event_entries: [entry()] })],
    });
    expect(screen.getByText("The last refresh found 1 new submission and 1 update.")).toBeInTheDocument();
  });

  it("counts several in the plural", () => {
    show({
      initialRuns: [run({ status: "ready", refresh_new_submissions: 3, refresh_modified_submissions: 2, event_entries: [entry()] })],
    });
    expect(screen.getByText("The last refresh found 3 new submissions and 2 updates.")).toBeInTheDocument();
  });
});

describe("when no run is live", () => {
  it("offers a first run to a verified organizer", () => {
    show({ initialRuns: [] });
    expect(button("Grade this event")).toBeInTheDocument();
    expect(runLine()).toBe("no runs yet");
  });

  it("offers another run once one has settled, and names the last one", () => {
    show({ initialRuns: [run({ status: "done", mode: "passive" })] });
    expect(button("Grade it again")).toBeInTheDocument();
    expect(runLine()).toContain("passive, done");
  });

  it("names a cancelled run as cancelled", () => {
    show({ initialRuns: [run({ status: "cancelled" })] });
    expect(runLine()).toContain("cancelled");
  });

  it("names a failed run as failed", () => {
    show({ initialRuns: [run({ status: "failed" })] });
    expect(runLine()).toContain("failed");
  });

  it("offers an active run only when the disclosure allows it", () => {
    const { unmount } = show({ canActive: true });
    expect(button("Grade actively")).toBeInTheDocument();
    unmount();
    show({ canActive: false });
    expect(maybeButton("Grade actively")).toBeNull();
  });

  it("asks for the active battery by name", async () => {
    show({ canActive: true });
    fireEvent.click(button("Grade actively"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/events/run", body: { event: "hackathon", mode: "active" } });
  });

  it("starts the default run without naming a battery", async () => {
    show({});
    fireEvent.click(button("Grade this event"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ event: "hackathon" });
  });

  it("shows no run card at all to someone who has not verified the event", () => {
    show({ verified: false, initialRuns: [] });
    expect(document.querySelector(".run-card")).toBeNull();
    expect(maybeButton("Grade this event")).toBeNull();
  });

  it("shows the card to an admin override", () => {
    show({ verified: false, canOverride: true });
    expect(button("Grade this event")).toBeInTheDocument();
  });

  it("shows the card once the claim itself reads verified", () => {
    show({
      verified: false,
      initialClaim: { id: "c1", slug: "hackathon", token: "tok", status: "verified", check_status: "ok", check_detail: null, checked_at: null },
    });
    expect(button("Grade this event")).toBeInTheDocument();
  });

  it("still shows a live run's card to an unverified viewer, since the run exists", () => {
    show({ verified: false, initialRuns: [run({ status: "grading", event_entries: [withGrade("running")] })] });
    expect(document.querySelector(".run-card")).not.toBeNull();
  });
});

describe("the run history", () => {
  const live = run({ id: "live", status: "grading", event_entries: [withGrade("running")] });

  it("says so when the live run is the only one", () => {
    show({ initialRuns: [live] });
    expect(screen.getByText("The run above is the only one.")).toBeInTheDocument();
  });

  it("says so when there are no runs at all", () => {
    show({ initialRuns: [] });
    expect(screen.getByText("None yet.")).toBeInTheDocument();
  });

  it("counts a past run as graded against its gradeable field", () => {
    show({
      initialRuns: [
        run({ id: "old", status: "done", event_entries: [withGrade("done"), withGrade("failed"), skipped()] }),
      ],
    });
    const row = document.querySelector(".history-table tbody tr")!;
    expect(row.querySelectorAll("td")[3]).toHaveTextContent("1 / 2");
  });

  it("prefers the resolver's own count of what the gallery held", () => {
    show({ initialRuns: [run({ id: "old", status: "done", entries_found: 52, event_entries: [withGrade("done")] })] });
    const row = document.querySelector(".history-table tbody tr")!;
    expect(row.querySelectorAll("td")[2]).toHaveTextContent("52");
  });

  it("says whether the gallery it read was complete", () => {
    show({
      initialRuns: [
        run({ id: "a", status: "done", gallery_complete: false }),
        run({ id: "b", status: "done", gallery_complete: true }),
        run({ id: "c", status: "done", gallery_complete: null }),
      ],
    });
    const cells = Array.from(document.querySelectorAll(".history-table tbody tr")).map(
      (r) => r.querySelectorAll("td")[4].textContent
    );
    expect(cells).toEqual(["short", "complete", "unknown"]);
  });

  it("names the battery each past run used", () => {
    show({ initialRuns: [run({ id: "old", status: "done", mode: "active" })] });
    expect(document.querySelector(".history-table .tag")).toHaveTextContent("active");
  });

  // "A second live run on one event is a thing no card can steer, so the button says why before it
  //  is pressed."
  it("refuses to refresh a past run while another is live, and says why", () => {
    show({ initialRuns: [live, run({ id: "old", status: "done" })] });
    const refresh = button("refresh");
    expect(refresh).toBeDisabled();
    expect(refresh.getAttribute("title")).toMatch(/still going/);
  });

  it("allows a refresh once nothing is live", () => {
    show({ initialRuns: [run({ id: "old", status: "done" })] });
    expect(button("refresh")).toBeEnabled();
  });

  it("offers no leaderboard for a run that never got past resolving", () => {
    show({ initialRuns: [live, run({ id: "old", status: "resolving" })] });
    expect(screen.queryByRole("link", { name: "leaderboard" })).toBeNull();
  });

  it("links a settled run to its leaderboard", () => {
    show({ initialRuns: [run({ id: "old", status: "done" })] });
    expect(screen.getByRole("link", { name: "leaderboard" })).toHaveAttribute("href", "/events/hackathon/old");
  });
});

describe("the verification slip", () => {
  const pendingClaim = {
    id: "c1",
    slug: "hackathon",
    token: "tok-123",
    status: "pending" as const,
    check_status: null,
    check_detail: null,
    checked_at: null,
  };

  it("shows the link an organizer has to publish", () => {
    show({ verified: false, initialClaim: pendingClaim });
    expect(document.querySelector(".token-link")).toHaveTextContent("/e/tok-123");
  });

  it("says nothing has been checked yet before the first check", () => {
    show({ verified: false, initialClaim: pendingClaim });
    expect(screen.getByText("Waiting for the first check.")).toBeInTheDocument();
  });

  // Devpost fetches are tri-state: blocked means COULD NOT CHECK, never "not verified".
  it("says Devpost did not answer, not that the link is missing, when a check was blocked", () => {
    show({ verified: false, initialClaim: { ...pendingClaim, check_status: "blocked", checked_at: "2026-09-01T10:00:00.000Z" } });
    expect(screen.getByText("Devpost did not answer our last check. We are trying again.")).toBeInTheDocument();
  });

  it("distinguishes an unfound event from an unfound link", () => {
    const { unmount } = show({
      verified: false,
      initialClaim: { ...pendingClaim, check_status: "not_found", checked_at: "2026-09-01T10:00:00.000Z" },
    });
    expect(screen.getByText("We could not find that event on Devpost.")).toBeInTheDocument();
    unmount();
    show({ verified: false, initialClaim: { ...pendingClaim, check_status: "ok", checked_at: "2026-09-01T10:00:00.000Z" } });
    expect(screen.getByText("We could not find our link on your page yet.")).toBeInTheDocument();
  });

  it("owns an error on our side rather than blaming the organizer", () => {
    show({ verified: false, initialClaim: { ...pendingClaim, check_status: "error", checked_at: "2026-09-01T10:00:00.000Z" } });
    expect(screen.getByText(/went wrong on our side/)).toBeInTheDocument();
  });

  it("asks Devpost again on demand", async () => {
    show({ verified: false, initialClaim: pendingClaim });
    fireEvent.click(button(/^Check now$/));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/events/recheck", body: { id: "c1" } });
  });

  it("tells a verified organizer where the link was found and how long the grant runs", () => {
    show({
      initialClaim: { ...pendingClaim, status: "verified", check_status: "ok", checked_at: null },
      verifiedLink: { page: "rules", text: "Grading policy" },
      grantExpiry: "2026-12-01T00:00:00.000Z",
    });
    expect(screen.getByText(/Link found on the rules page, with text saying "Grading policy"\./)).toBeInTheDocument();
    expect(screen.getByText(/Active until/)).toBeInTheDocument();
  });

  it("falls back to a plain confirmation on a grant verified before the link was recorded", () => {
    show({
      initialClaim: { ...pendingClaim, status: "verified", check_status: "ok", check_detail: null, checked_at: null },
      verifiedLink: null,
    });
    expect(screen.getByText("Link found.")).toBeInTheDocument();
  });

  it("shows no verification section to an organizer with nothing to prove", () => {
    show({ initialClaim: null });
    expect(document.querySelector(".token-link")).toBeNull();
    expect(maybeButton(/^Check now$/)).toBeNull();
  });

  it("uses no em dash in any verdict line", () => {
    for (const s of ["blocked", "not_found", "error", "ok"] as const) {
      const { unmount } = show({ verified: false, initialClaim: { ...pendingClaim, check_status: s, checked_at: "2026-09-01T10:00:00.000Z" } });
      expect(document.querySelector(".verdict-line")?.textContent ?? "").not.toContain("\u2014");
      unmount();
    }
  });
});

describe("the field under the card", () => {
  it("shows the live run's field", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [entry(), entry()] })] });
    expect(document.querySelector("summary")).toHaveTextContent("the field (2)");
  });

  it("shows no field for a run whose gallery came back empty", () => {
    show({ initialRuns: [run({ status: "ready", event_entries: [] })] });
    expect(document.querySelector("summary")).toBeNull();
  });

  // "Unmounting it the moment the run settles is how B froze at shortly."
  it("keeps a settled run's field while its retries are still outstanding, under its own heading", () => {
    show({
      initialRuns: [
        run({ id: "old", status: "done", event_entries: [withGrade("done", { retry_due_at: "2099-01-01T00:00:00.000Z" })] }),
      ],
    });
    expect(document.querySelector("summary")).toHaveTextContent("the field (1)");
    expect(screen.getByRole("heading", { name: /Field of the run from/ })).toBeInTheDocument();
  });

  it("drops a settled run's field once nothing is outstanding", () => {
    show({ initialRuns: [run({ id: "old", status: "done", event_entries: [withGrade("done")] })] });
    expect(document.querySelector("summary")).toBeNull();
  });

  it("needs no heading for the live run's own field", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("running")] })] });
    expect(screen.queryByRole("heading", { name: /Field of the run from/ })).toBeNull();
  });

  // End to end: a plain finished field must not print a key to letters that appear nowhere on it.
  it("does not key recovery letters under a field that has none", () => {
    show({ initialRuns: [run({ status: "grading", event_entries: [withGrade("done"), withGrade("done")] })] });
    expect(document.querySelector("p.marks-key")).toBeNull();
  });

  it("offers one-at-a-time grading only while the run can still take work", () => {
    const { unmount } = show({ initialRuns: [run({ status: "ready", event_entries: [entry()] })] });
    expect(screen.getAllByRole("button", { name: "grade now" }).length).toBe(1);
    unmount();
    show({
      initialRuns: [
        run({ id: "old", status: "done", event_entries: [entry(), withGrade("done", { retry_due_at: "2099-01-01T00:00:00.000Z" })] }),
      ],
    });
    expect(screen.queryByRole("button", { name: "grade now" })).toBeNull();
  });
});
