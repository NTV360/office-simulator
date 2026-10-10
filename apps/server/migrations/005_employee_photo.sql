-- A profile picture for each employee: the https address from the company's employee records (employees.metadata.profileImage), or null.
-- The page shows it on the person card and in the search, and their initials when there is none or it does not load.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo text;
