-- The staff list: who is in the office. Imported (read-only) from the company's employee records (Supabase) when the server is
-- configured for it, and kept here: the look and the desk someone chooses are saved here and are never overwritten by an import.
-- See docs/PHASE-6-BREAKDOWN.md, step 4.

CREATE TABLE employees (
  -- the id in the company's employee records
  user_id      uuid PRIMARY KEY,
  first_name   text NOT NULL,
  last_name    text NOT NULL,
  department   text,
  intern       boolean NOT NULL DEFAULT false,
  -- { "code": "DAY", "start": 540, "end": 1080 } in minutes since midnight; an end before the start is the next morning; null: the default day shift
  shift        jsonb,
  -- the look chosen here (always passed through normalizeSpec before it is stored), or null: one is made from the id
  character    jsonb,
  -- the seat id chosen here ('A3', 'HR2'), or null: any free desk
  desk         text,
  -- no longer in the company's records (kept, so a look and an account link are not lost if they come back)
  removed      boolean NOT NULL DEFAULT false,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- two employees cannot choose the same desk
CREATE UNIQUE INDEX employees_desk_idx ON employees (desk) WHERE desk IS NOT NULL AND NOT removed;

-- An account is linked to at most one employee (and an employee to at most one account): logging in takes over that employee's person.
ALTER TABLE accounts ADD COLUMN employee_id uuid UNIQUE REFERENCES employees (user_id) ON DELETE SET NULL;
