import type { Vec3 } from '../vec3';

// Everything a person (staff or player) can walk to and use: desks, chairs, counters, games...
// Spots are registered by kind when they are created (see mkSpot). Future kinds such as shop
// counters register the same way and can carry their own behaviour.

/** A place a person can walk to and use. Kinds add their own fields (a conference seat has a room, a game spot has `game`). */
export interface Spot {
  kind: string;
  /** Stable id: the kind plus the spot's place in creation order, e.g. 'desk:3'. Set by `add`. */
  id: string;
  pos: Vec3;
  approach: Vec3;
  face: number;
  sit: boolean;
  hipY: number;
  place: string;
  shared: boolean;
  occupant: unknown;
  room?: number;
  group?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
}

const byKind = new Map<string, Spot[]>();
const EMPTY: Spot[] = [];

/** A spot is listed under its kind, and also under spot.group if it has one (e.g. 'piano' and 'guitar' are both in 'music'). */
function add<T extends Omit<Spot, 'id'>>(spot: T): T & { id: string } {
  const withId = spot as T & { id: string };
  withId.id = `${spot.kind}:${of(spot.kind).length}`; // stable: kind plus position in creation order
  for (const k of spot.group ? [spot.kind, spot.group] : [spot.kind]) {
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(withId as unknown as Spot);
  }
  return withId;
}

/** All spots of a kind, in creation order. The array is live: don't mutate it. */
function of(kind: string): Spot[] { return byKind.get(kind) || EMPTY; }

/** Conference seats of one room (1-3). */
function conf(room: number): Spot[] { return of('conf').filter(s => s.room === room); }

/** Every kind that has at least one spot (used by the debug fingerprint). */
const kinds = (): string[] => [...byKind.keys()];

/** Forget every spot (tests build a small layout from scratch). */
function clear(): void { byKind.clear(); }

export const interactables = { add, of, conf, kinds, clear };
