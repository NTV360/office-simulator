import type { Person } from './types';
import type { WorldObject } from '../world/objects';

/** Process-local occupancy for unregistered furniture supports. */
const occupants = new Map<WorldObject, Person>();

export const freeSitOccupant = (o: WorldObject): Person | undefined => occupants.get(o);
export const freeSitIsOccupied = (o: WorldObject): boolean => occupants.has(o);
export const freeSitSetOccupant = (o: WorldObject, p: Person): void => { occupants.set(o, p); };
export const freeSitClearOccupant = (o: WorldObject): void => { occupants.delete(o); };
/** Clear transient free-sit state when the simulation is rebuilt. */
export const resetFreeSitState = (): void => { occupants.clear(); };
