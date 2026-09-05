import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BoardTable, { type BoardRow, type DnfRow } from "@/app/events/[slug]/[runId]/BoardTable";
import type { RecoveryMarks } from "@/lib/grades";

// The board is the artefact an organizer shares, so its ordering claims have to be true: the rank
// is the run's own placement, a first click on a column has to sort the way that column is useful,
// and a missing measurement must never read as a win.

const NO_MARKS: RecoveryMarks = { retry: false, none: false, partial: false, full: false, limited: false };
const marks = (over: Partial<RecoveryMarks> = {}): RecoveryMarks => ({ ...NO_MARKS, ...over });

let seq = 0;
function row(over: Partial<BoardRow> = {}): BoardRow {
  seq += 1;
  return {
    name: `app${seq}`,
    project_url: `https://app${seq}.example`,
    grade_id: `g${seq}`,
    slop: 10,
    ratio: 10,
    lighthouse: 50,
    exposure: 100,
    catastrophic: 0,
    provisional: false,
    marks: marks(),
    ...over,
  };
}

/** The submission names in the order the table currently shows them. */
function names(): string[] {
  return Array.from(document.querySelectorAll("tbody tr th[scope=row] a")).map((a) => a.textContent ?? "");
}
/** The rank cell of every visible row, which must not be renumbered by sorting. */
function ranks(): string[] {
  return Array.from(document.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent ?? "");
}
/** The superscript letters actually drawn on the rows, ignoring the legend's own bold letters. */
function supLetters(): string[] {
  return Array.from(document.querySelectorAll("sup.prov-mark")).map((s) => s.textContent ?? "");
}
function bodyRows(): Element[] {
  return Array.from(document.querySelectorAll("tbody tr"));
}
function header(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

// One shape used by the sorting tests: whichever column you click first, "apple" is the useful
// answer, so a single fixture proves every column's first-click direction at once.
const SORT_FIXTURE: BoardRow[] = [
  row({ name: "cherry", project_url: "https://c.example", slop: 30, ratio: 30, exposure: 10, lighthouse: 20, catastrophic: 2 }),
  row({ name: "apple", project_url: "https://a.example", slop: 10, ratio: 10, exposure: 30, lighthouse: 90, catastrophic: 0 }),
  row({ name: "banana", project_url: "https://b.example", slop: 20, ratio: 20, exposure: 20, lighthouse: 50, catastrophic: 1 }),
];

describe("BoardTable ordering", () => {
  it("opens in the board's own rank order", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    expect(names()).toEqual(["cherry", "apple", "banana"]);
    expect(ranks()).toEqual(["1", "2", "3"]);
    expect(screen.getByRole("columnheader", { name: /^#/ })).toHaveAttribute("aria-sort", "ascending");
  });

  // "Getting this wrong means every column needs two clicks to be useful."
  it.each([
    ["submission", "apple"],
    ["slop", "apple"],
    ["ratio", "apple"],
    ["exposure", "apple"],
    ["lighthouse", "apple"],
    ["catastrophic", "apple"],
  ])("sorts %s the useful way on the first click", (label, first) => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header(label));
    expect(names()[0]).toBe(first);
  });

  it("returns to the board order when # is clicked after another column", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header("slop"));
    fireEvent.click(header("#"));
    expect(names()).toEqual(["cherry", "apple", "banana"]);
  });

  it("reverses on a second click of the same column", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header("slop"));
    fireEvent.click(header("slop"));
    expect(names()).toEqual(["cherry", "banana", "apple"]);
  });

  it("reports the sort direction on the column header, not just in an arrow", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header("slop"));
    const slop = screen.getByRole("columnheader", { name: /^slop/ });
    expect(slop).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(header("slop"));
    expect(slop).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /^#/ })).toHaveAttribute("aria-sort", "none");
  });

  // "Sorting by performance should not renumber anyone."
  it("keeps each row's rank when the table is re-sorted", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header("slop"));
    expect(names()).toEqual(["apple", "banana", "cherry"]);
    expect(ranks()).toEqual(["2", "3", "1"]);
  });

  // "An app with no Lighthouse score is not the best performer."
  it.each(["lighthouse", "ratio", "exposure", "catastrophic"])(
    "sinks a missing %s in both directions",
    (label) => {
        const key = label as "lighthouse" | "ratio" | "exposure" | "catastrophic";
      const rows = [
        row({ name: "missing", project_url: "https://m.example", [key]: null }),
        row({ name: "low", project_url: "https://l.example", [key]: 1 }),
        row({ name: "high", project_url: "https://h.example", [key]: 99 }),
      ];
      render(<BoardTable rows={rows} dnf={[]} />);
      fireEvent.click(header(label));
      expect(names()[2]).toBe("missing");
      fireEvent.click(header(label));
      expect(names()[2]).toBe("missing");
    }
  );

  it("sorts submissions alphabetically, both ways", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    fireEvent.click(header("submission"));
    expect(names()).toEqual(["apple", "banana", "cherry"]);
    fireEvent.click(header("submission"));
    expect(names()).toEqual(["cherry", "banana", "apple"]);
  });

  it("offers every column header as a keyboard-reachable button", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    for (const label of ["#", "submission", "slop", "ratio", "exposure", "lighthouse", "catastrophic"]) {
      const b = header(label);
      expect(b.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
    }
  });

  // A native button is what makes Enter and Space work at all: these headers were spans once.
  it("puts the sort control in the tab order", () => {
    render(<BoardTable rows={SORT_FIXTURE} dnf={[]} />);
    const b = header("slop");
    b.focus();
    expect(document.activeElement).toBe(b);
    expect(b).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("BoardTable cells", () => {
  it("shows a whole slop score plainly and a fractional one to one place", () => {
    render(<BoardTable rows={[row({ name: "whole", slop: 12 }), row({ name: "part", slop: 12.34 })]} dnf={[]} />);
    expect(bodyRows()[0].querySelectorAll("td")[1]).toHaveTextContent("12");
    expect(bodyRows()[1].querySelectorAll("td")[1]).toHaveTextContent("12.3");
  });

  it("writes a dash, not a zero, where a measurement is missing", () => {
    render(<BoardTable rows={[row({ ratio: null, lighthouse: null, exposure: null, catastrophic: null })]} dnf={[]} />);
    const cells = Array.from(bodyRows()[0].querySelectorAll("td")).map((c) => c.textContent);
    expect(cells.slice(2, 6)).toEqual(["-", "-", "-", "-"]);
  });

  it("shows the ratio as a percentage to one place", () => {
    render(<BoardTable rows={[row({ ratio: 12.34 })]} dnf={[]} />);
    expect(bodyRows()[0].querySelectorAll("td")[2]).toHaveTextContent("12.3%");
  });

  it("links a graded row to its report and leaves an ungraded one without one", () => {
    render(<BoardTable rows={[row({ name: "has", grade_id: "abc" }), row({ name: "hasnt", grade_id: null })]} dnf={[]} />);
    expect(screen.getByRole("link", { name: "report" })).toHaveAttribute("href", "/grade/abc");
    expect(screen.getAllByRole("link", { name: "report" })).toHaveLength(1);
  });

  it("marks a provisional score with B and says the score can still move", () => {
    render(<BoardTable rows={[row({ provisional: true })]} dnf={[]} />);
    expect(supLetters()).toEqual(["B"]);
    const b = document.querySelector("sup.prov-mark")!;
    expect(b.getAttribute("title")).toMatch(/being retried/);
  });

  it("draws the recovery letters beside the score", () => {
    render(<BoardTable rows={[row({ marks: marks({ partial: true, limited: true }) })]} dnf={[]} />);
    expect(supLetters()).toEqual(["P", "L"]);
  });

  it("opens submission links in a new tab without leaking the referrer", () => {
    render(<BoardTable rows={[row({ name: "app", project_url: "https://x.example" })]} dnf={[]} />);
    const a = screen.getByRole("link", { name: "app" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("BoardTable marks legend", () => {
  const legend = () => document.querySelector("p.marks-key");

  it("stays away when nothing is marked", () => {
    render(<BoardTable rows={[row(), row()]} dnf={[{ name: "dead", project_url: "https://d.example", note: "DNF" }]} />);
    expect(legend()).toBeNull();
  });

  it("appears for a provisional score", () => {
    render(<BoardTable rows={[row({ provisional: true })]} dnf={[]} />);
    expect(legend()).toHaveTextContent("retry pending");
  });

  it.each(["none", "partial", "full", "limited"] as const)("appears for a %s mark on a scored row", (flag) => {
    render(<BoardTable rows={[row({ marks: marks({ [flag]: true }) })]} dnf={[]} />);
    expect(legend()).not.toBeNull();
  });

  // `{a || b && <p/>}` parses as `{a || (b && <p/>)}`: a legend guarded that way vanishes as soon as
  // the scored rows are clean, which is exactly when the only letters are on the DNF list.
  it("appears when the only letters are on a didn't-finish row", () => {
    render(
      <BoardTable
        rows={[row(), row()]}
        dnf={[{ name: "blocked", project_url: "https://d.example", note: "no score", marks: marks({ none: true }) }]}
      />
    );
    expect(legend()).not.toBeNull();
    expect(supLetters()).toEqual(["N"]);
  });

  it("appears when the ranking is empty and every letter is on the didn't-finish list", () => {
    render(
      <BoardTable
        rows={[]}
        dnf={[{ name: "blocked", project_url: "https://d.example", note: "no score", marks: marks({ limited: true }) }]}
      />
    );
    expect(legend()).not.toBeNull();
  });

  it("covers every letter it can draw, B, N, P, F and L", () => {
    render(<BoardTable rows={[row({ provisional: true, marks: marks({ none: true, limited: true }) })]} dnf={[]} />);
    const text = legend()?.textContent ?? "";
    for (const letter of ["B", "N", "P", "F", "L"]) expect(text).toContain(letter);
    expect(text).not.toContain("\u2014");
  });
});

describe("BoardTable didn't finish", () => {
  it("counts the list in its heading", () => {
    const dnf: DnfRow[] = [
      { name: "one", project_url: "https://1.example", note: "DNF, the grade did not finish" },
      { name: "two", project_url: "https://2.example", note: "no score" },
    ];
    render(<BoardTable rows={[row()]} dnf={dnf} />);
    expect(screen.getByRole("heading", { name: /didn't finish \(2\)/i })).toBeInTheDocument();
    expect(document.querySelectorAll("ul.dnf-list li")).toHaveLength(2);
  });

  // An organizer needs to see WHICH entries produced nothing even when nothing produced a score.
  it("survives an empty ranking", () => {
    render(<BoardTable rows={[]} dnf={[{ name: "one", project_url: "https://1.example", note: "no score" }]} />);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByRole("heading", { name: /didn't finish \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText("no score")).toBeInTheDocument();
  });

  it("keeps the reason beside the name", () => {
    render(<BoardTable rows={[]} dnf={[{ name: "one", project_url: "https://1.example", note: "no score (a bot challenge blocked every check)" }]} />);
    expect(screen.getByText(/a bot challenge blocked every check/)).toBeInTheDocument();
  });

  it("stays away entirely when every entry scored", () => {
    render(<BoardTable rows={[row()]} dnf={[]} />);
    expect(document.querySelector("ul.dnf-list")).toBeNull();
    expect(screen.queryByRole("heading", { name: /didn't finish/i })).toBeNull();
  });

  it("renders nothing at all for an empty run", () => {
    const { container } = render(<BoardTable rows={[]} dnf={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BoardTable paging", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ name: `app-${String(i).padStart(3, "0")}`, project_url: `https://x${i}.example` }));

  it("stays hidden for a single page", () => {
    render(<BoardTable rows={many(25)} dnf={[]} />);
    expect(document.querySelector(".pager")).toBeNull();
    expect(bodyRows()).toHaveLength(25);
  });

  it("shows 25 at a time and says which 25", () => {
    render(<BoardTable rows={many(60)} dnf={[]} />);
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
  });

  it("walks forward and back", () => {
    render(<BoardTable rows={many(60)} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("26 to 50 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
  });

  it("jumps to the last page and back to the first", () => {
    render(<BoardTable rows={many(60)} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByText("51 to 60 of 60")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "first" }));
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
  });

  it("disables the ends it is already at", () => {
    render(<BoardTable rows={many(60)} dnf={[]} />);
    expect(screen.getByRole("button", { name: "first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "next" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "last" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "first" })).toBeEnabled();
  });

  it("returns to the first page when a column is sorted", () => {
    render(<BoardTable rows={many(60)} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    fireEvent.click(header("slop"));
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
  });

  // Regrades repoint links and recovered catastrophes migrate rows, so the list shrinks under a
  // mounted table. Stranding the reader on an empty page reads as a board that lost its field.
  it("clamps to the last page that still has rows when the list shrinks", () => {
    const rows = many(60);
    const { rerender } = render(<BoardTable rows={rows} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<BoardTable rows={rows.slice(0, 30)} dnf={[]} />);
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(screen.getByText("26 to 30 of 30")).toBeInTheDocument();
  });

  it("drops the pager, and keeps rows on screen, when a shrink leaves one page", () => {
    const rows = many(60);
    const { rerender } = render(<BoardTable rows={rows} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<BoardTable rows={rows.slice(0, 10)} dnf={[]} />);
    expect(document.querySelector(".pager")).toBeNull();
    expect(bodyRows()).toHaveLength(10);
  });

  it("keeps paging usable after a shrink, without a stale page index", () => {
    const rows = many(60);
    const { rerender } = render(<BoardTable rows={rows} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<BoardTable rows={rows.slice(0, 30)} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "previous" }));
    expect(screen.getByText("1 to 25 of 30")).toBeInTheDocument();
  });

  it("shows the whole board when the field grows back", () => {
    const rows = many(60);
    const { rerender } = render(<BoardTable rows={rows.slice(0, 30)} dnf={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    rerender(<BoardTable rows={rows} dnf={[]} />);
    expect(screen.getByText("26 to 50 of 60")).toBeInTheDocument();
  });

  it("shows a single row without a pager", () => {
    render(<BoardTable rows={[row({ name: "only" })]} dnf={[]} />);
    expect(names()).toEqual(["only"]);
    expect(document.querySelector(".pager")).toBeNull();
  });
});
