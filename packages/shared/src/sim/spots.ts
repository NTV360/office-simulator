import { FRONT_Y, W } from '../plan';
import { interactables, type Spot } from './interactables';

export interface SpotOptions {
  /** Where to stand to use it, in plan pixels; defaults to the spot itself. */
  ap?: [number, number];
  sit?: boolean;
  hipY?: number;
  place?: string;
  shared?: boolean;
  room?: number;
  group?: string;
}

/** Register a spot at a floor-plan position (plan pixels) facing `face`. */
export function mkSpot(kind: string, px: number, py: number, face: number, o: SpotOptions = {}): Spot {
  return interactables.add({
    kind, pos: W(px, py), approach: o.ap ? W(o.ap[0], o.ap[1]) : W(px, py), face, sit: !!o.sit, hipY: o.hipY ?? .53,
    place: o.place || '', shared: o.shared !== false, occupant: null, room: o.room, group: o.group,
  }) as Spot;
}

/** Where people appear when they arrive in the morning (the door). */
export const ENTRY = W(223.5, FRONT_Y + 31);

/** The spot people walk to when they leave. Registered by the world (`buildEntrance`); undefined until then. */
export const exitSpot = (): Spot | undefined => interactables.of('exit')[0];
