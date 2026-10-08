# How to add things

Recipes for the common changes. Each one follows the rules in [CODING-STANDARDS.md](CODING-STANDARDS.md) and names the files to touch. The music corner and Hazel were added with these same steps; read them as worked examples.

- [Add furniture or an area](#add-furniture-or-an-area)
- [Add an interactable and an activity](#add-an-interactable-and-an-activity)
- [Add a camera view](#add-a-camera-view)
- [Add a hairstyle or another look option](#add-a-hairstyle-or-another-look-option)
- [Add a HUD control](#add-a-hud-control)
- [Add a special character](#add-a-special-character)
- [Change the floor plan](#change-the-floor-plan)

## Add furniture or an area

1. Create `apps/client/src/world/furniture/<area>.js`. Export a `build<Area>()` function that does all the work (meshes, obstacles, spots). Nothing runs at import time.
2. Use the helpers: `box`, `cyl`, `frame(px, py, facing)` from `world/helpers.js`, materials from `render/materials.js` (`M.*`; add new materials to the `M` palette there), and `W(px, py)` for positions.
3. Register obstacles with `addObs(x1, y1, x2, y2)` (plan pixels) so people path around the furniture. The nav grid is built after all furniture, so this must happen in your `build` function.
4. If people can use it, create spots with `mkSpot` (next section).
5. If it animates, export an `update<Area>(now)` and call it from the loop in `main.js`.
6. Add `build<Area>()` to [`apps/client/src/bootstrap.js`](../apps/client/src/bootstrap.js), **before `buildBake()`** (static meshes are merged there) and **before `initGrid()`**.
7. If the area needs a name on the map, add a `label(...)` line in `render/labels.js`.
8. Check: the nav cell count (`__sim.NAV`) changes by about the size of your furniture, and people walk around it.

Meshes you will move or animate later must be marked so `bake` leaves them alone: set `mesh.userData.dynamic = true`.

## Add an interactable and an activity

Example: the music corner (`world/furniture/music.js`, `musicBreak` in `sim/tasks.js`).

1. **Create the spot** in your `build` function:
   ```js
   mkSpot('piano', 652, 525, E, { sit: true, hipY: .6, place: 'the keyboard', group: 'music' });
   ```
   `kind` is the lookup key (`interactables.of('piano')`). The optional `group` also lists it under a second key (`interactables.of('music')` returns every spot in the group). `sit: true` makes people sit; `hipY` is the seat height.
2. **Write the activity** in `sim/tasks.js`:
   ```js
   function musicBreak(p) {
     const s = free(interactables.of('music'))[0]; if (!s) return false;
     return goDo(p, { kind: s.kind, cat: 'break', anim: s.kind, spot: s, dur: rnd(6, 14), onStart: ..., onEnd: ... });
   }
   ```
   `cat` is the ledger category (`work`, `meeting`, `phone`, `pantry`, `lunch`, `break`, `chat`, `walk`; defined in `people/data.js`). `anim` selects a pose. `onStart`/`onEnd` toggle props.
3. **Offer it** by adding a line to `chooseNext` in `sim/tasks.js` with a probability, for example `if (r < .61 && musicBreak(p)) return;`.
4. **Add the pose** for `anim` as a `case` in `targetPose` in `people/animation.js`. Joint names are listed at the top of that file (`JOINTS`).
5. **Word it for the HUD**: add `case 'piano': return going ? '...' : '...';` in `statusText` in `ui/person.js`.
6. **Let the player use it**: add the kind to the list in `nearestSeat` (`player/seating.js`) and map it to an `anim` in `sitDown`.
7. **Props** a person holds (a guitar, a mug) belong on the rig: create them in `character/props.js` / `character/rig.js`, hidden by default, and toggle `visible` in `onStart`/`onEnd` and in `sitDown`/`standUp`.
8. If people should already be doing it when the page loads, add a `placeNow(...)` line in `initDay` in `sim/day.js`.
9. Check: `__sim.advance(3000)` a dozen times shows your `kind` among `people[i].task.kind`, and the player can sit and play.

## Add a camera view

1. Create `apps/client/src/camera/modes/<name>.js` exporting a mode object: `{ id, enter(ctrl, opts), update(dt, ctrl), exit(ctrl) }`. `ctrl.setView(id)` switches mode; `ctrl.nextId` tells `exit` where we are going.
2. For orbit-style views, set `camGoal` in `enter` and call `orbitStep(dt, rate)` in `update` (see `angle.js`).
3. Register it in `initCamera()` in `camera/controller.js`.
4. Add a button with `data-view="<id>"` in `index.html`. The controller keeps its pressed state in sync and `ui/controls.js` already binds every `[data-view]` button.
5. If it steers the player, follow `camera/modes/thirdPerson.js`: call `beginControl` in `enter` and `endControl(ctrl.nextId)` in `exit`, and use `driveLocomotion` for movement.

## Add a hairstyle or another look option

All of these also apply to NPCs and the player, because they all share `CharacterSpec`.

1. **`character/spec.js`:** add the field to `DEFAULT_SPEC`, to `randomSpec` (usually a constant so NPCs do not change), and to `normalizeSpec`. Add the choices to `PARTS` (or `STYLE_OPTIONS` for a hairstyle). Keep this file free of Three.js.
2. **Build it:**
   - Hairstyle: add an entry to `HAIR_STYLES` in `character/parts.js` (`{ cap, extra(head, hair, spec) }`).
   - Anything else on the head/face: add an `add<Thing>(head, spec)` in `parts.js` and call it from `buildBody` in `character/rig.js`.
   - Body or clothing: edit `buildBody` in `rig.js`.
3. Check: `normalizeSpec(JSON.parse(JSON.stringify(spec)))` returns the same spec, and `setPlayerSpec(spec)` shows it on the player.

## Add a HUD control

1. Add the markup in `index.html` (give it an `id`; no inline handlers).
2. Style it in the CSS file for that area in `apps/client/src/styles/` (or a new file imported in `main.js`).
3. Bind it in an `init*` function (`ui/controls.js` for general controls) using `$('id').onclick = ...`.
4. If it must disappear while walking around as the player, add it to the `body.fp`/`body.tp` rules in `styles/first-person.css`.

## Add a special character

Hazel (`people/hazel.js`) is the template.

1. Give the character a spec override (`apply<Name>(spec)`) and call it from `makePerson` in `people/factory.js` for the person created at the right index. Add any new look options to the spec first (see above).
2. Keep identity in one place: name constant, role, schedule overrides (see `scheduleDay` in `factory.js`).
3. Put the character's own behaviour and effects in one module with an `init<Name>()` (called from `bootstrap.js`) and `update<Name>()` (called from the loop).
4. Poses and status texts go in `people/animation.js` and `ui/person.js` like any other activity.

## Change the floor plan

- Walls and the outer outline are data in `packages/shared/src/plan.ts` (`OUTER`, `WALLS`) in plan pixels. Wall segments must be axis-aligned (horizontal or vertical); a gap in a wall is a doorway.
- Free-standing wall blocks are made with `solidBlock(...)` in `world/walls.js`. Walls and blocks register themselves for navigation (`OBS`) and for the third-person camera (`SOLIDS`).
- After any plan change, check the nav counts, walk through every doorway in first person, and try the third-person camera against the changed walls.
