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
- **First / Third person:** WASD or arrows move, drag to look, Shift runs, `E` sits or stands, `V` swaps first and third person, `C` swaps shoulder (third person), wheel zooms (third person), `Esc` exits.
- **Find someone:** type a name in the search box at the bottom left and pick the match: the camera flies to them and opens their card. `F` toggles fullscreen.

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
