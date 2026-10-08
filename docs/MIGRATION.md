# Migrating work from the old single `index.html`

Until this restructure the whole app was one 2,083-line `index.html` (commit `eae3cd0`, "first commit"). It is now split into modules under `apps/client/src/`. **If you have changes you started against the old file, this page shows you where each part went and how to move your work over.** It is a one-time cost: once a change lives in its own file, merges stop colliding.

The client later moved again, into `apps/client/`, when the repository became a monorepo (phase 0). History was kept with `git mv`, so `git log --follow` still works. All paths below are from the repository root.

A worked example is at the bottom: the "angry hazel" commit (`eb60c07`) was ported exactly this way.

## Quick procedure

1. Get the new structure: `git fetch && git checkout main && git pull`, then `npm install`.
2. List what you changed against the old file. Use the commit your branch started from as `<base>`:
   ```
   git diff <base> <your-branch> -- index.html > my-changes.diff
   ```
   (`git apply` will not work on this: the target file no longer exists as one piece.)
3. For each hunk in `my-changes.diff`, find its new home in the [map](#where-everything-went) below and re-apply it by hand there. Translate old names with the [cheat-sheet](#rename-cheat-sheet).
4. Work that ran at the top level of the old script now belongs inside a `build*()`/`init*()` function called from `apps/client/src/bootstrap.js` (see [CODING-STANDARDS.md](CODING-STANDARDS.md#2-no-work-at-import-time)).
5. Run the checklist in [CODING-STANDARDS.md](CODING-STANDARDS.md#before-you-push), then push.

If you prefer to merge instead of porting by hand:
```
git checkout <your-branch>
git merge origin/main        # conflicts in index.html are expected
git checkout origin/main -- index.html     # take the new (markup-only) index.html
# now re-add your HTML/CSS/JS pieces in their new files, then:
git add -A && git commit
```

## Where everything went

Old line numbers refer to `index.html` at `eae3cd0`.

**Markup, styles, assets**

| Old lines | Now |
|---|---|
| 1 (inline reset style) | `apps/client/src/styles/reset.css` |
| 7 to 101 (`<style>`) | `apps/client/src/styles/*.css`: `tokens`, `base`, `hud`, `controls`, `ledger`, `person`, `ui-toggle`, `first-person`, `veil`, `responsive` (imported in that order by `main.js`) |
| 103 to 200 (body markup) | `index.html` (still markup only) |
| 201 to 203 (load watchdog) | stays inline in `index.html` |
| 204 to 206 (import map for three) | removed: `three` comes from npm |
| line 705 (base64 logo) | `apps/client/src/assets/logo.png` |

**JavaScript**

| Old lines | Now |
|---|---|
| 211 to 232 plan data, `OUTER`, `WALLS` | `packages/shared/src/plan.ts` (moved there in phase 1, step 2) |
| 217 to 221 helpers (`rnd`, `pick`, `shuffle`, `TAU`, `angDiff`) | `packages/shared/src/util.ts` (moved there in phase 1, step 1) |
| 234 to 265 renderer, scene, sun, theme | `apps/client/src/render/renderer.js` |
| 267 to 355 textures and `M` materials | `apps/client/src/render/materials.js` |
| 357 to 412 monitor and TV screens | `apps/client/src/render/screens.js` |
| 414 to 438 geometry helpers, `OBS`, wall-height state | `apps/client/src/world/helpers.js` |
| 440 to 457 floor | `apps/client/src/world/floor.js` |
| 459 to 531 walls, windows, blinds | `apps/client/src/world/walls.js` |
| 532 to 544 doors | `apps/client/src/world/doors.js` |
| 546 to 581 `SEATS`, `mkSpot`, chairs, plants | `apps/client/src/world/furniture/basics.js` (`mkSpot` and the registry moved to `packages/shared/src/sim/` in phase 1, step 8) |
| 582 to 608 cabinet, TV stand | `furniture/cabinet.js`, `furniture/tv.js` |
| 609 to 653 desk islands | `furniture/desks.js` |
| 654 to 681 conference rooms | `furniture/conference.js` |
| 682 to 719 lounge, brand wall | `furniture/lounge.js` |
| 720 to 845 console and fighting game | `furniture/game.js` |
| 846 to 856 bar tables | `furniture/bar.js` |
| 857 to 861 work-floor TVs | `furniture/workfloor.js` |
| 862 to 879 booths | `furniture/booths.js` |
| 880 to 893 dining | `furniture/dining.js` |
| 894 to 913, 998 to 1007 mini golf | `furniture/golf.js` |
| 914 to 958, 978 to 997 darts | `furniture/darts.js` |
| 959 to 977 server rack | `furniture/server.js` |
| 1009 to 1034 counter, sink | `furniture/kitchen.js` |
| 1035 to 1049 storage, lockers | `furniture/storage.js` |
| 1050 to 1052 plants | `furniture/plants.js` |
| 1051 to 1054 `EXIT`, `ENTRY` | `ENTRY` in `packages/shared/src/sim/spots.ts`; the exit door in `apps/client/src/world/entrance.js` |
| 1056 to 1080 `bake` | `apps/client/src/world/bake.js` |
| 1080 to 1111 labels | `apps/client/src/render/labels.js` |
| 1113 to 1133 nav grid | `packages/shared/src/nav/grid.ts` (moved in phase 1, step 4) |
| 1134 to 1171 A* | `packages/shared/src/nav/astar.ts` (moved in phase 1, step 4) |
| 1173 to 1195 names, roles, activity categories | `packages/shared/src/sim/data.ts` (palettes in `packages/shared/src/character/spec.ts`; both moved in phase 1, step 3) |
| 1196 to 1274 `buildBody` | `apps/client/src/character/rig.js`, `parts.js`, `gfx.js` |
| 1276 to 1285 people list, sim clock, log | `packages/shared/src/sim/state.ts` (moved in phase 1, step 8) |
| 1287 to 1323 `makePerson`, `removePerson`, `scheduleDay` | `packages/shared/src/sim/factory.ts` (the body is made in `apps/client/src/people/views.js`) |
| 1325 to 1450 activities, `chooseNext` | `packages/shared/src/sim/tasks.ts` |
| 1451 to 1483 meetings | `packages/shared/src/sim/meetings.ts` |
| 1484 to 1534 day cycle, initial scene | `packages/shared/src/sim/day.ts` |
| 1535 to 1613 poses | `apps/client/src/people/animation.js` |
| 1614 to 1660 per-frame movement | `packages/shared/src/sim/step.ts` |
| 1662 to 1675 day/night light | `apps/client/src/render/lighting.js` |
| 1676 to 1716 camera state and views | `apps/client/src/camera/state.js`, `controller.js`, `modes/*`, `orbit.js` |
| 1717 to 1780 pointer and keyboard input | `apps/client/src/camera/input.js` |
| 1781 to 1804 jump-to spots, picking | `apps/client/src/camera/spots.js` |
| 1805 to 1819 camera update | `apps/client/src/camera/controller.js` (`updateCamera`) and `camera/state.js` (`orbitStep`) |
| 1821 to 1867 selection, person card | `apps/client/src/ui/person.js` |
| 1869 to 1881 ledger | `apps/client/src/ui/ledger.js` |
| 1883 to 1906 HUD controls | `apps/client/src/ui/controls.js` |
| 1908 to 2040 first person | `apps/client/src/fp/firstPerson.js` and `apps/client/src/player/*` |
| 2042 to 2081 main loop, startup, debug hook | `apps/client/src/main.js` and `apps/client/src/bootstrap.js` |

## Rename cheat-sheet

| Old | New |
|---|---|
| `SEATS.desk`, `SEATS.lounge`, ... | `interactables.of('desk')`, `interactables.of('lounge')`, ... |
| `SEATS.conf[n]` | `interactables.conf(n)` |
| `SEATS.x.push(mkSpot(...))` | `mkSpot(...)` alone; it registers itself |
| `SEATS.x = []` | not needed |
| `look`, `p.look.shirt`, `buildBody(look)` | `spec`, `p.spec.shirt`, `buildBody(spec)` (`character/rig.js`) |
| the `look = {...}` block in `makePerson` | `randomSpec(role)` in `packages/shared/src/character/spec.ts` |
| `fp.on` | `ctl.active` (first **or** third person) |
| `fp.p` | `player.person` (the player is its own entity now) |
| `fp.sitting`, `fp.moving` | `player.sitting`, `player.moving` |
| `fp.yaw`, `fp.pitch` | `ctl.yaw`, `ctl.pitch` |
| `view`, `followP` | `viewId()`, `following()` (`camera/controller.js`) |
| `setView('x')` | `setView('x')` (same name; modes are registered in `initCamera`) |
| `setViewPressed(null)` | `setView('free')` |
| `followP = p; view = 'follow'` | `follow(p)` |
| `exitFP()` | `exitPlay()` (`player/control.js`) |
| `wallH`, `wallGoal` | `wall.h`, `wall.goal` |
| `labelsOn` | `labelState.on` |
| `logDirty` | `logState.dirty` |
| a statement that ran at the top level | inside a `build*()` / `init*()` called from `bootstrap.js` |
| `window.__sim` | same hook, with more in it (see [ARCHITECTURE.md](ARCHITECTURE.md#debug-hook)) |

One behaviour change to know about: **first person no longer possesses a random NPC.** You now walk as your own character (`player/`), who appears at the entrance. Code that assumed `fp.p` was an NPC in `people` needs to use `player.person` instead.

## Worked example: "angry hazel" (`eb60c07`)

That commit added a special character, a rage mode, a music corner and new look options to the old file. It was ported into the new structure like this:

| What the commit added | Where it lives now |
|---|---|
| Hazel's HUD row and styles | `index.html`, `apps/client/src/styles/hazel.css` |
| `makeGuitar` (held and on a stand) | `apps/client/src/character/props.js` |
| Music corner (piano, guitar, notes) | `apps/client/src/world/furniture/music.js` (`buildMusic`, `updateMusic`) |
| `SEATS.music` | spots with `group: 'music'`: `interactables.of('music')` |
| New materials | `apps/client/src/render/materials.js` |
| Cube head, skirt, bob hair, angry face, guitar on the rig | `apps/client/src/character/rig.js`, `parts.js`, and new `spec` fields (`skirt`, `cube`, `angry`) |
| Hazel's identity, rage mode, find/rage buttons | `apps/client/src/people/hazel.js` |
| Music activity and its start-of-day placement | `packages/shared/src/sim/tasks.ts` (`musicBreak`), `packages/shared/src/sim/day.ts` |
| Piano, guitar and rage poses | `apps/client/src/people/animation.js` |
| Rage freezes walking | `packages/shared/src/sim/step.ts` |
| Status text for piano/guitar | `apps/client/src/ui/person.js` |
| "Music corner" label | `apps/client/src/render/labels.js` |
| Camera shake, `updateRage`, `updateMusic` in the loop | `apps/client/src/main.js` |
| Player can sit at the piano/guitar | `apps/client/src/player/seating.js` |
| "UX/UI Designer" role verb | `packages/shared/src/sim/data.ts` |

Two things changed on the way over: Hazel's rage no longer needs a special case for the player possessing her (the player is separate), and her look fields are part of `CharacterSpec`.
