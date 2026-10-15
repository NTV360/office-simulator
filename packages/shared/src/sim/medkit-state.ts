// What is in each medkit box, and how it fills up again. Process-local and session-only, like the free-sit state: a restarted server starts
// every box full. The server steps it with real seconds (not the simulated clock, which stops when the office is paused).

/** How close you must be to open a medkit or take from it (metres): the page offers it inside this, and the server holds you to it. */
export const MEDKIT_REACH = 1.8;
/** How close the patient must be to the medic during timed care (metres), and how far the medic may walk meanwhile. */
export const CARE_REACH = 1.25;
export const CARE_WALK_LIMIT = .5;

/** The things a medkit holds, and how many it holds at most. */
export const MEDKIT_MAX = { bandage: 10, 'first-aid-box': 5 } as const;
/** Seconds for the box to make one more of each. */
export const MEDKIT_RESTOCK_SECONDS = { bandage: 5, 'first-aid-box': 15 } as const;

export type MedkitItem = keyof typeof MEDKIT_MAX;
export const MEDKIT_ITEMS: readonly MedkitItem[] = ['bandage', 'first-aid-box'];
/** What a box holds right now. */
export type MedkitContents = Readonly<Record<MedkitItem, number>>;

export const isMedkitItem = (value: unknown): value is MedkitItem => value === 'bandage' || value === 'first-aid-box';

interface Box { count: Record<MedkitItem, number>; wait: Record<MedkitItem, number> }
const boxes = new Map<number, Box>();

/** A box is full the first time anybody looks at it. */
function boxOf(index: number): Box {
  let box = boxes.get(index);
  if (!box) { box = { count: { ...MEDKIT_MAX }, wait: { bandage: 0, 'first-aid-box': 0 } }; boxes.set(index, box); }
  return box;
}

/** What the box with this object index holds now. */
export const medkitContents = (index: number): MedkitContents => ({ ...boxOf(index).count });

/** Take one out. Returns false (and changes nothing) when there is none. */
export function takeFromMedkit(index: number, item: MedkitItem): boolean {
  const box = boxOf(index);
  if (box.count[item] <= 0) return false;
  box.count[item]--;
  return true;
}

/** Put one back (an item that could not be given on: nothing is lost). Never above the most the box holds. */
export function returnToMedkit(index: number, item: MedkitItem): void {
  const box = boxOf(index);
  box.count[item] = Math.min(MEDKIT_MAX[item], box.count[item] + 1);
}

/** Let `dt` seconds pass: every box that is not full makes the next item when its time is up. Returns the indexes of the boxes that changed. */
export function stepMedkits(dt: number): number[] {
  const changed: number[] = [];
  if (!Number.isFinite(dt) || dt <= 0) return changed;
  for (const [index, box] of boxes) {
    let did = false;
    for (const item of MEDKIT_ITEMS) {
      if (box.count[item] >= MEDKIT_MAX[item]) { box.wait[item] = 0; continue; }
      box.wait[item] += dt;
      while (box.wait[item] >= MEDKIT_RESTOCK_SECONDS[item] && box.count[item] < MEDKIT_MAX[item]) {
        box.wait[item] -= MEDKIT_RESTOCK_SECONDS[item];
        box.count[item]++;
        did = true;
      }
      if (box.count[item] >= MEDKIT_MAX[item]) box.wait[item] = 0;
    }
    if (did) changed.push(index);
  }
  return changed;
}

export function resetMedkitState(): void { boxes.clear(); }
