/** The board as a file.
 *
 *  Two things have to hold. The file must carry the WHOLE field, including the entries that never
 *  reached the board, because each of those is a team expecting a result and the export is where an
 *  organizer accounts for them. And it must be safe to open: every submission name in it was typed
 *  by a stranger on Devpost, and a spreadsheet executes a cell that opens with =, +, - or @. Sloptic
 *  grades other people for trusting input like this.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ExportCsv, { type CsvRow } from "@/app/events/[slug]/[runId]/ExportCsv";

const base: CsvRow = {
  rank: 1,
  section: "ranked",
  submission: "plant-doctor",
  slop: 12,
  percentile: 63,
  ratio: 8.5,
  exposure: 140,
  lighthouse: 71,
  catastrophic: 0,
  app_url: "https://leafy.example",
  devpost_url: "https://devpost.com/software/plant-doctor",
  report_url: "https://sloptic.org/grade/g1",
  note: "",
};
const row = (over: Partial<CsvRow> = {}): CsvRow => ({ ...base, ...over });

let captured: Blob | null = null;

beforeEach(() => {
  captured = null;
  // jsdom has no object URLs, and the blob is the artefact under test, so this is the seam.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (b: Blob) => {
      captured = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function csv(rows: CsvRow[]): Promise<string> {
  render(<ExportCsv rows={rows} slug="hacknight" runDate="2026-09-08" />);
  fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
  expect(captured).not.toBeNull();
  return await (captured as unknown as Blob).text();
}

describe("the board export", () => {
  it("offers nothing when there is no field", () => {
    const { container } = render(<ExportCsv rows={[]} slug="hacknight" runDate="2026-09-08" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("writes a header and one line per entry", async () => {
    const text = await csv([row(), row({ submission: "decisionlite", rank: 2 })]);
    const lines = text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain("submission");
    expect(lines[0]).toContain("slop score");
    expect(lines).toHaveLength(3);
  });

  it("carries entries that never reached the board, with what happened to them", async () => {
    // The reason the export exists rather than a copy of the visible table: these are the rows an
    // organizer has to account for and the ones a selection drag misses.
    const text = await csv([
      row(),
      row({ rank: null, section: "didn't finish", submission: "gone", note: "DNF, the grade did not finish" }),
      row({ rank: null, section: "nothing to grade", submission: "repo-only", note: "github only" }),
      row({ rank: null, section: "not ranked", submission: "leaky", note: "carries a finding an attacker could use today" }),
    ]);
    for (const s of ["didn't finish", "nothing to grade", "not ranked", "github only", "gone", "leaky"]) {
      expect(text).toContain(s);
    }
  });

  it("defuses a submission name that a spreadsheet would execute", async () => {
    const text = await csv([row({ submission: '=HYPERLINK("http://evil","click")' })]);
    // Quoted because it contains commas and quotes, and apostrophe-prefixed so the cell is text.
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/);
  });

  it("defuses every leading character a spreadsheet treats as a formula", async () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const text = await csv([row({ submission: `${lead}cmd` })]);
      expect(text).toContain(`'${lead}cmd`);
      cleanup();   // each pass renders its own button, and getByRole insists on exactly one
    }
  });

  it("escapes a name carrying a comma or a quote without mangling it", async () => {
    const text = await csv([row({ submission: 'a, b "c"' })]);
    expect(text).toContain('"a, b ""c"""');
  });

  it("leaves an ordinary name alone", async () => {
    const text = await csv([row({ submission: "plant-doctor" })]);
    expect(text).toContain(",plant-doctor,");
  });

  it("writes an empty cell for a measurement that is missing, never a zero", async () => {
    // A blank means "not measured" and 0 means "measured, nothing found". Collapsing them would let
    // an unreachable app sort as the cleanest in the organizer's own spreadsheet.
    const text = await csv([row({ slop: null, lighthouse: null, catastrophic: null })]);
    const line = text.replace(/^\uFEFF/, "").split("\r\n")[1];
    expect(line.split(",")[3]).toBe("");
  });

  it("starts with a BOM so Excel reads it as UTF-8", async () => {
    // Asserted on the BYTES. Blob.text() decodes with the WHATWG UTF-8 algorithm, which strips a
    // leading BOM, so reading the string back would report its absence whether or not it is there.
    const text = await csv([row({ submission: "Café Doctor" })]);
    expect(text).toContain("Café Doctor");
    const bytes = new Uint8Array(await (captured as unknown as Blob).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("names the file after the event and the run's date", async () => {
    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === "a") {
        Object.defineProperty(el, "download", {
          set: (v: string) => clicks.push(v),
          get: () => clicks[clicks.length - 1],
          configurable: true,
        });
      }
      return el;
    });
    render(<ExportCsv rows={[row()]} slug="hacknight" runDate="2026-09-08" />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(clicks).toContain("sloptic-hacknight-2026-09-08.csv");
    vi.restoreAllMocks();
  });
});
