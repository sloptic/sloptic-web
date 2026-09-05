/** Hosts whose DNS zone belongs to the platform, not to the person deploying on it.
 *
 *  This is not a blocklist and it is not about trust. Owner verification needs TWO independent
 *  proofs, and the second one is a TXT record in the zone. Somebody on `team.vercel.app` cannot
 *  publish under `_sloptic.team.vercel.app` because they do not hold that zone, so the factor is
 *  structurally unavailable to them: no amount of good faith makes it obtainable. Offering the flow
 *  anyway would mean asking for something impossible and then blaming them for not producing it.
 *
 *  Their path to an active grade is a custom domain, which is exactly what verifying is FOR, so the
 *  refusal names it.
 *
 *  CLAUDE.md is explicit that we never substitute a weaker same-surface proof here: two files at two
 *  paths would be one factor written twice.
 */
import suffixList from "@/../shared/platform-suffixes.json";

const PLATFORM_SUFFIXES: string[] = suffixList.suffixes;

/** The platform suffix this host sits under, or null when the host looks like its own domain.
 *
 *  An exact match counts too: `vercel.app` itself is not somebody's site. */
export function platformSuffix(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const suffix of PLATFORM_SUFFIXES) {
    if (h === suffix || h.endsWith(`.${suffix}`)) return suffix;
  }
  return null;
}

export const PLATFORM_REFUSAL =
  "That is a platform subdomain, so the DNS half of verification is not something you can publish: " +
  "the zone belongs to the platform, not to you. Attach a custom domain and verify that instead. " +
  "The passive checks run on it either way.";
