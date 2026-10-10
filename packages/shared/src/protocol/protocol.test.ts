import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SPEC } from '../character/spec';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { initDay } from '../sim/day';
import { hasSlot } from '../sim/person';
import { initState, meetings, people, resetSim } from '../sim/state';
import { stepSim } from '../sim/step';
import { setSeed } from '../util';
import { DecodeError } from './binary';
import { WIRE_ANIMS, WIRE_CATS, WIRE_KINDS, decode, encode } from './codec';
import { layoutCheck, meetingSnap, personInfo, personSnap } from './convert';
import {
  NONE, ONE_OFF_SPOT, WIRE_VERSION,
  type Message, type PersonInfo, type PersonSnap, type Snapshot, type Welcome,
} from './messages';

const TAU = Math.PI * 2;
const info = (over: Partial<PersonInfo> = {}): PersonInfo => ({
  id: 7, name: 'Ana B.', role: 'Developer', title: 'UI/UX Department', department: 'UI/UX', photo: 'https://img.example.test/ana.png', controller: 'ai', spec: { ...DEFAULT_SPEC, hair: { style: 'bun', color: '#2b201b' } }, slot: 12, screenKind: 'design', screenVariant: 2, arriveAt: 512.5, ...over,
});
const snap = (over: Partial<PersonSnap> = {}): PersonSnap => ({
  id: 7, state: 'doing', shown: true, absent: false, toilet: false, x: -3.25, z: 11.125, face: 1.5, walkPhase: 0.5, kind: 'coffee', anim: 'drink', cat: 'pantry', spot: 31,
  partner: NONE, chatWith: NONE, meeting: NONE, props: 0b00001, arrivedAt: 500.25, arriveAt: 512.5, leaveAt: 1030.5, coffees: 2, ...over,
});

/** Compare a decoded snapshot record with the original, allowing for the format's rounding. */
function expectSameSnap(got: PersonSnap, want: PersonSnap) {
  const angle = (a: number) => ((a % TAU) + TAU) % TAU;
  const { x, z, face, walkPhase, oneOff, arriveAt, arrivedAt, leaveAt, ...rest } = got;
  const { x: wx, z: wz, face: wf, walkPhase: ww, oneOff: wo, arriveAt: wa, arrivedAt: wd, leaveAt: wl, ...wrest } = want;
  expect(arriveAt).toBeCloseTo(wa, 3); expect(arrivedAt).toBeCloseTo(wd, 3); expect(leaveAt).toBeCloseTo(wl, 3);
  expect(rest).toEqual(wrest);
  expect(x).toBeCloseTo(wx, 4); expect(z).toBeCloseTo(wz, 4);
  const d = (a: number, b: number) => Math.min(Math.abs(angle(a) - angle(b)), TAU - Math.abs(angle(a) - angle(b)));
  expect(d(face, wf)).toBeLessThan(1e-3); expect(d(walkPhase, ww)).toBeLessThan(1e-3);
  if (wo) { expect(oneOff?.place).toBe(wo.place); expect(oneOff!.x).toBeCloseTo(wo.x, 4); } else expect(oneOff).toBeUndefined();
}

const welcome = (): Welcome => ({
  type: 'welcome', tick: 123456, tickRate: 20, simTime: 601.25, day: 3, speed: 3, paused: false, you: NONE, layout: { spots: 145, hash: 0xdeadbeef },
  people: [{ info: info(), snap: snap() }, { info: info({ id: 8, name: 'Marco C.', slot: NONE }), snap: snap({ id: 8, state: 'away', shown: false, kind: '', anim: '', cat: '', spot: 0, arrivedAt: NONE }) }],
  meetings: [{ room: 1, topic: 'sprint review', start: 580, end: 610.5, speaker: 7, members: [7, 8] }],
  objects: [{ index: 3, x: 1.5, z: -2.25, rot: 0.5, carriedBy: NONE }, { index: 140, x: -30.5, z: 12, rot: -3, carriedBy: 7 }],
});

describe('round trips', () => {
  it('hello, ping, pong, kick, leave', () => {
    for (const m of [{ type: 'hello', version: 4, ticket: 'abc_DEF-123' }, { type: 'input', seq: 4000000000, mx: 0.5, mz: -1, heading: 3.25, run: true }, { type: 'act', kind: 'sit' }, { type: 'act', kind: 'stand' }, { type: 'ping', ts: 1234567.5 }, { type: 'pong', ts: 99.25 }, { type: 'kick', reason: 'another login (ünï)' }, { type: 'leave', id: 41 }, { type: 'ack', seq: 4000000000, tick: 123456, x: -12.5, z: 33.25, face: -2.5 }, { type: 'say', text: 'héllo wörld 你好' }, { type: 'chat', from: 41, name: 'Ana_B', text: 'hi <b>there</b> ✓' }, { type: 'emote', kind: 'cheer' }, { type: 'emoted', from: 7, kind: 'nod' }, { type: 'object', pose: { index: 12, x: 3.25, z: -8.5, rot: 1.25, carriedBy: NONE } }, { type: 'object', pose: { index: 65534, x: -1, z: 1, rot: 3, carriedBy: 300 } }] as Message[]) {
      expect(decode(encode(m))).toEqual(m);
    }
  });
  it('event', () => {
    const m: Message = { type: 'event', kind: 'log', simTime: 600.5, text: 'Ana arrived' };
    expect(decode(encode(m))).toEqual(m);
    for (const kind of ['announce', 'day', 'notice'] as const) { const e: Message = { type: 'event', kind, simTime: 1, text: 'x' }; expect(decode(encode(e))).toEqual(e); }
  });
  it('person (joined)', () => {
    const m = decode(encode({ type: 'person', info: info(), snap: snap() }));
    expect(m.type).toBe('person');
    if (m.type === 'person') { expect(m.info).toEqual(info()); expectSameSnap(m.snap, snap()); }
  });
  it('a person who is out of the building on the toilet run, or not clocked in, keeps those flags; title and department travel', () => {
    for (const [absent, toilet] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const m = decode(encode({ type: 'person', info: info(), snap: snap({ absent, toilet, shown: !toilet, kind: 'bucket', anim: 'stand', cat: 'walk', props: 0b100000 }) }));
      if (m.type !== 'person') throw new Error('not a person');
      expect(m.snap.absent).toBe(absent); expect(m.snap.toilet).toBe(toilet); expect(m.snap.shown).toBe(!toilet); expect(m.snap.kind).toBe('bucket'); expect(m.snap.props).toBe(0b100000);
      expect(m.info.title).toBe('UI/UX Department'); expect(m.info.department).toBe('UI/UX');
    }
  });
  it('snapshot with a one-off chat place, ids that are none, and meetings', () => {
    const s: Snapshot = {
      type: 'snapshot', tick: 4_000_000_000, simTime: 777.125, day: 9, speed: 0.25, paused: true, full: false,
      people: [snap(), snap({ id: 9, kind: 'chat', anim: 'talkStand', cat: 'chat', spot: ONE_OFF_SPOT, oneOff: { x: 2.5, z: -4, face: 3, place: 'Desk 07' }, partner: 7, meeting: 0, props: 0b11111 })],
      meetings: [{ room: 2, topic: '1:1', start: 700, end: 725, speaker: NONE, members: [7, 9] }],
    };
    const got = decode(encode(s)) as Snapshot;
    expect(got).toMatchObject({ type: 'snapshot', tick: s.tick, simTime: s.simTime, day: 9, paused: true, full: false, meetings: s.meetings });
    expect(got.speed).toBeCloseTo(0.25, 6);
    got.people.forEach((p, i) => expectSameSnap(p, s.people[i]));
  });
  it('welcome', () => {
    const w = welcome();
    const got = decode(encode(w)) as Welcome;
    expect(got).toMatchObject({ type: 'welcome', tick: w.tick, tickRate: 20, simTime: w.simTime, day: 3, paused: false, you: NONE, layout: w.layout, meetings: w.meetings });
    got.people.forEach((p, i) => { expect(p.info).toEqual(w.people[i].info); expectSameSnap(p.snap, w.people[i].snap); });
  });
  it('the clock mode (Live or Simulate) rides on both the snapshot and the welcome, next to paused and full', () => {
    for (const live of [true, false]) for (const paused of [true, false]) {
      const s = decode(encode({ type: 'snapshot', tick: 1, simTime: 2, day: 1, speed: 1, paused, live, full: !live, people: [], meetings: [] })) as Snapshot;
      expect([s.live, s.paused, s.full]).toEqual([live, paused, !live]);
      const w = decode(encode({ ...welcome(), paused, live })) as Welcome;
      expect([w.live, w.paused]).toEqual([live, paused]);
    }
    expect((decode(encode(welcome())) as Welcome).live).toBe(false); // (a message that does not say is Simulate)
  });
  it('a profile picture is carried, and only an https address is taken (the page puts it in an image)', () => {
    const ok = decode(encode({ type: 'person', info: info(), snap: snap() })) as { info: PersonInfo };
    expect(ok.info.photo).toBe('https://img.example.test/ana.png');
    for (const bad of ['http://img.example.test/a.png', 'javascript:alert(1)', 'https://x.test/a b.png', 'https://x.test/"onerror="x', "https://x.test/'", 'https://x.test/<', 'data:image/png;base64,AAAA', 'https://' + 'a'.repeat(2100)]) {
      const got = decode(encode({ type: 'person', info: info({ photo: bad }), snap: snap() })) as { info: PersonInfo };
      expect(got.info.photo, bad.slice(0, 40)).toBe('');
    }
    expect((decode(encode({ type: 'person', info: info({ photo: '' }), snap: snap() })) as { info: PersonInfo }).info.photo).toBe('');
    const long = 'https://img.example.test/sign?token=' + 'a'.repeat(900); // (a signed link: long, and fine)
    expect((decode(encode({ type: 'person', info: info({ photo: long }), snap: snap() })) as { info: PersonInfo }).info.photo).toBe(long);
  });
  it('a bad picture address in a stored record never reaches the wire (it would only break the welcome for everyone)', () => {
    resetSim(); loadLayout(officeLayout); setSeed(1); initState(); initDay(5); setSeed(null);
    const p = people[0];
    for (const bad of ['x'.repeat(70000), 'http://a.test/x', 'https://a b']) { p.photo = bad; expect(personInfo(p).photo, bad.slice(0, 20)).toBe(''); }
    p.photo = 'https://img.example.test/ok.png'; expect(personInfo(p).photo).toBe('https://img.example.test/ok.png');
    p.photo = null;
  });
  it('angles wrap into one turn', () => {
    for (const a of [-0.5, 7, 1000, -1000, 0]) {
      const got = (decode(encode({ type: 'person', info: info(), snap: snap({ face: a }) })) as { snap: PersonSnap }).snap.face;
      expect(got).toBeGreaterThanOrEqual(0); expect(got).toBeLessThan(TAU);
    }
  });
  it('names the tables do not know still travel, as text', () => {
    const m = decode(encode({ type: 'person', info: info(), snap: snap({ kind: 'karaoke', anim: 'sing', cat: 'fun' }) })) as { snap: PersonSnap };
    expect([m.snap.kind, m.snap.anim, m.snap.cat]).toEqual(['karaoke', 'sing', 'fun']);
  });
  it('a one-off place must carry its details', () => {
    expect(() => encode({ type: 'person', info: info(), snap: snap({ spot: ONE_OFF_SPOT }) })).toThrow(RangeError);
  });
});

describe('bad input is refused with a DecodeError, never anything else', () => {
  const samples: Message[] = [
    { type: 'hello', version: 4, ticket: 'abc' }, { type: 'input', seq: 1, mx: 0, mz: 1, heading: 0, run: false }, { type: 'act', kind: 'sit' }, { type: 'ping', ts: 5 }, { type: 'kick', reason: 'bye' }, { type: 'leave', id: 3 }, { type: 'ack', seq: 7, tick: 9, x: 1, z: 2, face: 0.5 },
    { type: 'event', kind: 'announce', simTime: 5, text: 'hi' }, { type: 'person', info: info(), snap: snap({ spot: ONE_OFF_SPOT, oneOff: { x: 1, z: 2, face: 0, place: 'p' } }) },
    welcome(), { type: 'snapshot', tick: 1, simTime: 2, day: 1, speed: 1, paused: false, full: true, people: [snap()], meetings: [{ room: 1, topic: 't', start: 1, end: 2, speaker: NONE, members: [1, 2, 3] }] },
  ];
  it('every truncation of every message', () => {
    for (const m of samples) {
      const bytes = encode(m);
      for (let n = 0; n < bytes.length; n++) expect(() => decode(bytes.slice(0, n)), `${m.type} cut to ${n}`).toThrow(DecodeError);
    }
  });
  it('trailing bytes, unknown types and an empty message', () => {
    for (const m of samples) expect(() => decode(Uint8Array.from([...encode(m), 0]))).toThrow(DecodeError);
    expect(() => decode(Uint8Array.from([0x7f]))).toThrow(DecodeError);
    expect(() => decode(new Uint8Array(0))).toThrow(DecodeError);
  });
  it('a welcome from another protocol version', () => {
    const bytes = encode(welcome()); bytes[1] = WIRE_VERSION + 1;
    expect(() => decode(bytes)).toThrow(/version/);
  });
  it('lists that claim more than the message holds', () => {
    const bytes = encode({ type: 'snapshot', tick: 1, simTime: 2, day: 1, speed: 1, paused: false, full: true, people: [], meetings: [] });
    const lie = Uint8Array.from(bytes); lie[bytes.length - 3] = 0xff; lie[bytes.length - 2] = 0xff; // person count 65535
    expect(() => decode(lie)).toThrow(DecodeError);
  });
  it('text that is not valid UTF-8', () => {
    const bytes = encode({ type: 'kick', reason: 'ab' }); bytes[3] = 0xc3; bytes[4] = 0x28;
    expect(() => decode(bytes)).toThrow(DecodeError);
  });
  it('random bytes and random corruption of real messages never throw anything but DecodeError', () => {
    let seed = 12345; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 4000; i++) {
      const base = i % 2 ? encode(samples[Math.floor(rand() * samples.length)]) : Uint8Array.from({ length: Math.floor(rand() * 80) }, () => Math.floor(rand() * 256));
      const bytes = Uint8Array.from(base);
      if (i % 2 && bytes.length) for (let k = 0; k < 3; k++) bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
      try { decode(bytes); } catch (e) { expect(e, `input ${i}`).toBeInstanceOf(DecodeError); }
    }
  });
});

describe('from the real simulation', () => {
  beforeEach(() => { resetSim(); loadLayout(officeLayout); });

  it('every person, sampled across a whole day and the roll-over, survives the wire and uses only the known names', () => {
    const seenKinds = new Set<string>(), seenAnims = new Set<string>(), seenCats = new Set<string>();
    for (const seed of [1, 2]) {
      resetSim(); loadLayout(officeLayout); setSeed(seed); initState(); initDay(40);
      for (let i = 0; i < 32000; i++) {
        stepSim(.05);
        if (i % 193) continue;
        for (const p of people) {
          const original = personSnap(p, meetings), inf = personInfo(p);
          const back = decode(encode({ type: 'person', info: inf, snap: original })) as { info: PersonInfo; snap: PersonSnap };
          expect(back.info).toEqual({ ...inf, arriveAt: Math.fround(inf.arriveAt) });
          expectSameSnap(back.snap, original);
          seenKinds.add(original.kind); seenAnims.add(original.anim); seenCats.add(original.cat);
        }
      }
    }
    setSeed(null);
    for (const k of seenKinds) expect(WIRE_KINDS, 'task kind ' + k).toContain(k);
    for (const a of seenAnims) expect(WIRE_ANIMS, 'pose ' + a).toContain(a);
    for (const c of seenCats) expect(WIRE_CATS, 'category ' + c).toContain(c);
    expect(seenKinds.size).toBeGreaterThan(10);
    for (const k of ['tv', 'clean']) expect(seenKinds, 'the new task kind ' + k + ' was sampled').toContain(k);
    for (const a of ['wipe', 'windowWipe', 'mop']) expect(seenAnims, 'the new pose ' + a).toContain(a);
  }, 60000);

  it('props become bits in the order of PROP_KEYS', () => {
    setSeed(1); initState(); initDay(40);
    const p = people[0];
    p.props.mug = true; p.props.putter = true;
    expect(personSnap(p, meetings).props).toBe(0b10001);
    setSeed(null);
  });

  it('sizes: a person record, a full snapshot, and the welcome', () => {
    setSeed(1); initState(); initDay(40);
    for (let i = 0; i < 3000; i++) stepSim(.05);
    const staff = people.filter(hasSlot);
    const record = encode({ type: 'person', info: personInfo(staff[3]), snap: personSnap(staff[3], meetings) }).length;
    const full = encode({ type: 'snapshot', tick: 1, simTime: 1, day: 1, speed: 1, paused: false, full: true, people: staff.map(p => personSnap(p, meetings)), meetings: meetings.map(meetingSnap) }).length;
    const w = encode({ type: 'welcome', tick: 1, tickRate: 20, simTime: 1, day: 1, speed: 1, paused: false, you: NONE, layout: layoutCheck(), people: staff.map(p => ({ info: personInfo(p), snap: personSnap(p, meetings) })), meetings: meetings.map(meetingSnap), objects: [] }).length;
    console.log(`SIZES  join record ${record} B, full snapshot of 40 people ${full} B (${(full / 40).toFixed(1)} B each), welcome ${w} B`);
    expect(full / 40).toBeLessThan(50);
    expect(w).toBeLessThan(30_000); // (about 550 B a person, most of it the look: the pack's spec is bigger than the old one; sent once per join)
    setSeed(null);
  });

  it('the layout check is stable, and changes when a spot moves', () => {
    const a = layoutCheck();
    expect(a.spots).toBe(158);
    loadLayout(officeLayout);
    expect(layoutCheck()).toEqual(a);
    const moved = JSON.parse(JSON.stringify(officeLayout));
    moved.spots[3].pos.x += 0.01;
    loadLayout(moved);
    expect(layoutCheck().hash).not.toBe(a.hash);
  });
});
