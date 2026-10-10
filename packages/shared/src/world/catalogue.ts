// The kinds of world object (items), as data. Nothing here draws anything (the page does that, from the type's name) and nothing here is a
// rule of the simulation: it says what can be moved, what it weighs, what it is made of, the shapes it collides with and what it rests on,
// so the team can change it without touching code. See docs/PHASE-5-BREAKDOWN.md and docs/ITEMS-PHYSICS-PLAN.md.

import type { MaterialName } from './materials';
import { barTableShape, plantShape, sofaShape, tableShape } from './shapes';

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

/** The solid shape of one item: what it collides with, the floor it keeps people off, and the top other things stand on. */
export interface Shape {
  colliders: readonly Collider[];
  /** It blocks walking: half its width and half its depth in plan pixels, in its own frame (facing rotation 0). */
  foot?: readonly [number, number];
  /** Its top, when small things may be put on it (a table): height above its origin, and half its width and depth, in metres, in its own frame. */
  top?: { y: number; hw: number; hd: number };
}

export interface ObjectType extends Shape {
  label: string;
  /** Fixed things are objects too (saved, drawn, used the same way) but players cannot move them. */
  mobility: Mobility;
  /** Mass in kg: a typical real-world weight for this kind of thing (the sources are in docs/ITEMS-PHYSICS-PLAN.md, section 3). */
  mass: number;
  material: MaterialName;
  /**
   * For kinds that come in sizes (one sofa is longer than another): the shape for this item's own `dims`, from the layout data. Its
   * `colliders`, `foot` and `top` then replace the fixed ones.
   */
  sized?: (dims: readonly number[]) => Shape;
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

// (a seat is a top too: a mug can be put on a chair, and falls when somebody picks the chair up)
export const CATALOGUE: Readonly<Record<string, ObjectType>> = {
  'chair-office': { label: 'Office chair', mobility: 'movable', mass: 12, material: 'plastic', colliders: OFFICE_CHAIR, top: { y: .49, hw: .22, hd: .2 }, surface: true, radius: .3, rests: 'floor' },
  'chair-wood': { label: 'Dining chair', mobility: 'movable', mass: 6, material: 'wood', colliders: WOOD_CHAIR, top: { y: .475, hw: .2, hd: .2 }, surface: true, radius: .26, rests: 'floor' },
  'stool-bar': { label: 'Bar stool', mobility: 'movable', mass: 8, material: 'metal', colliders: BAR_STOOL, top: { y: .75, hw: .12, hd: .12 }, surface: true, radius: .22, rests: 'floor' },
  mug: { label: 'Mug', mobility: 'movable', mass: .35, material: 'ceramic', colliders: [{ shape: 'cylinder', radius: .0375, height: .1, at: [0, .05, 0] }], surface: false, radius: .06, rests: 'surface' },
  notebook: { label: 'Notebook', mobility: 'movable', mass: .35, material: 'paper', colliders: [{ shape: 'box', size: [.2, .025, .27], at: [0, .0125, 0] }], surface: true, radius: .14, rests: 'surface' },
  // the desk computer: a monitor on its foot (its screen is drawn by the page, at its face), the keyboard and the mouse
  monitor: {
    label: 'Monitor', mobility: 'movable', mass: 4.5, material: 'plastic', surface: false, radius: .14, rests: 'surface',
    colliders: [{ shape: 'box', size: [.22, .012, .16], at: [0, .006, 0] }, { shape: 'box', size: [.05, .14, .04], at: [0, .08, .02] }, { shape: 'box', size: [.58, .34, .03], at: [0, .27, 0] }],
  },
  keyboard: { label: 'Keyboard', mobility: 'movable', mass: .5, material: 'plastic', colliders: [{ shape: 'box', size: [.4, .018, .13], at: [0, .009, 0] }], surface: false, radius: .15, rests: 'surface' }, // (a circle for crowding: .2 would be too fat for something .13 deep)
  mouse: { label: 'Mouse', mobility: 'movable', mass: .09, material: 'plastic', colliders: [{ shape: 'box', size: [.05, .02, .08], at: [0, .01, 0] }], surface: false, radius: .04, rests: 'surface' },
  cup: { label: 'Cup', mobility: 'movable', mass: .25, material: 'ceramic', colliders: [{ shape: 'cylinder', radius: .045, height: .1, at: [0, .05, 0] }], surface: false, radius: .06, rests: 'surface' },
  // furniture that comes in sizes (shapes.ts), sized in plan pixels: [width, depth], or for a plant [how big]. It blocks walking where it stands.
  'table-dining': { label: 'Dining table', mobility: 'movable', mass: 20, material: 'wood', ...tableShape(30, 34, .74), sized: ([w, d]) => tableShape(w, d, .74), surface: true, radius: .05, rests: 'floor' },
  'table-coffee': { label: 'Coffee table', mobility: 'movable', mass: 12, material: 'wood', ...tableShape(40.5, 20, .42), sized: ([w, d]) => tableShape(w, d, .42), surface: true, radius: .05, rests: 'floor' },
  'table-bar': { label: 'Bar table', mobility: 'movable', mass: 12, material: 'wood', ...barTableShape(44, 26), sized: ([w, d]) => barTableShape(w, d), surface: true, radius: .05, rests: 'floor' },
  sofa: { label: 'Sofa', mobility: 'movable', mass: 70, material: 'fabric', ...sofaShape(48, 16), sized: ([l, d]) => sofaShape(l, d), surface: true, radius: .05, rests: 'floor' },
  couch: { label: 'Couch', mobility: 'movable', mass: 50, material: 'fabric', ...sofaShape(27, 17.5), sized: ([l, d]) => sofaShape(l, d), surface: true, radius: .05, rests: 'floor' },
  armchair: { label: 'Armchair', mobility: 'movable', mass: 30, material: 'fabric', ...sofaShape(16.1, 15.5), sized: ([l, d]) => sofaShape(l, d), surface: true, radius: .05, rests: 'floor' },
  'plant-floor': { label: 'Plant', mobility: 'movable', mass: 15, material: 'ceramic', ...plantShape(1), sized: ([big]) => plantShape(big), surface: false, radius: .05, rests: 'floor' },
  console: {
    label: 'Game console', mobility: 'movable', mass: 4.5, material: 'plastic', surface: false, radius: .05, rests: 'floor',
    colliders: [{ shape: 'box', size: [.26, .02, .14], at: [0, .01, -.0205] }, { shape: 'box', size: [.16, .4, .25], at: [0, .22, -.0205] }],
    foot: [4, 3.5], // (the obstacle it was: 7 by 8 plan pixels, turned with it to face east)
  },
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
/** The shape of this item: its kind's, or for a kind that comes in sizes, the one for its own `dims`. */
export function shapeOf(o: { type: string; dims?: readonly number[] }): Shape {
  const t = CATALOGUE[o.type];
  if (!t) throw new Error(`unknown item type "${o.type}"`);
  if (!t.sized || !o.dims) return t;
  const key = o.type + ':' + o.dims.join(',');
  let s = sizedShapes.get(key);
  if (!s) { s = t.sized(o.dims); sizedShapes.set(key, s); }
  return s;
}
const sizedShapes = new Map<string, Shape>(); // (a handful of sizes, made once each)
/** Can a player move this kind of thing at all? (Whether they may move *this one* depends on who owns its station: see the server.) */
export const isMovableType = (type: string): boolean => CATALOGUE[type]?.mobility === 'movable';
/** How one person carries this kind of thing, from its mass; undefined for a kind that does not exist. */
export function carryOf(type: string): Carry | undefined {
  const t = CATALOGUE[type];
  if (!t) return undefined;
  if (t.mobility === 'fixed') return 'fixed';
  return t.mass <= CARRY_LIMITS.oneHand ? 'one-hand' : t.mass <= CARRY_LIMITS.twoHands ? 'two-hands' : 'drag';
}
