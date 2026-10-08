// Everything a person (NPC or player) can walk to and use: desks, chairs, counters, games...
// Spots are registered by kind when they are created (see mkSpot). Future kinds such as shop
// counters register the same way and can carry their own behaviour.
const byKind = new Map();

function add(spot) {
  if (!byKind.has(spot.kind)) byKind.set(spot.kind, []);
  byKind.get(spot.kind).push(spot);
  return spot;
}

// All spots of a kind, in creation order. The array is live: don't mutate it.
const EMPTY = [];
function of(kind) { return byKind.get(kind) || EMPTY; }

// Conference seats of one room (1-3).
function conf(room) { return of('conf').filter(s => s.room === room); }

export const interactables = { add, of, conf };
