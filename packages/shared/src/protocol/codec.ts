import { normalizeSpec, type CharacterSpec } from '../character/spec';
import { validateInventory, type InventoryItem } from '../sim/inventory';
import { defaultCharacterMechanics } from '../sim/character-state';
import type { PersonState } from '../sim/types';
import { DecodeError, Reader, Writer } from './binary';
import {
  EMOTE_KINDS, MAX_CHAT, NONE, ONE_OFF_SPOT, PHOTO_URL, WIRE_VERSION, type ObjectPose, type ObjectDefinition,
  type ActKind, type ClientMessage, type MoveSnap, type ResetScope, type EventKind, type LayoutCheck, type MeetingSnap, type Message, type PersonInfo, type PersonSnap, type PersonMechanicsSnap, type ServerMessage, type InventorySnap,
} from './messages';

// Binary encoding of every message. One byte of message type, then a compact body. See messages.ts for the meaning.

const STATES: PersonState[] = ['away', 'idle', 'walking', 'doing', 'controlled'];
const POSTURES = ['standing', 'crouching', 'prone', 'seated', 'ragdoll', 'recovering'] as const;
const SEAT_MODES = ['none', 'fixed-chair', 'free-legs-down', 'free-crossed'] as const;
const LOCOMOTION = ['grid', 'jump', 'knockback', 'ragdoll'] as const;
const ATTACK_KINDS = ['punch', 'kick', 'bash'] as const;
const ATTACK_SIDES = ['left', 'right'] as const;
const ATTACK_PHASES = ['charging', 'active', 'cooldown'] as const;
const ATTACK_INTENT_PHASES = ['begin', 'release'] as const;
const CONTROLLERS = ['ai', 'account'] as const;
const SCREEN_KINDS = ['code', 'design', 'dash'] as const;
const EVENT_KINDS: EventKind[] = ['log', 'announce', 'day', 'notice', 'medkit', 'care'];
const INVENTORY_ACTIONS = ['assign', 'hotbar', 'drop', 'move', 'rotate', 'care', 'care-stop', 'medkit-open', 'medkit-take'] as const;
const KITS = ['bandage', 'first-aid-box'] as const;
const ACT_KINDS: ActKind[] = ['sit', 'stand'];
const RESET_SCOPES: ResetScope[] = ['object', 'station'];

/** Names the simulation uses today. Anything else still travels (as text) but costs more bytes. */
export const WIRE_KINDS = ['', 'work', 'coffee', 'sink', 'locker', 'sofa', 'piano', 'guitar', 'darts', 'golf', 'game', 'storage', 'bar', 'phone', 'chat', 'lunch', 'lunchDesk', 'exit', 'meeting', 'playerSit', 'bucket', 'toilet', 'bucketBack', 'snack', 'snackDesk', 'whiteboard', 'tv', 'clean'];
export const WIRE_ANIMS = ['', 'type', 'drink', 'sink', 'locker', 'relax', 'piano', 'guitar', 'darts', 'putt', 'game', 'drinkSit', 'phone', 'talkStand', 'eat', 'stand', 'listen', 'listenSit', 'talkSit', 'present', 'wipe', 'windowWipe', 'mop', 'sit', 'sitCrossed'];
export const WIRE_CATS = ['', 'work', 'meeting', 'phone', 'pantry', 'lunch', 'break', 'chat', 'clean', 'walk'];

const T = {
  hello: 0x01, ping: 0x02, input: 0x03, act: 0x04, attack: 0x14, say: 0x05, emote: 0x06, grab: 0x07, place: 0x08, reset: 0x09, hold: 0x0a, drop: 0x0b, throw: 0x0c, grabCharacter: 0x0d, releaseCharacter: 0x0e, throwCharacter: 0x0f, inventory: 0x10,
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
  w.u8(Math.min(8, p.helpers.length));
  for (const h of p.helpers.slice(0, 8)) w.u16(toU16(h));
  w.u8(p.removed ? 1 : 0);
}
function readObjectPose(r: Reader): ObjectPose {
  const index = r.u16(), x = r.f32(), z = r.f32(), rot = r.f32(), y = r.f32(), carriedBy = fromU16(r.u16());
  const qFlag = r.u8();
  if (qFlag > 1) throw new DecodeError('invalid object quaternion flag');
  const q: ObjectPose['q'] = qFlag ? [r.f32(), r.f32(), r.f32(), r.f32()] : null;
  const n = r.u8();
  if (n > 8) throw new DecodeError('too many helpers');
  const helpers: number[] = [];
  for (let i = 0; i < n; i++) helpers.push(fromU16(r.u16()));
  const removed = r.u8();
  if (removed > 1) throw new DecodeError('invalid object removal flag');
  return { index, x, z, rot, y, q, carriedBy, helpers, ...(removed ? { removed: true } : {}) };
}
function writeObjectDefinition(w: Writer, d: ObjectDefinition): void {
  if (!Number.isInteger(d.index) || d.index < 0 || d.index >= NO_U16) throw new RangeError('invalid object index');
  if (d.type.length > MAX_NAME || d.station !== null && d.station.length > MAX_HOLD_ID || d.spot !== null && d.spot.length > MAX_HOLD_ID) throw new RangeError('object definition name too long');
  w.u16(d.index).str(d.type).u8(d.variant).u8(d.station === null ? 0 : 1);
  if (d.station !== null) w.str(d.station);
  w.u8(d.spot === null ? 0 : 1);
  if (d.spot !== null) w.str(d.spot);
  const spots = d.spots ?? [];
  if (spots.length > 32) throw new RangeError('too many object spots');
  w.u8(spots.length);
  for (const spot of spots) { if (spot.length > MAX_HOLD_ID) throw new RangeError('object spot too long'); w.str(spot); }
  const dims = d.dims ?? [];
  if (dims.length > 8 || dims.some(value => !Number.isFinite(value))) throw new RangeError('invalid object dimensions');
  w.u8(dims.length);
  for (const value of dims) w.f32(value);
  writeObjectPose(w, d.pose);
}
function readObjectDefinition(r: Reader): ObjectDefinition {
  const index = r.u16(), type = r.str();
  if (!type || type.length > MAX_NAME) throw new DecodeError('invalid object type');
  const variant = r.u8();
  const stationFlag = r.u8();
  if (stationFlag > 1) throw new DecodeError('invalid object station flag');
  const station = stationFlag ? r.str() : null;
  const spotFlag = r.u8();
  if (spotFlag > 1) throw new DecodeError('invalid object spot flag');
  const spot = spotFlag ? r.str() : null;
  if ((station !== null && station.length > MAX_HOLD_ID) || (spot !== null && spot.length > MAX_HOLD_ID)) throw new DecodeError('object definition name too long');
  const spots: string[] = [], nSpots = r.u8();
  if (nSpots > 32) throw new DecodeError('too many object spots');
  for (let i = 0; i < nSpots; i++) { const value = r.str(); if (value.length > MAX_HOLD_ID) throw new DecodeError('object spot too long'); spots.push(value); }
  const dims: number[] = [], nDims = r.u8();
  if (nDims > 8) throw new DecodeError('too many object dimensions');
  for (let i = 0; i < nDims; i++) {
    const value = r.f32();
    if (!Number.isFinite(value)) throw new DecodeError('invalid object dimension');
    dims.push(value);
  }
  const pose = readObjectPose(r);
  if (pose.index !== index) throw new DecodeError('object definition index mismatch');
  return { index, type, variant, station, spot, ...(spots.length ? { spots } : {}), ...(dims.length ? { dims } : {}), pose };
}

function writeName(w: Writer, table: readonly string[], value: string): void {
  const i = table.indexOf(value);
  if (i >= 0) w.u8(i); else { if (value.length > MAX_NAME) throw new RangeError('name too long for the protocol'); w.u8(CUSTOM); w.str(value); }
}
const MAX_NAME = 64;
const MAX_TICKET = 128;
const MAX_HOLD_ID = 64;
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

function writeMechanics(w: Writer, m: PersonMechanicsSnap): void {
  w.u8(index(POSTURES, m.posture, 'posture')).f32(m.crouchLevel).u8(index(SEAT_MODES, m.seatMode, 'seat mode'));
  if (m.seatId !== null) { if (m.seatId.length > 64) throw new RangeError('seat id too long'); w.u8(1).str(m.seatId); } else w.u8(0);
  w.u8(index(LOCOMOTION, m.locomotion, 'locomotion')).u8(m.grounded ? 1 : 0).f32(m.verticalVelocity).f32(m.jumpUntil).f32(m.knockbackUntil);
  if (m.attack) {
    const a = m.attack;
    w.u8(1).u8(index(ATTACK_KINDS, a.kind, 'attack kind')).u8(index(ATTACK_SIDES, a.side, 'attack side')).u8(index(ATTACK_PHASES, a.phase, 'attack phase')).u16(a.sequence).f32(a.startedAt).u8(a.releaseAt === undefined ? 0 : 1);
    if (a.releaseAt !== undefined) w.f32(a.releaseAt);
    w.f32(a.charge).f32(a.cooldownUntil);
  } else w.u8(0);
  w.u8(index(ATTACK_SIDES, m.dominantHand, 'dominant hand')).f32(m.struggle);
  for (const limb of ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) w.f32(m.health[limb]);
  for (const id of [m.holdTarget, m.heldBy]) { if (id === null) w.u8(0); else { if (id.length > 64) throw new RangeError('hold id too long'); w.u8(1).str(id); } }
  w.f32(m.holdAz ?? 0).f32(m.holdLift ?? 1);
  w.u32(m.inventoryRevision);
}
function readMechanics(r: Reader): PersonMechanicsSnap {
  const posture = readIndex(r, POSTURES, 'posture'), crouchLevel = r.f32(), seatMode = readIndex(r, SEAT_MODES, 'seat mode');
  const seatId = r.u8() ? r.str() : null;
  if (seatId !== null && seatId.length > MAX_HOLD_ID) throw new DecodeError('seat id too long');
  const locomotion = readIndex(r, LOCOMOTION, 'locomotion'), grounded = !!r.u8(), verticalVelocity = r.f32(), jumpUntil = r.f32(), knockbackUntil = r.f32();
  let attack: PersonMechanicsSnap['attack'] = null;
  if (r.u8()) {
    const kind = readIndex(r, ATTACK_KINDS, 'attack kind'), side = readIndex(r, ATTACK_SIDES, 'attack side'), phase = readIndex(r, ATTACK_PHASES, 'attack phase'), sequence = r.u16(), startedAt = r.f32();
    const releaseAt = r.u8() ? r.f32() : undefined;
    attack = { kind, side, phase, sequence, startedAt, ...(releaseAt === undefined ? {} : { releaseAt }), charge: r.f32(), cooldownUntil: r.f32() };
  }
  const dominantHand = readIndex(r, ATTACK_SIDES, 'dominant hand'), struggle = r.f32();
  const health = { head: r.f32(), body: r.f32(), leftArm: r.f32(), rightArm: r.f32(), leftLeg: r.f32(), rightLeg: r.f32() };
  const holdTarget = r.u8() ? r.str() : null, heldBy = r.u8() ? r.str() : null;
  if ((holdTarget !== null && holdTarget.length > MAX_HOLD_ID) || (heldBy !== null && heldBy.length > MAX_HOLD_ID)) throw new DecodeError('hold id too long');
  const holdAz = r.f32(), holdLift = r.f32();
  if (!Number.isFinite(holdAz) || !Number.isFinite(holdLift)) throw new DecodeError('invalid hold transform');
  const inventoryRevision = r.u32();
  return { posture, crouchLevel, seatMode, seatId, locomotion, grounded, verticalVelocity, jumpUntil, knockbackUntil, attack, dominantHand, struggle, health, holdTarget, heldBy, holdAz, holdLift, inventoryRevision };
}

function writeInventory(w: Writer, inventory: InventorySnap): void {
  if (!Number.isInteger(inventory.revision) || inventory.revision < 0) throw new RangeError('invalid inventory revision');
  if (inventory.items.length > 255) throw new RangeError('too many inventory items');
  w.u32(inventory.revision).u8(inventory.items.length);
  for (const item of inventory.items) {
    if (item.id.length > MAX_HOLD_ID || item.type.length > MAX_NAME) throw new RangeError('inventory item name too long');
    w.str(item.id).str(item.type).u8(item.x).u8(item.y).u8(item.rotation);
  }
  if (inventory.hotbar.length !== 3) throw new RangeError('invalid hotbar');
  for (const id of inventory.hotbar) {
    if (id === null) w.u8(0);
    else { if (id.length > MAX_HOLD_ID) throw new RangeError('hotbar item id too long'); w.u8(1).str(id); }
  }
}
function readInventory(r: Reader): InventorySnap {
  const revision = r.u32(), n = r.u8();
  const items: InventoryItem[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.str(), type = r.str(), x = r.u8(), y = r.u8(), rotation = r.u8();
    if (id.length > MAX_HOLD_ID || type.length > MAX_NAME || (rotation !== 0 && rotation !== 90)) throw new DecodeError('invalid inventory item');
    items.push({ id, type, x, y, rotation: rotation as 0 | 90 });
  }
  const hotbar: Array<string | null> = [];
  for (let i = 0; i < 3; i++) {
    const present = r.u8();
    if (present !== 0 && present !== 1) throw new DecodeError('invalid hotbar presence');
    hotbar.push(present ? r.str() : null);
  }
  const inventory = { revision, items, hotbar };
  try { validateInventory(inventory); } catch { throw new DecodeError('invalid inventory'); }
  return inventory;
}

function writeSnap(w: Writer, s: PersonSnap): void {
  w.u16(s.id);
  w.u8((s.shown ? 1 : 0) | (s.absent ? 2 : 0) | (s.toilet ? 4 : 0) | (s.mechanics ? 8 : 0) | (s.inventory ? 16 : 0));
  w.u8(index(STATES, s.state, 'state'));
  w.f32(s.x).f32(s.z);
  w.u16(quantAngle(s.face)).u16(quantAngle(s.walkPhase));
  writeName(w, WIRE_KINDS, s.kind); writeName(w, WIRE_ANIMS, s.anim); writeName(w, WIRE_CATS, s.cat);
  w.u16(s.spot);
  if (s.spot === ONE_OFF_SPOT) {
    const o = s.oneOff;
    if (!o) throw new RangeError('a one-off spot needs its details');
    w.f32(o.x).f32(o.z).u16(quantAngle(o.face)).str(o.place);
    w.u8(Number.isFinite(o.hipY) ? 1 : 0);
    if (Number.isFinite(o.hipY)) w.f32(o.hipY!);
  }
  if (s.meeting !== NONE && s.meeting >= NO_U8) throw new RangeError('meeting index too big for the protocol');
  w.u16(toU16(s.partner)).u16(toU16(s.chatWith)).u8(s.meeting === NONE ? NO_U8 : s.meeting);
  w.u8(s.props).f32(s.arrivedAt).f32(s.arriveAt).f32(s.leaveAt).u8(Math.min(255, s.coffees));
  if (s.mechanics) writeMechanics(w, s.mechanics);
  if (s.inventory) writeInventory(w, s.inventory);
}
function readSnap(r: Reader): PersonSnap {
  const id = r.u16();
  const flags = r.u8();
  if (flags & ~0x1f) throw new DecodeError('invalid snapshot flags');
  const state = readIndex(r, STATES, 'state');
  const x = r.f32(), z = r.f32();
  const face = unquantAngle(r.u16()), walkPhase = unquantAngle(r.u16());
  const kind = readName(r, WIRE_KINDS, 'task'), anim = readName(r, WIRE_ANIMS, 'pose'), cat = readName(r, WIRE_CATS, 'category');
  const spot = r.u16();
  let oneOff: PersonSnap['oneOff'];
  if (spot === ONE_OFF_SPOT) {
    const x = r.f32(), z = r.f32(), face = unquantAngle(r.u16()), place = r.str();
    const hasHipY = r.u8();
    if (hasHipY > 1) throw new DecodeError('invalid one-off spot');
    oneOff = { x, z, face, place, ...(hasHipY ? { hipY: r.f32() } : {}) };
  }
  const partner = fromU16(r.u16()), chatWith = fromU16(r.u16());
  const m = r.u8();
  const props = r.u8(), arrivedAt = r.f32(), arriveAt = r.f32(), leaveAt = r.f32(), coffees = r.u8();
  const mechanics = flags & 8 ? readMechanics(r) : undefined;
  const inventory = flags & 16 ? readInventory(r) : undefined;
  if (mechanics && inventory && mechanics.inventoryRevision !== inventory.revision) throw new DecodeError('inventory revision mismatch');
  const snap: PersonSnap = { id, state, shown: !!(flags & 1), absent: !!(flags & 2), toilet: !!(flags & 4), x, z, face, walkPhase, kind, anim, cat, spot, partner, chatWith, meeting: m === NO_U8 ? NONE : m, props, arrivedAt, arriveAt, leaveAt, coffees, ...(mechanics ? { mechanics } : {}), ...(inventory ? { inventory } : {}) };
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
    case 'object':
      w.u8(T.object).u8(msg.definition ? 1 : 0);
      if (msg.definition) writeObjectDefinition(w, msg.definition);
      writeObjectPose(w, msg.pose);
      break;
    case 'emote': w.u8(T.emote).u8(index(EMOTE_KINDS, msg.kind, 'emote')); break;
    case 'emoted': w.u8(T.emoted).u16(msg.from).u8(index(EMOTE_KINDS, msg.kind, 'emote')); break;
    case 'chat': w.u8(T.chat).u16(msg.from).str(msg.name).str(msg.text); break;
    case 'input': {
      const flags = (msg.run ? 1 : 0) | (msg.crouch ? 2 : 0) | (msg.prone ? 4 : 0) | (msg.jump ? 8 : 0) | (msg.struggle ? 16 : 0);
      w.u8(T.input).u32(msg.seq).f32(msg.mx).f32(msg.mz).f32(msg.heading).u8(flags).f32(msg.crouchWheel ?? 0);
      break;
    }
    case 'act': w.u8(T.act).u8(index(ACT_KINDS, msg.kind, 'act')); break;
    case 'attack':
      w.u8(T.attack).u8(index(ATTACK_INTENT_PHASES, msg.phase, 'attack intent phase')).u8(index(ATTACK_KINDS, msg.kind, 'attack kind'));
      w.u8(msg.side === undefined ? 0xff : index(ATTACK_SIDES, msg.side, 'attack side'));
      break;
    case 'grab': w.u8(T.grab).u16(toU16(msg.object)).u8(msg.at ? 1 : 0); if (msg.at) w.f32(msg.at[0]).f32(msg.at[1]).f32(msg.at[2]); break;
    case 'place': w.u8(T.place).f32(msg.x).f32(msg.z).f32(msg.rot); break;
    case 'reset': w.u8(T.reset).u8(index(RESET_SCOPES, msg.scope, 'reset scope')).u16(toU16(msg.object)); break;
    case 'hold': w.u8(T.hold).f32(msg.turn[0]).f32(msg.turn[1]).f32(msg.turn[2]).f32(msg.turn[3]).f32(msg.raise); break;
    case 'drop': w.u8(T.drop); break;
    case 'throw': w.u8(T.throw).f32(msg.power).f32(msg.yaw).f32(msg.pitch); break;
    case 'inventory': {
      const inventory = msg;
      w.u8(T.inventory).u8(index(INVENTORY_ACTIONS, inventory.action, 'inventory action')).u32(inventory.revision);
      if (inventory.action === 'assign') {
        if (!Number.isInteger(inventory.object)) throw new RangeError('invalid inventory object');
        const object = inventory.object as number;
        w.u16(toU16(object));
      } else if (inventory.action === 'hotbar') {
        const slot = inventory.slot;
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 2) throw new RangeError('invalid hotbar slot');
        const hotbarSlot = slot as number;
        w.u8(hotbarSlot);
        if (inventory.itemId === undefined) w.u8(0); else w.u8(1).str(inventory.itemId);
      } else if (inventory.action === 'drop' || inventory.action === 'rotate') {
        if (!inventory.itemId || inventory.itemId.length > MAX_HOLD_ID) throw new RangeError('invalid inventory item');
        w.str(inventory.itemId);
      } else if (inventory.action === 'care') {
        if (!inventory.itemId || inventory.itemId.length > MAX_HOLD_ID) throw new RangeError('invalid medical care');
        if (inventory.target !== undefined && (!Number.isInteger(inventory.target) || inventory.target < 0 || inventory.target >= NO_U16)) throw new RangeError('invalid medical target');
        w.str(inventory.itemId).u16(toU16(inventory.target ?? NONE));
      } else if (inventory.action === 'care-stop') {
        // (nothing more: it ends whatever care is going on)
      } else if (inventory.action === 'medkit-open') {
        if (!Number.isInteger(inventory.object)) throw new RangeError('invalid medkit');
        w.u16(toU16(inventory.object as number));
      } else if (inventory.action === 'medkit-take') {
        if (!Number.isInteger(inventory.object) || !inventory.kit || !KITS.includes(inventory.kit)) throw new RangeError('invalid medkit take');
        w.u16(toU16(inventory.object as number)).u8(KITS.indexOf(inventory.kit));
      } else {
        const itemId = inventory.itemId, x = inventory.x, y = inventory.y;
        if (!itemId || itemId.length > MAX_HOLD_ID || typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) throw new RangeError('invalid inventory move');
        w.str(itemId).u8(x!).u8(y!);
      }
      break;
    }
    case 'grab-character':
      w.u8(T.grabCharacter).u16(toU16(msg.target)).u8(msg.az === undefined ? 0 : 1);
      if (msg.az !== undefined) w.f32(msg.az);
      w.u8(msg.lift === undefined ? 0 : 1);
      if (msg.lift !== undefined) w.f32(msg.lift);
      break;
    case 'release-character': w.u8(T.releaseCharacter); break;
    case 'throw-character': w.u8(T.throwCharacter); break;
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
      const definitions = msg.objectDefinitions ?? [];
      if (definitions.length > 0xffff) throw new RangeError('too many object definitions');
      w.u16(definitions.length);
      for (const definition of definitions) writeObjectDefinition(w, definition);
      break;
  }
  return w.bytes();
}

/** Decode a message from a client: only hello, ping, input, act, say, emote, grab, place and reset are accepted, and nothing else is parsed. */
export function decodeClient(bytes: Uint8Array): ClientMessage {
  if (bytes.length === 0 || (bytes[0] !== T.hello && bytes[0] !== T.ping && bytes[0] !== T.input && bytes[0] !== T.act && bytes[0] !== T.attack && bytes[0] !== T.say && bytes[0] !== T.emote && bytes[0] !== T.grab && bytes[0] !== T.place && bytes[0] !== T.reset && bytes[0] !== T.hold && bytes[0] !== T.drop && bytes[0] !== T.throw && bytes[0] !== T.inventory && bytes[0] !== T.grabCharacter && bytes[0] !== T.releaseCharacter && bytes[0] !== T.throwCharacter)) throw new DecodeError('not a message a client may send');
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
    case T.object: {
      const hasDefinition = r.u8();
      if (hasDefinition > 1) throw new DecodeError('invalid object definition flag');
      const definition = hasDefinition ? readObjectDefinition(r) : undefined;
      const pose = readObjectPose(r);
      if (definition && definition.index !== pose.index) throw new DecodeError('object definition index mismatch');
      msg = { type: 'object', pose, ...(definition ? { definition } : {}) };
      break;
    }
    case T.emote: msg = { type: 'emote', kind: readIndex(r, EMOTE_KINDS, 'emote') }; break;
    case T.emoted: { const from = r.u16(); msg = { type: 'emoted', from, kind: readIndex(r, EMOTE_KINDS, 'emote') }; break; }
    case T.chat: { const from = r.u16(), name = r.str(), text = r.str(); if (name.length > MAX_NAME || text.length > MAX_CHAT) throw new DecodeError('chat too long'); msg = { type: 'chat', from, name, text }; break; }
    case T.input: {
      const seq = r.u32(), mx = r.f32(), mz = r.f32(), heading = r.f32(), flags = r.u8(), crouchWheel = r.f32();
      if ((flags & 0xe0) !== 0 || Math.abs(crouchWheel) > 20) throw new DecodeError('invalid posture input');
      const input: Extract<ClientMessage, { type: 'input' }> = { type: 'input', seq, mx, mz, heading, run: !!(flags & 1) };
      if (flags & 2) input.crouch = true;
      if (flags & 4) input.prone = true;
      if (flags & 8) input.jump = true;
      if (flags & 16) input.struggle = true;
      if (crouchWheel !== 0) input.crouchWheel = crouchWheel;
      msg = input;
      break;
    }
    case T.act: msg = { type: 'act', kind: readIndex(r, ACT_KINDS, 'act') }; break;
    case T.attack: {
      const phase = readIndex(r, ATTACK_INTENT_PHASES, 'attack intent phase');
      const kind = readIndex(r, ATTACK_KINDS, 'attack kind');
      const side = r.u8();
      if (side !== 0xff && side >= ATTACK_SIDES.length) throw new DecodeError('unknown attack side');
      msg = { type: 'attack', phase, kind, ...(side === 0xff ? {} : { side: ATTACK_SIDES[side] }) };
      break;
    }
    case T.grab: { const object = fromU16(r.u16()); msg = r.u8() ? { type: 'grab', object, at: [r.f32(), r.f32(), r.f32()] } : { type: 'grab', object }; break; }
    case T.place: { const x = r.f32(), z = r.f32(), rot = r.f32(); msg = { type: 'place', x, z, rot }; break; }
    case T.reset: { const scope = readIndex(r, RESET_SCOPES, 'reset scope'), object = fromU16(r.u16()); msg = { type: 'reset', scope, object }; break; }
    case T.hold: { const turn: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()]; msg = { type: 'hold', turn, raise: r.f32() }; break; }
    case T.drop: msg = { type: 'drop' }; break;
    case T.throw: msg = { type: 'throw', power: r.f32(), yaw: r.f32(), pitch: r.f32() }; break;
    case T.inventory: {
      const action = readIndex(r, INVENTORY_ACTIONS, 'inventory action');
      const revision = r.u32();
      if (action === 'assign') {
        const object = fromU16(r.u16());
        if (object === NONE) throw new DecodeError('invalid inventory object');
        msg = { type: 'inventory', action, object, revision };
      } else if (action === 'hotbar') {
        const slot = r.u8(), present = r.u8();
        if (slot >= 3 || present > 1) throw new DecodeError('invalid hotbar intent');
        const itemId = present ? r.str() : undefined;
        if (itemId !== undefined && (!itemId || itemId.length > MAX_HOLD_ID)) throw new DecodeError('invalid inventory item');
        msg = { type: 'inventory', action, slot, revision, ...(itemId === undefined ? {} : { itemId }) };
      } else if (action === 'drop' || action === 'rotate') {
        const itemId = r.str();
        if (!itemId || itemId.length > MAX_HOLD_ID) throw new DecodeError('invalid inventory item');
        msg = { type: 'inventory', action, itemId, revision };
      } else if (action === 'care') {
        const itemId = r.str(), target = fromU16(r.u16());
        if (!itemId || itemId.length > MAX_HOLD_ID) throw new DecodeError('invalid medical care');
        msg = { type: 'inventory', action, itemId, ...(target === NONE ? {} : { target }), revision };
      } else if (action === 'care-stop') {
        msg = { type: 'inventory', action, revision };
      } else if (action === 'medkit-open') {
        const object = fromU16(r.u16());
        if (object === NONE) throw new DecodeError('invalid medkit');
        msg = { type: 'inventory', action, object, revision };
      } else if (action === 'medkit-take') {
        const object = fromU16(r.u16()), kit = r.u8();
        if (object === NONE || kit >= KITS.length) throw new DecodeError('invalid medkit take');
        msg = { type: 'inventory', action, object, kit: KITS[kit], revision };
      } else {
        const itemId = r.str(), x = r.u8(), y = r.u8();
        if (!itemId || itemId.length > MAX_HOLD_ID) throw new DecodeError('invalid inventory item');
        msg = { type: 'inventory', action, itemId, x, y, revision };
      }
      break;
    }
    case T.grabCharacter: {
      const target = fromU16(r.u16()), hasAz = r.u8(), az = hasAz ? r.f32() : undefined, hasLift = r.u8(), lift = hasLift ? r.f32() : undefined;
      if (hasAz > 1 || hasLift > 1) throw new DecodeError('invalid character hold');
      msg = { type: 'grab-character', target, ...(az === undefined ? {} : { az }), ...(lift === undefined ? {} : { lift }) };
      break;
    }
    case T.releaseCharacter: msg = { type: 'release-character' }; break;
    case T.throwCharacter: msg = { type: 'throw-character' }; break;
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
      const nDefinitions = count(r, 16, 'object definition'), definitions: ObjectDefinition[] = [];
      for (let i = 0; i < nDefinitions; i++) definitions.push(readObjectDefinition(r));
      msg = { type: 'welcome', tick, tickRate, simTime, day, speed, paused, live, you, layout, people, meetings, objects: objectsList, ...(definitions.length ? { objectDefinitions: definitions } : {}) };
      break;
    }
    default: throw new DecodeError(`unknown message type ${type}`);
  }
  if (r.remaining !== 0) throw new DecodeError('extra bytes after the message');
  return msg;
}

export function isServerMessage(m: Message): m is ServerMessage { return !isClientMessage(m); }
export function isClientMessage(m: Message): m is ClientMessage { return m.type === 'hello' || m.type === 'ping' || m.type === 'input' || m.type === 'act' || m.type === 'attack' || m.type === 'say' || m.type === 'emote' || m.type === 'grab' || m.type === 'place' || m.type === 'reset' || m.type === 'hold' || m.type === 'drop' || m.type === 'throw' || m.type === 'inventory' || m.type === 'grab-character' || m.type === 'release-character' || m.type === 'throw-character'; }
