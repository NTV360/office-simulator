import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { interactables } from '../sim/interactables';
import { parseSavedWorld, restoreWorld, serializeWorld, SaveError } from '../sim/persist';
import { initDay } from '../sim/day';
import { initState, resetSim } from '../sim/state';
import { simEvents } from '../sim/events';
import { layoutCheck, applyObjectPose, applyObjectPoses, movedObjectPoses } from '../protocol/convert';
import { setSeed } from '../util';
import { CATALOGUE, isMovableType } from './catalogue';
import { addObject, isAtHome, movedObjects, objects, resetAllObjects, resetObject, setObjectPose } from './objects';

beforeEach(() => { simEvents.clear(); resetSim(); loadLayout(officeLayout); });

describe('the catalogue', () => {
  it('knows every kind in the office, and what can move', () => {
    for (const o of officeLayout.objects!) expect(CATALOGUE[o.type], o.type).toBeDefined();
    expect(['chair-office', 'chair-wood', 'stool-bar', 'mug', 'notebook', 'plant-desk'].every(isMovableType)).toBe(true);
    expect(isMovableType('table')).toBe(false); // (not a kind at all: nothing unknown is movable)
  });
  it('light things rest on a surface, chairs on the floor', () => {
    expect(CATALOGUE.mug.rests).toBe('surface');
    expect(CATALOGUE['chair-office'].rests).toBe('floor');
    for (const t of Object.values(CATALOGUE)) expect(t.radius).toBeGreaterThan(0);
  });
});

describe('the starting objects', () => {
  it('the office has 402 of them: 100 office chairs, 18 dining chairs, 4 stools, the things on the desks, and every desk\'s computer', () => {
    const kinds: Record<string, number> = {};
    for (const o of objects.all()) kinds[o.type] = (kinds[o.type] || 0) + 1;
    expect(objects.count()).toBe(402);
    expect(kinds).toEqual({ 'chair-office': 100, 'chair-wood': 18, 'stool-bar': 4, mug: 28, notebook: 8, 'plant-desk': 4, monitor: 80, keyboard: 80, mouse: 80 });
  });
  it('the first 162 are the ones there were before furniture became items, in the same order: a world saved before puts its things back on the right ones', () => {
    const first = new Set(['chair-office', 'chair-wood', 'stool-bar', 'mug', 'notebook', 'plant-desk']);
    expect(objects.all().slice(0, 162).every(o => first.has(o.type))).toBe(true);
    expect(objects.all().slice(162).some(o => first.has(o.type))).toBe(false);
  });
  it('ids are obj:0, obj:1... in the order of the layout data, and each knows its place in the list', () => {
    objects.all().forEach((o, i) => { expect(o.id).toBe(`obj:${i}`); expect(o.index).toBe(i); expect(objects.byId(o.id)).toBe(o); expect(objects.at(i)).toBe(o); });
  });
  it('every seat of a kind that has a chair is carried by exactly one chair, at the same place and facing the same way', () => {
    const chairs = objects.all().filter(o => o.spot);
    expect(chairs).toHaveLength(100 + 18 + 4);
    for (const o of chairs) {
      const spot = interactables.all().find(s => s.id === o.spot)!;
      expect(spot.object, o.id).toBe(o.id);
      if (o.type !== 'chair-office' || !/^booth/.test(spot.id)) { expect(spot.pos.x).toBeCloseTo(o.x, 6); expect(spot.pos.z).toBeCloseTo(o.z, 6); }
      expect(spot.face).toBeCloseTo(o.rot, 6);
    }
    expect(new Set(chairs.map(o => o.spot)).size).toBe(chairs.length);
  });
  it('every desk has a chair that belongs to its station, and what is on a desk belongs to that desk', () => {
    for (const d of interactables.of('desk')) expect(objects.all().some(o => o.type === 'chair-office' && o.spot === d.id && o.station === d.id), d.id).toBe(true);
    for (const o of objects.all().filter(x => x.type === 'mug' || x.type === 'notebook' || x.type === 'plant-desk')) {
      expect(o.station, o.id).toMatch(/^desk:\d+$/);
      expect(o.y).toBeCloseTo(0.76, 6);
    }
    for (const o of objects.all().filter(x => x.type === 'chair-wood' || x.type === 'stool-bar')) expect(o.station).toBeNull(); // shared areas
  });
  it('they are the same on every run: loading the layout data twice gives identical objects', () => {
    const first = JSON.stringify(objects.all().map(o => [o.id, o.type, o.x, o.z, o.rot, o.y, o.variant, o.station, o.spot]));
    loadLayout(officeLayout);
    expect(JSON.stringify(objects.all().map(o => [o.id, o.type, o.x, o.z, o.rot, o.y, o.variant, o.station, o.spot]))).toBe(first);
    expect(objects.count()).toBe(402); // (loading again does not stack them)
  });
  it('they start at home, and carry nobody', () => {
    expect(objects.all().every(isAtHome)).toBe(true);
    expect(movedObjects()).toEqual([]);
    expect(objects.all().every(o => o.carriedBy === null)).toBe(true);
  });
});

describe('moving an object', () => {
  const chair = () => objects.all().find(o => o.spot === 'desk:5')!;

  it('puts it somewhere else, and its seat goes with it: same ids, new place, new facing', () => {
    const o = chair(), seat = interactables.all().find(s => s.id === 'desk:5')!;
    const before = { x: seat.pos.x, z: seat.pos.z, face: seat.face, ax: seat.approach.x };
    setObjectPose(o, o.x + 2, o.z - 1.5, o.rot + 0.5);
    expect(seat.pos.x).toBeCloseTo(before.x + 2, 6);
    expect(seat.pos.z).toBeCloseTo(before.z - 1.5, 6);
    expect(seat.face).toBeCloseTo(before.face + 0.5, 6);
    expect(seat.approach.x).toBeCloseTo(before.ax + 2, 6);
    expect(seat.id).toBe('desk:5');
    expect(isAtHome(o)).toBe(false);
    expect(movedObjects()).toEqual([o]);
  });

  it('a seat whose approach point is not the seat (a phone booth) keeps its offset, turning with the chair', () => {
    const o = objects.all().find(x => x.spot && x.spot.startsWith('booth'))!;
    const seat = interactables.all().find(s => s.id === o.spot)!;
    const dx0 = seat.approach.x - seat.pos.x, dz0 = seat.approach.z - seat.pos.z;
    setObjectPose(o, o.x + 1, o.z + 1, o.rot); // moved, not turned: the offset is the same
    expect(seat.approach.x - seat.pos.x).toBeCloseTo(dx0, 6);
    expect(seat.approach.z - seat.pos.z).toBeCloseTo(dz0, 6);
    setObjectPose(o, o.x, o.z, o.rot + Math.PI / 2); // turned a quarter: the offset turns with it, its length does not change
    expect(Math.hypot(seat.approach.x - seat.pos.x, seat.approach.z - seat.pos.z)).toBeCloseTo(Math.hypot(dx0, dz0), 6);
  });

  it('putting it back (or resetting everything) restores the seat exactly', () => {
    const o = chair(), seat = interactables.all().find(s => s.id === 'desk:5')!;
    const x = seat.pos.x, z = seat.pos.z, face = seat.face;
    setObjectPose(o, 10, 10, 2);
    resetObject(o);
    expect([seat.pos.x, seat.pos.z, seat.face]).toEqual([x, z, face]);
    setObjectPose(o, 11, 11, 1); setObjectPose(objects.all()[40], 12, 12, 1);
    resetAllObjects();
    expect(movedObjects()).toEqual([]);
    expect([seat.pos.x, seat.pos.z]).toEqual([x, z]);
  });

  it('announces it, so viewers can redraw it and the server can tell everybody', () => {
    const seen: string[] = [];
    simEvents.on('objectMoved', o => seen.push(o.id));
    const o = chair();
    setObjectPose(o, o.x + 1, o.z, o.rot);
    resetObject(o);
    expect(seen).toEqual([o.id, o.id]);
  });

  it('a thing with no seat (a mug) just moves', () => {
    const mug = objects.all().find(o => o.type === 'mug')!;
    setObjectPose(mug, 1, 2, 3);
    expect([mug.x, mug.z, mug.rot]).toEqual([1, 2, 3]);
    expect(mug.link).toBeNull();
  });

  it('an object cannot carry a seat that does not exist, or be of a kind nobody has heard of', () => {
    expect(() => addObject({ type: 'chair-office', x: 0, z: 0, rot: 0, y: 0, variant: 0, station: null, spot: 'desk:9999' })).toThrow(/does not exist/);
    expect(() => addObject({ type: 'hoverboard', x: 0, z: 0, rot: 0, y: 0, variant: 0, station: null, spot: null })).toThrow(/unknown object type/);
  });
});

describe('the layout fingerprint', () => {
  it('is taken from the starting layout: moving a chair does not change it, so a page that joins later still agrees with the server', () => {
    const before = layoutCheck();
    const o = objects.all().find(x => x.spot === 'desk:3')!; // (a chair: its seat moves too)
    setObjectPose(o, o.x + 5, o.z + 5, 1);
    expect(layoutCheck()).toEqual(before);
  });
  it('does change when the starting layout is different (a seat or an object start elsewhere)', () => {
    const base = layoutCheck();
    const moved = JSON.parse(JSON.stringify(officeLayout)); moved.objects[0].x += 0.5;
    loadLayout(moved);
    expect(layoutCheck().hash).not.toBe(base.hash);
    expect(layoutCheck().spots).toBe(base.spots);
  });
});

describe('what a new page is told', () => {
  it('only the objects that are not at home, and applying them reproduces the same office (seats included)', () => {
    const a = objects.all()[7], b = objects.all().find(o => o.spot === 'dining:3')!;
    setObjectPose(a, a.x + 1, a.z + 1, 0.25); setObjectPose(b, b.x - 2, b.z, 1.5);
    const poses = movedObjectPoses();
    expect(poses.map(p => p.index).sort((x, y) => x - y)).toEqual([a.index, b.index].sort((x, y) => x - y));
    const seat = interactables.all().find(s => s.id === 'dining:3')!;
    const want = [seat.pos.x, seat.pos.z, seat.face];
    resetAllObjects();
    expect(seat.pos.x).not.toBe(want[0]);
    applyObjectPoses(JSON.parse(JSON.stringify(poses)));
    expect([seat.pos.x, seat.pos.z, seat.face]).toEqual(want);
    expect(movedObjects()).toHaveLength(2);
  });
  it('a welcome sends everything home first (an object that came back is not left where it was)', () => {
    const a = objects.all()[7];
    setObjectPose(a, 9, 9, 1);
    applyObjectPoses([]);
    expect(isAtHome(a)).toBe(true);
  });
  it('a carried object is recorded as carried, and one that does not exist or has rubbish for a pose is ignored', () => {
    const a = objects.all()[7];
    const at = { x: 1, z: 2, rot: 3, y: a.y, q: null };
    expect(applyObjectPose({ index: a.index, ...at, carriedBy: 12 })?.carriedBy).toBe(12);
    expect(applyObjectPose({ index: a.index, ...at, carriedBy: -1 })?.carriedBy).toBeNull();
    expect(applyObjectPose({ index: 99999, ...at, carriedBy: -1 })).toBeNull();
    expect(applyObjectPose({ index: a.index, ...at, x: NaN, carriedBy: -1 })).toBeNull();
    expect(applyObjectPose({ index: a.index, ...at, y: Infinity, carriedBy: -1 })).toBeNull();
    expect(applyObjectPose({ index: a.index, ...at, q: [0, NaN, 0, 1], carriedBy: -1 })).toBeNull();
    expect(a.x).toBe(1);
  });
  it('a thing that has fallen over keeps its height and tilt, and is not at home until it is upright where it started again', () => {
    const a = objects.all().find(o => o.type === 'mug')!;
    const fallen: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // on its side
    applyObjectPose({ index: a.index, x: a.home.x, z: a.home.z, rot: a.home.rot, y: .8, q: fallen, carriedBy: -1 });
    expect(a.y).toBe(.8);
    expect(a.q).toEqual(fallen);
    expect(isAtHome(a)).toBe(false);
    expect(movedObjects()).toContain(a);
    resetObject(a);
    expect(a.q).toBeNull();
    expect(a.y).toBe(a.home.y);
    expect(isAtHome(a)).toBe(true);
  });
});

describe('saving objects', () => {
  const ready = () => { setSeed(1); initState(); initDay(40); };

  it('saves only the objects that are not at home, and a restore puts them back (seats too)', () => {
    ready();
    expect(serializeWorld().objects).toEqual([]);
    const o = objects.all().find(x => x.spot === 'desk:5')!, mug = objects.all().find(x => x.type === 'mug')!;
    setObjectPose(o, o.x + 3, o.z + 1, 2); setObjectPose(mug, 4, 5, 6);
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    expect(saved.objects).toEqual([{ id: o.id, x: o.x, z: o.z, rot: 2, y: o.y, q: null }, { id: mug.id, x: 4, z: 5, rot: 6, y: mug.y, q: null }].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4))));
    const seat = interactables.all().find(s => s.id === 'desk:5')!;
    const want = [seat.pos.x, seat.pos.z, seat.face];
    resetSim(); loadLayout(officeLayout);
    expect(movedObjects()).toEqual([]);
    restoreWorld(parseSavedWorld(saved));
    expect(movedObjects().map(x => x.id).sort()).toEqual([o.id, mug.id].sort());
    expect([seat.pos.x, seat.pos.z, seat.face]).toEqual(want);
  });

  it('a thing that has fallen over is saved and restored lying as it was', () => {
    ready();
    const mug = objects.all().find(x => x.type === 'mug')!, side: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    setObjectPose(mug, mug.x + .3, mug.z, mug.rot, .7975, side);
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    resetSim(); loadLayout(officeLayout);
    restoreWorld(parseSavedWorld(saved));
    const back = objects.byId(mug.id)!;
    expect(back.y).toBe(.7975);
    expect(back.q).toEqual(side);
  });

  it('a save from before heights and tilts (version 4) still reads: its things stand upright at the height they started at', () => {
    ready();
    const mug = objects.all().find(x => x.type === 'mug')!;
    const old = JSON.parse(JSON.stringify(serializeWorld()));
    old.version = 4; old.objects = [{ id: mug.id, x: mug.x + .2, z: mug.z, rot: 1 }];
    restoreWorld(parseSavedWorld(old));
    expect(mug.x).toBeCloseTo(mug.home.x + .2);
    expect(mug.y).toBe(mug.home.y);
    expect(mug.q).toBeNull();
  });

  it('a restore starts from home: something moved before the restore, and not in the save, goes back', () => {
    ready();
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    setObjectPose(objects.all()[20], 3, 3, 3);
    restoreWorld(parseSavedWorld(saved));
    expect(movedObjects()).toEqual([]);
  });

  it('an object carried when the save was made is saved where it was picked up, and nobody carries it after', () => {
    ready();
    const o = objects.all()[9];
    o.carriedBy = 4;
    setObjectPose(o, o.x + 1, o.z, o.rot);
    const saved = JSON.parse(JSON.stringify(serializeWorld()));
    expect(saved.objects).toHaveLength(1);
    restoreWorld(parseSavedWorld(saved));
    expect(objects.byId(o.id)!.carriedBy).toBeNull();
  });

  it('an old save (before objects) still reads, and has none; an object this office does not have is ignored', () => {
    ready();
    const old = JSON.parse(JSON.stringify(serializeWorld())); delete old.objects; old.version = 2;
    expect(parseSavedWorld(old).objects).toEqual([]);
    const odd = JSON.parse(JSON.stringify(serializeWorld())); odd.objects = [{ id: 'obj:9999', x: 1, z: 1, rot: 0 }];
    expect(() => restoreWorld(parseSavedWorld(odd))).not.toThrow();
    expect(movedObjects()).toEqual([]);
  });

  it('a damaged list of objects is refused with the reason, never trusted', () => {
    ready();
    const good = () => JSON.parse(JSON.stringify(serializeWorld()));
    const bad = (objs: unknown, text: RegExp) => { const s = good(); s.objects = objs; expect(() => parseSavedWorld(s)).toThrow(text); };
    bad('no', /objects/);
    bad([5], /not an object/);
    bad([{ id: 'chair', x: 0, z: 0, rot: 0 }], /not an object id/);
    bad([{ id: 'obj:1', x: NaN, z: 0, rot: 0 }], /\.x/);
    bad([{ id: 'obj:1', x: 0, z: 1e9, rot: 0 }], /\.z/);
    bad([{ id: 'obj:1', x: 0, z: 0, rot: Infinity }], /\.rot/);
    bad([{ id: 'obj:1', x: 0, z: 0, rot: 0 }, { id: 'obj:1', x: 1, z: 1, rot: 1 }], /repeats/);
    bad([{ id: 'obj:1', x: 0, z: 0, rot: 0, y: 1e6 }], /\.y/);
    bad([{ id: 'obj:1', x: 0, z: 0, rot: 0, q: [0, 0, 1] }], /not an orientation/);
    bad([{ id: 'obj:1', x: 0, z: 0, rot: 0, q: [0, 0, 5, 1] }], /\.q\[2\]/);
    bad(Array.from({ length: 6000 }, (_, i) => ({ id: `obj:${i}`, x: 0, z: 0, rot: 0 })), /not a list/);
    expect(() => parseSavedWorld({ ...good(), version: 99 })).toThrow(SaveError);
  });
});
