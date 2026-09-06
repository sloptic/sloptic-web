# Launch checklist

Everything still outstanding before sloptic.org ships, in priority order. Frozen list: work is
struck off it, not added to it. Anything discovered later goes to a v1.1 list, not here.

Not on this list, and deliberately: the three grader issues deferred to v3.0.0 (see
`memory/grader-frozen-until-launch`), and the Ubuntu-style probe details panel.

---

## 1. Uptime monitoring on `/api/health` — Ian, ~15 min

Nothing tells you when the service breaks. The endpoint already reports what matters (grading
switched off, no worker ever checked in, stale heartbeat, worker holding, queue unreadable) and
returns a degraded status for each. Nothing polls it.

First, because everything below assumes you find out when something goes wrong. The audit found a
failure where the worker halts completely and the heartbeat thread keeps republishing its cached
state, so "the health endpoint looked fine" is a thing that has already happened here.

Note it does not cover email. Resend's free tier stops at 100 messages a day, and when it stops,
sign-in mail silently fails. That is Resend's Logs page, not this monitor.

## 2. Favicon and OG image — Claude to build, Ian to approve

`web/public` holds only `.well-known`, and there are no icon files anywhere. The metadata in
`app/layout.tsx` is otherwise complete (metadataBase, openGraph, twitter card, description), so
every shared link currently renders as a text-only card.

Two files by Next's filename convention, no code changes: `app/icon.png` and
`app/opengraph-image.png`. The OG image can be generated from JSX with `ImageResponse` instead of
being a binary nobody can edit. `twitter.card` moves to `summary_large_image` once one exists.

Second because a launch is mostly people sharing links.

## 3. The provisional percentile says which way it moves — Ian's wording, Claude to apply

The in-progress page shows "provisionally cleaner than N%". Measured against both frozen curves,
that number overstates the final placement by a median of 19 points at the halfway mark and 29
points at the quarter mark, because scoring is deduction-only and the accessibility and performance
probes sit late in catalog order.

The direction is guaranteed rather than statistical: the preview only climbs, so the percentile can
only fall. Saying so costs a few words and no math.

Third because every user sees it on every grade, and the current version reads as the site having
lied once the real number lands.

## 4. "Your grade is ready" and "Your event is ready" — Claude, ~a session

A migration for the preference column, a sender in the worker, two templates, the account-page
toggle, tests. ZeptoMail or Resend for delivery, separate from the auth path.

Three decisions needed before it starts:

- **When "ready" fires.** A grade reaches `done`, then the retry lane can re-run its blocked tail 12
  and 28 minutes later and change the score. Sending at first `done` can quote a number the report
  no longer shows. Recommendation: wait for retries to settle.
- **Anonymous grades get nothing**, since no address is collected. That is most submissions.
- **Opt-out toggle** on the account page, defaulted on.

## 5. A per-account off switch — Claude, ~1 hour

Abuse from one signed-in account currently leaves the global kill switch (`GRADING_OPEN=0`) or
hand-editing the database. Rate limits are per-IP, which does not help against an account.

## 6. The retry quota decision — Ian

Recovery passes count against neither daily lane budget. Bounded at two passes per grade, so it
cannot run away, but it is undecided.

## 7. Mailbox hygiene — Ian, ~5 min

- MX records are all priority 0; Zoho intends 10 / 20 / 50, which restores the failover ordering.
- Confirm DKIM is enabled as default in Zoho's console, not merely published in DNS. The record
  existing does not mean anything is signing with it.

---

## Done

Owner-verification renewal (`0030`, applied). The retry lane's authorization gate. The verification
fetch's deadline and body cap. Rate limits on the verify routes. The anonymous dedup guard. The
claim-expiry predicate. Health no longer leaking database errors. The grader's origin-scope leak
(fixed upstream, frozen at `4c5cd54`). `hello@sloptic.org` with SPF, DKIM, DMARC and a 10/10
mail-tester score. Custom SMTP through Resend, with both auth templates and `/auth/confirm` so the
link in the mail is on our own domain.
