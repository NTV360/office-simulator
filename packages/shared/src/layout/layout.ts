import { initGrid, type ObstacleRect } from '../nav/grid';
import { interactables, type Spot } from '../sim/interactables';
import { Vec3 } from '../vec3';

// The office as data: every spot (desk, chair, counter, game...) in the order it was created, and the obstacle
// rectangles the nav grid avoids. The server loads this instead of running the client's furniture code.
// Generate it with `npm run layout:dump`; a browser check fails if the client's furniture no longer matches.

export interface SpotRecord {
  kind: string;
  id: string;
  pos: { x: number; y: number; z: number };
  approach: { x: number; y: number; z: number };
  face: number;
  sit: boolean;
  hipY: number;
  place: string;
  shared: boolean;
  room?: number;
  group?: string;
  /** Any other plain field a kind adds (for example `game: true` or `index`). */
  [extra: string]: unknown;
}

export interface LayoutData {
  version: 1;
  spots: SpotRecord[];
  obstacles: ObstacleRect[];
}

const isPlain = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const vec = (v: Vec3) => ({ x: v.x, y: v.y, z: v.z });
// runtime state, not layout
const RUNTIME = new Set(['occupant', 'owner']);

/** Turn the registered spots and the obstacle list into layout data (plain JSON). */
export function spotsToLayout(spots: readonly Spot[], obstacles: readonly ObstacleRect[]): LayoutData {
  const records = spots.map(s => {
    const rec: Record<string, unknown> = {};
    for (const key of Object.keys(s).sort()) {
      const v = s[key];
      if (RUNTIME.has(key)) continue;
      if (key === 'pos' || key === 'approach') rec[key] = vec(v as Vec3);
      else if (isPlain(v)) rec[key] = v;
      else if (v !== undefined && v !== null) throw new Error(`spot ${s.id} has a field "${key}" that is not plain data`);
    }
    return rec as SpotRecord;
  });
  return { version: 1, spots: records, obstacles: obstacles.map(o => [...o] as unknown as ObstacleRect) };
}

/** Rebuild the registry and the nav grid from layout data. Ids must come out exactly as saved. */
export function loadLayout(data: LayoutData): void {
  if (data.version !== 1) throw new Error(`unknown layout version ${data.version}`);
  interactables.clear();
  for (const rec of data.spots) {
    const { id, pos, approach, ...rest } = rec;
    const spot = interactables.add({ ...rest, pos: new Vec3(pos.x, pos.y, pos.z), approach: new Vec3(approach.x, approach.y, approach.z), occupant: null } as unknown as Omit<Spot, 'id'>);
    if (spot.id !== id) throw new Error(`layout spot ${id} came out as ${spot.id}: the data is not in creation order`);
  }
  initGrid(data.obstacles);
}
