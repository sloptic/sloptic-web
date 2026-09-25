import type { AxisRow } from "@/app/ScoreBand";

// Sample grade, passive mode, in the shape the real report hands its band. Rebuilt for Sloptic 3.0.
//
// EVERY NUMBER HERE WAS COMPUTED BY THE GRADER, not written by hand, and that is a correction rather
// than a boast. The previous sample said the same thing and was wrong in a way nobody could see by
// reading it: it charged the three security headers 8 + 3 + 2 = 13, but the grader DAMPS repeats
// within one category, so those three add 8.0 + 1.8 + 0.7 = 10.5. It also listed each finding's raw
// penalty, which is not what the report shows. The report lists what each finding CONTRIBUTED after
// the dampers, so that rows sum to their axis and the axes sum to the score, and a sample showing
// penalties was teaching different arithmetic from the page it previews.
//
// How it was computed, with sloptic 3.0.0 and its packaged catalog:
//   findings   compute_axis_slop / compute_slop_score / contributions over these six probes firing:
//              sec-headers-002, sec-headers-001, sec-headers-005, qa-http-002, qa-a11y-001, perf-lcp-001
//   possible   the passive battery's real count per axis (17 + 13 + 3 + 12 = 45)
//   applied    the same, less perf-cache-001 and sec-cors-001, which a plain site often gives nothing
//              to test; the one invented input, stated so it can be checked
//   potential  exactly grader._axis_potential: every applied check firing, penalties from the catalog,
//              variant groups collapsed, through the grader's own aggregator
//
// 48.5 sits inside the middle half of real passive grades (passive-2026.2: q1 24.8, q3 60.5), so the
// sample reads as a middling app rather than a flattering one.
//
// At the next ruler (4.0), recompute all of this the same way rather than adjusting it.
export const SAMPLE_SCORE = 48.5;

export const SAMPLE_ROWS: AxisRow[] = [
  { id: "security", label: "security", failed: 3, applied: 16, possible: 17, slop: 10.5, potential: 239.9 },
  { id: "qa", label: "quality", failed: 1, applied: 13, possible: 13, slop: 10, potential: 277.8 },
  { id: "accessibility", label: "accessibility", failed: 1, applied: 3, possible: 3, slop: 20, potential: 40 },
  { id: "performance", label: "performance", failed: 1, applied: 11, possible: 12, slop: 8, potential: 214.2 },
];

// `penalty` is what a finding is worth alone. `points` is what it added to this score after the
// dampers, and it is the number shown, because that is the one that sums.
export const SAMPLE_FINDINGS = [
  {
    axis: "security",
    name: "no content security policy",
    desc: "Nothing tells the browser which scripts may run, so an injected one would.",
    penalty: 8,
    points: 8,
  },
  {
    axis: "security",
    name: "no x-content-type-options",
    desc: "A browser may guess a file's type, and guess it into something executable.",
    penalty: 3,
    points: 1.8,
  },
  {
    axis: "security",
    name: "no referrer-policy",
    desc: "Every outbound click can leak the page it came from, query string included.",
    penalty: 2,
    points: 0.7,
  },
  {
    axis: "qa",
    name: "http conformance",
    desc: "A response says one thing in its status line and another in its body.",
    penalty: 10,
    points: 10,
  },
  {
    axis: "accessibility",
    name: "accessibility violations",
    desc: "Some text is too faint to read and some controls have no name a screen reader can say.",
    penalty: 20,
    points: 20,
  },
  {
    axis: "performance",
    name: "largest contentful paint",
    desc: "The biggest thing on screen arrives late, so the page looks empty for a while.",
    penalty: 8,
    points: 8,
  },
];

// Checks that passed, and genuinely separate ones: sec-headers-003 is its own probe, and nothing in
// the quality findings above touches broken links. The old sample said "images have alt text" had
// passed, which is an accessibility check, so beside an accessibility finding it would have read as
// the report contradicting itself.
export const SAMPLE_PASSED = [
  {
    axis: "security",
    name: "strict transport security",
    desc: "The app tells browsers to reach it over https and nothing else.",
  },
  {
    axis: "qa",
    name: "no broken links",
    desc: "Every link the page offers leads somewhere that answers.",
  },
];
