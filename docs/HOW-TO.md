# How to add things

Recipes for the common changes. Each one follows the rules in [CODING-STANDARDS.md](CODING-STANDARDS.md) and names the files to touch. The music corner and Hazel were added with these same steps; read them as worked examples.

- [Add furniture or an area](#add-furniture-or-an-area)
- [Add an interactable and an activity](#add-an-interactable-and-an-activity)
- [Add a camera view](#add-a-camera-view)
- [Add a hairstyle or another look option](#add-a-hairstyle-or-another-look-option)
- [Update the character pack](#update-the-character-pack)
- [Add a HUD control](#add-a-hud-control)
- [Add a special character](#add-a-special-character)
- [Change the floor plan](#change-the-floor-plan)

## Add furniture or an area

1. Create `src/world/furniture/<area>.js`. Export a `build<Area>()` function that does all the work (meshes, obstacles, spots). Nothing runs at import time.
2. Use the helpers: `box`, `cyl`, `frame(px, py, facing)` from `world/helpers.js`, materials from `render/materials.js` (`M.*`; add new materials to the `M` palette there), and `W(px, py)` for positions.
3. Register obstacles with `addObs(x1, y1, x2, y2)` (plan pixels) so people path around the furniture. The nav grid is built after all furniture, so this must happen in your `build` function.
4. If people can use it, create spots with `mkSpot` (next section).
5. If it animates, export an `update<Area>(now)` and call it from the loop in `main.js`.
6. Add `build<Area>()` to [`src/bootstrap.js`](../src/bootstrap.js), **before `buildBake()`** (static meshes are merged there) and **before `initGrid()`**.
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
4. **Add the pose** for `anim` as a `case` in `targetPose` in `people/animation.js`. Joint names are listed at the top of that file (`JOINTS`). Poses are written for a human with elbows and knees (`hipY` for a .88 m hip); `applyPose` maps them onto the pack's skeleton, which has neither: half of each elbow bend goes into the shoulder and knees are ignored. Call `sit()` for seated poses so the hips go on the seat.
5. **Word it for the HUD**: add `case 'piano': return going ? '...' : '...';` in `statusText` in `ui/person.js`.
6. **Let the player use it**: add the kind to the list in `nearestSeat` (`player/seating.js`) and map it to an `anim` in `sitDown`.
7. **Props** a person holds (a guitar, a mug) belong on the rig: create them in `makeHeldProps` in `character/props.js` (positions are offsets from the hand, in metres; `buildBody` attaches them), hidden by default, and toggle `visible` in `onStart`/`onEnd` and in `sitDown`/`standUp`. The pack's own hand accessories (coffee, phone, book...) are separate: they are shown only in the `walk` and `stand` poses.
8. If people should already be doing it when the page loads, add a `placeNow(...)` line in `initDay` in `sim/day.js`.
9. Check: `__sim.advance(3000)` a dozen times shows your `kind` among `people[i].task.kind`, and the player can sit and play.

## Add a camera view

1. Create `src/camera/modes/<name>.js` exporting a mode object: `{ id, enter(ctrl, opts), update(dt, ctrl), exit(ctrl) }`. `ctrl.setView(id)` switches mode; `ctrl.nextId` tells `exit` where we are going.
2. For orbit-style views, set `camGoal` in `enter` and call `orbitStep(dt, rate)` in `update` (see `angle.js`).
3. Register it in `initCamera()` in `camera/controller.js`.
4. Add a button with `data-view="<id>"` in `index.html`. The controller keeps its pressed state in sync and `ui/controls.js` already binds every `[data-view]` button.
5. If it steers the player, follow `camera/modes/thirdPerson.js`: call `beginControl` in `enter` and `endControl(ctrl.nextId)` in `exit`, and use `driveLocomotion` for movement.

## Add a hairstyle or another look option

Characters are drawn by the character pack in `character/pack/` (see its `README.md`). A look option is a part of the pack's config, and it applies to NPCs, the player and the character lab at once, because they all share `CharacterSpec`.

1. **Build it in the pack.** Each style has registries: `ChibiCharacter.registerHair(name, fn)` and `BlockyCharacter.registerHair(...)`, plus `registerTop`, `registerBottom`, `registerShoes`, `registerFacialHair` (chibi) and `registerAccessory`. Register the same name in both styles, or add a fallback to `FALLBACKS` in `pack/characters.js`. Call the register functions from an `init*()` (never at import time), before the first character is built: add a `character/looks.js` with `initLooks()` and call it first in the simulation block of `bootstrap.js`.
2. **Nothing else to do for most options:** `normalizeSpec` (`character/spec.js`) accepts any style either pack offers, and the lab lists the pack's options (`specOptions`). Accessories in the `ride` slot are filtered out everywhere; the office has no skateboards.
3. **If NPCs should wear it**, add it to `generatedSpec` in `spec.js`.
4. **A look the pack cannot draw** (like Hazel's furious face) goes in `character/parts.js` as an `add<Thing>(head, ...)` called from `buildBody` in `character/rig.js`, with a flag in the spec that `normalizeSpec` keeps.
5. Check: `normalizeSpec(JSON.parse(JSON.stringify(spec)))` returns the same spec, the lab shows it, and `setPlayerSpec(spec)` shows it on the player.

## Update the character pack

The files in `character/pack/` are kept exactly as delivered (from the character lab's `characters.zip`), so a new version can be dropped in.

1. Replace `characters.js`, `blocky-character.js`, `blocky-presets.js`, `chibi-character.js`, `chibi-presets.js` and `README.md`. The `.glb` files, `export-glb.js` and `character-lab.html` are not used.
2. Check what `character/rig.js` relies on: the joint names (`Hips`, `Spine`, `Neck`, `HeadShape`/`Head`, `ArmL`/`ArmR`, `HandL`/`HandR`, `LegL`/`LegR`, `ItemL`/`ItemR`), `character.inner.config`, `STYLES[type].lib.ACCESSORIES`, and that every material is a `MeshStandardMaterial` that differs only by colour (the draw-call merge in `character/gfx.js` depends on it).
3. Run the checklist in [CODING-STANDARDS.md](CODING-STANDARDS.md#before-you-push), plus: open the Character lab, and compare frame rates at 70 people before and after.

## Add a HUD control

1. Add the markup in `index.html` (give it an `id`; no inline handlers).
2. Style it in the CSS file for that area in `src/styles/` (or a new file imported in `main.js`).
3. Bind it in an `init*` function (`ui/controls.js` for general controls) using `$('id').onclick = ...`.
4. If it must disappear while walking around as the player, add it to the `body.fp`/`body.tp` rules in `styles/first-person.css`.

## Add a special character

Hazel (`people/hazel.js`) is the template.

1. Give the character a fixed look (a spec, like `HAZEL_LOOK`) and an `apply<Name>()` that returns its name, role and `normalizeSpec(look)`; call it from `makePerson` in `people/factory.js` for the person created at the right index. Add any new look options first (see above).
2. Keep identity in one place: name constant, role, schedule overrides (see `scheduleDay` in `factory.js`).
3. Put the character's own behaviour and effects in one module with an `init<Name>()` (called from `bootstrap.js`) and `update<Name>()` (called from the loop).
4. Poses and status texts go in `people/animation.js` and `ui/person.js` like any other activity.

## Change the floor plan

- Walls and the outer outline are data in `config/plan.js` (`OUTER`, `WALLS`) in plan pixels. Wall segments must be axis-aligned (horizontal or vertical); a gap in a wall is a doorway.
- Free-standing wall blocks are made with `solidBlock(...)` in `world/walls.js`. Walls and blocks register themselves for navigation (`OBS`) and for the third-person camera (`SOLIDS`).
- After any plan change, check the nav counts, walk through every doorway in first person, and try the third-person camera against the changed walls.
