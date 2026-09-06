# Launch checklist

Everything still outstanding before sloptic.org ships, in priority order. Frozen list: work is
struck off it, not added to it. Anything discovered later goes to a v1.1 list, not here. Items keep
their numbers as they are struck off, so the numbers stay quotable.

Not on this list, and deliberately: the three grader issues deferred to v3.0.0 (see
`memory/grader-frozen-until-launch`), and the Ubuntu-style probe details panel.

---

## 1. Uptime monitoring on `/api/health` — DONE

Monitored. The endpoint returns 503 when degraded and 200 only when everything holds, so a plain
status check is enough; no body parsing needed.

## 2. Favicon and OG image — DONE

Both shipped, generated from code rather than committed as binaries: `app/icon.svg` (vector, so it
stays sharp on a hidpi tab strip), `app/apple-icon.png`, and `app/opengraph-image.tsx`. The mark
also appears in the masthead, the colophon and the about page's head.

## 3. The in-progress placement says "currently" — DONE

"provisionally cleaner than N%" read as an estimate of where the grade lands. It is a reading of
now, and it only falls: deduction-only scoring means the score only climbs, and measured against
both frozen curves the number overstates the final placement by a median of 19 points at the
halfway mark. "Currently" makes it a snapshot rather than a forecast.

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
link in the mail is on our own domain. sloptic pinned to 2.2.0 from PyPI, both CI clones deleted,
and a CI guard that regenerates the check facts and fails on drift. The landing sample rebuilt on
real catalog penalties, and the sample and the report now render one shared band. The mark placed
in the masthead, the colophon and the about page's head.
