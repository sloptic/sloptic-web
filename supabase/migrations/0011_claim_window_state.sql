-- Was the submission window still open when we verified?
--
-- The participant notice at /e/<token> has to say which battery the entries will face, and that
-- turns on this one fact: a disclosure published after submissions closed was shown to nobody, so
-- that event gets the passive floor no matter what the organizer wants.
--
-- Recorded at verification time rather than asked later. The notice is rendered on Vercel, which is
-- outside the egress sandbox and on the wrong side of Devpost's WAF, so the page cannot look it up.
-- It is also the honest place to capture it: the question is what was true WHEN we verified, and
-- asking a month later would answer a different question.
alter table public.event_claims
  add column if not exists window_open_at_verification boolean,
  -- open_state and winners_announced as the API gave them, for the audit trail. The grader's note is
  -- that submission_period_dates is display text with no timezone, so it is never the gate.
  add column if not exists event_state jsonb;

comment on column public.event_claims.window_open_at_verification is
  'True when the submission window was still running at the moment this claim verified. NULL means
   we could not tell, which the notice must render as uncertainty rather than as either answer.';
