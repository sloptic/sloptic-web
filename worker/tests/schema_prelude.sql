-- What Supabase provides and a bare Postgres does not.
--
-- The migrations are applied to the test database exactly as they are applied to production, so this
-- file exists only to stand up what they lean on from the platform: the roles that grants name,
-- auth.users, which the owner columns reference, and auth.uid(), which the RLS policies call.
-- Everything else in the schema is ordinary Postgres and is exercised as written.
--
-- Deliberately NOT recreated: RLS itself. The migrations enable it, and the worker connects as the
-- owner and bypasses it, which is exactly what the service role does in production.
--
-- Idempotent throughout, because roles are cluster-wide and outlive the database that is dropped
-- and recreated between runs.

-- Dropped with the public schema each session, so it is recreated here rather than assumed.
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end
$$;

create schema if not exists auth;

-- Only the column the foreign keys point at. Anything more would be inventing a contract with
-- Supabase that these tests have no business asserting.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
