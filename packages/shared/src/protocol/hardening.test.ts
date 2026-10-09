import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEC } from '../character/spec';
import { DecodeError, Reader, Writer } from './binary';
import { decode, decodeClient, encode } from './codec';
import { NONE, type MeetingSnap, type PersonInfo, type PersonSnap } from './messages';

const info: PersonInfo = { id: 1, name: 'A', role: 'R', controller: 'ai', spec: DEFAULT_SPEC, slot: 0, screenKind: 'code', screenVariant: 0, arriveAt: 500 };
const snap = (over: Partial<PersonSnap> = {}): PersonSnap => ({
  id: 1, state: 'doing', shown: true, x: 0, z: 0, face: 0, walkPhase: 0, kind: 'work', anim: 'type', cat: 'work', spot: 1, partner: NONE, chatWith: NONE, meeting: NONE, props: 0, arrivedAt: 500, arriveAt: 500, leaveAt: 1000, coffees: 0, ...over,
});
const meeting = (i: number): MeetingSnap => ({ room: 1, topic: 't' + i, start: 1, end: 2, speaker: NONE, members: [] });

describe('writing refuses values that would silently wrap', () => {
  it('integers out of range, fractions and negatives', () => {
    expect(() => new Writer().u8(256)).toThrow(RangeError);
    expect(() => new Writer().u8(-1)).toThrow(RangeError);
    expect(() => new Writer().u16(65536)).toThrow(RangeError);
    expect(() => new Writer().u32(2 ** 32)).toThrow(RangeError);
    expect(() => new Writer().u8(1.5)).toThrow(RangeError);
    expect(() => new Writer().u16(NaN)).toThrow(RangeError);
  });
  it('numbers that are not finite', () => {
    expect(() => new Writer().f32(NaN)).toThrow(RangeError);
    expect(() => new Writer().f64(Infinity)).toThrow(RangeError);
  });
  it('ids and indexes that collide with "none", or more than 255 meetings', () => {
    expect(() => encode({ type: 'person', info, snap: snap({ meeting: 255 }) })).toThrow(RangeError);
    expect(() => encode({ type: 'person', info, snap: snap({ chatWith: 0xffff }) })).toThrow(RangeError);
    expect(() => encode({ type: 'snapshot', tick: 1, simTime: 1, day: 1, speed: 1, paused: false, full: true, people: [], meetings: Array.from({ length: 256 }, (_, i) => meeting(i)) })).toThrow(RangeError);
    expect(() => encode({ type: 'snapshot', tick: 1, simTime: 1, day: 1, speed: 1, paused: false, full: true, people: [], meetings: Array.from({ length: 255 }, (_, i) => meeting(i)) })).not.toThrow();
  });
  it('a very long custom name', () => {
    expect(() => encode({ type: 'person', info, snap: snap({ kind: 'x'.repeat(65) }) })).toThrow(RangeError);
  });
});

describe('reading refuses what a hostile sender could put in', () => {
  it('numbers that are not finite', () => {
    const w = new Writer(); w.u8(0x85);
    const bytes = w.bytes();
    const bad = Uint8Array.from([...bytes, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0]); // pong with NaN
    expect(() => decode(bad)).toThrow(DecodeError);
    expect(() => new Reader(Uint8Array.from([0x7f, 0x80, 0, 0])).f32()).toThrow(DecodeError);
  });
  it('a custom name that is too long', () => {
    const good = encode({ type: 'person', info, snap: snap({ kind: 'karaoke' }) });
    // find the custom marker (0xff) followed by the length 7 and patch the length up to 200 bytes of text
    const at = good.findIndex((b, i) => b === 0xff && good[i + 1] === 0 && good[i + 2] === 7);
    expect(at).toBeGreaterThan(0);
    const patched = Uint8Array.from([...good.slice(0, at + 1), 0, 200, ...new Uint8Array(200).fill(97), ...good.slice(at + 3 + 7)]);
    expect(() => decode(patched)).toThrow(DecodeError);
  });
});

describe('decodeClient only accepts what a client may send', () => {
  it('hello and ping', () => {
    expect(decodeClient(encode({ type: 'hello', version: 4, ticket: 'tkt' }))).toEqual({ type: 'hello', version: 4, ticket: 'tkt' });
    expect(decodeClient(encode({ type: 'input', seq: 9, mx: 1, mz: 0, heading: 1, run: true }))).toEqual({ type: 'input', seq: 9, mx: 1, mz: 0, heading: 1, run: true });
    expect(decodeClient(encode({ type: 'act', kind: 'stand' }))).toEqual({ type: 'act', kind: 'stand' });
    expect(decodeClient(encode({ type: 'ping', ts: 5 }))).toEqual({ type: 'ping', ts: 5 });
  });
  it('nothing else, and the rest is not even parsed', () => {
    for (const m of [{ type: 'pong', ts: 1 }, { type: 'kick', reason: 'x' }, { type: 'leave', id: 1 }, { type: 'person', info, snap: snap() }] as const) {
      expect(() => decodeClient(encode(m))).toThrow(DecodeError);
    }
    expect(() => decodeClient(new Uint8Array(0))).toThrow(DecodeError);
  });
});
