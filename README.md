# Office Floor Sim

A 3D office floor simulation (Three.js, built with Vite). Staff follow daily schedules; you can orbit the floor or walk around as your own character in first or third person. It is becoming a multiplayer game; see [docs/MULTIPLAYER-PLAN.md](docs/MULTIPLAYER-PLAN.md).

This is an npm-workspaces monorepo: `apps/client` (the browser app), `apps/server` (NestJS), `packages/shared` (code both use), plus `docker/` for the local stack.

## Run it

```
npm install
npm run dev        # the browser app on http://localhost:5173
npm run build      # builds shared, client and server
npm test           # unit tests (shared and server)
npm run typecheck
```

## Run the whole stack in Docker

Web (the built client), server and database, as one command. Needs Docker Desktop running.

```
docker compose up --build    # then open http://localhost:8080
npm run smoke                # checks the page, its files, the server, the database and a realtime connection
docker compose down          # stop (the database is kept)
```

In the stack the server runs the office and every browser watches the same one; it is saved and comes back after a restart. `npm run e2e` proves that end to end. Details, the admin API and troubleshooting: [docs/LOCAL-DOCKER.md](docs/LOCAL-DOCKER.md).

## Controls

- **Orbit views:** drag to move, right-drag or Shift-drag to turn and tilt, wheel or pinch to zoom, `H` hides the HUD. Click a person to see what they are doing.
- **First / Third person:** WASD or arrows move, drag to look, Shift runs, `E` sits or stands, `V` swaps first and third person, `C` swaps shoulder (third person), wheel zooms (third person), `Esc` exits.
- **Hazel:** "Find her" follows her; "Make her angry" does what it says.

## Documentation

Start with [`docs/`](docs/README.md). It sets the standard for how this codebase is organised and changed.

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | repository layout, layers, folder map, startup order, state ownership |
| [docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md) | rules for new code and the checklist before you push |
| [docs/HOW-TO.md](docs/HOW-TO.md) | recipes: furniture, activities, camera views, looks, HUD controls |
| [docs/LOCAL-DOCKER.md](docs/LOCAL-DOCKER.md) | the local Docker stack |
| [docs/MULTIPLAYER-PLAN.md](docs/MULTIPLAYER-PLAN.md) | the plan for accounts, a shared persistent world, voice, and hosting |
| [docs/MIGRATION.md](docs/MIGRATION.md) | moving work from the old single `index.html` |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | serving the current demo as a static site (Render notes, not the plan) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | planned features and follow-ups |

## At a glance

`apps/client/index.html` is markup only. `apps/client/src/bootstrap.js` is the one place the scene is assembled: each module exports a `build*()` or `init*()` function and bootstrap calls them in order; modules do nothing when imported. `apps/client/src/main.js` runs the frame loop. The client code lives in `render/ world/ nav/ character/ people/ sim/ player/ camera/ fp/ ui/ styles/`; see the folder map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#folder-map-appsclientsrc).
