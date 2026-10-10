# Coding standards

These rules exist because of real failures during the restructure (a white screen from import order, a hang from a value read before it was set, edits lost to mixed line endings). Follow them in every change. If a rule is in your way, raise it instead of working around it.

## 1. Modules

- Plain ES modules, one concern per file, files named `camelCase.js` inside the folder that matches what the code is (see the folder map in [ARCHITECTURE.md](ARCHITECTURE.md#folder-map-appsclientsrc)).
- **Export with one `export { ... }` line at the bottom of the file**, names sorted. Do not scatter `export` keywords through the file. This matches every existing module.
- Import by relative path with the `.js` extension. Import only what you use.
- Respect the layer direction in [ARCHITECTURE.md](ARCHITECTURE.md#layers-and-dependency-rules). Do not add to the known exceptions.
- Do not create a new top-level folder without agreeing it first.

## 2. No work at import time

**A module may only declare things when it is imported.** Allowed at the top level: imports, `function` declarations, constants made from literals, `Math.*`, and `new Something()` with no side effects. Not allowed: calling functions that create or change anything, adding to the scene, touching the DOM, registering event listeners, pushing into shared arrays.

Anything that does work goes in an exported function named `build*()` (creates world geometry) or `init*()` (wires things up), and is called from [`apps/client/src/bootstrap.js`](../apps/client/src/bootstrap.js). Add the call where its dependencies already exist.

Why: ES modules run in import order, which is easy to break by accident. The first version of this split crashed because a module ran before the module that fills the data it needed.

**Never read another module's value at import time if that value is only assigned inside a `build*`/`init*` function.** At import time it is still `undefined`. Example of the bug we hit: array sizes computed from the nav grid's width at the top of `astar.js`, while the width was only set when `initGrid()` ran. The result was empty arrays and a frozen page. Read such values inside functions, which run later.

```js
// BAD: runs at import, GC is not set yet
const cells = new Float32Array(GC * GR);

// GOOD: size is read when the function runs
function makeCells() { return new Float32Array(GC * GR); }
```

## 3. State

- Shared state lives in a small exported **plain object** (`sim`, `wall`, `ctl`, `player`, `labelState`, ...). Change it by setting a property: `wall.goal = FULL_H`.
- **Do not reassign an imported variable** (`import { x }` then `x = 1` is an error), and do not add `setX()` functions to work around it. If a value must change and be shared, put it in a state object.
- Each piece of state has **one owner module** (table in [ARCHITECTURE.md](ARCHITECTURE.md#state-who-owns-what)). Other modules read it, and mutate it only through documented fields.
- New global state needs a reason. Prefer passing values into functions.

## 4. Naming

| Prefix | Meaning | Example |
|---|---|---|
| `build*` | creates world geometry or registers world things; called once from bootstrap | `buildKitchen` |
| `init*` | wires up listeners, UI or state; called once from bootstrap | `initControls` |
| `update*` | per-frame work, called from the loop or a camera mode | `updateGolf(now)` |
| `make*` | factory that returns a new object | `makeGuitar` |
| `*Mode` | a camera mode object | `thirdPersonMode` |

- Activity and spot **kinds** are lowercase strings: `'desk'`, `'piano'`. A kind is used in `mkSpot`, in `task.kind`, and in `statusText`; keep them identical.
- Constants that name data are `UPPER_CASE` (`WALLS`, `OUTER`); everything else is `camelCase`.
- DOM ids are `camelCase` and are looked up with `$('id')` from `ui/dom.js`.

## 5. Data versus code

- **Data** (palettes, option lists, names, floor plan, specs) lives in data modules: `packages/shared/src/plan.ts`, `packages/shared/src/character/spec.ts`, `packages/shared/src/sim/data.ts`. Keep them free of Three.js and the DOM so they can be validated and saved anywhere.
- Do not hard-code magic numbers deep inside logic when they describe the world. Put them in a data module or at the top of the file with a name.
- A character's look is a `CharacterSpec`, made from the character pack's options. New hair, clothes or accessories are added to the pack (see [HOW-TO.md](HOW-TO.md#update-the-character-pack)); `normalizeSpec` makes any input valid, so use it on anything that comes from outside (a save, the network, a pasted config).

## 6. Coordinates and angles

- Furniture and walls are positioned in **plan pixels**; convert with `W(px, py)`, `wx`, `wz`; convert back with `toPx`. Never mix pixels and metres in one expression without converting.
- Facing angles follow `forward = (sin a, cos a)` in (x, z). Use `E`, `WST`, `N`, `SO` from `world/furniture/basics.js` for the four directions.

## 7. Per-frame code

- `update*` functions run every frame: no allocating vectors, arrays or closures in them. Reuse a scratch object created at module level.
- Time comes in as `dt` (seconds, capped) or `now` (ms from the frame loop). Avoid `performance.now()` in sim logic so the sim stays steppable (`__sim.advance`). Real-time timers are for things only one page sees (an emote lasting a couple of seconds).
- **Randomness has two streams.** Code that decides what people do or look like uses the simulation stream (`random`, `rnd`, `pick`, `shuffle` from `@office/shared`); code that is only about how things are drawn uses the visual stream (`vrandom`, `vrnd`, `vpick`). Never call `Math.random` in simulation code, and never use the simulation stream in visual code: it would make seeded runs (`?seed=N`) irreproducible. The order of simulation draws is part of the behaviour.
- Easing uses `1 - Math.exp(-dt * rate)`, not a fixed fraction, so it behaves the same at any frame rate.

## 8. UI and CSS

- Markup lives in `index.html`; behaviour is bound in an `init*` function; **never** use inline `onclick` in HTML.
- CSS is split by UI area in `apps/client/src/styles/` and imported in order in `main.js`. Add a new file for a new area, and use the colour/spacing tokens in `tokens.css`.
- Anything shown while the user is steering the player must also be hidden in the `body.fp`/`body.tp` rules in `first-person.css`.

## 9. Comments

- Comment **why**, not what. A one-line comment above a non-obvious block is better than a paragraph.
- Keep the short header comment style used in existing files. Do not leave commented-out code.

## 10. Files and line endings

- All source files use **LF** line endings. `.gitattributes` enforces this; do not disable it. Mixed line endings once broke an automated edit and produced noisy diffs.
- No build output, `node_modules` or editor files in git (`.gitignore` covers them).

## 11. Git

- **Commit messages are short**: one imperative line, plus an optional short body. Example: `Add third-person camera with wall collision`.
- **Do not add AI co-author trailers** (for example `Co-Authored-By: ...`) to commits.
- Make small commits that each leave the app working. Do not mix a restructure with a feature in one commit.
- Update from `main` before pushing. If someone changed the same area, resolve it by reading both changes, not by picking a side.

## 12. Server and shared code (TypeScript)

- `packages/shared` runs in the browser **and** on the server, so it must stay free of the DOM, Three.js and Node-only APIs. Import it as `@office/shared`. It builds to both ESM (for Vite) and CommonJS (for NestJS).
- `apps/server` is a NestJS app. Keep real logic in **plain functions** (see `health.ts`) and keep controllers and providers thin: plain functions are trivial to unit-test, whereas Nest's dependency injection needs decorator metadata that the test runner does not produce.
- The game loop, when it arrives, is a plain TypeScript class, not a Nest provider on the hot path.
- Strict types, no `any`. Read environment variables in one place and pass values in.
- Sections 2 and 3 (no work at import time, state objects) apply here too.
- Unit tests live next to the code as `*.test.ts` and run with `npm test` (Vitest).

## Before you push

Which checks to run for which kind of change is in [GETTING-STARTED.md](GETTING-STARTED.md#test-before-you-ask-for-a-review); how to write something other players see is in [MULTIPLAYER-HOW-TO.md](MULTIPLAYER-HOW-TO.md). The list below is the full manual checklist.

Automated tests cover only the shared and server code so far (`npm test`). The browser app has none yet, so changes to it are checked by hand in a real browser. Do all of these:

1. `npm run build`, `npm test`, `npm run typecheck` and `npm run check:docs` all succeed (`npm run check:mutations` after changing the simulation, `npm run test:db` after changing anything that touches the database, and `VERIFY_URL=http://localhost:16769 VERIFY_ADMIN_TOKEN=local-admin-token npm run verify:browser` against the Docker stack after changing the protocol, the server or online mode).
2. `npm run dev`, open the page, **hard-reload**, and confirm the browser console has no errors. If you added or removed files, **restart the dev server** first; a stale server serves old modules and gives confusing failures.
3. The floor renders and people move. Press **Pause/Play**, change the speed, and move the **People** slider.
4. Try every view: Angle, Plan, Follow, First person, Third person (and `V` between the two). Drag, wheel and a jump-to button should drop you into free camera. `Esc` exits first/third person.
5. Select a person, press **Follow**; type a name in the search box (bottom left) and pick the match.
6. If you touched the sim, step it far from the console: `__sim.advance(3000)` a dozen times should not throw and the day should roll over. If you touched the simulation or anything it depends on, also run `npm run verify:browser` (and `npm run verify:browser:thorough` at the end of a phase 1 step): the recorded behaviour must not change unless you meant it to. See [PHASE-1-BREAKDOWN.md](PHASE-1-BREAKDOWN.md#3-step-0-the-safety-net-before-any-refactor).
7. If you touched build order, nav, or furniture: compare `__sim.GC`, `__sim.GR` and the count of `__sim.NAV` walkable cells before and after. They should only change when you meant them to.
8. `npm run build && npm start` and repeat steps 2 to 4 on the production build. The dev server can hide bundling problems.

If you changed the server, `docker/`, `docker-compose.yml` or anything the containers build: run `docker compose up --build -d` and then `npm run smoke`. It must print "all checks passed". Then also run `VERIFY_URL=http://localhost:16769 VERIFY_ADMIN_TOKEN=local-admin-token npm run verify:browser`, which replays the simulation recordings against the containerised site. See [LOCAL-DOCKER.md](LOCAL-DOCKER.md).

Tips for the browser checks:

- A browser tab that is in the background does not run animation frames, so the live loop stops. Use `__sim.advance(n)` to step the sim, and `__sim.updateCamera(dt)` to step the camera, when scripting checks.
- Real mouse events are fine, but dispatching synthetic `PointerEvent`s on the canvas also works for testing.
