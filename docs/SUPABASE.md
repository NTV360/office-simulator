# Supabase: what the server reads

The company's employee records live in Supabase. The office server **imports** them into its own PostgreSQL (see [PHASE-6-BREAKDOWN.md](PHASE-6-BREAKDOWN.md), step 4); it never writes to Supabase, and no browser ever talks to it. (`main`'s old Express server did the same job and also saved looks to Supabase; here the look and the desk someone chooses are kept in the office's own database.)

## What to set

In `.env` (the same two names `main` uses, so an existing `.env` works):

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=the secret (service role) key: server only
```

Leave them empty and the office starts with made-up staff (or the staff list stored from an earlier import). The key bypasses Row Level Security, so it is passed only to the server container, never logged and never in an API answer.

## What it needs permission to read

`supabase/grants.sql` (from `main`) gives the service role read access to the tables the app uses. The office server reads only these, and only these columns:

| Table | Columns | For |
|---|---|---|
| `employees` | `user_id`, `first_name`, `last_name`, `employment_type_id`, `shift_id`, `deleted_at`, the department name, and one field of `metadata` (`profileImage`) | who is in the office, their department, shift, picture |
| `employment_types` | `employment_type_id`, `code`, `description` | who is an intern |
| `shifts` | `shift_id`, `code`, `start_time`, `end_time` | working hours |
| `character_information` | `user_id`, `character_data` | a look and a desk already saved there (used only for an employee who has none here yet) |
| `attendances` | `employee_id`, `clock_in`, `clock_out` | who is clocked in (only while the clock is Live) |

Contact details, birth dates, RFID values and access roles are never selected. `supabase/character_information.sql` is the table definition `main` uses; the office server only reads it.

## When something is wrong

The admin page's Staff box says when the last import happened, what it changed, or why it failed and changed nothing. A failed or doubtful read never changes the staff list (see step 4, point 4). `permission denied for schema public` means `supabase/grants.sql` has not been run.
