// Where the chat history panel (net/chat.js) stands: plain arithmetic on rectangles, kept apart so it can be tested without a page.
// Sizes and positions are in CSS pixels; a position is the panel's top-left corner.

const MARGIN = 12;

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** Keep a panel of `size` ({ width, height }) wholly inside the `view` ({ width, height }), at least `margin` from each edge (as far as it fits). */
export function clampPanel(pos, size, view, margin = MARGIN) {
  const maxLeft = Math.max(margin, view.width - size.width - margin), maxTop = Math.max(margin, view.height - size.height - margin);
  return { left: Math.min(Math.max(pos.left, margin), maxLeft), top: Math.min(Math.max(pos.top, margin), maxTop) };
}

/**
 * Where the panel starts (and goes back to on a double-click): the bottom-right corner, lifted above the dock only when the two would overlap.
 * `dock` is the dock's rectangle ({ left, right, top }) or null when it is hidden.
 */
export function defaultPanel(size, view, dock, margin = MARGIN) {
  const left = view.width - size.width - margin;
  let top = view.height - size.height - margin;
  if (dock && finite(dock.top) && left < dock.right && left + size.width > dock.left) top = Math.min(top, dock.top - size.height - 10);
  return clampPanel({ left, top }, size, view, margin);
}

/** A saved position read back from storage: `{ left, top }`, or null when it is missing or not two numbers. */
export function parsePanel(text) {
  if (typeof text !== 'string') return null;
  try {
    const v = JSON.parse(text);
    return v && finite(v.left) && finite(v.top) ? { left: v.left, top: v.top } : null;
  } catch { return null; }
}
