import { beforeEach, describe, expect, it } from 'vitest';
import {
  Mirror, PROP_KEYS, decode, interactables, hasSlot, isHelper, meetings, people, personSnap, removeStaff, setLook, setStaffCount, simEvents, takeControl,
  type Person, type PersonSnap, type Snapshot, type Welcome,
} from '@office/shared';
import { World, type WorldOptions } from '../world/world';
import { Broadcaster } from './broadcaster';

// A server world and a client Mirror in one process: whatever the server bytes describe, the mirror must rebuild.

const options: WorldOptions = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 5 };
let world: World;
let bc: Broadcaster;
let mirror: Mirror;
let added: Person[], removed: Person[];

beforeEach(() => {
  simEvents.clear();
  world = new World(options); world.init();
  bc = new Broadcaster({ tickRate: 20 });
  added = []; removed = [];
  mirror = new Mirror(interactables.all(), { added: p => added.push(p), removed: p => removed.push(p) });
  // as the gateway does: announce joins and leaves to every viewer
  simEvents.on('personAdded', p => { const m = decode(bc.joined(p)); if (m.type === 'person') mirror.applyJoin(m.info, m.snap); });
  simEvents.on('personRemoved', p => { bc.left(p.id); mirror.applyLeave(p.id); });
});

const connect = () => mirror.applyWelcome(decode(bc.welcome(world.tick)) as Welcome);
const tick = () => { world.step(); mirror.applySnapshot(decode(bc.snapshot(world.tick)) as Snapshot); };

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** The mirror picture of everyone must equal the server's, to the precision of the wire format. */
function expectSame(label: string) {
  const server = people.filter(p => hasSlot(p) || isHelper(p)); // (the staff, and the helper)
  expect(mirror.people.size, label + ': head count').toBe(server.length);
  for (const sp of server) {
    const mp = mirror.people.get(sp.id)!;
    expect(mp, `${label}: ${sp.name} exists`).toBeDefined();
    const a = personSnap(sp, meetings), b = personSnap(mp, mirror.meetings);
    expect(b.state, `${label}: ${sp.name} state`).toBe(a.state);
    expect(near(a.x, b.x, 1e-4) && near(a.z, b.z, 1e-4), `${label}: ${sp.name} at (${a.x}, ${a.z}) vs (${b.x}, ${b.z})`).toBe(true);
    for (const k of ['shown', 'kind', 'anim', 'cat', 'spot', 'partner', 'chatWith', 'props', 'coffees'] as const) expect(b[k], `${label}: ${sp.name} ${k}`).toEqual(a[k]);
    expect(b.meeting, `${label}: ${sp.name} meeting`).toBe(a.meeting);
    expect(near(a.arrivedAt, b.arrivedAt, 1e-2) && near(a.leaveAt, b.leaveAt, 1e-2), `${label}: ${sp.name} times`).toBe(true);
    expect(mp.name).toBe(sp.name); expect(mp.slot).toBe(sp.slot); expect(mp.screenKind).toBe(sp.screenKind);
  }
  expect(mirror.meetings.map(m => [m.room, m.topic, m.members.map(p => p.id), m.speaker?.id ?? -1]))
    .toEqual(meetings.map(m => [m.room, m.topic, m.members.map(p => p.id), m.speaker?.id ?? -1]));
  expect(mirror.clock.simTime).toBeCloseTo(world.status().simTime, 3);
}

describe('Mirror', () => {
  it('rebuilds the whole office from a welcome, with real desks, specs and people objects', () => {
    connect();
    expectSame('welcome');
    expect(added).toHaveLength(41); // (the helper too)
    const hazel = [...mirror.people.values()].find(p => p.name === 'Hazel Sellote')!;
    expect(hazel.spec).toMatchObject({ type: 'blocky', height: 'short', angry: true });
    expect(hazel.slot!.kind).toBe('desk');
  });

  it('stays equal to the server through a whole working day, tick by tick', () => {
    connect();
    let checked = 0;
    for (let i = 1; i <= 30000 && world.status().day === 1; i++) {
      tick();
      if (i % 400 === 0 || (i < 6 && i % 2 === 0)) { expectSame('tick ' + i); checked++; } // (staff are sent every second tick: people already walk at the start)
    }
    expect(checked).toBeGreaterThan(50);
    expect(mirror.unknownRecords).toBe(0);
  }, 60000);

  it('chat partners and meetings point at real people and share one meeting object', () => {
    connect();
    let sawChat = false, sawMeeting = false;
    for (let i = 1; i <= 12000; i++) {
      tick();
      if (i % 50) continue;
      for (const p of mirror.people.values()) {
        if (p.task?.partner) { sawChat = true; expect(mirror.people.get(p.task.partner.id)).toBe(p.task.partner); }
        if (p.chatWith) expect(mirror.people.get(p.chatWith.id)).toBe(p.chatWith);
        if (p.task?.meeting) {
          sawMeeting = true;
          expect(mirror.meetings).toContain(p.task.meeting);
          expect(p.task.meeting.members).toContain(p);
        }
      }
    }
    expect(sawChat).toBe(true);
    expect(sawMeeting).toBe(true);
  }, 60000);

  it('props show up as flags the views can read', () => {
    connect();
    const seen = new Set<string>();
    for (let i = 1; i <= 12000; i++) {
      tick();
      if (i % 10) continue;
      for (const p of mirror.people.values()) for (const k of PROP_KEYS) if (p.props[k]) seen.add(k);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('people who join or leave are mirrored, and the hooks are told', () => {
    connect();
    setStaffCount(30);
    tick();
    expect(mirror.people.size).toBe(31); // (30 staff and the helper)
    expect(removed).toHaveLength(10);
    const before = added.length;
    setStaffCount(36);
    tick();
    expect(added.length - before).toBe(6);
    expectSame('after joins');
  });

  it('a keyframe repairs a leave that was missed', () => {
    connect();
    simEvents.clear(); // the leave message never reaches the mirror
    const gone = removeStaff()!;
    expect(mirror.people.has(gone.id)).toBe(true);
    const key = decode(bc.snapshot(20)) as Snapshot; // tick 20 is a keyframe
    expect(key.full).toBe(true);
    mirror.applySnapshot(key);
    expect(mirror.people.has(gone.id)).toBe(false);
    expect(removed.map(p => p.id)).toContain(gone.id);
  });

  it('the clock mode follows the welcome and each snapshot', () => {
    connect();
    expect(mirror.clock.live).toBe(false);
    mirror.applySnapshot({ type: 'snapshot', tick: 1, simTime: 1, day: 1, speed: 1, paused: false, live: true, full: false, people: [], meetings: [] });
    expect(mirror.clock.live).toBe(true);
    mirror.applySnapshot({ type: 'snapshot', tick: 2, simTime: 1, day: 1, speed: 1, paused: false, full: false, people: [], meetings: [] });
    expect(mirror.clock.live).toBe(false);
  });

  it('a record for someone it never heard of is ignored and counted', () => {
    connect();
    const fake: PersonSnap = { ...personSnap([...mirror.people.values()][0], mirror.meetings), id: 999 };
    mirror.applySnapshot({ type: 'snapshot', tick: 1, simTime: 1, day: 1, speed: 1, paused: false, full: false, people: [fake], meetings: [] });
    expect(mirror.unknownRecords).toBe(1);
    expect(mirror.people.has(999)).toBe(false);
  });

  it('a second welcome (reconnect) replaces everything without leaving duplicates', () => {
    connect();
    for (let i = 0; i < 100; i++) tick();
    connect();
    expect(mirror.people.size).toBe(41);
    expect(removed).toHaveLength(41);
    expectSame('reconnect');
  });

  it('a position hook can take over placing people (the client uses it to smooth motion)', () => {
    const got: Array<[number, boolean]> = [];
    const m = new Mirror(interactables.all(), { added: () => {}, removed: () => {}, position: (p, _x, _z, _f, _w, isNew) => { got.push([p.id, isNew]); } });
    m.applyWelcome(decode(bc.welcome(0)) as Welcome);
    expect(got.filter(g => g[1])).toHaveLength(41);
    const p0 = [...m.people.values()][0];
    const startX = p0.pos.x;
    p0.pos.x += 0; world.step(); world.step();
    m.applySnapshot(decode(bc.snapshot(2)) as Snapshot);
    expect(got.some(g => !g[1])).toBe(true);
    expect(p0.pos.x).toBe(startX); // the hook did not move them: that is the hook job
  });

  it('a person who leaves is taken out of the meetings, and a damaged one-off place does not break the snapshot', () => {
    connect();
    let inMeeting: Person | undefined;
    for (let i = 1; i <= 12000 && !inMeeting; i++) { tick(); inMeeting = [...mirror.people.values()].find(p => p.task?.meeting && p.task.meeting.members.length > 1); }
    expect(inMeeting).toBeDefined();
    const meeting = inMeeting!.task!.meeting!;
    mirror.applyLeave(inMeeting!.id);
    expect(meeting.members).not.toContain(inMeeting);
    expect(meeting.speaker).not.toBe(inMeeting);
    const other = [...mirror.people.values()][0];
    const bad = { ...personSnap(other, mirror.meetings), spot: 0xffff, kind: 'chat', anim: 'talkStand', cat: 'chat' };
    expect(() => mirror.applySnapshot({ type: 'snapshot', tick: 9, simTime: 1, day: 1, speed: 1, paused: false, full: false, people: [bad], meetings: [] })).not.toThrow();
    expect(other.task).toBeNull();
  }, 60000);

  it('when a human takes someone over the same person is updated in place (their body and pose are kept), and a new look rebuilds them', () => {
    connect();
    const sp = people.filter(hasSlot).find(q => q.state === 'doing')!;
    const mp = mirror.people.get(sp.id)!;
    const addedBefore = added.length, removedBefore = removed.length;
    sp.owner = 5; sp.name = 'Renamed';
    takeControl(sp);
    const m = decode(bc.joined(sp));
    if (m.type !== 'person') throw new Error('expected a person message');
    mirror.applyJoin(m.info, m.snap);
    expect(mirror.people.get(sp.id)).toBe(mp); // the very same object: nothing was rebuilt
    expect([mp.controller, mp.name]).toEqual(['account', 'Renamed']);
    expect([added.length, removed.length]).toEqual([addedBefore, removedBefore]);
    setLook(sp, { hair: { style: 'bun', color: '#abcdef' } });
    const m2 = decode(bc.joined(sp));
    if (m2.type !== 'person') throw new Error('expected a person message');
    mirror.applyJoin(m2.info, m2.snap);
    const rebuilt = mirror.people.get(sp.id)!;
    expect(rebuilt).not.toBe(mp);
    expect(rebuilt.spec.hair).toEqual({ style: 'bun', color: '#abcdef' });
    expect([added.length - addedBefore, removed.length - removedBefore]).toEqual([1, 1]);
  });
});
