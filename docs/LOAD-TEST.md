# Load test: how many players the server carries

`npm run bots` plays with many bots at once and tells you whether the server stays inside the budgets of [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#14-performance-budget-and-load-testing). Run it before and after a change that touches the tick, the protocol or what is sent.

```
# the stack must be up, and started with a higher login limit (the bots log in many times from one address):
AUTH_LOGINS_PER_MINUTE=1000 ADMIN_TOKEN=local-admin-token ADMIN_USERNAME=boss ADMIN_PASSWORD=a-long-admin-pass docker compose up --build -d
npm run bots -- --bots=100 --seconds=60              # one run against http://localhost:16769
npm run bots -- --bots=60 --seconds=3600 --soak      # a soak: memory and tick time every minute
npm run bots -- --url=http://localhost:3000 ...      # a server run outside Docker (apps/server, with the dev database)
```

Options: `--url`, `--token` (the admin password; default `local-admin-token`), `--bots`, `--seconds`, `--soak`. Exit code 1 if a budget is missed. The bots make their own accounts (`bot<run>_000`...), which stay in the database (disable or delete them on the admin page, or `docker compose down -v` for a clean slate).

## What a bot does

It is a client at the protocol level, sending what the page sends: it logs in (an admin makes its account, it chooses its password), asks for a ticket, says hello, then every 50 ms sends an `input` (a wandering walk; one bot in five stands still at a time, one in three runs), and now and then talks, waves, sits or stands, tries to pick up a thing (almost always refused: too far, which exercises the refusal path) and tries to put one back. Every 2 seconds it pings. It measures: the time from sending an input to hearing the server's `ack` for it, the ping round trip, the bytes it receives, how many snapshots arrive, and whether it was ever kicked or sent something it could not decode.

## The budgets and what the server says about itself

| Measure | Budget (100 players plus the AI people) | Where it is read |
|---|---|---|
| Input to acknowledgement (p99) | under 150 ms | the bots |
| Bandwidth per client | under 40 KB/s | the bots (bytes received) |
| Server tick (p99) | under 10 ms of the 50 ms | `GET /api/world` `tickMs.p99Ms` (also `p50Ms`, `maxMs`, `lateTicks`) |
| Event-loop lag (p99) | under 20 ms | `GET /api/world` `process.eventLoopP99Ms` (since the window was last emptied by `GET /api/world?fresh=1`, which `npm run bots` does just before it starts playing; plain reads do not empty it) |
| Memory | no growth over a long run | `process.rssMb`, `process.heapMb`; `--soak` prints it every minute |
| Nobody kicked, nothing undecodable | zero | the bots |

You can watch the same numbers on a live server: `curl http://localhost:16769/api/world`.

## What was measured (2026-10-10, this development PC: 16 logical processors, Windows 11, Docker Desktop with WSL2; the bots ran on the same PC)

**On the server run outside Docker** (`node apps/server/dist/main.js`, the dev database):

| Bots | Ack p99 | Bandwidth per bot | Tick p50 / p99 | Event loop p99 | Verdict |
|---|---|---|---|---|---|
| 100 | 67 ms | 26.0 KB/s | 3.0 / 5.1 ms | 14.6 ms | **all budgets met** |
| 150 | 69 ms | 40.8 KB/s | 4.4 / 7.2 ms | 19.0 ms | all but bandwidth, by 0.8 KB/s |

**In the Docker stack** (Caddy in front, the server in a container; Docker Desktop's virtual machine in between):

| Bots | Ack p99 | Bandwidth per bot | Tick p50 / p99 | Event loop p99 | Verdict |
|---|---|---|---|---|---|
| 50 | 98 ms | 31.8 KB/s (before the short move records, below) | 3.1 / 7.3 ms | 15.3 ms | all budgets met |
| 100 | 108 ms | 25.7 KB/s | 6.0 / 16.4 ms | 31.4 ms | bandwidth and ack fine; tick and event loop over |
| 150 | 116 ms | 38.7 KB/s | 9.9 / 21.8 ms | 55.2 ms | bandwidth and ack fine; tick and event loop over |
| 60 for 25 minutes | 104 ms | 14.7 KB/s | 4.1 / 8.2 ms | 16.1 ms | **all budgets met, memory flat (140 MB, -1.5 MB over the run)** |

**Reading it:** the same server code is about **1.7 times slower inside Docker Desktop's virtual machine** (every message to a client is a write through the VM's virtual network), and slower again behind Caddy. So **on this PC and in Docker, about 60 to 80 players are comfortable and 100 is at the edge**; run outside Docker the same code carries 100 within every budget and 150 with a whisker over on bandwidth. A Linux host (the EC2 trial in the plan) should look like the first table. **The budgets for 100 players in Docker on a Windows PC are therefore not all met** (tick p99 16 ms against 10, event loop 31 ms against 20): this is stated plainly rather than tuned away. Things tried that did **not** help: telling players where they are every second tick instead of every tick, sending the world 10 times a second instead of 20 (bandwidth fell, the tick did not), a keyframe once every 20 seconds, the Debian image instead of Alpine. What could help if 100 players on this setup ever matters: a Linux host; fewer snapshots to far-away players (interest management: a per-region message, which costs per-client encoding); or moving the sending off the simulation's thread.

## What the load test found, and fixed

1. **Bandwidth grew with the square of the players.** 100 players cost each of them **59.8 KB/s** and 150 cost **93.2 KB/s** (budget 40): a whole person record (about 46 bytes) was sent 20 times a second for every walking player to everybody. Somebody who only walked is now sent as a **14-byte move record** (id, where, which way, stride; protocol 15); any other change is still a whole record, and a keyframe is all whole records. 100 players: **25.7 KB/s**; 150: **38.7 KB/s**.
2. **The server's own numbers were too coarse to judge a budget:** only the last 100 ticks' average and maximum. `/api/world` now says the median and the 99th percentile of the last 2000 ticks, the memory, and the event-loop lag (`?fresh=1` empties that window).
3. **One address could not log 20 bots in:** 30 logins a minute per address is a sensible protection, so a load test needs `AUTH_LOGINS_PER_MINUTE` raised (an environment setting; the default is unchanged).
4. **The final save on a polite stop never worked** (found while testing the restart in `e2e:objects`, not by the bots): see [PHASE-5-BREAKDOWN.md](PHASE-5-BREAKDOWN.md), step 5.

## A soak

The 25-minute run above is the soak that was done here. The plan asks for an hour: `npm run bots -- --bots=60 --seconds=3600 --soak` (it prints the memory every minute and how much it grew). Run that overnight on the host before a big event.
