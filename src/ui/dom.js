const $ = id => document.getElementById(id);

function cap(key) { const k = document.createElement('kbd'); k.textContent = key; return k; }
// A button or label that names the key that does it: a keycap, then the text (no keycap on touch screens: key null).
// The DOM is only touched when it changes, so it can be called every frame.
function keyed(el, key, text) {
  const was = `${key ?? ''}|${text}`; if (el.dataset.keyed === was) return; el.dataset.keyed = was;
  const label = document.createElement('span'); label.textContent = text;
  el.replaceChildren(...(key ? [cap(key), label] : [label]));
}
// A row of key hints: [[keys, what they do], ...]; keys separated by spaces get a keycap each.
function keyHints(el, pairs) {
  el.replaceChildren(...pairs.map(([keys, what]) => {
    const s = document.createElement('span'); s.append(...keys.split(' ').map(cap), what); return s;
  }));
}

export { $, keyHints, keyed };
