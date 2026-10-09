# Getting started: run it, change it, test it before a PR

This is the page to read first if you are going to work on the office game. It gets you from a fresh clone to a running multiplayer game on your own PC, and tells you what to run before you ask for a review. For how to *write* a feature so that everyone playing sees the same thing, read [MULTIPLAYER-HOW-TO.md](MULTIPLAYER-HOW-TO.md) next.

## What you need

| | |
|---|---|
| **Node** | 20.19 or newer (22.12 or newer also works). `node --version` |
| **Docker Desktop** | Running (it must say so). The database, and the full stack, live in Docker. You do not install PostgreSQL |
| **git** | Any recent version |
| **A browser** | Chrome or Edge. Open the game in two windows to see yourself from the outside |

The scripts were written and tried on Windows 11 with Docker Desktop. They only use Node and the `docker` command, so Mac and Linux should work, but nobody has run them there yet: tell us what you hit.

## First time

```
git clone https://github.com/NTV360/office-simulator.git
cd office-simulator
npm install
npx playwright install chromium      # the browser the automated browser checks use (once)
```

## Three ways to run it

Pick by what you are changing.

| You are changing | Run | Open |
|---|---|---|
| How something **looks** (furniture, a hairstyle, a HUD button) and it needs no server | `npm run dev` | http://localhost:5173 (a private office on your PC; the page says nothing about a server) |
| Anything **players share** (movement, seats, chat, objects, a new message, the server) | **`npm run dev:online`** | http://localhost:5173/?online |
| You want to see the real thing, the way it runs on the office server | `docker compose up --build` | http://localhost:8080 |

### `npm run dev:online` (this is the one you will use most)

One command starts everything, with fast reloads:

- PostgreSQL in Docker (a container named `office-dev-db`, made the first time and kept, so your accounts survive a restart),
- the server (it restarts when you save a file in `apps/server`; when you save `packages/shared` it rebuilds that first),
- the page (it reloads when you save a file in `apps/client` or `packages/shared`).

It prints a box with the links and the first login. In short:

1. Open **http://localhost:5173/admin**, type the admin password `dev-admin-token`, and make a couple of accounts (one username per line). Give each a desk.
2. Open **http://localhost:5173/?online** and log in as the first one (the first login asks you to choose a new password).
3. Open a **private window** (the login belongs to the browser) at the same address and log in as the second account.
4. You should see each other walk, sit, talk (`Enter`), wave (`1`-`4`) and so on, and everything you try should show up in the other window. That is the whole point: **if it is not in both windows, it is not finished.**

`Ctrl+C` stops the server and the page. The database keeps running; `docker stop office-dev-db` stops it, and `docker rm -f office-dev-db && docker volume rm office-dev-pgdata` wipes every account and the saved office (a clean start).

The passwords it uses (`boss` / `dev-admin-pass`, `dev-admin-token`) are for your own PC only. If port 5433 is taken, run it as `DEV_DB_PORT=5434 npm run dev:online`.

### The Docker stack

`docker compose up --build` builds the same images the office server runs and serves the finished site on http://localhost:8080. It is slower to change (rebuild after each edit) but it is the closest to real, and some checks below need it. Details and troubleshooting: [LOCAL-DOCKER.md](LOCAL-DOCKER.md). To log in you need an admin: start it with

```
ADMIN_USERNAME=boss ADMIN_PASSWORD=a-long-admin-pass ADMIN_TOKEN=local-admin-token docker compose up --build -d
```

(or put those three in a `.env` file, which is never committed).

## Test before you ask for a review

Run what matches what you changed. Each one prints `all checks passed` (or a green summary) or tells you what broke. Do not skip the first row.

| You changed | Run |
|---|---|
| **Anything** | `npm run typecheck`, `npm test` (about 30 seconds) and `npm run check:docs` |
| The server, the database, or what is saved | `npm run test:db` (about 10 seconds; it starts a throwaway PostgreSQL in Docker) |
| The simulation or anything it uses (`packages/shared`) | `npm run check:mutations` (it breaks the code on purpose to prove the tests notice) and `npm run verify:browser` (the recorded days must come out the same, unless you meant to change them) |
| The protocol, a message, the server, or online mode | the Docker stack up (see above), then `npm run smoke`, then `VERIFY_URL=http://localhost:8080 VERIFY_ADMIN_TOKEN=local-admin-token npm run verify:browser` |
| Something that must work **between players** | `npm run e2e:together` (three players walk, sit, talk, wave and see the same office, with a restart and a hard kill). It starts its own copy of the stack. Also `npm run e2e` and `npm run e2e:accounts` if you touched login, saving or takeover |
| Something about **employees**, linking accounts to them or the import | `npm run e2e:employees` (its own stack and a fake records server) |
| How things are **drawn** (furniture, meshes, materials) | `npm run perf` before and after (draw calls must not go up by more than a few), and `npm run shots before` / `npm run shots after` then `node scripts/compare-shots.mjs before after` to prove the office looks the same |

You can point the browser checks at the dev loop instead of Docker: `VERIFY_URL=http://localhost:5173 VERIFY_ADMIN_TOKEN=dev-admin-token npm run verify:browser` while `npm run dev:online` is running. (This works: the recorded days and the online checks pass that way.)

Things that look like failures but are not:

- A browser tab in the background does not draw frames, so a hand test can look frozen. Keep the window visible.
- `verify:browser:thorough` (all ten recorded days) includes timing checks ("first movement after N ms") that can fail when the PC is busy. Run it with nothing else going; if one timing check fails, run it again before worrying.
- After adding or removing files, restart `npm run dev` (a stale dev server serves old modules).

## Opening a PR

1. Branch from `main`: `git switch -c feature/your-name/what-it-does`. Make small commits that each leave it working, with a short message. Do not add AI co-author trailers. Never commit `.env`, `node_modules`, `dist` or `tests/browser/out`.
2. In the PR description say **which kind of change it is** (see [MULTIPLAYER-HOW-TO.md](MULTIPLAYER-HOW-TO.md#1-what-kind-of-feature-is-it)) and **which of the checks above you ran**. If a check does not apply, say why.
3. Tell Leigh the PR is up. There is no automatic check on GitHub yet, so the review is also the first time someone else runs it: the more of the table above you have run, the faster it goes.
4. If the change alters the network protocol (the `WIRE_VERSION` number) or what is saved (the `SAVE_VERSION` number), say so at the top of the PR: it means every browser and the server must be updated together.

## When something does not work

| Symptom | Likely cause |
|---|---|
| `Docker is not running` | Start Docker Desktop and wait until it says it is running |
| The page says it cannot reach the server | `npm run dev:online` is not running, or you opened `http://localhost:5173` without `?online` (that is the private offline office) |
| You log in but sit nowhere / are a guest | An admin has to give the account a desk (admin page) |
| A change to `packages/shared` does not show on the server | Wait a few seconds for the rebuild (a short burst of type errors while it rebuilds is normal and clears itself). If it does not clear, stop and start `npm run dev:online` |
| `port is already allocated` | Something else uses the port. For the database `DEV_DB_PORT=5434`; for the Docker site `WEB_PORT=8081` in `.env` |
| A browser check says it cannot find Chromium | `npx playwright install chromium` |
| Anything about the Docker stack | [LOCAL-DOCKER.md](LOCAL-DOCKER.md#troubleshooting) |
