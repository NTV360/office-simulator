import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NONE, encode, objects, people, placementProblem, resetAllObjects, setSeed, type ClientMessage, type Message, type Person, type WorldObject } from '@office/shared';
import { bootTestServer, connect, enter, isWelcome, sleep, type Client, type TestServer } from '../test-support';

// Holding things, over real sockets, with the physics running: a chair taken hold of is lifted (everybody is sent it as it rises, in the
// player's hands), and put down it is lowered to its place and let go there (everybody is told that too). See ITEMS-PHYSICS-PLAN.md, 6.

process.env.WORLD_SEED = '1';
let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); resetAllObjects(); await server.close(); setSeed(null); });

const send = (c: Client, m: ClientMessage) => c.socket.emit('m', encode(m));
const objectMessages = (c: Client, index: number) => c.messages.filter((m): m is Extract<Message, { type: 'object' }> => m.type === 'object' && m.pose.index === index);
const personOf = (name: string): Person => people.find(p => p.name === name)!;
async function join(name: string): Promise<Client> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  await c.waitFor(isWelcome);
  return c;
}

describe('holding, with physics', () => {
  it('a chair is lifted in the player\'s hands, everybody sees it rise, and put down it is lowered there and let go', async () => {
    resetAllObjects();
    const a = await join('hold_a'), b = await join('hold_b');
    const chair: WorldObject = objects.all().filter(o => o.type === 'chair-wood')[0];
    const p = personOf('hold_a');
    p.pos.x = chair.x + .6; p.pos.z = chair.z; p.face = -Math.PI / 2; // (standing beside it, facing it)
    send(a, { type: 'grab', object: chair.index });
    await sleep(1500);
    for (const who of [a, b]) {
      const seen = objectMessages(who, chair.index);
      expect(seen.length).toBeGreaterThan(3); // (it rises, a step at a time)
      expect(seen.at(-1)!.pose.carriedBy).toBe(p.id);
      expect(seen.at(-1)!.pose.y).toBeGreaterThan(.25);
    }
    let to = { x: 0, z: 0 };
    // (behind them, away from the dining table the chair stands at: open floor it can be carried to without catching a table's corner)
    search: for (let r = .7; r < 2; r += .1) for (let da = 0; da < 3.2; da += .3) for (const ang of [p.face + Math.PI + da, p.face + Math.PI - da]) {
      const x = p.pos.x + Math.sin(ang) * r, z = p.pos.z + Math.cos(ang) * r;
      const clear = objects.all().every(o => o === chair || Math.hypot(o.x - x, o.z - z) > 1.2); // (nothing it could catch on, on the way there)
      if (clear && placementProblem(chair, x, z, 0) === null) { to = { x, z }; break search; }
    }
    send(a, { type: 'place', x: to.x, z: to.z, rot: 0 });
    await sleep(2500);
    for (const who of [a, b]) {
      const last = objectMessages(who, chair.index).at(-1)!.pose;
      expect(last.carriedBy).toBe(NONE);
      expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(.1);
      expect(last.y).toBeLessThan(.05);
    }
    a.socket.close(); b.socket.close();
  });

  it('while somebody walks about carrying something, everybody keeps getting snapshots, the carrier moving in them', async () => {
    resetAllObjects();
    const a = await join('carry_walker'), b = await join('carry_viewer');
    const chair: WorldObject = objects.all().filter(o => o.type === 'chair-wood')[1];
    const p = personOf('carry_walker');
    p.pos.x = chair.x + .6; p.pos.z = chair.z; p.face = -Math.PI / 2;
    send(a, { type: 'grab', object: chair.index });
    await sleep(1200);
    const from = b.messages.length, z0 = p.pos.z;
    let seq = 1000;
    const t0 = Date.now();
    while (Date.now() - t0 < 1200) { send(a, { type: 'input', seq: seq++, mx: 0, mz: 1, heading: 0, run: false }); await sleep(50); }
    const snaps = b.messages.slice(from).filter((m): m is Extract<Message, { type: 'snapshot' }> => m.type === 'snapshot');
    expect(snaps.length).toBeGreaterThan(15); // (twenty a second: volatile snapshots are not crowded out by the moving chair's messages)
    const zs = snaps.map(s => (s.moves ?? []).find(m => m.id === p.id)?.z ?? s.people.find(q => q.id === p.id)?.z).filter((z): z is number => z !== undefined);
    expect(zs.length).toBeGreaterThan(10);
    expect(zs[zs.length - 1] - z0).toBeGreaterThan(.5); // they walked, and everybody saw it
    a.socket.close(); b.socket.close();
  });
});
