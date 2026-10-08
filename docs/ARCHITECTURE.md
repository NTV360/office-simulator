# Architecture

Office Floor Sim is a Three.js simulation of an office floor: NPCs follow daily schedules, and the user can orbit the floor or walk around as their own character (first or third person). It is a browser app built with Vite and plain ES modules, with no UI framework.

- **Entry:** `index.html` (markup only) loads `apps/client/src/main.js`.
- **Assembly:** `apps/client/src/bootstrap.js` builds the world and wires everything up.
- **Loop:** `apps/client/src/main.js` runs the per-frame loop.

## Repository layout

An npm-workspaces monorepo (see [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#9-repository-layout)).

| Path | What it is |
|---|---|
| `apps/client/` | The browser app: Vite, JavaScript, Three.js. Everything below in "Folder map" lives in `apps/client/src/` |
| `apps/server/` | The NestJS server (TypeScript). Today it only serves a health check; accounts and the game come in later phases |
| `packages/shared/` | TypeScript code used by both the client and the server (`@office/shared`). No DOM, no Three.js. Today: `sim/props.ts` (the five held props as flags), `character/spec.ts` and `sim/data.ts` (the look of a person, names, roles, activity categories), `nav/` (walkable grid and A*), `sim/locomotion.ts` (`stepPlayer`, walking with collision), `plan.ts` (the floor-plan data, the plan-to-metre conversion `W`/`wx`/`wz`/`toPx`, wall heights), `vec3.ts` (`Vec3`, the simulation's point type), `util.ts` (the seedable simulation random stream, the visual stream, `angDiff`, `TAU`) and the server defaults. The client imports it from source through a Vite alias |
| `docker/`, `docker-compose.yml` | The local stack: web (Caddy and the built client), server, database. See [LOCAL-DOCKER.md](LOCAL-DOCKER.md) |
| `scripts/` | Helper scripts, such as the stack smoke test |

## Layers and dependency rules

Code is grouped by what it is. Dependencies point **downwards** in this list. A layer may import from layers below it, not above.

```
        ui/   camera/   fp/                     ← input and presentation
          \      |      /
        player/   people/   sim/                ← who is doing what
              \     |     /
       character/   world/                     ← the things in the world
              \     |     /
          render/   shared/                  ← infrastructure and data
```

In practice:

- `packages/shared` (imported as `@office/shared`; it holds the floor plan, `Vec3` and the utilities) imports nothing from either app.
- `render/renderer.js` and `materials.js` are the base that everything that draws imports from.
- `world/` builds static geometry and registers things people can use. It never imports from `sim/`, `ui/`, `people/`, `player/`, `camera/` or `fp/`. (This one holds today; keep it that way.)
- Navigation (the walkable grid and A*) lives in `packages/shared/src/nav/`. It takes the obstacle list as an argument (`initGrid(OBS)`), so it does not import `world/`.
- `sim/` decides what people do. It reads `world/` (interactables) and the shared navigation (paths) and writes to people objects. It does not import `ui/`, `camera/`, `player/` or `fp/`. (Also holds today.)
- `ui/`, `camera/`, `fp/` and `player/` are the input and presentation side. They read the sim and may call into it.

**Known exceptions.** These exist today. They are debt, not precedent. Do not add more; if you need to, ask.

| Where | Goes "up" to | Why it exists |
|---|---|---|
| `render/labels.js` | `world/furniture/desks.js` | labels each desk island |
| `render/lighting.js` | `sim/state.js` | light follows the sim clock |
| `character/rig.js` | `@office/shared` (`sim/data.ts`) | the activity-ring colours come from `CATS` |
| `people/factory.js` | `ui/person.js` | deselects a removed person |
| `people/animation.js` | `player/player.js` | the player's pose depends on sitting/moving |
| `people/hazel.js` | `camera/`, `player/`, `ui/` | Hazel's HUD buttons, camera follow and rage effects live in one feature module |

Some function-level cycles also exist (for example `camera/controller.js` and `player/control.js` call each other). They are fine as long as no module **reads another module's value at import time** (see [CODING-STANDARDS.md](CODING-STANDARDS.md#2-no-work-at-import-time)).

## Folder map (`apps/client/src/`)

| Folder | What lives there |
|---|---|
| `render/` | `renderer.js` (renderer, scene, camera, sun), `materials.js` (the `M` palette and `canvasTex`), `screens.js` (monitor/TV textures), `labels.js`, `lighting.js` (day/night) |
| `world/helpers.js` | Geometry helpers (`box`, `cyl`, `frame`), the obstacle list `OBS`, the wall list `SOLIDS`, the shared `wall` height state |
| `world/floor.js`, `walls.js`, `doors.js`, `entrance.js`, `bake.js` | The building shell, and `bake` which merges static meshes into few draw calls |
| `world/furniture/*.js` | One file per area: desks, conference rooms, lounge, game console, bar, booths, dining, golf, darts, server rack, music corner, kitchen, storage, plants. `basics.js` has `mkSpot` and shared chairs |
| `world/interactables.js` | **Registry of everything a person can walk to and use** (desks, seats, counters, games). Look up by kind: `interactables.of('desk')` |
| `character/` | `spec.js` CharacterSpec (plain data, no Three.js), `rig.js` the shared body rig, `parts.js` hair and face parts, `props.js` held props, `gfx.js` cached materials/geometry |
| `people/` | NPC side: `data.js` (names, roles, activity categories), `factory.js` (create/remove people), `animation.js` (poses), `sync.js` (put meshes where the sim says), `hazel.js` (the special character) |
| `sim/` | `state.js` (`sim`, `people`, log), `tasks.js` (what people do next), `meetings.js`, `day.js` (day cycle), `step.js` (per-frame movement) |
| `player/` | The player's character: `player.js` (the entity), `control.js` (look angles, keys, touch stick), `seating.js`, `prompts.js` |
| `camera/` | `controller.js` (switches modes), `modes/` (one file per view), `state.js` (orbit state), `orbit.js` + `input.js` (pointer/keyboard), `collide.js` (wall collision), `spots.js` (jump-to, picking) |
| `fp/` | The first-person camera (eye height, head bob) |
| `ui/` | HUD controls, the headcount ledger, the selected-person card |
| `styles/` | CSS split by UI area, imported in order by `main.js` |
| `assets/` | Static files imported by code (the logo) |

## How the app starts

1. **Import.** `main.js` imports CSS and modules. Importing does nothing except define functions and constants. This is a hard rule.
2. **`bootstrap()`** (`apps/client/src/bootstrap.js`) then calls each module's `build*()` / `init*()` in a fixed order:
   1. **World:** floor, walls, doors, then furniture. Furniture creates meshes, adds obstacles (`addObs`), and registers interactables (`mkSpot`). Then `buildBake()` merges the static meshes.
   2. **`initLabels()`**, then **`initGrid()`**, which reads the obstacles to build the navigation grid. It must come after all furniture.
   3. **Simulation:** `initState()`, `initDay()` (creates the 40 starting staff and a live mid-morning), `initHazel()`.
   4. **Input and UI:** `initCamera()` (registers camera modes), then input, person card, ledger, controls, and player control.
3. **`main.js` finishes startup:** sets the initial camera, builds the labels once fonts are ready, hides the loading veil, and starts the loop.

The order in `bootstrap.js` is the only place order matters. Each entry has a reason (listed above). If you add a build function, put it where its dependencies already exist.

## The frame loop (`main.js` `tick`)

Each frame, in this order:

1. If not paused: advance the sim clock, start meetings, roll the day over at 19:10, step every NPC (`stepPerson`), update desk screens and the day/night light.
2. Pose and place every NPC's body, and the player's (`syncBody`).
3. Selection ring, label visibility, and the wall-height easing (`wall.h` eases toward `wall.goal`).
4. `updateRage` (Hazel), then input and camera (`keyCam`, `updateCamera`, which runs the active camera mode), camera shake, then the animated props (golf, darts, music).
5. Swap the lounge TV to the fighting game when someone is playing, render, and refresh the HUD about four times a second.

## State: who owns what

State is held in a few exported plain objects. **Mutate their properties; never reassign an imported variable** (ES modules forbid it, and it hides who changes what).

| State | Owner | Notes |
|---|---|---|
| `sim` | `sim/state.js` | `{ t, day, speed, paused, lastMinute }`. `t` is minutes since midnight |
| `people` | `sim/state.js` | The NPC list. The player is **not** in it |
| `logState`, `log` | `sim/state.js` | Event log shown in the ledger; set `logState.dirty` to redraw |
| `player` | `player/player.js` | `{ person, spec, sitting, moving }`. `person` is null until first needed |
| `ctl` | `player/control.js` | While the user steers the player: `active`, `mode` (`'fp'`/`'tp'`), look `yaw`/`pitch`, touch stick, key/wheel hooks |
| `camState`, `camGoal` | `camera/state.js` | Orbit camera: smoothed result and where input wants it |
| `wall` | `world/helpers.js` | `{ h, goal }` wall height and its target |
| `labelState` | `render/labels.js` | `{ on }` |
| `interactables` | `world/interactables.js` | The registry of usable spots |
| `OBS`, `SOLIDS` | `world/helpers.js` | Obstacle rects (nav) and wall rects (camera collision), in plan pixels |
| `RAGE` | `people/hazel.js` | Hazel's rage-mode state |

## Coordinates

- **Plan pixels** are the units of the floor-plan data (`packages/shared/src/plan.ts`). Furniture and walls are positioned in plan pixels.
- **Metres** are world units in Three.js. Convert with `W(px, py)` (→ a `Vec3`, which Three.js accepts wherever it reads `x`, `y`, `z`), `wx(px)`, `wz(py)`, and back with `toPx(v)`. 1 plan pixel is 0.041 m.
- **Facing:** angles use `sin`/`cos` so that `forward = (sin a, cos a)` in (x, z). The constants `E`, `WST`, `N`, `SO` (east, west, north, south) in `world/furniture/basics.js` name the four directions.

## People, characters and the player

A character is three separate things:

- **`CharacterSpec`** (`packages/shared/src/character/spec.ts`): plain JSON describing the look (colours, hair style, glasses, jacket, scale, and so on). `randomSpec(role)` makes an NPC's, `normalizeSpec(raw)` repairs any spec from a save file or form, and `PARTS` lists the options a character creator can offer. It has no Three.js in it.
- **The rig** (`character/rig.js`): `buildBody(spec)` turns a spec into meshes and returns the joints and props that animation drives, plus `sockets` (head, torso, hands) for future items. Hair and face parts live in `parts.js`; held props in `props.js`.
- **The person object**: position, task, state and so on. NPCs are made by `people/factory.js`; the player is made by `player/player.js`. Both use the same rig and the same `people/animation.js` poses.

**The player** (`player/`) is a separate entity, not an NPC. It has no desk (slot) or schedule and is never picked by the sim. It appears at the entrance the first time first or third person is used, then stays where you left it. `setPlayerSpec(raw)` rebuilds its look live.

**Hazel** (`people/hazel.js`) is the one hand-written NPC: the first person created gets her look and name, she always leaves last, and the HUD can find her or make her angry.

## Interactables and activities

Anything a person can use is a **spot** created with `mkSpot(kind, x, y, face, options)`. It registers itself in `world/interactables.js` under its `kind` (and under `options.group` if given). Spots have `pos`, `approach`, `face`, `occupant`, and so on.

An **activity** is a function in `sim/tasks.js` (for example `dartsBreak`) that finds a free spot, calls `goDo(person, task)`, and is offered by `chooseNext`. The `task.anim` name selects a pose in `people/animation.js`, and `statusText` in `ui/person.js` words it for the HUD. See [HOW-TO.md](HOW-TO.md#add-an-interactable-and-an-activity).

## Camera

`camera/controller.js` holds a set of **modes** `{ id, enter, update, exit }` and switches between them with `setView(id)`: `angle`, `top`, `follow`, `free`, `fp`, `third`. The HUD buttons carry `data-view="<id>"` and the controller keeps their pressed state in sync. Manual input (drag, wheel, jump-to) drops you into `free`. First and third person share the player's controls (`player/control.js`); they differ only in where the camera goes.

The third-person camera runs an "arm" from the head to the wanted camera spot and shortens it using `camera/collide.js`, which tests the arm against the walls actually built (`SOLIDS`), at their current height.

## Debug hook

`window.__sim` exposes live state and a few functions (the sim, people, player, `ctl`, `interactables`, `wall`, the camera controller, `advance(n)` to step the sim without rendering, and more). It exists so the app can be driven from the browser console and from scripted checks. It also has `fingerprint()`, a stable summary of the whole simulation. Opening the app with `?seed=N` seeds the simulation stream and stops the live loop from advancing it, so `advance(n)` steps it repeatably; `tests/browser/verify.mjs` uses this to prove refactors change nothing. Treat it as **development only**.

## Known limits

- The simulation still imports Three.js: a person carries its meshes and some activities toggle props. You cannot run the sim without a browser yet.
- The third-person camera collides with walls only, not furniture.
- Automated tests exist only for `packages/shared` and `apps/server` (`npm test`). The browser app has none yet and is verified by a manual checklist; there is no linting yet.
- The production build is a single ~600 KB chunk.
