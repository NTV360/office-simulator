# Running the stack locally with Docker

One command starts the whole thing on your PC: the web container (the built client, served by Caddy), the server (NestJS) and the database (PostgreSQL). The same compose file is what will later run on EC2.

## Requirements

- **Docker Desktop** (Windows or Mac) or Docker Engine with the compose plugin (Linux). On Windows, make sure Docker Desktop is **running** before you start.
- Nothing else. You do not need Node installed to run the stack (you do to develop).

## Start, stop, reset

```
docker compose up --build          # build and start (add -d to run in the background)
npm run smoke                      # check it works (needs Node)
docker compose logs -f server      # watch the server's log (also: web, db)
docker compose down                # stop and remove the containers; the database is KEPT
docker compose down -v             # stop AND DELETE the database volume (a full reset)
```

Open **http://localhost:8080**. Change the port by putting `WEB_PORT=9000` in a `.env` file (copy `.env.example` to `.env`; `.env` is never committed).

## What is in the stack

| Service | Image | Notes |
|---|---|---|
| `web` | built from `docker/web.Dockerfile` (Caddy) | Serves the built client. Forwards `/api` and `/socket.io` to `server`. The only port published to your PC (8080) |
| `server` | built from `docker/server.Dockerfile` (Node 22) | Runs as a non-root user. `GET /api/health` reports the server and the database |
| `db` | `postgres:16-alpine` | Data in the named volume `office-sim_pgdata`. Not published to your PC |

Start order is enforced by health checks: the database must be healthy before the server starts, and the server before the web container.

## What the stack does now

- `server` runs the office simulation (the same code as the browser, in `packages/shared`) at 20 ticks a second, restores it from the database at start-up, saves it every 10 seconds and when it stops, and streams it to every browser. `GET /api/world` shows the clock, who is in, tick times and the saving status.
- The `web` image is built with `VITE_ONLINE=1`, so the page is a **viewer** of the server's office: every browser sees the same people. Open the page with `?offline` to run a private copy instead.
- Staff count, clock speed and pause belong to the server. An admin changes them through `/api/admin/*` with the `ADMIN_TOKEN` from `.env` (leave it empty and the admin API does not exist):

```
curl -X PUT http://localhost:8080/api/admin/settings -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"slots": 30, "speed": 3}'
curl -X POST http://localhost:8080/api/admin/announce -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"text": "Pizza in the pantry"}'
```

- Accounts: put `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` and the first start creates that admin (change the password after the first login). `SIGNUP_CODE` makes registering need a code. Accounts, sessions and the audit log are in the same database. Passwords are stored only as argon2id hashes.
- The saved world lives in the database (`world_state`). `docker compose restart server` brings the same office back. To start over with a fresh office, set `RESET_WORLD=true` for one start (or `docker compose down -v` to wipe the database).

## Defaults and secrets

The compose file has development defaults (database user `office`, password `office_dev_password`). They are fine on your own PC. **For anything other people can reach, copy `.env.example` to `.env` and set a real `POSTGRES_PASSWORD`.**

## Looking inside

```
docker compose ps                                        # state and health of each service
docker compose exec db psql -U office -d office          # a SQL prompt (the db port is not exposed)
docker compose exec server sh                            # a shell in the server container
curl http://localhost:8080/api/health                    # {"status":"ok","db":"ok",...}
```

## What the smoke test checks

`npm run smoke` (`scripts/smoke.mjs`) asks the running stack for the page, each of its script and style files, and `/api/health`, and fails (exit code 1) if the page is missing, a file 404s, or the server reports that the database is down. Point it somewhere else with `SMOKE_URL=http://host:port npm run smoke`.

For a deeper check of the containerised site, run the simulation recordings against it: `VERIFY_URL=http://localhost:8080 npm run verify:browser`. It must pass exactly as it does against the local build (see [PHASE-1-BREAKDOWN.md](PHASE-1-BREAKDOWN.md#3-step-0-the-safety-net-before-any-refactor)).

## Checking the whole thing

```
npm run smoke        # page, files, health, the running world, a realtime connection through the proxy
npm run test:db      # database tests against a throwaway PostgreSQL (needs Docker)
npm run e2e          # its OWN copy of the stack: two browsers, an admin change, a restart, a hard kill
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `error during connect` or "the docker daemon is not running" | Start Docker Desktop and wait until it says it is running |
| `port is already allocated` on 8080 | Something else uses 8080. Set `WEB_PORT=8081` in `.env` and start again |
| The page loads but the smoke test says the database is unreachable | The database is still starting, or its password changed after the volume was created. Postgres only reads `POSTGRES_PASSWORD` the first time the volume is created. Either put the old password back, or reset with `docker compose down -v` (this deletes the data) |
| A change to client code does not show up | The web container serves a **built** copy. Rebuild with `docker compose up --build`. For fast edits use `npm run dev` (http://localhost:5173) instead |
| Build fails on `npm ci` with a lockfile error | The lockfile and `package.json` disagree. Run `npm install` at the repository root and commit `package-lock.json` |
| The web image fails to build with "not found" (for example `Tsconfig not found /app/tsconfig.base.json`) | The web image copies only what `docker/web.Dockerfile` lists. When the client starts reading a new folder or config file (as it now does with `packages/shared` and `tsconfig.base.json`), add a `COPY` line for it |
| Scripts or the Caddyfile behave oddly after a Windows checkout | Line endings. `.gitattributes` forces LF; re-clone or run `git add --renormalize .` |

## Notes for later phases

- Voice and HTTPS for other computers on the network arrive in later phases; today it is plain HTTP on your own PC (where `localhost` already counts as a secure page for browsers).
- Moving to EC2 is the same compose file on an Ubuntu machine with a domain name. See [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#13-hosting-local-docker-first-ec2-later).
