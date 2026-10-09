import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { W, encode, people, setSeed, type Message, type Person } from '@office/shared';
import { api, bootTestServer, connect, enter, isKick, isWelcome, sleep, type Client, type TestServer } from '../test-support';

// Local chat over real connections: who hears, the limits, mute, and what a hostile client can and cannot do.

process.env.WORLD_SEED = '1';
process.env.ADMIN_TOKEN = 'chat-token';

let server: TestServer;
let base: string;
const open: Array<{ close(): void }> = [];
beforeAll(async () => { server = await bootTestServer(); base = server.base; }, 30000);
afterAll(async () => { open.forEach(s => s.close()); await server.close(); setSeed(null); delete process.env.ADMIN_TOKEN; });

const OPEN = W(450, 700);
const chats = (c: Client) => c.messages.filter((m): m is Extract<Message, { type: 'chat' }> => m.type === 'chat');
const notices = (c: Client) => c.messages.filter((m): m is Extract<Message, { type: 'event' }> => m.type === 'event' && m.kind === 'notice').map(m => m.text);
const say = (c: Client, text: string) => c.socket.emit('m', encode({ type: 'say', text }));

async function player(name: string, dx = 0): Promise<{ c: Client; person: Person; id: number }> {
  const c = connect(base); open.push(c.socket); await c.ready; await enter(base, c, name);
  const w = await c.waitFor(isWelcome);
  const person = people.find(p => p.id === w.you)!;
  person.pos.x = OPEN.x + dx; person.pos.z = OPEN.z;
  return { c, person, id: w.you };
}
const admin = (method: string, path: string, body?: unknown) => api(base, method, path, body, { authorization: 'Bearer chat-token' });

describe('who hears a line', () => {
  it('the speaker and the people within 10 m, and nobody further away', async () => {
    const ana = await player('chat_ana', 0), ben = await player('chat_ben', 6), cat = await player('chat_cat', 14);
    say(ana.c, 'hello from Ana');
    await sleep(400);
    for (const who of [ana, ben]) expect(chats(who.c).map(m => [m.name, m.text, m.from])).toEqual([['chat_ana', 'hello from Ana', ana.id]]);
    expect(chats(cat.c)).toEqual([]);
    say(ben.c, 'and Ben'); // Cat is 8 m from Ben: hears it; Ana is 6 m: hears it
    await sleep(400);
    expect(chats(cat.c).map(m => m.text)).toEqual(['and Ben']);
    expect(chats(ana.c).map(m => m.text)).toEqual(['hello from Ana', 'and Ben']);
    [ana, ben, cat].forEach(p => p.c.socket.close());
  });

  it('moving away takes you out of earshot, and it is the position at that moment that counts', async () => {
    const a = await player('chat_a2', 0), b = await player('chat_b2', 3);
    b.person.pos.x = OPEN.x + 30; // walked off
    say(a.c, 'can you hear me');
    await sleep(300);
    expect(chats(a.c)).toHaveLength(1);
    expect(chats(b.c)).toHaveLength(0);
    a.c.socket.close(); b.c.socket.close();
  });

  it('a watcher who has not joined hears nothing', async () => {
    const speaker = await player('chat_speaker', 0);
    const lurker = connect(base); open.push(lurker.socket); await lurker.ready; // connected, never said hello
    say(speaker.c, 'psst');
    await sleep(300);
    expect(chats(lurker)).toEqual([]);
    speaker.c.socket.close(); lurker.socket.close();
  });
});

describe('what is sent', () => {
  it('is cleaned: control and direction characters go, markup stays plain text', async () => {
    const a = await player('chat_clean', 0);
    say(a.c, '  hi‮\u0000   there <b>bold</b>  ');
    await sleep(300);
    expect(chats(a.c).map(m => m.text)).toEqual(['hi there <b>bold</b>']);
    a.c.socket.close();
  });

  it('an empty or blank line is ignored, with no reply and no kick', async () => {
    const a = await player('chat_blank', 0);
    say(a.c, '   '); say(a.c, '\n\t');
    await sleep(300);
    expect(chats(a.c)).toEqual([]);
    expect(a.c.messages.some(isKick)).toBe(false);
    a.c.socket.close();
  });

  it('a line longer than the protocol allows drops the connection (an honest page never sends one)', async () => {
    const a = await player('chat_long', 0);
    const frame = encode({ type: 'say', text: 'x'.repeat(200) });
    const longer = new Uint8Array(frame.length + 300); // a hand-made frame with a bigger text length
    longer.set(frame);
    const dv = new DataView(longer.buffer);
    const lenAt = 1; // the text length is the first thing after the type byte
    const oldLen = new DataView(frame.buffer, frame.byteOffset).getUint16(lenAt);
    dv.setUint16(lenAt, oldLen + 300);
    longer.fill(0x78, frame.length);
    a.c.socket.emit('m', longer);
    expect((await a.c.waitFor(isKick)).reason).toMatch(/bad message/);
  });

  it('only a joined connection may speak', async () => {
    const c = connect(base); open.push(c.socket); await c.ready;
    say(c, 'let me in');
    expect((await c.waitFor(isKick)).reason).toMatch(/say hello first/);
  });
});

describe('limits and mute', () => {
  it('five lines in ten seconds; the sixth is refused and the speaker is told so (nobody else is)', async () => {
    const a = await player('chat_fast', 0), b = await player('chat_fastlistener', 2);
    for (let i = 0; i < 6; i++) say(a.c, 'line ' + i);
    await sleep(500);
    expect(chats(a.c)).toHaveLength(5);
    expect(chats(b.c)).toHaveLength(5);
    expect(notices(a.c).some(t => /too fast/i.test(t))).toBe(true);
    expect(notices(b.c).some(t => /too fast/i.test(t))).toBe(false);
    a.c.socket.close(); b.c.socket.close();
  });

  it('a flood of chat messages hits the same 60-a-second limit as everything else and drops the connection', async () => {
    const a = await player('chat_flood', 0);
    for (let i = 0; i < 120; i++) say(a.c, 'spam');
    expect((await a.c.waitFor(isKick)).reason).toMatch(/too many/);
  });

  it('a muted account can still play but nobody hears it (not even itself), and it is told; unmuting brings it back at once', async () => {
    const quiet = await player('chat_quiet', 0), friend = await player('chat_friend', 1);
    const id = (await admin('GET', '/api/admin/users')).body.find((u: { username: string }) => u.username === 'chat_quiet').id;
    expect((await admin('POST', `/api/admin/users/${id}/muted`, { muted: true })).status).toBe(201);
    say(quiet.c, 'can anyone hear me');
    await sleep(400);
    expect(chats(friend.c)).toEqual([]);
    expect(chats(quiet.c)).toEqual([]);
    expect(notices(quiet.c).some(t => /muted/i.test(t))).toBe(true);
    expect(quiet.c.messages.some(isKick)).toBe(false); // still connected
    expect((await admin('POST', `/api/admin/users/${id}/muted`, { muted: false })).status).toBe(201);
    say(quiet.c, 'now?');
    await sleep(400);
    expect(chats(friend.c).map(m => m.text)).toEqual(['now?']);
    quiet.c.socket.close(); friend.c.socket.close();
  });
});

describe('admin: muting', () => {
  it('needs the admin password, a real account and a true/false, and is listed and recorded', async () => {
    await player('chat_target', 0).then(p => p.c.socket.close());
    const id = (await admin('GET', '/api/admin/users')).body.find((u: { username: string }) => u.username === 'chat_target').id;
    expect((await api(base, 'POST', `/api/admin/users/${id}/muted`, { muted: true })).status).toBe(403);
    expect((await admin('POST', `/api/admin/users/${id}/muted`, { muted: 'yes' })).status).toBe(400);
    expect((await admin('POST', '/api/admin/users/99999/muted', { muted: true })).status).toBe(404);
    expect((await admin('POST', `/api/admin/users/${id}/muted`, { muted: true })).status).toBe(201);
    expect((await admin('GET', '/api/admin/users')).body.find((u: { id: number }) => u.id === id).muted).toBe(true);
    const log = (await admin('GET', '/api/admin/audit?limit=5')).body as Array<{ action: string; target: string }>;
    expect(log[0]).toMatchObject({ action: 'account.mute', target: 'chat_target' });
    expect((await admin('POST', `/api/admin/users/${id}/muted`, { muted: false })).status).toBe(201);
  });
});
