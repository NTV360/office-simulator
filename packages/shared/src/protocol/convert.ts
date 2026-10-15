import { PROP_KEYS } from '../sim/props';
import { interactables } from '../sim/interactables';
import { addObject, detachObjectLinks, isAtHome, objects, resetAllObjects, restoreObjectLinks, setObjectPose, type WorldObject } from '../world/objects';
import type { Meeting, Person } from '../sim/types';
import type { PersonMechanicsSnap } from './messages';
import { NONE, ONE_OFF_SPOT, PHOTO_URL, type LayoutCheck, type MeetingSnap, type ObjectDefinition, type ObjectPose, type PersonInfo, type PersonSnap } from './messages';

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
export const objectPose = (o: WorldObject): ObjectPose => ({ index: o.index, x: o.x, z: o.z, rot: o.rot, y: o.y, q: o.q ? [...o.q] : null, carriedBy: o.carriedBy ?? NONE, helpers: [...o.helpers], ...(o.removed ? { removed: true } : {}) });

/** The objects that are not at home, including tombstones for consumed objects. */
export const movedObjectPoses = (): ObjectPose[] => objects.all().filter(o => o.removed || !isAtHome(o)).map(objectPose);

/** The catalogue and pose needed to recreate an object appended after the initial layout. */
export function objectDefinition(o: WorldObject): ObjectDefinition {
  return {
    index: o.index,
    type: o.type,
    variant: o.variant,
    station: o.station,
    spot: o.spot,
    ...(o.spots?.length ? { spots: [...o.spots] } : {}),
    ...(o.dims?.length ? { dims: [...o.dims] } : {}),
    pose: objectPose(o),
  };
}

/** Runtime-created objects, excluded from the immutable layout fingerprint. */
export const dynamicObjectDefinitions = (): ObjectDefinition[] => {
  const lockIsCurrent = locked !== null && locked.spots === interactables.all().length && locked.objects === objects.count();
  const first = lockIsCurrent ? locked!.objects : objects.count();
  return objects.all().filter(o => o.index >= first).map(objectDefinition);
};

/** Add a wire-created object once, checking that append order cannot be remapped. */
export function materializeObject(d: ObjectDefinition): WorldObject | null {
  if (d.index < 0 || !Number.isInteger(d.index) || d.index !== d.pose.index) return null;
  if (![d.pose.x, d.pose.z, d.pose.rot, d.pose.y].every(Number.isFinite) || (d.pose.q && !d.pose.q.every(Number.isFinite))) return null;
  const existing = objects.at(d.index);
  if (existing) {
    const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
    const sameDims = (a: readonly number[] | undefined, b: readonly number[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
    if (existing.type !== d.type || existing.variant !== d.variant || existing.station !== d.station || existing.spot !== d.spot
      || !sameList(existing.spots, d.spots) || !sameDims(existing.dims, d.dims)) return null;
    return applyObjectPose(d.pose);
  }
  if (d.index !== objects.count() || !d.type || !Number.isInteger(d.variant) || d.variant < 0
    || (d.dims !== undefined && (!d.dims.every(Number.isFinite) || d.dims.length > 8))) return null;
  try {
    const o = addObject({ type: d.type, variant: d.variant, station: d.station, spot: d.spot, spots: d.spots, dims: d.dims, x: d.pose.x, z: d.pose.z, rot: d.pose.rot, y: d.pose.y });
    if (o.index !== d.index) return null;
    return applyObjectPose(d.pose);
  } catch { return null; }
}

/** Put one object where the server says (an object we do not know is ignored). Returns the object, or null. */
export function applyObjectPose(p: ObjectPose): WorldObject | null {
  const o = objects.at(p.index);
  if (!o || ![p.x, p.z, p.rot, p.y].every(Number.isFinite) || (p.q && !p.q.every(Number.isFinite))) return null;
  const wasRemoved = o.removed;
  o.removed = p.removed === true;
  if (o.removed) detachObjectLinks(o);
  else if (wasRemoved) restoreObjectLinks(o);
  o.carriedBy = o.removed ? null : (p.carriedBy === NONE ? null : p.carriedBy);
  o.helpers = o.removed || o.carriedBy === null ? [] : (p.helpers ?? []).filter(h => h !== NONE);
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
function mechanicsSnap(p: Person): PersonMechanicsSnap | undefined {
  const m = p.mechanics;
  const full = m.health.head === 40 && m.health.body === 80 && m.health.leftArm === 35 && m.health.rightArm === 35 && m.health.leftLeg === 45 && m.health.rightLeg === 45;
  if (m.posture === 'standing' && m.crouchLevel === 0 && m.seatMode === 'none' && m.seatId === null && m.locomotion === 'grid'
    && m.grounded && m.verticalVelocity === 0 && m.jumpUntil === 0 && m.knockbackUntil === 0 && m.attack === null && m.dominantHand === 'right'
    && m.struggle === 0 && full && m.holdTarget === null && m.heldBy === null && (m.holdAz ?? 0) === 0 && (m.holdLift ?? 1) === 1 && m.inventoryRevision === 0) return undefined;
  return {
    posture: m.posture, crouchLevel: m.crouchLevel, seatMode: m.seatMode, seatId: m.seatId,
    locomotion: m.locomotion, grounded: m.grounded, verticalVelocity: m.verticalVelocity, jumpUntil: m.jumpUntil, knockbackUntil: m.knockbackUntil,
    attack: m.attack ? { ...m.attack } : null, dominantHand: m.dominantHand, struggle: m.struggle, health: { ...m.health },
    holdTarget: m.holdTarget, heldBy: m.heldBy, holdAz: m.holdAz ?? 0, holdLift: m.holdLift ?? 1, inventoryRevision: m.inventoryRevision,
  };
}

export function personSnap(p: Person, meetings: readonly Meeting[], includeInventory = false): PersonSnap {
  const t = p.task;
  let spot = 0, oneOff: PersonSnap['oneOff'];
  if (t) {
    const i = interactables.indexOf(t.spot);
    if (i >= 0) spot = i + 1;
    else {
      spot = ONE_OFF_SPOT;
      const hipY = (t.spot as { hipY?: number }).hipY;
      oneOff = { x: t.spot.pos.x, z: t.spot.pos.z, face: t.spot.face, place: t.spot.place, ...(Number.isFinite(hipY) ? { hipY } : {}) };
    }
  }
  const meeting = t?.meeting ?? p.meeting;
  const snap: PersonSnap = {
    id: p.id, state: p.state, shown: p.shown, absent: !!p.absent, toilet: !!p.toiletUntil, x: p.pos.x, z: p.pos.z, face: p.face, walkPhase: p.walkPhase,
    kind: t ? t.kind : '', anim: t ? t.anim : '', cat: t ? t.cat : '', spot,
    partner: t?.partner ? t.partner.id : NONE, chatWith: p.chatWith ? p.chatWith.id : NONE,
    meeting: meeting ? meetings.indexOf(meeting) : NONE,
    props: PROP_KEYS.reduce((bits, k, i) => bits | (p.props[k] ? 1 << i : 0), 0),
    arrivedAt: p.arrivedAt == null ? NONE : p.arrivedAt, arriveAt: p.arriveAt, leaveAt: p.leaveAt, coffees: p.coffees,
    mechanics: mechanicsSnap(p),
  };
  if (oneOff) snap.oneOff = oneOff;
  if (includeInventory) snap.inventory = { revision: p.mechanics.inventoryRevision, items: p.inventory.items.map(item => ({ ...item })), hotbar: [...p.inventory.hotbar] };
  return snap;
}
