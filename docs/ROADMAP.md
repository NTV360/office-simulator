# Roadmap

What is planned, and the design the current structure was built to allow. **The planned features below do not exist yet.** Update this page when something ships or the plan changes.

## Shipped

### Character creation
The player chooses their look while walking (first or third person), and it is kept between visits. `ui/creator.js` edits a `CharacterSpec` and calls `setPlayerSpec`, which rebuilds the body live and saves it to `localStorage`. Each body part has its own controls, accessories are a separate tab on top, and the 75 sprite avatars are starting looks. NPCs are unchanged. See [ARCHITECTURE.md](ARCHITECTURE.md#people-characters-and-the-player).

Not done: opening the creator outside first/third person, sharing or exporting a look, more hair styles, hats and clothing, and giving sprite looks to NPCs (the old `office` branch did; this was deliberately limited to the player).

## Planned features

### Items and shops
- Needs a data layer that does not exist yet, kept free of Three.js like `spec.js`: item definitions, an inventory, a wallet, shop definitions, equipment slots.
- Equipment attaches to the rig's `sockets` (`head`, `torso`, `leftHand`, `rightHand`) returned by `buildBody`. The mug, phone, pad, putter and guitar are already held props toggled by activities; they are the pattern for items.
- A shop is an interactable (`mkSpot`) with behaviour. Today spots only carry position, facing and occupancy. Add an optional `onUse` handler to spots when the first shop needs it, and open the shop UI from there.
- Static shop furniture goes in `world/furniture/` like any area. Items the player can pick up or move must be marked `userData.dynamic = true` so `bake` does not merge them.

### Saving
The player's look is saved today (`officeSimPlayerSpec` in `localStorage`, written by `player/player.js`). A small `persistence/` module for that plus the inventory and money is still to do.

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
| UI approach for shops and inventory | The HUD is plain DOM, and the creator builds its controls from tables by hand. Decide on a small component approach before shops and inventory are added |
