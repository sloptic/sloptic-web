import type { GradeResult } from "@/lib/types";

/** The evidence visibility rule (Ian, 2026-09-24).
 *
 *  Some findings carry evidence that shows a reader WHERE a flaw lives and HOW to reproduce it: the
 *  asset path a credential sits in, a backend's host, table and columns with a replayable request,
 *  the hidden file an app serves and the request that fetches it. Show that only to a verified owner
 *  of the app. Everyone else sees the finding's title, category and severity.
 *
 *  It matters because a report is readable by anyone holding its link, and the grades it applies to
 *  are exactly the ones strangers hold: an anonymous passive grade of someone else's app (the secrets
 *  probes run there), and a full battery event grade that other participants or the public can see.
 *  Without this, sloptic.org would be a directory of where to find other people's leaked keys.
 *
 *  Done on the SERVER, in the response, because that is the only place it means anything. A report
 *  that hid the evidence in the page while the JSON still carried it would be decoration: the JSON is
 *  one network tab away.
 *
 *  An ALLOWLIST, not a list of fields to strip. The grader keeps adding evidence (3.0 added
 *  accessibility locations and quoted console errors), and a denylist would pass the next new field
 *  straight through. Anything not named here is withheld by default.
 */

/** The families whose evidence locates a flaw. Prefixes, so a new probe in a family is covered. */
export const GATED_FAMILIES = ["sec-secrets-", "sec-backend-", "sec-exposure-"] as const;

export function isGatedProbe(probeId: unknown): boolean {
  return typeof probeId === "string" && GATED_FAMILIES.some((p) => probeId.startsWith(p));
}

/** What a finding or outcome may keep when its evidence is withheld: what it is, which axis and
 *  kind, and what it cost. Nothing that says where, and nothing that says how. */
const KEEP = ["probe_id", "bundle", "category", "penalty", "contribution", "outcome", "variant_group_id"] as const;

function keepOnly(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { withheld: true };
  for (const k of KEEP) if (k in row) out[k] = row[k];
  return out;
}

type CardEntry = Record<string, unknown> & { probe_id?: string };
type CardSection = Record<string, unknown> & { entries?: CardEntry[] };

/** A card entry for a gated probe, rebuilt from the parts that do not depend on the finding.
 *
 *  `expected` and `remediation` come from the grader's written copy for the probe and say nothing
 *  about this app. `title` is the finding's own reason, and `actual` is built from its evidence with
 *  "seen on:" and the paths, so both go. `indicates` is written copy too, EXCEPT that the grader falls
 *  back to the finding's reason when a probe has none, so it is kept only when it is not that reason.
 */
function safeCardEntry(entry: CardEntry, reason: unknown): CardEntry {
  const out: CardEntry = { probe_id: entry.probe_id, withheld: true };
  if ("penalty" in entry) out.penalty = entry.penalty;
  if (typeof entry.expected === "string") out.expected = entry.expected;
  if (typeof entry.remediation === "string") out.remediation = entry.remediation;
  if (typeof entry.indicates === "string" && entry.indicates !== reason) out.indicates = entry.indicates;
  return out;
}

/** The result as a viewer who is not the app's verified owner may see it. Pure, and returns a copy. */
export function withholdEvidence(result: GradeResult): GradeResult {
  const r = result as unknown as Record<string, unknown>;
  const findings = (r.findings as Record<string, unknown>[] | undefined) ?? [];

  // The reason each gated probe fired with, so a card entry can tell written copy from a fallback.
  const reasons = new Map<string, unknown>();
  for (const f of findings) if (isGatedProbe(f.probe_id)) reasons.set(f.probe_id as string, f.reason);

  const out: Record<string, unknown> = { ...r };
  out.findings = findings.map((f) => (isGatedProbe(f.probe_id) ? keepOnly(f) : f));

  if (Array.isArray(r.outcomes)) {
    out.outcomes = (r.outcomes as Record<string, unknown>[]).map((o) =>
      isGatedProbe(o.probe_id) ? keepOnly(o) : o,
    );
  }

  const card = r.card as (Record<string, unknown> & { sections?: CardSection[] }) | null | undefined;
  if (card && Array.isArray(card.sections)) {
    out.card = {
      ...card,
      sections: card.sections.map((sec) => ({
        ...sec,
        entries: (sec.entries ?? []).map((e) =>
          isGatedProbe(e.probe_id) ? safeCardEntry(e, reasons.get(e.probe_id as string)) : e,
        ),
      })),
    };
  }
  return out as unknown as GradeResult;
}

/** Whether a result carries anything this rule would withhold, so the page can say why it is not
 *  showing it rather than showing a finding with nothing under it. */
export function hasGatedFindings(result: GradeResult | null | undefined): boolean {
  return ((result?.findings ?? []) as { probe_id?: unknown }[]).some((f) => isGatedProbe(f.probe_id));
}
