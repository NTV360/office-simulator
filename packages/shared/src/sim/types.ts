import type { CharacterSpec } from '../character/spec';
import type { Vec3 } from '../vec3';
import type { Spot } from './interactables';
import type { Controller } from './person';
import type { HeldProps } from './props';
import type { ScreenKind } from './data';

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
  /** 0 to 1, set by the client's rage effect for one character; the simulation pauses her while it is above a little. */
  rageK?: number;
  /** The client's mesh rig for this person, attached by the client's people views. The simulation never reads it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
}
