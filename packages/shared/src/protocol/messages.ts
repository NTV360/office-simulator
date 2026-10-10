import type { CharacterSpec } from '../character/spec';
import type { ScreenKind } from '../sim/data';
import type { PersonState } from '../sim/types';

// What travels between server and client. See docs/MULTIPLAYER-PLAN.md section 11 and docs/PHASE-2-BREAKDOWN.md step 2.

/** Bump when the layout of any message changes. A client with another version is refused. */
export const WIRE_VERSION = 17;

/** A profile picture address the wire carries: https, no spaces, quote marks or angle brackets, at most 2000 characters (signed links are long). */
export const PHOTO_URL = /^https:\/\/[^\s"'<>]{1,2000}$/;

/** The longest chat line, in characters. */
export const MAX_CHAT = 200;

/** Cut a chat line to MAX_CHAT (counted in the units the protocol counts, UTF-16) without splitting a character such as an emoji. */
export function clipChat(text: string): string {
  let out = '', n = 0;
  for (const ch of text) { if (n + ch.length > MAX_CHAT) break; out += ch; n += ch.length; }
  return out;
}

/** Used where a person id, meeting index or similar is "none". */
export const NONE = -1;
/** `spot` value: the person's task place is a one-off (a chat spot) described inline, not a registered spot. */
export const ONE_OFF_SPOT = 0xffff;

/** The things about a person that rarely change. Sent when they join and in the welcome. */
export interface PersonInfo {
  id: number;
  name: string;
  role: string;
  /** What the card says they are ("UI/UX Department"); the role when they have no better. */
  title: string;
  /** '' when they have none. */
  department: string;
  /** Their profile picture (an https address), '' when they have none. */
  photo: string;
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
  /** Live clock: not clocked in today. */
  absent: boolean;
  /** Out of the building on the toilet run (they come back with the bucket). */
  toilet: boolean;
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
  /** Bit i set when the i-th held prop (mug, phone, pad, guitar, putter, bucket) is in hand. */
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

/** Where a world object is now: its place in the layout's object list, its pose (with its height, and its whole orientation when it is not upright), and who carries it (NONE if nobody). */
export interface ObjectPose { index: number; x: number; z: number; rot: number; y: number; q: [number, number, number, number] | null; carriedBy: number }

export interface Welcome {
  type: 'welcome';
  tick: number;
  tickRate: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  /** The clock follows the real time and who is clocked in (the server's Live mode), not the simulated day. Absent: Simulate. */
  live?: boolean;
  /** The person id this connection drives, or NONE for a viewer. */
  you: number;
  layout: LayoutCheck;
  people: Array<{ info: PersonInfo; snap: PersonSnap }>;
  meetings: MeetingSnap[];
  /** The objects that are not where they started (everything else is at home, which every page knows from the layout). */
  objects: ObjectPose[];
}

/**
 * A person whose record changed in nothing but where they are: that is most records, most of the time (everybody who is walking). Sent as
 * these 14 bytes instead of the whole record (see PersonSnap); the receiver keeps everything else it already knows about them.
 */
export interface MoveSnap { id: number; x: number; z: number; face: number; walkPhase: number }

export interface Snapshot {
  type: 'snapshot';
  tick: number;
  simTime: number;
  day: number;
  speed: number;
  paused: boolean;
  /** The server's clock mode (see Welcome). */
  live?: boolean;
  /** True when `people` lists everyone; otherwise only people whose record changed. */
  full: boolean;
  people: PersonSnap[];
  /** People who only moved since they were last sent in full (never on a keyframe). Absent: none. */
  moves?: MoveSnap[];
  /** Always the complete list; it is small. */
  meetings: MeetingSnap[];
}

/** A world object moved, was picked up or put down. Sent to everybody playing. */
export interface ObjectMoved { type: 'object'; pose: ObjectPose }
export interface PersonJoined { type: 'person'; info: PersonInfo; snap: PersonSnap }
export interface PersonLeft { type: 'leave'; id: number }

/** 'notice' is for one player alone ("you are chatting too fast"); the others go to everybody. */
export type EventKind = 'log' | 'announce' | 'day' | 'notice';
export interface GameEvent { type: 'event'; kind: EventKind; simTime: number; text: string }

/** The first thing a client says: its protocol version and the one-time ticket from POST /api/play/ticket. */
export interface Hello { type: 'hello'; version: number; ticket: string }
/** What the player wants to do this moment: which way to go (a fraction of full speed, in world x and z), which way to face, run or walk. */
export interface Input { type: 'input'; seq: number; mx: number; mz: number; heading: number; run: boolean }
/** Sit in the nearest seat, or stand up. The server decides whether it is allowed. */
export type ActKind = 'sit' | 'stand';
export interface Act { type: 'act'; kind: ActKind }
/** Something the player says in local chat: heard by people within about 10 m. */
export interface Say { type: 'say'; text: string }
/** The short list of things a player can act out. The order is part of the protocol: add to the end. */
export const EMOTE_KINDS = ['wave', 'cheer', 'clap', 'nod'] as const;
export type EmoteKind = typeof EMOTE_KINDS[number];
/** Do an emote (the server limits how often). */
export interface Emote { type: 'emote'; kind: EmoteKind }
export interface Ping { type: 'ping'; ts: number }
export interface Pong { type: 'pong'; ts: number }
export interface Kick { type: 'kick'; reason: string }
/**
 * Sent to a player alone, about once per tick while they move: the number of the last input the server used for their person, the tick,
 * and where their person is. The client compares this with its own prediction (see sim/prediction.ts).
 */
/** A chat line, sent to the speaker and to everyone within range of them. */
export interface Chat { type: 'chat'; from: number; name: string; text: string }
/** Somebody did an emote; sent to everyone who is playing. */
export interface Emoted { type: 'emoted'; from: number; kind: EmoteKind }
export interface Ack { type: 'ack'; seq: number; tick: number; x: number; z: number; face: number }

/** Pick up the object with this index (see world/objects.ts). The server decides whether it is allowed, in reach and free. */
/** Take hold of an object, at the point of it the player aims at (absent: the point nearest them). */
export interface Grab { type: 'grab'; object: number; at?: [number, number, number] }
/** Put down what you carry at this place, facing this way (metres, radians). The server checks the place (world/placement.ts). */
export interface Place { type: 'place'; x: number; z: number; rot: number }
/** Put something back where it started: one object ('object'), or everything at your own desk ('station'; `object` is then ignored). */
export type ResetScope = 'object' | 'station';
export interface Reset { type: 'reset'; scope: ResetScope; object: number }

/** How the player holds what they hold: turned in their hands (a quaternion, in their own frame: up, right, forward) and hands raised or lowered (m). */
export interface HoldInput { type: 'hold'; turn: [number, number, number, number]; raise: number }
/** Let go of your hold: it falls (or, held by others too, they carry on). */
export interface Drop { type: 'drop' }
/** Throw what you hold, as hard as `power` says (0 to 1). */
export interface Throw { type: 'throw'; power: number }

export type ClientMessage = Hello | Ping | Input | Act | Say | Emote | Grab | Place | Reset | HoldInput | Drop | Throw;
export type ServerMessage = Welcome | Snapshot | PersonJoined | PersonLeft | GameEvent | Pong | Kick | Ack | Chat | Emoted | ObjectMoved;
export type Message = ClientMessage | ServerMessage;
