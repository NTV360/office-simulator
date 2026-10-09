import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HAZEL_NAME, encode, people, setSeed, type Message } from '@office/shared';
import { RAGE_COOLDOWN_MS, RageService } from '../play/shared-events';
import { bootTestServer, connect, enter, isKick, isWelcome, sleep, type Client, type TestServer } from '../test-support';

describe('RageService', () => {
  it('starts when Hazel is in, then not again for a minute, for anybody', () => {
    let t = 10_000_000;
    const s = new RageService({ hazelPresent: () => true }, () => t);
    expect(s.trigger()).toEqual({ ok: true });
    t += 1000;
    expect(s.trigger()).toEqual({ ok: false, reason: 'cooldown', secondsLeft: 59 });
    t += RAGE_COOLDOWN_MS - 1001;
    expect(s.trigger()).toMatchObject({ ok: false, reason: 'cooldown', secondsLeft: 1 });
    t += 2;
    expect(s.trigger()).toEqual({ ok: true });
  });
  it('does not start when Hazel is away, and that does not use up the cooldown', () => {
    let present = false;
    const s = new RageService({ hazelPresent: () => present }, () => 5_000_000);
    expect(s.trigger()).toEqual({ ok: false, reason: 'away' });
    present = true;
    expect(s.trigger()).toEqual({ ok: true });
  });
});

process.env.WORLD_SEED = '1';
let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); });

const events = (c: Client, kind: string) => c.messages.filter((m): m is Extract<Message, { type: 'event' }> => m.type === 'event' && m.kind === kind);
const rage = (c: Client) => c.socket.emit('m', encode({ type: 'rage' }));
const hazel = () => people.find(p => p.name === HAZEL_NAME)!;
async function player(name: string): Promise<Client> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  await c.waitFor(isWelcome);
  return c;
}

describe("Hazel's rage over real connections", () => {
  it('when Hazel is away it does not start, and the one who asked is told (and that does not use up the minute)', async () => {
    hazel().state = 'away';
    const c = await player('rg_late');
    rage(c);
    await sleep(400);
    expect(events(c, 'rage')).toEqual([]);
    expect(events(c, 'notice').some(e => /isn't in/i.test(e.text))).toBe(true);
    c.socket.close();
  });

  it('one player asks; everyone who is playing is told, and only once (a second ask a moment later is refused with a private notice)', async () => {
    hazel().state = 'idle';
    const a = await player('rg_a'), b = await player('rg_b'), c = await player('rg_c');
    rage(a);
    await sleep(500);
    for (const who of [a, b, c]) expect(events(who, 'rage'), 'every player is told').toHaveLength(1);
    rage(b); // inside the minute
    await sleep(400);
    for (const who of [a, b, c]) expect(events(who, 'rage'), 'but not a second time').toHaveLength(1);
    expect(events(b, 'notice').some(e => /calming down/i.test(e.text))).toBe(true);
    expect(events(a, 'notice')).toEqual([]);
    expect(events(c, 'notice')).toEqual([]);
    [a, b, c].forEach(x => x.socket.close());
  });

  it('only a joined connection may ask', async () => {
    const c = connect(base); open.push(c.socket); await c.ready;
    rage(c);
    expect((await c.waitFor(isKick)).reason).toMatch(/say hello first/);
  });
});

describe('joins and leaves are shared events too', () => {
  it('everybody playing sees a line when someone joins and when they leave', async () => {
    const watcher = await player('jl_watcher');
    const logs = () => watcher.messages.filter((m): m is Extract<Message, { type: 'event' }> => m.type === 'event' && m.kind === 'log').map(m => m.text);
    const guest = await player('jl_guest');
    await sleep(500);
    expect(logs()).toContain('jl_guest joined');
    guest.socket.close();
    await sleep(600);
    expect(logs()).toContain('jl_guest left');
    expect(logs().filter(t => t === 'jl_guest joined')).toHaveLength(1);
    watcher.socket.close();
  });
});
