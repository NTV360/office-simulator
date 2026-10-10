import { initGrid } from '../nav/grid';
import { interactables } from './interactables';
import { isHelper } from './person';
import { initState, people, resetSim } from './state';
import { endTask } from './tasks';
import { mkSpot, type SpotOptions } from './spots';

// A small, fully equipped office for tests and for a server with no client: open floor, no furniture, but one of
// everything the simulation looks for. Spots sit on a loose grid in the open top part of the floor plan.
//
//   buildTestLayout({ desks: 40 })   then   initDay()  (or makeStaff() by hand)

/** Take the office helper out, for tests about staff, ids and desks that count everyone (she has no desk and is not saved). */
export function removeHelper(): void {
  const i = people.findIndex(isHelper);
  if (i < 0) return;
  endTask(people[i]); people.splice(i, 1);
}

export interface TestLayoutOptions {
  /** How many desks (staff slots). The default simulation start needs 40. */
  desks?: number;
  /** Extra desks reserved for the HR department (the real office has six), made after the ordinary ones. Default 0. */
  hr?: number;
}

export function buildTestLayout({ desks = 40, hr = 0 }: TestLayoutOptions = {}): void {
  interactables.clear();
  resetSim();
  initGrid([]);

  const COLS = 28, X0 = 150, Y0 = 130, STEP = 18;
  let n = 0;
  const next = (): [number, number] => { const i = n++; return [X0 + (i % COLS) * STEP, Y0 + Math.floor(i / COLS) * STEP]; };
  const put = (kind: string, count: number, opts: SpotOptions = {}) => {
    for (let i = 0; i < count; i++) { const [x, y] = next(); mkSpot(kind, x, y, 0, opts); }
  };

  for (let i = 0; i < desks + hr; i++) {
    const [x, y] = next();
    const spot = mkSpot('desk', x, y, 0, { sit: true, place: `Desk ${String(i + 1).padStart(2, '0')}`, shared: false });
    // like the real office: seat ids, and the HR desks (made last) belong to the HR department
    spot.deskId = `T${i + 1}`; spot.label = `Desk T${i + 1}`; spot.department = i >= desks ? 'Human Resources' : null;
  }
  put('counter', 2);
  put('sink', 2);
  put('snack', 1);
  put('bucket', 1);
  // two whiteboards with three standing spots each (the first is the presenter's)
  for (const g of ['wb0', 'wb1']) put('whiteboard', 3, { group: g });
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
  put('conf', 8, { sit: true, room: 1 }); // (room 2 is the HR office: desks, not meeting seats)
  put('conf', 8, { sit: true, room: 3 });
  { const [x, y] = next(); mkSpot('exit', x, y, 0, { shared: false, place: 'the exit' }); }

  initState();
}
