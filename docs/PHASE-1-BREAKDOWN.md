# Phase 1 breakdown: making the simulation shareable

**Status: proposal, for approval. No phase 1 code has been written.** This turns phase 1 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) into small, ordered, individually testable steps.

**The goal.** Today the simulation (people, tasks, meetings, the day cycle, pathfinding, movement) lives in the browser app, mixed with drawing code. For the server to run the same simulation, it has to move into `packages/shared` and stop depending on Three.js, the DOM and `Math.random`. **The game must look and behave exactly the same after every step.**

## 1. What the code actually looks like

I measured it, file by file (`sim/`, `people/`, `player/`, `nav/`, `config/`, `core/`, `character/`). The simulation is in **better shape than expected**: most of it is already free of rendering code. The real couplings are few and specific.

| Coupling | Where | How big |
|---|---|---|
| **Held props and visibility on the mesh**: `p.body.mug.visible`, `.phone`, `.pad`, `.guitar`, `.putter` | `sim/tasks.js`, `sim/day.js`, `player/seating.js`, `people/hazel.js` | 5 props, about 32 writes in total |
| **Body and ring visibility**: `p.body.root.visible`, `p.body.ring.visible` | `sim/day.js`, `people/factory.js`, `player/*` | about 12 writes |
| **Three.js objects created by the sim** | `sim/state.js` (a `THREE.Group` for the people), `sim/tasks.js` line 80 (a `Vector3` for a chat spot) | 2 places |
| **Vector methods used on positions** | across `sim/`, `people/`, `player/`, `nav/` | `add` 7, `set` 6, `copy` 6, `clone` 3, `distanceTo` 2, `multiplyScalar` 1: a tiny class covers all of it |
| **Monitor screens**: the sim picks a Three.js material | `sim/step.js` (`updateScreens`), `people/factory.js` (`screenMat`, `spot.screen`) | 3 places |
| **Randomness**: `Math.random` | `sim/tasks.js` 11, `sim/meetings.js` 3, `sim/day.js` 1, `people/factory.js` 2, `people/hazel.js` 2, `character/spec.js` 4, `core/util.js` 3. One `performance.now` in `people/hazel.js` | about 26 places |
| **Calls up into the UI and camera** | `people/factory.js` (`select`), `people/hazel.js` (camera, HUD), `player/control.js` (22 DOM uses) | the player and Hazel files are client code by nature |
| **Already clean** | `nav/astar.js`, `nav/grid.js` (apart from importing the obstacle list), `sim/step.js` (apart from screens), `people/data.js`, `character/spec.js`, `player/locomotion.js`, `core/util.js` | |

## 2. Ground rules for the phase

1. **Behaviour must not change.** Every step is a refactor. If something looks different, it is a bug in the step.
2. **One step at a time.** Each step is a few small commits that leave the app building and working. No step starts until the previous one passes its checks.
3. **A mechanical safety net comes first** (section 3), so "nothing changed" is proven by a computer, not just by looking.
4. **Check-ins.** You review after steps 0, 4, 7 and 9 (more often if you like).
5. All the usual rules apply: short commits, no AI co-author lines, nothing pushed without your say-so, docs updated as files move.

## 3. Step 0: the safety net (before any refactor)

Without this, a behaviour-preserving refactor of random, time-driven code can only be checked by eye. The idea is a **golden master**: record exactly what the simulation does under a fixed random seed, then require every later step to reproduce it exactly.

- **A seeded random source.** All simulation randomness goes through one `random()` function that defaults to `Math.random`. With no setting, the game behaves exactly as today. With `?seed=N` in the address (a development switch), it becomes a seeded generator, so the same seed produces the same office day. Visual-only randomness (curly hair, desk clutter) stays on `Math.random` and does not touch the simulation's number stream. **The order of the simulation's random calls must stay the same** in every later step; that is what makes the recording valid.
- **A fingerprint.** A debug function (`__sim.fingerprint()`) returns a stable summary of the whole simulation: the clock, every person's name, state, task kind, position and facing (rounded), who occupies each spot, the event log, the nav grid's walkable cells, and the seat counts.
- **The recording.** For seeds 1, 2 and 3, step the simulation to several points in the day (0, 600, 3,000, 12,000 and 36,000 steps) and store the fingerprints as files in the repo.
- **The runner.** A browser script (`npm run verify:browser`) that loads the page in a headless browser, checks the console is clean, sets the seed, computes the fingerprints and compares them with the recording. It also takes a screenshot of each camera view so a human can glance at them. This needs **Playwright** as a development dependency (it downloads a headless Chromium, about 170 MB). It also gives us an automated browser check that does not depend on my browser tools, which is the "browser smoke" test the plan calls for.

**Done when:** the recording exists for three seeds, and running the runner against today's code passes. From then on, **every step must keep it passing.**

## 4. The steps

| # | Step | What moves or changes | How it is tested | Size |
|---|---|---|---|---|
| **0** | Safety net | Seeded random, fingerprint, golden recordings, browser runner (section 3) | The runner passes on today's code | M |
| **1** | Shared wiring and utilities | The client can import `@office/shared` (a Vite alias to the shared source, so edits show live). `core/util.js` becomes `shared/src/util.ts`: `rnd`, `pick`, `shuffle`, `angDiff`, `TAU`, the seedable random source | Unit tests: a seeded generator repeats; `shuffle` returns a permutation; `angDiff` wraps. Golden master unchanged | S |
| **2** | `Vec3` and the floor plan | A small `Vec3` class (`x`, `y`, `z`, `add`, `set`, `copy`, `clone`, `distanceTo`, `multiplyScalar`). `config/plan.js` becomes `shared/src/plan.ts`; `W()` returns a `Vec3`. The two Three.js uses in the sim (the chat spot, the people group) are handled | Unit tests for `Vec3` and for `W`/`toPx` round trips; `W(223.5, 420)` equals today's `ENTRY` to the last digit. Check that no client code calls a Three.js-only method on a `W()` result. Golden master and nav cell count unchanged | S to M |
| **3** | Character and people data | `character/spec.js` becomes `shared/src/character/spec.ts`. `people/data.js` (names, roles, activity categories) moves to `shared` | Unit tests: `normalizeSpec` round trip and bad input; `randomSpec` is repeatable with a seed; every option in `PARTS` is a valid colour | S |
| **4** | Navigation and movement | `nav/astar.js`, `nav/grid.js` and `player/locomotion.js` move to `shared`. The grid is built from obstacle data passed in (`initGrid(outline, obstacles)`) instead of importing the client's list | Unit tests on tiny layouts: a path goes around a wall; no path when sealed in; diagonal costs; `stepPlayer` slides along walls and stops at them. In the browser, the walkable-cell count stays 11,643 and the golden master is unchanged | M |
| **5** | Props and visibility become state | A `Person` type in `shared`. Held items become flags (`p.props.mug`, `.phone`, `.pad`, `.guitar`, `.putter`) set by activities. `sim/day.js`, `sim/tasks.js`, `player/seating.js` and Hazel stop touching meshes. `people/sync.js` applies the flags and shows or hides each body from the person's state | Golden master (the fingerprint now includes the flags). Browser check: mugs, phones, the guitar and the putter still appear and disappear | M |
| **6** | Slots and screens | `p.seat` becomes `p.slot` (the desk spot, the owner, later the station). The sim no longer touches monitor materials: spots get ids, and a client-side registry maps a spot id to its screen mesh; `updateScreens` and `screenMat` move to the client | Golden master. Browser check: screens show code, design, dashboards, the lock screen and "off" as before | M |
| **7** | The player becomes a person | One person model with `controller: ai or account`. The separate player entity (`player/player.js`) goes; the controlled person lives in the same list, with no slot when playing as a guest. `animation.js` keys off the controller. The ledger still counts only staff | Golden master (with no player spawned, nothing differs). A new browser test: enter first and third person, walk, sit, stand, exit; the staff's fingerprint does not change | M to L |
| **8** | Move the simulation | `sim/state.js` (minus the Three.js group), `meetings`, `day`, `step`, `tasks`, `factory` (minus building a body), and Hazel's identity and schedule move to `shared`. `world/interactables.js` and `mkSpot` move too (pure data); `ENTRY` and `EXIT` become plan constants. A client `people/views.js` creates and removes each person's body from the person list. `removePerson` becomes an event the client listens to (it replaces the call into the UI) | Golden master, exactly. The client now contains no simulation logic | L |
| **9** | Simulate in Node | Unit and scenario tests on a small test layout that run the real simulation without a browser | A seeded day: everyone arrives and sits; meetings start and end; nobody is stuck; the day rolls over; the same seed gives the same result twice; claiming and releasing a slot works | M |

**Why this order.** Steps 0 to 4 move the parts that are already nearly pure and are the easiest to prove. Steps 5 to 7 remove the real couplings while the code is still in the client, where the golden master and the browser both check it. Step 8 is then a mostly mechanical move, and step 9 is the payoff: the simulation running under tests in Node.

## 5. Decisions I need

1. **Playwright as a development dependency** (about 170 MB browser download) for the browser runner. I recommend yes; it is the only way I can verify the browser app myself right now. [Yes]
2. **Convert moved code to TypeScript as it moves** (with real types for `Person`, `Spot`, `Task`), or move it as JavaScript and type it later? I recommend converting now: those types become the shared language for the network protocol. [Convert as it moves]
3. **Keep the simulation's state as module-level singletons** (as today, with a `reset()` for tests), or turn it into a `World` object passed everywhere? The server runs one world per process, so singletons are enough and the change is far smaller. [Singletons plus `reset()`]
4. **How often do you want to review?** I suggest after steps 0, 4, 7 and 9. [As suggested]

## 6. Risks

| Risk | Mitigation |
|---|---|
| A refactor subtly changes behaviour in random, time-driven code | The golden master: exact fingerprints under three seeds at five points in the day, after every step |
| `Vec3` is not a drop-in replacement where code passes positions to Three.js | Step 2 includes a search for Three.js-only method calls on `W()` results; most calls (`copy`, `position.set(x, y, z)`) only read `x`, `y`, `z` |
| Seeding changes the order of random draws | Step 0 touches only the source of the numbers, not the call order; a seeded run must match an unseeded run's structure; the recording is taken on today's code |
| Step 7 changes how the player and the ledger interact | The staff-only fingerprint must stay identical; a dedicated browser test covers the player flows |
| Large TypeScript conversion slows steps | Convert file by file as each moves, with loose types first and tightening later |
| Browser tooling is unavailable to me | The Playwright runner is built in step 0 so verification never depends on my browser tools |

## 7. After phase 1

The browser runs the shared simulation locally (offline mode, as today). Phase 2 then puts the same simulation in the server, adds the network protocol and the saved world, and turns the browser into a viewer. See [PARALLEL-WORK.md](PARALLEL-WORK.md) for which other tracks can run alongside.
