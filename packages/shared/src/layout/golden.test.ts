import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { roster, type Employee } from '../sim/roster';
import { initDay } from '../sim/day';
import { interactables } from '../sim/interactables';
import { hasSlot } from '../sim/person';
import { initState, people, resetSim, sim } from '../sim/state';
import { stepSim } from '../sim/step';
import { drawCount, setSeed } from '../util';
import { loadLayout } from './layout';
import { officeLayout } from './office';

// The browser's recorded fingerprints (tests/browser/golden-local) are the truth for "what the simulation does". The server
// runs the same code on the same layout data, so for the same seed it must reproduce them exactly.

// The recordings are made from a snapshot of the real roster, which holds real names, so both files stay on one PC (git-ignored; see
// scripts/snapshot-roster.mjs and npm run verify:browser:record). Without them these checks are skipped.
const rosterFile = path.resolve(__dirname, '../../../../tests/fixtures/roster.local.json');
const goldenFile = (seed: number) => path.resolve(__dirname, `../../../../tests/browser/golden-local/seed-${seed}.json`);
const available = (seed: number) => fs.existsSync(rosterFile) && fs.existsSync(goldenFile(seed));

const r3 = (v: number) => (Math.round(v * 1000) / 1000) || 0; // (|| 0: JSON cannot store -0)
const spotIndex = (sp: { kind: string } | undefined | null) => (sp ? `${sp.kind}:${interactables.of(sp.kind).indexOf(sp as never)}` : '');

function persons() {
  return people.filter(hasSlot).map(p => ({
    name: p.name, role: p.role, state: p.state,
    task: p.task ? p.task.kind : '', spot: p.task ? spotIndex(p.task.spot) : '',
    x: r3(p.pos.x), z: r3(p.pos.z), face: r3(p.face),
    until: r3(p.until), arriveAt: r3(p.arriveAt), leaveAt: r3(p.leaveAt), lunchAt: r3(p.lunchAt),
    arrivedAt: p.arrivedAt == null ? null : r3(p.arrivedAt),
    hadLunch: p.hadLunch, coffees: p.coffees,
    slot: spotIndex(p.slot), screen: p.screenKind + ':' + p.screenVariant,
    shown: p.shown,
  }));
}

const suite = [1, 2, 3].every(available) ? describe.each([1, 2, 3]) : describe.skip.each([1, 2, 3]);
suite('seed %i on the server side matches the browser recording', seed => {
  const golden = available(seed) ? JSON.parse(fs.readFileSync(goldenFile(seed), 'utf8')) : { steps: [], fingerprints: [] };
  const steps: number[] = golden.steps;
  const seen = new Map<number, { persons: ReturnType<typeof persons>; draws: number; t: number; day: number }>();

  beforeAll(() => {
    resetSim(); loadLayout(officeLayout);
    roster.list = JSON.parse(fs.readFileSync(rosterFile, 'utf8')) as Employee[]; roster.status = 'ready';
    setSeed(seed); const d0 = drawCount(); initState(); initDay();
    let done = 0;
    for (const cp of steps) {
      for (; done < cp; done++) stepSim(.05);
      seen.set(cp, { persons: persons(), draws: drawCount() - d0, t: r3(sim.t), day: sim.day });
    }
    setSeed(null);
    roster.list = null; roster.status = 'unavailable';
  });

  steps.forEach((cp, i) => {
    it(`at step ${cp}: clock, random draws and every person`, () => {
      const g = golden.fingerprints[i], s = seen.get(cp)!;
      expect(s.t).toBe(g.clock.t);
      expect(s.day).toBe(g.clock.day);
      expect(s.draws, 'random draws').toBe(g.rngDraws);
      expect(s.persons.length).toBe(g.persons.length);
      for (let k = 0; k < g.persons.length; k++) {
        const want = g.persons[k], got = s.persons[k];
        // the browser fingerprint has these fields; compare exactly those
        for (const key of Object.keys(want)) if (key in got) expect((got as Record<string, unknown>)[key], `${want.name} ${key}`).toEqual(want[key]);
      }
    });
  });
});
