-- An admin can mute an account: it can still play, but what it types in chat is not sent to anyone. See docs/PHASE-4-BREAKDOWN.md, step 3.
ALTER TABLE accounts ADD COLUMN muted boolean NOT NULL DEFAULT false;
