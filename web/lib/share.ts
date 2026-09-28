// What a shared score shows, and where it can be posted.
//
// Pure on purpose: the report page (a client component) decides from this whether to offer sharing
// and builds the post text, and the share page and card image render from it on the server. The
// database half lives in lib/share-server.ts, which the client must never import.
//
// A share is the SUMMARY of a grade and nothing more: origin, score, placement, axis subtotals, mode,
// ruler, whether the report's account is the app's verified owner, and whether a retry could still
// move the score. Never a finding. The report URL is a capability (read access to every finding and,
// while unclaimed, the right to delete the report), so a share never carries it: it points at
// /s/<share token>, which leads nowhere else.

import { AREA_LABELS, AREA_ORDER, type Area } from "./checks";

export type ShareCard = {
  /** The graded origin's host, e.g. "myapp.dev". */
  host: string;
  score: number;
  /** "Cleaner than X%" on the curve for the grade's mode. Null when the grade was not ranked, or was
   *  ranked against a stand-in reference, which the report footnotes and a share cannot. */
  cleanerThan: number | null;
  mode: "passive" | "active";
  /** The curve version this grade was scored against, for its mode: "passive-2026.2" or "2026.4". */
  ruler: string;
  axes: { id: Area; label: string; slop: number }[];
  /** The account holding this report holds a live verified-ownership grant for the app. */
  verifiedOwner: boolean;
  /** A retry after a bot challenge is still pending, so the score can still change. */
  provisional: boolean;
};

/** The columns a share needs, as stored. Loaded by lib/share-server.ts and, on the report page,
 *  read off the view the API already returns. */
export type ShareSource = {
  grade: {
    status: string;
    origin: string | null;
    submitted_url?: string | null;
    retry_due_at?: string | null;
  };
  result: {
    mode?: string | null;
    slop_score?: number | string | null;
    axis_slop?: Partial<Record<string, number>> | null;
    ruler?: { full?: string; passive?: string } | null;
    ranking?: { cleaner_than_pct?: number; reference?: string } | null;
    coverage?: { probes_total?: number } | null;
    blocked_probes?: string[] | null;
    bot_challenge?: boolean | null;
    challenge_stage?: string | null;
  } | null;
  verifiedOwner: boolean;
};

/** The host of an origin, or the string itself when it will not parse. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

/** The score as the report prints it: one decimal, dropped when whole. Postgres numeric arrives over
 *  JSON as a string. */
export function fmtShareScore(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The share card for a grade, or null when it has nothing honest to share.
 *
 *  Null when: the grade is not finished; its report is gone (an anonymous report past its window
 *  has no result); it predates Sloptic 3.0 (no ruler stamp, so the score does not compare to a
 *  current one); a bot challenge withheld it (nothing ran, and its 0 is not a clean score); or the
 *  score is missing. Each of those is a report with no number worth posting. */
export function shareCardFrom(src: ShareSource): ShareCard | null {
  const { grade, result } = src;
  if (grade.status !== "done" || !result) return null;
  if (!result.ruler) return null;

  const score = Number(result.slop_score);
  if (result.slop_score === null || result.slop_score === undefined || !Number.isFinite(score)) return null;

  // The report's own withheld rule: a challenge stopped the grade before the battery ran, so the 0
  // means nothing ran. Read from coverage only, which fails closed: a grade that did run but lacks
  // probes_total and carries a challenge is simply not offered for sharing.
  const ranAnything = (result.coverage?.probes_total ?? 0) > 0;
  const challenged =
    (result.blocked_probes?.length ?? 0) > 0 || result.bot_challenge === true || result.challenge_stage === "entry";
  if (!ranAnything && challenged) return null;

  const mode: "passive" | "active" = result.mode === "active" ? "active" : "passive";
  const ruler = (mode === "active" ? result.ruler.full : result.ruler.passive) ?? "";
  if (!ruler) return null;

  const pct = result.ranking?.cleaner_than_pct;
  const cleanerThan = !result.ranking?.reference && typeof pct === "number" && Number.isFinite(pct) ? pct : null;

  return {
    host: hostOf(grade.origin ?? grade.submitted_url ?? ""),
    score,
    cleanerThan,
    mode,
    ruler,
    // The 3.0 axes, always all four: a grade with a ruler was scored on them, and the grader omits
    // a clean axis rather than zeroing it, so an absent key IS a clean zero here.
    axes: AREA_ORDER.map((id) => ({ id, label: AREA_LABELS[id], slop: Number(result.axis_slop?.[id] ?? 0) })),
    verifiedOwner: src.verifiedOwner,
    provisional: Boolean(grade.retry_due_at),
  };
}

/** The post itself. Neutral on purpose: whoever shares a report may not own the app. */
export function shareText(card: ShareCard): string {
  const placed =
    card.cleanerThan !== null
      ? `, cleaner than ${Math.round(card.cleanerThan)}% of ${card.mode === "active" ? "actively" : "passively"} graded apps`
      : "";
  return `${card.host} scored ${fmtShareScore(card.score)} on Sloptic${placed}. Lower is better.`;
}

/** The title a link preview and a Reddit post carry. */
export function shareTitle(card: ShareCard): string {
  return `${card.host} scored ${fmtShareScore(card.score)} on Sloptic`;
}

/** Bluesky caps a post at 300 graphemes. A host can run to 253 characters, so a long one falls back
 *  to the title and then to the bare link. String length counts code units, never fewer than
 *  graphemes, so a text that fits here fits there. */
function blueskyText(text: string, card: ShareCard, url: string): string {
  const LIMIT = 300;
  for (const t of [`${text} ${url}`, `${shareTitle(card)} ${url}`]) if (t.length <= LIMIT) return t;
  return url;
}

export type ShareTarget =
  | { id: string; label: string; href: string }
  | { id: string; label: string; copy: true };

/** Where a score can be posted. Plain links to each platform's own share page, so no platform's
 *  script ever loads here. Slack and Discord have no share page: a pasted link unfurls into the
 *  card, so they copy the link.
 *
 *  Formats, checked 2026-09-28 against each platform's docs:
 *  X          x.com/intent/post?text&url
 *  LinkedIn   linkedin.com/sharing/share-offsite/?url (title and summary come from the card)
 *  Bluesky    bsky.app/intent/compose?text (text holds the link; 300 characters at most)
 *  Reddit     reddit.com/submit?url&title (the poster picks the subreddit)
 *  dev.to     dev.to/new?prefill=<url-encoded markdown with front matter> */
export function shareTargets(url: string, card: ShareCard): ShareTarget[] {
  const text = shareText(card);
  const e = encodeURIComponent;
  // A draft, not a post: published false, so nothing goes live until the author writes it up.
  const devto = [
    "---",
    `title: ${shareTitle(card)}`,
    "published: false",
    "tags: webdev, security, accessibility, performance",
    "---",
    "",
    text,
    "",
    url,
    "",
  ].join("\n");
  return [
    { id: "x", label: "X", href: `https://x.com/intent/post?text=${e(text)}&url=${e(url)}` },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { id: "bluesky", label: "Bluesky", href: `https://bsky.app/intent/compose?text=${e(blueskyText(text, card, url))}` },
    { id: "reddit", label: "Reddit", href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(shareTitle(card))}` },
    { id: "devto", label: "dev.to", href: `https://dev.to/new?prefill=${e(devto)}` },
    { id: "slack", label: "Slack", copy: true },
    { id: "discord", label: "Discord", copy: true },
  ];
}
