// The kinds of world object (items), as data. Nothing here draws anything (the page does that, from the type's name) and nothing here is a
// rule of the simulation: it says what can be moved, what it weighs, what it is made of, the shapes it collides with and what it rests on,
// so the team can change it without touching code. See docs/PHASE-5-BREAKDOWN.md and docs/ITEMS-PHYSICS-PLAN.md.

import type { MaterialName } from './materials';

export type Mobility = 'fixed' | 'movable';
/** Chairs and stools stand on the floor; small things stand on a table. */
export type Rests = 'floor' | 'surface';
/** How a person carries a thing. It follows from the mass (see `carryOf`); only `fixed` is set by hand. */
export type Carry = 'one-hand' | 'two-hands' | 'drag' | 'fixed';

export type Triple = readonly [number, number, number];

interface ColliderBase {
  /** The centre of the shape, in metres from the item's origin (on the floor or table under it, the item facing rotation 0). */
  at: Triple;
  /** Turn of the shape about x, y and z, in radians (applied in that order). */
  rot?: Triple;
  /** When this part is made of something else than the item (a chair's fabric seat). */
  material?: MaterialName;
}
/** One simple shape the item collides with; an item is a few of them, close enough to the drawing for things to sit on it right. */
export type Collider =
  | (ColliderBase & { shape: 'box'; size: Triple })
  | (ColliderBase & { shape: 'cylinder'; radius: number; height: number })
  | (ColliderBase & { shape: 'sphere'; radius: number });

export interface ObjectType {
  label: string;
  /** Fixed things are objects too (saved, drawn, used the same way) but players cannot move them. */
  mobility: Mobility;
  /** Mass in kg: a typical real-world weight for this kind of thing (the sources are in docs/ITEMS-PHYSICS-PLAN.md, section 3). */
  mass: number;
  material: MaterialName;
  colliders: readonly Collider[];
  /** Other things may rest on it (a seat, a table top). */
  surface: boolean;
  /** How much room it takes, as a radius in metres: two objects may not be put closer than the sum of their radii. */
  radius: number;
  rests: Rests;
}

// A swivel chair: five-star base (with its castors), gas pole, padded seat, tilted back and two arms (as officeChair() draws it).
const OFFICE_CHAIR: readonly Collider[] = [
  { shape: 'cylinder', radius: .27, height: .065, at: [0, .0325, 0] },
  { shape: 'cylinder', radius: .028, height: .36, at: [0, .24, 0] },
  { shape: 'box', size: [.48, .08, .46], at: [0, .45, .02], material: 'fabric' },
  { shape: 'box', size: [.46, .5, .06], at: [0, .78, -.22], rot: [-.1, 0, 0], material: 'fabric' },
  { shape: 'box', size: [.04, .2, .3], at: [.25, .58, 0] },
  { shape: 'box', size: [.04, .2, .3], at: [-.25, .58, 0] },
];
// Four legs, a seat and a back (woodChair()).
const WOOD_CHAIR: readonly Collider[] = [
  { shape: 'box', size: [.42, .05, .42], at: [0, .45, 0] },
  ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]): Collider => ({ shape: 'box', size: [.035, .44, .035], at: [a * .18, .22, b * .18] })),
  { shape: 'box', size: [.42, .32, .035], at: [0, .74, -.2] },
];
// Round foot, pole and a round padded seat (barStool()).
const BAR_STOOL: readonly Collider[] = [
  { shape: 'cylinder', radius: .2, height: .0325, at: [0, .01625, 0] },
  { shape: 'cylinder', radius: .025, height: .68, at: [0, .36, 0] },
  { shape: 'cylinder', radius: .18, height: .06, at: [0, .72, 0], material: 'fabric' },
];

export const CATALOGUE: Readonly<Record<string, ObjectType>> = {
  'chair-office': { label: 'Office chair', mobility: 'movable', mass: 12, material: 'plastic', colliders: OFFICE_CHAIR, surface: true, radius: .3, rests: 'floor' },
  'chair-wood': { label: 'Dining chair', mobility: 'movable', mass: 6, material: 'wood', colliders: WOOD_CHAIR, surface: true, radius: .26, rests: 'floor' },
  'stool-bar': { label: 'Bar stool', mobility: 'movable', mass: 8, material: 'metal', colliders: BAR_STOOL, surface: true, radius: .22, rests: 'floor' },
  mug: { label: 'Mug', mobility: 'movable', mass: .35, material: 'ceramic', colliders: [{ shape: 'cylinder', radius: .0375, height: .1, at: [0, .05, 0] }], surface: false, radius: .06, rests: 'surface' },
  notebook: { label: 'Notebook', mobility: 'movable', mass: .35, material: 'paper', colliders: [{ shape: 'box', size: [.2, .025, .27], at: [0, .0125, 0] }], surface: true, radius: .14, rests: 'surface' },
  'plant-desk': {
    label: 'Desk plant', mobility: 'movable', mass: .8, material: 'ceramic', surface: false, radius: .1, rests: 'surface',
    colliders: [{ shape: 'cylinder', radius: .055, height: .1, at: [0, .05, 0] }, { shape: 'sphere', radius: .09, at: [0, .16, 0] }],
  },
};

/** The height of a desk top, in metres: what a small thing placed on a desk stands on. */
export const DESK_TOP = .76;

/** The heaviest thing one person carries in one hand, and in two; anything heavier is dragged (or carried by several people). In kg. */
export const CARRY_LIMITS = { oneHand: 3, twoHands: 35 } as const;

export const typeOf = (type: string): ObjectType | undefined => CATALOGUE[type];
/** Can a player move this kind of thing at all? (Whether they may move *this one* depends on who owns its station: see the server.) */
export const isMovableType = (type: string): boolean => CATALOGUE[type]?.mobility === 'movable';
/** How one person carries this kind of thing, from its mass; undefined for a kind that does not exist. */
export function carryOf(type: string): Carry | undefined {
  const t = CATALOGUE[type];
  if (!t) return undefined;
  if (t.mobility === 'fixed') return 'fixed';
  return t.mass <= CARRY_LIMITS.oneHand ? 'one-hand' : t.mass <= CARRY_LIMITS.twoHands ? 'two-hands' : 'drag';
}
