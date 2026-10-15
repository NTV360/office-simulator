# Roadmap

What is planned, and the design the current structure was built to allow. Multiplayer character control, server-authoritative object movement, session inventory/hotbar mechanics, medical actions, and combat mechanics now exist where noted in [CHARACTER-MECHANICS.md](CHARACTER-MECHANICS.md). Persistence, wallet/shop/equipment systems, and the remaining roadmap items are still planned. Update this page when something ships or the plan changes.

## Planned features

### Multiplayer (the main direction)
Accounts with username and password; one shared, **persistent** office for about 100 people where furniture can be moved and things can be thrown; each account's character is an NPC while its player is offline and is driven by the player when online; voice chat; all self-hosted in Docker (frontend, server, database) on a PC in the office. The full design, repository layout, deployment, phases and open questions are in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md). It changes how several items below should be built: character data, items, money and saving all become **server-authoritative**, and the engineering follow-up "make the sim independent of Three.js" becomes the first phase of the plan.

### Character creation
Let the player choose their look, and keep it.

- The pieces exist: `CharacterSpec` (`packages/shared/src/character/spec.ts`) lists every option in `PARTS`, `normalizeSpec()` repairs any input, and `setPlayerSpec(raw)` rebuilds the player's body live.
- To build: a creator screen (a new `ui/` module) that edits a spec and calls `setPlayerSpec`; saving and loading the spec (start with `localStorage` as JSON, validated through `normalizeSpec`); more options in `PARTS` and `HAIR_STYLES`.
- Keep NPCs and the player on the same base rig. New looks are new parts, not a second rig.

### Items and shops
- **Shipped:** the shared catalogue, server-authoritative world objects, 4×5 inventory, three-slot hotbar, rotation, drag-out drops, and inventory assignment from movable world objects. Person inventory and hotbar assignments are included in the current version-5 world save. See [CHARACTER-MECHANICS.md](CHARACTER-MECHANICS.md).
- Needs a wallet, shop definitions, and equipment slots. Equipment attaches to the rig's `sockets` (`head`, `torso`, `leftHand`, `rightHand`) returned by `buildBody`.
- A shop is an interactable (`mkSpot`) with behaviour. Today spots only carry position, facing and occupancy. Add an optional `onUse` handler to spots when the first shop needs it, and open the shop UI from there.
- Static shop furniture goes in `world/furniture/` like any area. Items the player can pick up or move must be marked `userData.dynamic = true` so `bake` does not merge them.

### Saving
A small versioned `persistence/` module for the player's spec, inventory and money remains planned for player-specific wallet/equipment data. World saves currently persist each desk person's inventory and hotbar assignments; wallet and equipment persistence are not started.

## Phase evidence (requested phases 1–7)

The multiplayer phase claims below are tied to the current implementation and focused tests. “Done” means the repository has code and automated coverage; it does not imply that browser/fingerprint recordings were changed.

| Phase | Concrete implementation | Focused proof | Status |
|---|---|---|---|
| 1 — shareable sim | `packages/shared/src/sim/`, `packages/shared/src/character/`, seeded state and Node-safe simulation | shared simulation suites, including `packages/shared/src/sim/takeover.test.ts` and `packages/shared/src/sim/driven.test.ts` | done |
| 2 — server and persistence | `apps/server/src/world/world.ts`, `packages/shared/src/sim/persist.ts`, protocol and world endpoints | `apps/server/src/world/world.test.ts`, `packages/shared/src/sim/persist.test.ts`, protocol tests | done |
| 3 — accounts and takeover | `apps/server/src/play/player-manager.ts`, auth/ticket routes, `packages/shared/src/sim/takeover.ts` | `apps/server/src/play/player-manager.test.ts`, `apps/server/src/play/employee-link.test.ts`, auth tests | done |
| 4 — players together | gateway/broadcaster, prediction, chat/emotes and server-owned actions | gateway/broadcaster/player-manager tests and protocol tests | done |
| 5 — world objects | `packages/shared/src/world/objects.ts`, placement, inventory and server object actions | `packages/shared/src/world/objects.test.ts`, `placement.test.ts`, inventory tests, object/admin tests | done |
| 6 — throwing and physics | `apps/server/src/physics/`, item impacts and shared character impact/combat mechanics | `packages/shared/src/sim/impact.test.ts`, `medical.test.ts`, character-holds tests, world physics tests | done |
| 7 — voice | optional LiveKit compose service, authenticated short-lived token endpoint, browser LiveKit client with explicit microphone/connect/mute/disconnect controls, `VoiceAclService` server-side Room Service subscription reconciliation, server-authoritative proximity policy, and configuration/docs in `apps/server/src/voice/` and `docs/VOICE.md` | `apps/server/src/voice/voice.test.ts`, client/server production builds, sequential workspace typecheck/build, and `npm run e2e:voice` against disposable Docker LiveKit | implemented behind optional configuration; disposable two-browser runtime verifies nearby remote tracks, range revoke/restoration, mute/unmute, logout cleanup, and token rejection; LAN HTTPS/WSS/UDP deployment verification remains outstanding |

### Browser recording compatibility

The committed files under `tests/browser/golden/` are historical recordings made with the former synthetic 40-person roster. Seeded browser pages now deliberately run offline without a roster fixture, so they correctly contain no autonomous staff unless a test explicitly loads one. The verifier therefore still checks layout and rendered-state parity but reports fingerprint differences against those obsolete recordings; do not restore synthetic production staff or regenerate the committed goldens blindly. A future browser recording update must use an explicitly named test fixture and keep production roster loading external-provider-only.

Persistence boundary: `packages/shared/src/sim/persist.ts` saves world people/clock/desk/object poses and, in save version 5, each saved person's inventory and hotbar assignments. Health, holds, ragdoll/recovery, and other active character-mechanics state remain session-only. Any future persisted state requires a version bump, backwards-compatible parsing, and persistence tests.

## Engineering follow-ups

| Item | Why |
|---|---|
| Smoke test (boot the page, step the sim, flip through every view) | Replaces the manual checklist; would have caught the white-screen regression during the restructure |
| Lint (unused imports, import cycles at module level) | Several unused imports remain; a cycle rule would enforce the import-time rule mechanically |
| Make the sim independent of Three.js | People carry their meshes today. Needed only for a headless or server-side sim |
| Gate or remove `window.__sim` for release | Development hook |
| Split the production bundle | Single ~600 KB chunk |
| Camera collision with furniture | The third-person camera collides with walls only |
| Reduce the known layering exceptions | Listed in [ARCHITECTURE.md](ARCHITECTURE.md#layers-and-dependency-rules) |
| UI approach for shops, inventory and creator | The HUD is plain DOM; decide on a small component approach before it grows |
