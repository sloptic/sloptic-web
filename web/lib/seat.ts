import type { Area } from "@/lib/checks";

/** The builder's seat, from sloptic-main docs/WEB_HANDOFF_BUILDER_SEAT.md (3.0).
 *
 *  The most common reaction to a grade is surprise: "it loads instantly for us", "the text is perfectly
 *  readable". Both are true from the team's seat, and the grade describes a different one. Without that
 *  said, a bad performance or accessibility score reads as a bug in Sloptic; with it, as news about
 *  the app's users. This EXPLAINS why teams miss slop and does not redefine it: slop stays the failures
 *  that count against any app, whatever it does.
 *
 *  One module so the report, the landing sample and the explainer quote the same words.
 *
 *  Accuracy rails from the handoff, which any rewrite must keep:
 *   - Lighthouse SIMULATES the phone. It does not run on one and does not actually slow the CPU; it
 *     measures on the grading box and scales CPU time by four. Never "tested on a real phone".
 *   - Contrast is not colorblindness. axe's contrast rule measures lightness contrast.
 *   - Only the performance axis uses the phone profile. Keep the phone framing to performance.
 *   - Explain, do not scold. Testing on your own machine is normal.
 */
export const AXIS_SEAT: Partial<Record<Area, string>> = {
  performance: "Measured as a mid range phone on slow 4G, not your laptop.",
  accessibility:
    "Checked the way a low vision or screen reader user meets your app, not the way it looks to you.",
};

/** Where the explainer lives. An anchor on /methodology rather than a page of its own. */
export const SEAT_HREF = "/methodology#your-seat";

/** Why each kind of slop is missed from the team's seat, and how Sloptic checks for it. Rewritten from
 *  the handoff's table to match the site's voice; the rails above still apply. */
export const SEAT_ROWS: { failure: string; invisible: string; instead: string }[] = [
  {
    failure: "slow page",
    invisible: "the team builds the app on a fast laptop with good wifi",
    instead: "Lighthouse loads the page the way a mid range phone on slow 4G would",
  },
  {
    failure: "low contrast text",
    invisible: "the team reads it fine on a bright screen",
    instead: "axe checks every piece of text against the WCAG contrast ratio",
  },
  {
    failure: "unlabeled button or field",
    invisible: "nobody on the team uses a screen reader",
    instead: "axe checks that every control has a name a screen reader can read out",
  },
  {
    failure: "crash on bad input",
    invisible: "the team only types valid input into its own forms",
    instead: "Sloptic sends malformed input and checks that the app rejects it without crashing",
  },
  {
    failure: "button that does nothing",
    invisible: "demos only use the buttons that work",
    instead: "Sloptic clicks the app's controls (skipping destructive ones) and watches for any effect",
  },
  {
    failure: "missing security header or leaked key",
    invisible: "the app works the same either way",
    instead: "Sloptic reads the headers and the code shipped to the browser",
  },
];

/** Lighthouse 13.4.1's mobile profile, which the grader runs. TRANSCRIBED, because nothing Sloptic
 *  ships carries them: `mobileSlow4G` in @paulirish/trace_engine simulation/Constants.js, and the Moto G
 *  Power screen in core/config/constants.js. Recheck them when the grader moves Lighthouse. */
export const LIGHTHOUSE_PROFILE = {
  rttMs: 150,
  downMbps: 1.6,
  cpuSlowdown: 4,
  device: "Moto G Power",
  screen: "412 by 823",
} as const;
