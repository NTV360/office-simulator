# Phase 6: bringing `main` into the multiplayer version, in steps

**Status: in progress.** While this branch was built, `main` kept the old single-app layout (`src/` at the repository root) and gained a lot: a character pack and character lab, real employees from Supabase, shifts and breaks, a Simulate/Live clock, a new desk layout and more. This phase ports **all of it** into the monorepo so that everything on `main` works here, with the server owning it, so that the pull request is useful and coworkers can build on one codebase. As in earlier phases, each step is built and checked before the next.

## What `main` added (the list to port)

| Feature | In `main` | Here it becomes |
|---|---|---|
| Desk layout | `src/config/desks.js`: islands A to H and the HR office, seat ids like `A3`; Desk D grows to 10 seats; the HR office is the old Conference 2; the front wall moved from y 389 to 425 (`FRONT_Y`); glass partitions; the lounge moved; two whiteboards | shared layout data (`office.json` is regenerated), the client furniture builders |
| Time | `sim/schedule.js` (the day runs 06:00 to 06:00, shifts, breaks at the lunch hour, 15:00, 17:00), `sim/live.js` (Simulate or Live clock, attendance) | shared simulation (TypeScript); the **server** owns the clock and its mode |
| Activities | whiteboard discussions, snacks at the desk, "deploying to the toilet" (the bucket run), play only on breaks | shared `tasks.ts`; the bucket is shared state, not a mesh flag |
| Characters | `character/pack/` (chibi and blocky, 50 presets), a new `spec.js`, a new rig, the character lab (`ui/creator.js`) | the pack stays vendored and untouched; shared keeps plain data (no Three.js); the lab edits your account's person |
| Employees | `server/` (Express): `/api/employees`, `/api/attendance`, `/api/characters/:id`, from Supabase | the NestJS server **imports** them from Supabase into local PostgreSQL; looks and desks are saved there |
| People | names, departments (shown as the job title), shift, a chosen desk, the interns | the same, in the shared person |
| UI | a search box that finds and follows anyone, a fullscreen button (`F`), the clock mode buttons | the page, with the clock mode set by the server |
| Removed | Hazel's "Make her angry" (the rage) | removed here too: the `rage` message, its events, the rules and the tests |

## Decisions (Leigh, 2026-10-10)

1. **Follow `main`.** Its desk layout is the layout (the two CTO desks and the cleaner desk are gone: they sit at ordinary desks), and Hazel's rage goes.
2. **Hosting is unchanged:** local Docker with local PostgreSQL. Supabase is only a source to **import from** (read-only, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env`, never in the browser). Without them the office still starts, with made-up staff, exactly as `main` does without its API.
3. **An account is linked to one employee.** An admin links them; logging in takes over that employee's person (name, look, desk, shift). Employees without an account are NPCs on autopilot.
4. **The clock is the server's.** Simulate or Live is one setting for the whole office (the admin changes it), never per browser.

## Steps

| # | Step | Proof |
|---|---|---|
| **1** (**done**) | The layout and the world: plan (front wall, glass walls), the desks from `config/desks.js` (ids `A3`), the HR office, whiteboards, the lounge, the kitchen (snack cabinet, bucket); `office.json` regenerated; the role desks removed | layout and station tests, the full battery, pictures of the new office |
| **2** (**done**) | The simulation: shifts, breaks, the new activities, the bucket as shared state, `person.shift/department/userId`, rage removed everywhere | scenario tests, recordings re-recorded on purpose, mutation checks |
| **3** (**done**) | Characters: the pack vendored, a Three.js-free shared spec, the new rig and animation on the page, specs from older saves repaired | spec tests, a picture of every preset, the body cost in `npm run perf` |
| **4** | Employees on the server: the Supabase import into PostgreSQL, employee list and attendance, accounts linked to employees, the takeover uses the employee's person, Live clock on the server | server and database tests, over a real socket |
| **5** | The page: the character lab (replaces the phase 3 creator), the search box, fullscreen, the clock mode shown from the server, the admin page links accounts | browser checks with two players |
| **6** | Merge `origin/main`, finish the docs, the whole battery, push the branch | everything above green; the branch merges into `main` without conflicts |

Every step runs the checks in [GETTING-STARTED.md](GETTING-STARTED.md#test-before-you-ask-for-a-review) that apply to what it touched.

## Risks

| Risk | Answer |
|---|---|
| The recorded days change | They change on purpose (new layout, new day length, new activities); each re-recording is a decision made in a step, never a side effect |
| Shared code gets Three.js through the character pack | The pack's option lists are dumped once to plain data (a script, like `layout:dump`); the pack itself is never edited |
| The wire format changes (a new prop, new person fields, a removed message) | One `WIRE_VERSION` raise per step that needs it, stated in the step |
| Old saved worlds and accounts | Saved versions stay readable; specs and desks that no longer exist are repaired or dropped, never fatal |
| Supabase is slow or down | The import is a background job with a timeout; the last good import stays; the office never waits for it |

### Step 1: the layout and the world (done)

1. **The plan** (`packages/shared/src/plan.ts`): `FRONT_Y = 425` (the front wall moved out from 389), `GLASS_WALLS` (the partitions around Conference 1, the HR office and Conference 3, split from `WALLS`), the nav grid's walkway outside the doors and `ENTRY` follow it.
2. **The desks** come from `packages/shared/src/layout/desks.ts` (`DESK_ISLANDS`, `deskSeats`, `deskSeat`; the same data as `main`'s `config/desks.js`): islands A to H and the six-desk HR office, **80 desks**, seat ids like `A3`. Each desk spot carries `deskId`, `label` and `department`; its spot id stays `desk:N` in the data's order (so nothing on the wire changes). The role desks (CTO, cleaner, HR as a role) and `stations.js` are gone: Conference 1 is eight meeting seats again.
3. **The world**: the HR office, glass walls, the lounge moved toward the entrance, Conference 3 down to y 329, two whiteboards (three standing spots each, scribbles drawn from the board's number so every browser draws the same), the snack cabinet. `office.json` is regenerated (157 spots, 113 obstacles, 162 objects). The bucket by the counter waits for step 2, where the simulation first uses it.
4. **Tests**: the plan, grid, layout, object and interaction tests carry the new numbers; `layout/desks.test.ts` replaces `stations.test.ts`; two new mutation checks (`desks.ts`); the "a new day forgets to hide people" mutation was found missed (the test's people had all left on their own) and the test now keeps someone on show on purpose. The recorded days were re-recorded (the layout changed them).
5. **Verified**: typecheck, 564 tests, `test:db`, the Docker smoke test, `verify:browser` and `:thorough` against the stack, `e2e`, `e2e:accounts`, `e2e:together`, every mutation caught, `check:docs`; a picture of the whole office.

### Step 2: the simulation (done)

1. **Shared, in TypeScript** (`packages/shared/src/sim/`): `schedule.ts` (the 06:00-to-06:00 day, shifts, the three breaks, `NEVER`), `office-time.ts` (Manila time), `live.ts` (Simulate or Live, attendance), `roster.ts` (the staff list: `Employee`, `simRole`, `jobTitle`), and the changes to `tasks`, `day`, `step`, `meetings`, `factory`, `hazel`. People work during their shift and start games, golf, darts, the music corner and the sofa only on a break (a break also stops desk work, once). New: whiteboard discussions (a presenter and one or two colleagues, from the same moment to the same moment), a snack from the cabinet eaten at the desk, and the toilet run (one bucket, one person at a time, out of the building for a few minutes, back through the front door). Meetings are in Conference 1 and 3 only.
2. **The bucket is shared state, not a mesh flag.** It is the prop `bucket`; the floor bucket in the kitchen is drawn exactly when nobody has it (`updateBucket`, once a frame). A takeover or hand-back puts it down, and the new day always puts it back.
3. **Staff and desks** (`factory.ts`): with a staff list (`roster.list`) each employee is created with their name, title ("UI/UX Department", "Intern HR"), department, shift and desk; without one the staff are made up, as before. The desk they chose is theirs and stays free for them; the HR office is only for the HR department (even if someone asks for a desk in it, and in a swap); the desk is found before anybody is made, so a failed attempt uses no name and no random number; `moveToDesk` tells every viewer. Without a list, made-up staff never sit in the HR office (74 usable desks).
4. **Hazel's rage is gone**: the `rage` message, its event kind, the server's rate limiter, the page's rage effect, her two buttons, and the tests and mutation entries. Her identity (look, `angry` face, last out) stays.
5. **Wire and save**: protocol 10 (`title`, `department`; the `absent` and `toilet` flags in the snapshot; new task names and the `present` pose; one prop more), save version 4 (employee details, shift, toilet run, the clock mode; versions 1 to 3 still load). A person who is not in today, or in and not out yet, has the time `NEVER` (a real number: `Infinity` cannot go on the wire or in a save). Restoring a Live world keeps the sim day.
6. **On the page**: the bucket in hand and on the floor, the run and the presenter poses, the person card ("Deploying to the toilet", "Not in today", the new activities, the title and desk label), the **search box** (replaces "Find her"), the **fullscreen button** (`F`), main's HUD styles.
7. **Found by a read-only review (`claude-alt`) and fixed**: `Infinity` times would have thrown in the wire encoder and made the save unreadable; a takeover could leave the bucket stuck with a human for ever; a shift starting before 06:00 had an end before its start; `absent` never cleared outside Live; a Live restart would send everybody home; a non-HR employee could choose an HR desk; a failed add burned a name; a desk move was not announced; the toilet-run test could not fail (the day roll-over put the bucket back by force). Also found by the tests: the server's change check ignored the new flags, and removing a staff member left them in a running meeting (older bug).
8. **Verified**: typecheck, 613 tests (schedule, live clock and attendance, roster and desks, a whole watched day for the activities, save version 4, protocol 10), every mutation caught (nine new), `test:db`, the Docker smoke test, `verify:browser` and `:thorough` (re-recorded on purpose: the day, the layout and the activities changed), `e2e`, `e2e:accounts`, `e2e:together`. The key-press latency check now takes the best of three presses (one sample in a software-drawn browser was a frame or two slow now and then).

### Step 3: characters (done)

1. **The pack is vendored, untouched** (`apps/client/src/character/pack/`: chibi and blocky, 50 presets). **Shared stays Three.js-free** by a dump: `npm run pack:dump` (`scripts/dump-pack.mjs`) imports the pack in Node and writes its option lists, palettes, accessories and presets to `packages/shared/src/character/pack-data.json`; a test fails if the data and the pack disagree (and one that the dump found the real tables).
2. **`character/spec.ts` is main's spec in TypeScript:** `CharacterSpec` (the pack's config plus `angry`), `normalizeSpec` (anything becomes valid, including a look from before the pack, a pasted config and hostile JSON), `normalizePlayerSpec` (no `angry`), `randomSpec(role, rand?)` (a seeded generator makes the same look every time: an employee without a saved look gets one made from their id), `specOptions`, `presetList`. Hazel's look is data (`HAZEL_LOOK`). `seededRandom` takes a number or a piece of text. The codec makes every spec valid on arrival too.
3. **The page:** main's rig (`character/rig.js`: the pack builds the character, then each joint's meshes are merged, so a person costs about a dozen draw calls), props (mug, phone, pad, putter, bucket, guitar), the pose mapping onto the pack's skeleton (`applyPose`), cameras that take their eye height from the body, labels that sit above the head whatever its height, bodies freed when a person goes (`disposeBody`). **Measured** (`npm run perf`, 40 people): draw calls 1419 -> 1059; triangles 236,000 -> 302,000 (the pack's models are smoother); geometries 601 -> 886.
4. **The character lab** (`ui/creator.js`, from main) replaces the phase 3 creator: presets in both styles, body, hair, clothes, accessories, colours, a share box, the animations. Online you edit **your own** person (the server saves it: `PUT /api/character`; main's "edit any employee" and desk picker are not here: who may change whom is the server's rule, step 4); offline it is kept in the browser. The first login after a desk is given opens it and it cannot be skipped (it has a "Log out" way out if saving keeps failing); it is a modal dialog; Escape closes it wherever the focus is; a save in flight cannot be raced by a close; what is previewed is what is saved (the same validation, at most 8 accessories).
5. **Found by a read-only review (`claude-alt`) and fixed:** an accessory named `constructor` or `toString` passed validation (inherited from Object) and would have been broadcast to every browser; the lab's Randomize drew from the simulation's random stream; held props, the guitar and the furious face were never freed; a roster look was not validated; the offline store could give you Hazel's face; and two tests could not fail.
6. **Older looks:** an account's saved look from before the pack becomes a valid default look (the fields do not map), so existing accounts choose again. The welcome is bigger (about 550 bytes a person, most of it the look; once per join).
7. **Verified:** typecheck, 633 tests, every mutation caught (six new for the spec), `test:db`, browser checks (all 50 designs build to a sensible height and cost; the lab opens on first login, previews each choice, saves, the other browser sees it, cancel changes nothing), the recorded days re-recorded (the random draws of a look changed).
