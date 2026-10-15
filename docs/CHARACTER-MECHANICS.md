# Character mechanics

The authoritative server owns posture, movement, attacks, health, character holds, inventory, and medical use. The browser sends intents; it does not submit health, inventory contents, damage, or physical outcomes.

## Roster authority

Production employee identities come from the external employee provider; local PostgreSQL accounts are linked to those employee UUIDs. Guest people are only a connection fallback and synthetic people belong only in tests or local fixtures; they are never a production roster source.

## Combat and impacts

Punches, kicks, and bash attacks are server-timed. A bash is valid only while the attacking hand holds a catalogue item with explicit `bash` capability metadata. Two-handed bash items require both functional arms. Broken limbs, seated/ragdoll/recovery states, attack exclusivity, reach, facing, charge, and cooldown are authoritative checks.

Character attacks resolve body damage and a bounded directional impact. Slow/resting item manipulation is not an attack. Item-physics contact damage must remain server-observed and must use the same bounded impact resolver when enabled; clients never infer contact outcomes.

## Medical care and the medkit

Bandages (heal 15, one inventory cell) and first-aid boxes (heal 30, a 1x2 cell item, rotatable) are finite inventory items. They are applied by **timed care**: pick the item on the hotbar (press its number, or click it) and hold E. A bandage takes 3 seconds and a first-aid box 5. The care heals the player you face within 1.25 m, else yourself, and always the most-hurt limb. The server owns the clock: the item is used up only when the care completes. It ends, healing nothing and keeping the item, when E is let go, when the medic walks more than 0.5 m, when the patient leaves range or line of sight, or when either player is hit or knocked down. A patient whose body health is 0, who is not account-controlled, or who is ragdolled or recovering cannot be treated. The medic needs usable hands; the patient's arms do not matter. There is no instant medical use: a client cannot skip the timer.

The **medkit** is a fixed object at the north-east corner of the kitchen counter (the last object in the layout, so every earlier object id is unchanged). E opens its menu, a grid of what it holds; clicking an item takes it into the inventory when it fits (revision compare-and-swap, reach 1.8 m, line of sight). It holds at most 10 bandages and 5 first-aid boxes, makes a bandage every 5 seconds and a first-aid box every 15, and starts full after a server restart (the stock, like health, is session-only). The server tells only the player who has it open what it holds.

At 0 health a limb simply stops working: body 0 means no moving, no hands and no treatment; either leg 0 means no moving; both arms 0 means no hands. There is no death or respawn.

## Inventory and hotbar

Inventory is a 4x5 authoritative grid with 0/90-degree rotations and three hotbar slots. Item instance ids, footprints, occupied cells, and hotbar references are validated on every mutation. A successful consume/drop clears stale hotbar references and increments the inventory revision once. Drag-out placement uses the server placement probe and deterministic fallback; clients reconcile from the owner-only snapshot.

## Lifecycle

Disconnect, reset, hand-back, and ragdoll cleanup release character holds and clear stale control references. World-object indices remain append-only; consumed objects become tombstones so clients cannot accidentally reuse an index. Dropping a stored item that came from the world (its inventory id is `world:<object id>`) brings that same object back at the new pose, so storing and dropping never grows the object list; only an item that never was in the world creates a new object. A tombstone takes no part in placement.

## Wire compatibility

The binary wire version is incremented whenever message shape changes. The medkit and timed-care actions are part of wire version 24; older clients must be rejected rather than decoding them as another action.
