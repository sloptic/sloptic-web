-- Publish WHICH lane is not being claimed, not merely that nothing is.
--
-- worker_status could already say 'holding' with a reason, but the worker only sets that when NO
-- lane is claimable. A spent public budget while events still had allowance left the state at
-- 'polling', so the reason lived in the worker's memory and its log and reached the database
-- nowhere. The web side therefore could not tell "today's public allowance is gone" from "idle". It
-- kept accepting submissions the worker had already decided not to claim, held them for an hour and
-- failed them with "no worker was available to run it", which blames a worker that was alive and
-- busy. Publicity is exactly the condition that produces that, at the exact moment it is read as
-- the site being broken.
--
-- A map rather than another state value, because the lanes block independently and separate budgets
-- exist precisely so that one being spent says nothing about the other. Anything `state` could
-- express would have to collapse them again.

alter table public.worker_status
  add column if not exists blocked_lanes jsonb not null default '{}'::jsonb;

comment on column public.worker_status.blocked_lanes is
  'lane -> why it is not being claimed, e.g. {"public": "daily budget spent (300/300 in 24h)"}.
   Empty means every lane is open. Independent of `state`: the worker can be grading one lane while
   another is blocked, which is the case `state` alone could not express.';
