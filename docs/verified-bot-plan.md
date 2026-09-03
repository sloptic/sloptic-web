# Plan: get Sloptic into Vercel's verified bots directory

Goal: stop the Vercel Attack Challenge Mode trips that interrupt grades on hackathon apps.
Vercel's own docs say how: their bot protection ruleset and Attack Mode "automatically
recognize and allow" verified bots, no challenge. Getting verified is the way through.

Facts that shape the plan (vercel.com/docs/bot-management, /docs/botid/verified-bots):

- bots.fyi IS Vercel's directory. `bots.fyi/new-bot` is the official submission path ("submit a
  bot request if you are a SaaS provider"). Verified bots pass Attack Mode and bot protection
  automatically.
- The bot protection ruleset "prevents requests that falsely claim to be from a browser, such as
  a curl request identifying as Chrome." Our default Chrome-look UA is exactly that signature.
  The honest UA is not etiquette, it is the entry condition.
- Verification accepts three methods: IP ranges, reverse DNS, or Web Bot Auth (WBA), the IETF
  draft that signs each request (RFC 9421 HTTP Message Signatures). We grade from a residential
  connection: no IP ranges, no rDNS we control. WBA is therefore the only path that can work,
  and it works from any origin, residential included.
- Precedent: `cybaa-agent` sits in the verified directory under "verification" -- "performs
  user-initiated security checks on behalf of customers, validating security headers, TLS/SSL
  configuration." That is Sloptic's exact category, so the use case is acceptable to them.
- Operators can still block a verified bot by UA or by the `Signature-Agent` header. Identifiable
  means blockable; for an authorized-testing tool that is the correct default, not a cost.

## Steps

1. **Pick the UA token.** Proposal: `Mozilla/5.0 (compatible; Sloptic/1.0; +https://sloptic.org/bot)`.
   Drop the Chrome look on the HTTP lane; it is the thing being filtered against.
2. **Implement Web Bot Auth signing.** Generate a key pair bound to sloptic.org; sign each HTTP
   request per RFC 9421 (`@method`, `@authority`, `@path`, user-agent, `Signature-Agent`) in the
   grader's httpx client; publish the public JWKS at a well-known URL on sloptic.org; register
   the key with the directory at submission. Private key lives on the worker host only, like the
   other secrets. Tooling: the `wba-verify` project exists for testing our signatures before
   submitting.
3. **Build `/bot` on sloptic.org.** What Sloptic does, the UA string, the Signature-Agent value,
   the JWKS location, who runs it, how to block or exclude a site, contact. This page anchors
   both the directory listing and any operator's decision.
4. **Submit at bots.fyi/new-bot.** Bot Name `Sloptic`; description names the UA token, the
   Signature-Agent header, and that grading runs at the request of the app's owner or the event;
   Documentation URL `https://sloptic.org/bot` (NOT the vercel.com crawler docs the form
   pre-fills, which describe Vercel's own bot); verification instructions = UA + Signature-Agent
   + WBA key registration (no IP ranges, single residential origin); contact `hello@sloptic.org`.
5. **Verify end to end.** Set the env, restart the worker, grade a known-challenged app, confirm
   the signed headers reach the wire and a BotID check (or the challenge behavior itself)
   recognizes us.
6. **Measure.** Challenge rates are already recorded (`challenge_stage`, `blocked_probes`,
   `challenge_onset_index`). Compare active-run challenge rates before/after before calling it
   done.

## Scope notes

- The HTTP lane is signable per request. The Playwright lane drives a real Chrome that sends its
  own requests and cannot carry our signatures; it stays undeclared. If browser-lane challenges
  remain the problem after verification, that is a separate decision.
- Curve comparability: both frozen curves were graded under the Chrome-look UA, so switching the
  default UA changes measurement conditions by a hair. Probe behavior is unchanged, so no corpus
  rerun; but the switch should be a documented line in the grading notes, and passive-vs-active
  scope decided once (all lanes is the cleaner identity story).
- Email-verification and browser-auth probes act as a user would; they keep the browser UA. They
  are not declared and should not be.

## Risks

- WBA is an IETF draft and the tooling is young; signing may need debugging against Vercel's
  verifier before submission.
- Verification is necessary but not guaranteed: Vercel validates submissions against strict
  criteria. The Cybaa precedent says the category is acceptable; it does not promise approval.
- An unsigned Sloptic UA alone is worse than today's Chrome look (unknown bot). Steps 2 and 4
  belong together; do not ship the UA switch without signing behind it.
- Active payloads are not licensed by verification. It makes us recognizable and contactable;
  targets keep full control to block.
