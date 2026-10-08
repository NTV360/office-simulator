import { initGrid } from '../nav/grid';
import { interactables } from './interactables';
import { initState, resetSim } from './state';
import { mkSpot, type SpotOptions } from './spots';

// A small, fully equipped office for tests and for a server with no client: open floor, no furniture, but one of
// everything the simulation looks for. Spots sit on a loose grid in the open top part of the floor plan.
//
//   buildTestLayout({ desks: 40 })   then   initDay()  (or makeStaff() by hand)

export interface TestLayoutOptions {
  /** How many desks (staff slots). The default simulation start needs 40. */
  desks?: number;
}

export function buildTestLayout({ desks = 40 }: TestLayoutOptions = {}): void {
  interactables.clear();
  resetSim();
  initGrid([]);

  const COLS = 28, X0 = 150, Y0 = 130, STEP = 18;
  let n = 0;
  const next = (): [number, number] => { const i = n++; return [X0 + (i % COLS) * STEP, Y0 + Math.floor(i / COLS) * STEP]; };
  const put = (kind: string, count: number, opts: SpotOptions = {}) => {
    for (let i = 0; i < count; i++) { const [x, y] = next(); mkSpot(kind, x, y, 0, opts); }
  };

  for (let i = 0; i < desks; i++) { const [x, y] = next(); mkSpot('desk', x, y, 0, { sit: true, place: `Desk ${String(i + 1).padStart(2, '0')}`, shared: false }); }
  put('counter', 2);
  put('sink', 2);
  put('locker', 2);
  put('storage', 1);
  put('bar', 4, { sit: true });
  put('booth', 2);
  put('dining', 6, { sit: true });
  put('darts', 2);
  put('golf', 2);
  put('lounge', 12, { sit: true });
  // the simulation treats lounge spots 5 to 8 as the game seats
  interactables.of('lounge').forEach((s, i) => { if (i >= 5 && i <= 8) s.game = true; });
  { const [x, y] = next(); mkSpot('piano', x, y, 0, { sit: true, group: 'music' }); }
  { const [x, y] = next(); mkSpot('guitar', x, y, 0, { sit: true, group: 'music' }); }
  put('conf', 8, { sit: true, room: 1 });
  put('conf', 5, { sit: true, room: 2 });
  put('conf', 8, { sit: true, room: 3 });
  { const [x, y] = next(); mkSpot('exit', x, y, 0, { shared: false, place: 'the exit' }); }

  initState();
}
