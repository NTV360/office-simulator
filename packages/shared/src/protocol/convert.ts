import { PROP_KEYS } from '../sim/props';
import { interactables } from '../sim/interactables';
import type { Meeting, Person } from '../sim/types';
import { NONE, ONE_OFF_SPOT, type LayoutCheck, type MeetingSnap, type PersonInfo, type PersonSnap } from './messages';

// Turning simulation objects into protocol records (server side).

/** A short fingerprint of the registered spots, to check the client and the server run the same office. */
export function layoutCheck(): LayoutCheck {
  const all = interactables.all();
  let h = 0x811c9dc5;
  for (const s of all) {
    const text = s.id + '@' + s.pos.x.toFixed(4) + ',' + s.pos.z.toFixed(4) + ';';
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return { spots: all.length, hash: h >>> 0 };
}

export function personInfo(p: Person): PersonInfo {
  return {
    id: p.id, name: p.name, role: p.role, controller: p.controller, spec: p.spec,
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
    id: p.id, state: p.state, shown: p.shown, x: p.pos.x, z: p.pos.z, face: p.face, walkPhase: p.walkPhase,
    kind: t ? t.kind : '', anim: t ? t.anim : '', cat: t ? t.cat : '', spot,
    partner: t?.partner ? t.partner.id : NONE, chatWith: p.chatWith ? p.chatWith.id : NONE,
    meeting: meeting ? meetings.indexOf(meeting) : NONE,
    props: PROP_KEYS.reduce((bits, k, i) => bits | (p.props[k] ? 1 << i : 0), 0),
    arrived: p.arrivedAt != null, arriveAt: p.arriveAt,
  };
  if (oneOff) snap.oneOff = oneOff;
  return snap;
}
