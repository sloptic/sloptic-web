import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RecoverySup from "@/app/RecoverySup";
import type { RecoveryMarks } from "@/lib/grades";

// The letters are the only thing a reader sees of a recovery pass, so what each one means, when it
// appears and what it says on hover is the whole contract. Derived from the component's own doc
// comment: N recovered nothing, P recovered some, F recovered all, L marks a limited battery.

const NONE: RecoveryMarks = { retry: false, none: false, partial: false, full: false, limited: false };
const marks = (over: Partial<RecoveryMarks> = {}): RecoveryMarks => ({ ...NONE, ...over });

function letters(): string[] {
  return Array.from(document.querySelectorAll("sup.prov-mark")).map((s) => s.textContent ?? "");
}

describe("RecoverySup", () => {
  it("renders nothing without marks", () => {
    const { container } = render(<RecoverySup marks={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when marks is undefined", () => {
    const { container } = render(<RecoverySup />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every flag is false", () => {
    const { container } = render(<RecoverySup marks={marks()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["none", "N", "The retries recovered nothing: a challenge held every time."],
    ["partial", "P", "The retries recovered some blocked checks, not all."],
    ["full", "F", "The retries recovered every blocked check."],
  ] as const)("renders %s as %s with a title that says what happened", (flag, letter, title) => {
    render(<RecoverySup marks={marks({ [flag]: true })} />);
    const sup = screen.getByTitle(title);
    expect(sup).toHaveTextContent(letter);
  });

  it("renders L for a limited battery, and says a challenge or too few checks is why", () => {
    render(<RecoverySup marks={marks({ limited: true })} />);
    const sup = screen.getByText("L");
    expect(sup.getAttribute("title")).toMatch(/too few checks applied for a fair read/);
  });

  // B is the caller's mark (the board draws it beside the score from `provisional`), so a pending
  // retry alone must not put a letter here or a row would carry two Bs.
  it("draws no letter for a pending retry on its own", () => {
    const { container } = render(<RecoverySup marks={marks({ retry: true })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the legend's order, N then P then F then L, when several are set", () => {
    render(<RecoverySup marks={{ retry: true, none: true, partial: true, full: true, limited: true }} />);
    expect(letters()).toEqual(["N", "P", "F", "L"]);
  });

  it("pairs L with the outcome letter, since a limited battery can still have recovered", () => {
    render(<RecoverySup marks={marks({ full: true, limited: true })} />);
    expect(letters()).toEqual(["F", "L"]);
  });

  // House style: no em dashes anywhere, including in the hover text a user actually reads.
  it("uses no em dash in any letter's title", () => {
    render(<RecoverySup marks={{ retry: true, none: true, partial: true, full: true, limited: true }} />);
    for (const sup of Array.from(document.querySelectorAll("sup.prov-mark"))) {
      expect(sup.getAttribute("title") ?? "").not.toContain("\u2014");
    }
  });

  // A clean passive placement is not "secure", so no mark may promise that a battery was complete
  // or an app safe. The titles talk about checks and challenges only.
  it("never claims an app is secure or a battery complete", () => {
    render(<RecoverySup marks={{ retry: true, none: true, partial: true, full: true, limited: true }} />);
    const titles = Array.from(document.querySelectorAll("sup.prov-mark"))
      .map((s) => (s.getAttribute("title") ?? "").toLowerCase())
      .join(" ");
    expect(titles).not.toMatch(/secure|safe|clean bill/);
  });
});
