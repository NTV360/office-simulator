import { describe, expect, it } from 'vitest';
import { MAX_CHAT } from '@office/shared';
import { CHAT_LIMIT, CHAT_RANGE, CHAT_WINDOW_MS, MUTE_CACHE_MS, ChatService, cleanChat, type Hearer, type Speaker } from './chat';

describe('cleanChat', () => {
  it('keeps plain text, trims and collapses spaces', () => {
    expect(cleanChat('  hello   there  ')).toBe('hello there');
    expect(cleanChat('café ünï ✓ 你好')).toBe('café ünï ✓ 你好');
  });
  it('turns newlines and tabs into spaces, so a line stays one line', () => {
    expect(cleanChat('one\ntwo\r\nthree\tfour')).toBe('one two three four');
  });
  it('removes control characters and the invisible and direction-changing ones', () => {
    expect(cleanChat('a\u0000b\u0007c')).toBe('a b c');
    expect(cleanChat('ab​cd‮ef⁦gh﻿')).toBe('ab cd ef gh');
    expect(cleanChat('‮​‏')).toBeNull(); // nothing visible left
  });
  it('removes characters that print as nothing, so a line of them is empty', () => {
    for (const blank of ['ㅤ', '⠀', 'ᅟᅠ', 'ﾠ', '؜', '᠎', '͏', '️', ' ', ' ', '󠁁󠁂', '𝅳']) {
      expect(cleanChat(blank + blank + blank), JSON.stringify(blank)).toBeNull();
    }
    expect(cleanChat('a󠁁b')).toBe('a b'); // tag characters can carry hidden text
    expect(cleanChat('xㅤy')).toBe('x y');
  });
  it('limits a tower of combining marks to three on a letter', () => {
    expect(cleanChat('a' + '́'.repeat(200) + 'b')).toBe('á́́b');
  });
  it('cuts to the limit without splitting an emoji, and the result always fits the protocol', () => {
    const line = cleanChat('😀'.repeat(150))!;
    expect(line.length).toBeLessThanOrEqual(MAX_CHAT);
    expect([...line].every(ch => ch === '😀')).toBe(true); // no lone half of a pair
    expect(line.length).toBe(MAX_CHAT); // (100 emoji of two units each)
    const odd = cleanChat('a' + '😀'.repeat(150))!; // an emoji that would straddle the limit is left out whole
    expect(odd.length).toBe(MAX_CHAT - 1);
    expect(odd.endsWith('😀')).toBe(true);
  });
  it('markup stays text: it is shown as text, never read as markup', () => {
    expect(cleanChat('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
  it('cuts to the longest allowed line, and refuses anything that is not text or empty', () => {
    expect(cleanChat('x'.repeat(MAX_CHAT + 50))).toHaveLength(MAX_CHAT);
    for (const bad of [undefined, null, 5, {}, [], '', '   ', '\n\t']) expect(cleanChat(bad), JSON.stringify(bad)).toBeNull();
  });
});

const spot = (accountId: number, x: number, z: number): Hearer => ({ accountId, x, z });
function service(opts: { speakers?: Speaker[]; muted?: Set<number>; now?: () => number } = {}) {
  const speakers = opts.speakers ?? [
    { accountId: 1, personId: 11, name: 'Ana', x: 0, z: 0 },
    { accountId: 2, personId: 12, name: 'Ben', x: 6, z: 0 },
    { accountId: 3, personId: 13, name: 'Cat', x: 12, z: 0 },
    { accountId: 4, personId: 14, name: 'Dan', x: 0, z: 10.5 },
  ];
  const muted = opts.muted ?? new Set<number>();
  return new ChatService({
    speaker: id => speakers.find(s => s.accountId === id) ?? null,
    hearers: () => speakers.map(s => spot(s.accountId, s.x, s.z)),
    muted: async id => muted.has(id),
  }, opts.now);
}

describe('ChatService', () => {
  it('is heard by the speaker and by everyone within range, and nobody else', async () => {
    const r = await service().say(1, 'hello');
    expect(r).toEqual({ ok: true, from: 11, name: 'Ana', text: 'hello', to: [1, 2] }); // Ben is 6 m away; Cat 12 m; Dan 10.5 m
    const r2 = await service().say(2, 'hi');
    expect(r2.ok && r2.to.sort()).toEqual([1, 2, 3]); // from Ben: Ana at 6, Cat at 6
  });
  it('range is 10 m exactly: at 10 m you hear, a little further you do not', async () => {
    expect(CHAT_RANGE).toBe(10);
    const speakers = [{ accountId: 1, personId: 1, name: 'A', x: 0, z: 0 }, { accountId: 2, personId: 2, name: 'B', x: 10, z: 0 }, { accountId: 3, personId: 3, name: 'C', x: 10.01, z: 0 }];
    const r = await service({ speakers }).say(1, 'x');
    expect(r.ok && r.to).toEqual([1, 2]);
  });
  it('a speaker always hears themselves (even alone)', async () => {
    const r = await service({ speakers: [{ accountId: 9, personId: 9, name: 'Solo', x: 0, z: 0 }] }).say(9, 'anyone?');
    expect(r.ok && r.to).toEqual([9]);
  });
  it('the text is cleaned, and an empty line is refused without using up the allowance', async () => {
    const s = service();
    for (let i = 0; i < 20; i++) expect(await s.say(1, '   \n ')).toEqual({ ok: false, reason: 'empty' });
    const r = await s.say(1, 'a\u0000b');
    expect(r.ok && r.text).toBe('a b');
  });
  it('is limited: five lines in ten seconds, then a refusal until the window passes', async () => {
    let t = 1_000_000;
    const s = service({ now: () => t });
    for (let i = 0; i < CHAT_LIMIT; i++) expect((await s.say(1, 'line ' + i)).ok).toBe(true);
    expect(await s.say(1, 'too many')).toEqual({ ok: false, reason: 'rate' });
    expect((await s.say(2, 'someone else is fine')).ok).toBe(true);
    t += CHAT_WINDOW_MS + 1;
    expect((await s.say(1, 'later')).ok).toBe(true);
  });
  it('a muted account is refused and nobody hears anything, and being muted does not use the allowance', async () => {
    let t = 5_000_000;
    const muted = new Set([1]);
    const s = service({ muted, now: () => t });
    for (let i = 0; i < 10; i++) expect(await s.say(1, 'hello?')).toEqual({ ok: false, reason: 'muted' });
    muted.delete(1);
    t += MUTE_CACHE_MS + 1; // (the answer is remembered for a moment)
    expect((await s.say(1, 'back')).ok).toBe(true); // (the refused ones did not count against the limit)
  });
  it('asks the database whether someone is muted at most about four times a second, however fast they type', async () => {
    let t = 1_000_000, asked = 0;
    const speakers = [{ accountId: 1, personId: 1, name: 'A', x: 0, z: 0 }];
    const s = new ChatService({ speaker: () => speakers[0], hearers: () => [{ accountId: 1, x: 0, z: 0 }], muted: async () => { asked++; return true; } }, () => t);
    for (let i = 0; i < 200; i++) await s.say(1, 'x');
    expect(asked).toBe(1);
    t += MUTE_CACHE_MS + 1;
    await s.say(1, 'x');
    expect(asked).toBe(2);
  });
  it('someone over the limit costs no database query at all', async () => {
    let t = 1_000_000, asked = 0;
    const speakers = [{ accountId: 1, personId: 1, name: 'A', x: 0, z: 0 }];
    const s = new ChatService({ speaker: () => speakers[0], hearers: () => [{ accountId: 1, x: 0, z: 0 }], muted: async () => { asked++; return false; } }, () => t);
    for (let i = 0; i < CHAT_LIMIT; i++) await s.say(1, 'line');
    const before = asked;
    for (let i = 0; i < 100; i++) expect(await s.say(1, 'more')).toEqual({ ok: false, reason: 'rate' });
    expect(asked).toBe(before);
  });
  it('someone who is not playing cannot speak', async () => {
    expect(await service().say(99, 'ghost')).toEqual({ ok: false, reason: 'nobody' });
  });
});
