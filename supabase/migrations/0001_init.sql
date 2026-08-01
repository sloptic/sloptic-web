-- sloptic-web v1 schema (Supabase Postgres).
-- Anonymous passive grades with IP rate-limiting. No accounts in v1 (v2 adds accounts, grants, quotas).
-- All access is server-side via the service role: RLS is ON with NO public policies, so the anon/public
-- key can read nothing. The frontend never talks to Postgres directly; it goes through the route handlers.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- The job. One row per submitted grade.
create table if not exists public.grades (
  id            uuid primary key default gen_random_uuid(),
  -- normalized origin actually graded (scheme + host + port), lowercased, no path/query.
  origin        text not null,
  -- the raw URL as submitted, for display/debugging.
  submitted_url text not null,
  mode          text not null default 'passive' check (mode in ('passive', 'active')),
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),
  -- coarse submitter identity for rate-limiting/abuse (hashed IP; never store a raw IP long-term).
  submitter_ip_hash text,
  error         text,
  attempts      int not null default 0,
  submitted_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz
);

-- Worker claim query hits this: oldest queued first.
create index if not exists grades_queue_idx
  on public.grades (submitted_at)
  where status = 'queued';

-- The finished grade. One row per completed job. Shape mirrors shared/contract.md.
create table if not exists public.results (
  grade_id            uuid primary key references public.grades(id) on delete cascade,
  mode                text not null default 'passive',
  catalog_version     text not null,      -- e.g. "sloptic-1.1.0"
  passive_probe_count int,
  slop_score          int not null,
  axis_slop           jsonb not null,     -- { security, qa, performance } sums to slop_score
  coverage            jsonb not null,
  platform            jsonb,              -- off-score host/builder identifier
  surface             jsonb,              -- what discovery observed
  findings            jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

-- Simple fixed-window IP rate-limit counter. (Scale path: move to Redis/edge; this is fine for v1.)
create table if not exists public.rate_limits (
  ip_hash      text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (ip_hash, window_start)
);

alter table public.grades      enable row level security;
alter table public.results     enable row level security;
alter table public.rate_limits enable row level security;
-- No policies created on purpose: only the service role (used server-side) bypasses RLS.
