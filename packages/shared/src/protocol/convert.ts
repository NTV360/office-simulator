import { PROP_KEYS } from '../sim/props';
import { interactables } from '../sim/interactables';
import { movedObjects, objects, resetAllObjects, setObjectPose, type WorldObject } from '../world/objects';
import type { Meeting, Person } from '../sim/types';
import { NONE, ONE_OFF_SPOT, PHOTO_URL, type LayoutCheck, type MeetingSnap, type ObjectPose, type PersonInfo, type PersonSnap } from './messages';

// Turning simulation objects into protocol records (server side).

let locked: (LayoutCheck & { objects: number }) | null = null;

function computeLayoutCheck(): LayoutCheck {
  const all = interactables.all();
  let h = 0x811c9dc5;
  const mix = (text: string) => { for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const s of all) mix(s.id + '@' + s.pos.x.toFixed(4) + ',' + s.pos.z.toFixed(4) + ';');
  for (const o of objects.all()) mix(o.id + ':' + o.type + '@' + o.home.x.toFixed(4) + ',' + o.home.z.toFixed(4) + ',' + o.home.rot.toFixed(4) + ';');
  return { spots: all.length, hash: h >>> 0 };
}

/**
 * Take the fingerprint of the layout as it is now and keep it. Call it once the starting layout is built, before anything is moved: a
 * chair that has been moved must not make a page that joins later disagree with the server about which office this is.
 */
export function lockLayoutCheck(): void { locked = { ...computeLayoutCheck(), objects: objects.count() }; }

/** A short fingerprint of the starting layout (spots, and where every object starts), to check the client and the server run the same office. */
export function layoutCheck(): LayoutCheck {
  // (a locked value only counts while the layout it was taken from is still the one loaded: a different layout built later is measured afresh)
  if (locked && locked.spots === interactables.all().length && locked.objects === objects.count()) return { spots: locked.spots, hash: locked.hash };
  return computeLayoutCheck();
}

/** Where an object is now, as the protocol says it. */
export const objectPose = (o: WorldObject): ObjectPose => ({ index: o.index, x: o.x, z: o.z, rot: o.rot, y: o.y, q: o.q ? [...o.q] : null, carriedBy: o.carriedBy ?? NONE, helpers: [...o.helpers] });

/** The objects that are not at home: what a new page is told. */
export const movedObjectPoses = (): ObjectPose[] => movedObjects().map(objectPose);

/** Put one object where the server says (an object we do not know is ignored). Returns the object, or null. */
export function applyObjectPose(p: ObjectPose): WorldObject | null {
  const o = objects.at(p.index);
  if (!o || ![p.x, p.z, p.rot, p.y].every(Number.isFinite) || (p.q && !p.q.every(Number.isFinite))) return null;
  o.carriedBy = p.carriedBy === NONE ? null : p.carriedBy;
  o.helpers = o.carriedBy === null ? [] : (p.helpers ?? []).filter(h => h !== NONE);
  setObjectPose(o, p.x, p.z, p.rot, p.y, p.q ? [...p.q] : null);
  return o;
}

/** A welcome: every object goes home, then the listed ones go where they are. */
export function applyObjectPoses(poses: readonly ObjectPose[]): void {
  resetAllObjects();
  for (const p of poses) applyObjectPose(p);
}

export function personInfo(p: Person): PersonInfo {
  return {
    id: p.id, name: p.name, role: p.role, title: p.title ?? p.role, department: p.department ?? '', photo: p.photo && PHOTO_URL.test(p.photo) ? p.photo : '', controller: p.controller, spec: p.spec,
    slot: p.slot ? interactables.indexOf(p.slot) : NONE,
    screenKind: p.screenKind, screenVariant: p.screenVariant, arriveAt: p.arriveAt,
  };
}

export function meetingSnap(m: Meeting): MeetingSnap {
  return { room: m.room, topic: m.topic, start: m.start, end: m.end, speaker: m.speaker ? m.speaker.id : NONE, members: m.members.map(p => p.id) };
}

/** The changing part of a person. `meetings` is the list being sent alongside, so the person can point into it. */
export function personSnap(p: Person, meetings: readonly Meeting[]): PersonSnap {
  const t = p.task;
  let spot = 0, oneOff: PersonSnap['oneOff'];
  if (t) {
    const i = interactables.indexOf(t.spot);
    if (i >= 0) spot = i + 1;
    else { spot = ONE_OFF_SPOT; oneOff = { x: t.spot.pos.x, z: t.spot.pos.z, face: t.spot.face, place: t.spot.place }; }
  }
  const meeting = t?.meeting ?? p.meeting;
  const snap: PersonSnap = {
    id: p.id, state: p.state, shown: p.shown, absent: !!p.absent, toilet: !!p.toiletUntil, x: p.pos.x, z: p.pos.z, face: p.face, walkPhase: p.walkPhase,
    kind: t ? t.kind : '', anim: t ? t.anim : '', cat: t ? t.cat : '', spot,
    partner: t?.partner ? t.partner.id : NONE, chatWith: p.chatWith ? p.chatWith.id : NONE,
    meeting: meeting ? meetings.indexOf(meeting) : NONE,
    props: PROP_KEYS.reduce((bits, k, i) => bits | (p.props[k] ? 1 << i : 0), 0),
    arrivedAt: p.arrivedAt == null ? NONE : p.arrivedAt, arriveAt: p.arriveAt, leaveAt: p.leaveAt, coffees: p.coffees,
  };
  if (oneOff) snap.oneOff = oneOff;
  return snap;
}
