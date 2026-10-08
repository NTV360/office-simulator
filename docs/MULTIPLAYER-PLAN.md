# Multiplayer plan

**Status: proposal (version 2), for review. Nothing in this document is built yet.** It turns the team's decisions into a design, a repository layout, a self-hosted Docker deployment, and a phased plan with acceptance criteria. Version 2 replaces version 1 after these decisions: voice chat is coming, the world is **persistent and editable** (movable furniture, lifting, throwing), accounts take over their own NPC, the server is self-hosted on an office PC, and everything runs in Docker including the database.

Questions that are still open are in [section 18](#18-open-questions).

**Progress:** phase 0 (foundations) is done on the branch `phase-0/foundations`: npm workspaces, the client moved to `apps/client`, a TypeScript `shared` package, a NestJS server skeleton, tests, and a Docker stack (web, server, database) with a smoke test.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Players | Up to about 100 at once, company staff only |
| Login | Username and password. Forgotten passwords are reset by an admin (no email) |
| World | **Persistent**: it survives restarts, and so does everything players change in it |
| The office | **Customisable and physical**: movable chairs, personalised stations, lifting, moving and throwing things, "like a real office" |
| NPCs | The server runs them. **An account's character is an NPC while its player is offline and is controlled by the player while online** |
| Voice | Coming soon (planned for, built after movement and chat) |
| Hosting | **Local Docker first**: the whole stack runs from one compose file on a PC (a developer's, or one in the office). **Render and EC2 are dropped for now.** Once the local stack works, the same containers move to EC2 unchanged. **Host OS: a Windows PC for the local setup, Ubuntu on EC2 later** ([section 13.1](#131-the-host-machine)) |
| Containers | Everything in Docker: web (frontend), server, database (and voice later) |
| Repo | One monorepo ([section 9](#9-repository-layout)) |
| World clock | Keep the **fast day** (about 28.5 real minutes), as a setting that can change later |
| Desk assignment | An **admin picks** each new account's desk (slot) |
| What can be moved | Furniture rules in [section 8.8](#88-what-is-fixed-and-what-moves): the station tables, the Main TV (the lounge one where people play), conference tables and a future fridge (none for now) are fixed; kitchen tables, chairs, desk items and light to medium objects move |

## 2. Goals and non-goals

**Goals**

1. Accounts, login, and control of your own character.
2. One shared world where what one person sees and hears, everybody sees and hears.
3. A living office: NPCs fill in for people who are not online, and the office keeps its state between sessions.
4. Players can change the office: move furniture, customise their station, carry and throw objects.
5. Smooth: movement must feel instant and the server must not stall at about 100 players.
6. Easy to run: `docker compose up` on a PC (the host PC or any developer's), and later the same compose file on EC2.
7. Fun to work on: simple tooling and few moving parts (this is a team project for enjoyment, so we avoid ceremony).

**Non-goals for now:** more than one office, cloud hosting, mobile app, strong anti-cheat beyond server-side validation, public sign-ups.

## 3. What the current code tells us

| Fact (from the code today) | Consequence |
|---|---|
| The whole simulation runs in each browser, with its own clock and `Math.random` | One server must own it, or everyone sees a different world |
| A day (07:45 to 19:10) takes about 28.5 real minutes at 1× | The server owns the clock. Pause and Speed become admin-only. See the clock question in [section 18](#18-open-questions) |
| 70 desks. Every NPC is created with a desk (`seat`) and uses it as its identity (`p.seat` is used throughout the sim) | A "character slot" (a desk plus a person) is the natural unit. Capacity is 70 until stations can be added |
| `bake()` **merges every furniture mesh into a few draw calls**, and chairs and monitors are created *inside* the desk-island builder | **Movable furniture cannot work until furniture is separate objects.** This is the largest client-side change (section 8) |
| Spots (seats and so on) and obstacles are registered by the builders and never change afterwards; the nav grid is built once | In a world where things move, spots follow their objects and the nav grid updates when objects move |
| The sim reaches into meshes (`p.body.mug.visible`) and imports Three.js | It cannot run on a Node server yet. Splitting it from rendering is the first big job (section 10) |
| About 15 uses of `Math.random` in `sim/` and one `performance.now` (Hazel) | The server uses a seeded random source and the sim clock |
| Step 3 of the restructure made the **player a separate entity from NPCs** | For multiplayer the better shape is **one kind of person, controlled either by AI or by an account**. That is how the original "possess a character" idea worked. Phase 1 merges the two (section 5) |
| The floor is about 23 m by 42 m | Everyone can see everyone: broadcast to all, no area-of-interest filtering in v1 |

## 4. Architecture

```
  Browsers on the office network (up to ~100)
     |  HTTPS  page + REST (register, login, character)
     |  WSS    realtime game traffic
     |  WebRTC voice (to the voice container, later)
     v
  +----------------------------------------------------------+
  |  Docker Compose project on the host PC                   |
  |                                                          |
  |  web     Caddy: HTTPS, serves the built frontend,        |
  |          proxies /api and /ws to the server              |
  |                                                          |
  |  server  NestJS app: accounts and admin REST, plus the   |
  |          game: authoritative sim, physics, WebSocket,    |
  |          persistence                                     |
  |                                                          |
  |  db      PostgreSQL (volume on the PC's disk)            |
  |                                                          |
  |  voice   LiveKit (later phase)                           |
  +----------------------------------------------------------+
```

Yes: the Docker group is **frontend, server, database** (and voice later). The frontend is the built static files served by Caddy, which also provides HTTPS and forwards API and WebSocket traffic to the server.

**One server container, not two.** Version 1 of this plan split accounts and game into separate processes to keep password hashing away from the game loop. For a company-only game on a local network with a few logins at a time, that is more than needed: password hashing runs off the main thread, and logins are rare. So there is **one server process**, built as clearly separated modules (auth, game, persistence, admin). If it ever needs splitting, the module boundaries are already there. The game loop is still a plain TypeScript class; the Nest gateway only hands inputs to it and broadcasts its snapshots (section 6.1).

## 5. The core model: persons, slots and takeover

Everyone in the world is a **person**: the same data, the same rig, the same animation. A person is controlled either by **AI** or by **an account**.

```
person  { id, name, spec (look), slot, position, state, task, props, controller }
controller:  ai                       (an NPC)
          |  account(accountId)       (a player is driving)
```

A **slot** is a desk plus the person that belongs to it. Slots have three states:

| Slot state | Who controls the person | Notes |
|---|---|---|
| **Unclaimed** | AI | A pure NPC that no account owns, such as Hazel. These are the NPCs the admin counts |
| **Claimed, owner offline** | AI ("autopilot") | The account's own character, looking like them and sitting at their station, following the daily routine |
| **Claimed, owner online** | The player | The NPC is "overcome": the same person, now driven by the player |

How it works:

- **Register:** the new account is created in a **"waiting for a desk"** state. **An admin picks its slot** from the unclaimed ones (the admin page lists unclaimed desks by station). Until then the player can log in and look around with the orbit camera but cannot control a person. Once assigned, their first login opens character creation; the person's look becomes theirs and the desk becomes their station. If there are no unclaimed slots, the admin raises the slot count (up to the number of desks).
- **Log in:** the account takes control of its person **where it currently is**. There is no teleport; if the NPC was at lunch, the player is at lunch.
- **Log out or disconnect:** the person goes back to AI **from where it stands** and carries on (after a short grace period so a dropped connection can reconnect without the character wandering off).
- **The day cycle:** AI-controlled people arrive in the morning and go home in the evening as they do today. A **player** is never sent home: they can stay all night.

**NPC count control.** The admin controls the **number of slots** (`SLOT_COUNT`, from 0 to the number of desks, 70 today) and the number of those that start unclaimed. Options for how offline players appear:

| Setting | Meaning |
|---|---|
| `SLOT_COUNT` | Total slots (people in the office when everyone is offline). Clamped to the desk count |
| `OFFLINE_PLAYERS_AS_NPCS` | `true` (default): an offline player's person is shown on autopilot. `false`: the person is hidden and their desk empty while they are away |
| `MAX_AUTOPILOT` (optional) | Cap on how many autopilot people are shown at once, to bound the crowd |

All of these can be changed live by an admin. Reducing the count makes people walk out of the building, never vanish mid-stride.

## 6. The game server

### 6.1 Technology

| Choice | Decision | Why |
|---|---|---|
| Language | **TypeScript on Node.js** for `shared` and `server` | Same language as the client, so the simulation is genuinely shared. The client stays JavaScript for now |
| Server framework | **NestJS** | Good structure for accounts, REST, validation, config, guards and tests |
| Game loop and realtime transport | The loop is a plain TypeScript class. The network side is **Socket.IO through Nest's gateway** (`@nestjs/websockets` with `@nestjs/platform-socket.io`), configured with `transports: ['websocket']` (no HTTP long-polling), no per-message compression, binary payloads, and snapshots sent with `volatile` emits | Socket.IO gives automatic reconnection, heartbeats and timeouts, rooms and acknowledgements out of the box, and it is Nest's first-class option, which saves work. At 100 clients it will not be the bottleneck. A `volatile` emit drops a snapshot for a client that is behind instead of queueing it. The shared `protocol` module keeps the transport swappable: plain `ws` is the fallback if we ever need the last bit of speed |
| Messages | **Binary payloads**, defined once in a shared `protocol` module | Small and fast. No JSON on the hot path. Socket.IO sends a binary payload as one extra frame next to its small header, which is negligible at this size |
| Database | **PostgreSQL** with **Prisma** (TypeORM also works) | Typed queries and migrations; boring and reliable |
| Passwords | **argon2id** | Modern and memory-hard; runs off the main thread |
| Physics | **Rapier** (WebAssembly, runs in Node and the browser) | Rigid bodies for thrown and dropped objects. See section 8.5 |
| Voice | **LiveKit** (open-source SFU, self-hosted in Docker) | 100 people cannot be a peer-to-peer mesh. See section 12 |
| Alternative considered | Colyseus (game-server framework with rooms and state sync) | Would save work on sync, but we want the simulation shared with the client and a persistent single world; a small custom protocol fits better |

### 6.2 Authority

The server is the single source of truth.

| Server owns | Client owns |
|---|---|
| The clock, day cycle, pause, speed | Rendering, lighting from the sim time, camera |
| Every person (AI or player): position, state, task, spot, props | Predicting the local player's own movement |
| Every world object: position, rotation, owner, who is carrying it | Animation poses (derived from the state the server sends) |
| Which spot each person occupies | Camera shake and visual effects |
| Physics of objects in motion | |
| Events (such as Hazel's rage) and chat | |

### 6.3 The tick

- A fixed loop at **20 Hz** by default (50 ms), drift-corrected (compensating for late timers). The rate is the `TICK_RATE` setting. It is a choice about the simulation, **not a limit of the transport** (see "Why 20 Hz" below).
- Each tick: apply queued inputs, step the sim, step physics for active bodies, build one snapshot, send it.
- People who are players are sent every tick (20 Hz); AI people and objects that are moving are sent at 10 Hz.

**Why 20 Hz, and can it be higher?** The WebSocket (or Socket.IO) is only the pipe; it does not have a rate. 20 Hz is how often the server steps the world and sends a snapshot, and it is a trade-off:

- Your **own** movement does not wait for the server: the client moves your character instantly and the server only confirms it (prediction, section 6.4). So the tick rate does not change how responsive your controls feel.
- The rate decides how fresh **other** people's positions are. They are drawn about two ticks in the past so their motion is smooth, so the delay is roughly 100 ms at 20 Hz.
- Cost grows in a straight line with the rate. Using the estimate in [section 11](#11-network-protocol) (100 players, 70 AI people):

| Tick rate | Snapshot data per client | Other people appear about | Fits the 40 KB/s budget? |
|---|---|---|---|
| 10 Hz | about 17 KB/s | 200 ms behind | yes |
| **20 Hz (default)** | about 27 KB/s | 100 ms behind | yes |
| 30 Hz | about 37 KB/s | 67 ms behind | just, and less once only changed people are sent |
| 60 Hz | about 67 KB/s | 33 ms behind | no, without more savings |

For an office social game 20 Hz is plenty: fast action games use 60 Hz or more because aiming needs precision, and this game does not. Changing it is a one-line setting, and the load test will say whether 30 Hz is affordable. Physics for thrown objects can run at its own, faster fixed step on the server independent of the send rate.
- The server logs how long each tick takes: this is the key health number ([section 14](#14-performance-budget-and-load-testing)).

### 6.4 Player movement

- The client sends **inputs** (a move vector, heading, run flag, sequence number), not positions.
- The client moves its own person immediately (**prediction**) so controls feel instant.
- The server runs the same movement code (`stepPlayer`, moved into `shared`) against the same collision data and replies with the accepted position and the last input it handled; the client corrects smoothly if it differs (**reconciliation**).
- Other people are drawn about 100 to 150 ms in the past, interpolated between snapshots, so movement is smooth despite network jitter.
- Speed is capped on the server (walk 1.5 m/s, run 3 m/s plus a small tolerance). Walls and objects are enforced by the shared collision grid.

### 6.5 Interactions and shared state

- Sitting, standing, using a spot, picking up, placing and throwing are **requests** the server accepts or refuses (is it free? is the player close enough? is it allowed?).
- **Occupancy** (who is in which seat or using which thing) is one list on the server, so two people can never sit in one chair, and AI and players compete for spots fairly.
- Players are added to the NPCs' avoidance, so AI people walk around them.
- Pause, speed and the clock are server state, changed only by an admin.

### 6.6 Shared events (what one sees, all see)

Anything that happens in the world is created on the server and broadcast with a start time, so every client shows it at the same moment: Hazel's rage (with a cooldown), the lounge fighting game, announcements, joins and leaves, an object being thrown.

### 6.7 Chat

- **Local chat** heard within about 10 m (shown as a bubble over the speaker and in a chat panel) and a **global channel** for announcements.
- Server side: length limit, rate limit, sanitising, mute and ban hooks.

## 7. Accounts and login

| Piece | Design |
|---|---|
| Register | `POST /api/auth/register` (username, password). Usernames are unique and case-insensitive. The account starts **waiting for a desk**; an admin assigns a slot (section 5) with `POST /api/admin/users/:id/assign-slot` |
| Passwords | argon2id; never logged or returned. **No email**: an admin resets a forgotten password (`POST /api/admin/users/:id/reset-password`) |
| Login | `POST /api/auth/login` returns a short-lived access token and sets a refresh token in an httpOnly cookie. Also `refresh` and `logout` |
| Joining the game | `POST /api/play/ticket` returns a **one-time ticket** (about 30 seconds). The browser opens `wss://host/ws` and sends it first. Tokens never go in URLs |
| One session per account | A second login kicks the first, so one person never drives a character from two tabs |
| Abuse limits | Rate limits and lockouts on register and login |
| Character | `GET/PUT /api/character`. The server always runs `normalizeSpec` on what it receives |
| Admin | A role on the account: NPC and slot control, pause and speed, kick, announce, reset a password, reset or lock an object |

## 8. A persistent, editable world

This is new in version 2 and is the biggest change after the simulation split.

### 8.1 Everything movable is an object

A **world object** is a server entity:

```
object { id, type, x, y, z, rotation, owner (account or none), station (slot or none),
         carriedBy (person or none), locked, props }
```

- Types come from a **catalogue** (chair, stool, plant, mug, notebook, monitor, lamp, ball, and so on). Each type has a **prefab**: how to draw it, its footprint, its weight, how it can be carried, and whether it has a **seat** or other spots.
- **Spots belong to objects.** A chair object carries its seat spot, so when the chair moves, the seat moves with it, and AI people simply use the nearest free seat.
- The **building shell** (floor, walls, doors, windows) stays static and is still baked into a few draw calls.
- Each type has a **mobility** flag (`fixed` or `movable`). **Fixed** objects are still objects (they are saved, drawn and used the same way) but cannot be picked up or edited by players. Which things are which is decided in [section 8.8](#88-what-is-fixed-and-what-moves) and lives in data, so changing it is an edit to the catalogue, not to code.

### 8.2 What this does to today's furniture code

- The builders (`island()` and others) create desks, chairs, monitors and props **together** with hard-coded positions. They must be split into **prefabs** (one function that draws one thing) plus **placement data** (a list of "chair at x, z, rotation"). This is a rewrite of the furniture files, not a patch.
- `bake()` currently merges everything. Objects must not be merged; instead each prefab becomes **one mesh per object** (or an instanced mesh per type) so a few hundred objects stay cheap to draw. This is a measured, tunable part of the client work.
- The **starting layout** is generated once from today's code into a `seed-layout` data file, so the office looks the same on day one.

### 8.3 Interactions

| Interaction | How it works |
|---|---|
| **Pick up** | Request to grab a nearby object; if allowed, the object is attached to the person's hand socket (`sockets.rightHand`) and carried. Heavy objects slow you or need two hands (a per-type rule) |
| **Place / move** | Put it down at a spot in front of you; the server checks it fits (walls, other objects, optional grid snapping) |
| **Edit mode** | A mode for rearranging your station: select, move, rotate, remove, add from a catalogue within a quota |
| **Throw** | Releasing a carried object with an impulse; the server simulates it as a rigid body (section 8.5) and everyone sees the same flight |
| **Reset** | "Reset this object" and "reset my station" restore defaults, so mistakes and pranks are cheap to undo |

### 8.4 Permissions

- Whether a thing can move at all is its **mobility** (section 8.8). Fixed things never move for players.
- **At a station, only its owner and admins can move things** (monitor, keyboard, mug, chair). Other people can look, and may sit if the seat is free. **Everything in shared areas** (lounge, kitchen and dining, conference chairs) **is free for everybody to move.** This is decided; an admin can open a station up for fun if the team wants a prank day.
- Admins can move, lock, reset or delete anything, including fixed objects.
- Every change is attributed (who moved what) and recent changes can be undone.

### 8.5 Physics

- **Rapier** simulates only objects that are in motion (thrown, dropped, knocked). Objects at rest are asleep and cost almost nothing.
- Characters keep the existing grid-based collision; they are not pushed by physics in v1. Thrown objects collide with walls, the floor and other objects. Hitting people is a later extra.
- Physics runs at a fixed step on the server; clients interpolate the positions they receive.

### 8.6 Navigation changes with the world

The nav grid is currently built once. With movable objects it must **update**: when an object moves, the affected cells are recomputed (a small rectangle, cheap), and AI people repath if their route is blocked. Desks that move bring their owner's station with them.

### 8.7 Persistence

| What | How |
|---|---|
| In memory | The server keeps the live world; the database is the **saved copy** |
| Saving | **Dirty tracking**: changed objects, people and the clock are written in batches every few seconds, and everything is flushed on shutdown (`SIGTERM`). Worst case after a crash: a few seconds of changes lost |
| Loading | On start the server loads the saved world; if it is empty, it creates the seed layout and the seed NPCs |
| Backups | A nightly `pg_dump` to a folder on the host PC, kept for several days, plus a documented restore (section 13.5) |
| Clock | The world clock is saved and resumes after a restart |
| Schema versions | The saved world carries a version; migrations upgrade old worlds |

Tables (v1): `accounts`, `refresh_tokens`, `persons` (identity, spec, slot, last position, state, owner account or none), `slots` (desk assignment), `world_objects`, `world_state` (clock, day, settings), `audit_log` (admin actions, object changes). Later: items, inventory, money.

### 8.8 What is fixed and what moves

**The team's rules:**

- **Fixed:** the tables of the **office stations A to H**, the **Main TV** (the one in the lounge where people play; it stands on its own floor stand, **not on a table**), the **tables in the conference rooms**, and a **fridge** (none for now).
- **Movable:** the **kitchen tables**, **all chairs**, **all desk items** (computers, monitors, keyboards and so on), and **light, small and medium objects** in general.

Every type in the object catalogue carries `mobility: fixed | movable` and a **weight class**: *light* (carry with one hand: mug, keyboard, notebook), *medium* (two hands, slower: chair, stool, plant, small table), *heavy* (cannot be carried, so it is fixed). When a type is not covered by a rule above, the tie-breaker is: **built in, wall-mounted or heavy means fixed; light, small or medium means movable.**

**How that applies to the furniture that exists today.** Rows marked *proposed* are my application of the tie-breaker and need your confirmation ([section 18](#18-open-questions)).

| Thing in the office today | Mobility | Basis |
|---|---|---|
| Station tables (named "Desk 01" to "Desk 08" in the code; they become **Stations A to H**) | fixed | stated |
| Chairs at the stations and everywhere else (office, dining, conference, bar stools) | movable | stated |
| Monitors, keyboards, mice, mugs, notebooks, small desk plants | movable | stated (desk items) |
| Main TV (the lounge one where people play; it stands on its own floor stand) | fixed | stated |
| The lounge table in front of the TV sofa | movable | *proposed*: a medium table, like the kitchen tables. (The Main TV is not on a table, so there is no fixed "TV table") |
| Conference tables (three rooms) | fixed | stated |
| Conference TVs and the credenzas under them | fixed | *proposed*: room fixtures |
| Kitchen / dining tables (the six in the dining area) | movable | stated |
| Fridge | fixed | stated. **None for now**: there is no fridge in the office and the team decided not to add one yet. If one is added later it is a fixed object |
| Counter top and sink cabinet | fixed | *proposed*: built in |
| Coffee machine, water bottle and other things on the counter | movable | *proposed*: small |
| Sofas and the couch | fixed | *proposed*: heavy |
| Armchairs | movable | *proposed*: medium |
| Bar tables | movable | *proposed*: medium |
| Floor plants | movable | *proposed*: medium |
| Work-floor TVs on stands | fixed | *proposed*: display fixtures |
| Game console, guitar, guitar stand, keyboard piano on its stand | movable | *proposed*: small to medium |
| Storage cabinets and lockers | fixed | *proposed*: built in |
| Phone booths (glass cabins) | fixed | *proposed*: built in |
| Mini-golf green, dartboard, server rack, brand wall | fixed | *proposed*: floor-laid or wall-mounted |
| Floor, walls, doors, windows | fixed | the building shell |

Consequences for the design:

- **Chairs are the most-moved objects**, and they carry the seats. Moving a chair moves its seat, and AI people use whatever free seat is nearest. A person's own desk seat is the one at their station; if someone drags their chair across the room, they walk to it. "Reset my station" brings it back.
- **Desk items belong to a station** (they are saved with the station they sit on), so each person's station keeps its personality through restarts and is easy to reset.
- Because fixed things never move, the **station tables, conference tables and Main TV can stay part of a cheap merged mesh** for drawing. Only movable types need to be separate objects, which keeps the number of draw calls down.
- The catalogue flags are plain data, so the team can change any of the above (make the sofas movable, say) without touching code.

## 9. Repository layout

**Yes, a monorepo is a good fit here.** The point of this project is that the browser and the server run the *same* code (simulation, spec, protocol, plan). One repo with one set of shared packages makes that trivial, and for a small team of friends it means one clone, one pull request, one version. Heavier monorepo tools (Nx, Turborepo) are **not** needed; plain **npm workspaces** are enough.

```
office-simulator/
  package.json                 workspaces: apps/*, packages/*
  docker-compose.yml           web, server, db  (voice added later)
  docker/
    Caddyfile                  HTTPS, static files, proxy
    server.Dockerfile
    web.Dockerfile             builds the client, then Caddy serves it
    backup/                    nightly pg_dump script
  docs/
  packages/
    shared/                    TypeScript, no DOM, no Three.js
      src/plan/                floor plan data, coordinate maths
      src/character/           CharacterSpec, PARTS, normalizeSpec
      src/sim/                 persons, tasks, meetings, day, movement, nav
      src/world/               object model, catalogue, placement rules
      src/protocol/            message types, encode and decode
      src/config.ts            tunables
  apps/
    client/                    the browser app (moved here in phase 0), Vite, JavaScript for now
    server/                    NestJS: auth, admin, game, persistence
    bots/                      load-test clients (optional, later)
```

One thing to keep in mind with monorepos: Docker builds need the whole repo as their context so they can see `packages/shared`. The Dockerfiles in `docker/` handle that.

## 10. Making the simulation shareable (phase 1)

The app keeps working at every step; players see no change.

1. **One kind of person.** Merge today's separate `player` entity into the person model: `controller: ai | account`. The camera, input and seating code that now works on `player.person` will work on "the person I control".
2. **Separate the person from their body.** Today a person holds `body` (meshes). Split the **sim person** (plain data, including `props` flags) from the **client view** (rig and meshes), keyed by person id. `people/sync.js` already bridges the two.
3. **Props as state, not mesh toggles.** `onStart: q => q.body.mug.visible = true` becomes `q.props.mug = true`; the client rig shows or hides the mesh.
4. **No Three.js in shared code.** `THREE.Vector3` becomes plain `{ x, y, z }`.
5. **No hidden randomness or time.** `Math.random` becomes an injected seeded source; `performance.now` becomes sim time. The sim becomes reproducible and unit-testable.
6. **Slots instead of `p.seat`.** A slot object (desk spot, owner, station area) replaces the person's direct `seat` reference.
7. **Extract in thin slices:** `shared/plan` and `shared/character` first (nearly free of Three.js already), then nav and movement, then tasks, meetings and the day cycle. The client keeps an **offline mode** that runs the same shared sim in the browser, which is also the best demo and development setup.

The furniture-to-objects work in section 8.2 is a separate phase after the server can run, so the simulation split is not blocked on it.

## 11. Network protocol

Each message is a Socket.IO event carrying a **binary payload** (a Buffer) over the WebSocket transport: a one-byte message type, then a compact body. The shared `protocol` module encodes and decodes both directions, so the rest of the code never touches the transport.

**Client to server**

| Message | Contents |
|---|---|
| `input` | sequence number, move x/z, heading, run flag (about 20 per second) |
| `act` | sit, stand, use a spot (id) |
| `grab` / `drop` / `throw` | object id, placement or direction and strength |
| `edit` | move, rotate, add or remove an object in edit mode |
| `chat`, `emote` | text (limited), emote id |
| `ping` | timestamp |

**Server to client**

| Message | Contents |
|---|---|
| `welcome` | your person id, config, sim time, **the full world** (people and objects) |
| `snapshot` | tick, sim time, then one compact record per **changed** person and **moving** object |
| `object` | an object created, moved to rest, changed or removed (sent as events, not every tick, when it is not moving) |
| `event` | chat line, join, leave, rage, day change, admin notice |
| `spec` | a person's look, when they join or change it |
| `pong`, `kick` | latency echo; disconnect with a reason |

**Size.** A person record is about 10 bytes. With 100 players and 70 AI people, a full snapshot of people is about 1.7 KB; players at 20 Hz and AI at 10 Hz is about 27 KB/s per client, about 22 Mbit/s across 100 clients before sending only what changed (which should roughly halve it). That is trivial on a wired local network, but worth checking on Wi-Fi: **a good access point setup matters more than the server** at 100 clients. Objects at rest cost nothing per tick; only moving objects appear in snapshots. These figures are estimates for the load test to confirm.

## 12. Voice (planned)

Voice is built after movement and chat but affects decisions now.

- **LiveKit** runs as a fourth container. The server issues each player a LiveKit token from the same login. The browser connects to LiveKit for audio.
- **Proximity voice:** the server already knows where everyone is, so each client subscribes only to the speakers near it (for example within 15 m) and plays them with 3D positioning in the Web Audio API. That keeps 100 people from hearing each other all at once and keeps the load small.
- **HTTPS is required.** Browsers allow microphone access only on secure pages (HTTPS, or `localhost`). A plain `http://` address on the office network will **not** be able to use the microphone. So HTTPS on the local network must be solved properly ([section 13.3](#133-https-on-the-local-network)).
- **Networking:** WebRTC uses UDP port ranges and must advertise the PC's **local network address**. On **Docker Desktop for Windows** (which runs containers in a virtual machine), host networking is limited and advertising the right address can be fiddly. **Prototype voice in Docker on the actual office PC early** (see the risks) so there are no late surprises. A spare Linux machine is the easiest host for it.
- Text chat remains as a fallback.

## 13. Hosting: local Docker first, EC2 later

**The path.** Render and EC2 are not used for now. The one thing to build and prove first is a **single `docker-compose.yml` that runs the whole stack on one PC**: web, server and database (voice later). When that works locally, putting it on EC2 is **the same compose file on a rented Linux machine**, with a domain name for HTTPS and the firewall opened. No redesign. So every choice below is made to be portable: configuration comes from environment variables, data lives in named volumes, and nothing assumes a particular PC.

### 13.1 The host machine

**Local setup: a Windows PC. Later on EC2: Ubuntu.** (Both decided.) The containers are Linux in both cases, so the same images and the same compose file run on both. Only the layer underneath differs:

| | Windows PC (now) | Ubuntu on EC2 (later) |
|---|---|---|
| Docker | Docker Desktop with WSL2, or Docker Engine installed inside an Ubuntu WSL2 distribution (see below) | Docker Engine and the compose plugin from Docker's apt repository |
| After a reboot | Docker Desktop starts when someone **signs in**, so set the PC to sign in automatically and start Docker Desktop with it (or use Engine in WSL2 and start it at boot with a scheduled task). `restart: unless-stopped` then brings the stack back | systemd starts Docker at boot, and `restart: unless-stopped` brings the stack back |
| Firewall | Windows Defender Firewall: allow inbound 80 and 443 (and the voice ports later) | EC2 security group (and optionally `ufw`) |
| HTTPS | Caddy's internal certificate authority for the local network ([13.3](#133-https-on-the-local-network)) | A real domain with automatic certificates |
| Database storage | A **named Docker volume** (not a bind mount to a Windows folder: faster and no permission problems) | A named volume on an EBS disk, with snapshots |
| CPU type | x86-64 | Pick an **x86-64** instance (not ARM/Graviton) so the images are identical |

**Rules that keep Windows and Ubuntu identical:**

- Everything the stack runs is **inside Linux containers**. Scripts (backups, container start-up) are shell scripts that run in a container, never PowerShell on the host.
- `.gitattributes` keeps **LF line endings**, so shell scripts and Dockerfiles do not break in a Windows checkout (already set up in this repo).
- Linux file names are **case-sensitive** and Windows ones are not, so a wrong-case import works on Windows and fails on Ubuntu. **Always build through Docker**: the build runs on Linux and catches it.
- Configuration only through environment variables and the `.env` file; no hard-coded Windows paths.
- Set the time zone explicitly in the containers (`TZ`), so logs and the clock agree on both machines.

**Notes for the Windows host:**

- **Docker Desktop licensing:** it is free for personal use, education and small businesses (under 250 employees and under $10 million annual revenue); larger companies need a paid plan. Check the company against Docker's current terms. A free alternative is Docker Engine installed inside an Ubuntu WSL2 distribution, which is also the closest match to EC2. We can switch to it without changing any project file.
- The PC must not sleep, and Windows updates should restart it outside working hours.
- Docker on Windows runs in a WSL2 virtual machine. Give it explicit limits in `.wslconfig` (memory and CPU count) so it does not starve Windows; about 8 GB for 100 players with voice is a starting guess for the load test to confirm.
- A **fixed local address** for the PC (a DHCP reservation on the router).
- For voice, WSL2's **mirrored networking** mode (Windows 11 22H2 or later) makes published ports appear on the PC's network adapter more directly. Check this in the voice prototype ([section 12](#12-voice-planned)).
- A modern 4-core CPU, 16 GB RAM and an SSD are a comfortable target for about 100 players plus voice. The game loop uses one core lightly; the database and voice use the rest.
- **The office Wi-Fi is the likely bottleneck, not the server.** About 100 clients need a proper access-point setup.

### 13.2 Containers

| Container | Image | Notes |
|---|---|---|
| `web` | Caddy, with the built frontend baked in | HTTPS, static files, proxy to `server` |
| `server` | Node, built from `apps/server` | One instance only (it owns the world). `restart: unless-stopped`. Runs migrations on start. Flushes the world on `SIGTERM` |
| `db` | `postgres` | Named volume on the host's disk; password from an environment file |
| `voice` | `livekit/livekit-server` | Added in the voice phase |

`docker compose up --build` starts everything. Developers can run the same file on their own PCs to test. A `docker compose` profile can add a Vite dev server for client work.

### 13.3 HTTPS on the local network

Needed for voice, and good practice for logins. On the PC itself, `http://localhost` already counts as a secure page, so **local development needs nothing**. HTTPS matters when *other people's computers* connect to the host over the network, and again on EC2. Options:

| Option | How | Trade-off |
|---|---|---|
| **A. A real domain name** (the way to go on **EC2**, and on the office network if the company has a domain) | Point a name such as `office.yourcompany.com` at the PC's local address in DNS, and let Caddy get a normal trusted certificate using a DNS challenge | People just open the address; no setup on each computer. Needs a domain and a supported DNS provider |
| **B. Caddy's internal certificate authority** (the default for the **local network** stage) | Caddy makes its own certificates (`tls internal`); each person installs the root certificate once | No domain needed. Everyone has to trust the certificate once, which is easy to document but is a step per computer |
| C. A local certificate tool (mkcert) | Same idea as B | Fine for development machines |

### 13.4 Firewall and ports

Open on the host PC: `443` (and `80` for redirects) for the site and WebSocket; the LiveKit ports when voice is added (a TCP port and a UDP range). Nothing else, and **do not expose any of this to the internet**: it is for the office network (or a VPN) only.

### 13.5 Backups, updates and recovery

- A `backup` job runs `pg_dump` nightly into a host folder and keeps the last 7 to 14 dumps. Copy that folder somewhere else occasionally.
- **Restore** is one documented command that loads a dump into a fresh database.
- **Updating:** `git pull`, then `docker compose up -d --build`. The server flushes the world on stop and loads it on start, so players see a short reconnect and then the same office.
- The world also needs **"reset to defaults"** tools (per object, per station, whole office) for when a prank gets out of hand.

### 13.6 Operations (kept simple)

- A `/health` endpoint, Docker health checks, and `restart: unless-stopped`.
- The server logs tick time, players, objects, and bytes sent once a second. A small admin page shows the same numbers.
- No cloud monitoring or deployment pipeline is needed. If the team later moves to a cloud machine, the same compose file works there.

### 13.7 Configuration

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `TICKET_SECRET`, `JWT_SECRET` | Sign join tickets and access tokens |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seed admin account, created on first start |
| `SLOT_COUNT`, `OFFLINE_PLAYERS_AS_NPCS`, `MAX_AUTOPILOT` | People control (section 5) |
| `MAX_PLAYERS` | Hard cap, default 100 |
| `TICK_RATE` | Default 20 (try 30 once the load test allows) |
| `PUBLIC_URL` | The site's address |
| `LIVEKIT_*` | Voice keys and address (later) |

Secrets live in an `.env` file on the host, never in git (a `.env.example` is committed).

## 14. Performance budget and load testing

| Measure | Target at 100 players plus AI people |
|---|---|
| Server tick (step, physics, encode, send) | p99 under 10 ms of the 50 ms budget |
| Event-loop lag | p99 under 20 ms |
| Added input latency | under 150 ms on the local network |
| Bandwidth per client | under 40 KB/s |
| Server CPU | under 50% of one core, plus headroom for the database |
| Memory | no growth over a one-hour soak |
| Save (batch write) | under 50 ms, and never inside the tick |

**Load test.** A small `bots` app logs in as N accounts, walks, sits, chats, picks things up and throws them, and records round-trip times. Run it at 50, 100 and 150 bots, then a one-hour soak. A client-side check matters too: **draw calls and frame time with a few hundred movable objects** (section 8.2).

**Rules that keep the loop fast:** binary messages; encode each snapshot once and send the same buffer to everyone; no allocation inside the tick; saving off the hot path (batched, asynchronous); if a client falls behind, skip frames for that client (Socket.IO's `volatile` emit does exactly this) instead of queueing without limit.

## 15. Security (company-only)

- Validate every client message: type, size, range, rate. Disconnect repeat offenders.
- The server decides everything: movement, seating, grabbing, placing, throwing, chat. The client only asks.
- Object edits are checked against permissions, quotas and collisions, and attributed.
- argon2id; no passwords in logs; HTTPS; httpOnly cookies for refresh tokens.
- Secrets from the environment; separate secrets for tickets, tokens and admin.
- Admin actions are role-checked and written to the audit log.
- The network is internal only. The debug hook (`window.__sim`) is not shipped.

## 16. Testing

| Level | What |
|---|---|
| Unit (shared) | movement and collision, pathfinding, tasks, takeover and handoff between AI and player, the day cycle, object placement rules, `normalizeSpec`, protocol round-trips (seeded randomness keeps them reproducible) |
| Server integration | start a server in-process, connect scripted clients: register, login, claim a slot, take over a person, sit, grab, throw, chat, restart and check that the world was restored |
| Load | the bots (section 14) |
| Browser smoke | boot the client against a server, log in, see people and objects, walk, sit, move a chair |

## 17. Phased plan

Sizes are relative (S, M, L), not calendar estimates.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Foundations** (S) — **done** | npm workspaces; TypeScript for `shared` and `server`; `docker-compose.yml` with `web`, `server` and `db` (the server a placeholder); tests set up; client moved to `apps/client` | Today's app builds and runs unchanged from the new layout, and **`docker compose up` serves it from the `web` container** with the empty server and database alongside |
| 1 | **Shareable sim** (L) | Section 10: one person model, person/view split, props as state, no Three.js, seeded random, slots, `shared/*`, unit tests | The sim runs in Node under tests, and the browser (offline mode) behaves as it does today |
| 2 | **Server and persistence** (M) | The server runs the sim and the tick, the protocol, snapshots, the saved world (people, slots, clock) and restore, admin settings (slots, pause, speed); the client connects as a viewer | Two browsers see the same office; a restart brings back the same people, positions and clock |
| 3 | **Accounts and takeover** (M) | Register (claims a slot), login, tickets, character creation, take control and give back control, admin password reset | You can register, create your character, log in and drive your person, log out and watch it carry on as an NPC, and log back in where it is |
| 4 | **Players together** (L) | Prediction and reconciliation, other players drawn and interpolated, sit/stand/use spot on the server, local and global chat, emotes, shared events, name labels | Many people walk and sit together; everyone sees and hears the same things |
| 5 | **World objects** (L) | Furniture split into prefabs and placement data; objects as server entities with persistence; dynamic nav; pick up, place, edit mode, permissions and reset | You can move your chair and personalise your station, and it is all still there after a restart |
| 6 | **Throwing and physics** (M) | Rapier for objects in motion; throw; shared flight; sleeping bodies | Everyone sees the same thrown object land in the same place, with no cost at rest |
| 7 | **Voice** (M) | LiveKit container, HTTPS on the LAN, tokens, proximity subscription and 3D audio | People near each other hear each other; people far away do not |
| 8 | **Harden** (S to M) | Load tests and fixes, backups and restore tested, admin page, runbook | 100 bots meet the budgets on the host PC; a restore from a backup is rehearsed |
| 9 | **EC2 trial** (S, optional) | The same compose file on an EC2 Linux instance with a domain, the firewall open on 80 and 443 (and the voice ports), and automatic HTTPS | The team can play on EC2 exactly as on the local stack, with the same `.env` shape |

The order lets you **see progress after every phase**. Phases 5 and 6 can swap with 7 if voice matters more to the team than rearranging furniture. Docker is introduced in phase 0 so we never debug containers and gameplay at the same time.

## 18. Open questions

**Already decided** (for the record): the fast day stays (as a setting); an admin picks each account's desk; local Docker first with EC2 later; no Render; the local host is a **Windows PC** and EC2 will be **Ubuntu**; the furniture rules in [section 8.8](#88-what-is-fixed-and-what-moves) are accepted (the Main TV stands on its own stand, so there is no fixed TV table); **no fridge for now**; at stations only the owner and admins move things, shared areas are free. See [section 1](#1-decisions-so-far).

Still open. Defaults in brackets are what this plan assumes.

1. **Rename "Desk 01" to "Desk 08" as Stations A to H** (in the status text and labels)? This was not answered, so it stays as planned. [Yes, in phase 1]
2. **Can thrown objects hit people**, knock them back, or break? [No in v1]
3. **Moderation:** who can mute or ban, and what are the chat rules? [Admins]
4. **Remote access:** will anyone play from home through a VPN? If so, voice and latency need a look. [Office network only for now]

## 19. First gameplay interactions (proposal)

1. Walk, sit and stand on any free seat; **move your chair**.
2. **Customise your station** (edit mode, catalogue, quota, reset).
3. **Pick up, carry, place and throw** objects.
4. Local chat, emotes, and later voice.
5. Use the shared facilities: darts, mini golf, the lounge game, the keyboard and guitar.
6. See who is where; follow a friend; status above the head.
7. Items, shops and an economy later, with the server in charge.

## 20. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The simulation split takes longer than expected | Delays everything | Thin slices; the app works at every step; offline mode proves behaviour unchanged |
| Furniture-to-objects is a rewrite | Delays the editable office | Do it after the server exists; keep the starting layout generated from today's code |
| Draw calls with hundreds of separate objects | Low frame rate | One mesh per object or instancing per type; measure early (section 14) |
| Voice on Docker Desktop for Windows | Voice does not work or has one-way audio | Prototype early on the real PC; fall back to a Linux host |
| Browsers refuse the microphone on a non-HTTPS address | No voice | Solve HTTPS first (section 13.3) |
| Wi-Fi capacity at 100 clients | Rubber-banding for some people | Check the access points; the server is not the limit on a local network |
| Physics cost or jitter | Stalls or strange motion | Only simulate moving bodies; cap active objects; tune in the load test |
| Griefing in a shared, editable world | Annoyance | Permissions, quotas, undo, reset, audit log, admin tools |
| A crash loses recent changes | Players lose a few seconds of edits | Batched saves every few seconds and a flush on shutdown; tested restore |
| The host PC sleeps, updates or loses power | The office is down | Power settings, restart policy, a short runbook |
| Scope creep | Never ships | Phases with acceptance criteria; open questions closed before each phase |
