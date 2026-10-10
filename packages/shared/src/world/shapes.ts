import { S } from '../plan';
import type { Collider, Shape } from './catalogue';

// The solid shapes of the furniture that comes in sizes, made from its size the same way the page draws it (apps/client/src/world/furniture).
// Sizes are in plan pixels, as the furniture code gives them, so that a footprint is exactly the obstacle the same furniture used to be.
// Every shape stands on its origin (its lowest point is 0). See docs/ITEMS-PHYSICS-PLAN.md, step 4.

const legs = (w: number, d: number, h: number, inset: number, t: number): Collider[] =>
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]): Collider => ({ shape: 'box', size: [t, h, t], at: [a * (w / 2 - inset), h / 2, b * (d / 2 - inset)] }));

/** A table on four legs, `wPx` by `dPx`, its top `h` high (conference.js table()): the top board and the legs. */
export function tableShape(wPx: number, dPx: number, h: number): Shape {
  const w = wPx * S, d = dPx * S;
  return {
    colliders: [{ shape: 'box', size: [w, .045, d], at: [0, h - .02, 0] }, ...legs(w, d, h - .04, .07, .05)],
    foot: [wPx / 2, dPx / 2],
    top: { y: h + .0025, hw: w / 2, hd: d / 2 },
  };
}

/** A tall bar table, `wPx` by `dPx` (bar.js barTable()): a foot plate, a pole and the top. */
export function barTableShape(wPx: number, dPx: number): Shape {
  const w = wPx * S, d = dPx * S;
  return {
    colliders: [{ shape: 'box', size: [w * .6, .03, d * .6], at: [0, .015, 0] }, { shape: 'cylinder', radius: .05, height: 1.0, at: [0, .5, 0] }, { shape: 'box', size: [w, .05, d], at: [0, 1.03, 0] }],
    foot: [wPx / 2, dPx / 2],
    top: { y: 1.055, hw: w / 2, hd: d / 2 },
  };
}

/**
 * A sofa or an armchair, `lenPx` long and `depPx` deep, in its own frame facing +z (lounge.js sofa()): the base, the cushion, the back
 * along the rear, an arm at each end. (The base goes down to the floor: it stands on its short feet.)
 */
export function sofaShape(lenPx: number, depPx: number): Shape {
  const len = lenPx * S, dep = depPx * S;
  return {
    colliders: [
      { shape: 'box', size: [len, .31, dep], at: [0, .155, 0] },
      { shape: 'box', size: [len - .12, .12, dep - .14], at: [0, .37, .04], material: 'fabric' },
      { shape: 'box', size: [len, .42, .16], at: [0, .55, -dep / 2 + .08], material: 'fabric' },
      { shape: 'box', size: [.13, .3, dep], at: [len / 2 - .065, .42, 0] },
      { shape: 'box', size: [.13, .3, dep], at: [-(len / 2 - .065), .42, 0] },
    ],
    foot: [lenPx / 2, depPx / 2],
    top: { y: .43, hw: Math.max(.05, len / 2 - .13), hd: Math.max(.05, dep / 2 - .16) }, // (the cushion: a cup can be left on a sofa)
  };
}

/** A floor plant in its pot, `big` times the usual size (basics.js plant()): the pot, and the leaves as one ball (smaller than they look: plants stand in corners). */
export function plantShape(big: number): Shape {
  return {
    colliders: [{ shape: 'cylinder', radius: .17 * big, height: .38 * big, at: [0, .19 * big, 0] }, { shape: 'sphere', radius: .16 * big, at: [0, .64 * big, 0], material: 'fabric' }],
    foot: [6 * big, 6 * big],
  };
}

/**
 * A cabinet `wPx` by `dPx`, `h` high (cabinet.js cabinet()): the body, and the top board a little wider. `inset` makes it that much shallower
 * front and back, to the physics only: one storage cabinet is drawn 7 cm into the wall behind it, and would be pushed out of it.
 */
export function cabinetShape(wPx: number, dPx: number, h: number, inset = 0): Shape {
  const w = wPx * S, d = dPx * S, along = w >= d, iw = along ? 0 : 2 * inset, id = along ? 2 * inset : 0;
  return {
    colliders: [{ shape: 'box', size: [w - .02 - iw, h, d - .02 - id], at: [0, h / 2, 0] }, { shape: 'box', size: [w - .005 - iw, .03, d - .005 - id], at: [0, h + .015, 0] }],
    foot: [wPx / 2, dPx / 2],
    top: { y: h + .03, hw: w / 2, hd: d / 2 },
  };
}

/** A TV on a floor stand whose footprint is `alongPx` by `acrossPx` (tv.js tv()): the screen is as wide as the long side, at most 2.1 m. */
export function tvShape(alongPx: number, acrossPx: number): Shape {
  const w = Math.min(alongPx * S, 2.1), h = w * .56, yc = .95 + h / 2;
  return {
    colliders: [{ shape: 'box', size: [.5, .03, .32], at: [0, .015, -.02] }, { shape: 'box', size: [.07, yc, .05], at: [0, yc / 2, -.06] }, { shape: 'box', size: [w + .04, h + .04, .05], at: [0, yc, 0] }],
    foot: [alongPx / 2, acrossPx / 2],
  };
}
