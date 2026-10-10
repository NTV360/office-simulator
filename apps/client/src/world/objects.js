import { DESK_TOP, W, addObject } from '@office/shared';

// Making the movable objects (chairs, stools, the things on desks, and the furniture that has become items) from the furniture code. They are
// plain data (see packages/shared/src/world); the page draws them from that data (render/objects.js) and the server owns them.

const record = (type, x, z, rot, opts, y) => ({
  type, x, z, rot, y, variant: opts.variant ?? 0, station: opts.station ?? null, spot: opts.spot ?? null,
  ...(opts.spots?.length ? { spots: opts.spots } : {}), ...(opts.dims ? { dims: opts.dims } : {}),
});

/** An object at a plan position (plan pixels) facing `face`. `opts`: y, variant, station (a desk id), spot (the seat it carries), spots (more), dims (its size). */
export function placeObject(type, px, py, face, opts = {}) {
  const p = W(px, py);
  return addObject(record(type, p.x, p.z, face, opts, opts.y ?? 0));
}

/** The same, but at (lx, lz) metres in the frame of a seat at (px, py) facing `face`: the way the desk decor is placed. */
export function placeObjectLocal(type, px, py, face, lx, lz, opts = {}) {
  const p = W(px, py), c = Math.cos(face), s = Math.sin(face);
  return addObject(record(type, p.x + lx * c + lz * s, p.z - lx * s + lz * c, face + (opts.turn ?? 0), opts, opts.y ?? DESK_TOP));
}

// Furniture that became an item after the first objects were made is added after them, in the order it is asked for here, so the first
// objects keep their ids (obj:0 to obj:161) and a world saved before still puts its moved chairs and mugs back on the right ones.
const later = [];
/** `make` (a call to placeObject or placeObjectLocal) runs once every object of the first kind exists; `then` gets the object it made. */
export const placeLater = (make, then) => later.push({ make, then });
/** Make the items that were asked for later. Called once, after the furniture is built. */
export function flushLaterObjects() {
  for (const { make, then } of later.splice(0)) { const o = make(); if (then) then(o); }
}
