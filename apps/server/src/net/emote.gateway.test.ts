import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMOTE_KINDS, W, encode, people, setSeed, type Message, type Person } from '@office/shared';
import { EMOTE_COOLDOWN_MS, EmoteService } from '../play/emotes';
import { bootTestServer, connect, enter, isKick, isWelcome, sleep, type Client, type TestServer } from '../test-support';

// Emotes: the rules alone, then over real connections.

describe('EmoteService', () => {
  const lookup = { personOf: (id: number) => (id < 100 ? id + 1000 : null) };

  it('accepts each emote on the list and says who did it', () => {
    let t = 1_000_000;
    const s = new EmoteService(lookup, () => t);
    for (const kind of EMOTE_KINDS) { expect(s.play(7, kind)).toEqual({ ok: true, from: 1007, kind }); t += EMOTE_COOLDOWN_MS + 1; }
  });
  it('one every 2.5 seconds per account, and other accounts are not affected', () => {
    let t = 1_000_000;
    const s = new EmoteService(lookup, () => t);
    expect(s.play(1, 'wave').ok).toBe(true);
    expect(s.play(1, 'cheer')).toEqual({ ok: false, reason: 'cooldown' });
    expect(s.play(2, 'cheer').ok).toBe(true);
    t += EMOTE_COOLDOWN_MS - 1;
    expect(s.play(1, 'clap')).toEqual({ ok: false, reason: 'cooldown' });
    t += 2;
    expect(s.play(1, 'clap').ok).toBe(true);
  });
  it('refuses anything not on the list, and someone who is not playing; a refusal does not start the cooldown', () => {
    const s = new EmoteService(lookup, () => 1_000_000);
    for (const bad of ['dance', '', 'WAVE', 5, null, undefined, {}, ['wave']]) expect(s.play(1, bad), JSON.stringify(bad)).toEqual({ ok: false, reason: 'bad' });
    expect(s.play(500, 'wave')).toEqual({ ok: false, reason: 'nobody' });
    expect(s.play(1, 'wave').ok).toBe(true);
  });
});

process.env.WORLD_SEED = '1';
let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); });

const OPEN = W(450, 700);
const emoted = (c: Client) => c.messages.filter((m): m is Extract<Message, { type: 'emoted' }> => m.type === 'emoted');
const emote = (c: Client, kind: string) => c.socket.emit('m', encode({ type: 'emote', kind } as Message));
async function player(name: string, dx = 0): Promise<{ c: Client; person: Person; id: number }> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  const w = await c.waitFor(isWelcome);
  const person = people.find(p => p.id === w.you)!;
  person.pos.x = OPEN.x + dx; person.pos.z = OPEN.z;
  return { c, person, id: w.you };
}

describe('over real connections', () => {
  it('everyone who is playing sees it, near or far, including the one who did it', async () => {
    const a = await player('emo_a', 0), b = await player('emo_b', 3), far = await player('emo_far', 60);
    emote(a.c, 'wave');
    await sleep(400);
    for (const who of [a, b, far]) expect(emoted(who.c).map(m => [m.from, m.kind]), who.person.name).toEqual([[a.id, 'wave']]);
    [a, b, far].forEach(p => p.c.socket.close());
  });

  it('a connection that has not joined sees none', async () => {
    const a = await player('emo_x', 0);
    const lurker = connect(base); open.push(lurker.socket); await lurker.ready;
    emote(a.c, 'cheer');
    await sleep(300);
    expect(emoted(lurker)).toEqual([]);
    a.c.socket.close(); lurker.socket.close();
  });

  it('the second one inside the cooldown is ignored (no reply, no kick)', async () => {
    const a = await player('emo_fast', 0), b = await player('emo_fastwatch', 1);
    emote(a.c, 'wave'); emote(a.c, 'clap'); emote(a.c, 'nod');
    await sleep(400);
    expect(emoted(b.c).map(m => m.kind)).toEqual(['wave']);
    expect(a.c.messages.some(isKick)).toBe(false);
    await sleep(EMOTE_COOLDOWN_MS);
    emote(a.c, 'nod');
    await sleep(300);
    expect(emoted(b.c).map(m => m.kind)).toEqual(['wave', 'nod']);
    a.c.socket.close(); b.c.socket.close();
  });

  it('an emote that is not on the list is a bad message and drops the connection; one before hello too', async () => {
    const a = await player('emo_bad', 0);
    const frame = new Uint8Array(encode({ type: 'emote', kind: 'wave' }));
    frame[1] = 99; // an index past the end of the list
    a.c.socket.emit('m', frame);
    expect((await a.c.waitFor(isKick)).reason).toMatch(/bad message/);
    const c = connect(base); open.push(c.socket); await c.ready;
    emote(c, 'wave');
    expect((await c.waitFor(isKick)).reason).toMatch(/say hello first/);
  });

  it('an account that is muted can still emote (only chat is muted)', async () => {
    const a = await player('emo_muted', 0), b = await player('emo_mutedwatch', 1);
    const account = (await server.store.byLower('emo_muted'))!;
    await server.store.setMuted(account.id, true);
    emote(a.c, 'cheer');
    await sleep(400);
    expect(emoted(b.c).map(m => m.kind)).toEqual(['cheer']);
    a.c.socket.close(); b.c.socket.close();
  });
});
