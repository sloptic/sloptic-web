/** Paging, shared by the board, the three lists beside it and the account's grade table.
 *
 *  The clamp is the reason this is one component and not three. Every list it serves shrinks under
 *  something the reader did not do: a retry recovers a score and the row leaves for the board, a
 *  refresh re-reads the gallery, a grade is deleted from another tab. A page index that outlives its
 *  list renders an empty table, which reads as the data having been lost rather than as the page
 *  having run out, and it is the line most likely to be left out of a fourth copy.
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Pager, { usePaged, PAGE_SIZE } from "@/app/Pager";

/** A list whose length the test can change under the pager, the way a live refresh does. */
function Harness({ initial }: { initial: number }) {
  const [n, setN] = useState(initial);
  const rows = Array.from({ length: n }, (_, i) => `row${i}`);
  const paged = usePaged(rows);
  return (
    <>
      <button type="button" onClick={() => setN(3)}>
        shrink
      </button>
      <ul>
        {paged.shown.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <Pager {...paged} />
    </>
  );
}

const shown = () => document.querySelectorAll("li").length;

describe("Pager", () => {
  it("draws nothing for a list that fits on one page", () => {
    render(<Harness initial={PAGE_SIZE} />);
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    expect(shown()).toBe(PAGE_SIZE);
    cleanup();
  });

  it("shows one page at a time and says where you are", () => {
    render(<Harness initial={60} />);
    expect(shown()).toBe(25);
    expect(screen.getByText("1 to 25 of 60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText("26 to 50 of 60")).toBeInTheDocument();
    cleanup();
  });

  it("disables the ends rather than hiding them, so the row does not reflow", () => {
    render(<Harness initial={60} />);
    expect(screen.getByRole("button", { name: "first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "last" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "previous" })).toBeEnabled();
    cleanup();
  });

  it("shows the remainder on the final page", () => {
    render(<Harness initial={60} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(shown()).toBe(10);
    expect(screen.getByText("51 to 60 of 60")).toBeInTheDocument();
    cleanup();
  });

  it("falls back when the list shrinks out from under the page you are on", () => {
    // THE case. Sitting on page three of sixty when the list drops to three rows: without the clamp
    // the slice is past the end and the reader is looking at an empty table.
    render(<Harness initial={60} />);
    fireEvent.click(screen.getByRole("button", { name: "last" }));
    expect(shown()).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "shrink" }));
    expect(shown()).toBe(3);
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    cleanup();
  });

  it("has nothing to draw for an empty list", () => {
    render(<Harness initial={0} />);
    expect(shown()).toBe(0);
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    cleanup();
  });
});
