# Plan: get Sloptic verified (Vercel verified bot program)

Goal: cut the WAF challenges that interrupt grades, especially Vercel Attack Challenge Mode
tripping mid-run on hackathon apps. The mechanism is to make Sloptic identifiable and
allow-listable, so an edge that recognizes us can let us through, and any operator can block
us. For an authorized-testing tool, identifiable-and-blockable is the correct default.

## Where we are

- `net.make_client` sends a real Chrome UA by default, pinned by a suite test. Deliberate: an
  unknown bot UA gets challenged more than Chrome. `SLOPTIC_USER_AGENT` overrides it.
- The Playwright lane is real Chrome and cannot be declared as Sloptic. Browser traffic stays
  undeclared whatever we do here.
- The worker grades from a residential connection: no fixed IP ranges, no rDNS we control.
- Mid-grade challenges are per-app and behavior-triggered; verification does not license the
  active battery, it only makes us recognizable and contactable.

## Steps

1. **Pick the UA token.** Proposal: `Mozilla/5.0 (compatible; Sloptic/1.0; +https://sloptic.org/bot)`.
   Sites match on the token; the URL carries the contact and docs.
2. **Decide scope.** All lanes, or the event/active lane only. Both frozen curves were graded
   under the Chrome-look UA, so switching the default UA changes measurement conditions by a
   hair and makes new grades not-quite-the-curve's-population. Options:
   - active lane only: passive comparability untouched, active still re-benchmarked implicitly;
   - all lanes: cleanest identity story, accept a documented re-benchmark.
3. **Build `/bot` on sloptic.org.** What Sloptic does, the UA string, who is behind it, how to
   block or exclude a site, contact. This page is the verification anchor; bots.fyi and any
   operator both point at it.
4. **Submit to bots.fyi** (the directory in Vercel's verified-bot ecosystem). Field values:
   - Bot Name: `Sloptic`
   - What it does: grades deployed web apps from the outside (security, accessibility,
     performance) at the request of the app's owner or the event running it; HTTP fetches
     carry the `Sloptic` UA token.
   - Documentation URL: `https://sloptic.org/bot` (NOT vercel.com's own crawler docs, which is
     what the form pre-fills).
   - Verification instructions: UA token + docs page; no fixed IP ranges (single residential
     origin), so UA plus docs is the verification.
   - Contact: `hello@sloptic.org`.
5. **Verify the pipeline end to end.** Set the env, restart the worker, grade a challenged app,
   confirm the UA reaches the wire and no WAF rule rejects the token outright.
6. **Measure.** Challenge rates are already recorded (`challenge_stage`, `blocked_probes`,
   `challenge_onset_index`). Compare active-run challenge rates before/after the switch before
   deciding whether to widen scope.

## Risks

- Challenges may RISE at first: WAFs that do not know the token treat an unknown UA worse than
  Chrome. The payoff only exists where the listing is honored.
- Identifiable means blockable. That is the deal, and it is good: targets keep control.
- Curve comparability, per step 2. The frozen curves are not rebuilt for this; the corpus does
  not need a rerun because probe behavior is unchanged, only the UA the requests carry, which
  is exactly the part that must be a documented decision.

## Open questions

- Does Vercel's edge actually auto-honor bots.fyi listings, or is entry necessary-but-not-
  sufficient? Answer empirically at step 6.
- Whether the email-verification and browser-auth lanes need distinct tokens (they act as a
  real user would; declaring them may be impossible or unwise).
