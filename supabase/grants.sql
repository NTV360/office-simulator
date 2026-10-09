-- Let the app's server (Supabase's service_role, used through the secret key) reach the tables it needs.
-- Fixes "permission denied for schema public". Grants only what the app uses: read staff data,
-- read and write character looks. Nothing is granted to anon or authenticated (browsers).
grant usage on schema public to service_role;
grant select on public.employees, public.departments, public.roles, public.employment_types, public.shifts to service_role;
grant select, insert, update on public.character_information to service_role;
-- live presence: who is clocked in (read only)
grant select on public.attendances to service_role;
