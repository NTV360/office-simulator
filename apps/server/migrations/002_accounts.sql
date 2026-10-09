-- Accounts, sessions and the admin audit log. See docs/PHASE-3-BREAKDOWN.md, step 1.

CREATE TABLE accounts (
  id                    serial PRIMARY KEY,
  -- what the person typed (shown to others), and the same thing lower-cased (what must be unique)
  username              text NOT NULL,
  username_lower        text NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  role                  text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  disabled              boolean NOT NULL DEFAULT false,
  -- set by an admin password reset: the person must choose their own at the next login
  must_change_password  boolean NOT NULL DEFAULT false,
  -- the desk an admin gave this account (a spot id such as 'desk:12'), or null while it is waiting for one
  slot_spot             text UNIQUE,
  -- the character look, once created (always passed through normalizeSpec before it is stored)
  spec                  jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  CHECK (username_lower = lower(username)),
  CHECK (char_length(username) BETWEEN 3 AND 24)
);

-- A session is a random secret the browser holds in a cookie. Only its SHA-256 is stored, so a copy of this table
-- cannot be used to log in.
CREATE TABLE sessions (
  id            serial PRIMARY KEY,
  token_hash    bytea NOT NULL UNIQUE,
  account_id    integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- What admins did, and who did it.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   integer REFERENCES accounts(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb
);
