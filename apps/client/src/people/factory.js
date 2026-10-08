import { FIRST, LAST, SCREEN_VARIANTS, TAU, isStaff, newProps, pick, randomSpec, random, rnd, roleBag } from '@office/shared';
import { buildBody } from '../character/rig.js';
import { HAZEL_NAME, applyHazel } from './hazel.js';
import { deskPool, people } from '../sim/state.js';
import { peopleGroup } from './group.js';
import { endTask } from '../sim/tasks.js';
import { select, selected } from '../ui/person.js';

let nameIdx = 0;

function makePerson() {
  const slot = deskPool.find(s => !s.owner); if (!slot) return null;
  let role = pick(roleBag);
  const spec = randomSpec(role);
  let first = FIRST[nameIdx % FIRST.length], last = LAST[(nameIdx * 7 + 3) % LAST.length] + '.';
  if (nameIdx === 0) ({ first, last, role } = applyHazel(spec));
  nameIdx++;
  const body = buildBody(spec);
  const p = {
    id: people.filter(isStaff).length, controller: 'ai', name: `${first} ${last}`, role, spec, body, slot,
    pos: slot.pos.clone(), face: slot.face, faceGoal: slot.face, speed: rnd(1.15, 1.45),
    state: 'away', shown: false, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: random() * TAU, animT: random() * 10,
    pose: {}, arriveAt: 0, leaveAt: 0, lunchAt: 0, hadLunch: false, arrivedAt: null, coffees: 0, chatWith: null,
    screenKind: role.includes('Designer') ? 'design' : role === 'DevOps' ? 'dash' : 'code',
  };
  p.screenVariant = Math.floor(random() * SCREEN_VARIANTS[p.screenKind]); // same single draw as picking from the list
  slot.owner = p;
  body.root.traverse(o => { if (o.isMesh) o.userData.person = p; });
  peopleGroup.add(body.root); peopleGroup.add(body.ring);
  scheduleDay(p);
  people.push(p);
  return p;
}
function removePerson() {
  let i = people.length - 1; while (i >= 0 && !isStaff(people[i])) i--; // the last staff member (the player, if there is one, stays)
  if (i < 0) return;
  const [p] = people.splice(i, 1);
  endTask(p); p.slot.owner = null;
  peopleGroup.remove(p.body.root); peopleGroup.remove(p.body.ring);
  if (selected === p) select(null);
}
function scheduleDay(p) {
  p.arriveAt = rnd(7 * 60 + 50, 9 * 60 + 35); p.leaveAt = rnd(17 * 60 + 10, 18 * 60 + 50);
  p.lunchAt = rnd(11 * 60 + 45, 12 * 60 + 40); p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = 19 * 60 + 2; // Hazel is always the last one out
}

export { makePerson, removePerson, scheduleDay };
