import type { CharacterSpec } from '../character/spec';
import type { ScreenKind } from '../sim/data';
import type { PersonState } from '../sim/types';

// What travels between server and client. See docs/MULTIPLAYER-PLAN.md section 11 and docs/PHASE-2-BREAKDOWN.md step 2.

/** Bump when the layout of any message changes. A client with another version is refused. */
export const WIRE_VERSION = 4;

/** Used where a person id, meeting index or similar is "none". */
export const NONE = -1;
/** `spot` value: the person's task place is a one-off (a chat spot) described inline, not a registered spot. */
export const ONE_OFF_SPOT = 0xffff;

/** The things about a person that rarely change. Sent when they join and in the welcome. */
export interface PersonInfo {
  id: number;
  name: string;
  role: string;
  controller: 'ai' | 'account';
  spec: CharacterSpec;
  /** Index in the layout's spot list of the desk they own, or NONE. */
  slot: number;
  screenKind: ScreenKind;
  screenVariant: number;
  /** Today's arrival time (sim minutes). */
  arriveAt: number;
}

/** The things about a person that change as the simulation runs. Sent in snapshots. */
export interface PersonSnap {
  id: number;
  state: PersonState;
  shown: boolean;
  x: number;
  z: number;
  /** Radians. */
  face: number;
  walkPhase: number;
  /** Task kind and the pose and ledger category that go with it; '' when they have no task. */
  kind: string;
  anim: string;
  cat: string;
  /** 0 none; 1 + index into the layout's spot list; ONE_OFF_SPOT for a chat place (see `oneOff`). */
  spot: number;
  oneOff?: { x: number; z: number; face: number; place: string };
  /** The other person in a chat task, or NONE. */
  partner: number;
  /** Who is chatting with this person at their desk, or NONE. */
  chatWith: number;
  /** Index into the snapshot's meetings, or NONE. */
  meeting: number;
  /** Bit i set when the i-th held prop (mug, phone, pad, guitar, putter) is in hand. */
  props: number;
  /** When they came in today (sim minutes), or NONE if they have not. */
  arrivedAt: number;
  arriveAt: number;
  leaveAt: number;
  /** Coffees today, up to 255. */
  coffees: number;
}

export interface MeetingSnap {
  room: number;
  topic: string;
  start: number;
  end: number;
  /** Person id of whoever is presenting, or NONE. */
  speaker: number;
  members: number[];
}

/** A check that client and server are using the same office layout. */
export interface LayoutCheck {
  spots: number;
  hash: number;
}

export interface Welcome {
  type: 'welcome';
  tick: number;
  tickRate: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  /** The person id this connection drives, or NONE for a viewer. */
  you: number;
  layout: LayoutCheck;
  people: Array<{ info: PersonInfo; snap: PersonSnap }>;
  meetings: MeetingSnap[];
}

export interface Snapshot {
  type: 'snapshot';
  tick: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  /** True when `people` lists everyone; otherwise only people whose record changed. */
  full: boolean;
  people: PersonSnap[];
  /** Always the complete list; it is small. */
  meetings: MeetingSnap[];
}

export interface PersonJoined { type: 'person'; info: PersonInfo; snap: PersonSnap }
export interface PersonLeft { type: 'leave'; id: number }

export type EventKind = 'log' | 'announce' | 'day';
export interface GameEvent { type: 'event'; kind: EventKind; simTime: number; text: string }

/** The first thing a client says: its protocol version and the one-time ticket from POST /api/play/ticket. */
export interface Hello { type: 'hello'; version: number; ticket: string }
/** What the player wants to do this moment: which way to go (a fraction of full speed, in world x and z), which way to face, run or walk. */
export interface Input { type: 'input'; seq: number; mx: number; mz: number; heading: number; run: boolean }
/** Sit in the nearest seat, or stand up. The server decides whether it is allowed. */
export type ActKind = 'sit' | 'stand';
export interface Act { type: 'act'; kind: ActKind }
export interface Ping { type: 'ping'; ts: number }
export interface Pong { type: 'pong'; ts: number }
export interface Kick { type: 'kick'; reason: string }

export type ClientMessage = Hello | Ping | Input | Act;
export type ServerMessage = Welcome | Snapshot | PersonJoined | PersonLeft | GameEvent | Pong | Kick;
export type Message = ClientMessage | ServerMessage;
