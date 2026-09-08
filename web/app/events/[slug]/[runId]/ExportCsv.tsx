"use client";

/** The board as a file, because judging happens in a spreadsheet.
 *
 *  An organizer running a field of two hundred is not reading a web page to pick winners, they are
 *  putting the numbers next to their own scoring and sorting the lot. Without this the only route
 *  was selecting the table by hand, one page of twenty-five at a time, which loses the entries that
 *  are not on the board at all: the ones that did not finish, the ones with nothing to grade, the
 *  ones held out of the ranking. Those are the rows an organizer most needs to account for, because
 *  each one is a team expecting a result.
 *
 *  So the file is the WHOLE field, one row per entry, with a column saying which part of the page it
 *  came from. What the page splits into four sections for reading, a spreadsheet is better at
 *  splitting for itself.
 *
 *  Built in the browser from what the page already rendered rather than fetched from a route of its
 *  own: a second endpoint would have to re-derive ranked, gated, withheld, failed and skipped from
 *  the same rows, and two copies of that arithmetic is how a board and its export come to disagree
 *  about who won.
 */

export type CsvRow = {
  rank: number | null;
  section: string;
  submission: string;
  slop: number | null;
  percentile: number | null;
  ratio: number | null;
  exposure: number | null;
  lighthouse: number | null;
  catastrophic: number | null;
  app_url: string | null;
  devpost_url: string;
  report_url: string | null;
  note: string;
};

const HEADERS: { key: keyof CsvRow; label: string }[] = [
  { key: "rank", label: "rank" },
  { key: "submission", label: "submission" },
  { key: "section", label: "outcome" },
  { key: "slop", label: "slop score" },
  { key: "percentile", label: "cleaner than %" },
  { key: "ratio", label: "share of exposure lost %" },
  { key: "exposure", label: "exposure" },
  { key: "lighthouse", label: "lighthouse" },
  { key: "catastrophic", label: "catastrophic findings" },
  { key: "note", label: "note" },
  { key: "app_url", label: "app url" },
  { key: "devpost_url", label: "devpost url" },
  { key: "report_url", label: "report url" },
];

/** One field, escaped for CSV and defused for spreadsheets.
 *
 *  The defusing is the part that matters here. Excel and Sheets evaluate a cell that opens with =,
 *  +, - or @, so a submission titled `=HYPERLINK("http://evil","click")` becomes a live formula in
 *  the organizer's spreadsheet, and every one of these names was typed by a stranger on Devpost. A
 *  leading apostrophe is the standard defusing: the cell reads as text and the apostrophe does not
 *  show. Sloptic grades other people for trusting input like this, so shipping the hole in its own
 *  export would be its own kind of finding.
 */
function cell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const armed = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /["\n\r,]/.test(armed) ? `"${armed.replace(/"/g, '""')}"` : armed;
}

export default function ExportCsv({ rows, slug, runDate }: { rows: CsvRow[]; slug: string; runDate: string }) {
  if (rows.length === 0) return null;

  function download() {
    const body = [
      HEADERS.map((h) => cell(h.label)).join(","),
      ...rows.map((r) => HEADERS.map((h) => cell(r[h.key])).join(",")),
    ].join("\r\n");
    // CRLF and a BOM, both for Excel: without the BOM it reads the file as the local codepage and
    // any non-ASCII submission name arrives mangled, which on a hackathon field is most of them.
    const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sloptic-${slug}-${runDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Freed on the next tick rather than immediately: revoking before the browser has started the
    // download cancels it in some of them.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <button className="button secondary" type="button" onClick={download}>
      Export CSV
    </button>
  );
}
