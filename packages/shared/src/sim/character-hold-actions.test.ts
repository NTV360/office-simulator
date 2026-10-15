import { beforeEach, describe, expect, it } from 'vitest';
import { OX, OY, S } from '../plan';
import { walkPx } from '../nav/grid';
import { setSeed } from '../util';
import { initDay } from './day';
import { characterHolds, grabCharacter, syncCharacterHoldTransforms } from './character-hold-actions';
import { sit, sitFree } from './driven';
import { interactables } from './interactables';
import { people } from './state';
import { makeGuest } from './takeover';
import { buildTestLayout } from './testing';

// Holding another character, as the simulation sees it: only people hold people, a hold never carries anybody through a wall,
// and nobody takes a seat while the hold is writing where they stand every tick.

beforeEach(() => { setSeed(1); buildTestLayout({ desks: 40 }); initDay(); for (const p of people) p.state = 'away'; });

const walkable = (x: number, z: number) => walkPx(x / S + OX, z / S + OY);

describe('character holds', () => {
  it('refuses to take hold of one of the office\'s own workers, or to let one take hold', () => {
    const holder = makeGuest(1, 'holder');
    const npc = people.find(p => p.controller !== 'account')!;
    holder.pos.x = npc.pos.x + .3; holder.pos.z = npc.pos.z;
    expect(grabCharacter(holder, npc.id)).toEqual({ ok: false, reason: 'blocked' });
    expect(characterHolds.getHeld(holder.id)).toBeUndefined();
    const other = makeGuest(2, 'other');
    other.pos.x = npc.pos.x; other.pos.z = npc.pos.z + .3;
    expect(grabCharacter(npc, other.id)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('keeps the held person with the holder rather than place them outside the walkable floor', () => {
    // a spot on the floor with a wall (or the edge) 0.6 m ahead of it
    let spot: { x: number; z: number } | null = null;
    for (let x = -20; x <= 20 && !spot; x += .25) for (let z = -20; z <= 20; z += .25) {
      if (walkable(x, z) && walkable(x, z - .3) && !walkable(x, z + .6)) { spot = { x, z }; break; }
    }
    expect(spot, 'a wall somewhere in the test office').not.toBeNull();
    const holder = makeGuest(1, 'holder'), target = makeGuest(2, 'target');
    holder.pos.x = spot!.x; holder.pos.z = spot!.z; holder.face = 0;
    target.pos.x = spot!.x; target.pos.z = spot!.z - .3;
    expect(grabCharacter(holder, target.id)).toMatchObject({ ok: true });
    syncCharacterHoldTransforms();
    expect(walkable(target.pos.x, target.pos.z)).toBe(true);
    expect({ x: target.pos.x, z: target.pos.z }).toEqual({ x: holder.pos.x, z: holder.pos.z });
    expect(characterHolds.getHolder(target.id)).toBeDefined(); // (still held)
    // turned to face open floor, the held person goes out in front again
    holder.face = Math.PI;
    syncCharacterHoldTransforms();
    expect(Math.hypot(target.pos.x - holder.pos.x, target.pos.z - holder.pos.z)).toBeGreaterThan(.5);
  });

  it('does not let somebody held (or holding) take a seat', () => {
    const desk = interactables.of('desk')[1];
    const holder = makeGuest(1, 'holder'), target = makeGuest(2, 'target');
    target.pos.x = desk.approach.x; target.pos.z = desk.approach.z;
    holder.pos.x = target.pos.x + .3; holder.pos.z = target.pos.z;
    expect(grabCharacter(holder, target.id)).toMatchObject({ ok: true });
    expect(sit(target)).toBe(false);
    expect(sitFree(target)).toBe(false);
    expect(sit(holder)).toBe(false);
    expect(sitFree(holder)).toBe(false);
    expect(target.mechanics.posture).not.toBe('seated');
  });
});
