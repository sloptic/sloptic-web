-- Accounts and grants.
--
-- The account itself is Supabase Auth's (auth.users), so nothing here stores a credential: sign-in is
-- an email magic link, and adding Google or GitHub later changes configuration, not this schema.
-- Sloptic grades apps for leaked secrets; holding password hashes we do not need would be a poor look.
--
-- A GRANT is the durable authorization the verification flows write. It is what makes "this account
-- may actively grade this origin" true, as opposed to "this origin is open", which must never be a
-- thing the system can express.

create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  -- Set when the account accepts the terms. The active tier rests partly on an attestation being
  -- traceable to someone who agreed to them, so a NULL here means the account cannot hold a grant.
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.grants (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users(id) on delete cascade,
  -- 'app_origin'    -> scope is a normalized origin (scheme://host[:port]); proof is file token + DNS TXT
  -- 'organizer_event' -> scope is a Devpost event slug; proof is the token link in the event's rules
  kind        text not null check (kind in ('app_origin', 'organizer_event')),
  scope       text not null,
  -- how it was proven, for audit: which pages/records were fetched and matched
  evidence    jsonb,
  granted_at  timestamptz not null default now(),
  -- Time-boxed on purpose: a domain changes hands, an organizer moves on. Re-checked at grade time
  -- regardless, so this is the outer bound, not the only control.
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

-- One live grant per account per scope. A second verification refreshes rather than accumulates.
create unique index if not exists grants_account_scope_idx
  on public.grants (account_id, kind, scope)
  where revoked_at is null;

-- Lookup at grade time is always "does THIS account hold a live grant for THIS scope".
create index if not exists grants_scope_idx on public.grants (kind, scope) where revoked_at is null;

alter table public.profiles enable row level security;
alter table public.grants   enable row level security;

-- An account may read its own row and its own grants, and nothing else. Writes are server-side only:
-- a grant must never be creatable by the account it would authorize.
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);
create policy grants_self_read on public.grants
  for select using (auth.uid() = account_id);

-- Service role, as with every other table (see 0001 and 0005: Supabase does not auto-grant for
-- objects created over a raw pooler connection, so every new table needs this line).
grant select, insert, update, delete on public.profiles, public.grants to service_role;
grant select on public.profiles, public.grants to authenticated;

comment on table public.grants is
  'Durable authorization written by a verification flow. ACCOUNT-BOUND by construction: the question
   is always "may this account actively grade this scope", never "is this scope open".';
