# Architecture

Office Floor Sim is a Three.js simulation of an office floor: NPCs follow daily schedules, and the user can orbit the floor or walk around as their own character (first or third person). It is a browser app built with Vite and plain ES modules, with no UI framework.

- **Entry:** `index.html` (markup only) loads `src/main.js`.
- **Assembly:** `src/bootstrap.js` builds the world and wires everything up.
- **Loop:** `src/main.js` runs the per-frame loop.
- **Server:** `server/` is the BFF (backend for frontend): an Express app that serves the build and the `/api` routes, and the only code that talks to Supabase (with a server-only secret key). In development the same API runs inside the Vite dev server (`vite.config.js`), so `npm run dev` is one command. The browser reaches it only through `persistence/`.

## Layers and dependency rules

Code is grouped by what it is. Dependencies point **downwards** in this list. A layer may import from layers below it, not above.

```
        ui/   camera/   fp/                     ← input and presentation
          \      |      /
        player/   people/   sim/                ← who is doing what
              \     |     /
       character/   nav/   world/               ← the things in the world
              \     |     /
          render/   config/   core/             ← infrastructure and data
```

In practice:

- `config/` (floor-plan data) and `core/` (tiny utilities) import nothing from the app.
- `render/renderer.js` and `materials.js` are the base that everything that draws imports from.
- `world/` builds static geometry and registers things people can use. It never imports from `sim/`, `ui/`, `people/`, `player/`, `camera/` or `fp/`. (This one holds today; keep it that way.)
- `nav/` imports only `config/` and `world/`.
- `sim/` decides what people do. It reads `world/` (interactables) and `nav/` (paths) and writes to people objects. It does not import `ui/`, `camera/`, `player/` or `fp/`. (Also holds today.)
- `ui/`, `camera/`, `fp/` and `player/` are the input and presentation side. They read the sim and may call into it.

**Known exceptions.** These exist today. They are debt, not precedent. Do not add more; if you need to, ask.

| Where | Goes "up" to | Why it exists |
|---|---|---|
| `render/labels.js` | `world/furniture/desks.js` | labels each desk island |
| `render/lighting.js` | `sim/state.js` | light follows the sim clock |
| `character/rig.js` | `people/data.js` | the activity-ring colours come from `CATS` |
| `people/factory.js` | `ui/person.js` | deselects a removed person |
| `people/animation.js` | `player/player.js` | the player's pose depends on sitting/moving |

Some function-level cycles also exist (for example `camera/controller.js` and `player/control.js` call each other). They are fine as long as no module **reads another module's value at import time** (see [CODING-STANDARDS.md](CODING-STANDARDS.md#2-no-work-at-import-time)).

## Folder map (`src/`)

| Folder | What lives there |
|---|---|
| `config/plan.js` | Floor-plan data (`OUTER`, `WALLS`), plan→metre conversion (`W`, `wx`, `wz`, `toPx`), wall heights |
| `config/desks.js` | The desk islands (Desk A–H, the HR Office) and seat ids (`A3`, `HR2`); shared with the server, which validates desk choices |
| `core/util.js` | Small helpers: `rnd`, `pick`, `shuffle`, `angDiff`, `TAU` |
| `render/` | `renderer.js` (renderer, scene, camera, sun), `materials.js` (the `M` palette and `canvasTex`), `screens.js` (monitor/TV textures), `labels.js`, `lighting.js` (day/night) |
| `world/helpers.js` | Geometry helpers (`box`, `cyl`, `frame`), the obstacle list `OBS`, the wall list `SOLIDS`, the shared `wall` height state |
| `world/floor.js`, `walls.js`, `doors.js`, `entrance.js`, `bake.js` | The building shell, and `bake` which merges static meshes into few draw calls |
| `world/furniture/*.js` | One file per area: desks, conference rooms, lounge, game console, bar, booths, dining, golf, darts, server rack, music corner, kitchen, storage, plants. `basics.js` has `mkSpot` and shared chairs |
| `world/interactables.js` | **Registry of everything a person can walk to and use** (desks, seats, counters, games). Look up by kind: `interactables.of('desk')` |
| `nav/` | `grid.js` (walkable grid built from the obstacles), `astar.js` (pathfinding) |
| `character/` | `pack/` the character pack (vendored, chibi and blocky styles; do not edit), `spec.js` CharacterSpec (plain data, no Three.js), `rig.js` builds a character from the pack and exposes its joints, `parts.js` face parts the pack lacks, `props.js` held props, `gfx.js` cached materials and the per-joint draw-call merge |
| `people/` | NPC side: `data.js` (names, roles, activity categories), `factory.js` (create/remove people), `animation.js` (poses), `sync.js` (put meshes where the sim says), `hazel.js` (the special character) |
| `sim/` | `state.js` (`sim`, `people`, log), `schedule.js` (24-hour day, shifts and breaks), `tasks.js` (what people do next), `meetings.js`, `day.js` (day cycle), `step.js` (per-frame movement) |
| `player/` | The player's character: `player.js` (the entity), `control.js` (look angles, keys, touch stick), `locomotion.js` (collision), `seating.js`, `prompts.js` |
| `camera/` | `controller.js` (switches modes), `modes/` (one file per view), `state.js` (orbit state), `orbit.js` + `input.js` (pointer/keyboard), `collide.js` (wall collision), `spots.js` (jump-to, picking) |
| `fp/` | The first-person camera (eye height, head bob) |
| `ui/` | HUD controls, the headcount ledger, the selected-person card, `creator.js` the character lab |
| `styles/` | CSS split by UI area, imported in order by `main.js` |
| `persistence/` | `store.js`: the API calls (`fetchEmployees`, `saveCharacter`) and the player's look in `localStorage` |
| `assets/` | Static files imported by code (the logo) |

Outside `src/`: `server/` (the BFF: `index.js` production server, `api.js` the `/api` app, `routes/`, `supabase.js` the server-only client) and `supabase/migrations/` (SQL for the tables). Server code may import plain-data modules from `src/` (it validates specs with `character/spec.js`); `src/` never imports from `server/`.

## How the app starts

1. **Import.** `main.js` imports CSS and modules. Importing does nothing except define functions and constants. This is a hard rule.
2. **`bootstrap()`** (`src/bootstrap.js`) then calls each module's `build*()` / `init*()` in a fixed order:
   1. **World:** floor, walls, doors, then furniture. Furniture creates meshes, adds obstacles (`addObs`), and registers interactables (`mkSpot`). Then `buildBake()` merges the static meshes.
   2. **`initLabels()`**, then **`initGrid()`**, which reads the obstacles to build the navigation grid. It must come after all furniture.
   3. **Simulation:** `initPlayer()` (loads the player's saved look), `initState()`, `initDay()` (creates the staff, one per employee from the API or 40 made-up people, and a live mid-morning). `main.js` fetches the employee list before calling `bootstrap()`.
   4. **Input and UI:** `initCamera()` (registers camera modes), then input, person card, ledger, controls, player control, and the character lab (`initCreator()`).
3. **`main.js` finishes startup:** sets the initial camera, builds the labels once fonts are ready, hides the loading veil, and starts the loop.

The order in `bootstrap.js` is the only place order matters. Each entry has a reason (listed above). If you add a build function, put it where its dependencies already exist.

## The frame loop (`main.js` `tick`)

Each frame, in this order:

1. If not paused: advance the sim clock, start meetings, roll the day over at 19:10, step every NPC (`stepPerson`), update desk screens and the day/night light.
2. Pose and place every NPC's body, and the player's (`syncBody`).
3. Selection ring, label visibility, and the wall-height easing (`wall.h` eases toward `wall.goal`).
4. Input and camera (`keyCam`, `updateCamera`, which runs the active camera mode), then the animated props (golf, darts, music).
5. Swap the lounge TV to the fighting game when someone is playing, render, and refresh the HUD about four times a second.

## State: who owns what

State is held in a few exported plain objects. **Mutate their properties; never reassign an imported variable** (ES modules forbid it, and it hides who changes what).

| State | Owner | Notes |
|---|---|---|
| `sim` | `sim/state.js` | `{ t, day, speed, paused, lastMinute }`. `t` is minutes since midnight |
| `people` | `sim/state.js` | The NPC list. The player is **not** in it |
| `logState`, `log` | `sim/state.js` | Event log shown in the ledger; set `logState.dirty` to redraw |
| `player` | `player/player.js` | `{ person, spec, sitting, moving }`. `person` is null until first needed. `spec` is kept in `localStorage` (`officeSim.playerSpec`) |
| `roster` | `people/roster.js` | `{ list }`: the employees from the API (name, department, intern flag, saved look), or null when the API is unavailable |
| `creator` | `ui/creator.js` | The character lab: `open`, the `draft` spec being edited, and its preview stage |
| `ctl` | `player/control.js` | While the user steers the player: `active`, `mode` (`'fp'`/`'tp'`), look `yaw`/`pitch`, touch stick, key/wheel hooks |
| `camState`, `camGoal` | `camera/state.js` | Orbit camera: smoothed result and where input wants it |
| `wall` | `world/helpers.js` | `{ h, goal }` wall height and its target |
| `labelState` | `render/labels.js` | `{ on }` |
| `interactables` | `world/interactables.js` | The registry of usable spots |
| `OBS`, `SOLIDS` | `world/helpers.js` | Obstacle rects (nav) and wall rects (camera collision), in plan pixels |

## Coordinates

- **Plan pixels** are the units of the floor-plan data (`config/plan.js`). Furniture and walls are positioned in plan pixels.
- **Metres** are world units in Three.js. Convert with `W(px, py)` (→ `Vector3`), `wx(px)`, `wz(py)`, and back with `toPx(v)`. 1 plan pixel is 0.041 m.
- **Facing:** angles use `sin`/`cos` so that `forward = (sin a, cos a)` in (x, z). The constants `E`, `WST`, `N`, `SO` (east, west, north, south) in `world/furniture/basics.js` name the four directions.

## People, characters and the player

A character is four separate things:

- **The character pack** (`character/pack/`, vendored): generates characters from a config in two styles, **chibi** (big head, rounded) and **blocky** (voxel), with 50 presets. It is kept exactly as delivered; see [HOW-TO.md](HOW-TO.md#update-the-character-pack).
- **`CharacterSpec`** (`character/spec.js`): plain JSON describing the look. It is the pack's config (`type`, `body`, `build`, `height`, `skin`, `eyes`, `hair`, `facialHair`, `top`, `bottom`, `shoes`, `accessories`) plus our own `angry` flag. `randomSpec(role)` makes an NPC's (half from the pack's presets, half generated with office clothes, in a random style), `normalizeSpec(raw)` repairs any spec from a save file, the lab or a pasted config, and `specOptions(type)` / `presetList()` give the lab its choices. Accessories in the pack's `ride` slot (skateboards, hoverboards) are dropped. No Three.js in it.
- **The rig** (`character/rig.js`): `buildBody(spec)` has the pack build the character at office size (about 1.55 m), then merges each joint's meshes into one or two (`mergeJoints` in `gfx.js`, so 70 people stay cheap to draw) and attaches our activity props. It returns the joints that animation drives (`hips`, `spine`, `neck`, `head`, `armL`/`armR`, `legL`/`legR`), the props, `sockets` for future items, and measurements (`standHip`, `eyeY`; `eyeHeight(body, seatHipY)` gives the camera height). The pack's own animation clips are not used in the sim.
- **The person object**: position, task, state and so on. NPCs are made by `people/factory.js`; the player is made by `player/player.js`. Both use the same rig and the same `people/animation.js` poses. Poses are written for a human with elbows and knees; `applyPose` maps them onto the pack's skeleton, which has neither.

**The player** (`player/`) is a separate entity, not an NPC. It has no seat or schedule and is never picked by the sim. It appears at the entrance the first time first or third person is used, then stays where you left it. `setPlayerSpec(raw)` rebuilds its look live; `savePlayerSpec()` keeps it.

**The character lab** (`ui/creator.js`) edits the player's look: "Character lab" in the HUD, or "Look" while walking. It has its own small renderer for the animated preview (made the first time it opens), edits a draft spec, and on Save calls `setPlayerSpec` and `savePlayerSpec`.

**Hazel** (`people/hazel.js`) is the one hand-written NPC: the first person created gets her look (a short blocky character with a bob and a permanently furious face, `HAZEL_LOOK`) and name, and she always leaves last. With the real staff list she is the employee with that name, if there is one.

**Employees and their characters.** Every person in the office is an employee from Supabase (through `/api/employees`), named and labelled by department (`jobTitle` in `people/roster.js`). Their look is `character_information.character_data` when saved, else a generated one seeded by their id. Click someone and press **Edit character**, or search them in the lab; Save writes their look through `PUT /api/characters/:userId`. The search box at the bottom left (`ui/search.js`) finds and follows anyone in the office.

**Desks and hours.** Each employee sits at the desk they chose in the lab (stored as `desk` in `character_data`), else a free one; HR staff use the HR Office (the old Conference 2). The sim day runs 06:00 to 06:00 so every shift (`shifts` table) fits. During a shift people work, meet, use the whiteboards, take calls, get coffee or a snack (`sim/tasks.js` `work`); games, music, darts, golf and the sofa happen only on breaks: the lunch hour, 15:00 and 17:00 for the day shift, at the same points into other shifts (`sim/schedule.js`). A break interrupts desk work.

## Interactables and activities

Anything a person can use is a **spot** created with `mkSpot(kind, x, y, face, options)`. It registers itself in `world/interactables.js` under its `kind` (and under `options.group` if given). Spots have `pos`, `approach`, `face`, `occupant`, and so on.

An **activity** is a function in `sim/tasks.js` (for example `dartsBreak`) that finds a free spot, calls `goDo(person, task)`, and is offered by `chooseNext`. The `task.anim` name selects a pose in `people/animation.js`, and `statusText` in `ui/person.js` words it for the HUD. See [HOW-TO.md](HOW-TO.md#add-an-interactable-and-an-activity).

## Camera

`camera/controller.js` holds a set of **modes** `{ id, enter, update, exit }` and switches between them with `setView(id)`: `angle`, `top`, `follow`, `free`, `fp`, `third`. The HUD buttons carry `data-view="<id>"` and the controller keeps their pressed state in sync. Manual input (drag, wheel, jump-to) drops you into `free`. First and third person share the player's controls (`player/control.js`); they differ only in where the camera goes.

The third-person camera runs an "arm" from the head to the wanted camera spot and shortens it using `camera/collide.js`, which tests the arm against the walls actually built (`SOLIDS`), at their current height.

## Debug hook

`window.__sim` exposes live state and a few functions (the sim, people, player, `ctl`, `interactables`, `wall`, the camera controller, `advance(n)` to step the sim without rendering, and more). It exists so the app can be driven from the browser console and from scripted checks. Treat it as **development only**.

## Known limits

- The simulation still imports Three.js: a person carries its meshes and some activities toggle props. You cannot run the sim without a browser yet.
- The third-person camera collides with walls only, not furniture.
- No automated tests or linting yet; verification is a manual checklist.
- The production build is a single ~850 KB chunk (the character pack added about 250 KB).
- The pack's characters have no elbows or knees, so seated people sit with straight legs and bent-arm poses are approximated at the shoulder.
