import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NONE, interactables, movedObjects, objects, resetAllObjects, setObjectPose, setSeed, type Message } from '@office/shared';
import { bootTestServer, connect, enter, isWelcome, sleep, type Client, type TestServer } from '../test-support';

// World objects over the wire: what a new page is told, and what everybody is told when one moves.

process.env.WORLD_SEED = '1';
let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); resetAllObjects(); await server.close(); setSeed(null); });

const objectMessages = (c: Client) => c.messages.filter((m): m is Extract<Message, { type: 'object' }> => m.type === 'object');
async function player(name: string): Promise<Client> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  await c.waitFor(isWelcome);
  return c;
}

describe('objects over the wire', () => {
  it('a new page is told which objects are not at home, and nothing about the ones that are', async () => {
    resetAllObjects();
    const a = objects.all()[10], b = objects.all().find(o => o.spot === 'dining:2')!;
    setObjectPose(a, a.x + 1.5, a.z - 0.5, 0.75); setObjectPose(b, b.x, b.z + 2, -1);
    const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, 'obj_joiner');
    const w = await c.waitFor(isWelcome);
    expect(w.objects.map(p => p.index).sort((x, y) => x - y)).toEqual([a.index, b.index].sort((x, y) => x - y));
    const got = w.objects.find(p => p.index === a.index)!;
    expect(got.x).toBeCloseTo(a.x, 4); expect(got.z).toBeCloseTo(a.z, 4); expect(got.rot).toBeCloseTo(0.75, 4);
    expect(got.carriedBy).toBe(NONE);
    c.socket.close();
    resetAllObjects();
  });

  it('with everything at home the list is empty (and so the welcome stays small)', async () => {
    resetAllObjects();
    const c = await player('obj_empty');
    expect(c.messages.filter(isWelcome)[0].objects).toEqual([]);
    c.socket.close();
  });

  it('when an object moves, every player is told at once, once, and an unjoined connection is not', async () => {
    resetAllObjects();
    const a = await player('obj_a'), b = await player('obj_b');
    const lurker = connect(base); open.push(lurker.socket); await lurker.ready;
    const o = objects.all()[4];
    setObjectPose(o, o.x + 2, o.z + 2, 1.25);
    await sleep(300);
    for (const who of [a, b]) {
      const msgs = objectMessages(who);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].pose.index).toBe(o.index);
      expect(msgs[0].pose.x).toBeCloseTo(o.x, 4);
      expect(msgs[0].pose.rot).toBeCloseTo(1.25, 4);
    }
    expect(objectMessages(lurker)).toEqual([]);
    a.socket.close(); b.socket.close(); lurker.socket.close();
    resetAllObjects();
  });

  it('putting it back is told too, so nobody is left looking at the old place', async () => {
    resetAllObjects();
    const a = await player('obj_back');
    const o = objects.all()[6];
    setObjectPose(o, o.x + 1, o.z, o.rot);
    resetAllObjects();
    await sleep(300);
    const msgs = objectMessages(a);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].pose.x).toBeCloseTo(o.home.x, 4);
    expect(movedObjects()).toEqual([]);
    a.socket.close();
  });

  it('the seat moves with the chair on the server', async () => {
    resetAllObjects();
    const o = objects.all().find(x => x.spot === 'dining:1')!;
    const seat = interactables.all().find(s => s.id === 'dining:1')!;
    const x0 = seat.pos.x;
    setObjectPose(o, o.x + 4, o.z, o.rot);
    expect(seat.pos.x).toBeCloseTo(x0 + 4, 6);
    resetAllObjects();
    expect(seat.pos.x).toBeCloseTo(x0, 6);
  });
});
