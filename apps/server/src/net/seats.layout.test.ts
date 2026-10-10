import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OX, OY, S, clearBetween, findPath, interactables, setSeed, walkPx } from '@office/shared';
import { bootTestServer, type TestServer } from '../test-support';

// The rule that stops a player sitting through a wall (sit needs a clear way to the seat), checked against every seat of the real
// office: from every spot of floor the server would let a person sit from, the real walk to the seat must be about as long as
// the straight line. If a thin wall or partition ever lets someone sit from its far side, the walk is much longer and this fails.

process.env.WORLD_SEED = '1';
let server: TestServer;
beforeAll(async () => { server = await bootTestServer(); }, 30000);
afterAll(async () => { await server.close(); setSeed(null); });

// (The lounge is left out on purpose: its sofas, couches and TV seats have their own furniture around them, and a person standing in the
// gap behind a sofa back can sit on it, which is harmless. Everything else is a seat at a table, desk, bar, booth or keyboard, where the
// only thing between a person and the seat could be a wall or partition.)
const KINDS = ['desk', 'conf', 'dining', 'bar', 'booth', 'music'];
const REACH = 1.15, MARGIN = 0.6;
const routeLength = (from: { x: number; z: number }, to: { x: number; z: number }): number => {
  const route = findPath(from, to);
  if (!route) return Infinity;
  let len = 0, at = from;
  for (const q of route) { len += Math.hypot(q.x - at.x, q.z - at.z); at = q; }
  return len;
};

describe('sitting never reaches through a wall in the real office', () => {
  it('from every place the rule allows, the walk to the seat is not a long way round', () => {
    const seats = KINDS.flatMap(k => interactables.of(k));
    expect(seats.length).toBeGreaterThan(90);
    const bad: string[] = [];
    let checked = 0;
    for (const seat of seats) {
      for (let dx = -REACH; dx <= REACH; dx += 0.15) {
        for (let dz = -REACH; dz <= REACH; dz += 0.15) {
          const q = { x: seat.pos.x + dx, z: seat.pos.z + dz };
          if (Math.hypot(dx, dz) > REACH) continue;
          if (!walkPx(q.x / S + OX, q.z / S + OY)) continue; // not floor a person can stand on
          if (!clearBetween(q, seat.pos, MARGIN)) continue; // refused by the rule
          checked++;
          const walk = routeLength(q, seat.pos), straight = Math.hypot(dx, dz);
          if (walk > straight + 1.5) bad.push(`${seat.id} (${seat.kind}, ${seat.place}) from ${q.x.toFixed(2)},${q.z.toFixed(2)}: ${walk.toFixed(1)} m round for ${straight.toFixed(2)} m`);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(bad.slice(0, 10), `${bad.length} places let someone sit from behind a wall`).toEqual([]);
  }, 120000);
});
