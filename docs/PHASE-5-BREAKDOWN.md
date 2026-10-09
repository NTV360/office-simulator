# Phase 5: world objects, in steps

**Status: in progress. Steps 1 and 2 are done; step 3 is next.** This turns phase 5 of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md) ("World objects") into steps that are each built and checked before the next, as phases 2 to 4 were ([PHASE-4-BREAKDOWN.md](PHASE-4-BREAKDOWN.md)).

**Done when (from the plan):** you can move your chair and personalise your station, and it is all still there after a restart. In practice: chairs and the small things on desks are objects the server owns; a player can pick one up, carry it and put it down; the office stays fast; what you change is saved.

## The rule that decides the design: it must not be laggy

A measurement taken before any of this (`npm run perf`, software-rendered headless Chrome, so the absolute frame times mean little but changes are real; 40 people; the numbers at the top of each view):

| View | Draw calls | Triangles | Geometries |
|---|---|---|---|
| Angle | 1409 | 236,300 | 589 |
| Plan (top) | 1461 | 242,601 | 589 |
| Third person | 678 | 137,940 | 594 |

Nearly all of those draw calls are the **people** (each is dozens of small meshes). The whole furniture is **baked into a handful of draw calls** today. So the furniture must not become one mesh per object: 130 chairs of 6 parts each would add about 800 draw calls. The design therefore is:

1. **Instanced drawing.** Every part of every prefab (a chair's base, post, seat, back and arms; a mug; a notebook; a plant's pot and leaves) is **one `InstancedMesh`** for all objects of that type. Draw calls grow with the number of *kinds of part* (about 20), not with the number of objects, so 1000 chairs cost the same as 100. Moving an object changes a few numbers in a matrix buffer; nothing is created or destroyed per move. Budget: **at most 40 extra draw calls** against the baseline above, and a stress run with 1000 instances.
2. **Nothing per frame.** No allocation and no loop over objects each frame: the instance buffers are touched only when an object changes.
3. **Tiny network cost.** Objects travel in the welcome (about 20 bytes each) and then only as small `object` messages when one changes (a person can change at most a few a second). A carried object is not streamed: every client draws it in the carrier's hands from the carrier's position, which it already has.
4. **Nothing in the tick.** Applying a move is O(1); saving happens in the existing batched save (only objects that are not where they started are written).
5. **No dynamic navigation yet.** Chairs and desk items are not obstacles today (people walk past them), so moving them needs no change to the walk grid. Movable tables (which are obstacles) are left for later and stay fixed.

## Decisions

1. **What can move in this phase:** all chairs (office, conference, dining, bar stools, booth chairs) and the small things on desks (mug, notebook, desk plant, keyboard is not moved: it is part of the monitor setup). Tables, sofas, monitors (they carry the live screen), TVs, counters and everything else stay fixed, as the plan's section 8.8 says. Which type is movable is data in the catalogue, so the team can change it.
2. **Objects are made once, from the furniture code, with fixed random numbers.** The decor on desks used to be random on every page load (so two browsers did not even agree); now a seeded draw makes it once and it is saved in the layout data (`office.json`), which the client and the server both read.
3. **A seat follows its chair.** A chair object carries its seat spot; moving the chair moves the seat, the person's "approach" point and the way it faces. Spot ids never change. A chair someone is sitting in cannot be picked up.
4. **Placement is checked by the server:** within reach of the person, on floor people can walk on, not on top of another chair, not outside the building. So a moved seat is always somewhere the autopilot can walk to.
5. **Who may move what:** anything at a **station** (the chair and the desk items at a desk) can be moved only by that desk's owner (the account whose person owns the desk), and by an admin. Things in **shared areas** (lounge, dining, conference, bar, booths) are free for every player. Stations of autopilot people are locked until someone takes the desk. Admins use the admin API (they are not players).
6. **Reset.** "Reset my station" puts everything that belongs to your desk back where it started; "reset this object" does it for one thing; an admin can reset one object or the whole office. Every move and reset is rate-limited and recorded in the audit log for admin resets.
7. **The saved world carries the objects that are not at home** (save version 3; older saves load fine and simply have none). The layout fingerprint that tells the page and the server they run the same office is **taken once, from the starting positions**, so a chair that has been moved does not make a new page refuse to join.
8. **Offline (no server)** the objects are drawn and cannot be moved.
9. **Every step** runs the earlier checks (`npm test`, `npm run typecheck`, `npm run build`, `npm run check:docs`, `npm run verify:browser:thorough`, `npm run check:mutations`, `npm run test:db`, the Docker smoke test, `verify:browser` against the Docker stack and the three end-to-end scripts) plus its own proof and, for anything that changes how the office is drawn, `npm run perf`; each gets a "what it turned out to need" note here and a read-only `claude-alt` review of the security-sensitive ones.

## The steps

| # | Step | What gets built | Proof |
|---|---|---|---|
| **1** (**done**) | The object model | The catalogue, the registry, the starting objects made from the furniture code (deterministic), `office.json` carries them, the server loads them, the protocol carries them (welcome and `object` messages), the page's mirror applies them, the layout fingerprint is taken from the starting positions. Nothing is drawn differently yet | Catalogue and registry tests; the same objects on every run; layout data round trip; protocol round trips; a page and a server agree after an object moved |
| **2** (**done**) | Drawing objects, fast | Prefabs as instanced parts; chairs and desk items leave the baked furniture and are drawn from the objects | `npm run perf` within the budget; a 1000-instance stress run; screenshots show the same office; offline and online both |
| **3** | Seats follow chairs | Moving a chair moves its seat; the server's placement rules; the autopilot uses a moved chair | Simulation tests (a moved chair is used; an occupied chair cannot move; every spot stays reachable); mutation entries |
| **4** | Pick up, carry, put down | `grab`, `place`, `rotate` messages, permissions, rate limits, the carried object drawn in the carrier's hands, a preview of where it will go, keys and hints | Server tests for every rule over real sockets; a browser check with two players |
| **5** | Personalise and keep it | Station ownership, reset station and object, admin reset with the audit log, the objects in the saved world | A restart brings back every move; admin reset; database tests |
| **6** | End to end and review | `npm run e2e:objects`: two players rearrange a station and the lounge, with a restart and a hard kill; a read-only review of the whole phase; the performance report; docs finished | The script passes; the performance budget holds; the review's findings are fixed with tests |

## Risks and what answers them

| Risk | Answer |
|---|---|
| Drawing slows down | Instancing, the 40-call budget, `npm run perf` in every step that changes drawing, a 1000-instance stress run |
| Someone puts a chair somewhere the autopilot cannot reach | The server only accepts walkable places inside the building; a reset always restores a valid starting place |
| The page and the server disagree about where things start | One data file (`office.json`) read by both, a fingerprint taken from it before anything moves |
| Griefing (stealing someone's chair, flooding moves) | Station ownership, rate limits, reset, the admin reset; a per-account cap on moves per second |
| A save with bad object data | Objects are validated like people (known ids, finite numbers, inside the building); an invalid entry is dropped, not fatal |

### Step 1: the object model (done)

1. **What an object is.** `WorldObject` (`packages/shared/src/world/objects.ts`): an id (`obj:0`, `obj:1`, in the order of the layout data), a kind from the **catalogue** (`world/catalogue.ts`: office chair, dining chair, bar stool, mug, notebook, desk plant, each with mobility, weight, a footprint radius and whether it rests on the floor or on a table), a pose (x, z, the way it faces), the height of what it rests on, a variant (colour), the **station** (desk) it belongs to or none, the **seat** it carries or none, who carries it, and its **home** (where it started). The catalogue is data: changing what can move is an edit there.
2. **A seat follows its chair.** An object that carries a seat remembers where the seat is relative to it; `setObjectPose` moves the seat, the point people stand at to use it and the way it faces, together. Spot ids never change. A phone booth's seat (whose approach point is not the seat) keeps its offset and turns with the chair. `resetObject` and `resetAllObjects` put things back, seats included. Every move announces `objectMoved`.
3. **The starting objects are made once, from the furniture code, with fixed numbers.** `apps/client/src/world/objects.js` (`placeObject`, `placeObjectLocal`) is called by the builders next to the meshes they already draw: **156 objects** (98 office chairs, 18 dining chairs, 4 bar stools, 26 mugs, 6 notebooks, 4 desk plants). The decor on the desks was `Math.random()` on every page load, so no two pages agreed; it is now chosen from a fixed number per seat (`seededRandom`), and the mesh drawn and the object recorded come from the same draw. `npm run layout:dump` writes them into `office.json` (`objects`), which the page's furniture code and the server both end up with.
4. **The layout fingerprint is taken once** (`lockLayoutCheck`, called by `loadLayout` and by the page after it builds the office) from the spots and every object's *home*, so a chair that has been moved does not make a page that joins later disagree with the server. A fingerprint locked for one layout is ignored if the spot or object count changes (a test building another layout).
5. **Protocol version 9.** The welcome carries `objects`: only the poses of objects that are **not at home** (about 20 bytes each; nothing when the office is as it started), and a new `object` message tells everybody playing about each change (the gateway turns `objectMoved` into it). The page applies the welcome (everything goes home, then the listed ones move) and each `object` message (`applyObjectPoses`, `applyObjectPose`); an object it does not know, or a pose that is not a number, is ignored. Clients cannot send `object` (tested).
6. **Saved.** Save version 3 adds the objects that are not at home (`{ id, x, z, rot }`); older saves still load and have none; restoring puts everything home first, then the saved ones where they were, and ignores an object this office no longer has. An object carried when the save was made is saved where it was picked up and nobody carries it afterwards. The reader validates every entry (an id of the form `obj:N`, numbers in range, no repeats, a sensible count) and refuses a damaged list. (A first draft of that check had lost the backslash in its pattern, so no saved id would ever have validated; the save tests caught it.)
7. **Nothing is drawn differently yet, and the simulation is unchanged:** the recorded days are byte-identical.
8. **Verified.** 24 object tests (the catalogue; the 156 objects and their ids; every seat carried by exactly one chair at the same place and facing; stations; the same on every run; moving, turning, resetting, announcing; a booth's offset; a seat that does not exist; the fingerprint; what a new page is told; saving and restoring including a carried one, an old save, an unknown object and every kind of damage), 5 tests over real sockets (a new page is told which are not at home; an empty list when all are home; a move reaches every player once and not an unjoined connection; putting back is told too; the seat moves on the server), a database test through Postgres, protocol round trips and the "clients cannot send an object" test, and 4 mutation entries (a moved chair leaves its seat; moved objects are not saved; a restore forgets them; the fingerprint follows a moved chair).

### Step 2: drawing objects, fast (done)

1. **Instanced, one draw call per part.** `apps/client/src/render/objects.js` builds each kind of object once (`chair-office:0/1`, `chair-wood`, `stool-bar`, `mug`, `notebook:0..3`, `plant-desk`) from the same furniture code as before (`officeChair`, `woodChair`, `barStool`; the small things are placed relative to the desk top, which the object's own `y` supplies), merges its meshes per material, and draws every object of that kind with one `InstancedMesh` per material: **17 draw calls for all 156 objects** (a hundred chairs cost what one does). Shadows are kept exactly as they were (the notebook and the plant's leaves cast none).
2. **Moving costs one matrix.** The page listens for `objectMoved` and writes that object's 4x4 matrix (a scratch matrix, no allocation) and flags the buffer for upload; nothing runs per frame, nothing is created when something moves. `frustumCulled` is off (one bounding sphere would be the whole office) and the buffers are `DynamicDrawUsage`. A full buffer doubles (rare, not per frame).
3. **The chairs and desk items left the baked furniture** (`desks.js`, `stations.js`, `conference.js`, `booths.js`, `dining.js`, `bar.js` keep only the object and seat registrations). Offline and online use the same code, so an object moved by the server (welcome or `object`) is simply redrawn.
4. **Measured** (`npm run perf`, 40 people, software-rendered, so only the changes mean anything). Draw calls: angle 1408 -> 1419, top 1460 -> 1471, third 676 -> 690 (budget: +40); triangles unchanged; geometries +12. A stress run adds **1000** more chairs and stools: still 17 object draw calls (the total rose by about 24, which is what the page varies by between two runs anyway), and **moving 200 of them every frame** costs about 0.7 ms more than not moving them. The frame time rises with 1000 extra chairs only because they add 190,000 triangles, which is what 1000 chairs are.
5. **Same office.** `npm run shots <name>` (`scripts/shots.mjs`, people hidden, eight views) and `node scripts/compare-shots.mjs <before> <after>`: the difference between before and after is the same as between two runs of the old page (the corner plant and wall trim are random on every load, which is not changed here), and the pictures were looked at.
