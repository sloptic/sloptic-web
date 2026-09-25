# claude.md: Sloptic web (sloptic.org)

The public web product for Sloptic. A user submits a deployed web app URL and gets its **slop score** (lower
is better), the per-axis breakdown (security / qa / accessibility / performance), the report card, and its **percentile
against the frozen population curve for its tier**. The GRADER lives in the separate `sloptic/sloptic-main` repo and is
consumed here as the engine. Never fork probe logic into this repo.

## What Sloptic is (if you have never seen it)

Sloptic (the grader, `sloptic-main`) is a **black-box HTTP resilience grader**: it points at a deployed web
app, probes it over HTTP with **no source and no spec**, and emits a **deduction-only slop score** (unbounded,
lower is better, `0` means nothing found) across four axes, security, qa (correctness), accessibility, and
performance; accessibility was scored inside qa until 3.0 split it out. It scores only the **intent-independent floor** every app should have regardless of purpose
(missing security headers, no rate limiting, inaccessible controls, a shipped dev build, a leaked source map),
never whether a feature is good. On a corpus of 1,579 graded hackathon apps (2,685 attempted, 2026.4) the slop is overwhelmingly *chronic*
(missing hygiene), not *acute* (exploitable holes). **Clone `sloptic-main` alongside this repo and read its
`README.md`, `claude.md`, `CONTRIBUTING.md`, and `CORPUS_REPORT.md`, that repo is the full, authoritative
account of what the grade means; this repo only wraps it in a web product.**

## Architecture

- **Frontend** (sloptic.org UI) + **thin API** (enqueues grade jobs) + **worker** (imports `sloptic`, runs the
  pipeline).
- **Grading is ASYNC.** A grade takes minutes and needs a browser (Playwright) + an LLM key, so it is a queued
  job: submit -> poll status -> results. Never block a request on a grade.
- **Percentile** comes from a `sloptic` frozen curve plus its benchmark-ranking logic. There are TWO, and
  they must never be mixed: the full curve (**2026.4**, final, n=1,579, the 106-probe grade) and the passive
  curve (**passive-2026.2**, final, n=1,702, the 45-probe battery the anonymous tier runs). Each carries
  `probe_set`, and `benchmark.rank()` refuses a cross-mode placement.
- **The curves and the ranker are VENDORED** in `worker/curves/`, verbatim from the grader's release tag:
  both curve files and the `benchmark.py` that ranks against them. The wheel ships neither. Re-vendor all
  three together from the tag you pin, never one at a time, and run `scripts/check-corpus-drift.sh`, which
  compares every vendored grader file against the pinned tag. `ranking.py` refuses any curve whose
  `version` does not match the ruler stamped on the grade.
- **The ruler.** A 3.0 score does not compare to a 2.x one. The grader stamps every record with
  `ruler: {full, passive}` (from `sloptic.ruler`), stored in `results.ruler`. Show the RECORD's ruler, never a
  constant; a record without one predates the stamp and renders as "ruler unspecified", never as current.
  It also decides a grade's axes: a pre-3.0 grade has three (see `web/lib/axes.ts`), and drawing it against
  four shows "accessibility 0", which reads as clean. 3.x releases do not move the ruler; only 4.0 does.
- The worker runs on a home desktop behind the LAN, deliberately: a datacenter IP gets challenged by Vercel's
  WAF, which would make most of the population ungradeable and the measurement incomparable to the curve.
- **The egress sandbox is BUILT** (see `docs/egress-plan.md`), four tiers: the grader's resolver guard
  (`sloptic/egress.py`) and browser route filter, a uid-scoped nftables deny on the worker host
  (`worker/deploy/egress.nft`), and the worker's own fail-closed gate. Self-test: `worker/deploy/selftest.py`.

## Integration surface (how to call the grader)

Read `sloptic-main`'s `sloptic/cli.py` and `sloptic/pipeline.py` for exact signatures; the shape is stable:

- **Programmatic:** `sloptic.pipeline.run(deployer, catalog, ...)` returns a `Report`. For a live URL the
  deployer is `sloptic.deploy.RemoteDeployer(url)`; the catalog comes from `sloptic.catalog.load_catalog(...)`.
- **Report fields:** `slop_score` (numeric), `axis_slop` ({security, qa, accessibility, performance} summing
  to slop_score; the grader OMITS a clean axis rather than zeroing it), `ruler` ({full, passive}),
  `outcomes` (per-probe results), `coverage` (how much of the battery applied), `platform` (the off-score
  host/builder identifier), `surface` (what discovery saw). The rank-consumable record and its `findings[]`
  (each: `probe_id, bundle, category, penalty, group, reason, target, evidence`) are built by
  `sloptic.cli._grade_record(report, source)`, reuse that helper rather than re-deriving it.
- **Percentile:** `benchmark.rank(curve, score, record)`. Pass the FULL record, not a bare score: the
  comparator tiebreaks on catastrophe, worst finding, slop potential and categories applied, and a bare score
  reaches none of them. Query with the exact fractional score; the curve stores fractional slop, so truncating
  places an app at the floor of its integer bucket (worth up to 8 percentiles; fixed in the grader at
  `f5067d3`).
- **Passive vs full:** the worker runs the full pipeline only for a verified origin; for everything else it
  runs `--passive-only` (`sloptic/safety.py` classifies every probe, **45 passive / 61 active of 106** at 3.0.0; use the
  flag or `safety.passive_catalog()`, which is also what the passive curve was built from, so the product and
  the curve must select through the same function or they drift). PASSIVE = changes no state AND fetches nothing
  hidden (reads only what the app serves every visitor, even if that reveals a leak). ACTIVE = mutates / sends
  a payload / needs multiple identities / goes fetching hidden data (/.env, backend queries, bulk pulls).

## The security model IS the product (do not weaken it)

The grader fires **active attack payloads** (SQLi, command injection, XSS, path traversal, XXE, upload
webshells). Aiming that at an arbitrary user-supplied URL is **unauthorized testing** (a real legal/abuse
problem) and turns the service into an SSRF/DoS relay. So:

- **PASSIVE BY DEFAULT.** An unverified target gets only observational probes (headers, TLS, accessibility,
  performance, soft-404, CWV). Active/injection probes NEVER run on an unverified target. This is legal
  safety, not a feature flag. It costs almost nothing: injection is ~0% of the slop signal on real apps, so
  the passive floor is ~all the value.
- **ACTIVE probing is a gated tier** behind domain-ownership verification (below).
- **EGRESS SANDBOX every outbound fetch** (grade AND verification): block loopback / RFC1918 / link-local /
  `169.254.169.254`. The grader must never reach internal infrastructure.
- **Rate-limit + quota every grade.** Respect robots and bot-challenges; never build anything that defeats
  them.
- **Only test targets the user owns or is authorized to test. Full stop.**

## Domain-ownership verification

Prove control of the origin to be actively tested by serving a token we issue. The durable authorization is a
**grant**, not the token.

- **The grant is ACCOUNT-BOUND, and a verified origin is NEVER globally open.** This is the load-bearing
  control. Active grading checks whether the REQUESTING account holds a grant for the origin: Alice verifying
  `alice.com` writes a grant for Alice; Mallory submitting `alice.com` has no grant and gets PASSIVE only.
  Model it as "this account may actively grade this origin," NEVER "this origin is active-gradable." The token
  file is world-readable and that is fine, reading it confers nothing; an attacker would have to serve THEIR
  OWN issued token, which needs real control, and even then the grant is only theirs.
- **Active grade = a custom domain + TWO independent control proofs: a file token AND a DNS TXT record.** They
  prove DIFFERENT surfaces (control of what is served vs control of the DNS zone), so an attacker who can plant
  a file (open upload / subdomain takeover) still fails the DNS factor. Two files at two paths are NOT two
  factors (same surface); DNS is the independent axis. Both must be present and re-checked at grade time.
  - file token: `https://<origin>/.well-known/sloptic-verification.txt` (body = token)
  - DNS TXT: `_sloptic.<domain>` = the token
- **Platform subdomains (`*.vercel.app`, `*.netlify.app`, ...) get the passive floor.** They cannot edit the
  platform's DNS zone, so the second factor is structurally unavailable; do not substitute a weak same-surface
  proof. Their path to an active grade is "attach a custom domain."
- **Scope + lifetime.** A grant authorizes only URLs under the verified origin (scheme + host + port); a
  redirect must not carry authorization off it. Grants are time-boxed (~90 days) and re-verified before an
  active grade.
- **Layered depth.** Every active grade carries: the two control proofs, the account-bound grant, a logged
  "I own this and authorize active testing" attestation (ToS-bound, so abuse is traceable and bannable), and
  the egress sandbox + rate limits. No single failure opens the active tier.

## Conventions

- **The grader is a dependency.** Pinned EXACTLY at **`sloptic==3.0.0`** from PyPI in `worker/pyproject.toml`,
  which is the single source of truth (the checks generator and CI both read it). Call it in `--passive-only`
  mode for unverified targets and the full run only for a verified origin. Do not copy or re-implement probe
  logic here; the vendored `worker/curves/benchmark.py` is a verbatim copy at the pinned tag, not a fork.
  Moving the pin means re-vendoring `worker/curves/` from the same tag, re-running `scripts/generate-checks.py`
  and `scripts/check-corpus-drift.sh`, and re-vendoring `web/lib/corpus/`.
- **The evidence visibility rule.** For the `sec-secrets-*`, `sec-backend-*` and `sec-exposure-*` families,
  where a flaw lives and how to reproduce it is shown ONLY to a verified owner of the app (a live
  `app_origin` grant for the origin, held by the viewer). Everyone else gets title, category and severity.
  Owning the REPORT is not owning the APP. Enforced in the API response by allowlist (`web/lib/evidence.ts`),
  never by hiding things in the page.
- **Stopping the worker is the signal.** Every route that hands the worker work refuses on a stale heartbeat
  (`web/lib/worker-status.ts`). For planned downtime use `worker/deploy/maintenance.sh down "why and how long"`,
  which sets the note the site shows and then stops the service; `up` clears it once the worker beats.
- **`sloptic.devpost` is the ONLY way to talk to Devpost.** Every fetch is tri-state, `ok` / `not_found` /
  `blocked`, and only 404 and 410 mean absence. A WAF status, a 5xx, a transport error, an empty 200 body, a
  challenge page, or a redirect off the pinned host are all `blocked`, which means COULD NOT CHECK. Mapping
  `blocked` onto "not verified" is the bug the whole type exists to prevent. Use `pinned_host()` rather than
  writing a `devpost.com` check anywhere, compare tokens with `compare_digest` against `event_links()` hrefs
  (never a substring search, or a participant quoting the token in a comment could verify someone else), and
  catch `Blocked` from `submissions()` rather than treating a partial gallery as the whole field.
- **A passive grade is a DIFFERENT measurement from a full grade** (fewer probes apply). It ranks on
  `passive-2026.2` and is labelled "passive floor" in the UI. Never mix a passive grade onto the full-grade
  percentile, and never let a clean passive placement read as "secure": it means clean on what a visitor can
  see, and the passive floor runs no active security checks at all.
- **Secrets are server-side only** (LLM key, DB, queue creds). Never ship them to the client bundle, Sloptic
  itself grades for exactly this leak, so leaking one here would be self-parody.
- **Prose:** no em dashes; use commas, colons, parentheses, periods.
