-- Active grading of an event field needs a human to look at the event first.
--
-- The owner tier asks for TWO independent proofs (a served file and a DNS TXT record) before it will
-- actively grade ONE origin the account owns. The event tier asked for one, a link among the links
-- Devpost publishes on the event's own pages, and that authorized active grading of up to 600
-- origins the account does NOT own. The weaker proof carried the broader and more dangerous power.
--
-- What the event tier actually rests on is a chain: the organizer proves they run the event, the
-- rules page discloses what will be done, and whoever submitted afterwards is treated as having
-- agreed. window_open_at_verification keeps that from being fiction. But every link in the chain is
-- asserted by the same party, so the chain is forgeable end to end by one actor: stand up a Devpost
-- event, publish our link in its rules, submit entries from throwaway accounts pointing at somebody
-- else's site, verify before your own deadline, run active. Sloptic then sends injection payloads,
-- registers accounts and writes records on sites whose owners never heard of any of this, from our
-- IP, and the attribution lands on us. Nothing in the flow is a compromise; it is the flow working.
--
-- Approval breaks that by adding the one link the forger cannot supply: someone who is not them.
--
-- Deliberately on the CLAIM and not the run. What gets approved is "this event is real and this
-- account runs it", which is a fact about the event and survives every run of it. Putting it on the
-- run would ask the same question again for each one and answer it from the same evidence.
--
-- PASSIVE event runs are untouched and stay self-serve. A passive probe does what any visitor does,
-- so there is no consent to establish and nothing here to gate. The tier organizers actually came
-- for keeps working the moment they verify.

alter table public.event_claims
  add column if not exists active_approved boolean not null default false,
  add column if not exists active_approved_at timestamptz;

comment on column public.event_claims.active_approved is
  'A human confirmed this is a real event that this account really runs, which is the one thing a
   fabricated event cannot produce. Required for an ACTIVE run, on top of the organizer grant and
   the submission-window check; neither replaces it. Passive runs never consult it.';

comment on column public.event_claims.active_approved_at is
  'When approval was given. An authorization decision with no timestamp cannot be audited later,
   and this one authorizes attack traffic at third parties.';
