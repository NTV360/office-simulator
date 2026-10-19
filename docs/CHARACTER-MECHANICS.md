# Character mechanics

The authoritative server owns posture, movement, attacks, health, character holds, inventory, and medical use. The browser sends intents; it does not submit health, inventory contents, damage, or physical outcomes.

## Roster authority

Production employee identities come from the external employee provider; local PostgreSQL accounts are linked to those employee UUIDs. Guest people are only a connection fallback and synthetic people belong only in tests or local fixtures; they are never a production roster source.

## Combat and impacts

Punches, kicks, and bash attacks are server-timed. A bash is valid only while the attacking hand holds a catalogue item with explicit `bash` capability metadata. Two-handed bash items require both functional arms. Broken limbs, seated/ragdoll/recovery states, attack exclusivity, reach, facing, charge, and cooldown are authoritative checks.

The punch and kick are drawn by the page as a short timeline (`people/attack-anim.js`): the arm or leg draws back while the button is held, strikes in about 70 ms at the release, holds a moment and recovers inside the 350 ms cooldown. It is only a picture of what the server already decided; it starts from the attack's sequence number, so it plays fully even when the server clears a quick tap within 120 ms.

**Where a hit lands is aimed.** The attack message carries where the attacker is looking (the pitch, up positive; wire version 26), and the server picks the part from it (`packages/shared/src/sim/aim.ts`, pinned by `aim.test.ts`): the line of sight at the target's distance decides the height (above about 84% of their height the head, below about 47% a leg, between them the body), and a line more than 16 cm to one side of their middle is that side's arm (or, low down, that side's leg), as the target sees it. A person on the ground is just a body. A kick cannot reach the head, so it lands on the body. Looking straight at someone of your own height is the head. A missing or absurd look angle is level (the decoder clamps it to 1.5 rad). Item impacts and knockback still land on the body. `npm run e2e:limbs` checks it between two real browsers.

Character attacks resolve body damage and a bounded directional impact. Slow/resting item manipulation is not an attack. Item-physics contact damage must remain server-observed and must use the same bounded impact resolver when enabled; clients never infer contact outcomes.

## Medical care and the medkit

Bandages (heal 15, one inventory cell) and first-aid boxes (heal 30, a 1x2 cell item, rotatable) are finite inventory items. They are applied by **timed care**: pick the item on the hotbar (press its number, or click it) and hold E. A bandage takes 3 seconds and a first-aid box 5. The care heals the player you face within 1.25 m, else yourself. Without a choice it heals the most-hurt limb; **Inspect** (the button that appears when you face a player within reach) opens that person's body figure and clicking a part on it makes the care heal that body part (the care message carries the limb; the server refuses a limb that is already full). The server owns the clock: the item is used up only when the care completes. It ends, healing nothing and keeping the item, when E is let go, when the medic walks more than 0.5 m, when the patient leaves range or line of sight, or when either player is hit or knocked down. A patient whose body health is 0, who is not account-controlled, or who is ragdolled or recovering cannot be treated. The medic needs usable hands; the patient's arms do not matter. There is no instant medical use: a client cannot skip the timer.

The **medkit** is a fixed object at the north-east corner of the kitchen counter (the last object in the layout, so every earlier object id is unchanged). E opens its menu, a grid of what it holds; clicking an item takes it into the inventory when it fits (revision compare-and-swap, reach 1.8 m, line of sight). It holds at most 10 bandages and 5 first-aid boxes, makes a bandage every 5 seconds and a first-aid box every 15, and starts full after a server restart (the stock, like health, is session-only). The server tells only the player who has it open what it holds.

**Seeing the damage.** Everyone's `mechanics.health` is already on the wire, so the page only draws it (`apps/client/src/player/limb-health.js` holds the rules, one test file beside it). First and third person show a body figure on the left edge for you, and a second one for the patient while you inspect them or have a medical item picked and face them. Each part is green at full health, amber when hurt, red (pulsing) when about to fail, and grey with a × at 0, with a bar for the whole body underneath. The characters in the world show it too: a hurt part gets a translucent coloured shell (`character/limb-tint.js`), so you can see on anyone's body what is hurt. `npm run e2e:limbs` checks all of this between two real browsers.

**Being told you are hurt** (`player/hit-fx.js`, rules in `player/damage-feedback.js`, all read from your own `mechanics.health`): a red flash at the screen edges every time you lose health, a double beat that is stronger and longer the harder the hit (a light punch is about a quarter strength, a part breaking is always at least 90%); a slow red heartbeat at the edges while any part is almost broken or broken; the hit part flashing white on your body figure; and a sentence at the bottom of the screen that adapts to what is wrong, for example "Your left arm is almost broken. Treat it immediately.", "Your right leg is broken, you can't walk. Treat it immediately.", or, when four or more parts are failing or little health is left, "Your whole body is severely damaged. Get treatment now." It only promises what the game really does (a broken head says nothing about sight or hearing, which are not built yet). `prefers-reduced-motion` turns the beating into a single fade.

At 0 health a limb simply stops working: body 0 means no moving, no hands and no treatment; either leg 0 means no moving; both arms 0 means no hands. There is no death or respawn.

## Inventory and hotbar

Inventory is a 4x5 authoritative grid with 0/90-degree rotations and three hotbar slots. Item instance ids, footprints, occupied cells, and hotbar references are validated on every mutation. A successful consume/drop clears stale hotbar references and increments the inventory revision once. Drag-out placement uses the server placement probe and deterministic fallback; clients reconcile from the owner-only snapshot.

## Lifecycle

Disconnect, reset, hand-back, and ragdoll cleanup release character holds and clear stale control references. World-object indices remain append-only; consumed objects become tombstones so clients cannot accidentally reuse an index. Dropping a stored item that came from the world (its inventory id is `world:<object id>`) brings that same object back at the new pose, so storing and dropping never grows the object list; only an item that never was in the world creates a new object. A tombstone takes no part in placement.

## Wire compatibility

The binary wire version is incremented whenever message shape changes. The medkit and timed-care actions are part of wire version 25 (version 25 added the chosen limb to the care action; version 26 added the look angle to the attack message); older clients must be rejected rather than decoding them as another action.
