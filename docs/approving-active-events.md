# Approving an event for active grading

Active grading of an event field is gated on `event_claims.active_approved`, set by hand. This
file is what that approval means and what to check before giving it. It is a procedure rather than
code, which is exactly why it is written down: the control is a person looking, and a person looking
without a list stops looking carefully after the third one.

## Why the gate exists

The owner tier wants two independent proofs (a served file and a DNS TXT record) before actively
grading **one** origin the account owns. The event tier wanted one, a link among the links Devpost
publishes on the event's pages, and that authorized active grading of up to 600 origins the account
does **not** own.

What the event tier rests on is a chain: the organizer proves they run the event, the rules page
discloses what will be done, and whoever submitted afterwards is treated as having agreed. Every
link in that chain is asserted by the same party, so one actor with a Devpost account can forge all
of it:

1. Stand up a Devpost event.
2. Publish the `sloptic.org/e/<token>` link in rules they wrote.
3. Submit entries from throwaway accounts pointing at **somebody else's** site.
4. Verify before a deadline they chose.
5. Run active.

Every automated check passes. Sloptic then sends injection payloads, registers accounts and writes
records on sites whose owners never heard of us, from our residential IP, and the attribution is
ours. Nothing in that is a compromise. It is the flow working as designed.

Approval is the one link a forger cannot supply, because it is not theirs to write.

## What to check

The question is not "is this event verified", the code already answered that. It is **"is this a
real event, with real entrants, run by the person asking"**.

- **The event exists and has a history.** Open `https://<slug>.devpost.com`. A real hackathon has a
  sponsor, dates, prizes, rules somebody wrote, and usually a host organization with a site of its
  own. An event created last week with none of that is the shape of the attack.
- **The field looks like a hackathon.** This is the strongest tell. Real entries are overwhelmingly
  `*.vercel.app`, `*.netlify.app`, `*.streamlit.app` and small custom domains, made in a weekend. A
  list of established production sites, or of unrelated companies, is not a hackathon field. It is a
  target list.
- **Multiple distinct participants.** Real fields have many accounts, with profiles that predate the
  event. A dozen entries from accounts created the same day is a fabricated field.
- **The person asking is plausibly the organizer.** Their email domain matching the host
  organization is the easy case. Otherwise, ask them something only the organizer can do, such as
  putting a second string you give them into the event's rules page.
- **The disclosure was genuinely up while entrants could read it.** The code checks that the claim
  was verified inside the submission window, which is not quite the same thing. Skim the rules page
  and confirm the link reads as a notice to participants rather than being buried.

## When to say no

Say no by default and ask for more. There is no cost to a passive run continuing while you work it
out: passive grading is self-serve, needs no approval, and is what most organizers actually want.
The only thing approval unlocks is attack traffic aimed at third parties.

Refuse outright if the entries are not hackathon-shaped. That single check catches the whole
laundering scenario, and no explanation for it should be persuasive.

## Doing it

See the SQL in the two steps below. Approve the row by `id`, never by `slug`: claims are per account,
and a slug can carry more than one.

```sql
-- 1. See what you would be approving, and who is asking.
select c.id, c.slug, c.status, c.verified_at,
       c.window_open_at_verification, c.active_approved, p.email
  from public.event_claims c
  join public.profiles p on p.id = c.account_id
 where c.slug = 'their-devpost-slug';

-- 2. Approve that exact row.
update public.event_claims
   set active_approved = true, active_approved_at = now()
 where id = '<the id from step 1>';
```

## Withdrawing it

```sql
update public.event_claims set active_approved = false where id = '<id>';
```

The worker re-reads approval before **each** grade, so this stops the field at the next entry rather
than at the next run. That is the point of re-reading it there: a field of 200 sits queued for hours,
and an event that turns out to be fraudulent after the first reports land has to stop now.

Leave `active_approved_at` alone when withdrawing. It records that approval was once given, which is
the thing an audit would want to know.

Withdrawing approval is the small hammer. Revoking the organizer grant also stops active grading and
additionally takes their passive runs down, so reach for it only when the account itself is the
problem, and use the suspension machinery when it is worse than that.

## What replaces this later

Hand approval does not scale and is not meant to. The candidates, none of them free:

- **Per-entry consent.** Actively grade an entry only if that entry's domain holds its own owner
  grant. A fabricated event can list victim URLs but cannot produce owner grants for them, so
  forgery becomes worthless. The problem is that most hackathon entries are on platform subdomains,
  which structurally cannot do the DNS factor, so nearly every entry would fall back to passive and
  the active event tier would be dead in all but name.
- **Event thresholds.** Require the event to be public, some days old, and carrying N submissions
  from N distinct accounts before active is possible. Gameable, but it raises the cost of a
  fabricated event a lot for very little product friction.
- **A second organizer surface.** Something the event's host controls that Devpost does not, such as
  a DNS record on the host organization's own domain. Strong, and it excludes real organizers who
  run their event entirely on Devpost.
