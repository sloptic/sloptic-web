-- Grant service_role on worker_status. 0004 created the table and forgot this, so every read 403'd
-- ("permission denied for table worker_status") and the site reported that no worker was running
-- while one was polling happily two seconds earlier.
--
-- Same trap 0001 already documents: Supabase auto-grants only for objects created through its own
-- migration flow, not for tables created over a raw pooler connection. Any NEW table needs this line.
-- anon/authenticated get nothing: all access is server-side through the service role.

grant select, insert, update, delete on public.worker_status to service_role;
