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
also appears in the masthead, the colophon and the about page's head. The live placement says "currently"
rather than "provisionally".

## 3. The in-progress placement says "currently" — DONE

"provisionally cleaner than N%" read as an estimate of where the grade lands. It is a reading of
now, and it only falls: deduction-only scoring means the score only climbs, and measured against
both frozen curves the number overstates the final placement by a median of 19 points at the
halfway mark. "Currently" makes it a snapshot rather than a forecast.

## 4. "Your grade is ready" and "Your event is ready" — DONE

One message when a grade reaches `done`, whether or not a recovery pass is still booked; one per
event RUN when the whole field is graded, never one per app. Sent by the worker through Resend,
separate from the auth mail. Opt-out on the account page.

Needs `RESEND_API_KEY` and `NOTIFY_FROM` in the worker environment, or it stays off.

## 5. A per-account off switch — DONE

`profiles.suspended_at`, checked at every web entry point that spends outbound traffic and again in
the worker, so work queued before the suspension does not run. Set it with SQL; see
`worker/README.md`.

## 6. The retry quota decision — DONE

Left as it is, on purpose: recovery passes do not count against either daily budget. A pass re-runs
only the blocked tail and is capped at two, so the overrun is bounded. Counting them would refuse
recovery on the busiest days, and an unrecovered tail reports as N/A, which is lost recall dressed
as a clean result. Recorded in `worker/sloptic_web_worker/config.py` beside the budget itself.

## 7. Mailbox hygiene — Ian, nearly done

- MX priorities: DONE, 10 / 20 / 50, confirmed authoritative.
- Still open: confirm DKIM is enabled as default in Zoho's console, not merely published in DNS. The
  record existing does not mean anything is signing with it.

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
in the masthead, the colophon and the about page's head. The live placement says "currently"
rather than "provisionally".
