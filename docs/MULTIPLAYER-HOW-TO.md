# How to build a feature that works for everyone playing

The goal of the whole multiplayer work: **what one player sees, every player sees**, and your own controls never wait for the network. This page tells you how to write a feature that keeps that promise. If you already have a client-only change (most PRs so far), section 6 tells you what to do with it. To run and test things, see [GETTING-STARTED.md](GETTING-STARTED.md).

## The model in one minute

- **One server owns the office.** It runs the same simulation code as the browser (`packages/shared`) 20 times a second and sends every browser what changed. Everything that can differ between two players' screens (who is where, who sits where, which chair has moved, the clock, who said what) lives on the server.
- **The page is a viewer** of that office. Online, it does not run its own simulation: it draws what the server says. (Offline, `?offline`, it runs a private copy, which is how the simulation recordings and quick look-and-feel work are done.)
- **Your own movement is predicted**: your character moves at once, and the server confirms (and corrects, smoothly, if it disagrees). So controls feel instant at any tick rate.
- **Everybody else is drawn about 100-150 ms in the past**, smoothed between updates, so their movement is not jerky.
- **Anything that happens in the world** (a wave, someone starting the toilet run, a chair being moved) is decided by the server and *told to everyone*, so all screens show it together.
- **Clients ask, the server decides.** A client sends a small request ("I want to wave"). The server checks it (is it allowed, are they close enough, is it too soon?) and answers everybody. Nothing a client sends is believed without checking.

The full design and the reasons are in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md) (sections 6 and 11).

## 1. What kind of feature is it?

Ask: **would another player notice if my screen did this and theirs did not?**

| If... | It is | Where the code goes | Needs |
|---|---|---|---|
| **No.** It is only how something looks on your screen: a hairstyle in the editor, a camera view, a HUD button, a nicer material, a sound | **Client only** | `apps/client/src` as always ([HOW-TO.md](HOW-TO.md)) | Nothing server-side. It must not read or change anything that other players depend on |
| **Yes, but it is a rule or a calculation** that every machine can work out the same way from the same data: how fast someone walks, whether a place is walkable, what a chair does when moved, where a seat ends up | **Shared logic** | `packages/shared` (plain TypeScript, no DOM, no Three.js), used by both the page and the server | A unit test next to it. The same inputs must give the same answer on every machine |
| **Yes, and players change it or it must still be there tomorrow**: a chat line, an emote, an object picked up, a setting, a desk assignment | **Server-owned state** | A message in the protocol, a rule on the server, drawing on the client | Everything in section 2 |

Most features are a mix: the *rule* in shared, the *state* on the server, the *drawing* on the client. Keep those three apart and it stays easy to test.

## 2. Adding something players share, step by step

The chat emotes (wave, cheer, clap, nod) are the smallest complete example. Read them as you go: they touch every layer.

1. **Say what it is, in shared** (`packages/shared/src/protocol/messages.ts`). The list of kinds (`EMOTE_KINDS`), the request the client sends (`Emote`) and what everybody is told (`Emoted`). Use short fixed lists and numbers, not free text, wherever you can.
2. **Teach the codec** (`protocol/codec.ts`). Messages are small binary packets, one type byte then the fields. Add a type byte (`T.emote`, `T.emoted`), the encode and decode cases, and, **for a request a client may send, add it to the allowed list in `decodeClient` and `isClientMessage`**. Anything not on that list is refused before it is parsed. Then **raise `WIRE_VERSION`** (top of `messages.ts`): old pages and a new server must not talk to each other.
3. **Write the rule on the server, in a plain class** (`apps/server/src/play/emotes.ts`). It checks everything: is the value on the list, is this account playing, has it been long enough (the `RateLimiter`). It returns a result and touches no sockets, so it is easy to test.
4. **Wire it into the gateway** (`apps/server/src/net/game.gateway.ts`, the `case 'emote':`). Check the sender has joined and is the live connection for the account, call the rule, and on success `broadcast(...)` to everybody. That broadcast is what makes everyone see it.
5. **Send and receive on the page** (`apps/client/src/net/online.js`: `send({ type: 'emote', ... })`, and the `case 'emoted':` that finds the person and starts the animation; the animation itself is `people/animation.js`). Drawing is client-only: it reads state, it does not decide it.
6. **Tell people who join later.** If your feature is *state* (not a one-off event like a wave), a page that joins afterwards must be told the current state in the **welcome** message (see how `objects` was added: `Welcome.objects`, `broadcaster.ts`). Test that a new joiner sees it.
7. **Make it survive a restart** if it should. What is saved is in `packages/shared/src/sim/persist.ts`; add your state there, **raise `SAVE_VERSION`**, keep old saves readable, validate what you read (never trust the database), and add a database test in `apps/server/src/db/db.test.ts`. A one-off event (a wave) is not saved; a moved chair is.
8. **Test it** (section 4).

## 3. The rules that keep everyone's screen the same

1. **The server decides, the page draws.** Do not decide a shared outcome on the page ("the chair is now there", "this door is open") and hope the server agrees. Ask, then show what the server says. The exception is your own movement, which is predicted.
2. **No `Math.random()`, `Date.now()` or `performance.now()` in anything that decides what others see.** Two machines would get different answers. Shared code uses the seeded random (`seededRandom`) and the simulation clock (`sim.t`). Decoration that only you see may be random, but if two players would *compare* it ("why is your desk plant different?") it is shared state: make it from a fixed number (this is exactly how desk items were fixed in phase 5).
3. **Every request is untrusted.** Validate every field, check who is asking and whether they may, limit how often (`RateLimiter`), and never let a client name a position or an id you did not hand out. A message that is too big, wrong or too frequent is dropped or the connection is kicked; it must never crash the server.
4. **Send little, send rarely.** Send a change, not the world. Use numbers and fixed lists, not strings. Never send every frame what changes now and then. Per-player state that is known to the server (who is where) is already in the snapshots: do not send it again.
5. **Tell the latecomers and the returners.** Joining, reconnecting and a server restart must all end up with the same picture as everyone else (section 2, steps 6-7).
6. **Never block the tick.** The server runs one loop, 20 times a second, in one process. A handler must be quick and do no waiting, no big loops over the world, no database call in the middle of a tick. Slow work goes elsewhere and its result comes back as a message.
7. **Keep it cheap on the page.** Nothing per frame that you can do once when something changes (see `render/objects.js`: a moved chair writes one matrix when it moves; nothing runs per frame). Draw many similar things with instancing, not many meshes. Measure with `npm run perf` (draw calls and frame time) before and after.
8. **Online and offline.** If a feature cannot work offline (a chat with nobody), switch it off there cleanly rather than leaving a dead button. If it can, it should look the same.
9. **If it changes the protocol or what is saved, say so.** `WIRE_VERSION` (now 14) and `SAVE_VERSION` (now 4) go up, and the PR says so at the top.

## 4. How to test a feature that is shared

Test at the lowest level that can fail, then once for real.

| What | How | Look at |
|---|---|---|
| The rule | A plain unit test, no sockets | `apps/server/src/play/emotes.ts` and `chat.test.ts` |
| The message | Encode, decode, refuse junk | `packages/shared/src/protocol/protocol.test.ts` and `hardening.test.ts` |
| Over a real connection | Boot a test server, connect real clients, check what each *receives* | `apps/server/src/net/emote.gateway.test.ts` and `objects.gateway.test.ts` (`bootTestServer`, `connect`, `enter` in `test-support.ts`) |
| Two real browsers | Two windows of the real page: do both see it? | blocks in `tests/browser/verify.mjs`, and `scripts/e2e-together.mjs` (three players, restart, hard kill) |
| That the test can fail | Break the rule on purpose and see a test catch it | add a line to `scripts/mutation-check.mjs`, then `npm run check:mutations` |

Then try it by hand: `npm run dev:online`, two windows, and do the thing in one while watching the other. Also try: joining *after* it happened, reloading the page, and restarting the server. Those are where "what I see is what they see" usually breaks.

## 5. Latency: what to expect and what not to break

- Your own actions are instant (prediction). Do not make your own movement wait for the server.
- What other people do reaches you in roughly 100-150 ms: the network, plus being drawn about two ticks in the past on purpose so that it is smooth.
- A one-off event arrives when the server broadcasts it, so all screens show it within the same fraction of a second. If you must show something "at the same moment", send a start time and let each page start it then.
- Do not add work on the server for every snapshot, or messages per player per tick, without measuring. The budget and the figures are in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md#14-performance-budget-and-load-testing).

## 6. You already have a client-only change: what now?

1. **Decide which kind it is** (section 1). Most PRs are *client only* (looks) and need nothing more: no server work, no protocol change. Just check that online mode still works (`npm run dev:online`, two windows) and that it does not read anything that only exists offline.
2. **If it changes what a player can do or what others see**, split it:
   - the *state and the rule* move to `packages/shared` and the server (sections 2 and 3),
   - the page keeps the drawing and the controls, and sends a request instead of changing things itself.
   A page that today does `thing.x = ...` itself would, after the change, send "move thing" and draw the thing where the server says it is.
3. **Things that only work with the private office** (they read or set the simulation directly, run on `simulate: true`) do nothing online, because online the page is only a viewer. If that is you, you are in case 2.
4. **Ask before you build** if it is a big one: Leigh can say whether it needs to be shared, and phase 5 (world objects) may already cover it. The plan is in [PHASE-5-BREAKDOWN.md](PHASE-5-BREAKDOWN.md); it is where "things people can pick up, move and keep" are built.
5. Old work against the single `index.html` is a different problem: [MIGRATION.md](MIGRATION.md).

## 7. Mistakes to avoid (the first three happened while building this)

- **Random decoration that differed between browsers.** Every page made its own desk items, so no two screens matched. Fix: made once from a fixed number and stored in the layout data.
- **Acks sent "volatile"** (droppable) so they were all dropped. Prediction then never got its answer. Fix: send them reliably.
- **A test that proved nothing.** A check that the layout fingerprint notices a moved object moved a mug, which has no seat, so it could never fail. Fix: the mutation script ("break it on purpose") found it. Run `npm run check:mutations` for anything with a rule in it.
- **State that lives only in a mesh** (not seen yet, easy to do). Meshes are for drawing: anything another player must know belongs in the shared data (`packages/shared`), and the mesh follows it.
