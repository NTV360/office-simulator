# Roadmap

What is planned, and the design the current structure was built to allow. **None of this exists yet** except where stated. Update this page when something ships or the plan changes.

## Planned features

### Character creation (shipped)
Every employee's look can be edited in the character lab (`ui/creator.js`) and is stored in `character_information`. NPCs and the player use the same character pack and rig. Next: let the user choose which employee they walk around as.

- Possible next steps: let the player name themselves (the spec already has `name`); show the player's own look in the person card avatar; offer the pack's rides once the sim has a use for them.
- New looks are new parts registered in the pack (see [HOW-TO.md](HOW-TO.md#add-a-hairstyle-or-another-look-option)), not a second rig.

### Items and shops
- Needs a data layer that does not exist yet, kept free of Three.js like `spec.js`: item definitions, an inventory, a wallet, shop definitions, equipment slots.
- Equipment attaches to the rig's `sockets` (`head`, `torso`, `leftHand`, `rightHand`) returned by `buildBody`. The mug, phone, pad, putter and guitar are already held props toggled by activities; they are the pattern for items.
- A shop is an interactable (`mkSpot`) with behaviour. Today spots only carry position, facing and occupancy. Add an optional `onUse` handler to spots when the first shop needs it, and open the shop UI from there.
- Static shop furniture goes in `world/furniture/` like any area. Items the player can pick up or move must be marked `userData.dynamic = true` so `bake` does not merge them.

### Saving
Employee looks are saved in Supabase through the BFF (`server/`); the player's walk-around look stays in `localStorage`. There is no login: anyone using the app can edit any employee's character. If that matters later, sign in with the company's Auth0 and have the BFF check the token.

## Engineering follow-ups

| Item | Why |
|---|---|
| Smoke test (boot the page, step the sim, flip through every view) | Replaces the manual checklist; would have caught the white-screen regression during the restructure |
| Lint (unused imports, import cycles at module level) | Several unused imports remain; a cycle rule would enforce the import-time rule mechanically |
| Make the sim independent of Three.js | People carry their meshes today. Needed only for a headless or server-side sim |
| Gate or remove `window.__sim` for release | Development hook |
| Split the production bundle | Single ~850 KB chunk; the character lab and the pack's presets could load on demand |
| Camera collision with furniture | The third-person camera collides with walls only |
| Reduce the known layering exceptions | Listed in [ARCHITECTURE.md](ARCHITECTURE.md#layers-and-dependency-rules) |
| UI approach for shops and inventory | The HUD is plain DOM. The character lab builds its panel with a tiny `el()` helper in `ui/creator.js`; reuse it or pick a small component approach before more panels arrive |
