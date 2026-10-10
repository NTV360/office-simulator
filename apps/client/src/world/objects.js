import { DESK_TOP, W, addObject } from '@office/shared';

// Making the movable objects (chairs, stools and the small things on desks) from the furniture code. They are plain data (see
// packages/shared/src/world); the page draws them from that data (render/objects.js) and the server owns them.

/** An object at a plan position (plan pixels) facing `face`. `opts`: y, variant, station (a desk id), spot (the seat it carries). */
export function placeObject(type, px, py, face, opts = {}) {
  const p = W(px, py);
  return addObject({ type, x: p.x, z: p.z, rot: face, y: opts.y ?? 0, variant: opts.variant ?? 0, station: opts.station ?? null, spot: opts.spot ?? null });
}

/** The same, but at (lx, lz) metres in the frame of a seat at (px, py) facing `face`: the way the desk decor is placed. */
export function placeObjectLocal(type, px, py, face, lx, lz, opts = {}) {
  const p = W(px, py), c = Math.cos(face), s = Math.sin(face);
  return addObject({ type, x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, rot: face, y: opts.y ?? DESK_TOP, variant: opts.variant ?? 0, station: opts.station ?? null, spot: opts.spot ?? null });
}
