# Working in parallel (several people or AI instances)

The phases in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#17-phased-plan) mostly depend on each other, but some work is independent. This page says **which work can run at the same time, who owns which folders, and the rules that stop two workers from breaking each other.** It applies equally to people and to AI instances.

## 1. The one rule that matters most

**Every worker gets its own working folder and its own branch.** Two workers editing the same folder overwrite each other's files and confuse git. Use git worktrees (one repository, many folders):

```
git worktree add ../office-sim-<track> -b track/<track> main
cd ../office-sim-<track>
npm install
```

Each worktree has its own `node_modules`. When a track is done, its branch is merged by the person in charge (see section 5), then `git worktree remove ../office-sim-<track>`.

## 2. What can run in parallel

| Track | Work | Needs first | Blocks | Owns (only this worker edits these) |
|---|---|---|---|---|
| **A** | Phase 1: make the simulation shareable (one person model, simulation split from rendering, seeded random, slots) | phase 0 | phases 2 and 4 | `apps/client/src/{sim,people,player,nav,config,character,core}/`, `packages/shared/src/{sim,plan,character}/` |
| **B** | Accounts API: register, login, refresh, join ticket, admin password reset, assign slot, database schema and migrations | phase 0 | track E | `apps/server/src/{auth,users,admin,db}/`, database schema, `packages/shared/src/api/` |
| **C** | The network message format: types, encode/decode, tests, size budget | phase 0 | phase 2 | `packages/shared/src/protocol/` |
| **D** | Voice spike: LiveKit in Docker on the Windows host, HTTPS on the local network, two browsers talking | Docker only | phase 7 | `docker/voice/`, `docker-compose.voice.yml`, `docs/VOICE-SPIKE.md` |
| **E** | Login, register and character-creator screens | the API types from track B (agreed first, can use a mock) | none | `apps/client/src/ui/{auth,creator}/`, their CSS |

**Not in parallel yet** (they wait for the tracks above): phase 2 (server runs the sim: needs A and C), phase 4 (players together: needs 2 and 3), phase 5 (world objects: it rewrites the same furniture and people files phase 1 touches, so it waits for A), phase 6 (physics: needs 5), voice implementation (needs 4 and the spike), phase 8 (harden).

Tracks A, B, C and D touch different folders, so they can all run at once. Track A is the **critical path**: if only one worker is available, it should do A.

## 3. Shared files: take care

These are touched by almost everyone. Keep edits to them small and merge them first.

| File | Rule |
|---|---|
| `package-lock.json` | Never merge by hand. If it conflicts, take either side, then run `npm install` and commit the result |
| root and workspace `package.json` | Only add your own dependencies; do not reorder or reformat |
| `docker-compose.yml` | Do not edit for experiments. Add your own file (for example `docker-compose.voice.yml`) and combine with `docker compose -f docker-compose.yml -f docker-compose.voice.yml up` |
| `apps/client/src/bootstrap.js`, `main.js` | One added line per new `build*`/`init*` call; do not restructure |
| `docs/*.md` | Add to your own section; do not reorganise. `MULTIPLAYER-PLAN.md` changes need a mention to the person in charge |
| `packages/shared/src/index.ts` | Only add exports; each track puts its code in its own subfolder |

**Contracts first.** When two tracks meet at an interface (the API between B and E, the messages between C and phase 2), the types go into `packages/shared` in a small first commit that is merged **before** either side builds on it.

## 4. Running things side by side on one PC

Two stacks on one machine collide on ports and names. Give each worktree its own:

```
set WEB_PORT=8081                         # (PowerShell: $env:WEB_PORT = "8081")
docker compose -p office-sim-b up --build # -p gives the stack its own name, containers and volume
```

The Vite dev server picks the next free port by itself (5173, 5174, ...). Use `SMOKE_URL=http://localhost:8081 npm run smoke` to test a stack on another port. Stop your stack when you finish: `docker compose -p office-sim-b down`.

## 5. Definition of done (for every track)

1. `npm run build`, `npm test` and `npm run typecheck` pass.
2. If it touches the server, Docker or the database: `docker compose up --build -d` then `npm run smoke` passes.
3. New logic has unit tests. Phase 1 especially: a bug fixed or a behaviour moved is covered by a test.
4. Docs updated in the same branch (see [CODING-STANDARDS.md](CODING-STANDARDS.md)).
5. Short commit messages, no AI co-author trailers.
6. **Nothing is pushed to `main` or to GitHub without the owner's say-so.** The person in charge decides what merges and in which order. Merge order is normally: contracts, then C, then B, then A.

## 6. A brief to give another instance

Copy this, fill in the track, and paste it as the first message:

> You are working on the Office Floor Sim repository, **track `<letter>`: `<name>`** from `docs/PARALLEL-WORK.md`.
>
> 1. Read `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/CODING-STANDARDS.md`, and the sections of `docs/MULTIPLAYER-PLAN.md` that your track touches (list them below).
> 2. Work **only** in your own git worktree and branch: `git worktree add ../office-sim-<track> -b track/<track> main`. Do not touch the main working folder.
> 3. Edit only the folders your track owns (listed in section 2 of `docs/PARALLEL-WORK.md`). If you need to change something outside them, stop and ask.
> 4. Follow the definition of done in section 5. Do not push anything and do not merge; report back with the branch name, what you built, what you tested and what is left.
> 5. If a decision is not covered by the docs, ask instead of guessing.
>
> Plan sections for this track: `<fill in>`

Plan sections per track: **A** sections 3, 5, 10, 17 (phase 1); **B** sections 7, 8.7 (tables), 13.7, 17 (phase 3); **C** sections 6, 11, 14; **D** sections 12, 13.1, 13.3, 13.4, 20 (voice risks); **E** sections 5, 7, 10.
