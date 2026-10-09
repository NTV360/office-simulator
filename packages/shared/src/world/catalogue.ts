// The kinds of world object, as data. Nothing here draws anything (the page does that, from the type's name) and nothing here is a rule
// of the simulation: it says what can be moved, how big it is and what it rests on, so the team can change it without touching code.
// See docs/PHASE-5-BREAKDOWN.md.

export type Mobility = 'fixed' | 'movable';
export type Weight = 'light' | 'medium' | 'heavy';
/** Chairs and stools stand on the floor; small things stand on a table. */
export type Rests = 'floor' | 'surface';

export interface ObjectType {
  label: string;
  /** Fixed things are objects too (saved, drawn, used the same way) but players cannot move them. */
  mobility: Mobility;
  weight: Weight;
  /** How much room it takes, as a radius in metres: two objects may not be put closer than the sum of their radii. */
  radius: number;
  rests: Rests;
}

export const CATALOGUE: Readonly<Record<string, ObjectType>> = {
  'chair-office': { label: 'Office chair', mobility: 'movable', weight: 'medium', radius: .3, rests: 'floor' },
  'chair-wood': { label: 'Dining chair', mobility: 'movable', weight: 'medium', radius: .26, rests: 'floor' },
  'stool-bar': { label: 'Bar stool', mobility: 'movable', weight: 'medium', radius: .22, rests: 'floor' },
  mug: { label: 'Mug', mobility: 'movable', weight: 'light', radius: .06, rests: 'surface' },
  notebook: { label: 'Notebook', mobility: 'movable', weight: 'light', radius: .14, rests: 'surface' },
  'plant-desk': { label: 'Desk plant', mobility: 'movable', weight: 'light', radius: .1, rests: 'surface' },
};

/** The height of a desk top, in metres: what a small thing placed on a desk stands on. */
export const DESK_TOP = .76;

export const typeOf = (type: string): ObjectType | undefined => CATALOGUE[type];
/** Can a player move this kind of thing at all? (Whether they may move *this one* depends on who owns its station: see the server.) */
export const isMovableType = (type: string): boolean => CATALOGUE[type]?.mobility === 'movable';
