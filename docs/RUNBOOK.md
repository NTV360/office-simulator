# Runbook: running the office on a PC

For whoever looks after the machine that hosts the game (see [LOCAL-DOCKER.md](LOCAL-DOCKER.md) for what the stack is, [PHASE-8-BREAKDOWN.md](PHASE-8-BREAKDOWN.md) for what has been measured). Everything here is a command you can paste in a terminal in the repository folder. Nothing in this page needs the internet except pulling the images the first time.

## The three containers

| Container | What it is | If it is down |
|---|---|---|
| `web` | Caddy: serves the page and forwards `/api` and `/socket.io` to the server | Nobody can open the page |
| `server` | The office: the simulation, accounts, the admin API, the realtime connection | The page loads and says it cannot reach the server; nobody can play |
| `db` | PostgreSQL: accounts, sessions, the staff list, the saved world, the audit log | The server stays up but cannot log anyone in; it keeps the world in memory |

## Starting, stopping, looking

```
docker compose up -d                  # start everything (build first with --build after a code change)
docker compose ps                     # who is running and healthy
docker compose logs -f server         # the server's log (Ctrl+C leaves it running)
docker compose stop                   # stop; the database is kept
docker compose down                   # remove the containers (the data volume "pgdata" is kept)
docker compose down -v                # remove the containers AND the data: a clean slate. Back up first.
curl http://localhost:8080/api/health # {"status":"ok","db":"ok",...}
curl http://localhost:8080/api/world  # the clock, the number of people, the tick timings, the process memory
```

The server restarts by itself (`restart: unless-stopped`) and saves the world every 10 seconds and when it is stopped politely (`docker compose stop`/`restart`). A crash or a power cut loses at most the last few seconds.

## Settings (the `.env` file next to `docker-compose.yml`; never commit it)

See `.env.example` for every setting. The ones you will use: `ADMIN_USERNAME` / `ADMIN_PASSWORD` (the first admin account, made once), `ADMIN_TOKEN` (the admin page and API password), `WEB_PORT` (default 8080), `GRACE_MS` (how long a dropped connection keeps its person), `SUPABASE_URL` / `SUPABASE_SECRET_KEY` (the employee records, [SUPABASE.md](SUPABASE.md)), `POSTGRES_PASSWORD` (change it from the default on anything shared). After changing it: `docker compose up -d` (it recreates what changed).

## Backups

```
npm run backup                         # backups/office-<date>-<time>.sql (everything in the database)
npm run backup -- --keep=14            # and keep only the newest 14
npm run backup:rehearse                # PROVE it restores: dumps the running database into a throwaway PostgreSQL and compares
npm run restore -- backups/office-....sql --yes   # REPLACE the database with a backup (stops the server, restores, starts it)
```

What is in a backup: accounts (names, password hashes, desks, links to employees, looks), sessions, the audit log, the staff list, and the saved office (who is where, the clock, which chairs were moved). What is not: the code (git), the `.env` (keep a copy somewhere safe), the made-up test accounts' passwords (they are only on your PC).

**Take a backup:** before every update, and on a schedule if people depend on it. On Windows, Task Scheduler runs `npm run backup -- --keep=14` in the repository folder every night; on Linux a `cron` line does the same. **Rehearse a restore** now and then (`npm run backup:rehearse`): a backup nobody has restored is a hope, not a backup. Keep copies of `backups/` on another disk or machine.

**Restoring:** `npm run restore -- backups/<file>.sql --yes`. People whose session is newer than the backup log in again. The server needs a few seconds to come back; `docker compose logs server` says "restored from the database" when it has.

## Updating to a new version

```
npm run backup                        # first
git pull                              # (or switch to the branch you were told to)
docker compose up --build -d          # rebuilds the images, runs the new database migrations by itself, restarts
curl http://localhost:8080/api/health # check it
npm run smoke                         # the page, its files, the server, the database, a realtime connection
```

If a change says it changes the protocol (`WIRE_VERSION`), every open browser must reload: the server refuses the old version (the reason is shown on the page: reload it). If it goes wrong, `git checkout` the previous version, `docker compose up --build -d`, and if the data is damaged restore the backup.

## Admin tasks

The admin page is `http://<the PC's address>:8080/admin` (password: `ADMIN_TOKEN`). **Accounts:** make them (one name per line), set or reset a password (shown once), disable, mute, give or take a desk. **Staff:** link an account to an employee, choose an employee's desk, import the records now, see how the last import went. **The office:** how many people, the clock mode and speed. **Things players moved:** put one thing or everything back. **Recent activity:** what admins did. Everything an admin does is in the audit log.

If an admin password is lost: change `ADMIN_TOKEN` in `.env` and `docker compose up -d`; a lost `ADMIN_PASSWORD` account can be reset from the admin page with the token.

## When something is wrong

| What you see | What to do |
|---|---|
| The page does not open | `docker compose ps`. `web` down: `docker compose up -d web`. Port taken: set `WEB_PORT` in `.env`. Docker not running: start Docker Desktop |
| The page opens but says it cannot reach the server | `docker compose logs --tail=50 server`. A start-up error (database, migration) is at the top. `docker compose restart server` |
| Everyone is logged out and the log says the database is unreachable | `docker compose ps db`; `docker compose logs db`. Starting it again keeps the data. If the volume is damaged: restore the latest backup |
| The office looks wrong after a restart (everyone in odd places) | The saved world could not be restored: the log says why ("the saved world cannot be restored: ..."). The server then starts a fresh office and **stops saving** so the damaged save is not overwritten. Look at it, then `RESET_WORLD=true docker compose up -d server` once to replace it |
| Laggy for everyone | `curl .../api/world`: `tickMs.p99Ms` above 10 or `process.eventLoopP99Ms` above 20 means the server is struggling (see [LOAD-TEST.md](LOAD-TEST.md)). Close other heavy programs on the PC; fewer than about 100 players is comfortable on Docker Desktop |
| Memory keeps growing | `process.rssMb` over a day. It should settle (the one-hour soak is in PHASE-8). Restart the server to clear it, and tell the developers with the log |
| One person cannot log in | Admin page: is the account disabled, or must it choose a new password? Reset it. Too many wrong tries wait 15 minutes by themselves |
| Too many logins from one address (many people behind one office router) | A limit of 30 logins a minute per address protects the accounts. Raise it only if it really bites: `AUTH_LOGINS_PER_MINUTE=100` in `.env` |

## Ports and the firewall

Only the `web` container's port (8080 by default) needs to be reachable by players. The database and the server are not published to the network (the compose file keeps them inside). On Windows, allow Docker Desktop through the firewall for the private network if other PCs cannot connect. Voice (not built) and HTTPS (needed for the microphone, and only when the page is not on `localhost`) are planned in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md) sections 12 and 13.
