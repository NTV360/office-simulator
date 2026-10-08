# Roadmap

What is planned, and the design the current structure was built to allow. **None of this exists yet** except where stated. Update this page when something ships or the plan changes.

## Planned features

### Multiplayer (the main direction)
Accounts with username and password; one shared, **persistent** office for about 100 people where furniture can be moved and things can be thrown; each account's character is an NPC while its player is offline and is driven by the player when online; voice chat; all self-hosted in Docker (frontend, server, database) on a PC in the office. The full design, repository layout, deployment, phases and open questions are in [MULTIPLAYER-PLAN.md](MULTIPLAYER-PLAN.md). It changes how several items below should be built: character data, items, money and saving all become **server-authoritative**, and the engineering follow-up "make the sim independent of Three.js" becomes the first phase of the plan.

### Character creation
Let the player choose their look, and keep it.

- The pieces exist: `CharacterSpec` (`character/spec.js`) lists every option in `PARTS`, `normalizeSpec()` repairs any input, and `setPlayerSpec(raw)` rebuilds the player's body live.
- To build: a creator screen (a new `ui/` module) that edits a spec and calls `setPlayerSpec`; saving and loading the spec (start with `localStorage` as JSON, validated through `normalizeSpec`); more options in `PARTS` and `HAIR_STYLES`.
- Keep NPCs and the player on the same base rig. New looks are new parts, not a second rig.

### Items and shops
- Needs a data layer that does not exist yet, kept free of Three.js like `spec.js`: item definitions, an inventory, a wallet, shop definitions, equipment slots.
- Equipment attaches to the rig's `sockets` (`head`, `torso`, `leftHand`, `rightHand`) returned by `buildBody`. The mug, phone, pad, putter and guitar are already held props toggled by activities; they are the pattern for items.
- A shop is an interactable (`mkSpot`) with behaviour. Today spots only carry position, facing and occupancy. Add an optional `onUse` handler to spots when the first shop needs it, and open the shop UI from there.
- Static shop furniture goes in `world/furniture/` like any area. Items the player can pick up or move must be marked `userData.dynamic = true` so `bake` does not merge them.

### Saving
A small `persistence/` module for the player's spec, inventory and money. Not started.

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
