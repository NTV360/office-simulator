-- The saved world: one row, replaced on every save. Everything the simulation needs to carry on after a restart
-- (the clock, who is in, where they stand) is one JSON document; see packages/shared/src/sim/persist.ts.
CREATE TABLE world_state (
  id        integer PRIMARY KEY CHECK (id = 1),
  data      jsonb NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now()
);

-- A save that could not be read is kept here for a human to look at, never silently overwritten.
CREATE TABLE world_state_rejected (
  id        serial PRIMARY KEY,
  data      jsonb,
  reason    text NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now()
);
