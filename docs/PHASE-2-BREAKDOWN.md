# Phase 2 breakdown: server and persistence

**Status: done. All of steps 0 to 7 are done; phase 2 is complete.** This turns phase 2 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) into small, ordered, individually testable steps. Phase 1 made the simulation run in Node; phase 2 runs it on a server and lets browsers watch.

**Done when (from the plan):** two browsers see the same office, and a server restart brings back the same people, positions and clock. Players, accounts and prediction are phases 3 and 4; here every browser is a **viewer**.

## 1. What phase 2 needs that does not exist yet

| Need | Why it is a problem today | Answer |
|---|---|---|
| **The office layout on the server** | Desks, counters, seats and the obstacle list are created by the client's furniture code, which builds Three.js meshes. The server cannot run it | Dump the spots and obstacles to a data file once, load it on the server, and have a browser check that the client's own furniture still produces exactly that data (so the two cannot drift apart). Phase 5 replaces this with real furniture data |
| **A stable id for every person and spot** | Spot ids exist (`kind:n`); people have `id` | Use them in the protocol |
| **A way to save a person** | A running task holds functions (`onStart`, `onEnd`), which cannot be saved | Save identity, desk, schedule, position and whether they are in; on restore, present people resume as idle at their saved position and choose their next task. Tasks, meetings and props in hand are not saved (documented, deliberate) |
| **A wire format** | None | A small binary protocol in `shared`, with encode/decode tests |
| **A viewer client** | The client runs its own simulation | An online mode that applies what the server sends and does not step the simulation |

## 2. The steps

| # | Step | Delivers | Proof |
|---|---|---|---|
| **0** (**done**) | Layout as data | `interactables.all()` records creation order. A dump script writes `packages/shared/src/layout/office.json` (spots with all their plain fields, plus the obstacle rects). `loadLayout(data)` rebuilds the registry and the nav grid | Unit test: loading the data gives the same ids, positions and nav cell count as the client builds. Browser runner check: the client's registry equals the data file |
| **1** (**done**) | The server runs the world | A Nest `WorldService` loads the layout, builds the simulation (same seed rules), and ticks at `TICK_RATE` (20 Hz) with drift correction and a logged tick time. Settings from the environment: slot count, speed, paused. `GET /api/world` status | Server test: boot, tick N times, the people exist and the clock advances; the same seed gives the same world as the Node scenario tests |
| **2** (**done**) | The protocol | `shared/src/protocol`: encode/decode for `welcome`, `snapshot`, `event`, `spec`, `ping/pong`, with change-only person records | Round-trip tests, size checks against the plan's budget, bad input is rejected |
| **3** (**done**) | Realtime gateway | Socket.IO (websocket only) gateway: a viewer connects, gets `welcome` (full world), then `volatile` snapshots each tick and events; clean disconnect | Node integration test with `socket.io-client`: two clients receive the same tick; a slow client does not block |
| **4** (**done**) | Persistence | Prisma schema and migration; the world is saved on an interval and on shutdown, and restored at boot (people, desks, schedules, positions, clock, day, settings) | Test: save, rebuild a fresh world from the database, and compare. Docker: restart the server container and the same people appear |
| **5** (**done**) | Admin settings | Slot count, pause, speed changeable at runtime through `/api/admin/*`, guarded by an `ADMIN_TOKEN` from the environment (real accounts come in phase 3); changes are saved and broadcast | Tests: auth required, values clamped, change shows up in snapshots and survives a restart |
| **6** (**done**) | Viewer client | An online mode: connect, apply `welcome`, interpolate snapshots, draw. The client does not step the simulation in this mode. Offline mode stays as it is | Browser runner: two pages connected to one server show the same positions and clock; the offline recordings are unchanged |
| **7** (**done**) | Docker and end to end | Compose wires the server to the database and the proxy for `/socket.io`; a single script starts the stack, connects two browsers, restarts the server and checks the office came back | `npm run e2e` passes against the compose stack |

## 3. How each step is checked

Every step runs the phase 1 checks (`npm test`, `npm run typecheck`, `npm run build`, `npm run check:docs`, `npm run verify:browser:thorough`, `npm run check:mutations`) plus its own proof above. The offline recordings must never change: phase 2 adds a server and an online mode, it does not alter the simulation.

## 4. Decisions made (change them if you disagree)

1. **Restore resumes people as idle, not mid-task.** Saving closures is not possible and not worth it; after a restart a person standing at a coffee machine simply chooses what to do next.
2. **One world, one tick loop, in the server process.** No worker threads until the load test says so.
3. **Viewers only.** No accounts or input in this phase; the admin API uses a shared token from `.env`.
4. **The layout data file is generated, committed and checked.** Until phase 5 the client's furniture code stays the source of truth, and a browser check fails if the file goes stale.
5. **Seeded server runs.** `WORLD_SEED` is optional; unset, the server uses real randomness (and saves everything it needs to restore).

## 5. Risks

| Risk | Mitigation |
|---|---|
| The layout file drifts from the client furniture | The browser runner compares them on every run; `npm run layout:dump` regenerates |
| Restoring mid-meeting or mid-walk looks odd | Present people resume idle at their position; meetings end. Acceptable for v1 and written down |
| Snapshot size grows | Change-only records and the budget tests from step 2 |
| The client online mode and offline mode diverge | They share `people/sync.js`, `animation.js` and the views; only the source of the numbers differs |

## 6. What each step turned out to need

### Step 0

1. **The server-side simulation reproduces the browser recordings exactly.** `packages/shared/src/layout/golden.test.ts` loads the layout data, runs the Node simulation with seeds 1 to 3 and compares every person at every recorded checkpoint, and the number of random draws, with the browser's golden files. That is a stronger proof than "it runs": the server and the browser are the same simulation.
2. **The layout is 145 spots (70 desks, 21 conference seats, 18 dining seats and so on) and 112 obstacles**, with the nav grid at 11,643 walkable cells, as in the browser.
3. **The browser runner now shares `tests/browser/site.mjs`** with the dump script (start the site, open a page, collect errors).
4. **Spots need to be in creation order** because ids are `kind:n`. `interactables.all()` keeps that order and `loadLayout` refuses data that would produce different ids.
5. **Anything not plain data on a spot is an error** when dumping, so a future feature cannot silently leave something out of the layout file.

### Step 1

1. **`World` is a plain class** (`apps/server/src/world/world.ts`); Nest only wraps it (`WorldService`, `WorldController`). That keeps it testable without HTTP. It is a thin wrapper over the shared singletons, so there is one World per process.
2. **The tick is fixed-step and drift-corrected.** Each tick runs `stepSim(1 / TICK_RATE)`, the same 0.05 s step the browser recordings use. A late timer catches up by at most 3 ticks and then skips ahead rather than spiralling; late ticks are counted. Paused ticks still count (snapshots keep flowing).
3. **The server world is the browser world.** A test runs the server's `World` with seed 1 and compares the clock and every person to the browser recordings at all five checkpoints.
4. **Measured:** about 0.07 ms per tick for 40 staff (budget: well inside 50 ms). `GET /api/world` shows tick, clock, who is in, and tick timings; `npm run smoke` checks it.
5. **Settings** come from the environment: `TICK_RATE`, `SLOT_COUNT`, `SIM_SPEED`, `SIM_PAUSED`, `WORLD_SEED` (see `.env.example`). Changing them at runtime is step 5.

### Step 2

1. **Where it lives.** `packages/shared/src/protocol/`: `binary.ts` (writer and reader), `messages.ts` (the message types), `codec.ts` (`encode`/`decode`), `convert.ts` (simulation person to wire record, and the layout check). `PROTOCOL_VERSION` is now `WIRE_VERSION` (1) and also shows in `/api/health`.
2. **What a viewer needs from a person** turned out to be more than a position: the pose name, the task kind and category, the place (by number in the layout, or inline for a one-off chat place), the chat partner, the meeting, the props in hand, whether they have arrived and when they are due. Everything the existing views, animation and info card read is on the wire, so step 6 can rebuild ordinary people objects and reuse the client code unchanged.
3. **Static and changing parts are split.** `PersonInfo` (name, role, look, desk, screen picture) goes in the welcome and when someone joins; `PersonSnap` (about 33 bytes) goes in snapshots. A snapshot is a full list or only the people whose record changed.
4. **Sizes (measured).** A person record is about 33 bytes against the plan's rough 10, so a *full* snapshot of 40 people is 1.3 KB. Sending only changed people (step 3) is what brings the stream under the 40 KB/s budget; if 100 players plus the crowd need more, positions can be sent as fixed-point deltas later without changing anything else. The welcome for 40 people is 12 KB (mostly the look as JSON).
5. **The look is not normalised on decode.** `normalizeSpec` clamps the height to 0.9 to 1.1, which would have shrunk Hazel (0.7). The server is trusted here; players' own looks are normalised on the server in phase 3.
6. **Unknown names still travel.** A new task kind or pose not in the tables is sent as text instead of failing; a test runs two seeds through a whole day and the roll-over and requires every name the simulation produces to be in the tables, so the cheap path stays the normal one.
7. **Hostile input.** Every truncation of every message, trailing bytes, unknown types, a wrong version, lying list lengths, bad UTF-8, and 4,000 random or corrupted buffers all raise `DecodeError` and nothing else.

### Step 3

1. **Two layers.** `apps/server/src/net/broadcaster.ts` knows the simulation and the protocol and builds the bytes (welcome, snapshot, join, leave, log events); `game.gateway.ts` only moves them over Socket.IO. The broadcaster is tested on its own; the gateway is tested against the real running server with real socket clients.
2. **One event, binary payload.** Both directions use the Socket.IO event `m` carrying one protocol message. Websocket only, no compression, an 8 KB input limit. A client must send `hello` within 5 s (`HELLO_TIMEOUT_MS`) with the right version or it is told why and dropped; garbage, text, or a server-only message also gets a `kick` and a disconnect; `MAX_CLIENTS` (200) caps connections.
3. **What is sent, and how often.** A snapshot every tick (a heartbeat that carries the clock) listing only the people whose record changed; staff are due every second tick (10 Hz) and people driven by players every tick; a full keyframe once a second so a client that missed one recovers. Snapshots go out as `volatile` emits, so a client that is behind skips them instead of queueing.
4. **Measured:** about 7 KB/s per viewer for 40 staff over two simulated minutes (a snapshot averages 361 bytes), against the 40 KB/s budget. Tick time (now including building and sending the snapshot) stays around 0.2 ms.
5. **Joins and leaves.** The gateway listens to the simulation's `personAdded`/`personRemoved` events and broadcasts them, so changing the number of staff at runtime (step 5) needs no extra code. New log lines become `event` messages; history from before a viewer arrived is not replayed.
6. **A welcome does not touch change tracking**, because other viewers have not seen it (a test would catch the opposite).
7. **Nest dependency injection needs explicit tokens** (`@Inject(Service)`) because the test runner does not emit decorator metadata; all controllers and the gateway use them.
8. **Through the proxy.** `npm run smoke` now also connects through Caddy, says hello and requires the welcome and a stream of snapshots.

### Review of steps 0 to 3 (read-only second pair of eyes)

A fresh review of the first four steps found, and the follow-up commit fixed: a throwing step or listener could kill the tick loop (now caught and reported at most once a second, and stopping the world from inside a tick works); a failing message handler could crash the process (now it kicks that client); the writer silently wrapped out-of-range numbers (now it throws: ids, meeting indexes, counts, non-finite numbers); the server decoded server-only message types before rejecting them (now only hello and ping are decoded from a client); custom names had no length limit (now 64); a chat-place facing change was not detected as a change; late ticks were undercounted; and there was no per-client message limit (now 20 a second, then a kick). Each has a test.

### Step 4

1. **One JSON document, in PostgreSQL.** `world_state` holds a single row (the clock, the name counter, the desk order, and each person's identity, desk, schedule and position), replaced on every save; `world_state_rejected` keeps any save that could not be read. The saving and restoring code is in the shared package (`sim/persist.ts`: `serializeWorld`, `parseSavedWorld`, `restoreWorld`), so it is tested in Node without a database.
2. **Plain `pg` and SQL migrations instead of Prisma.** The plan named Prisma. Phase 2 has two tables and one JSON column, so a typed ORM and its generated client and engine would add weight to the Docker image for little gain. `apps/server/migrations/*.sql` are applied in order at start-up (each in a transaction, recorded in `schema_migrations`, guarded by an advisory lock so two servers cannot race). This is easy to swap for Prisma when accounts arrive in phase 3 if you prefer; say so.
3. **Restoring is not a replay.** A running task holds functions, so it is not saved: people who were in the building resume as idle where they stood and choose their next task, meetings end, props in hand are dropped, and the random stream is fresh. Restoring uses no random numbers, and a whole-day test after a restore passes, including the roll-over.
4. **Saving is conservative.** Every 10 s (`SAVE_INTERVAL_MS`) and on shutdown; one save at a time; a failed save is logged once and recorded in `/api/world` (`persistence`). If the database cannot be reached at start-up (10 tries, 2 s apart) the server runs **without saving** instead of starting fresh and later overwriting the real world. A save that cannot be parsed is moved to `world_state_rejected` and the server starts fresh; `RESET_WORLD=true` forces a fresh world on purpose.
5. **Hostile or damaged saves.** `parseSavedWorld` checks every field (types, ranges, duplicate ids and desks, desks the office does not have); 20 tests cover it.
6. **Tested against a real database.** `npm run test:db` starts a throwaway PostgreSQL in Docker and runs the migration, store and full-server tests (save on shutdown, restore on the next start, `RESET_WORLD`). Without Docker those tests skip.
7. **Checked in the real stack.** After `docker compose restart server` the log says `restored from the database`, the same 40 people are back, and the clock continued from where it stopped.

### Step 5

1. **The API.** `GET /api/admin/settings`, `PUT /api/admin/settings` with any of `{ "slots": n, "speed": x, "paused": b }`, and `POST /api/admin/announce` with `{ "text": "..." }`. All need `Authorization: Bearer <ADMIN_TOKEN>`. Without `ADMIN_TOKEN` in the environment the admin API does not exist (404).
2. **Guarding it.** The token is compared in constant time; ten failures from one address in a minute lock that address out for the rest of the minute (even with the right token); requests are validated by hand (unknown fields, wrong types, fractions, negatives and bad JSON get a 400 with the reason). `slots` is clamped to the number of desks (70), `speed` to 0.25 to 8.
3. **One way to change the number of staff.** The client's staff slider had the "add someone mid-day and they arrive in a few minutes" logic inline. It is now `setStaffCount` in the shared package, used by both the slider and the server, with tests.
4. **Effects reach everyone.** Speed and pause are in every snapshot; staff added or removed are announced as `person`/`leave` messages (the gateway already listened for the simulation's events); an announcement is a new simulation event and arrives as an `event` of kind `announce`.
5. **Saved at once.** Each change triggers a save, and a test with a real database shows slots, speed and pause surviving a restart. Checked in the Docker stack too (30 staff at 3x came back after `docker compose restart server`).
6. **Still to come with accounts (phase 3):** the shared token is replaced by admin accounts; `kick`, `assign-slot` and `reset-password` need accounts to mean anything.

### Step 6

1. **The client copy of the world is `Mirror`** (`packages/shared/src/protocol/mirror.ts`). It turns messages back into ordinary people objects (task, place, chat partner, meeting, props, times), so animation, the info card, the ledger, the camera and Hazel's buttons work unchanged. It holds its own state, so a test runs it next to a live server world in one process: through a whole working day, every few hundred ticks, every person's state, position, task, place, props, partner and meeting, and every meeting, match the server's.
2. **Online or offline is decided at build time**, not by probing: the Docker web image is built with `VITE_ONLINE=1`; anywhere else the page runs its own office as before unless the address has `?online` (same origin, for example the dev server, which now proxies `/api` and `/socket.io` to a server on port 3000) or `?online=http://host:3000`. `?offline` and `?seed=N` always mean the old way. Probing was tried first and dropped: a failed request is a console error, which would have made every offline run noisy.
3. **What the online page does each frame:** no simulation step; people are drawn 150 ms in the past, blended between the two surrounding snapshots (a jump over 2.5 m is a teleport, not a walk); the stride is computed from the movement, like the simulation does; the clock keeps running between snapshots and is corrected by each one. Desk screens and the "who is using the keyboard / darts / golf" markers are rebuilt from where everyone is.
4. **Controls that belong to the server** (staff count, run/pause, speed) are disabled and say so; they show the server's values. A small status pill shows "Online · N people · latency", "reconnecting", or why the server refused the page (a different office layout or protocol version).
5. **The wire gained what the info card needs** (when they came in, when they leave, coffees): protocol version 2.
6. **A fresh welcome replaces everything**, so a dropped connection that reconnects shows the current world with no duplicates. A keyframe repairs a missed leave. A record for someone unknown is ignored and counted.
7. **Verified in the real stack** by the browser runner: two headless browsers on the Docker site show the same 40 people, identical positions, states and tasks at every shared keyframe, agreeing clocks, drawn bodies, a working ledger and info card, locked controls, and no console errors. The offline recordings are unchanged.
8. **Local only for now:** the first or third person camera still works online, but your own character is not sent to the server, so nobody else sees it. That arrives with accounts and players (phases 3 and 4).

### Review of steps 4 to 6, and what it changed

A second read-only review found several ways a good save could be lost or a client left in a stale state. All were fixed, each with a test:

1. **A failed read at start-up was treated as "no save".** Only an unreadable save now means "start fresh"; a dropped connection or timeout is retried, and if the database never answers saving stays off (`loadForBoot` in `apps/server/src/world/persistence.ts`).
2. **A save the office cannot be rebuilt from** (for example a desk that no longer exists after a layout change) used to crash the server on every start. Now the save is left exactly as it is, the server runs a fresh world, saving is switched off with the reason in `/api/world`, and nothing is overwritten.
3. **Moving an unreadable save aside** is one transaction (it can no longer be duplicated or half done).
4. **Saves are a queue that always writes the latest state.** A shutdown or an admin change that arrives during a periodic save waits for it and then saves again, so the state at that moment is what is in the database.
5. **A world that would not read back is never written** (NaN turns into null in JSON): the save is checked first and the old one is kept.
6. **The admin lockout works behind the proxy.** `TRUST_PROXY=1` (set in compose, since Caddy is one hop) makes the address the real client's, so one bad actor cannot lock out the admin; the failure table no longer grows without bound; the token comparison no longer reveals its length.
7. **The client copy:** a person who leaves is taken out of the meetings they were in, a damaged chat place cannot break a snapshot, per-person bookkeeping is cleaned up, the follow camera lets go of someone who has left, and the ping timer stops after a fatal error.

### Step 7

1. **`npm run e2e`** (`scripts/e2e.mjs`) is the plan's "done when" as a script. It starts its **own** copy of the stack (its own compose project, port 18080 and database, so it does not touch yours), opens two browsers, and checks: a fresh server starts a new office; two browsers show the same people and identical positions, states and tasks at every shared keyframe; an admin change (30 staff at 3x) reaches both; after `docker compose restart server` the office is restored (same people, speed, clock continuing from where it stopped), the open browsers reconnect by themselves, and a new browser sees the same people; and after a hard kill (no chance to save on the way out) the office is still there and at most about one save interval of clock is lost.
2. **Compose passes every server setting** through (`TICK_RATE`, `SLOT_COUNT`, `SIM_SPEED`, `SIM_PAUSED`, `WORLD_SEED`, `ADMIN_TOKEN`, `RESET_WORLD`, `SAVE_INTERVAL_MS`, `TRUST_PROXY`); `.env.example` documents them.
3. **Everything phase 2 added is checked automatically:** unit tests (protocol, mirror, broadcaster, admin, persistence rules), `npm run test:db` (a throwaway PostgreSQL), the smoke test (page, API, world, realtime through the proxy), the browser runner against the Docker site (including two browsers on one server), and `npm run e2e`.

## 7. After phase 2

Phase 3 (accounts and takeover) builds on this directly: the `Person` already has a `controller`; the protocol has a `you` field in the welcome and a `person` message for joins; the admin token becomes admin accounts; and the saved world gains an accounts table next to `world_state`. Known loose ends carried forward:

- The player's own character is local to the browser; sending it to the server (inputs, prediction) is phase 4.
- A person's ids are their staff index; players will need ids that cannot collide with staff.
- The look travels as JSON in the welcome (about 12 KB for 40 people); a binary form is possible if the welcome ever matters.
- A full snapshot record is about 42 bytes; the measured stream is about 8.5 KB per second per viewer for 40 staff. Compact deltas are available if 100 players plus the crowd need them.
- Restore resumes people idle where they stood (documented, deliberate).
- Prisma was not adopted (plain SQL migrations); revisit with accounts.
