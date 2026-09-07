/** The three sections beside the board: didn't finish, nothing to grade, not ranked.
 *
 *  They were unpaginated, unsorted dumps, which is fine on a field of four and useless on one of two
 *  hundred: the reader's actual question is "where is mine", and the answer was ctrl-F. The board
 *  itself already solved this, so these behave the same way rather than a second way.
 *
 *  What the sorting has to get right is that these lists mix two different questions. Alphabetical
 *  answers "where is mine". By reason answers "what went wrong across the field", which is the
 *  organizer's other question and the one a flat list cannot answer at all.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AsideTable, { type AsideRow } from "@/app/events/[slug]/[runId]/AsideTable";

const row = (name: string, over: Partial<AsideRow> = {}): AsideRow => ({
  name,
  project_url: `https://devpost.com/software/${name}`,
  reason: "DNF, the grade did not finish",
  ...over,
});

const names = () =>
  [...document.querySelectorAll("tbody th")].map((th) => th.textContent?.trim());

const header = (label: string | RegExp) => screen.getByRole("button", { name: label });

describe("AsideTable", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<AsideTable rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens alphabetically, since finding one entry is what these are read for", () => {
    render(<AsideTable rows={[row("zeta"), row("alpha"), row("mid")]} />);
    expect(names()).toEqual(["alpha", "mid", "zeta"]);
  });

  it("reverses the name order on a second click", () => {
    render(<AsideTable rows={[row("alpha"), row("zeta")]} />);
    fireEvent.click(header(/submission/));
    expect(names()).toEqual(["zeta", "alpha"]);
  });

  it("groups the field by what went wrong when sorted by reason", () => {
    render(
      <AsideTable
        rows={[
          row("b", { reason: "no score (the app had nothing to grade)" }),
          row("a", { reason: "DNF, the grade did not finish" }),
          row("c", { reason: "no score (the app had nothing to grade)" }),
        ]}
      />,
    );
    fireEvent.click(header(/why/));
    expect(names()).toEqual(["a", "b", "c"]);
  });

  it("breaks a reason tie by name, so the grouping does not shuffle", () => {
    // Every row shares a reason here, so the fallback is the only thing deciding the order. Without
    // it the list would reorder itself between renders of identical data.
    render(<AsideTable rows={[row("zeta"), row("alpha"), row("mid")]} />);
    fireEvent.click(header(/why/));
    expect(names()).toEqual(["alpha", "mid", "zeta"]);
  });

  it("labels the reason column for its own section", () => {
    render(<AsideTable rows={[row("a")]} reasonLabel="what happened" />);
    expect(header(/what happened/)).toBeInTheDocument();
  });

  it("shows a score column only where there are scores, and sorts it low first", () => {
    // Not-ranked rows have a real score; it is the ranking they sit outside of, not the grading.
    render(
      <AsideTable
        rows={[
          { name: "worse", project_url: "https://devpost.com/software/worse", slop: 40, grade_id: "g1" },
          { name: "better", project_url: "https://devpost.com/software/better", slop: 4, grade_id: "g2" },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /why/ })).toBeNull();
    fireEvent.click(header(/slop/));
    expect(names()).toEqual(["better", "worse"]);
  });

  it("sinks a missing score whichever way the column is pointed", () => {
    const rows: AsideRow[] = [
      { name: "scored", project_url: "https://devpost.com/software/scored", slop: 10 },
      { name: "unscored", project_url: "https://devpost.com/software/unscored", slop: null },
    ];
    render(<AsideTable rows={rows} />);
    fireEvent.click(header(/slop/));
    expect(names()).toEqual(["scored", "unscored"]);
    fireEvent.click(header(/slop/));
    expect(names()).toEqual(["scored", "unscored"]);
  });

  it("links a report only where one exists", () => {
    render(
      <AsideTable
        rows={[
          { name: "has", project_url: "https://devpost.com/software/has", slop: 1, grade_id: "g1" },
          { name: "none", project_url: "https://devpost.com/software/none", slop: 2, grade_id: null },
        ]}
      />,
    );
    expect(screen.getAllByRole("link", { name: "report" })).toHaveLength(1);
  });

  it("pages a long field and says where you are", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`app${String(i).padStart(2, "0")}`));
    render(<AsideTable rows={rows} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("26 to 50 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("offers no pager for a field that fits", () => {
    render(<AsideTable rows={[row("a"), row("b")]} />);
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
  });

  it("returns to the first page when the sort changes", () => {
    // Otherwise a reader who sorts from page three lands on page three of a different order, which
    // reads as the list having lost their entry.
    const rows = Array.from({ length: 60 }, (_, i) => row(`app${String(i).padStart(2, "0")}`));
    render(<AsideTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(header(/submission/));
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
  });

  it("reports the sort direction on the header, not only in an arrow", () => {
    render(<AsideTable rows={[row("a"), row("b")]} />);
    const th = document.querySelector("thead th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(header(/submission/));
    expect(document.querySelector("thead th")?.getAttribute("aria-sort")).toBe("descending");
  });
});
