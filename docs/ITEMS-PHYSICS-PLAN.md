# Items, objects and physics: the plan

Branch: `feature/lbusal/items-objects-physics` (from `feature/leigh/server-multiplayer`). Status: **in progress**: steps 1 to 3 done.

## 1. The goal

Everything in the office is an **item**: a chair, a mug, a monitor, a table. Every item:

- has a **mass in kg** (a real-world figure, section 3) and is pulled down by **gravity**,
- has a **shape** it collides with, and a **material** that decides how much it grips or slides,
- can be **picked up**, except desks, built-ins and the building itself,
- rests on whatever is under it, so a mug on a chair rides along when the chair moves, and slides or tips off once the chair is tilted past the point where friction can hold it (not at the first small tilt).

Picking up is physical: the character walks within reach, the arm reaches out, and the item is held once the hand reaches it. Nothing teleports, so nothing resting on the item "blips". A held item can be turned on all three axes. Putting it down shows a **ghost** of the item where it will land. Thrown items fly with simple air drag.

**Everyone sees the same thing.** If you tilt a chair and the mug on it falls, every player sees that mug fall in the same place.

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Item or object? | **Item.** One word for everything. The existing `ObjectRecord` and `CATALOGUE` in `packages/shared/src/world/catalogue.ts` grow into the item definitions | One name in code, docs and talk |
| Weight | **Mass in kg**, from typical real-world weights (section 3). The `light / medium / heavy` classes go away | Real numbers drive the physics directly; classes would need a second table to turn into mass anyway |
| How an item is carried | **Worked out from its mass**, not set by hand: up to 3 kg **one hand**, up to 35 kg **two hands**, above that **drag** (push it along the floor, no lifting) **or more people** (section 7). Only **fixed** is set by hand | One rule, no per-item list to keep in step. The limits are data and can be tuned |
| Where you hold it | **Where you took hold of it.** The point your hand touched is the grip, and the item keeps the angle it had to your body at that moment. Pick a monitor up from behind and you hold it from behind; pick a chair up at an awkward angle and it stays awkward until you turn it. No preset grip points per item | Feels physical, and nothing snaps or jumps (section 6) |
| Reach | **Your arms**, not a distance. You can only take hold of a point your hand can touch from where you stand, and how far from your body you can hold something depends on its weight (section 6) | Replaces today's flat 2.6 m reach (`REACH` in `packages/shared/src/world/placement.ts`) |
| Carrying together | **Several people can hold one item.** Each one adds a grip and their strength: two people lift the 70 kg sofa, three the 85 kg cabinet (section 7) | Decided |
| Weight and walking | **Carrying slows you down**, more for heavier items. Proposal: speed × 1 / (1 + kg / 40), so a 12 kg chair is about 77 % speed and a 25 kg TV about 62 %; no running with two hands or while dragging. When people carry together, each one feels their share of the weight | Weight should be felt; the formula is data |
| What is fixed | **Desks**: the 9 desk islands, the 3 conference tables and the 4 booth shelves. **Built-ins and wall-mounted things**: counter, sink, snack cabinet, lockers, server rack, dartboard, wall TV, booths, the green, the rugs. **The building**: walls, doors, windows, floor | Decided (desks); the rest is the building |
| Who may move what | **Anyone can move anything**, including someone else's chair or mug, and anyone can sit anywhere. Station ownership stays only as a record of **whose things belong where** (for a later "NPC fetches its chair back to its desk", not in this branch). The server's per-station move check (`mayMove` in `apps/server/src/play/object-actions.ts`) goes | Decided |
| Breaking | **Not in this branch.** A dropped mug survives | Decided |
| Physics engine | **Rapier** (`@dimforge/rapier3d-compat`, WASM, runs in Node and the browser) | Already the plan in MULTIPLAYER-PLAN.md §8.5; rigid bodies, friction, rolling, sleeping, compound shapes |
| Who simulates | **The server.** Clients send what they want (grab this, my hand is here, turn it this way); the server moves the bodies and sends the poses; clients smooth between them | One answer for every player. Otherwise each screen's mug falls differently |
| Cost when nothing moves | Bodies at rest **sleep** and are not sent. Only awake items go out on the wire | 100+ chairs must cost nothing while still |
| Materials | A **few presets**, each just a friction and a bounciness value (section 4). Not a material simulation | Gets "glass on rubber grips, glass on glass slides" for almost no complexity |
| Rolling | Comes free from the **shape**: a sphere, or a cylinder on its side, rolls down a slope; a box slides or stays | Nothing to code beyond the right collider |
| Slip threshold | Comes free from **friction**: an item slides once the tilt angle θ has tan θ > μ (μ = 0.5 is about 27°), and tips once its centre of mass passes the edge of its base | Real behaviour, no special case per item |
| Air / aerodynamics | Rapier has only **damping** (no drag or lift). We add a small **quadratic drag** step per thrown item: F = ½ ρ C<sub>d</sub> A v², with C<sub>d</sub> and area from the item's data. A notebook gets high drag, a mug low | Cheap, believable throws; lift and spin effects (Magnus) are a later extra if ever needed |
| Characters | Keep the existing **grid walking** for now. Characters do not get pushed by items in v1 | As in MULTIPLAYER-PLAN.md §8.5; item ↔ character bumps are a later step |

## 3. Every item in the office today

Counted from the furniture builders in `apps/client/src/world/furniture/` and the desk data in `packages/shared/src/layout/desks.ts` (80 desk seats; the desk items on them are seeded, so the counts are exact). **Today** says what it is now:

- *object*: a movable world object the server already owns (the 6 types in today's catalogue);
- *baked*: drawn into the static merged mesh, not an object at all;
- *prop*: a visual-only thing in a person's hand during an activity.

**Mass** is a typical real-world weight for that kind of thing. **R** means it comes from a researched range (retailer and manufacturer listings, October 2026; the range is given); **E** means an estimate where no good source turned up. **Carry** follows from the mass (section 2): **1H** ≤ 3 kg, **2H** ≤ 35 kg, **drag** above, **fixed** set by hand.

### At the desks (×80 seats, islands A to H and the HR office)

| Item | Count | Today | Mass kg | Basis | Shape | Material | Carry |
|---|---|---|---|---|---|---|---|
| Desk (island table) | 9 islands | baked | – | – | box | wood | fixed |
| Desk divider (fabric screen) | 9 + column splits | baked | – | – | box | fabric | fixed (part of the desk) |
| Office chair (with arms) | 80 | object | 12 | R 7–18 | compound: base cylinder, seat box, back box | plastic + fabric seat | 2H |
| Monitor (24", with stand) | 80 | baked | 4.5 | R 2.8–6 | compound: foot box, neck box, panel box | plastic | 2H |
| Keyboard | 80 | baked | 0.5 | R 0.41–0.56 | box | plastic | 1H |
| Mouse | 80 | baked | 0.09 | R 0.06–0.10 | box | plastic | 1H |
| Mug (ceramic) | 28 | object | 0.35 | R 0.25–0.40 | cylinder | ceramic | 1H |
| Notebook (A5 hardcover) | 8 | object | 0.35 | R 0.33–0.50 | thin box | paper | 1H |
| Desk plant (small pot with soil) | 4 | object | 0.8 | R 0.06–1.8 | cylinder (pot) | ceramic | 1H |

### Conference rooms and booths

| Item | Count | Today | Mass kg | Basis | Shape | Material | Carry |
|---|---|---|---|---|---|---|---|
| Conference table | 3 | baked | – | – | compound: top + 4 legs | wood | fixed (a desk) |
| Conference chair (office chair) | 16 | object | 12 | R 7–18 | as office chair | plastic + fabric | 2H |
| Credenza / low cabinet | 3 | baked | 60 | R 60–99 | box | wood | drag |
| TV on a floor stand (55") | 3 conf + 3 work floor + 1 lounge | baked | 25 | R TV 13.6 + stand 5.5–16 | compound: foot, pole, panel | plastic | 2H |
| Phone booth (glass cabin) | 4 | baked | – | – | walls | glass | fixed (building) |
| Booth shelf | 4 | baked | – | – | box | wood | fixed (a desk) |
| Booth chair (office chair) | 4 | object | 12 | R 7–18 | as office chair | plastic + fabric | 2H |
| Booth puck (small dark cylinder on the shelf) | 4 | baked | 0.2 | E | cylinder | plastic | 1H |

### Lounge, game corner and music

| Item | Count | Today | Mass kg | Basis | Shape | Material | Carry |
|---|---|---|---|---|---|---|---|
| Sofa (3-seat, fabric) | 2 | baked | 70 | R 50–110 | compound: base, cushion, back, arms | fabric | drag |
| Couch (2-seat) | 1 | baked | 50 | E (scaled from the sofa) | as sofa | fabric | drag |
| Armchair (upholstered) | 4 | baked | 30 | R 7–34 (34 indoor) | as sofa | fabric | 2H |
| Lounge coffee table | 1 | baked | 12 | R 5–13 | compound: top + 4 legs | wood | 2H |
| Notebook on the coffee table | 1 | baked | 0.35 | R 0.33–0.50 | thin box | paper | 1H |
| Cup on the coffee table | 1 | baked | 0.25 | R 0.22–0.28 (porcelain) | cylinder | ceramic | 1H |
| Game console | 1 | baked | 4.5 | R 2.6–4.8 | box | plastic | 2H |
| Keyboard piano (61 keys) | 1 | baked | 4.5 | R 3–5.2 | box | plastic | 2H |
| X keyboard stand | 1 | baked | 3.3 | R 2.6–4.3 | compound: two crossed bars | metal | 2H |
| Piano stool | 1 | baked | 6 | E (low swivel stool) | compound: base, pole, seat | metal | 2H |
| Acoustic guitar | 1 | baked (shown on its stand) | 2.2 | R 0.9–2.7 | compound: body + neck | wood | 1H |
| Guitar stand | 1 | baked | 0.9 | R 0.8–1.75 | compound | metal | 1H |
| Guitar stool | 1 | baked | 6 | E (as piano stool) | as piano stool | metal | 2H |
| Floor plant (large pot with soil) | 5 | baked | 15 | R 9 empty – 18 filled | cylinder pot | ceramic | 2H |
| Music rug | 1 | baked (floor plane) | – | – | – | fabric | fixed (floor) |

### Bar, dining, kitchen

| Item | Count | Today | Mass kg | Basis | Shape | Material | Carry |
|---|---|---|---|---|---|---|---|
| Bar table (pedestal) | 2 | baked | 12 | R 8.5–9 small tables; ours has a wood top | compound: top, pole, foot | wood + metal | 2H |
| Bar stool (metal swivel) | 4 | object | 8 | R 6–14.5 | compound: foot, pole, seat | metal | 2H |
| Dining table (4-seat) | 6 | baked | 20 | R 16–38 | compound: top + 4 legs | wood | 2H |
| Dining chair (wood) | 18 | object | 6 | R 4.5–8.4 | compound: seat, 4 legs, back | wood | 2H |
| Pendant lamp over a dining table | 3 | baked | – | – | – | metal | fixed (ceiling) |
| Kitchen counter | 1 | baked | – | – | box | wood | fixed (built in) |
| Coffee machine (office bean-to-cup) | 1 | baked | 12 | R 9.4–14 | box | metal | 2H |
| Drip tray | 1 | baked | 0.3 | E | thin box | metal | 1H |
| Water bottle (5-gallon jug, full) | 1 | baked | 20 | R 19.5–21.3 | cylinder | plastic | 2H |
| Steel box by the machine (kettle / toaster) | 1 | baked | 3 | E | box | metal | 1H |
| Cups by the machine | 4 | baked | 0.25 | R 0.22–0.28 | cylinder | ceramic | 1H |
| Fruit bowl | 1 | baked | 0.8 | E | cylinder | wood | 1H |
| Apple | 4 (3 in bowl, 1 loose) | baked | 0.17 | R 0.15–0.20 | sphere | fruit | 1H, **rolls** |
| Orange | 2 | baked | 0.2 | E (no solid source) | sphere | fruit | 1H, **rolls** |
| Banana bunch (4) | 1 | baked | 0.5 | R about 0.12 each | compound | fruit | 1H |
| Sink cabinet + basin + tap | 1 | baked | – | – | box | metal | fixed (built in) |
| Snack cabinet (wall) | 1 | baked | – | – | box | wood | fixed (wall-mounted) |
| Bucket (plastic, empty) | 1 | baked (hidden while carried as a prop) | 1.0 | E | cylinder | plastic | 1H |
| Dining-area TV (on the booth wall) | 1 | baked | – | – | box | plastic | fixed (wall-mounted) |

### Work floor, storage and the rest

| Item | Count | Today | Mass kg | Basis | Shape | Material | Carry |
|---|---|---|---|---|---|---|---|
| Whiteboard on legs (120×90) | 2 | baked | 14 | R 10–16 | compound: board, frame, legs | metal | 2H |
| Storage cabinet (tall, 2-door) | 2 | baked | 85 | R 36–119 (steel 83–119) | box | wood | drag |
| Locker bank | 2 | baked | – | – | box | metal | fixed (built in) |
| Server rack (wall) | 1 | baked | – | – | box | metal | fixed (wall-mounted) |
| Dartboard + backboard + chalkboard | 1 | baked | – | – | – | – | fixed (wall-mounted) |
| Darts | 3 per player spot (shown only while playing) | prop | 0.022 | R 0.020–0.026 | thin cylinder | metal | 1H, **later: throwable** |
| Golf ball | 1 | baked (animated) | 0.046 | R ≤ 0.04593 (the rules' maximum) | sphere | plastic | 1H, **rolls** |
| Mini-golf green | 1 | baked | – | – | – | rubber (turf) | fixed (floor) |
| Brand wall with logo | 1 | baked | – | – | – | – | fixed (wall) |
| Walls, doors, windows, floor | – | baked | – | – | – | – | fixed (building) |

### Hand props (visual only today)

Shown in a person's hand during an activity (`apps/client/src/character/props.js`): **mug, phone, game pad, putter, bucket, cleaning rag, mop**. They are not world items. Once items exist, an activity could pick up a *real* item instead (the person's own mug), but that is a later step. For now they stay props.

## 4. Material presets

Each preset is just two numbers. When two items touch, Rapier averages their values.

| Preset | Friction μ | Bounce | Used for |
|---|---|---|---|
| wood | 0.50 | 0.25 | tables, wood chairs, bowl, guitar |
| metal | 0.40 | 0.20 | stools, stands, coffee machine, lockers |
| plastic | 0.40 | 0.35 | office chair shell, monitor, keyboard, console, bucket |
| ceramic | 0.45 | 0.10 | mugs, cups, plant pots |
| glass | 0.30 | 0.20 | booth glass, glass items later |
| fabric | 0.70 | 0.05 | sofa, armchairs, chair seats |
| paper | 0.50 | 0.02 | notebooks |
| fruit | 0.60 | 0.30 | apples, oranges, bananas |
| rubber | 0.90 | 0.60 | rubber mats, turf |

So a ceramic mug (0.45) on a fabric seat (0.7) has μ ≈ 0.58 and holds until the seat tilts about 30°. On a wood desk (0.5) μ ≈ 0.48, so it holds to about 25°. A glass item on rubber grips hard. These numbers are data: tuning them never needs code.

## 5. How an item is defined (proposal)

One definition per item type, in shared code (no Three.js, no Node), replacing today's catalogue entries:

```ts
interface ItemDef {
  label: string;
  mass: number;              // kg, a real-world figure (section 3); 0 for fixed items
  fixed?: boolean;           // desks, built-ins, the building; how others are carried follows from mass
  material: MaterialName;    // section 4
  colliders: Collider[];     // boxes, cylinders, spheres, offsets from the item's origin
  drag?: { cd: number; area: number }; // for throws; a default from the colliders when absent
  surface?: boolean;         // other items may rest on it (seats, tables, desks)
}
```

There is no grip point in the data: you hold an item wherever you took hold of it (section 6).

The page draws each type from its name, as today. The colliders are simple shapes that follow the drawn model closely enough for a mug to sit on a chair seat and not float.

## 6. Arms, reach and holding

### The arm

Each character has two arms, each about **0.6 m from shoulder to grip**, scaled to the character's size. Everything below is measured from the shoulders, not from the character's feet.

### Taking hold

1. **Aim.** You look at the item. The point under your aim on the item's surface is where you want to take it. Your client sends the item, that point and your view to the server.
2. **Check.** The server checks that the point really is on the item (its own ray against the colliders) and that a hand can reach it: the point must be within arm's length of a shoulder, perhaps with a small lean. If you are too far away you get "Too far: step closer". The item must also not be fixed.
3. **Reach.** Your character reaches out. Two-bone arm IK on the rig's `HandR` / `HandL` moves the hand to that point. A two-hand item gets the second hand at the nearest point on the item about a shoulder-width away. When the hands arrive (about 0.3–0.5 s), the server **attaches** them.
4. **Keep the grip as it was.** The grip point is stored on the item, and so is the item's angle to your body at that moment. From then on it moves with you exactly like that. Take a monitor from behind and you hold it from behind; nothing turns it to face you. The item never jumps, so things on it stay where they are.

### Holding

- **The hold is a spring, not glue.** The server pulls each grip point toward its hand with a strong spring. The item cannot pass through a wall, and a mug on top feels every motion and tilt.
- **How far out you can hold it depends on its weight.** Holding mass m at a distance d out from your shoulders takes a torque of m·g·d. Each person has a holding strength. Proposal: about **15 N·m with one hand** and **60 N·m with two**. So:
  - a 0.35 kg mug can be held anywhere your arm reaches;
  - a 3 kg item can be held at most about 0.5 m out with one hand;
  - a 12 kg chair at most about 0.5 m out with two hands: arms bent, not straight;
  - a 25 kg TV at most about 0.25 m out: hugged close;
  - over 35 kg, nobody can hold it alone even against the chest. You drag it, or get help (section 7).

  When you push a held item further out than your strength allows, it **sags**, and past that it slips out of your hands. The numbers are data.
- **Turning it.** While you hold an item alone, the turn keys rotate it on all three axes **around your grip**, like turning it in your hands. Your client sends the hold rotation; the server applies it.
- **Walking.** You walk slower depending on the weight you are holding (section 2).

### What everyone sees

- **Others see it.** The server sends the poses of every awake item about 20 times a second. Every client smooths between them, so everyone sees the chair tilt and the mug slide off.
- **Your own view.** Your client may move the held item ahead of the server, so turning it feels instant. Items on it still come from the server (a delay of about 0.1 s, which is fine for a sliding mug).

### Letting go

- **Place.** A **ghost** (a see-through copy of the item, green or red) shows where it will land, at the angle you are holding it, using the same rules as the server. Releasing lowers it gently onto the surface. Letting go in the air **drops** it, and gravity does the rest.
- **Drag.** Alone with an item over 35 kg, you take hold and pull or push it along the floor, slowly. It slides or tips by its own friction.
- **Throw.** Release with a speed, and air drag applies (section 2). How hard you can throw depends on the weight, by the same strength numbers.

## 7. Carrying together

Several people can hold the same item. Nothing special is needed in the physics: each person who takes hold adds one more grip, a spring from their hands to the point they took.

- **Who can lift it.** The weight shares out between the grips by where they are. The physics does this by itself. Each person then feels their own share and checks it against their own strength (section 6). So the 70 kg sofa needs two people, one at each end (about 35 kg each), and the 85 kg cabinet needs three. If one person lets go, the others suddenly carry more, and that end may sag or drop.
- **Walking together.** Everyone walks at the speed their own share allows, so the group effectively moves at the pace of the most loaded person. Walk too far from your grip and your hands slip off, and your end drops.
- **Turning it.** With two or more holders, nobody turns it with the keys. Its angle follows the hands: if one end is raised (each holder can lift or lower their hands) or the holders walk in different directions, the item tilts and turns. Whatever is on it reacts.
- **Putting it down.** Anyone can let go at any time. The item stays up for as long as the people still holding it can carry it.

## 8. Steps

Each step is a commit that leaves the game working.

1. (**done**) **The item list in data.** The item definitions (section 5) for the existing 6 objects, with mass in kg, material and colliders; the weight classes removed. No behaviour change. Unit tests for the data and the carry rule.
2. (**done**) **Anyone moves anything.** Drop the per-station move check on the server; ownership stays as the record of whose things are whose.
3. (**done**) **Rapier on the server.** A physics world at a fixed step, holding the building and the fixed furniture as static colliders and the items as sleeping bodies. Poses of awake items go into the existing object messages. Tests: a dropped mug comes to rest on a desk; a tilted surface makes a mug slide past its angle and not before.
4. **Baked things become items, and the walk grid follows them.** Monitors, keyboards, mice, the lounge set, kitchen items and the rest of section 3, one group per commit, out of the merged mesh and into the item list. Big items (tables, sofas, cabinets, floor plants) block walking where they stand, wherever they are moved, so people path around a moved sofa (decided: moved here from "later").
5. **Arms and reach.** Arm length, aiming at a point on an item, the server's reach check from the shoulders (replacing the flat 2.6 m), and the reach animation with arm IK.
6. **Real holding.** Attaching at the grabbed point with the angle kept, the spring hold, the strength limit (sag and slip), turning on three axes around the grip, things on top reacting, the speed penalty.
7. **The ghost.** A mesh preview at the held angle, replacing today's ring.
8. **Carrying together.** More than one grip per item, the weight shared out, slipping when someone walks off, lifting and lowering your end.
9. **Drop, drag and throw**, with air drag.
10. **Later, not this branch:** breaking, characters bumping items, NPCs fetching their own chair back to their desk, activities using real items instead of props.

## 9. Decisions made while building

The owner was asked on 2026-10-11 and chose; anything marked *picked* was decided while building, under the rule "pick the simpler or safer option, write it here, keep going". Each can be overruled.

| Question | Decision |
|---|---|
| Walk grid when big items move | Updated in this branch (step 4), not later. *Decided* |
| Controls while holding | Mouse plus a modifier: hold R and move the mouse to turn the item freely (Shift+R rolls it), the wheel raises and lowers your hands, G lets go. *Decided*; the throw key is in the step 9 notes below |
| Pull request | None: the commits are pushed and the owner opens the PR. *Decided* |
| Unplanned questions | Pick the simpler or safer option, note it here, keep going. *Decided* |
