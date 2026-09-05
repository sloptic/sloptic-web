-- Take the policy functions away from PUBLIC. They were reachable by anyone with the browser key.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and none of the migrations that
-- created these revoked it. `anon` inherits PUBLIC, `anon` is the role behind the publishable key
-- that ships in the client bundle, and PostgREST exposes every public-schema function at
-- /rest/v1/rpc/<name>. All three are SECURITY DEFINER, so RLS does not apply to what they do.
--
-- Verified against production before writing this: an anonymous POST to /rest/v1/rpc/bump_rate_limit
-- returned 200. The dangerous one is expire_anonymous_reports, which takes its window as a caller
-- supplied argument and deletes rows, so a negative retain_days destroys every unclaimed report on
-- the service. forget_submitter_ips likewise erases the abuse trail on request.
--
-- The grants that follow are the ones the earlier migrations already intended. Only the service
-- role, which is server side and never leaves the worker or the API routes, may call these.

revoke execute on function public.expire_anonymous_reports(int) from public;
revoke execute on function public.forget_submitter_ips(int)     from public;
revoke execute on function public.bump_rate_limit(text, timestamptz, int) from public;

grant execute on function public.expire_anonymous_reports(int) to service_role;
grant execute on function public.forget_submitter_ips(int)     to service_role;
grant execute on function public.bump_rate_limit(text, timestamptz, int) to service_role;

-- What does NOT work, so nobody tries it again: ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC records nothing (Postgres only stores positive deviations from the built-in
-- default), and even with a default ACL entry present a new function still comes out carrying
-- `=X`, which is PUBLIC. Verified on 16.15. So there is no schema-level switch that makes the next
-- function start closed.
--
-- The guard is a test instead: worker/tests/test_policy.py sweeps every function in this schema and
-- fails if any non-extension one is executable by anon. That catches the omission this migration
-- exists to fix, on the next push rather than in production.
