import type { CharacterSpec } from '../character/spec';
import type { Vec3 } from '../vec3';
import type { Spot } from './interactables';
import type { Controller } from './person';
import type { HeldProps } from './props';
import type { ScreenKind } from './data';
import type { Shift } from './schedule';

/** What a person is doing right now. 'controlled' people are driven by a human, not by the simulation. */
export type PersonState = 'away' | 'idle' | 'walking' | 'doing' | 'controlled';

/** A place a task happens at. Usually a registered Spot; a chat is a one-off spot next to a colleague's desk. */
export type TaskSpot = Pick<Spot, 'kind' | 'pos' | 'approach' | 'face' | 'shared' | 'place'> & { occupant?: unknown; game?: boolean; [extra: string]: unknown };

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
  onStart?: (p: Person) => void;
  onEnd?: (p: Person) => void;
  ended?: boolean;
}

export interface Meeting {
  room: number;
  start: number;
  end: number;
  members: Person[];
  speaker: Person | null;
  swap: number;
  topic: string;
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
  /** What the card says they are: "UI/UX Department", "Intern HR". Falls back to the role. */
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
}
