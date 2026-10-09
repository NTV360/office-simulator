import { normalizeSpec, DEFAULT_SPEC, type CharacterSpec } from '../character/spec';
import { Vec3 } from '../vec3';
import { simEvents } from './events';
import { scheduleDay } from './factory';
import { newProps } from './props';
import { allocatePersonId, meetings, people, sim } from './state';
import { ENTRY } from './spots';
import { endTask } from './tasks';
import type { Person } from './types';

// A human taking over a person, handing them back, and a guest (a human with no desk). See docs/PHASE-3-BREAKDOWN.md, step 3.
// These change the simulation's people only; who is allowed to, and when (logins, the grace period), is the server's business.

/**
 * A human takes over this person, where they are right now: no teleport. Whatever they were doing stops cleanly (props put
 * down, seats and meetings left). A person who has not come in for the day appears at the entrance, which counts as their
 * arrival. Does nothing if a human already drives them.
 */
export function takeControl(p: Person): void {
  if (p.controller === 'account') return;
  endTask(p); // runs the task's end hook: props down, a shared seat freed
  leaveMeeting(p);
  clearChatsWith(p);
  p.controller = 'account';
  p.drivenOnDay = sim.day;
  p.state = 'controlled';
  p.task = null; p.path = null; p.pi = 0; p.queue = [];
  p.chatWith = null;
  if (!p.shown || p.arrivedAt == null) {
    // not in the building yet (or gone home): they walk in the door
    p.pos = new Vec3(ENTRY.x, 0, ENTRY.z);
    p.face = p.faceGoal = Math.PI;
    p.arrivedAt = p.arrivedAt ?? sim.t;
  }
  p.shown = true;
  simEvents.emit('personUpdated', p);
}

/**
 * The human has gone: the person carries on by themselves from where they stand. (A guest has no desk, so for a guest "gone"
 * means removed.) They are idle, so the simulation picks
 * what they do next (and if it is past their leaving time, they head home).
 */
export function handBack(p: Person): void {
  if (p.controller === 'ai') return;
  if (!p.slot) { removeGuest(p); return; } // a guest has no desk to go back to: they are simply gone
  endTask(p); // a seat the human was in is freed
  p.controller = 'ai';
  p.state = 'idle';
  p.task = null; p.path = null; p.pi = 0; p.queue = []; p.until = 0;
  p.chatWith = null;
  p.arrivedAt = p.arrivedAt ?? sim.t;
  p.shown = true;
  if (p.drivenOnDay !== undefined && p.drivenOnDay !== sim.day) {
    // they were played across a day change, which only resets people the simulation drives: give them today's schedule
    // (they are already in, so they are not due to arrive again)
    scheduleDay(p);
    p.arriveAt = sim.t; p.arrivedAt = sim.t; p.hadLunch = sim.t >= 14 * 60;
  }
  delete p.drivenOnDay;
  simEvents.emit('personUpdated', p);
}

/** A human with no desk yet: a person at the entrance who exists only while they are connected. */
export function makeGuest(accountId: number, name: string, spec?: unknown): Person {
  const guest: Person = {
    id: allocatePersonId(), name, role: 'Guest', controller: 'account', owner: accountId, spec: spec === undefined ? { ...DEFAULT_SPEC } : normalizeSpec(spec),
    pos: new Vec3(ENTRY.x, 0, ENTRY.z), face: Math.PI, faceGoal: Math.PI, speed: 1.5,
    state: 'controlled', shown: true, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [],
    walkPhase: 0, animT: 0, pose: {}, arriveAt: sim.t, leaveAt: 24 * 60, lunchAt: 0, hadLunch: true, arrivedAt: sim.t, coffees: 0,
    chatWith: null, meeting: null, screenKind: 'code', screenVariant: 0,
  };
  people.push(guest);
  simEvents.emit('personAdded', guest);
  return guest;
}

/** A guest disconnects and is gone. */
export function removeGuest(p: Person): void {
  endTask(p);
  leaveMeeting(p);
  clearChatsWith(p);
  const i = people.indexOf(p);
  if (i >= 0) people.splice(i, 1);
  simEvents.emit('personRemoved', p);
}

/** Give a person a new look (the account's character), as everyone is told. */
export function setLook(p: Person, spec: unknown): CharacterSpec {
  p.spec = normalizeSpec(spec);
  simEvents.emit('personUpdated', p);
  return p.spec;
}

function leaveMeeting(p: Person): void {
  for (const m of meetings) {
    m.members = m.members.filter(x => x !== p);
    if (m.speaker === p) m.speaker = null;
  }
  p.meeting = null;
}

/** Anyone who thought p was chatting with them (at their desk) or walking over to p forgets it. */
function clearChatsWith(p: Person): void {
  for (const q of people) {
    if (q.chatWith === p) q.chatWith = null;
    if (q.task?.partner === p) delete q.task.partner;
  }
}
