import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module
import { describeStatus } from './status-text.js';

const person = (task: object | null, state = 'doing') => ({ name: 'Ann Lee', role: 'dev', state, task, chatWith: null, moving: false });
const kinds = [...readFileSync(new URL('./status-text.js', import.meta.url), 'utf8').matchAll(/case '([A-Za-z]+)'/g)].map(m => m[1]);

describe('what a person is doing, as text', () => {
  it('reads the task kinds from the source (so a new kind is covered by the tests below without editing them)', () => {
    expect(kinds).toEqual(expect.arrayContaining(['chat', 'whiteboard', 'meeting', 'coffee']));
  });
  it('never throws, whatever a task is missing: no chat partner, no meeting, no spot, walking or not (this froze the game)', () => {
    for (const kind of kinds) for (const state of ['doing', 'walking']) {
      const text = describeStatus(person({ kind }, state), false);
      expect(typeof text, `${kind} ${state}`).toBe('string');
      expect(text, `${kind} ${state}`).not.toMatch(/undefined|\[object/);
    }
  });
  it('says "someone" when the chat partner is gone (a player took over their staff character)', () => {
    expect(describeStatus(person({ kind: 'chat' }), false)).toBe('Chatting with someone');
    expect(describeStatus(person({ kind: 'chat' }, 'walking'), false)).toBe('Walking over to someone');
    expect(describeStatus(person({ kind: 'whiteboard', anim: 'talkStand' }), false)).toBe('Discussing at the whiteboard with someone');
  });
  it('still names a partner who is there', () => {
    expect(describeStatus(person({ kind: 'chat', partner: { name: 'Bo Chen' } }), false)).toBe('Chatting with Bo');
  });
  it('knows who the player is', () => {
    expect(describeStatus(person(null), true)).toBe('Controlled by you');
    expect(describeStatus(person(null), false)).toBe('Getting settled');
  });
});
