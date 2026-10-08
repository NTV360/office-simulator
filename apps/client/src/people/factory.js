import { TAU, pick, random, rnd } from '@office/shared';
import { buildBody } from '../character/rig.js';
import { randomSpec } from '../character/spec.js';
import { FIRST, LAST, roleBag } from './data.js';
import { HAZEL_NAME, applyHazel } from './hazel.js';
import { SCREENS } from '../render/screens.js';
import { deskPool, people, peopleGroup } from '../sim/state.js';
import { endTask } from '../sim/tasks.js';
import { select, selected } from '../ui/person.js';

let nameIdx = 0;

function makePerson() {
  const seat = deskPool.find(s => !s.owner); if (!seat) return null;
  let role = pick(roleBag);
  const spec = randomSpec(role);
  let first = FIRST[nameIdx % FIRST.length], last = LAST[(nameIdx * 7 + 3) % LAST.length] + '.';
  if (nameIdx === 0) ({ first, last, role } = applyHazel(spec));
  nameIdx++;
  const body = buildBody(spec);
  const p = {
    id: people.length, name: `${first} ${last}`, role, spec, body, seat,
    pos: seat.pos.clone(), face: seat.face, faceGoal: seat.face, speed: rnd(1.15, 1.45),
    state: 'away', task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: random() * TAU, animT: random() * 10,
    pose: {}, arriveAt: 0, leaveAt: 0, lunchAt: 0, hadLunch: false, arrivedAt: null, coffees: 0, chatWith: null,
    screenKind: role.includes('Designer') ? 'design' : role === 'DevOps' ? 'dash' : 'code',
  };
  p.screenMat = pick(SCREENS[p.screenKind]);
  seat.owner = p;
  body.root.traverse(o => { if (o.isMesh) o.userData.person = p; });
  body.root.visible = false; body.ring.visible = false;
  peopleGroup.add(body.root); peopleGroup.add(body.ring);
  scheduleDay(p);
  people.push(p);
  return p;
}
function removePerson() {
  const p = people.pop(); if (!p) return;
  endTask(p); p.seat.owner = null; p.seat.screen.material = SCREENS.off;
  peopleGroup.remove(p.body.root); peopleGroup.remove(p.body.ring);
  if (selected === p) select(null);
}
function scheduleDay(p) {
  p.arriveAt = rnd(7 * 60 + 50, 9 * 60 + 35); p.leaveAt = rnd(17 * 60 + 10, 18 * 60 + 50);
  p.lunchAt = rnd(11 * 60 + 45, 12 * 60 + 40); p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = 19 * 60 + 2; // Hazel is always the last one out
}

export { makePerson, removePerson, scheduleDay };
