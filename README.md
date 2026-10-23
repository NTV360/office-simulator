# Office Floor Sim

A 3D office floor simulation (Three.js, built with Vite). Staff follow daily schedules; you can orbit the floor or walk around as your own character in first or third person. It is becoming a multiplayer game; see [docs/MULTIPLAYER-PLAN.md](docs/MULTIPLAYER-PLAN.md).

This is an npm-workspaces monorepo: `apps/client` (the browser app), `apps/server` (NestJS), `packages/shared` (code both use), plus `docker/` for the local stack.

## Start here (new to the project)

Read [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) (set up, run the multiplayer game on your PC, what to test before a PR), then [docs/MULTIPLAYER-HOW-TO.md](docs/MULTIPLAYER-HOW-TO.md) (how to build a feature that every player sees the same). The short version of running it:

## Run it

```
npm install
npm run dev        # the browser app on http://localhost:5173 (a private office, no server)
npm run dev:online # the multiplayer game with fast reloads: database in Docker, the server, the page, and test data (a made-up company, accounts ana/ben/cat/dan, password dev-pass-1234). Open http://localhost:5173/?online
npm run seed       # makes the test accounts again in a running server (safe to repeat; see docs/GETTING-STARTED.md, Test data)
npm run build      # builds shared, client and server
npm test           # unit tests (shared and server)
npm run typecheck
```

## Run the whole stack in Docker

Web (the built client), server and database, as one command. Needs Docker Desktop running.

```
docker compose up --build    # then open http://localhost:16769
npm run smoke                # checks the page, its files, the server, the database and a realtime connection
docker compose down          # stop (the database is kept)
```

In the stack the server runs the office and every browser watches the same one; it is saved and comes back after a restart. `npm run e2e` proves that end to end. Details, the admin API and troubleshooting: [docs/LOCAL-DOCKER.md](docs/LOCAL-DOCKER.md).

## Controls

- **Orbit views:** drag to move, right-drag or Shift-drag to turn and tilt, wheel or pinch to zoom, `H` hides the HUD. Click a person to see what they are doing.
- **First / Third person:** WASD or arrows move, drag to look, Shift runs, `E` sits or stands, `V` swaps first and third person, `C` swaps shoulder (third person), wheel zooms (third person), `Alt` frees the mouse cursor (and takes it back), `Esc` exits.
- **Find someone:** type a name in the search box at the bottom left; pick them to fly to them and open their card. `F` toggles fullscreen. **Edit character** on the card opens the character lab for them.
- **Things (online):** put the cursor (the middle of the screen) on something (it is outlined) and press `G`: you turn to face it and take hold of it where you aim (a big thing someone carries: `G` helps carry it). Holding it, a see-through ghost shows where it would go: `G` puts it down there (green), or lets go of it where it is (red). Hold `R` and move the mouse to turn it in your hands (`Shift`+`R` rolls it), hold `Z` and turn the wheel to raise and lower your hands (the wheel alone still zooms), hold the right button and let go to throw it the way you look: look up to lob it in an arc, level to throw it straight (a dashed line shows where it will fly; turn the wheel while holding it to set how hard; `Esc` calls it off). Add `?netdebug` to the address to see how prediction is doing. `T` puts everything at your desk back. See [docs/ITEMS-PHYSICS-PLAN.md](docs/ITEMS-PHYSICS-PLAN.md).
- **Using things (first or third person):** aim at a TV and press `E` to change its channel (its own picture, a road trip movie, the fight game, the office awards, a cartoon, a drama, off). Aim at a whiteboard and press `E` to draw on it with the mouse (pens, eraser, **Erase board**; `WASD` steps, the wheel zooms, `Esc` when done). Sit at the music corner's keyboard and play it with your keyboard (`A`–`'` white keys, `W E T Y U O P` black keys, `Z`/`X` octave); at the guitar, `1`–`8` strum chords (`Shift` strums up). `Esc` gets you up. At the dartboard, `E` starts darts: you stand on the throw line with the board filling the view, the mouse moves your aim, `Space` or a click throws (three a round, scored like real darts; `Space` again collects them). By the golf ball, `E` starts mini golf: the camera looks down the line from behind the ball and you hold the putter; the mouse or `A`/`D` aims, hold `Space` (or the mouse button) for power and let go to putt. At a TV lounge gaming seat you have the PS5: the view is the TV and you play the fight game (`A`/`D` move, `S` block, `J` punch, `K` kick, `L` uppercut) against the CPU, or **Invite to play** someone from the office, who comes over and plays you. `Esc` leaves any game.
- **Character lab:** edits an employee's character (search them, or use **Edit character** on their card): chibi or blocky style, 50 presets, body, hair, clothes and accessories. Save stores it in `character_information`.
- **Hours:** people work through their shift (meetings, whiteboards, booth calls, coffee and snacks) and play only at lunch, 15:00 and 17:00. The clock runs a full day, 06:00 to 06:00.
- **Desks:** Desk A–H and the HR Office; pick an employee's desk on the seat map in the character lab.
- **Clock:** **Simulate** (the default) runs the office's own faster clock (pause, 1×/3×/8×) for every employee on their shift, starting the **Day** or the **Night**; **Live** follows the actual time in Manila, and who is in comes from the attendances table.
- **Chat:** "Chat" in the dock opens the office chat. Pick a display name once, then talk to everyone who has the app open (the last 50 messages are kept until the server restarts).
- **Take control** (Simulate): on someone's card. You walk as them in third person (`V` for first person); `Esc` lets go and they get on with their day.
- **Power Slap:** an argument over code at a desk or a whiteboard can end in a Power Slap at a dining table. Challenge someone with **Power Slap** on their card (or `P` while walking, looking at them): in Simulate you pick who takes them on, and you control that person. On your turn stop the power meter (`Space`): past the KO mark a slap can knock them down, otherwise they see birds. **Control …** on the fight card takes over a fight in the office. Online: pick who you are under **Power Slap** in the dock; anyone else online can challenge you, and everyone online sees the fight.

## Documentation

Start with [`docs/`](docs/README.md). It sets the standard for how this codebase is organised and changed.

| | |
|---|---|
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | set up, run it, test it before a PR |
| [docs/MULTIPLAYER-HOW-TO.md](docs/MULTIPLAYER-HOW-TO.md) | build a feature that works for every player: what is client-only, shared or server-owned, and the rules that keep every screen the same |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | repository layout, layers, folder map, startup order, state ownership |
| [docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md) | rules for new code and the checklist before you push |
| [docs/HOW-TO.md](docs/HOW-TO.md) | recipes: furniture, activities, camera views, looks, HUD controls |
| [docs/LOCAL-DOCKER.md](docs/LOCAL-DOCKER.md) | the local Docker stack |
| [docs/MULTIPLAYER-PLAN.md](docs/MULTIPLAYER-PLAN.md) | the plan for accounts, a shared persistent world, voice, and hosting |
| [docs/MIGRATION.md](docs/MIGRATION.md) | moving work from the old single `index.html`, or from `main`'s `src/` layout |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | running the office on a PC: start, stop, back up, restore, update, what to do when something is wrong |
| [docs/LOAD-TEST.md](docs/LOAD-TEST.md) | how many players the server carries (`npm run bots`) and the measured results |
| [docs/SUPABASE.md](docs/SUPABASE.md) | the employee records the server imports, and the grants it needs |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | serving the current demo as a static site (Render notes, not the plan) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | planned features and follow-ups |

## At a glance

`apps/client/index.html` is markup only. `apps/client/src/bootstrap.js` is the one place the scene is assembled: each module exports a `build*()` or `init*()` function and bootstrap calls them in order; modules do nothing when imported. `apps/client/src/main.js` runs the frame loop. The client code lives in `render/ world/ nav/ character/ people/ sim/ player/ camera/ fp/ ui/ styles/`; see the folder map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#folder-map-appsclientsrc).
