import { normalizeSpec, type CharacterSpec } from '../character/spec';
import type { PersonState } from '../sim/types';
import { DecodeError, Reader, Writer } from './binary';
import {
  EMOTE_KINDS, MAX_CHAT, NONE, ONE_OFF_SPOT, PHOTO_URL, WIRE_VERSION, type ObjectPose,
  type ActKind, type ClientMessage, type MoveSnap, type ResetScope, type EventKind, type LayoutCheck, type MeetingSnap, type Message, type PersonInfo, type PersonSnap, type ServerMessage,
} from './messages';

// Binary encoding of every message. One byte of message type, then a compact body. See messages.ts for the meaning.

const STATES: PersonState[] = ['away', 'idle', 'walking', 'doing', 'controlled'];
const CONTROLLERS = ['ai', 'account'] as const;
const SCREEN_KINDS = ['code', 'design', 'dash'] as const;
const EVENT_KINDS: EventKind[] = ['log', 'announce', 'day', 'notice'];
const ACT_KINDS: ActKind[] = ['sit', 'stand'];
const RESET_SCOPES: ResetScope[] = ['object', 'station'];

/** Names the simulation uses today. Anything else still travels (as text) but costs more bytes. */
export const WIRE_KINDS = ['', 'work', 'coffee', 'sink', 'locker', 'sofa', 'piano', 'guitar', 'darts', 'golf', 'game', 'storage', 'bar', 'phone', 'chat', 'lunch', 'lunchDesk', 'exit', 'meeting', 'playerSit', 'bucket', 'toilet', 'bucketBack', 'snack', 'snackDesk', 'whiteboard', 'tv', 'clean'];
export const WIRE_ANIMS = ['', 'type', 'drink', 'sink', 'locker', 'relax', 'piano', 'guitar', 'darts', 'putt', 'game', 'drinkSit', 'phone', 'talkStand', 'eat', 'stand', 'listen', 'listenSit', 'talkSit', 'present', 'wipe', 'windowWipe', 'mop'];
export const WIRE_CATS = ['', 'work', 'meeting', 'phone', 'pantry', 'lunch', 'break', 'chat', 'clean', 'walk'];

const T = {
  hello: 0x01, ping: 0x02, input: 0x03, act: 0x04, say: 0x05, emote: 0x06, grab: 0x07, place: 0x08, reset: 0x09,
  welcome: 0x80, snapshot: 0x81, person: 0x82, leave: 0x83, event: 0x84, pong: 0x85, kick: 0x86, ack: 0x87, chat: 0x88, emoted: 0x89, object: 0x8a,
} as const;

const CUSTOM = 0xff;
const NO_U16 = 0xffff;
const NO_U8 = 0xff;
const TAU = Math.PI * 2;

// 0xffff and 0xff mean "none", so real ids and indexes stop one short of them
const toU16 = (id: number) => { if (id === NONE) return NO_U16; if (id >= NO_U16) throw new RangeError(`id ${id} is too big for the protocol`); return id; };
const fromU16 = (v: number) => (v === NO_U16 ? NONE : v);

// (an upright thing sends no orientation: one byte says whether four numbers follow)
function writeObjectPose(w: Writer, p: ObjectPose): void {
  w.u16(p.index).f32(p.x).f32(p.z).f32(p.rot).f32(p.y).u16(toU16(p.carriedBy)).u8(p.q ? 1 : 0);
  if (p.q) w.f32(p.q[0]).f32(p.q[1]).f32(p.q[2]).f32(p.q[3]);
}
function readObjectPose(r: Reader): ObjectPose {
  const index = r.u16(), x = r.f32(), z = r.f32(), rot = r.f32(), y = r.f32(), carriedBy = fromU16(r.u16());
  const q: ObjectPose['q'] = r.u8() ? [r.f32(), r.f32(), r.f32(), r.f32()] : null;
  return { index, x, z, rot, y, q, carriedBy };
}

function writeName(w: Writer, table: readonly string[], value: string): void {
  const i = table.indexOf(value);
  if (i >= 0) w.u8(i); else { if (value.length > MAX_NAME) throw new RangeError('name too long for the protocol'); w.u8(CUSTOM); w.str(value); }
}
const MAX_NAME = 64;
const MAX_TICKET = 128;
function readName(r: Reader, table: readonly string[], what: string): string {
  const i = r.u8();
  if (i === CUSTOM) { const s = r.str(); if (s.length > MAX_NAME) throw new DecodeError(`${what} name too long`); return s; }
  if (i >= table.length) throw new DecodeError(`unknown ${what} ${i}`);
  return table[i];
}
function readIndex<T>(r: Reader, table: readonly T[], what: string): T {
  const i = r.u8();
  if (i >= table.length) throw new DecodeError(`unknown ${what} ${i}`);
  return table[i];
}
const index = <T>(table: readonly T[], v: T, what: string): number => {
  const i = table.indexOf(v);
  if (i < 0) throw new RangeError(`cannot encode ${what} ${String(v)}`);
  return i;
};
const quantAngle = (a: number): number => {
  const t = ((a % TAU) + TAU) % TAU;
  return Math.min(65535, Math.round(t / TAU * 65536));
};
const unquantAngle = (q: number): number => q / 65536 * TAU;

function writeSnap(w: Writer, s: PersonSnap): void {
  w.u16(s.id);
  w.u8((s.shown ? 1 : 0) | (s.absent ? 2 : 0) | (s.toilet ? 4 : 0));
  w.u8(index(STATES, s.state, 'state'));
  w.f32(s.x).f32(s.z);
  w.u16(quantAngle(s.face)).u16(quantAngle(s.walkPhase));
  writeName(w, WIRE_KINDS, s.kind); writeName(w, WIRE_ANIMS, s.anim); writeName(w, WIRE_CATS, s.cat);
  w.u16(s.spot);
  if (s.spot === ONE_OFF_SPOT) {
    const o = s.oneOff;
    if (!o) throw new RangeError('a one-off spot needs its details');
    w.f32(o.x).f32(o.z).u16(quantAngle(o.face)).str(o.place);
  }
  if (s.meeting !== NONE && s.meeting >= NO_U8) throw new RangeError('meeting index too big for the protocol');
  w.u16(toU16(s.partner)).u16(toU16(s.chatWith)).u8(s.meeting === NONE ? NO_U8 : s.meeting);
  w.u8(s.props).f32(s.arrivedAt).f32(s.arriveAt).f32(s.leaveAt).u8(Math.min(255, s.coffees));
}
function readSnap(r: Reader): PersonSnap {
  const id = r.u16();
  const flags = r.u8();
  const state = readIndex(r, STATES, 'state');
  const x = r.f32(), z = r.f32();
  const face = unquantAngle(r.u16()), walkPhase = unquantAngle(r.u16());
  const kind = readName(r, WIRE_KINDS, 'task'), anim = readName(r, WIRE_ANIMS, 'pose'), cat = readName(r, WIRE_CATS, 'category');
  const spot = r.u16();
  let oneOff: PersonSnap['oneOff'];
  if (spot === ONE_OFF_SPOT) oneOff = { x: r.f32(), z: r.f32(), face: unquantAngle(r.u16()), place: r.str() };
  const partner = fromU16(r.u16()), chatWith = fromU16(r.u16());
  const m = r.u8();
  const props = r.u8(), arrivedAt = r.f32(), arriveAt = r.f32(), leaveAt = r.f32(), coffees = r.u8();
  const snap: PersonSnap = { id, state, shown: !!(flags & 1), absent: !!(flags & 2), toilet: !!(flags & 4), x, z, face, walkPhase, kind, anim, cat, spot, partner, chatWith, meeting: m === NO_U8 ? NONE : m, props, arrivedAt, arriveAt, leaveAt, coffees };
  if (oneOff) snap.oneOff = oneOff;
  return snap;
}

/** Who only moved: id, where (two f32), which way and the stride (two u16): 14 bytes each. */
function writeMoves(w: Writer, list: readonly MoveSnap[]): void {
  w.u16(list.length);
  for (const m of list) w.u16(m.id).f32(m.x).f32(m.z).u16(quantAngle(m.face)).u16(quantAngle(m.walkPhase));
}
function readMoves(r: Reader): MoveSnap[] {
  const n = count(r, 14, 'move'), out: MoveSnap[] = [];
  for (let i = 0; i < n; i++) out.push({ id: r.u16(), x: r.f32(), z: r.f32(), face: unquantAngle(r.u16()), walkPhase: unquantAngle(r.u16()) });
  return out;
}

function writeInfo(w: Writer, p: PersonInfo): void {
  w.u16(p.id).str(p.name).str(p.role).str(p.title).str(p.department).str(p.photo).u8(index(CONTROLLERS, p.controller, 'controller')).str(JSON.stringify(p.spec));
  w.u16(toU16(p.slot)).u8(index(SCREEN_KINDS, p.screenKind, 'screen kind')).u8(p.screenVariant).f32(p.arriveAt);
}
function readInfo(r: Reader): PersonInfo {
  const id = r.u16(), name = r.str(), role = r.str(), title = r.str(), department = r.str(), rawPhoto = r.str(), controller = readIndex(r, CONTROLLERS, 'controller');
  const photo = PHOTO_URL.test(rawPhoto) ? rawPhoto : ''; // (the page puts it in an image: only an https address is taken)
  let raw: unknown;
  try { raw = JSON.parse(r.str()); } catch { throw new DecodeError('invalid character spec'); }
  const slot = fromU16(r.u16()), screenKind = readIndex(r, SCREEN_KINDS, 'screen kind'), screenVariant = r.u8(), arriveAt = r.f32();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DecodeError('invalid character spec');
  // made valid here too: the page draws and shows what it reads (Hazel's furious face is allowed: the server says so)
  return { id, name, role, title, department, photo, controller, spec: normalizeSpec(raw) as CharacterSpec, slot, screenKind, screenVariant, arriveAt };
}

function writeMeetings(w: Writer, list: readonly MeetingSnap[]): void {
  if (list.length > 255) throw new RangeError('too many meetings for the protocol');
  w.u8(list.length);
  for (const m of list) {
    w.u8(m.room).str(m.topic).f32(m.start).f32(m.end).u16(toU16(m.speaker)).u16(m.members.length);
    for (const id of m.members) w.u16(id);
  }
}
function readMeetings(r: Reader): MeetingSnap[] {
  const n = r.u8(), out: MeetingSnap[] = [];
  for (let i = 0; i < n; i++) {
    const room = r.u8(), topic = r.str(), start = r.f32(), end = r.f32(), speaker = fromU16(r.u16()), count = r.u16();
    if (count * 2 > r.remaining) throw new DecodeError('meeting member list too long');
    const members: number[] = [];
    for (let k = 0; k < count; k++) members.push(r.u16());
    out.push({ room, topic, start, end, speaker, members });
  }
  return out;
}
function count(r: Reader, minEach: number, what: string): number {
  const n = r.u16();
  if (n * minEach > r.remaining) throw new DecodeError(`${what} list too long`);
  return n;
}
function writeLayout(w: Writer, l: LayoutCheck): void { w.u16(l.spots).u32(l.hash); }
function readLayout(r: Reader): LayoutCheck { return { spots: r.u16(), hash: r.u32() }; }

/** Encode any message to bytes. */
export function encode(msg: Message): Uint8Array {
  const w = new Writer();
  switch (msg.type) {
    case 'hello':
      if (msg.ticket.length > MAX_TICKET) throw new RangeError('ticket too long for the protocol');
      w.u8(T.hello).u8(msg.version).str(msg.ticket);
      break;
    case 'ping': w.u8(T.ping).f64(msg.ts); break;
    case 'say': if (msg.text.length > MAX_CHAT) throw new RangeError('chat line too long for the protocol'); w.u8(T.say).str(msg.text); break;
    case 'object': w.u8(T.object); writeObjectPose(w, msg.pose); break;
    case 'emote': w.u8(T.emote).u8(index(EMOTE_KINDS, msg.kind, 'emote')); break;
    case 'emoted': w.u8(T.emoted).u16(msg.from).u8(index(EMOTE_KINDS, msg.kind, 'emote')); break;
    case 'chat': w.u8(T.chat).u16(msg.from).str(msg.name).str(msg.text); break;
    case 'input': w.u8(T.input).u32(msg.seq).f32(msg.mx).f32(msg.mz).f32(msg.heading).u8(msg.run ? 1 : 0); break;
    case 'act': w.u8(T.act).u8(index(ACT_KINDS, msg.kind, 'act')); break;
    case 'grab': w.u8(T.grab).u16(toU16(msg.object)); break;
    case 'place': w.u8(T.place).f32(msg.x).f32(msg.z).f32(msg.rot); break;
    case 'reset': w.u8(T.reset).u8(index(RESET_SCOPES, msg.scope, 'reset scope')).u16(toU16(msg.object)); break;
    case 'pong': w.u8(T.pong).f64(msg.ts); break;
    case 'kick': w.u8(T.kick).str(msg.reason); break;
    case 'ack': w.u8(T.ack).u32(msg.seq).u32(msg.tick).f32(msg.x).f32(msg.z).f32(msg.face); break;
    case 'leave': w.u8(T.leave).u16(msg.id); break;
    case 'person': w.u8(T.person); writeInfo(w, msg.info); writeSnap(w, msg.snap); break;
    case 'event': w.u8(T.event).u8(index(EVENT_KINDS, msg.kind, 'event kind')).f32(msg.simTime).str(msg.text); break;
    case 'snapshot':
      w.u8(T.snapshot).u32(msg.tick).f64(msg.simTime).u16(msg.day).f32(msg.speed).u8((msg.paused ? 1 : 0) | (msg.full ? 2 : 0) | (msg.live ? 4 : 0));
      w.u16(msg.people.length);
      for (const p of msg.people) writeSnap(w, p);
      writeMoves(w, msg.moves ?? []);
      writeMeetings(w, msg.meetings);
      break;
    case 'welcome':
      w.u8(T.welcome).u8(WIRE_VERSION).u32(msg.tick).u8(msg.tickRate).f64(msg.simTime).u16(msg.day).f32(msg.speed).u8((msg.paused ? 1 : 0) | (msg.live ? 2 : 0)).u16(toU16(msg.you));
      writeLayout(w, msg.layout);
      w.u16(msg.people.length);
      for (const p of msg.people) { writeInfo(w, p.info); writeSnap(w, p.snap); }
      writeMeetings(w, msg.meetings);
      w.u16(msg.objects.length);
      for (const o of msg.objects) writeObjectPose(w, o);
      break;
  }
  return w.bytes();
}

/** Decode a message from a client: only hello, ping, input, act, say, emote, grab, place and reset are accepted, and nothing else is parsed. */
export function decodeClient(bytes: Uint8Array): ClientMessage {
  if (bytes.length === 0 || (bytes[0] !== T.hello && bytes[0] !== T.ping && bytes[0] !== T.input && bytes[0] !== T.act && bytes[0] !== T.say && bytes[0] !== T.emote && bytes[0] !== T.grab && bytes[0] !== T.place && bytes[0] !== T.reset)) throw new DecodeError('not a message a client may send');
  return decode(bytes) as ClientMessage;
}

/** Decode a message. Throws `DecodeError` for anything malformed (truncated, unknown type, trailing bytes, wrong version). */
export function decode(bytes: Uint8Array): Message {
  const r = new Reader(bytes);
  const type = r.u8();
  let msg: Message;
  switch (type) {
    case T.hello: { const version = r.u8(), ticket = r.str(); if (ticket.length > MAX_TICKET) throw new DecodeError('ticket too long'); msg = { type: 'hello', version, ticket }; break; }
    case T.ping: msg = { type: 'ping', ts: r.f64() }; break;
    case T.say: { const text = r.str(); if (text.length > MAX_CHAT) throw new DecodeError('chat line too long'); msg = { type: 'say', text }; break; }
    case T.object: msg = { type: 'object', pose: readObjectPose(r) }; break;
    case T.emote: msg = { type: 'emote', kind: readIndex(r, EMOTE_KINDS, 'emote') }; break;
    case T.emoted: { const from = r.u16(); msg = { type: 'emoted', from, kind: readIndex(r, EMOTE_KINDS, 'emote') }; break; }
    case T.chat: { const from = r.u16(), name = r.str(), text = r.str(); if (name.length > MAX_NAME || text.length > MAX_CHAT) throw new DecodeError('chat too long'); msg = { type: 'chat', from, name, text }; break; }
    case T.input: { const seq = r.u32(), mx = r.f32(), mz = r.f32(), heading = r.f32(), flags = r.u8(); msg = { type: 'input', seq, mx, mz, heading, run: !!(flags & 1) }; break; }
    case T.act: msg = { type: 'act', kind: readIndex(r, ACT_KINDS, 'act') }; break;
    case T.grab: msg = { type: 'grab', object: fromU16(r.u16()) }; break;
    case T.place: { const x = r.f32(), z = r.f32(), rot = r.f32(); msg = { type: 'place', x, z, rot }; break; }
    case T.reset: { const scope = readIndex(r, RESET_SCOPES, 'reset scope'), object = fromU16(r.u16()); msg = { type: 'reset', scope, object }; break; }
    case T.pong: msg = { type: 'pong', ts: r.f64() }; break;
    case T.kick: msg = { type: 'kick', reason: r.str() }; break;
    case T.ack: msg = { type: 'ack', seq: r.u32(), tick: r.u32(), x: r.f32(), z: r.f32(), face: r.f32() }; break;
    case T.leave: msg = { type: 'leave', id: r.u16() }; break;
    case T.person: { const info = readInfo(r); msg = { type: 'person', info, snap: readSnap(r) }; break; }
    case T.event: { const kind = readIndex(r, EVENT_KINDS, 'event kind'); msg = { type: 'event', kind, simTime: r.f32(), text: r.str() }; break; }
    case T.snapshot: {
      const tick = r.u32(), simTime = r.f64(), day = r.u16(), speed = r.f32(), flags = r.u8();
      const n = count(r, 36, 'person'), people: PersonSnap[] = [];
      for (let i = 0; i < n; i++) people.push(readSnap(r));
      const moves = readMoves(r);
      msg = { type: 'snapshot', tick, simTime, day, speed, paused: !!(flags & 1), full: !!(flags & 2), live: !!(flags & 4), people, ...(moves.length ? { moves } : {}), meetings: readMeetings(r) };
      break;
    }
    case T.welcome: {
      const version = r.u8();
      if (version !== WIRE_VERSION) throw new DecodeError(`protocol version ${version}, expected ${WIRE_VERSION}`);
      const tick = r.u32(), tickRate = r.u8(), simTime = r.f64(), day = r.u16(), speed = r.f32(), clockFlags = r.u8(), you = fromU16(r.u16());
      const paused = !!(clockFlags & 1), live = !!(clockFlags & 2);
      const layout = readLayout(r);
      const n = count(r, 53, 'person'), people: Array<{ info: PersonInfo; snap: PersonSnap }> = [];
      for (let i = 0; i < n; i++) { const info = readInfo(r); people.push({ info, snap: readSnap(r) }); }
      const meetings = readMeetings(r);
      const nObjects = count(r, 16, 'object'), objectsList: ObjectPose[] = [];
      for (let i = 0; i < nObjects; i++) objectsList.push(readObjectPose(r));
      msg = { type: 'welcome', tick, tickRate, simTime, day, speed, paused, live, you, layout, people, meetings, objects: objectsList };
      break;
    }
    default: throw new DecodeError(`unknown message type ${type}`);
  }
  if (r.remaining !== 0) throw new DecodeError('extra bytes after the message');
  return msg;
}

export function isServerMessage(m: Message): m is ServerMessage { return !isClientMessage(m); }
export function isClientMessage(m: Message): m is ClientMessage { return m.type === 'hello' || m.type === 'ping' || m.type === 'input' || m.type === 'act' || m.type === 'say' || m.type === 'emote' || m.type === 'grab' || m.type === 'place' || m.type === 'reset'; }
