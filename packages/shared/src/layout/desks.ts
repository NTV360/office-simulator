// The desks: one entry per desk island, in plan pixels. Plain data, so the page builds the furniture from it and the server validates
// desk ids with it. Seats are numbered left to right along the top side, then along the bottom: a 4-wide island with chairs on both
// sides has seats 1-4 on top and 5-8 below. A seat's id is the island id plus its number: 'A3', 'HR2'. (This is `main`'s
// `src/config/desks.js`; keep the two in step by changing it there first.)

export interface DeskIsland {
  id: string;
  name: string;
  /** x1, y1, x2, y2 in plan pixels. */
  rect: [number, number, number, number];
  cols: number;
  sides: Array<'top' | 'bottom'>;
  /** Only this department sits here (the HR office). */
  department?: string;
  /** A room of its own (the HR office), not an island in the open floor. */
  room?: boolean;
}

export const DESK_ISLANDS: readonly DeskIsland[] = [
  // A, B and C spaced so there is about 1.4 m between facing chair rows
  { id: 'A', name: 'Desk A', rect: [451.7, 154.7, 601.7, 202.4], cols: 4, sides: ['top', 'bottom'] },
  { id: 'B', name: 'Desk B', rect: [451.7, 261.5, 601.7, 309.3], cols: 4, sides: ['top', 'bottom'] },
  { id: 'C', name: 'Desk C', rect: [451.7, 369.3, 601.7, 417.0], cols: 4, sides: ['top', 'bottom'] },
  // 10 desks in facing pairs, set back from the HR office so its door has a walkway (about 1.4 m)
  { id: 'D', name: 'Desk D', rect: [255.7, 240, 402.9, 276], cols: 5, sides: ['top', 'bottom'] },
  { id: 'E', name: 'Desk E', rect: [451.7, 482.4, 601.7, 530.1], cols: 4, sides: ['top', 'bottom'] },
  { id: 'F', name: 'Desk F', rect: [451.7, 587.9, 601.7, 635.6], cols: 4, sides: ['top', 'bottom'] },
  { id: 'G', name: 'Desk G', rect: [416.7, 691.2, 622.2, 740.1], cols: 6, sides: ['top', 'bottom'] },
  { id: 'H', name: 'Desk H', rect: [415.6, 793.4, 621.1, 842.2], cols: 6, sides: ['top', 'bottom'] },
  // The old Conference 2 room, now the HR department's office: six desks inside the same walls.
  { id: 'HR', name: 'HR Office', rect: [296, 112, 366, 146], cols: 3, sides: ['top', 'bottom'], department: 'Human Resources', room: true },
];

/** How far a chair sits from the edge of its desk island, in plan pixels. */
export const SEAT_GAP = 12.8;

export interface DeskSeat {
  /** 'A3', 'HR2'. */
  id: string;
  island: DeskIsland;
  number: number;
  /** 'Desk A3', or 'HR Office · desk 2'. */
  label: string;
  /** The chair's position in plan pixels. */
  px: number;
  py: number;
}

/** Every seat, island by island (the order the desks are created in, so the spot ids `desk:0`, `desk:1`... follow it). */
export function deskSeats(): DeskSeat[] {
  return DESK_ISLANDS.flatMap(isl => {
    const [x1, y1, x2, y2] = isl.rect, cw = (x2 - x1) / isl.cols;
    return isl.sides.flatMap((side, si) => Array.from({ length: isl.cols }, (_, c) => {
      const n = si * isl.cols + c + 1;
      return { id: isl.id + n, island: isl, number: n, label: isl.room ? `${isl.name} · desk ${n}` : `${isl.name}${n}`, px: x1 + (c + .5) * cw, py: side === 'top' ? y1 - SEAT_GAP : y2 + SEAT_GAP };
    }));
  });
}

/** One seat by its id ('A3'), or null. */
export const deskSeat = (id: string | null | undefined): DeskSeat | null => (id ? deskSeats().find(s => s.id === id) ?? null : null);
