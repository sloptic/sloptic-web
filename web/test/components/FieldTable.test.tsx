import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FieldTable, { type FieldEntry } from "@/app/events/[slug]/FieldTable";
import type { RecoveryMarks } from "@/lib/grades";

// The field is the staging view an organizer reads before pointing traffic at other people's apps,
// so every number on it has to be the number the control beside it acts on. The three filters, the
// two select-all boxes and the queue button all count the same field in different ways, and a
// disagreement between any two of them is how "Regrade 29" once queued 39.

const NO_MARKS: RecoveryMarks = { retry: false, none: false, partial: false, full: false, limited: false };
const marks = (over: Partial<RecoveryMarks> = {}): RecoveryMarks => ({ ...NO_MARKS, ...over });

function entry(name: string, over: Partial<FieldEntry> = {}): FieldEntry {
  return {
    project_url: `https://devpost.example/software/${name}`,
    skip_reason: null,
    grade_id: null,
    status: null,
    progress: null,
    ...over,
  };
}
/** An entry whose grade reached `status`. A grade always carries a link once it exists. */
function graded(name: string, status: string, over: Partial<FieldEntry> = {}): FieldEntry {
  return entry(name, { grade_id: `grade-${name}`, status, ...over });
}
function skipped(name: string, reason = "no live link"): FieldEntry {
  return entry(name, { skip_reason: reason });
}

function names(): string[] {
  return Array.from(document.querySelectorAll("tbody tr th[scope=row] a")).map((a) => a.textContent ?? "");
}
/** The state cell of each visible row: the first band-note td, whether or not a pick column
 *  sits ahead of it. */
function states(): string[] {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelectorAll("td.band-note")[0]?.textContent ?? ""
  );
}
/** The per-row tick boxes, which live in the pick column and nowhere else. */
function rowBoxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll("tbody tr td.pick-col input"));
}
function rowCount(): number {
  return document.querySelectorAll("tbody tr").length;
}
function filterLabel(word: string): HTMLElement {
  return Array.from(document.querySelectorAll("label.field-filter")).find((l) =>
    (l.textContent ?? "").trim().startsWith(word)
  ) as HTMLElement;
}
function filterBox(word: string): HTMLInputElement {
  return filterLabel(word).querySelector("input")!;
}
/** The number a filter's own label promises. */
function filterCount(word: string): number {
  const m = (filterLabel(word).textContent ?? "").match(/\((\d+)\)/);
  return Number(m?.[1] ?? NaN);
}

// The body is parsed JSON, so the fields the assertions read are named rather than left as unknown.
let posted: { url: string; body: { runId?: string; projectUrls?: string[] } }[] = [];
function stubFetch(reply: { ok?: boolean; body?: Record<string, unknown> } = {}) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: reply.ok ?? true,
      json: async () => reply.body ?? { queued: posted[posted.length - 1].body.projectUrls?.length ?? 0 },
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  posted = [];
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FieldTable summary and empty states", () => {
  it("counts the whole field in the summary, not the filtered view", () => {
    render(<FieldTable entries={[entry("a"), graded("b", "done"), skipped("c")]} />);
    expect(document.querySelector("summary")).toHaveTextContent("the field (3)");
  });

  it("renders an empty field without rows and without a pager", () => {
    render(<FieldTable entries={[]} />);
    expect(document.querySelector("summary")).toHaveTextContent("the field (0)");
    expect(rowCount()).toBe(0);
    expect(document.querySelector(".pager")).toBeNull();
  });

  it("renders a single entry", () => {
    render(<FieldTable entries={[entry("only")]} />);
    expect(names()).toEqual(["only"]);
  });

  it("shows an empty table, not a stale one, when every row is filtered out", () => {
    render(<FieldTable entries={[entry("a"), entry("b")]} />);
    fireEvent.click(filterBox("graded"));
    expect(rowCount()).toBe(0);
    expect(filterCount("graded")).toBe(0);
  });

  it("shows an empty table when the search matches nothing", () => {
    render(<FieldTable entries={[entry("alpha"), entry("beta")]} />);
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "zzz" } });
    expect(rowCount()).toBe(0);
  });
});

describe("FieldTable filters", () => {
  // Three disjoint groups keyed on grade STATUS. A link alone is not a grade: ten failed grades
  // carrying links must not be counted as graded.
  const field = [
    graded("done1", "done"),
    graded("done2", "done"),
    graded("fail1", "failed"),
    graded("run1", "running"),
    graded("queue1", "queued"),
    entry("fresh1"),
    entry("fresh2"),
    skipped("skip1"),
  ];

  it("counts graded as finished reports only", () => {
    render(<FieldTable entries={field} />);
    expect(filterCount("graded")).toBe(2);
  });

  it("counts not graded as everything gradeable that has no finished report", () => {
    render(<FieldTable entries={field} />);
    expect(filterCount("not graded")).toBe(5);
  });

  it("counts skipped as the entries that will never be graded", () => {
    render(<FieldTable entries={field} />);
    expect(filterCount("skipped")).toBe(1);
  });

  it("splits the field into three disjoint groups that add up to it", () => {
    render(<FieldTable entries={field} />);
    expect(filterCount("graded") + filterCount("not graded") + filterCount("skipped")).toBe(field.length);
  });

  it.each([
    ["graded", 2],
    ["not graded", 5],
    ["skipped", 1],
  ])("shows exactly as many rows for %s as its own count promises", (word, expected) => {
    render(<FieldTable entries={field} />);
    fireEvent.click(filterBox(word));
    expect(filterCount(word)).toBe(expected);
    expect(rowCount()).toBe(expected);
  });

  it("shows everything when no box is ticked", () => {
    render(<FieldTable entries={field} />);
    expect(rowCount()).toBe(field.length);
  });

  it("shows everything when all three boxes are ticked, since the groups are the whole field", () => {
    render(<FieldTable entries={field} />);
    fireEvent.click(filterBox("graded"));
    fireEvent.click(filterBox("not graded"));
    fireEvent.click(filterBox("skipped"));
    expect(rowCount()).toBe(field.length);
  });

  it("reads two ticked boxes as a union", () => {
    render(<FieldTable entries={field} />);
    fireEvent.click(filterBox("graded"));
    fireEvent.click(filterBox("skipped"));
    expect(rowCount()).toBe(3);
    expect(names().sort()).toEqual(["done1", "done2", "skip1"]);
  });

  it("never counts a skipped entry as graded or not graded", () => {
    render(<FieldTable entries={[skipped("s1"), skipped("s2")]} />);
    expect(filterCount("graded")).toBe(0);
    expect(filterCount("not graded")).toBe(0);
    expect(filterCount("skipped")).toBe(2);
  });

  it("untick puts the rest of the field back", () => {
    render(<FieldTable entries={field} />);
    fireEvent.click(filterBox("graded"));
    fireEvent.click(filterBox("graded"));
    expect(rowCount()).toBe(field.length);
  });
});

describe("FieldTable search", () => {
  const field = [entry("apple-pie"), entry("banana-bread"), entry("apricot")];

  it("matches the submission name, case-insensitively", () => {
    render(<FieldTable entries={field} />);
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "AP" } });
    expect(names().sort()).toEqual(["apple-pie", "apricot"]);
  });

  it("ignores surrounding whitespace", () => {
    render(<FieldTable entries={field} />);
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "  banana  " } });
    expect(names()).toEqual(["banana-bread"]);
  });

  it("composes with a filter rather than replacing it", () => {
    render(<FieldTable entries={[graded("apple", "done"), entry("apricot"), graded("banana", "done")]} />);
    fireEvent.click(filterBox("graded"));
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "ap" } });
    expect(names()).toEqual(["apple"]);
  });

  it("returns to the first page when the query changes", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByText("41 to 45 of 45")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "app-" } });
    expect(screen.getByText("1 to 20 of 45")).toBeInTheDocument();
  });
});

describe("FieldTable sorting", () => {
  // "Sorting the words would put 'did not respond' above 'in progress'." What is running comes
  // above what has a report, so a drip feed of finished grades cannot push the live ones to page 2.
  const field = [
    skipped("a-skip"),
    graded("b-failed", "failed"),
    entry("c-pending"),
    graded("d-queued", "queued"),
    graded("e-done", "done"),
    graded("f-run", "running"),
  ];

  it("opens on state, running first and skipped last", () => {
    render(<FieldTable entries={field} />);
    expect(names()).toEqual(["f-run", "e-done", "d-queued", "c-pending", "b-failed", "a-skip"]);
  });

  it("puts what is running above what already has a report", () => {
    render(<FieldTable entries={[graded("z-done", "done"), graded("a-run", "running")]} />);
    expect(names()).toEqual(["a-run", "z-done"]);
  });

  it("reverses the state groups on a second click", () => {
    render(<FieldTable entries={field} />);
    fireEvent.click(screen.getByRole("button", { name: /^state/ }));
    expect(names()).toEqual(["a-skip", "b-failed", "c-pending", "d-queued", "e-done", "f-run"]);
  });

  it("sorts by submission name when that column is clicked", () => {
    render(<FieldTable entries={field} />);
    fireEvent.click(screen.getByRole("button", { name: /^submission/ }));
    expect(names()).toEqual(["a-skip", "b-failed", "c-pending", "d-queued", "e-done", "f-run"]);
    fireEvent.click(screen.getByRole("button", { name: /^submission/ }));
    expect(names()).toEqual(["f-run", "e-done", "d-queued", "c-pending", "b-failed", "a-skip"]);
  });

  it("breaks a tie within one state by name", () => {
    render(<FieldTable entries={[entry("zulu"), entry("alpha"), entry("mike")]} />);
    expect(names()).toEqual(["alpha", "mike", "zulu"]);
  });

  it("reports the sort direction on the header itself", () => {
    render(<FieldTable entries={field} />);
    const state = screen.getByRole("columnheader", { name: /^state/ });
    expect(state).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /^state/ }));
    expect(state).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /^submission/ })).toHaveAttribute("aria-sort", "none");
  });

  it("offers both headers as keyboard-reachable buttons", () => {
    render(<FieldTable entries={field} />);
    for (const name of [/^submission/, /^state/]) {
      const b = screen.getByRole("button", { name });
      expect(b.tagName).toBe("BUTTON");
      b.focus();
      expect(document.activeElement).toBe(b);
    }
  });

  it("returns to the first page when a column is sorted", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    fireEvent.click(screen.getByRole("button", { name: /^submission/ }));
    expect(screen.getByText("1 to 20 of 45")).toBeInTheDocument();
  });
});

describe("FieldTable state cell", () => {
  it("says why an entry was skipped", () => {
    render(<FieldTable entries={[skipped("s", "no live link")]} />);
    expect(states()).toEqual(["skipped, no live link"]);
  });

  it("says waiting for a queued grade", () => {
    render(<FieldTable entries={[graded("q", "queued")]} />);
    expect(states()).toEqual(["waiting"]);
  });

  it("says did not finish for a failed grade, without blaming the app", () => {
    render(<FieldTable entries={[graded("f", "failed")]} />);
    expect(states()).toEqual(["did not finish"]);
  });

  it("says graded once a report exists", () => {
    render(<FieldTable entries={[graded("d", "done")]} />);
    expect(states()).toEqual(["graded"]);
  });

  it("says not graded while grading is still on offer", () => {
    render(<FieldTable entries={[entry("n")]} runId="r1" canGrade />);
    expect(states()).toEqual(["not graded"]);
  });

  it("says will be graded before the run is confirmed", () => {
    render(<FieldTable entries={[entry("n")]} />);
    expect(states()).toEqual(["will be graded"]);
  });

  // cancelled is a real grade status (0024), and a cancelled grade produced no report to link to.
  it("does not call a cancelled grade graded", () => {
    render(<FieldTable entries={[graded("c", "cancelled")]} />);
    expect(states()[0]).not.toBe("graded");
  });

  // Falling through to "graded" offered a report link to a grade that produced nothing.
  it("names the cancelled state", () => {
    render(<FieldTable entries={[graded("c", "cancelled")]} />);
    expect(states()[0]).toMatch(/cancel|stopped/i);
  });

  it("shows a real progress bar for a running grade", () => {
    render(<FieldTable entries={[graded("r", "running", { progress: { done: 30, total: 60 } })]} />);
    expect(screen.getByRole("link", { name: "30 of 60" })).toHaveAttribute("href", "/grade/grade-r");
    expect(document.querySelector(".progress-fill")).toHaveStyle({ width: "50%" });
    expect(document.querySelector(".progress-track")).not.toHaveClass("indeterminate");
  });

  it("falls back to starting before the first count arrives", () => {
    render(<FieldTable entries={[graded("r", "running", { progress: null })]} />);
    expect(screen.getByText("starting")).toBeInTheDocument();
    expect(document.querySelector(".progress-track")).toHaveClass("indeterminate");
  });

  it("treats a zero total as unknown rather than dividing by it", () => {
    render(<FieldTable entries={[graded("r", "running", { progress: { done: 0, total: 0 } })]} />);
    expect(screen.getByText("starting")).toBeInTheDocument();
  });

  it("shows the running slop preview as a running total, not a verdict", () => {
    render(<FieldTable entries={[graded("r", "running", { progress: { done: 3, total: 44, slop_preview: 12.5 } })]} />);
    expect(screen.getByText(/12\.5 slop so far/)).toBeInTheDocument();
  });
});

describe("FieldTable action cell", () => {
  it("links to the report once one exists", () => {
    render(<FieldTable entries={[graded("d", "done")]} />);
    expect(screen.getByRole("link", { name: "report" })).toHaveAttribute("href", "/grade/grade-d");
  });

  it("offers grade now only where grading is on offer and nothing has been tried", () => {
    render(<FieldTable entries={[entry("n"), graded("q", "queued"), skipped("s")]} runId="r1" canGrade />);
    expect(screen.getAllByRole("button", { name: "grade now" })).toHaveLength(1);
  });

  it("offers nothing to act on when grading is closed", () => {
    render(<FieldTable entries={[entry("n")]} />);
    expect(screen.queryByRole("button", { name: "grade now" })).toBeNull();
  });

  it("queues exactly the row it sits on", async () => {
    stubFetch();
    render(<FieldTable entries={[entry("one"), entry("two")]} runId="r1" canGrade />);
    fireEvent.click(screen.getAllByRole("button", { name: "grade now" })[0]);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toBe("/api/events/run/grade-one");
    expect(posted[0].body).toEqual({ runId: "r1", projectUrls: ["https://devpost.example/software/one"] });
  });

  it("reports what the server actually queued", async () => {
    stubFetch({ body: { queued: 1 } });
    render(<FieldTable entries={[entry("one")]} runId="r1" canGrade />);
    fireEvent.click(screen.getByRole("button", { name: "grade now" }));
    expect(await screen.findByText("Queued 1.")).toBeInTheDocument();
  });

  it("surfaces the server's refusal instead of pretending it queued", async () => {
    stubFetch({ ok: false, body: { error: "This run is paused. Resume grading first." } });
    render(<FieldTable entries={[entry("one")]} runId="r1" canGrade />);
    fireEvent.click(screen.getByRole("button", { name: "grade now" }));
    expect(await screen.findByText("This run is paused. Resume grading first.")).toBeInTheDocument();
  });

  it("does not fetch at all without a run to queue against", () => {
    const fn = stubFetch();
    render(<FieldTable entries={[entry("one")]} canGrade />);
    expect(screen.queryByRole("button", { name: "grade now" })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("tells the caller a grade was queued so the card can refresh", async () => {
    stubFetch();
    const onGraded = vi.fn();
    render(<FieldTable entries={[entry("one")]} runId="r1" canGrade onGraded={onGraded} />);
    fireEvent.click(screen.getByRole("button", { name: "grade now" }));
    await waitFor(() => expect(onGraded).toHaveBeenCalledTimes(1));
  });

  it("does not tell the caller anything when the queue was refused", async () => {
    stubFetch({ ok: false, body: { error: "no" } });
    const onGraded = vi.fn();
    render(<FieldTable entries={[entry("one")]} runId="r1" canGrade onGraded={onGraded} />);
    fireEvent.click(screen.getByRole("button", { name: "grade now" }));
    await screen.findByText("no");
    expect(onGraded).not.toHaveBeenCalled();
  });
});

describe("FieldTable selection", () => {
  const selectAll = () => filterLabel("select all");
  const queueButton = () => screen.getByRole("button", { name: /^Grade \d+ selected$/ });

  it("offers to select only what has never been graded", () => {
    render(
      <FieldTable
        entries={[entry("a"), entry("b"), graded("c", "done"), graded("d", "failed"), skipped("e")]}
        runId="r1"
        canGrade
      />
    );
    expect(selectAll()).toHaveTextContent("select all 2 not yet graded");
    expect(rowBoxes()).toHaveLength(2);
  });

  // The count on the control and the count it acts on are the same number or the control lies.
  it("queues exactly as many entries as the button names", async () => {
    stubFetch();
    render(<FieldTable entries={[entry("a"), entry("b"), entry("c"), graded("d", "done")]} runId="r1" canGrade />);
    fireEvent.click(selectAll().querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 3 selected");
    fireEvent.click(queueButton());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0].body.projectUrls as string[]).length).toBe(3);
  });

  it("never offers to queue an entry that already carries a grade", async () => {
    stubFetch();
    render(<FieldTable entries={[entry("a"), graded("b", "failed"), graded("c", "queued")]} runId="r1" canGrade />);
    fireEvent.click(selectAll().querySelector("input")!);
    fireEvent.click(queueButton());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.projectUrls).toEqual(["https://devpost.example/software/a"]);
  });

  // "Paging through 8 pages to tick each one is the tedium this is meant to remove."
  it("selects the whole filtered field, not just the visible page", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} runId="r1" canGrade />);
    expect(selectAll()).toHaveTextContent("select all 45 not yet graded");
    fireEvent.click(selectAll().querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 45 selected");
  });

  it("narrows to the filter when one is on, so select all matches what is on screen", () => {
    render(<FieldTable entries={[entry("a"), entry("b"), graded("c", "done")]} runId="r1" canGrade />);
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "a" } });
    expect(selectAll()).toHaveTextContent("select all 1 not yet graded");
  });

  it("drops a tick that stops being selectable when the field is filtered under it", () => {
    const { rerender } = render(<FieldTable entries={[entry("alpha"), entry("beta")]} runId="r1" canGrade />);
    fireEvent.click(selectAll().querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 2 selected");
    rerender(<FieldTable entries={[entry("alpha"), entry("beta")]} runId="r1" canGrade />);
    fireEvent.change(screen.getByLabelText("Search submissions"), { target: { value: "alpha" } });
    expect(queueButton()).toHaveTextContent("Grade 1 selected");
  });

  // Ticks are re-read against the live field on every poll: one another organizer graded in the
  // meantime must stop counting rather than sit in the total as a queue that will never happen.
  it("stops counting a tick once that entry has been graded elsewhere", () => {
    const before = [entry("a"), entry("b")];
    const { rerender } = render(<FieldTable entries={before} runId="r1" canGrade />);
    fireEvent.click(selectAll().querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 2 selected");
    rerender(<FieldTable entries={[graded("a", "queued"), entry("b")]} runId="r1" canGrade />);
    expect(queueButton()).toHaveTextContent("Grade 1 selected");
    expect(selectAll()).toHaveTextContent("select all 1 not yet graded");
  });

  it("ticks only this page when asked to", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} runId="r1" canGrade />);
    const page = filterLabel("select this page");
    expect(page).toHaveTextContent("select this page (20)");
    fireEvent.click(page.querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 20 selected");
  });

  it("adds the next page's ticks to the ones already made", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} runId="r1" canGrade />);
    fireEvent.click(filterLabel("select this page").querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(filterLabel("select this page").querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 40 selected");
  });

  it("unticks just this page, leaving the rest selected", () => {
    const many = Array.from({ length: 45 }, (_, i) => entry(`app-${String(i).padStart(2, "0")}`));
    render(<FieldTable entries={many} runId="r1" canGrade />);
    fireEvent.click(filterLabel("select all").querySelector("input")!);
    fireEvent.click(filterLabel("select this page").querySelector("input")!);
    expect(queueButton()).toHaveTextContent("Grade 25 selected");
  });

  it("shows select all as ticked only when the whole field is ticked", () => {
    render(<FieldTable entries={[entry("a"), entry("b")]} runId="r1" canGrade />);
    const box = selectAll().querySelector("input")!;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "select a" }));
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "select b" }));
    expect(box.checked).toBe(true);
  });

  it("clears every tick when select all is unticked", () => {
    render(<FieldTable entries={[entry("a"), entry("b")]} runId="r1" canGrade />);
    const box = selectAll().querySelector("input")!;
    fireEvent.click(box);
    fireEvent.click(box);
    expect(screen.getByRole("button", { name: /^Grade/ })).toBeDisabled();
  });

  it("keeps the queue button unusable while nothing is ticked", () => {
    render(<FieldTable entries={[entry("a")]} runId="r1" canGrade />);
    expect(queueButton()).toBeDisabled();
  });

  it("clears the ticks once they have been queued", async () => {
    stubFetch();
    render(<FieldTable entries={[entry("a"), entry("b")]} runId="r1" canGrade />);
    fireEvent.click(selectAll().querySelector("input")!);
    fireEvent.click(queueButton());
    await screen.findByText(/^Queued/);
    expect(queueButton()).toBeDisabled();
  });

  it("offers no selection at all when grading is closed", () => {
    render(<FieldTable entries={[entry("a")]} />);
    expect(document.querySelector(".field-actions")).toBeNull();
    expect(rowBoxes()).toHaveLength(0);
  });

  it("offers no selection when nothing in the field can be selected", () => {
    render(<FieldTable entries={[graded("a", "done"), skipped("b")]} runId="r1" canGrade />);
    expect(document.querySelector(".field-actions")).toBeNull();
  });

  it("labels each row's checkbox with the submission it acts on", () => {
    render(<FieldTable entries={[entry("mercury")]} runId="r1" canGrade />);
    expect(screen.getByRole("checkbox", { name: "select mercury" })).toBeInTheDocument();
  });
});

describe("FieldTable recovery marks", () => {
  const legend = () => document.querySelector("p.marks-key");

  it("marks a pending retry with B and how long is left", () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    render(<FieldTable entries={[graded("d", "done", { retryDueAt: at })]} />);
    expect(document.querySelector("sup.prov-mark")).toHaveTextContent("B");
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
  });

  it("says shortly rather than a misleading zero when the retry is nearly due", () => {
    const at = new Date(Date.now() + 20_000).toISOString();
    render(<FieldTable entries={[graded("d", "done", { retryDueAt: at })]} />);
    expect(screen.getByText(/shortly/)).toBeInTheDocument();
  });

  // A paused run holds its retries, so a countdown would be counting down to nothing.
  it("says held instead of counting down while the run is paused", () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    render(<FieldTable entries={[graded("d", "done", { retryDueAt: at })]} paused />);
    expect(screen.getByText(/held/)).toBeInTheDocument();
    expect(screen.queryByText(/5 min/)).toBeNull();
  });

  it("draws the recovery letters once the retry has landed", () => {
    render(<FieldTable entries={[graded("d", "done", { marks: marks({ partial: true }) })]} />);
    expect(Array.from(document.querySelectorAll("sup.prov-mark")).map((s) => s.textContent)).toEqual(["P"]);
  });

  it("does not draw an outcome letter beside a retry that has not run yet", () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    render(<FieldTable entries={[graded("d", "done", { retryDueAt: at, marks: marks({ none: true }) })]} />);
    expect(Array.from(document.querySelectorAll("sup.prov-mark")).map((s) => s.textContent)).toEqual(["B"]);
  });

  it("explains the letters under the table when any are drawn", () => {
    render(<FieldTable entries={[graded("d", "done", { marks: marks({ limited: true }) })]} />);
    const text = legend()?.textContent ?? "";
    for (const letter of ["B", "N", "P", "F", "L"]) expect(text).toContain(letter);
    expect(text).not.toContain("\u2014");
  });

  it("keeps the legend away when nothing is marked", () => {
    render(<FieldTable entries={[graded("d", "done"), entry("n")]} />);
    expect(legend()).toBeNull();
  });

  // event-runs builds a RecoveryMarks record for every grade, so the object is always truthy and
  // only its flags say whether any letter is on the page.
  it("keeps the legend away when a marks record carries no marks", () => {
    render(<FieldTable entries={[graded("d", "done", { marks: marks() })]} />);
    expect(legend()).toBeNull();
  });
});

describe("FieldTable paging", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => entry(`app-${String(i).padStart(3, "0")}`));

  it("stays hidden for a single page", () => {
    render(<FieldTable entries={many(20)} />);
    expect(document.querySelector(".pager")).toBeNull();
    expect(rowCount()).toBe(20);
  });

  it("shows 20 at a time and says which 20", () => {
    render(<FieldTable entries={many(45)} />);
    expect(rowCount()).toBe(20);
    expect(screen.getByText("1 to 20 of 45")).toBeInTheDocument();
  });

  it("walks forward, back, to the end and to the start", () => {
    render(<FieldTable entries={many(45)} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("21 to 40 of 45")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByText("41 to 45 of 45")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    expect(screen.getByText("21 to 40 of 45")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "first" }));
    expect(screen.getByText("1 to 20 of 45")).toBeInTheDocument();
  });

  it("disables the ends it is already at", () => {
    render(<FieldTable entries={many(45)} />);
    expect(screen.getByRole("button", { name: "first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "last" })).toBeDisabled();
  });

  it("pages the filtered field, not the whole one", () => {
    render(<FieldTable entries={[...many(45), ...Array.from({ length: 5 }, (_, i) => graded(`done-${i}`, "done"))]} />);
    fireEvent.click(filterBox("graded"));
    expect(document.querySelector(".pager")).toBeNull();
    expect(rowCount()).toBe(5);
  });

  // Live refresh shrinks the field under a mounted table: an organizer left on an empty page reads
  // it as a field that vanished.
  it("clamps to a page that still has rows when the field shrinks", () => {
    const rows = many(45);
    const { rerender } = render(<FieldTable entries={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<FieldTable entries={rows.slice(0, 25)} />);
    expect(rowCount()).toBeGreaterThan(0);
    expect(screen.getByText("21 to 25 of 25")).toBeInTheDocument();
  });

  it("keeps paging usable after a shrink", () => {
    const rows = many(45);
    const { rerender } = render(<FieldTable entries={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<FieldTable entries={rows.slice(0, 25)} />);
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    expect(screen.getByText("1 to 20 of 25")).toBeInTheDocument();
  });

  it("drops the pager and keeps the rows when a shrink leaves one page", () => {
    const rows = many(45);
    const { rerender } = render(<FieldTable entries={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<FieldTable entries={rows.slice(0, 8)} />);
    expect(document.querySelector(".pager")).toBeNull();
    expect(rowCount()).toBe(8);
  });

  it("does not strand the reader when a filter shrinks the field to nothing", () => {
    render(<FieldTable entries={[...many(45), graded("g", "done")]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    fireEvent.click(filterBox("graded"));
    expect(names()).toEqual(["g"]);
  });
});

describe("FieldTable open state", () => {
  it("remembers that this run's field was left open", () => {
    localStorage.setItem("sloptic.field.run-7", "1");
    render(<FieldTable entries={[entry("a")]} runId="run-7" />);
    expect(document.querySelector("details")).toHaveAttribute("open");
  });

  it("starts closed for a run that was never opened", () => {
    render(<FieldTable entries={[entry("a")]} runId="run-8" />);
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });

  it("does not read another run's memory", () => {
    localStorage.setItem("sloptic.field.run-7", "1");
    render(<FieldTable entries={[entry("a")]} runId="run-9" />);
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });

  it("survives storage being unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => render(<FieldTable entries={[entry("a")]} runId="run-7" />)).not.toThrow();
    get.mockRestore();
  });
});

describe("FieldTable prose", () => {
  it("uses no em dash anywhere it renders", () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    render(
      <FieldTable
        entries={[
          entry("a"),
          skipped("b"),
          graded("c", "done", { retryDueAt: at, marks: marks({ limited: true }) }),
          graded("d", "running", { progress: { done: 1, total: 44 } }),
          graded("e", "failed"),
        ]}
        runId="r1"
        canGrade
      />
    );
    expect(document.body.textContent ?? "").not.toContain("\u2014");
  });
});
