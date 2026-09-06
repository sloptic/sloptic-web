import type { AxisRow } from "@/app/ScoreBand";

// Sample grade, passive mode, in the shape the real report hands its band.
//
// EVERY NUMBER HERE IS REAL: the penalties are the catalog's actual prices for those probes, and
// they sum. Per axis the findings sum to that axis's slop, and the axes sum to SAMPLE_SCORE, which
// is how a scored report reads ("rows sum to their category header and the headers sum to the
// score"). The previous sample was invented and did not survive contact with the catalog: it
// charged 8 for a shipped dev build that costs 28, 3 for a slow first response that costs 26, and
// labelled a 5-point finding "no content security policy" when 5 is a WEAK policy (sec-csp-001) and
// a missing one is 8 (sec-headers-002). It also gave performance 8 points across two failures when
// the cheapest passive performance probe in the catalog is 6.
//
// 41 sits just above the passive corpus median of 39, so the sample looks like a real middling app
// rather than a flattering one. The counts (possible: 17 / 15 / 12) are the passive battery's real
// per-axis totals, which is why they add to 44.
export const SAMPLE_SCORE = 41;

export const SAMPLE_ROWS: AxisRow[] = [
  { id: "security", label: "security", failed: 3, applied: 11, possible: 17, slop: 13, potential: 46 },
  { id: "qa", label: "quality", failed: 2, applied: 9, possible: 15, slop: 20, potential: 38 },
  { id: "performance", label: "performance", failed: 1, applied: 7, possible: 12, slop: 8, potential: 26 },
];

// sec-headers-002 (8), sec-headers-001 (3), sec-headers-005 (2) = security's 13.
// qa-http-002 (10), qa-seo-001 (10) = quality's 20. perf-lcp-001 (8) = performance's 8.
export const SAMPLE_FINDINGS = [
  {
    axis: "security",
    name: "no content security policy",
    desc: "Nothing tells the browser which scripts may run, so an injected one would.",
    penalty: 8,
  },
  {
    axis: "security",
    name: "no x-content-type-options",
    desc: "A browser may guess a file's type, and guess it into something executable.",
    penalty: 3,
  },
  {
    axis: "security",
    name: "no referrer-policy",
    desc: "Every outbound click can leak the page it came from, query string included.",
    penalty: 2,
  },
  {
    axis: "qa",
    name: "http conformance",
    desc: "A response says one thing in its status line and another in its body.",
    penalty: 10,
  },
  {
    axis: "qa",
    name: "search engine basics",
    desc: "The page is missing what a crawler needs to index it correctly.",
    penalty: 10,
  },
  {
    axis: "performance",
    name: "largest contentful paint",
    desc: "The biggest thing on screen arrives late, so the page looks empty for a while.",
    penalty: 8,
  },
];

export const SAMPLE_PASSED = [
  {
    axis: "security",
    name: "clickjacking defense",
    desc: "The app refuses to be framed by another site.",
  },
  {
    axis: "qa",
    name: "images have alt text",
    desc: "A screen reader can describe every image on the page.",
  },
];
