import type { Person } from './types';

/** Things the simulation announces so the client (or later the server) can react without the simulation knowing about them. */
export interface SimEvents {
  /** A staff member was created (their desk is taken, they are not yet in the building). */
  personAdded: Person;
  /** A staff member was removed (their desk is free again). */
  personRemoved: Person;
}

type Listeners = { [K in keyof SimEvents]: Array<(p: SimEvents[K]) => void> };
const listeners: Listeners = { personAdded: [], personRemoved: [] };

export const simEvents = {
  /** Listen to an event. Returns a function that stops listening. */
  on<K extends keyof SimEvents>(name: K, fn: (arg: SimEvents[K]) => void): () => void {
    listeners[name].push(fn);
    return () => { const i = listeners[name].indexOf(fn); if (i >= 0) listeners[name].splice(i, 1); };
  },
  emit<K extends keyof SimEvents>(name: K, arg: SimEvents[K]): void {
    for (const fn of listeners[name].slice()) fn(arg);
  },
  /** Drop every listener (tests). */
  clear(): void { listeners.personAdded.length = 0; listeners.personRemoved.length = 0; },
};
