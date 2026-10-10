import { Vec3 } from '../vec3';
import { RUNNING_KINDS } from '../sim/data';
import { NEVER } from '../sim/schedule';
import { PROP_KEYS, newProps } from '../sim/props';
import type { Spot } from '../sim/interactables';
import type { Meeting, Person, TaskSpot } from '../sim/types';
import { NONE, ONE_OFF_SPOT, type MeetingSnap, type PersonInfo, type PersonSnap, type Snapshot, type Welcome } from './messages';

// The client's copy of the server's world. It turns protocol messages back into ordinary Person objects, so everything
// that draws or describes a person (animation, the info card, the ledger) works on them unchanged.
// It holds its own state (no globals), so it can run next to a server in one process for tests.

export interface MirrorHooks {
  added(p: Person): void;
  removed(p: Person): void;
  /**
   * Where the server says someone is. The default puts them there at once; the client replaces it to smooth the motion.
   * `isNew` is true for the first position of a person.
   */
  position?(p: Person, x: number, z: number, face: number, walkPhase: number, isNew: boolean): void;
}

export interface MirrorClock {
  tick: number;
  tickRate: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  /** The server's clock follows the real time (Live), not the simulated day. */
  live: boolean;
}

export class Mirror {
  readonly people = new Map<number, Person>();
  meetings: Meeting[] = [];
  clock: MirrorClock = { tick: 0, tickRate: 20, simTime: 0, day: 1, speed: 1, paused: false, live: false };
  /** The person this connection drives, or NONE for a viewer. */
  you = NONE;
  /** Records for people we have not heard about (a join we missed); counted so a test or the UI can notice. */
  unknownRecords = 0;

  constructor(private readonly spots: readonly Spot[], private readonly hooks: MirrorHooks) {}

  /** Replace everything with the server's picture. */
  applyWelcome(w: Welcome): void {
    for (const p of [...this.people.values()]) this.drop(p);
    this.meetingIndex.clear();
    this.you = w.you;
    this.clock = { tick: w.tick, tickRate: w.tickRate, simTime: w.simTime, day: w.day, speed: w.speed, paused: w.paused, live: !!w.live };
    for (const { info, snap } of w.people) this.create(info, snap);
    this.applyMeetings(w.meetings);
    for (const { snap } of w.people) this.link(this.people.get(snap.id)!, snap);
  }

  /** Forget everyone (a logout: the next welcome starts from nothing). */
  clear(): void {
    for (const p of [...this.people.values()]) this.drop(p);
    this.meetingIndex.clear();
    this.meetings = [];
  }

  applySnapshot(s: Snapshot): void {
    this.clock = { ...this.clock, tick: s.tick, simTime: s.simTime, day: s.day, speed: s.speed, paused: s.paused, live: !!s.live };
    const listed = new Set<number>();
    const touched: Array<[Person, PersonSnap]> = [];
    for (const snap of s.people) {
      listed.add(snap.id);
      const p = this.people.get(snap.id);
      if (!p) { this.unknownRecords++; continue; }
      this.update(p, snap);
      touched.push([p, snap]);
    }
    if (s.full) for (const p of [...this.people.values()]) if (!listed.has(p.id)) this.drop(p); // a leave we missed
    this.applyMeetings(s.meetings);
    for (const [p, snap] of touched) this.link(p, snap);
    // people who did not change this time still point at the previous list's meeting objects: point them at the new ones
    for (const p of this.people.values()) if (!listed.has(p.id)) this.relinkMeeting(p);
  }

  /**
   * A person joined, or something about them changed (who drives them, their name, their look). A person we already know is
   * updated in place, so their body and pose are kept; only a changed look rebuilds the body.
   */
  applyJoin(info: PersonInfo, snap: PersonSnap): void {
    const old = this.people.get(info.id);
    if (old && JSON.stringify(old.spec) === JSON.stringify(info.spec)) {
      old.name = info.name; old.role = info.role; old.title = info.title; old.department = info.department || null; old.photo = info.photo || null; old.controller = info.controller;
      old.slot = info.slot >= 0 ? this.spots[info.slot] : undefined;
      old.screenKind = info.screenKind; old.screenVariant = info.screenVariant; old.arriveAt = info.arriveAt;
      this.update(old, snap);
      this.link(old, snap);
      return;
    }
    if (old) this.drop(old); // a new look: a new body
    const p = this.create(info, snap);
    this.link(p, snap);
  }

  applyLeave(id: number): void {
    const p = this.people.get(id);
    if (p) this.drop(p);
  }

  // ---- internals

  private create(info: PersonInfo, snap: PersonSnap): Person {
    const p: Person = {
      id: info.id, name: info.name, role: info.role, title: info.title, department: info.department || null, photo: info.photo || null, controller: info.controller, spec: info.spec,
      slot: info.slot >= 0 ? this.spots[info.slot] : undefined,
      pos: new Vec3(snap.x, 0, snap.z), face: snap.face, faceGoal: snap.face, speed: 1.3,
      state: snap.state, shown: snap.shown, props: newProps(), task: null, path: null, pi: 0, until: 0, queue: [],
      walkPhase: snap.walkPhase, animT: 0, pose: {}, arriveAt: info.arriveAt, leaveAt: 0, lunchAt: 0, hadLunch: false,
      arrivedAt: null, coffees: 0, chatWith: null, meeting: null, screenKind: info.screenKind, screenVariant: info.screenVariant,
    };
    this.people.set(p.id, p);
    this.fill(p, snap);
    if (this.hooks.position) this.hooks.position(p, snap.x, snap.z, snap.face, snap.walkPhase, true);
    this.hooks.added(p);
    return p;
  }

  private drop(p: Person): void {
    this.people.delete(p.id);
    this.meetingIndex.delete(p.id);
    // nobody should keep describing someone who has gone: take them out of the meetings too
    for (const m of this.meetings) { m.members = m.members.filter(x => x !== p); if (m.speaker === p) m.speaker = null; }
    this.hooks.removed(p);
  }

  /** Everything except where they stand and what they point at (which needs the other people). */
  private fill(p: Person, snap: PersonSnap): void {
    p.state = snap.state;
    p.shown = snap.shown;
    p.absent = snap.absent;
    p.toiletUntil = snap.toilet ? NEVER : null; // (only whether they are out matters to a viewer)
    p.arriveAt = snap.arriveAt;
    p.arrivedAt = snap.arrivedAt === NONE ? null : snap.arrivedAt;
    p.leaveAt = snap.leaveAt;
    p.coffees = snap.coffees;
    PROP_KEYS.forEach((k, i) => { p.props[k] = !!(snap.props & (1 << i)); });
    if (snap.kind === '') { p.task = null; return; }
    const spot: TaskSpot | undefined = snap.spot === ONE_OFF_SPOT
      ? (snap.oneOff ? oneOffSpot(snap) : undefined)
      : snap.spot > 0 ? this.spots[snap.spot - 1] : undefined;
    if (!spot) { p.task = null; return; }
    // a new task object only when the task changed, so code that compares task objects keeps working
    const t = p.task;
    if (t && t.kind === snap.kind && t.anim === snap.anim && t.cat === snap.cat && sameSpot(t.spot, spot, snap)) return;
    p.task = { kind: snap.kind, cat: snap.cat, anim: snap.anim, spot };
    if (RUNNING_KINDS.includes(snap.kind)) p.task.run = true; // the bucket run is done at a run (the server moves them; this is for the walking pose)
  }

  private update(p: Person, snap: PersonSnap): void {
    this.fill(p, snap);
    if (this.hooks.position) this.hooks.position(p, snap.x, snap.z, snap.face, snap.walkPhase, false);
    else { p.pos.x = snap.x; p.pos.z = snap.z; p.face = p.faceGoal = snap.face; p.walkPhase = snap.walkPhase; }
  }

  /** Point chat partners, chat-at-desk and meetings at real people and meeting objects. */
  private link(p: Person, snap: PersonSnap): void {
    p.chatWith = snap.chatWith === NONE ? null : this.people.get(snap.chatWith) ?? null;
    if (p.task) {
      if (snap.partner === NONE) delete p.task.partner;
      else { const partner = this.people.get(snap.partner); if (partner) p.task.partner = partner; }
    }
    this.meetingIndex.set(p.id, snap.meeting);
    this.relinkMeeting(p);
  }
  private readonly meetingIndex = new Map<number, number>();

  private relinkMeeting(p: Person): void {
    const i = this.meetingIndex.get(p.id) ?? NONE;
    const m = i === NONE ? null : this.meetings[i] ?? null;
    p.meeting = m;
    if (p.task) { if (m) p.task.meeting = m; else delete p.task.meeting; }
  }

  private applyMeetings(list: readonly MeetingSnap[]): void {
    this.meetings = list.map((m): Meeting => ({
      room: m.room, topic: m.topic, start: m.start, end: m.end, swap: 0,
      members: m.members.map(id => this.people.get(id)).filter((x): x is Person => !!x),
      speaker: m.speaker === NONE ? null : this.people.get(m.speaker) ?? null,
    }));
  }
}

function oneOffSpot(snap: PersonSnap): TaskSpot {
  const o = snap.oneOff!;
  const v = new Vec3(o.x, 0, o.z);
  return { kind: 'chat', pos: v, approach: v, face: o.face, shared: false, place: o.place };
}
function sameSpot(a: TaskSpot, b: TaskSpot, snap: PersonSnap): boolean {
  if (snap.spot !== ONE_OFF_SPOT) return a === b;
  return a.place === b.place && a.pos.x === b.pos.x && a.pos.z === b.pos.z && a.face === b.face;
}
