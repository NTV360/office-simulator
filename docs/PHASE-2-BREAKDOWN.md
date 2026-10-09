# Phase 2 breakdown: server and persistence

**Status: in progress. Steps 0 and 1 are done; steps 2 to 7 are next.** This turns phase 2 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) into small, ordered, individually testable steps. Phase 1 made the simulation run in Node; phase 2 runs it on a server and lets browsers watch.

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
| **2** | The protocol | `shared/src/protocol`: encode/decode for `welcome`, `snapshot`, `event`, `spec`, `ping/pong`, with change-only person records | Round-trip tests, size checks against the plan's budget, bad input is rejected |
| **3** | Realtime gateway | Socket.IO (websocket only) gateway: a viewer connects, gets `welcome` (full world), then `volatile` snapshots each tick and events; clean disconnect | Node integration test with `socket.io-client`: two clients receive the same tick; a slow client does not block |
| **4** | Persistence | Prisma schema and migration; the world is saved on an interval and on shutdown, and restored at boot (people, desks, schedules, positions, clock, day, settings) | Test: save, rebuild a fresh world from the database, and compare. Docker: restart the server container and the same people appear |
| **5** | Admin settings | Slot count, pause, speed changeable at runtime through `/api/admin/*`, guarded by an `ADMIN_TOKEN` from the environment (real accounts come in phase 3); changes are saved and broadcast | Tests: auth required, values clamped, change shows up in snapshots and survives a restart |
| **6** | Viewer client | An online mode: connect, apply `welcome`, interpolate snapshots, draw. The client does not step the simulation in this mode. Offline mode stays as it is | Browser runner: two pages connected to one server show the same positions and clock; the offline recordings are unchanged |
| **7** | Docker and end to end | Compose wires the server to the database and the proxy for `/socket.io`; a single script starts the stack, connects two browsers, restarts the server and checks the office came back | `npm run e2e` passes against the compose stack |

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
