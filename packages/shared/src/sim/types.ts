import type { CharacterSpec } from "../character/spec";
import type { Vec3 } from "../vec3";
import type { CharacterMechanicsState } from "./character-state";
import type { ScreenKind } from "./data";
import type { Spot } from "./interactables";
import type { InventoryState } from "./inventory";
import type { Controller } from "./person";
import type { HeldProps } from "./props";
import type { Shift } from "./schedule";

/** What a person is doing right now. 'controlled' people are driven by a human, not by the simulation. */
export type PersonState = "away" | "idle" | "walking" | "doing" | "controlled";

/** A place a task happens at. Usually a registered Spot; a chat is a one-off spot next to a colleague's desk. */
export type TaskSpot = Pick<
  Spot,
  "kind" | "pos" | "approach" | "face" | "shared" | "place"
> & { occupant?: unknown; game?: boolean; [extra: string]: unknown };

export interface Task {
  kind: string;
  /** Ledger category (a key of CATS). */
  cat: string;
  /** Which pose the client plays. */
  anim: string;
  /** Walk at running speed (the bucket run). */
  run?: boolean;
  spot: TaskSpot;
  /** How long it lasts in sim minutes. Meetings use `until` instead. */
  dur?: number;
  until?: number;
  meeting?: Meeting;
  partner?: Person;
  /** The Power Slap match this task belongs to (sim/slap.ts). */
  slap?: SlapMatch | null;
  onStart?: (p: Person) => void;
  onEnd?: (p: Person) => void;
  ended?: boolean;
}

/** One Power Slap fight: phases 'gather' (heading to the table), 'wind' (a slapper winds up), 'after' (the hit lands) or 'end'. */
export interface SlapMatch {
  id: number | string;
  /** Refereed by the server between two people online; the client only follows its events. */
  online: boolean;
  names: [string, string];
  /** The office people fighting (null when they are not in this office: an online fight only followed on the card). */
  fighters: [Person, Person] | null;
  spots: [Spot, Spot];
  phase: "gather" | "wind" | "after" | "end";
  /** Seconds into the phase (real seconds). */
  t: number;
  /** Slaps taken so far. */
  turn: number;
  /** Who slaps this turn: 0 or 1. */
  slapper: 0 | 1;
  power: [number, number];
  last: number;
  ko: boolean;
  winner: 0 | 1 | null;
  how: "ko" | "points" | "draw" | null;
  /** Which fighter the user slaps for with the power meter, or null. */
  mine: 0 | 1 | null;
  /** Waiting on the user's meter. */
  waiting: boolean;
  /** Who came in just for it (goes home when it ends). */
  away: [boolean, boolean];
  /** What an argument was about, when a chat or whiteboard discussion turned into this. */
  reason: string | null;
}

export interface Meeting {
  room: number;
  start: number;
  end: number;
  members: Person[];
  speaker: Person | null;
  swap: number;
  topic: string;
  /** A coding class (Conference 1): which of the shared LESSONS, and the person teaching it (they stand at the front and are the speaker). Neither is sent: `topic` names the lesson, and the teacher is the speaker. */
  lesson?: number | null;
  teacher?: Person | null;
}

/** One person in the office: a staff member the simulation drives, or a human-controlled one. */
export interface Person {
  id: number;
  name: string;
  role: string;
  controller: Controller;
  spec: CharacterSpec;
  /** The desk a staff member owns. Humans playing as guests have none. */
  slot?: Spot;
  /** The day number when a human took this person over (so a hand-back on a later day can give them that day's schedule). */
  drivenOnDay?: number;
  /** The account that owns this person's desk (or, for a guest, the account playing as one). Unset for a plain NPC. */
  owner?: number;
  pos: Vec3;
  face: number;
  faceGoal: number;
  speed: number;
  state: PersonState;
  /** Whether they are in the building and should be drawn. The client applies it to their meshes. */
  shown: boolean;
  props: HeldProps;
  task: Task | null;
  path: Vec3[] | null;
  pi: number;
  until: number;
  queue: string[];
  walkPhase: number;
  animT: number;
  /** Seconds left in a scratch-head stop after bumping into somebody (sim/bump.ts). */
  scratch?: number;
  /** Cooldown before this person can be stopped by a bump again. */
  bumpCd?: number;
  /** Seconds left flat on the floor after being shot (client player/guns.js; 0/undefined = up). */
  down?: number;
  /** Seeing birds for a moment after a slap that did not knock them down (sim/slap.ts; the client draws them). */
  dizzy?: boolean;
  pose: Record<string, unknown>;
  arriveAt: number;
  leaveAt: number;
  lunchAt: number;
  hadLunch: boolean;
  arrivedAt: number | null;
  coffees: number;
  chatWith: Person | null;
  meeting: Meeting | null;
  screenKind: ScreenKind;
  screenVariant: number;
  /** The employee this person is (the id in the staff list), or null/unset for made-up staff and guests. */
  userId?: string | null;
  /** What the card says they are: "UI/UX", "Intern HR". Falls back to the role. */
  title?: string;
  department?: string | null;
  /** Their profile picture (an https address), or null: the page shows their initials. */
  photo?: string | null;
  shift?: Shift | null;
  /** When their shift starts on the sim clock (06:00 to 30:00); their breaks are counted from it. */
  shiftStart?: number;
  /** Live clock: not clocked in today. */
  absent?: boolean;
  /** "Deploying to the toilet": out of the building until this time, then back with the bucket. */
  toiletUntil?: number | null;
  /** The break (day and index) that already stopped this person's desk work, so it stops it once. */
  breakKey?: number;
  /** The client's mesh rig for this person, attached by the client's people views. The simulation never reads it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
  /** Character mechanics state; absent on legacy records and normalized at creation/restore. */
  mechanics: CharacterMechanicsState;
  /** Server-authoritative carried/stored items and exactly three hotbar slots. */
  inventory: InventoryState;
}
