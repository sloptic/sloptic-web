# Organizer verification: proving someone runs a Devpost event

Scope, not yet built. Companion to the owner tier in `/verify` (custom domain + file token + DNS TXT);
this is the OTHER route to a full grade, for a hackathon organizer ranking a whole field.

## What actually needs proving, and it is two different things

These get conflated, and separating them is most of the design:

1. **Consent** to publish a judgment of other people's work. Ranking a field means putting a number on
   entries whose authors never asked us. The organizer's published rules already say submissions are
   evaluated, so an organizer STARTING the ranking is the consent signal. This is the only gate a
   PASSIVE event ranking needs, because the 44 look-only checks are safe on any public URL by
   construction (running them is no different from visiting the site).
2. **Authorization** to send attack traffic, for a full/active grade. That is a legal question, not a
   consent one, and it needs the per-app proof as well (below).

So the organizer proof is the gate on (1) and half the gate on (2). It is NOT a safety control for
passive grading, and pretending otherwise would gold-plate the cheapest useful tier out of existence.

## The proof, and why this shape

An unpredictable token we issue, placed where ONLY an event admin can put it, fetched server-side.

**Verified empirically 2026-08-30** against live Devpost:

- `https://<slug>.devpost.com/rules` is server-rendered HTML, 200, fetchable with httpx and the full
  Chrome UA (a bare `Mozilla/5.0` is 403'd, per `scripts/devpost_repos.py`).
- Organizer-authored prose renders there (RevenueCat Shipaton's Official Rules), and so do
  **arbitrary outbound links** the organizer wrote: `discord.com/invite/...`,
  `revenuecat.com/docs/...`. That is the capability the whole scheme rests on.
- `https://devpost.com/api/hackathons` is open JSON, carrying `url`, `submission_gallery_url`,
  `open_state`, and `invite_only`.
- Not every event fills in `/rules` (MadHacks Fall 2025 leaves it empty), so the check must scan the
  event's Overview page too, which always carries organizer prose.

**Form: a disclosure link, not a bare string.** Visible text like "Grading policy" whose href is
`https://sloptic.org/e/<token>`. A naked base64 blob on a public rules page looks like a defacement
and organizers would reasonably refuse; a link that explains itself doubles as the participant notice
that entries are evaluated, which the rules ought to carry anyway. The token rides in the href where
it is machine-readable and humanly unobtrusive.

## Check discipline

The failure that matters is accepting a token that is not really there, and its mirror, reading a
block as an absence.

- Pin the EXACT host `<slug>.devpost.com`. Never substring-match `devpost.com`, which
  `evil-devpost.com` and `devpost.com.attacker.net` both satisfy.
- Extract `<a href>` values pointing at our own origin, parse the token from the path, compare with
  `secrets.compare_digest`. Never regex the token out of the whole page: a token quoted anywhere on
  the page (a participant pasting it into a discussion thread) must not count.
- **A WAF block is not an absence.** Devpost's AWS WAF answers a rate-limited client with 202/403/
  405/429/503, sometimes a 0-byte body. `devpost_repos._get` already retries with backoff and hands
  the final block back so the caller can tell a block from a 404. Verification must do the same and
  report "could not check, try again", never "not found" and never "verified".
- Re-check at grade time, not just at registration: a token removed after verification should end the
  grant.

## What the token buys, and its limits

- The grant is **account-bound and event-scoped**: this account may rank THIS event. It is not a
  claim about any app, and it never travels to another event.
- **Time-boxed**, like the owner grant, and re-verified before a ranked run.
- **Membership is corroborated separately**: an app is graded as part of an event only if its URL
  appears in that event's own gallery (`<slug>.devpost.com/submissions/search?page=N`, parsed by
  `page_projects` + `links_for`). So an organizer cannot inject an unrelated app into their board.

## Threat model

- **A participant claiming their event.** Needs edit rights on the event's Devpost pages. That is
  exactly the capability being tested, so this is the scheme working, not a hole.
- **Someone claiming an event they do not run** by hosting the token elsewhere. Defeated by pinning
  the exact event subdomain: the only place that counts is a page only its admins can edit.
- **A stale grant after an organizer change.** Time-boxing plus re-check at grade time.
- **Us being blocked mid-verification.** Ambiguity fails closed (see above).
- **The residual, accepted deliberately for the event tier:** the per-app proof drops the DNS factor
  that the owner tier requires, because accountability replaces it. An attacker planting a file on
  someone else's entry is a named account, attested, and corroborated against the gallery, for the
  payoff of getting one app actively probed at a hackathon. Layered depth still applies: egress
  sandbox, rate limits, the logged attestation, and one tier per event.

## Build order

1. **Passive event ranking, no verification at all.** Organizer pastes a Devpost URL, we pull the
   gallery, grade the deployed entries passively, publish a board. Needs consent, which starting it
   supplies, plus a per-team opt-out. This is most of the product value and it is buildable today.
2. **Organizer verification** as above, which unlocks naming the event publicly and gates the tier
   choice.
3. **Per-app file token, collected at submission time**, unlocking the active tier for an event.
   Chasing disbanded teams after an event does not work; it has to be a rules requirement up front.

## Open questions

- **Invite-only events** (`invite_only` in the API) may have no public gallery. Probably out of scope
  for v1: no public gallery means no membership corroboration.
- **Cost.** A 400-app field at ~7 minutes each is ~46 hours on one worker. Batching, concurrency, and
  the daily budget interact here, and a single residential worker may simply not be the right shape
  for a large event.
- **Which page do we tell organizers to edit?** Rules is the honest home (it is the notice), but
  Overview is more reliably populated. Probably: accept either, instruct Rules.

## Accounts: what a grant binds to

Under-specified above, and it determines the build order: a grant has to attach to an identity, so
verification cannot precede accounts. This is the first feature that needs them.

Note WHY, because it is not the reason the owner tier needs them. Passive checks are safe on any
public URL, so a passive event ranking has no legal gate. Its gate is CONSENT, and consent needs an
identity: with no accounts, a stranger could rank a hackathon they have nothing to do with and
publish a table judging other people's work. The account is what makes "the organizer started this"
a claim someone is answerable for.

Minimum shape:

- **Supabase Auth, email magic link.** Already present in the project (part of why Supabase was
  chosen), and a magic link means no password hashes to store. Sloptic grades for exactly that leak
  class; storing credentials we do not need would be self-parody.
- **`grants(account_id, scope, role, expires_at)`**, scope being `event:<slug>` or
  `origin:<scheme://host:port>`. Time-boxed, re-checked at grade time.
- **ToS acceptance at signup**, since the attestation is what makes abuse traceable and bannable,
  one of the layers the active tier rests on.

What does NOT change: anonymous single-URL passive grading stays account-free. Value first, sign-in
only when a feature genuinely needs an identity. The report page's "verify the domain to run the
rest" is already that prompt.

Order, smallest first, each gating the next: accounts -> organizer verification -> passive event
ranking -> per-app tokens for the active event tier.
