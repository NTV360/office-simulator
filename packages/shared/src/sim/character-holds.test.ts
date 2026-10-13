import { describe, expect, it } from 'vitest';
import { CharacterHoldGraph } from './character-holds';
import { defaultCharacterMechanics } from './character-state';
import { Vec3 } from '../vec3';
import type { Person } from './types';
import { DEFAULT_SPEC } from '../character/spec';

const person = (id: number): Person => ({
  id, name: `Person ${id}`, role: 'Guest', controller: 'account', spec: { ...DEFAULT_SPEC }, pos: new Vec3(), face: 0, faceGoal: 0,
  speed: 1, state: 'controlled', shown: true, props: { mug: false, phone: false, pad: false, guitar: false, putter: false, bucket: false, rag: false, mop: false },
  task: null, path: null, pi: 0, until: 0, queue: [], walkPhase: 0, animT: 0, pose: {}, arriveAt: 0, leaveAt: 0,
  lunchAt: 0, hadLunch: true, arrivedAt: 0, coffees: 0, chatWith: null, meeting: null, screenKind: 'code', screenVariant: 0,
  mechanics: defaultCharacterMechanics(),
});

describe('character hold graph', () => {
  it('allows nested one-to-one holds while rejecting duplicates and cycles', () => {
    const graph = new CharacterHoldGraph();
    expect(graph.attach({ holder: 1, target: 2, az: 0, lift: 1 })).toBe(true);
    expect(graph.attach({ holder: 2, target: 3, az: 0, lift: 1 })).toBe(true);
    expect(graph.attach({ holder: 1, target: 4, az: 0, lift: 1 })).toBe(false);
    expect(graph.attach({ holder: 3, target: 1, az: 0, lift: 1 })).toBe(false);
    expect(graph.descendants(1)).toEqual([2, 3]);
  });

  it('releases incoming and outgoing edges for a removed person', () => {
    const graph = new CharacterHoldGraph();
    graph.attach({ holder: 1, target: 2, az: 0, lift: 1 });
    graph.attach({ holder: 2, target: 3, az: 0, lift: 1 });
    expect(graph.releasePerson(2)).toEqual([
      { holder: 2, target: 3, az: 0, lift: 1 },
      { holder: 1, target: 2, az: 0, lift: 1 },
    ]);
    expect(graph.all()).toEqual([]);
  });

  it('counts only the direct target for effective mass', () => {
    const graph = new CharacterHoldGraph();
    const people = [person(1), person(2), person(3)];
    graph.attach({ holder: 1, target: 2, az: 0, lift: 1 });
    graph.attach({ holder: 2, target: 3, az: 0, lift: 1 });
    expect(graph.effectiveMass(1, p => p.id * 10, people)).toBe(20);
    expect(graph.effectiveMass(2, p => p.id * 10, people)).toBe(30);
    expect(graph.effectiveMass(3, p => p.id * 10, people)).toBe(0);
  });
});
