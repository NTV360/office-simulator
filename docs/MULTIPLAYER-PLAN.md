# Multiplayer plan

**Status: proposal, for review. Nothing in this document is built yet.** It turns "accounts, login, realtime with other people, about 100 at once" into a design, a repository layout, a deployment, and a phased plan with acceptance criteria. Decisions that still need an answer are collected in [section 17](#17-open-questions).

## 1. Goals

From the requirements so far:

1. People create an **account with a username and password**, log in, and control **their own character**.
2. About **100 people playing at the same time**, in realtime, with other real people.
3. **What one person sees and hears, everyone else sees and hears.** One shared world, not 100 private copies.
4. **The server runs the NPCs.** They are the same for everybody.
5. The number of NPCs is **controllable** (a setting, not a slider each player owns).
6. Runs in **Docker**, on a developer's PC (to test, or to host a local session) **and** on an **EC2** instance.
7. **No lag.** Movement must feel responsive; the server must not stall under load.
8. Written down **before** it is built. The current app is a demo of the whole floor; real gameplay interactions are not designed yet (see [section 16](#16-first-gameplay-interactions-proposal)).

**Non-goals for now:** voice chat (separate project, see [section 17](#17-open-questions)), more than one office or instance, mobile app, anti-cheat beyond server-side validation.

## 2. What today's code tells us

These facts, taken from the current code, shape the design.

| Fact | Consequence |
|---|---|
| The whole simulation runs in each browser, with its own clock and `Math.random` | Two players would see different worlds. The sim must move to one place: the server |
| One simulated day (07:45 to 19:10, 685 sim-minutes) at `CLOCK = 0.4` sim-minutes per second takes **~28.5 real minutes** at 1× | The server owns the clock. **Pause and Speed (1×/3×/8×) are global**, so they become admin-only, not per-player controls |
| 70 desks; the staff slider runs 8 to 70; NPCs are seated at desks | NPC count is bounded by desks (70) today. The new NPC setting is clamped to that until NPCs without desks are designed |
| NPCs walk at 1.15 to 1.45 m/s; the player walks at 1.5 m/s and runs at 3 m/s | The server can check a player's speed against these numbers |
| The floor is about 23 m by 42 m | Everyone can see everyone, so **no interest management** is needed in v1: broadcast to all |
| The sim reaches into meshes: tasks and day setup set `p.body.mug.visible` and similar; `sim/state.js`, `sim/tasks.js` and `config/plan.js` import Three.js | The sim cannot run on a Node server yet. **Splitting it from rendering is the biggest piece of work** (section 9) |
| About 15 uses of `Math.random` in `sim/`, one `performance.now` (Hazel's rage timer) | Server code uses a seeded random source and the sim clock, which also makes it testable |
| Furniture builders create meshes **and** register obstacles and spots in one pass | The server needs obstacles, walls and spots as plain data. Section 9 covers how we get them |
| Hazel's rage, the lounge fighting game and "heard" events are client-side effects | They become **shared events** the server starts and every client plays |

## 3. Architecture

```
  Browser clients (up to ~100)
     |  HTTPS  (page, REST: register / login / character)
     |  WSS    (realtime game traffic)
     v
  +-----------------------------------------------------------+
  |  Reverse proxy (Caddy): TLS, serves the built client,     |
  |  routes /api/* and /ws                                    |
  +-----------------------------------------------------------+
        |  /api/*                         |  /ws
        v                                 v
  +--------------+   signed ticket   +----------------------------+
  |  api         | ----------------> |  game                      |
  |  NestJS      |   (HMAC, 30 s)    |  Node + ws, no framework   |
  |  accounts,   |                   |  on the hot path           |
  |  login,      |   admin commands  |  authoritative sim,        |
  |  characters, | ----------------> |  fixed tick, snapshots,    |
  |  admin REST  |   (internal net)  |  chat, shared events       |
  +--------------+                   +----------------------------+
        |
        v
  +--------------+
  |  Postgres    |   accounts, characters (spec JSON), later: items, money
  +--------------+
```

Two server processes, one codebase:

- **`api`** is a NestJS app. It handles everything that is request/response and not time-critical: sign-up, login, password hashing, saving the character, admin settings.
- **`game`** is a small Node process with a WebSocket server and the authoritative simulation. It does **no** database or password work on the hot path.

Why two processes: password hashing is deliberately CPU-heavy. If a burst of logins shared a process with the game loop, the loop would stutter and everyone would feel lag. Separate processes (separate containers) make that impossible. The game server never calls the API while running; it trusts a short-lived **signed ticket** issued by the API (section 7).

## 4. Technology choices

| Choice | Decision | Why, and what we rejected |
|---|---|---|
| Language | **TypeScript on Node.js** for `shared`, `api` and `game` | Same language as the client, so the simulation code is literally shared. The client stays JavaScript for now and imports from `shared` (Vite handles TypeScript); it can migrate later |
| API framework | **NestJS** | Good fit for accounts and REST: modules, validation, guards, config, testing. Not used for the game loop (below) |
| Game server | **Plain Node + `ws`**, binary messages | Lowest overhead on the part that must not lag. NestJS adds layers (dependency injection, interceptors) that are fine per request but wasteful per frame |
| Realtime transport | **WebSocket (`ws`)**, binary | Works through proxies and browsers everywhere. Rejected Socket.IO (extra framing, JSON by default, heavier per message) |
| Alternative considered | **Colyseus** (a game-server framework with rooms and automatic state sync) | It would save work on state sync and rooms. We prefer a small custom protocol because the world is one room, the state is simple, and we want the sim shared with the client. Revisit if we ever need many rooms |
| Database | **PostgreSQL** | Accounts, characters, later inventory and money. Relational, boring, reliable |
| DB access | **Prisma** (or TypeORM) | Typed queries and migrations. Either works with Nest |
| Passwords | **argon2id** | Modern, memory-hard. bcrypt is acceptable if argon2 is a problem to install |
| Reverse proxy | **Caddy** | Automatic HTTPS on EC2, one config file, serves the static client. Same origin for page, API and WebSocket means no CORS or cross-site cookie problems |
| Packaging | **Docker** and **docker-compose** | One command locally, the same images on EC2 |
| Repo layout | **npm workspaces** monorepo | One repo, shared code without publishing packages |

## 5. The game server

### 5.1 Authority

The server is the single source of truth.

| Owned by the server | Owned by the client |
|---|---|
| The clock, day cycle, pause and speed | Rendering, camera, lighting from `sim.t` |
| Every NPC: schedule, task, position, path | Choosing which part of the world to look at |
| Every player's accepted position, seat and state | Predicting the local player's own movement (see 5.3) |
| Who occupies each spot (seats, piano, darts, ...) | Animation poses (derived from the state the server sends) |
| Meetings, events such as Hazel's rage | Camera shake and visual effects |
| Chat | |

### 5.2 The tick

- A fixed loop at **20 Hz** (50 ms), drift-corrected (compensates for late timers), never `setInterval` alone.
- Each tick: apply queued player inputs, step the simulation, build one snapshot, send it to everyone.
- NPC state is sent every second tick (**10 Hz**); players are sent every tick (**20 Hz**).
- The tick time is measured and logged. It is the key health number (target in section 12).

### 5.3 Player movement

- The client sends **inputs** (a move vector, heading, run flag, with a sequence number), not positions.
- The client moves its own character immediately (**prediction**) so controls feel instant.
- The server runs the same movement code (`stepPlayer`, moved into `shared`) against the same collision data, then reports the accepted position with the last input number it handled. If the client's prediction differs, it corrects smoothly (**reconciliation**).
- Other people are drawn about **100 to 150 ms in the past**, interpolated between the last two snapshots, so their movement looks smooth despite network jitter.
- Speed is capped on the server (walk 1.5 m/s, run 3 m/s plus a small tolerance). Walls and furniture are enforced by the same collision grid.

### 5.4 Interactions and shared state

- Sitting, standing and using spots are **requests** the server accepts or refuses (is the spot free? is the player close enough?). Occupancy is one list on the server, so two people can never sit in the same chair, and an NPC and a player contest the same spots fairly.
- NPCs react to players: players are added to the NPCs' avoidance, and NPC chat or meetings can later target players.
- **Pause, speed and the day clock** are server state, changed only by an admin.

### 5.5 Shared events (what one sees, everyone sees)

Anything that is an event in the world is created on the server and broadcast with a start time, so every client plays the same thing at the same moment:

- Hazel's rage: started by a request, runs for 10 s of **server** time, with a cooldown so it cannot be spammed.
- The lounge fighting game: shown when the server says someone is playing, driven by shared time.
- Chat and announcements ("Day 2 begins").
- Joins and leaves.

### 5.6 Chat ("heard")

"Heard" is taken to mean **text chat first**:

- **Local chat**: heard by people within a radius (about 10 m), shown as a bubble over the speaker and in a chat panel.
- **Global channel** for announcements and admin messages.
- Server-side: length limit, rate limit, basic sanitising, mute and ban hooks.

Voice is a different project: 100 people cannot be a peer-to-peer mesh; it needs a media server (an SFU such as LiveKit). It is listed in [section 17](#17-open-questions).

### 5.7 Controlling the number of NPCs

The NPC count is **server configuration**, not a per-player setting.

| Setting | Meaning |
|---|---|
| `NPC_COUNT` | How many NPCs to run. Default 40. Clamped to `0` through the number of desks (70 today) |
| `NPC_MODE=fixed` | Always exactly `NPC_COUNT` |
| `NPC_MODE=fill` (optional) | Keep **total** population near a target: as players join, NPCs leave, and the reverse. `NPC_TARGET_POPULATION` sets the target |

- Set at startup from the environment, and **changeable while running** by an admin (`PUT /api/admin/npcs`, then forwarded to the game server over the internal network). Increases spawn NPCs arriving at the entrance; decreases let NPCs finish what they are doing and walk out, so nobody vanishes mid-stride.
- The client's "People" slider and the Pause/Speed buttons are removed for players and shown only to admins.
- If we ever want more than 70 NPCs, NPCs without a personal desk must be designed first. That is a gameplay change, not a server change.

## 6. Network protocol

Binary WebSocket frames. A one-byte message type, then a compact body. A shared `protocol` module defines both encode and decode so client and server cannot disagree.

**Client to server**

| Message | Contents |
|---|---|
| `input` | sequence number, move x/z, heading, run flag (about 20 per second) |
| `act` | sit, stand, or use a spot (spot id) |
| `chat` | text (length-limited) |
| `emote` | emote id |
| `ping` | timestamp, for latency measurement |

**Server to client**

| Message | Contents |
|---|---|
| `welcome` | your id, world version, config (tick rate, NPC count), sim time, your character spec, the current full state |
| `snapshot` | tick, sim time, then one record per **changed** entity: id, x, z (quantised to 16 bits), heading, anim/state id, spot id, flags (props shown, raging) |
| `event` | chat line, join, leave, "Hazel is furious", day change, admin notice |
| `spec` | someone's appearance (sent when they join or change it) |
| `pong` | timestamp echo |
| `kick` | reason |

**Snapshot size and bandwidth** (an estimate to validate with the load test, not a promise):

- One entity record is about 10 bytes. With 100 players and 70 NPCs, a full snapshot is about **1.7 KB**.
- Players at 20 Hz and NPCs at 10 Hz is about **27 KB/s per client**, about **2.7 MB/s (22 Mbit/s) across 100 clients**. Sending only entities that changed (seated NPCs rarely do) should cut that by roughly half.
- At full load that is on the order of 5 to 10 GB per hour of outbound traffic. **Check current AWS data-transfer pricing before committing**; it is the main running cost at this scale, not CPU.
- Each snapshot is encoded **once** and the same buffer is sent to every client, so cost does not multiply by the number of players.

**Latency.** WebSocket runs on TCP, so a lost packet delays later ones. For a social game this is acceptable. If it ever hurts, WebTransport or WebRTC data channels are the upgrade path; the protocol module isolates the transport.

## 7. Accounts and login

| Piece | Design |
|---|---|
| Sign-up | `POST /api/auth/register` with username and password (and email if we choose, see section 17). Usernames unique, case-insensitive, limited characters and length |
| Password storage | argon2id, never logged, never returned |
| Login | `POST /api/auth/login` returns a short-lived **access token** and sets a refresh token in an httpOnly, secure, same-site cookie. `POST /api/auth/refresh`, `POST /api/auth/logout` |
| Joining the game | `POST /api/play/ticket` (needs a valid login) returns a **one-time ticket**: user id, username, character spec, expiry about 30 seconds, signed with a secret shared by `api` and `game`. The browser opens `wss://host/ws` and sends the ticket as its first message. The game server verifies the signature and expiry with **no database call** |
| Why a ticket and not the token | Tokens in URLs end up in logs. A ticket is single-use and expires in seconds |
| One session per account | A second login kicks the first (`kick`) |
| Abuse limits | Per-IP and per-account rate limits on register and login (`@nestjs/throttler`), lockout after repeated failures, a cap on concurrent hashing work |
| Character | `GET`/`PUT /api/character`. The server always runs `normalizeSpec` on whatever the client sends, so a hand-crafted spec cannot break rendering or be oversized |
| Admin | A role on the user. Admin endpoints (NPC count, pause, speed, kick, announce) require it |

Database tables (v1):

| Table | Columns (main ones) |
|---|---|
| `users` | id, username (unique, lower-cased), password_hash, role, created_at, last_login_at |
| `characters` | user_id, spec (JSON), last_x, last_z, updated_at |
| `refresh_tokens` | id, user_id, token_hash, expires_at, revoked |
| `audit_log` (optional) | who, what, when (admin actions, bans) |

Later phases add `items`, `inventory`, `wallet`/`transactions`, `shops`; all server-authoritative.

## 8. Repository layout

An npm-workspaces monorepo. The current `src/` becomes the client, and code that both sides need moves to `shared`.

```
office-simulator/
  package.json                 workspaces: apps/*, packages/*
  docker-compose.yml           local: proxy, api, game, db
  docker-compose.prod.yml      EC2 overrides
  docs/
  packages/
    shared/                    TypeScript, no DOM, no Three.js
      src/plan/                floor plan data (OUTER, WALLS), coordinate maths
      src/character/spec.ts    CharacterSpec, PARTS, normalizeSpec (from character/spec.js)
      src/sim/                 the simulation (people, tasks, meetings, day, nav, movement)
      src/layout/              obstacles, walls and spots as plain data (+ generated world.json)
      src/protocol/            message types, encode/decode
      src/config.ts            tunables (tick rate, speeds, limits)
  apps/
    client/                    today's src/, index.html, Vite   (JavaScript for now)
    api/                       NestJS
    game/                      Node + ws; loads shared/sim
    bots/                      load-test clients
```

Moves from today's tree:

| Today | Goes to |
|---|---|
| `config/plan.js` (minus the Three.js `Vector3`) | `shared/plan` |
| `character/spec.js` | `shared/character` |
| `people/data.js` (names, roles, categories) | `shared/sim` |
| `sim/*`, `nav/*`, `player/locomotion.js`, the logic half of `people/` | `shared/sim` |
| everything that draws, plus `ui/`, `camera/`, `fp/`, `player/control.js`, `world/` | `apps/client` |

## 9. Making the simulation shareable (the big refactor)

This is the phase everything else depends on, and the one with the most risk. It can be done **without changing what players see**, and the app keeps working at every step.

**9.1 Separate the person from their body.**
Today a person object holds `body` (meshes). Split it: the **sim person** is plain data (position, state, task, spot, props flags); the **client view** (rig and meshes) is a separate object keyed by person id. `people/sync.js` already moves meshes to match the sim; it becomes the bridge.

**9.2 Props as state, not mesh toggles.**
Activities such as `onStart: q => q.body.mug.visible = true` become `q.props.mug = true`. The client rig shows or hides the mesh from `props`. This touches `sim/tasks.js`, `sim/day.js`, `player/seating.js` and Hazel.

**9.3 No Three.js in shared code.**
Replace `THREE.Vector3` with plain `{ x, y, z }`; the client converts at the edge. `W(px, py)` returns a plain point on the server side.

**9.4 No hidden randomness or time.**
Replace `Math.random` in the sim with an injected seeded random source; replace `performance.now` with sim time. Result: the sim is reproducible and unit-testable.

**9.5 Layout as data (walls, obstacles, spots).**
Furniture builders currently produce meshes and register obstacles and spots in the same pass using hard-coded numbers. The server needs only the second half. Options:

| Option | How | Trade-off |
|---|---|---|
| **A. Export from the builders** (recommended for v1) | Run the existing builders headless in Node (Three.js works without a renderer; stub the canvas-based textures) and write `world.json`: obstacles, walls, spots (kind, position, facing, seat height, group). CI fails if the committed file is out of date | Smallest change, and client and server **cannot disagree** because the same code makes both. Slightly hacky build step |
| B. Declarative layout | Rewrite each builder so spots and obstacles come from data files and meshes are generated from them | Cleanest result, but a rewrite of every furniture file |

Plan: A first; B only if the export step proves fragile.

**9.6 Extract in thin slices.**
One module at a time, each slice verified in the browser (and, once tests exist, by unit tests): `shared/plan` and `shared/character` first (already nearly free of Three.js), then nav and movement, then tasks, meetings and day. The client keeps an **offline mode** by running the same shared sim in the browser, which is also the best development and demo setup.

## 10. Client changes

- **Login and register screen** before the world loads; reconnect and "session expired" handling.
- **`net/` module**: connection, ticket handshake, message decode, snapshot buffer, interpolation, input send, prediction and reconciliation, ping display.
- **Remote people** (NPCs and other players) are drawn from snapshots using the existing rig and animation: the server sends `anim`/`state` ids and the client's `people/animation.js` produces the pose. Other players use their own `CharacterSpec`.
- **Name labels** above players; NPC names as today.
- **HUD**: the ledger uses server counts; Pause, Speed and the People slider move to an admin panel; a chat panel and emote menu are added.
- **Character creation** (already planned) saves through the API.
- The `window.__sim` debug hook is removed from production builds (it would be a cheating tool).
- **Offline mode** stays, running the shared sim locally, for development and demos.

## 11. Deployment

### 11.1 Containers

| Container | Image | Notes |
|---|---|---|
| `proxy` | Caddy | TLS (automatic on EC2), serves the built client from a volume, routes `/api` to `api` and `/ws` to `game` |
| `api` | Node, built from `apps/api` | Stateless; migrations run on start |
| `game` | Node, built from `apps/game` | **Exactly one instance** (it holds the world). Restart policy `unless-stopped` |
| `db` | Postgres | Named volume; backups (below) |

Multi-stage Dockerfiles: install and build in one stage, copy only runtime files into a slim final image, run as a non-root user.

### 11.2 Local use

`docker compose up --build` starts everything at `http://localhost`. To host a session for people on the same network, they browse to the host PC's address. (Plain HTTP is fine for the game itself; features that browsers restrict to secure pages, such as microphone access for future voice, would need HTTPS even on a LAN. Verify when voice is planned.)

### 11.3 EC2

- **Instance:** a compute-oriented type such as `c6i.large` (2 vCPU, 4 GB) is a comfortable start for 100 players: the game process is single-threaded and light, and the second core absorbs the API and database. Avoid **burstable** (`t`-series) types for sustained load unless "unlimited" mode is on, because exhausted CPU credits throttle the game loop. Confirm sizing with the load test.
- **Region:** the one closest to the players (for players in the Philippines, Singapore `ap-southeast-1` is nearest).
- **Network:** an Elastic IP and a domain pointing at it; the security group opens **80 and 443 only**; SSH replaced by AWS Systems Manager Session Manager.
- **Data:** Postgres on an EBS volume with scheduled snapshots, **or** Amazon RDS (more reliable, costs more). Either way, a nightly dump to S3 is cheap insurance.
- **Deploy:** GitHub Actions builds images, pushes them to a registry (GHCR or ECR), then tells the instance to `docker compose pull && docker compose up -d`. A restart briefly disconnects players; the client reconnects automatically.
- **Render:** this replaces it for the full game, because the game needs a long-lived WebSocket server and a database on one network. The current Render static site can stay as a demo of the offline mode.

### 11.4 Configuration (environment variables)

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | api | Postgres connection |
| `TICKET_SECRET` | api, game | Signs and verifies join tickets |
| `JWT_SECRET` | api | Signs access tokens |
| `ADMIN_SECRET` | api, game | Authenticates admin calls between them |
| `NPC_COUNT`, `NPC_MODE`, `NPC_TARGET_POPULATION` | game | NPC control (section 5.7) |
| `TICK_RATE` | game | Defaults to 20 |
| `MAX_PLAYERS` | game | Hard cap (default 120, a little above the target) |
| `PUBLIC_URL` | proxy, api | The site's address |

Secrets live in the host's environment or a secrets store, never in git.

### 11.5 Operations

- A `/health` endpoint on each service; Docker health checks restart a stuck container.
- Structured logs; the game server logs tick time, players, NPCs, bytes sent, and event-loop lag once a second.
- Alerts (CloudWatch or similar) on: instance CPU, disk space, tick p99 above its budget, container restarts.
- World state is **ephemeral** by default: a restart begins a fresh morning, while accounts and characters persist. Saving the world is optional and listed in section 17.

## 12. Performance budget and load testing

**Budgets** (to verify, not assume):

| Measure | Target at 100 players + 70 NPCs |
|---|---|
| Server tick (step + encode + send) | p99 under 10 ms of the 50 ms budget |
| Event-loop lag on `game` | p99 under 20 ms |
| Added input latency (client to server to client) | under 150 ms on a normal connection |
| Bandwidth per client | under 40 KB/s |
| `game` CPU | under 50% of one core |
| Memory | no growth over a one-hour soak |

**Load test:** a `bots` app that logs in as N accounts, connects, walks randomly, sits, chats, and records round-trip times. Run it against local Docker first and then on the EC2 instance, at 50, 100 and 150 bots, plus a one-hour soak.

**Rules that keep the loop fast:**

- No JSON on the hot path; binary only.
- Encode each snapshot once; send the same buffer to everyone.
- No allocation inside the tick (reuse buffers and entity records).
- Handle slow clients: if a socket's send buffer backs up, drop it behind rather than queueing without limit.
- Keep the loop on its own process, away from hashing and database work.
- If one core is ever not enough, the sim and the network fan-out can be split across worker threads. We do not need that for 100.

## 13. Security checklist

- Validate **every** client message: type, size, ranges, rate. Drop and count violations; disconnect repeat offenders.
- The server decides everything: movement (speed and collision), seating (distance, occupancy), chat, events. The client only requests.
- `normalizeSpec` on every spec the server receives; size caps on everything.
- Rate limits on register and login; lockouts; per-IP connection limits on `/ws`.
- argon2id; no passwords in logs; HTTPS only in production; httpOnly secure cookies for refresh tokens.
- Secrets from the environment; separate secrets for tickets, tokens and admin; rotate on a leak.
- Admin actions are authorised by role and written to the audit log.
- Dependency updates and an image scan in CI.
- The debug hook is not shipped in production.

## 14. Testing strategy

Tests become possible once the sim is out of Three.js.

| Level | What |
|---|---|
| Unit (shared) | movement and collision, pathfinding, task selection, meetings, the day cycle, `normalizeSpec`, protocol encode/decode round-trips. Seeded randomness makes these reproducible |
| API | register, login, refresh, ticket issue, character save, rate limits, admin guard |
| Game integration | start a server in-process, connect scripted clients, assert sit/stand, occupancy, chat delivery, NPC count changes, kick |
| Load | the bots in section 12 |
| Browser smoke | boot the client against a server, log in, see people, walk, sit. This replaces the manual checklist for the core path |

CI runs lint, type-check, unit and integration tests, and builds the images on every push.

## 15. Phased plan

Sizes are relative (S, M, L), not calendar estimates; the first phase is the one most likely to run long.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Foundations** (S) | npm workspaces; TypeScript set up for `shared`/`api`/`game`; lint and CI; the client moved to `apps/client`; docs updated | Current app builds and runs unchanged from the new layout |
| 1 | **Shareable sim** (L) | Section 9: person/view split, props as state, no Three.js, seeded random, `shared/plan` + `shared/character` + `shared/sim`, layout export, unit tests | The sim runs in Node under tests, and the browser app (offline mode) behaves as it does today |
| 2 | **Headless server, viewers only** (M) | `game` app: tick loop, protocol, snapshots, NPC control (`NPC_COUNT`), admin pause/speed; the client connects as a **viewer** and renders server NPCs | Two browsers see the same NPCs doing the same things, with NPC count changeable live |
| 3 | **Accounts** (M) | `api` app: register, login, refresh, tickets, character save and load, admin role; login screen and character persistence in the client | You can register, log in, change your look, log out and back in, and it is remembered |
| 4 | **Players in the world** (L) | Player inputs, prediction and reconciliation, other players drawn and interpolated, sit/stand/use-spot on the server, local and global chat, emotes, shared Hazel rage, name labels | Many people walk around and sit together; everyone sees and hears the same things |
| 5 | **Deploy and harden** (M) | Dockerfiles, compose files, Caddy, EC2 setup, CI deploy, health checks, backups, logging and alerts, load tests and fixes | 100 bots meet the budgets in section 12 on EC2; a restart is survivable |
| 6 | **Gameplay** (ongoing) | Server-authoritative items, shops, money, quests; creator polish; more interactions | Each feature ships behind the server, never client-trusted |

Phases 2 to 4 can be demonstrated at each step, so the project is never "in pieces" for long. Phase 5's Docker work can start earlier (a local compose file in phase 2) so we are never debugging containers and gameplay at the same time.

## 16. First gameplay interactions (proposal)

There are no gameplay interactions yet, so this is a starting list, to be edited:

1. **Walk, sit, stand** and take any free seat (desk, dining, lounge, bar, booth, piano, guitar).
2. **Local chat and emotes** (wave, sit-and-chat, point).
3. **Use the facilities** that already exist: darts, mini golf, the lounge game, the keyboard and guitar. Shared and visible to everyone.
4. **Follow a friend** and **see who is where** (a simple list with search).
5. **Talk to NPCs** (stretch): NPCs that notice and react to you.
6. **Presence and status**: away, busy, in a meeting, with a status line above the head.

Items, shops and an economy come after this foundation is solid, designed with the server as the authority (see [ROADMAP.md](ROADMAP.md)).

## 17. Open questions

These need an answer from the team. The defaults in brackets are what this plan assumes.

1. **Voice chat?** Text chat is planned. Voice needs a media server and is a separate project. [Text only for now]
2. **Email at sign-up?** Needed only for password reset. Without it, a forgotten password needs an admin. [Username and password only, admin resets]
3. **Who is an admin, and how is the first one created?** [A seed admin from the environment]
4. **Does the world persist across restarts?** [No: fresh morning, accounts persist]
5. **Do we want `NPC_MODE=fill`** (NPCs make way as players join), or a fixed count only? [Both supported; start with fixed]
6. **How many people can be in the office at once?** Is 100 the hard cap, and what happens at the cap (queue, or refuse)? [Hard cap 120, then refuse with a message]
7. **Public or company-only?** Public needs stronger abuse protection (captcha, moderation tools). [Company-only, but built with the limits above]
8. **Database on the instance or Amazon RDS?** [On the instance with snapshots and S3 dumps to start]
9. **Domain and region?** Needed for HTTPS and for choosing the closest region.
10. **Budget ceiling** for the instance and data transfer, so we size to it.
11. **Do players need desks?** With 100 players and 70 desks, people simply sit wherever there is a free seat. [Players have no assigned desk]
12. **Moderation:** what are the chat rules, and who can mute or ban?

## 18. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Extracting the sim takes longer than expected | Delays everything after phase 1 | Thin slices; the app keeps working at every step; offline mode proves behaviour is unchanged |
| The layout export (9.5 A) proves fragile | Client and server disagree about walls or seats | CI check that the committed `world.json` matches a fresh export; fall back to option B |
| Crowd collision at 170 bodies | Jams in corridors, odd NPC paths | Players join NPC avoidance; tune radii in the load test; widen if needed |
| Clock or position drift between clients | People appear to jump | Server time in every snapshot; interpolation delay; reconciliation tested under artificial latency |
| Bandwidth cost higher than estimated | Surprise bill | Measure early (phase 2), send only changes, lower NPC rate, set an alert |
| TCP stalls on poor connections | Brief freezes for that player | Acceptable for this game; transport is swappable behind the protocol module |
| Scope creep into voice, economy, many rooms | Never ships | Phases with acceptance criteria; open questions closed before each phase |
| Moving from Render to EC2 | Ops burden on the team | Keep the Render static demo; document the runbook; automate deploys |
