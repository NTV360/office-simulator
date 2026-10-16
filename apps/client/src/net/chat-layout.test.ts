import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module
import { clampPanel, defaultPanel, parsePanel } from './chat-layout.js';

const view = { width: 1280, height: 720 }, size = { width: 340, height: 320 };

describe('the chat history panel placement', () => {
  it('keeps the panel inside the window, 12 px from every edge', () => {
    expect(clampPanel({ left: -50, top: -50 }, size, view)).toEqual({ left: 12, top: 12 });
    expect(clampPanel({ left: 5000, top: 5000 }, size, view)).toEqual({ left: 1280 - 340 - 12, top: 720 - 320 - 12 });
    expect(clampPanel({ left: 300, top: 200 }, size, view)).toEqual({ left: 300, top: 200 });
  });
  it('a window smaller than the panel puts it at the margin instead of off the page', () => {
    expect(clampPanel({ left: 400, top: 400 }, size, { width: 300, height: 200 })).toEqual({ left: 12, top: 12 });
  });
  it('starts in the bottom-right corner when the dock is out of the way', () => {
    const dock = { left: 300, right: 800, top: 650 };
    expect(defaultPanel(size, view, dock)).toEqual({ left: 928, top: 388 });
    expect(defaultPanel(size, view, null)).toEqual({ left: 928, top: 388 });
  });
  it('is lifted above the dock only when the two overlap', () => {
    const wide = { left: 200, right: 1100, top: 650 };
    expect(defaultPanel(size, view, wide)).toEqual({ left: 928, top: 650 - 320 - 10 });
    const lowDock = { left: 200, right: 1100, top: 700 };
    expect(defaultPanel(size, view, lowDock).top).toBe(700 - 320 - 10); // (a dock above the panel's top edge would not be cleared: the panel goes higher)
  });
  it('reads a saved place back, and ignores anything that is not two numbers', () => {
    expect(parsePanel('{"left":10,"top":20}')).toEqual({ left: 10, top: 20 });
    for (const bad of [null, '', 'x', '{}', '{"left":1}', '{"left":"1","top":2}', '{"left":null,"top":2}', '[1,2]']) expect(parsePanel(bad as string)).toBeNull();
  });
});
