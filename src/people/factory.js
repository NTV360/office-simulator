import { TAU, pick, rnd, seededRandom } from '../core/util.js';
import { buildBody, disposeBody } from '../character/rig.js';
import { normalizeSpec, randomSpec } from '../character/spec.js';
import { FIRST, LAST, roleBag } from './data.js';
import { HAZEL_NAME, applyHazel } from './hazel.js';
import { helperIdentity } from './helper.js';
import { fullName, jobTitle, roster, simRole, unplacedEmployees } from './roster.js';
import { SCREENS } from '../render/screens.js';
import { deskPool, people, peopleGroup } from '../sim/state.js';
import { liveSchedule, usesAttendance } from '../sim/live.js';
import { DAY_END, shiftWindow } from '../sim/schedule.js';
import { endTask, goWork } from '../sim/tasks.js';
import { ENTRY } from '../world/entrance.js';
import { select, selected } from '../ui/person.js';

let nameIdx = 0;

function makePerson() {
  if (!deskPool.some(s => !s.owner)) return null;
  const placed = roster.list ? nextSeated() : (w => w && { who: w, seat: seatFor(w) })(madeUp());
  if (!placed?.seat) return null;
  return createPerson(placed.who, placed.seat);
}
// Our helper (people/helper.js): not on the staff list and without a desk; she cleans all day instead.
function makeHelper() {
  const p = createPerson(helperIdentity(), null);
  p.helper = true;
  return p;
}
function createPerson(who, seat) {
  const { name, role, title, userId, department, shift, photo, spec } = who;
  const body = buildBody(spec), at = seat ?? { pos: ENTRY, face: Math.PI };
  const p = {
    id: people.length, name, role, title, userId, department, shift, photo: photo ?? null, spec, body, seat,
    pos: at.pos.clone(), face: at.face, faceGoal: at.face, speed: rnd(1.15, 1.45),
    state: 'away', task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: Math.random() * TAU, animT: Math.random() * 10,
    pose: {}, arriveAt: 0, leaveAt: 0, lunchAt: 0, hadLunch: false, arrivedAt: null, coffees: 0, chatWith: null,
    screenKind: role.includes('Designer') ? 'design' : role === 'DevOps' ? 'dash' : 'code',
  };
  p.screenMat = pick(SCREENS[p.screenKind]);
  if (seat) seat.owner = p;
  body.root.traverse(o => { if (o.isMesh) o.userData.person = p; });
  body.root.visible = false; body.ring.visible = false;
  peopleGroup.add(body.root); peopleGroup.add(body.ring);
  scheduleDay(p);
  people.push(p);
  return p;
}
// A real employee: their name, department (shown as their job) and their saved look (or a generated one that is
// the same on every load, seeded by their id). Hazel, if she works here, keeps her furious face.
function employee(e) {
  const role = simRole(e.department), title = jobTitle(e);
  const hazel = fullName(e).toLowerCase() === HAZEL_NAME.toLowerCase(), name = hazel ? HAZEL_NAME : fullName(e);
  let spec = e.character ?? randomSpec(role, seededRandom(e.userId));
  if (hazel) spec = e.character ? normalizeSpec({ ...e.character, angry: true }) : applyHazel().spec;
  return { name, role, title, userId: e.userId, department: e.department, desk: e.desk, shift: e.shift ?? null, photo: e.photo ?? null, spec };
}
// The next employee not yet in the office who has a desk to go to (one without a free desk is skipped).
function nextSeated() {
  for (const e of unplacedEmployees(people)) { const who = employee(e), seat = seatFor(who); if (seat) return { who, seat }; }
  return null;
}
// No staff list (API unavailable): made-up names and roles, and the first person is Hazel.
function madeUp() {
  let role = pick(roleBag), spec = randomSpec(role);
  let first = FIRST[nameIdx % FIRST.length], last = LAST[(nameIdx * 7 + 3) % LAST.length] + '.';
  if (nameIdx === 0) ({ first, last, role, spec } = applyHazel());
  nameIdx++;
  return { name: `${first} ${last}`, role, title: role, userId: null, department: null, desk: null, shift: null, spec };
}

// Where someone sits: the desk they chose, else a free one. Department desks (the HR office) are only for
// that department, and desks other employees chose stay free for them.
function seatFor(who) {
  const chosen = new Set((roster.list ?? []).filter(e => e.desk && e.userId !== who.userId).map(e => e.desk));
  const open = s => !s.owner && !chosen.has(s.deskId);
  return deskPool.find(s => s.deskId === who.desk && !s.owner)
    ?? deskPool.find(s => open(s) && s.department && s.department === who.department)
    ?? deskPool.find(s => open(s) && !s.department) ?? null;
}
const seatById = id => deskPool.find(s => s.deskId === id) ?? null;

// Move someone to another desk (chosen in the character lab). Whoever sat there takes their old desk.
// Anyone working at a desk that changed walks over to the new one.
function moveToDesk(p, seat) {
  if (!seat || seat === p.seat) return;
  const old = p.seat, other = seat.owner;
  seat.owner = p; p.seat = seat;
  old.owner = other ?? null; if (other) other.seat = old;
  for (const q of [p, other]) if (q && (q.task?.kind === 'work' || q.task?.kind === 'lunchDesk') && q.state !== 'away') { endTask(q); goWork(q); }
}

// Give a person a new look in place (after they save one in the character lab).
function restylePerson(p, spec) {
  const old = p.body, body = buildBody(spec);
  body.root.visible = old.root.visible; body.ring.visible = old.ring.visible; body.ring.material = old.ring.material;
  for (const k of ['mug', 'phone', 'pad', 'putter', 'guitar', 'bucket', 'rag', 'mop']) body[k].visible = old[k].visible;
  body.root.traverse(o => { if (o.isMesh) o.userData.person = p; });
  peopleGroup.remove(old.root, old.ring); peopleGroup.add(body.root, body.ring); disposeBody(old);
  p.spec = spec; p.body = body; p.pose = {};
}

// Remove the last employee (never the helper).
function removePerson() {
  const i = people.findLastIndex(q => !q.helper); if (i < 0) return;
  const [p] = people.splice(i, 1);
  endTask(p); p.seat.owner = null; p.seat.screen.material = SCREENS.off;
  peopleGroup.remove(p.body.root); peopleGroup.remove(p.body.ring); disposeBody(p.body);
  if (selected === p) select(null);
}
// Today's times from their shift: arrive around the start, lunch about three hours in, leave around the end.
function scheduleDay(p) {
  const { start, end } = shiftWindow(p.shift);
  p.shiftStart = start;
  p.arriveAt = start + rnd(-20, 12); p.leaveAt = Math.min(DAY_END - 3, end + rnd(0, 20));
  p.lunchAt = start + 3 * 60 + rnd(0, 25); p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = Math.min(DAY_END - 3, end + 62); // Hazel is always the last one out
  if (usesAttendance() && p.userId) liveSchedule(p); // Live: real clock-in and clock-out times instead
}

export { makeHelper, makePerson, moveToDesk, removePerson, restylePerson, scheduleDay, seatById };
