import {
  NONE, encode, isDriven, layoutCheck, log, meetingSnap, meetings, movedObjectPoses, objectPose, people, personInfo, personSnap, sim,
  type WorldObject,
  type GameEvent, type Person, type PersonSnap,
} from '@office/shared';

// Builds the messages the server sends. It knows the simulation and the protocol, not Socket.IO, so it can be tested alone.

const same = (a: PersonSnap, b: PersonSnap): boolean => {
  if (a.x !== b.x || a.z !== b.z || a.face !== b.face || a.walkPhase !== b.walkPhase) return false;
  if (a.state !== b.state || a.shown !== b.shown || a.absent !== b.absent || a.toilet !== b.toilet || a.kind !== b.kind || a.anim !== b.anim || a.cat !== b.cat || a.spot !== b.spot) return false;
  if (a.partner !== b.partner || a.chatWith !== b.chatWith || a.meeting !== b.meeting || a.props !== b.props || a.arrivedAt !== b.arrivedAt || a.arriveAt !== b.arriveAt || a.leaveAt !== b.leaveAt || a.coffees !== b.coffees) return false;
  return (a.oneOff?.place ?? '') === (b.oneOff?.place ?? '') && a.oneOff?.x === b.oneOff?.x && a.oneOff?.z === b.oneOff?.z && a.oneOff?.face === b.oneOff?.face;
};

export interface BroadcasterOptions {
  tickRate: number;
  /** Staff are sent every this many ticks (people driven by players are sent every tick). Default 2: 10 Hz at 20 Hz ticks. */
  aiEvery?: number;
  /** A full snapshot (everyone) every this many ticks, so a client that missed a message recovers. Default: once a second. */
  keyframeEvery?: number;
}

export class Broadcaster {
  private readonly last = new Map<number, PersonSnap>();
  private readonly seenLog = new Set<object>();
  private readonly aiEvery: number;
  private readonly keyframeEvery: number;

  constructor(private readonly opts: BroadcasterOptions) {
    this.aiEvery = opts.aiEvery ?? 2;
    this.keyframeEvery = opts.keyframeEvery ?? opts.tickRate;
    for (const l of log) this.seenLog.add(l); // do not replay what happened before we started
  }

  /** Everything a new client needs: the clock, every person, the meetings. (Does not touch the change tracking: other clients have not seen this.) */
  welcome(tick: number, you: number = NONE): Uint8Array {
    const list = people.map(p => ({ info: personInfo(p), snap: personSnap(p, meetings) }));
    return encode({
      type: 'welcome', tick, tickRate: this.opts.tickRate, simTime: sim.t, day: sim.day, speed: sim.speed, paused: sim.paused, you,
      layout: layoutCheck(), people: list, meetings: meetings.map(meetingSnap), objects: movedObjectPoses(),
    });
  }

  /** The snapshot for this tick: the people who changed (staff at the reduced rate), or everyone on a keyframe. */
  snapshot(tick: number): Uint8Array {
    const full = tick % this.keyframeEvery === 0;
    const out: PersonSnap[] = [];
    const seen = new Set<number>();
    for (const p of people) {
      seen.add(p.id);
      const due = isDriven(p) || tick % this.aiEvery === 0; // people a human drives are sent every tick, the rest at the reduced rate
      if (!full && !due) continue;
      const snap = personSnap(p, meetings);
      const prev = this.last.get(p.id);
      if (full || !prev || !same(prev, snap)) { out.push(snap); this.last.set(p.id, snap); }
    }
    for (const id of this.last.keys()) if (!seen.has(id)) this.last.delete(id);
    return encode({ type: 'snapshot', tick, simTime: sim.t, day: sim.day, speed: sim.speed, paused: sim.paused, full, people: out, meetings: meetings.map(meetingSnap) });
  }

  /** New lines in the simulation's log since the last call, oldest first, as event messages. */
  events(): Uint8Array[] {
    const fresh: GameEvent[] = [];
    for (const l of log) {
      if (this.seenLog.has(l)) break;
      fresh.push({ type: 'event', kind: 'log', simTime: l.t, text: l.msg });
    }
    for (const l of log) this.seenLog.add(l);
    if (this.seenLog.size > 50) { const keep = new Set<object>(log); this.seenLog.clear(); keep.forEach(k => this.seenLog.add(k)); }
    return fresh.reverse().map(e => encode(e));
  }

  joined(p: Person): Uint8Array {
    const snap = personSnap(p, meetings);
    this.last.set(p.id, snap);
    return encode({ type: 'person', info: personInfo(p), snap });
  }

  /** An object was moved, picked up or put down. */
  objectMoved(o: WorldObject): Uint8Array {
    return encode({ type: 'object', pose: objectPose(o) });
  }

  left(id: number): Uint8Array {
    this.last.delete(id);
    return encode({ type: 'leave', id });
  }
}
