-- Hosted Supabase installs pgcrypto into extensions; local PostgreSQL CI may install it into public.
-- Preserve the audit hash algorithm and support both layouts without changing applied migrations.
alter function public.set_audit_hash() set search_path = pg_catalog, extensions, public;
