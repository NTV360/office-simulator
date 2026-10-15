# Character mechanics

The authoritative server owns posture, movement, attacks, health, character holds, inventory, and medical use. The browser sends intents; it does not submit health, inventory contents, damage, or physical outcomes.

## Roster authority

Production employee identities come from the external employee provider; local PostgreSQL accounts are linked to those employee UUIDs. Guest people are only a connection fallback and synthetic people belong only in tests or local fixtures; they are never a production roster source.

## Combat and impacts

Punches, kicks, and bash attacks are server-timed. A bash is valid only while the attacking hand holds a catalogue item with explicit `bash` capability metadata. Two-handed bash items require both functional arms. Broken limbs, seated/ragdoll/recovery states, attack exclusivity, reach, facing, charge, and cooldown are authoritative checks.

Character attacks resolve body damage and a bounded directional impact. Slow/resting item manipulation is not an attack. Item-physics contact damage must remain server-observed and must use the same bounded impact resolver when enabled; clients never infer contact outcomes.

## Medical use

Bandages and first-aid boxes are finite inventory items. A medical action contains an item instance id, expected inventory revision, limb, and optional target person. The server validates item ownership, revision, medical type, usable body/hands, target existence, reach, and a conservative walk-grid line of sight before applying immutable limb healing and consuming exactly one item. A failed or replayed revision does not consume anything. The current version-5 world save persists each person's inventory and hotbar; health, medical-action state, hold links, ragdoll, and recovery state remain session-only.

## Inventory and hotbar

Inventory is a 4x5 authoritative grid with 0/90-degree rotations and three hotbar slots. Item instance ids, footprints, occupied cells, and hotbar references are validated on every mutation. A successful consume/drop clears stale hotbar references and increments the inventory revision once. Drag-out placement uses the server placement probe and deterministic fallback; clients reconcile from the owner-only snapshot.

## Lifecycle

Disconnect, reset, hand-back, and ragdoll cleanup release character holds and clear stale control references. World-object indices remain append-only; consumed objects become tombstones so clients cannot accidentally reuse an index. Dropping a stored item that came from the world (its inventory id is `world:<object id>`) brings that same object back at the new pose, so storing and dropping never grows the object list; only an item that never was in the world creates a new object. A tombstone takes no part in placement.

## Wire compatibility

The binary wire version is incremented whenever message shape changes. Medical inventory use is part of wire version 23; older clients must be rejected rather than decoding it as another action.
