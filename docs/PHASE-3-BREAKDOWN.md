# Phase 3 breakdown: accounts and takeover

**Status: in progress. Step 0 is done; steps 1 to 8 are next.** This turns phase 3 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) into small, ordered, individually testable steps, the same way phases 1 and 2 were done.

**Done when (from the plan):** you can register, create your character, log in and drive your person, log out and watch it carry on as an NPC, and log back in where it is.

## 1. What changes, in plain words

Until now every browser is an anonymous viewer of one office. After phase 3:

- **Nobody connects without an account.** Register, log in, get a one-time ticket, open the realtime connection with it.
- **A new account waits for a desk.** It can log in and walk around as a **guest** (appears at the entrance, nothing is saved about the guest's position), but it has no desk and no person of its own. An admin assigns it one of the unclaimed desks.
- **A claimed desk's person belongs to the account.** When the owner is offline the person is an ordinary autopilot NPC (name and look are the account's). When the owner logs in, the account takes over **that same person, where it stands**. On logout (after a 30 second grace for dropped connections) the person goes back to AI from where it stands.
- **Players are never sent home** by the end-of-day reset; autopilot people still are.
- **Admins are accounts with a role**, not a shared token. They assign and release desks, reset passwords, disable accounts, kick, and still control staff count, speed, pause and announcements.

The movement part is deliberately plain: the browser sends **inputs** (a move direction, heading, run), the server moves the person with the shared collision code and speed limits, and the browser draws what comes back. It works but feels a little laggy (about one round trip). **Prediction and reconciliation arrive in phase 4**, which is where "many people walk together smoothly" is solved.

## 2. Decisions

Approved by you (the defaults proposed earlier):

1. Registration creates an account **waiting for a desk**; an **admin picks the slot**.
2. Waiting accounts **can log in as a guest** and walk around from the entrance.
3. **No email.** An admin resets a forgotten password.
4. **Admin is a role** on an account, replacing the shared `ADMIN_TOKEN`.
5. **Plain SQL migrations stay** (no Prisma yet).

Made by me while planning (say if you disagree):

6. **Cookie sessions instead of access plus refresh tokens.** Login sets one httpOnly, SameSite=Strict cookie holding an opaque random session id (stored hashed in the database, 7 days, revocable). It is simpler than the plan's token pair and equally safe for an internal app; the cookie gets the Secure flag as soon as the site is on HTTPS (phase 7). The realtime connection uses a one-time **ticket** (about 30 seconds) from `POST /api/play/ticket`, never a token in a URL.
7. **A sign-up code is optional.** If `SIGNUP_CODE` is set in `.env`, registering needs it. Cheap protection for "company only".
8. **The first admin comes from the environment.** `ADMIN_USERNAME` and `ADMIN_PASSWORD` create an admin at start-up if there is none.
9. **argon2id through `@node-rs/argon2`** (prebuilt for Alpine, no compiler in the image). Step 1 proves it works in the Docker image before anything depends on it.
10. **Taking over an away person:** if the owner logs in before their person has come in for the day, the person appears at the entrance and is in (it counts as their arrival). A **guest** is a person with no desk, created at login and removed after logout.
11. **Assigning a desk to someone who is logged in as a guest** disconnects them with the message "your desk was assigned, log in again" (simple and robust, instead of converting a live guest into a staff person).
12. **After a server restart everyone is offline**: claimed persons come back on autopilot and players log in again (the session cookie still works, so it is one click).
13. **Anonymous viewing is removed in online mode** (company only). Offline mode (a private copy, for development) is unchanged.

Still open from the plan, with the plan's defaults (none of them blocks this phase):

- Rename "Desk 01 to 08" as Stations A to H. The plan said "in phase 1" but it was not done; it is cosmetic, so it waits until you want it.
- Moderation (mute, ban): admins. Chat itself is phase 4.
- Remote play over a VPN: office network only for now.

## 3. What does not exist yet and must be built first

| Need | Today | Answer (step) |
|---|---|---|
| **Ids that cannot collide** | A staff id is "how many staff there are now", so a player (not counted as staff) would reuse one | A counter that only goes up, saved with the world; guests get ids from a separate high range (step 0) |
| **Words for the three kinds of person** | `isStaff` is used everywhere to mean "driven by the simulation", "has a desk" and "counts in the ledger" at once | Three predicates, every use reviewed (step 0) |
| **A person that belongs to an account** | `Person` has a controller but no owner | `owner` (account id) on the person and in the save (step 0) |
| **Accounts, sessions, passwords** | Nothing | Tables, argon2id, cookie sessions, limits (step 1) |
| **An authenticated realtime connection** | Anyone who says hello is a viewer | Tickets, one session per account (step 2) |
| **Takeover and handback** | Nothing | A server-side manager with a grace timer (step 3) |
| **Inputs and sitting on the server** | The browser moves its own character and nobody else sees it | `input` and `act` messages, shared seat rules, speed caps (step 4) |
| **Character creation** | The rebuild-the-look code exists, there is no screen | A creation page with a live preview and a server check (step 5) |
| **A login screen and driving online** | The page is a viewer | Login overlay, online control path (step 6) |
| **Admin tools** | A shared token and three endpoints | Roles, user management, audit log, a small admin page (steps 3 and 7) |

## 4. The steps

| # | Step | Delivers | Proof |
|---|---|---|---|
| **0** (**done**) | Identity foundations | Ids that cannot collide (see the note under step 0: the lowest free id, not a counter and a range); `Person.owner`; predicates `isAi` (the simulation drives them), `hasSlot` (counts as a slot, in the ledger and in the staff count) and `isDriven` (a human drives them), with every current `isStaff` use reviewed and moved to the right one; `setStaffCount` never removes a claimed person; save version 2 with `owner` and a reader for version 1 | Unit tests for each predicate use; old saves still load; guest and staff ids never collide in a long run; **offline recordings unchanged** |
| **1** | Accounts and sessions | Migration with `accounts`, `sessions`, `audit_log`; `POST /api/auth/register`, `login`, `logout`, `GET /api/auth/me`; argon2id; usernames unique and case-insensitive; password rules; per-username lockout and per-address limits; optional `SIGNUP_CODE`; admin bootstrap from the environment | Unit and database tests (wrong password, duplicate and case variants, lockout and recovery, session expiry, logout kills the session, nothing sensitive logged or returned); the argon2 package loads and hashes inside the Docker image |
| **2** | Tickets and the authenticated socket | `POST /api/play/ticket` (one use, about 30 s); the gateway admits only a valid ticket, and `hello` carries it; a second login kicks the first; protocol version 3 starts here | Integration tests with real sockets: no ticket, a used ticket, an expired ticket, a stolen ticket for another account, double login; anonymous viewing is gone online |
| **3** | Takeover and handback | A server `PlayerManager`: claimed account takes over its person where it stands (an away person appears at the entrance); guest gets a new person at the entrance; the 30 s grace; handback to AI; a reconnect inside the grace resumes; admin `assign-slot` and `release-slot`; `owner` saved and restored | Node tests of the whole life cycle (login, logout, grace, reconnect, assign, release, restart); the day roll-over does not send a player home; claimed autopilot still goes home |
| **4** | Moving and sitting on the server | `input` (sequence, move x and z, heading, run) and `act` (sit, stand) messages; the server steps controlled people with `stepPlayer`, speed caps and the shared seat rules (`nearestSeat` moves to `shared`); controlled people are sent every tick; AI avoids them | Tests: walls hold, speed cap holds (walk 1.5, run 3 m/s plus tolerance), cannot sit in an occupied or far seat, input floods are dropped, a controlled person never gets AI tasks, the autopilot picks up cleanly from a chair |
| **5** | Character creation | `GET` and `PUT /api/character` (always `normalizeSpec`); a `look` message so everyone sees a change at once; the look is saved with the person and the account; a creation page (swatches, hair style, glasses, jacket, headphones, height) with a live preview; the first login after a desk is assigned opens it | Server tests (bad input becomes valid, other people cannot change your look); a browser test that creates a character and a second browser sees it |
| **6** | Login and driving in the browser | Login and register screens; "waiting for a desk" state for guests; online control path (inputs out, server position in, own person drawn without the 150 ms delay); first and third person cameras on your server person; logout; automatic resume with the session cookie | Browser tests: register, log in as a guest, get assigned (through the API), create a character, walk, sit, log out, see the autopilot carry on in another browser, log back in where it stands |
| **7** | Admin | Role checks on every admin endpoint (the shared token goes away); list accounts and unclaimed desks; reset password (the user must choose a new one at next login); disable and enable; kick; the audit log; a small admin page served with the site | Tests for each action including who may and may not; the audit log records them; the page is checked in the browser |
| **8** | End to end and review | `npm run e2e:accounts` plays the plan's "done when" in two real browsers against its own stack, including a server restart in the middle; a read-only review of the whole phase and its fixes; docs finished | The script passes; the review's findings are fixed with tests |

Steps 0 to 2 are plumbing with no visible change. You first **see** something at step 6; the unit and integration tests carry the proof until then.

## 5. How each step is checked

Every step runs the earlier checks (`npm test`, `npm run typecheck`, `npm run build`, `npm run check:docs`, `npm run verify:browser:thorough`, `npm run check:mutations`, `npm run test:db`, the Docker smoke test, `VERIFY_URL=http://localhost:8080 npm run verify:browser`, `npm run e2e`) plus its own proof above. The offline recordings must not change in any step: phase 3 adds accounts around the simulation, it does not alter the simulation. Each step gets a "what it turned out to need" note here, and a read-only review (`claude-alt`) of the security-sensitive ones (1, 2, 3, 4, 7).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Passwords and sessions are the first security-critical code in the project | argon2id; opaque hashed sessions; constant-time checks; lockouts; nothing sensitive in logs or responses; tests for each failure; a dedicated review before the phase is called done |
| `isStaff` is used in about 20 places with three different meanings | Step 0 does only this, with the recordings as the safety net, before any account exists |
| A player's person is also saved world state: a bug could lose an owner link or someone's look | The save is versioned and validated; a test restores every combination (claimed offline, claimed after a restart, released, account deleted) |
| Plain input-then-wait movement feels laggy | Accepted for this phase and said so; phase 4 is prediction |
| `@node-rs/argon2` fails in the Alpine image | Proved first (step 1) before anything depends on it; the fallback is the `argon2` package with the build tools in the build stage only |
| A dropped connection makes the character wander off | The 30 s grace with an immediate resume |
| Two tabs of one account | A second login kicks the first (tested at the socket) |
| Registration open to anyone on the network | Optional sign-up code, and a new account has no power until an admin gives it a desk |

## 7. Not in phase 3

Chat and emotes, interactions other than sitting (using the piano, throwing), moving furniture, prediction and reconciliation, voice, and HTTPS. The protocol and the person model are shaped so none of these needs rework.

## 8. What each step turned out to need

### Step 0

1. **Ids are "the lowest id nobody is using"** (`allocatePersonId` in `sim/state.ts`), for staff and guests alike, instead of the planned monotonic counter plus a high range for guests. A counter would climb forever as an admin adds and removes slots and eventually hit the protocol's 16-bit limit; a fixed guest range would have to be sized. Lowest-free keeps ids as small as the biggest crowd has been, can never give two living people the same id (a test churns 400 random joins, leaves and slot changes and checks every time), and a person keeps their id for as long as they exist. The client already drops a person on `leave`, so reuse is safe.
2. **Three predicates replace `isStaff`:** `isAi` (steps them, picks them for meetings, sends them home at night), `hasSlot` (counts in the ledger, the slot number, the fingerprint and the save), `isDriven` (a human drives them). Every one of the 40-odd uses was looked at: the day reset and meetings use `isAi`; the ledger, the slider, `/api/world`, the admin settings and the save use `hasSlot`; the broadcaster sends driven people every tick. On the page, clicking, random follow and the pose of "you" use `isLocalPlayer` (is it the person *this* page controls?) instead, because once other humans are drawn, "driven" no longer means "me".
3. **`removeStaff` and `setStaffCount` never remove a person who belongs to an account** (or one a human is driving); the count may stop above the target.
4. **Save version 2** carries each person's `owner` (account id or null). Version 1 saves still load, as a world with no owners; this was exercised for real, because the Docker stack's database held a version 1 save from before. A person who was online when the server stopped is saved as autopilot (nobody is online after a restart); guests are not saved. Unknown versions and owners that are not whole account ids are refused.
5. **Tests:** 15 new (`sim/identity.test.ts`) covering ids, the three questions, slot removal rules, the day reset, meetings, and the save in every combination, plus one in the broadcaster. The offline recordings, the mutation check, the database tests, the Docker smoke test, the browser runner against the Docker site and `npm run e2e` all pass unchanged.
