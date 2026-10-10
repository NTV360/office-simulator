# Documentation

Read these in order if you are new to the codebase. They describe how the project is organised **and the rules every change should follow**, so that the codebase stays consistent as more people add to it.

| Document | Read it to... |
|---|---|
| [GETTING-STARTED.md](GETTING-STARTED.md) | set up, run the multiplayer game on your own PC, and know what to run before you ask for a review |
| [MULTIPLAYER-HOW-TO.md](MULTIPLAYER-HOW-TO.md) | build a feature that every player sees the same: client-only, shared or server-owned, the step-by-step for a shared feature, the rules, how to test it, and what to do with a client-only PR |
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the layers, the folders, how the app starts up, and who owns which state |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | know the rules for new code (imports, state, naming, git) and the checklist before you push |
| [HOW-TO.md](HOW-TO.md) | add furniture, an activity, a camera view, a hairstyle, a HUD control, or a special character |
| [SUPABASE.md](SUPABASE.md) | the employee records the server imports from Supabase, and the permissions it needs |
| [MIGRATION.md](MIGRATION.md) | move work you started against the old single `index.html` into the new structure |
| [PHASE-1-BREAKDOWN.md](PHASE-1-BREAKDOWN.md) | the ordered, testable steps for making the simulation shareable (done) |
| [PHASE-2-BREAKDOWN.md](PHASE-2-BREAKDOWN.md) | the steps for the server, the protocol, saving the world and the viewer client (done) |
| [PHASE-3-BREAKDOWN.md](PHASE-3-BREAKDOWN.md) | the steps for accounts, login, taking over a person, character creation and admin tools (done) |
| [PHASE-4-BREAKDOWN.md](PHASE-4-BREAKDOWN.md) | the steps for playing together: walking with prediction, sitting, names, chat, emotes and shared events (done) |
| [PHASE-5-BREAKDOWN.md](PHASE-5-BREAKDOWN.md) | the steps for world objects: chairs and desk items the server owns, that players can move and that are kept (in progress; steps 1 and 2 done) |
| [PARALLEL-WORK.md](PARALLEL-WORK.md) | split work between several people or AI instances without them breaking each other (tracks, folder ownership, rules, a brief to hand out) |
| [LOCAL-DOCKER.md](LOCAL-DOCKER.md) | run the whole stack (web, server, database) in Docker on your PC, and troubleshoot it |
| [DEPLOYMENT.md](DEPLOYMENT.md) | serve the current demo as a static site (Render notes; Render is not the plan, local Docker is) |
| [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md) | the proposed plan for accounts, a shared persistent world with movable objects, NPCs that players take over, voice, and a self-hosted Docker stack (phases 1 to 4 built, phase 5 in progress; the design and the reasons) |
| [ROADMAP.md](ROADMAP.md) | see what is planned (items, shops, character creation) and the design it was built to allow |

**The short version**

1. Run it: `npm install`, then `npm run dev:online` for the multiplayer game (http://localhost:5173/?online; needs Docker Desktop) or `npm run dev` for a private offline office (http://localhost:5173). Build with `npm run build`, test with `npm test`. To run the whole stack in Docker: `docker compose up --build`, then `npm run smoke`.
2. The whole scene is assembled in one place: [`apps/client/src/bootstrap.js`](../apps/client/src/bootstrap.js). Modules do nothing when imported.
3. Put code in the folder that matches what it is (see the table in [ARCHITECTURE.md](ARCHITECTURE.md)). If it does not fit anywhere, ask before inventing a new folder.
4. Verify in a real browser before pushing (checklist in [CODING-STANDARDS.md](CODING-STANDARDS.md#before-you-push)). `npm test` covers only the shared and server code so far; the browser app is still checked by hand.
5. Keep commits short. Do not add AI co-author trailers.
