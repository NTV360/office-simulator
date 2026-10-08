# Phase 1 breakdown: making the simulation shareable

**Status: approved. All of steps 0 to 9 are done. Phase 1 is complete.** This turns phase 1 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) into small, ordered, individually testable steps.

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

### What step 0 turned out to need

Building the safety net taught three things, now part of how the project works:

1. **Two random streams, not one.** The first recording failed its own repeatability check: two runs of the same seed differed even at step 0. The cause was visual code (desk clutter, the fighting-game animation, camera choices) drawing from the same stream as the simulation, sometimes conditionally on an unseeded `Math.random`, so the number of simulation draws shifted from run to run. Now there is a **simulation stream** (`random`, `rnd`, `pick`, `shuffle`: seeded under `?seed=N`) and a **visual stream** (`vrandom`, `vrnd`, `vpick`: always `Math.random`). Visual code must never use the simulation stream.
2. **The draw count is part of the fingerprint.** Every simulation draw is counted (`rngDraws`), so an added, dropped or reordered draw is caught even before it changes an outcome.
3. **Ten seeds, because three were not enough.** A deliberate 1% change to one rarely-hit probability slipped past three seeds, and was caught by the ten-seed check (two of ten seeds diverged by the end of the day, with a different draw count). The quick check uses seeds 1 to 3; `npm run verify:browser:thorough` uses all ten and should be run at the end of every step. A bigger change (30% to 60%) is caught by the quick check at step 3,000 with a readable diff.

**What it does not catch.** A change that never alters an outcome in ten seeds at those five points in the day (for example a tweak to a branch that is almost never reached) can pass. Code review and, from step 8 on, unit tests in Node cover that.

### What step 2 turned out to need

1. **A play-through, not just recordings.** The recordings only exercise the simulation. A `Vec3` that lacked one method would only fail where a person actually does something. My code search for Three.js-only vector methods covered the simulation folders but not `world/`, and missed a chained `p.pos.clone().add(...)` in the darts animation. It crashed the render loop every frame. Nothing in the recordings would have noticed; the new **interaction scenario** in the runner did, immediately (11 failed checks, one clear error). The scenario now plays through: every jump-to button, selecting and following someone, walking as the player, sitting and standing, switching to third person and swapping shoulders, leaving with Escape, the staff slider, and Hazel's find and rage buttons, and fails on any console error.
2. **Keep `Vec3` minimal.** The simulation only calls `clone`, `copy` and `distanceTo` on positions, so that is all `Vec3` has. Drawing code that needs more (the dart-throwing hand position) uses a Three.js vector itself, which is where rendering math belongs.
3. **The camera eases.** A scripted check that asserts where the eased camera *is* after a fixed delay depends on the browser's frame rate. Assert the camera's *goal* instead, which is set exactly every frame.

### What step 5 turned out to need

1. **Record the new fingerprint fields on the old code first.** The fingerprint gained `shown`, `ring` and `props`. They were first read from the meshes and the recordings re-recorded, and only then was the code changed to read them from state, so the same recordings prove the change.
2. **A mesh-versus-state check.** The recordings only see state. The runner now also waits two frames at every checkpoint and requires every body and prop mesh to match the person's flags (a deliberate break of the sync was caught at once).
3. **The player's body visibility stays with the camera.** First person hides your own head and third person hides the body when the camera is close; that is presentation, not simulation, so `people/sync.js` applies only the props for the player.
4. **The shared `Person` type is deferred.** Only the two new fields (`shown`, `props`) were added now; the full type arrives with the simulation move in step 8, when every field has a home.

### What step 6 turned out to need

1. **A person picks a screen number, not a material.** `screenVariant` replaces `screenMat`. The draw is the same single random call (`floor(random() * count)`), so the recordings are unchanged. `SCREEN_VARIANTS` in the shared package is the one list of how many pictures each kind has; the client builds exactly that many.
2. **The mesh check needs its own statement of the rule.** The first version of the screen check compared the meshes to the same function that set them, which proves nothing. It now states the old rule independently (nobody or away is off, present but not working is the lock screen, working is the person's picture), and a deliberate break was caught.
3. **Seeded runs do not update screens by themselves.** The paused simulation skips the per-step screen update, so the check runs the update first.
4. **`seat` became `slot` as a rename only.** The field now means the desk spot; the owner and later the station hang off it. Removing a person no longer blanks the screen itself; the next screen update does.

### What step 7 turned out to need

1. **The new test paid for itself at once.** "The staff do not change when a player is present" replays seed 1 with the player standing in the office and requires the same recorded fingerprints at every checkpoint. The first run failed at the end of the day: the new-day reset looped over everyone and sent the player home. Every loop that means "staff" (the reset, meetings, chat partners, the ledger, the slider, random follow, click picking) now filters with `isStaff`; the loops over everyone (stepping, posing) skip controlled people where they must.
2. **A controlled person has its own state.** `state: 'controlled'` replaces the old `'player'`; the checks use the controller, not the state.
3. **What is deliberately not done yet.** The `player` object in `player/player.js` still holds the local control state (sitting, moving, spec). Per-account control state arrives with the server (phase 3). A guest has no slot; claiming one is phase 4.

### What step 8 turned out to need

1. **Done in two moves.** First the registry, `mkSpot` and `ENTRY` (step 8a, own commit), then the rest of the simulation (8b). Both passed the recordings exactly on the first run.
2. **Where the client touches the simulation now.** `people/views.js` (bodies, from `personAdded`/`personRemoved` events), `people/sync.js` (poses, visibility, props), `people/screens.js` (monitors), and the main loop, which calls `stepSim(dt)`. Hazel's rage keeps its client effect and writes `rageK` on her person; the step only reads it.
3. **The exit door is looked up, not imported.** `exitSpot()` finds the registered `'exit'` spot, so the simulation does not need the world module. If no door is registered, a person who should leave just becomes absent.
4. **`resetSim()`** puts the clock, log, people, meetings and the name counter back to a fresh state, for step 9's Node tests. Spots are cleared with `interactables.clear()`.
5. **Spots carry their own ids.** `mkSpot` gives each spot `kind:n`, which the screen registry and the fingerprint use.

### What step 9 turned out to need

1. **A test office.** `buildTestLayout({ desks })` (`packages/shared/src/sim/testing.ts`) resets the simulation and registers one of everything the simulation looks for on open floor, so the real code runs with no browser and no client. The built CommonJS package (what the server will import) runs a seeded day in Node.
2. **What the scenario tests cover.** A seeded day: 40 staff with their own desks, everyone in and busy by early afternoon, nobody on someone else's desk, meetings start with at least two people and end, nobody stands still while walking, props follow the task, screens show the right picture, the day rolls over (everyone away and rescheduled), Hazel leaves last, the same seed gives the same day and a different seed a different one, freeing and reusing a desk, and a human-controlled person is left alone.
3. **They were mutation-tested.** Seven deliberate breaks (a desk not freed, meetings never ending, walkers frozen, a task end hook skipped, the human-controlled guard removed, and others) each made at least one test fail. One break (stepping the human-controlled person) was first missed and the test was strengthened.
4. **A helper trap.** When a loop waits for a time of day, remember the clock jumps back to the morning at 19:10; wait for the day number to change instead. The first version of the roll-over test looped forever.

**How to use it:**

```
npm run verify:browser            quick: seeds 1 to 3, every camera view, the interaction scenario, default-mode checks (about 50 s)
npm run verify:browser:thorough   all ten seeds (about 70 s). Run at the end of each step
npm run verify:browser:record     re-record the golden files. Only when a change is MEANT to alter behaviour
```

It builds the client, serves it, drives headless Chromium, and saves a screenshot of each camera view to `tests/browser/out/` (not committed). The golden recordings are `tests/browser/golden/seed-*.json`. A failure prints the first few differences, for example `persons.7.task: expected "coffee", got "chat"`. Without `?seed`, the game is unchanged: the runner proves it runs live and differs on every load.

## 4. The steps

| # | Step | What moves or changes | How it is tested | Size |
|---|---|---|---|---|
| **0** | Safety net (**done**) | Seeded random, fingerprint, golden recordings, browser runner (section 3) | The runner passes on today's code | M |
| **1** | Shared wiring and utilities (**done**) | The client can import `@office/shared` (a Vite alias to the shared source, so edits show live). `core/util.js` becomes `shared/src/util.ts`: `rnd`, `pick`, `shuffle`, `angDiff`, `TAU`, the seedable random source | Unit tests: a seeded generator repeats; `shuffle` returns a permutation; `angDiff` wraps. Golden master unchanged | S |
| **2** | `Vec3` and the floor plan (**done**) | A small `Vec3` class (`x`, `y`, `z`, `add`, `set`, `copy`, `clone`, `distanceTo`, `multiplyScalar`). `config/plan.js` becomes `shared/src/plan.ts`; `W()` returns a `Vec3`. The two Three.js uses in the sim (the chat spot, the people group) are handled | Unit tests for `Vec3` and for `W`/`toPx` round trips; `W(223.5, 420)` equals today's `ENTRY` to the last digit. Check that no client code calls a Three.js-only method on a `W()` result. Golden master and nav cell count unchanged | S to M |
| **3** | Character and people data (**done**) | `character/spec.js` becomes `shared/src/character/spec.ts`. `people/data.js` (names, roles, activity categories) moves to `shared` | Unit tests: `normalizeSpec` round trip and bad input; `randomSpec` is repeatable with a seed; every option in `PARTS` is a valid colour | S |
| **4** (**done**) | Navigation and movement | `nav/astar.js`, `nav/grid.js` and `player/locomotion.js` move to `shared`. The grid is built from obstacle data passed in (`initGrid(outline, obstacles)`) instead of importing the client's list | Unit tests on tiny layouts: a path goes around a wall; no path when sealed in; diagonal costs; `stepPlayer` slides along walls and stops at them. In the browser, the walkable-cell count stays 11,643 and the golden master is unchanged | M |
| **5** (**done**) | Props and visibility become state | A `Person` type in `shared`. Held items become flags (`p.props.mug`, `.phone`, `.pad`, `.guitar`, `.putter`) set by activities. `sim/day.js`, `sim/tasks.js`, `player/seating.js` and Hazel stop touching meshes. `people/sync.js` applies the flags and shows or hides each body from the person's state | Golden master (the fingerprint now includes the flags). Browser check: mugs, phones, the guitar and the putter still appear and disappear | M |
| **6** (**done**) | Slots and screens | `p.seat` becomes `p.slot` (the desk spot, the owner, later the station). The sim no longer touches monitor materials: spots get ids, and a client-side registry maps a spot id to its screen mesh; `updateScreens` and `screenMat` move to the client | Golden master. Browser check: screens show code, design, dashboards, the lock screen and "off" as before | M |
| **7** (**done**) | The player becomes a person | One person model with `controller: ai or account`. The separate player entity (`player/player.js`) goes; the controlled person lives in the same list, with no slot when playing as a guest. `animation.js` keys off the controller. The ledger still counts only staff | Golden master (with no player spawned, nothing differs). A new browser test: enter first and third person, walk, sit, stand, exit; the staff's fingerprint does not change | M to L |
| **8** (**done**) | Move the simulation | `sim/state.js` (minus the Three.js group), `meetings`, `day`, `step`, `tasks`, `factory` (minus building a body), and Hazel's identity and schedule move to `shared`. `world/interactables.js` and `mkSpot` move too (pure data); `ENTRY` and `EXIT` become plan constants. A client `people/views.js` creates and removes each person's body from the person list. `removePerson` becomes an event the client listens to (it replaces the call into the UI) | Golden master, exactly. The client now contains no simulation logic | L |
| **9** (**done**) | Simulate in Node | Unit and scenario tests on a small test layout that run the real simulation without a browser | A seeded day: everyone arrives and sits; meetings start and end; nobody is stuck; the day rolls over; the same seed gives the same result twice; claiming and releasing a slot works | M |

**Why this order.** Steps 0 to 4 move the parts that are already nearly pure and are the easiest to prove. Steps 5 to 7 remove the real couplings while the code is still in the client, where the golden master and the browser both check it. Step 8 is then a mostly mechanical move, and step 9 is the payoff: the simulation running under tests in Node.

## 5. Decisions I need

1. **Playwright as a development dependency** (about 120 MB headless browser download) for the browser runner. **Decided: yes.** It is installed.
2. **Convert moved code to TypeScript as it moves** (with real types for `Person`, `Spot`, `Task`). **Decided: convert as it moves.**
3. **Keep the simulation's state as module-level singletons** (as today, with a `reset()` for tests). **Decided: singletons plus `reset()`.**
4. **Review points:** after steps 0, 4, 7 and 9. **Decided.** Step 0 is the first.

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
