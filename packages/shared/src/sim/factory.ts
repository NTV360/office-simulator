import {
  normalizeSpec,
  randomSpec,
  type CharacterSpec,
} from "../character/spec";
import { HAZEL_DESK } from "../layout/desks";
import { clampSlotCount } from "../server-defaults";
import { TAU, pick, random, rnd, seededRandom } from "../util";
import { releaseCharacterPerson } from "./character-hold-actions";
import { defaultCharacterMechanics } from "./character-state";
import { FIRST, LAST, SCREEN_VARIANTS, roleBag, type ScreenKind } from "./data";
import { simEvents } from "./events";
import { HAZEL_NAME, applyHazel } from "./hazel";
import { helperIdentity } from "./helper";
import { interactables, type Spot } from "./interactables";
import { createInventory } from "./inventory";
import { liveSchedule, usesAttendance } from "./live";
import { hasSlot, isAi } from "./person";
import { newProps } from "./props";
import {
  allocateDesks,
  fullName,
  jobTitle,
  roster,
  simRole,
  unplacedEmployees,
  type Employee,
} from "./roster";
import { DAY_END, shiftWindow, type Shift } from "./schedule";
import { ENTRY } from "./spots";
import {
  allocatePersonId,
  counters,
  deskPool,
  meetings,
  people,
  sim,
} from "./state";
import { endTask, goWork } from "./tasks";
import type { Person } from "./types";

/** What the choice of a desk depends on. */
type DeskWish = Pick<Who, "desk" | "department" | "userId"> & { name?: string };

/** Who is about to be created: a roster employee, or a made-up one while no staff list is available. */
interface Who {
  name: string;
  role: string;
  title: string;
  userId: string | null;
  department: string | null;
  desk: string | null;
  shift: Shift | null;
  photo?: string | null;
  spec: CharacterSpec;
}

/** Create the next staff person at a free desk: a roster employee, or - while no staff list is available - a made-up one. */
export function makeStaff(): Person | null {
  const placed = roster.list ? nextSeated() : madeUp();
  return placed ? createPerson(placed.who, placed.seat) : null;
}

/** The office helper (sim/helper.ts): no desk, not on the staff list. She is away until her arrival time. */
export function makeHelper(): Person {
  return createPerson(helperIdentity(), null);
}

function createPerson(
  who: Who | ReturnType<typeof helperIdentity>,
  slot: Spot | null,
): Person {
  const { name, role, title, userId, department, shift, spec } = who;
  const photo = "photo" in who ? who.photo : null;
  const at = slot ?? { pos: ENTRY, face: Math.PI };
  const screenKind: ScreenKind = role.includes("Designer")
    ? "design"
    : role === "DevOps" || role === "CTO"
      ? "dash"
      : "code";
  // the order of the random draws below is part of the recorded simulation; do not reorder
  const p: Person = {
    id: allocatePersonId(),
    controller: "ai",
    name,
    role,
    title,
    userId,
    department,
    shift,
    photo: photo ?? null,
    toiletUntil: null,
    spec,
    ...(slot ? { slot } : {}),
    pos: at.pos.clone(),
    face: at.face,
    faceGoal: at.face,
    speed: rnd(1.15, 1.45),
    state: "away",
    shown: false,
    props: newProps(),
    task: null,
    path: null,
    pi: 0,
    until: 0,
    queue: [],
    walkPhase: random() * TAU,
    animT: random() * 10,
    pose: {},
    arriveAt: 0,
    leaveAt: 0,
    lunchAt: 0,
    hadLunch: false,
    arrivedAt: null,
    coffees: 0,
    chatWith: null,
    meeting: null,
    screenKind,
    screenVariant: 0,
    mechanics: defaultCharacterMechanics(),
    inventory: createInventory(),
  };
  p.screenVariant = Math.floor(random() * SCREEN_VARIANTS[screenKind]); // same single draw as picking from the list
  if (slot) slot.owner = p;
  scheduleDay(p);
  people.push(p);
  simEvents.emit("personAdded", p);
  return p;
}

/**
 * A real employee: their name, department (shown as their job) and their saved look (or a generated one). Hazel, if she works here, always has her
 * own look (a smaller character with her furious face) and her own desk (HAZEL_DESK).
 */
function employee(e: (typeof roster.list & object)[number]): Who {
  const role = simRole(e.department),
    title = jobTitle(e);
  const hazel = fullName(e).toLowerCase() === HAZEL_NAME.toLowerCase(),
    name = hazel ? HAZEL_NAME : fullName(e);
  let spec = e.character
    ? normalizeSpec(e.character)
    : randomSpec(role, seededRandom(e.userId)); // (the same look on every load)
  if (hazel) spec = applyHazel().spec;
  return {
    name,
    role,
    title,
    userId: e.userId,
    department: e.department,
    desk: hazel ? HAZEL_DESK : e.desk,
    shift: e.shift ?? null,
    photo: e.photo ?? null,
    spec,
  };
}

/**
 * No staff list (running locally, or the API is unavailable): made-up names and roles, at any free desk. `syncRoster` swaps them
 * for real employees when a roster arrives (`replaced`). An empty roster is authoritative: it means an empty office, not fallback people.
 */
function madeUp(): { who: Who; seat: Spot } | null {
  const seat = seatFor({ userId: null, department: null, desk: null });
  if (!seat) return null;
  const role = pick(roleBag);
  const who: Who = {
    name: npcName(),
    role,
    title: role,
    userId: null,
    department: null,
    desk: null,
    shift: null,
    spec: randomSpec(role),
  };
  return { who, seat };
}

/** The next employee not yet in the office who has a desk to go to (one without a free desk is skipped). */
function nextSeated(): { who: Who; seat: Spot } | null {
  const unplaced = unplacedEmployees(people);
  const blocked = people
    .filter(hasSlot)
    .map((p) => p.slot?.deskId)
    .filter((id): id is string => !!id);
  const assignments = allocateDesks(
    unplaced,
    deskPool.map((s) => ({ deskId: s.deskId!, department: s.department })),
    blocked,
  );
  for (const e of [...unplaced].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  )) {
    const deskId = assignments.get(e.userId);
    const seat = deskId
      ? deskPool.find((s) => s.deskId === deskId && !s.owner)
      : null;
    if (seat) return { who: employee(e), seat }; // (the look is only made for someone who has a desk to go to)
  }
  return null;
}

/**
 * Where someone sits: the desk they chose, else a free one. Department desks (the HR office) are only for that department, and desks other
 * employees chose stay free for them.
 */
function seatFor(who: DeskWish): Spot | null {
  const chosen = new Set(
    (roster.list ?? [])
      .filter((e) => e.desk && e.userId !== who.userId)
      .map((e) => e.desk),
  );
  const hers = who.name === HAZEL_NAME;
  if (!hers) chosen.add(HAZEL_DESK); // Hazel's high chair is hers
  const open = (s: Spot) => !s.owner && !chosen.has(s.deskId ?? "");
  const mayUse = (s: Spot) => !s.department || s.department === who.department; // the HR office is for HR, even if someone asks for a desk in it
  return (
    deskPool.find(
      (s) =>
        who.desk &&
        s.deskId === who.desk &&
        !s.owner &&
        mayUse(s) &&
        (hers || s.deskId !== HAZEL_DESK),
    ) ??
    deskPool.find(
      (s) => open(s) && !!s.department && s.department === who.department,
    ) ??
    deskPool.find((s) => open(s) && !s.department) ??
    null
  );
}

/** The desk with this seat id ('A3'), or null. */
export const seatById = (id: string): Spot | null =>
  deskPool.find((s) => s.deskId === id) ?? null;

/**
 * Move someone to another desk. Whoever sat there takes their old desk. Anyone working at a desk that changed walks over to the new one.
 * The HR office takes only HR staff (and gives its desk to nobody else in a swap). Every viewer is told (`personUpdated`). Returns whether it moved.
 */
export function moveToDesk(p: Person, seat: Spot | null): boolean {
  if (!seat || seat === p.slot || !p.slot) return false;
  const old = p.slot,
    other = seat.owner as Person | null | undefined;
  const mayUse = (who: Person, s: Spot) =>
    !s.department || s.department === who.department;
  if (!mayUse(p, seat) || (other && !mayUse(other, old))) return false;
  seat.owner = p;
  p.slot = seat;
  old.owner = other ?? null;
  if (other) other.slot = old;
  for (const q of [p, other])
    if (
      q &&
      (q.task?.kind === "work" ||
        q.task?.kind === "lunchDesk" ||
        q.task?.kind === "snackDesk") &&
      q.state !== "away"
    ) {
      endTask(q);
      goWork(q);
    }
  simEvents.emit("personUpdated", p);
  if (other) simEvents.emit("personUpdated", other);
  return true;
}

/** Can this person be removed from the office? Not one who belongs to an account, and not one a human is driving. */
const removable = (p: Person): boolean =>
  isAi(p) && hasSlot(p) && p.owner === undefined;

/**
 * Remove the most recently added unclaimed staff member. A person who belongs to an account, and anyone a human is
 * driving, is never removed. Their desk is free again.
 */
export function removeStaff(): Person | null {
  let i = people.length - 1;
  while (i >= 0 && !removable(people[i])) i--;
  return i < 0 ? null : takeOut(i);
}

/** Remove this particular staff member (same rule: never one who belongs to an account or is driven). Returns whether they were removed. */
export function removePerson(p: Person): boolean {
  const i = people.indexOf(p);
  return i >= 0 && removable(p) && takeOut(i) !== null;
}

function takeOut(i: number): Person {
  const [p] = people.splice(i, 1);
  releaseCharacterPerson(p.id);
  endTask(p);
  if (p.slot) p.slot.owner = null;
  // nobody may keep pointing at someone who has gone: take them out of the meetings and any chat at their desk
  for (const m of meetings) {
    m.members = m.members.filter((x) => x !== p);
    if (m.speaker === p) m.speaker = null;
  }
  for (const q of people) {
    if (q.chatWith === p) q.chatWith = null;
    if (q.task?.partner === p) delete q.task.partner;
  }
  simEvents.emit("personRemoved", p);
  return p;
}

/**
 * Bring a person in line with their employee record: name, title, department, role, shift, the look chosen for them, and the desk they chose
 * (a swap with an ordinary NPC; never with someone who belongs to an account or is driven). Viewers are told if anything changed. Returns whether it did.
 */
export function applyEmployee(p: Person, e: Employee): boolean {
  const hazel = fullName(e).toLowerCase() === HAZEL_NAME.toLowerCase();
  let changed = false;
  const set = <K extends keyof Person>(key: K, value: Person[K]): void => {
    if (p[key] !== value) {
      p[key] = value;
      changed = true;
    }
  };
  if (p.owner === undefined) set("name", hazel ? HAZEL_NAME : fullName(e));
  set("title", jobTitle(e));
  set("department", e.department);
  set("role", simRole(e.department));
  set("photo", e.photo ?? null);
  const a = p.shift ?? null,
    b = e.shift;
  if (
    a === null || b === null
      ? a !== b
      : a.code !== b.code || a.start !== b.start || a.end !== b.end
  ) {
    p.shift = b;
    changed = true;
  }
  if ((hazel || e.character) && p.owner === undefined) {
    const spec = hazel ? applyHazel().spec : normalizeSpec(e.character);
    if (JSON.stringify(spec) !== JSON.stringify(p.spec)) {
      p.spec = spec;
      changed = true;
    }
  }
  if (changed) simEvents.emit("personUpdated", p);
  const currentAllowed =
    p.slot && (!p.slot.department || p.slot.department === e.department);
  const wish = hazel ? HAZEL_DESK : e.desk === HAZEL_DESK ? null : e.desk; // (her desk is hers alone)
  const requested = wish ? seatById(wish) : null;
  const requestedAllowed =
    requested &&
    (!requested.department || requested.department === e.department);
  const name = hazel ? HAZEL_NAME : undefined;
  const wanted = wish
    ? requestedAllowed
      ? requested
      : seatFor({
          userId: e.userId,
          department: e.department,
          desk: null,
          name,
        })
    : currentAllowed && p.slot?.deskId !== HAZEL_DESK
      ? p.slot
      : seatFor({
          userId: e.userId,
          department: e.department,
          desk: null,
          name,
        });
  if (wanted && wanted !== p.slot) {
    const other = wanted.owner as Person | null | undefined;
    if (!other || (isAi(other) && other.owner === undefined)) {
      if (moveToDesk(p, wanted)) changed = true;
    }
  }
  return changed;
}

/**
 * Change how many slots there are: add people at free desks or remove the most recent unclaimed ones, never beyond the number
 * of desks and never below the number that belong to accounts.
 * Someone added during the working day arrives within a few minutes instead of waiting for their scheduled time.
 * Returns the new number of staff.
 */
export function setStaffCount(requested: number): number {
  const target = clampSlotCount(requested, interactables.of("desk").length);
  const count = () => people.filter(hasSlot).length;
  while (count() < target) {
    const p = makeStaff();
    if (!p) break;
    if (sim.t < p.leaveAt - 30 && sim.t > 7 * 60 + 50)
      p.arriveAt = sim.t + rnd(0.1, 4);
  }
  while (count() > target) {
    if (!removeStaff()) break;
  } // claimed people stay, so the number can stop above the target
  return count();
}

/** A fresh NPC name (the next in the list), for a person an account has given up. Uses no random numbers. */
export function npcName(): string {
  const i = counters.nameIdx++;
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}.`;
}

/** Today's times from their shift: arrive around the start, lunch about three hours in, leave around the end. */
export function scheduleDay(p: Person): void {
  const { start, end } = shiftWindow(p.shift);
  p.shiftStart = start;
  p.absent = false;
  p.arriveAt = start + rnd(-20, 12);
  p.leaveAt = Math.min(DAY_END - 6, end + rnd(0, 20));
  p.lunchAt = start + 3 * 60 + rnd(0, 25);
  p.hadLunch = false;
  p.arrivedAt = null;
  p.coffees = 0;
  if (p.name === HAZEL_NAME) p.leaveAt = Math.min(DAY_END - 3, end + 62); // Hazel is always the last one out
  if (usesAttendance() && p.userId) liveSchedule(p); // Live: real clock-in and clock-out times instead
}
