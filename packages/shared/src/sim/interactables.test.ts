import { beforeEach, describe, expect, it } from 'vitest';
import { W } from '../plan';
import { ENTRY, exitSpot, mkSpot } from './spots';
import { interactables } from './interactables';

beforeEach(() => interactables.clear());

describe('interactables', () => {
  it('lists spots by kind in creation order and gives each a stable id', () => {
    const a = mkSpot('desk', 300, 500, 0), b = mkSpot('desk', 320, 500, 0), c = mkSpot('bar', 340, 500, 0);
    expect(interactables.of('desk')).toEqual([a, b]);
    expect([a.id, b.id, c.id]).toEqual(['desk:0', 'desk:1', 'bar:0']);
    expect(interactables.kinds()).toEqual(['desk', 'bar']);
    expect(interactables.of('nothing')).toEqual([]);
  });
  it('also lists a spot under its group, and a room filter finds conference seats', () => {
    const p = mkSpot('piano', 300, 500, 0, { group: 'music' }), g = mkSpot('guitar', 310, 500, 0, { group: 'music' });
    expect(interactables.of('music')).toEqual([p, g]);
    expect(g.id).toBe('guitar:0');
    const s1 = mkSpot('conf', 1, 1, 0, { room: 1 }), s2 = mkSpot('conf', 2, 2, 0, { room: 2 });
    expect(interactables.conf(2)).toEqual([s2]);
    expect(interactables.conf(1)).toEqual([s1]);
  });
  it('turns plan pixels into world metres and applies defaults', () => {
    const s = mkSpot('desk', 223.5, 420, 1.5, { ap: [230, 420], sit: true });
    expect(s.pos).toEqual(W(223.5, 420));
    expect(s.approach).toEqual(W(230, 420));
    expect(s).toMatchObject({ face: 1.5, sit: true, hipY: .53, place: '', shared: true, occupant: null });
    expect(mkSpot('x', 1, 1, 0, { shared: false }).shared).toBe(false);
  });
  it('ids restart after clear (a fresh layout)', () => {
    mkSpot('desk', 1, 1, 0);
    interactables.clear();
    expect(mkSpot('desk', 1, 1, 0).id).toBe('desk:0');
  });
  it('the entry is the same point as the exit door, and the exit spot is found once registered', () => {
    expect(ENTRY).toEqual(W(223.5, 456));
    expect(exitSpot()).toBeUndefined();
    const e = mkSpot('exit', 223.5, 456, Math.PI, { shared: false });
    expect(exitSpot()).toBe(e);
  });
});
