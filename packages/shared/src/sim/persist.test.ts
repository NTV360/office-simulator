import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayout } from '../layout/layout';
import { officeLayout } from '../layout/office';
import { drawCount, setSeed } from '../util';
import { initDay } from './day';
import { simEvents } from './events';
import { isStaff } from './person';
import { SaveError, parseSavedWorld, restoreWorld, serializeWorld } from './persist';
import { initState, meetings, people, resetSim, sim } from './state';
import { stepSim } from './step';

beforeEach(() => { simEvents.clear(); resetSim(); loadLayout(officeLayout); });

function runningWorld(seed = 1, steps = 8000) {
  setSeed(seed); initState(); initDay(40);
  for (let i = 0; i < steps; i++) stepSim(.05);
}
const viaJson = () => JSON.parse(JSON.stringify(serializeWorld()));

describe('saving and restoring the world', () => {
  it('a restored world saves back exactly what was saved (through JSON, as the database does)', () => {
    runningWorld();
    const saved = viaJson();
    const before = people.filter(p => p.state !== 'away').length;
    expect(before).toBeGreaterThan(20);
    restoreWorld(parseSavedWorld(saved));
    expect(viaJson()).toEqual(saved);
    expect(people.filter(isStaff)).toHaveLength(40);
    expect(people.filter(p => p.state !== 'away').length).toBe(before);
  });

  it('keeps the clock, the day, the speed, the name counter and the desk order', () => {
    runningWorld(2, 3000);
    sim.speed = 3; sim.paused = true;
    const saved = viaJson();
    restoreWorld(parseSavedWorld(saved));
    expect(sim).toMatchObject({ t: saved.clock.t, day: saved.clock.day, speed: 3, paused: true });
    expect(viaJson().deskOrder).toEqual(saved.deskOrder);
    expect(viaJson().nameIdx).toBe(saved.nameIdx);
  });

  it('people stand where they stood, own the same desks, and keep their day', () => {
    runningWorld();
    const want = people.map(p => ({ name: p.name, x: p.pos.x, z: p.pos.z, slot: p.slot!.id, arriveAt: p.arriveAt, leaveAt: p.leaveAt, hadLunch: p.hadLunch, present: p.state !== 'away' }));
    restoreWorld(parseSavedWorld(viaJson()));
    expect(people.map(p => ({ name: p.name, x: p.pos.x, z: p.pos.z, slot: p.slot!.id, arriveAt: p.arriveAt, leaveAt: p.leaveAt, hadLunch: p.hadLunch, present: p.state !== 'away' }))).toEqual(want);
    for (const p of people) expect(p.slot!.owner).toBe(p);
  });

  it('those who were in resume idle and carry on; nobody is stuck', () => {
    runningWorld();
    restoreWorld(parseSavedWorld(viaJson()));
    const idle = people.filter(p => p.state === 'idle');
    expect(idle.length).toBeGreaterThan(20);
    expect(people.every(p => p.task === null && !Object.values(p.props).some(Boolean))).toBe(true);
    expect(meetings).toHaveLength(0);
    for (let i = 0; i < 3000; i++) stepSim(.05);
    const busy = people.filter(p => p.state === 'doing' || p.state === 'walking').length;
    expect(busy).toBeGreaterThan(20);
    expect(people.filter(p => p.state === 'idle').length).toBeLessThan(5);
  });

  it('survives a whole day after a restore, including the roll-over', () => {
    runningWorld(1, 5000);
    restoreWorld(parseSavedWorld(viaJson()));
    while (sim.day === 1) stepSim(.05);
    expect(people.every(p => p.state === 'away')).toBe(true);
    for (let i = 0; i < 20000; i++) stepSim(.05);
    expect(people.filter(p => p.state !== 'away').length).toBeGreaterThan(20);
  });

  it('uses no random numbers', () => {
    runningWorld();
    const saved = parseSavedWorld(viaJson());
    const draws = drawCount();
    restoreWorld(saved);
    expect(drawCount()).toBe(draws);
  });

  it('announces each restored person', () => {
    runningWorld();
    const saved = parseSavedWorld(viaJson());
    const names: string[] = [];
    simEvents.on('personAdded', p => names.push(p.name));
    restoreWorld(saved);
    expect(names).toHaveLength(40);
  });

  it('refuses a save that names a desk this office does not have, and leaves the running world alone', () => {
    runningWorld();
    const saved = viaJson();
    saved.people[3].slot = 'desk:999';
    const t = sim.t;
    expect(() => restoreWorld(parseSavedWorld(saved))).toThrow(SaveError);
    expect(sim.t).toBe(t);
    expect(people).toHaveLength(40);
  });

  it('a desk the save did not know about is still handed out later', () => {
    runningWorld();
    const saved = viaJson();
    saved.deskOrder = saved.deskOrder.slice(0, 10);
    restoreWorld(parseSavedWorld(saved));
    expect(viaJson().deskOrder).toHaveLength(70);
  });
});

describe('parseSavedWorld refuses damaged saves', () => {
  const good = () => { runningWorld(1, 500); const s = viaJson(); resetSim(); loadLayout(officeLayout); return s; };
  const bad = (mutate: (s: ReturnType<typeof good>) => void, text: RegExp) => {
    const s = good(); mutate(s);
    expect(() => parseSavedWorld(s)).toThrow(text);
  };
  it('not an object, wrong version, missing parts', () => {
    expect(() => parseSavedWorld(null)).toThrow(SaveError);
    expect(() => parseSavedWorld([])).toThrow(SaveError);
    expect(() => parseSavedWorld('x')).toThrow(SaveError);
    bad(s => { s.version = 2; }, /version/);
    bad(s => { delete s.clock; }, /clock/);
    bad(s => { s.people = 'no'; }, /people/);
    bad(s => { s.deskOrder = {}; }, /deskOrder/);
  });
  it('numbers that are wrong or out of range', () => {
    bad(s => { s.clock.t = NaN; }, /clock\.t/);
    bad(s => { s.clock.t = 99999; }, /clock\.t/);
    bad(s => { s.clock.speed = 0; }, /speed/);
    bad(s => { s.people[0].x = 1e9; }, /\.x/);
    bad(s => { s.people[0].coffees = -1; }, /coffees/);
    bad(s => { s.people[0].id = 70000; }, /\.id/);
    bad(s => { s.people[0].screenVariant = 9; }, /screenVariant/);
  });
  it('text, flags and shapes that are wrong', () => {
    bad(s => { s.people[0].name = 5; }, /name/);
    bad(s => { s.people[0].name = 'x'.repeat(500); }, /name/);
    bad(s => { s.people[0].present = 'yes'; }, /true or false/);
    bad(s => { s.people[0].screenKind = 'tv'; }, /screenKind/);
    bad(s => { s.people[0].spec = 'plain'; }, /spec/);
    bad(s => { s.people[1] = 7; }, /not an object/);
  });
  it('two people with the same id or the same desk', () => {
    bad(s => { s.people[1].id = s.people[0].id; }, /repeats id/);
    bad(s => { s.people[1].slot = s.people[0].slot; }, /shares desk/);
  });
  it('accepts a good one', () => {
    expect(parseSavedWorld(good()).people).toHaveLength(40);
  });
});
