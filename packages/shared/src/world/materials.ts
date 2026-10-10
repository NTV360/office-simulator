// What things are made of, as far as the physics cares: how much a surface grips and how much it bounces. Two numbers per material, so
// the team can tune them without touching code. When two things touch, their values are averaged (Rapier's default rule).
// See docs/ITEMS-PHYSICS-PLAN.md, section 4.

export type MaterialName = 'wood' | 'metal' | 'plastic' | 'ceramic' | 'glass' | 'fabric' | 'paper' | 'fruit' | 'rubber';

export interface Material {
  /** Coulomb friction μ: a thing on a tilted surface starts to slide once tan(tilt) > μ. */
  friction: number;
  /** Restitution: 0 lands dead, 1 bounces back as high as it fell. */
  bounce: number;
}

export const MATERIALS: Readonly<Record<MaterialName, Material>> = {
  wood: { friction: .5, bounce: .25 },
  metal: { friction: .4, bounce: .2 },
  plastic: { friction: .4, bounce: .35 },
  ceramic: { friction: .45, bounce: .1 },
  glass: { friction: .3, bounce: .2 },
  fabric: { friction: .7, bounce: .05 },
  paper: { friction: .5, bounce: .02 },
  fruit: { friction: .6, bounce: .3 },
  rubber: { friction: .9, bounce: .6 },
};

/** The friction between two materials in contact: the average, as the physics engine combines them. */
export const frictionBetween = (a: MaterialName, b: MaterialName): number => (MATERIALS[a].friction + MATERIALS[b].friction) / 2;

/** The steepest tilt, in radians, at which a thing of material `a` resting on `b` still holds by friction alone (before it slides). */
export const slipAngle = (a: MaterialName, b: MaterialName): number => Math.atan(frictionBetween(a, b));
