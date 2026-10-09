// Character — one API for both styles: 'blocky' (voxel) and 'chibi' (smooth, big-headed)
// --------------------------------------------------------------------------------------
//   import * as THREE from 'three';
//   import { Character, PRESETS } from './characters.js';
//
//   const c = new Character(THREE, { type: 'chibi', body: 'female', hair: 'bun' });
//   scene.add(c.root);
//   c.play('Walk');                 // see c.clipNames
//   // each frame: c.update(delta)
//
//   c.set({ type: 'blocky' });      // same design, other style — root, position and animation stay
//   new Character(THREE, PRESETS.chibi.santa);
//   new Character(THREE, { ...PRESETS.blocky.skater, type: 'chibi' });
//
// Any config works in either style. Parts a style doesn't have are swapped for the closest
// match (see FALLBACKS) or skipped; the original config is kept, so switching back restores them.
import * as Blocky from './blocky-character.js';
import * as Chibi from './chibi-character.js';
import { PRESETS as BLOCKY_PRESETS } from './blocky-presets.js';
import { CHIBI_PRESETS } from './chibi-presets.js';

// Both styles stand the same height by default (top of head ≈ 1.05 units for an average-height
// character). Blocky is scaled down from its own 0.056 default to match chibi.
export const DEFAULT_SIZES = { chibi: { scale: 0.06 }, blocky: { px: 0.0327 } };

export const STYLES = {
  chibi: { label: 'Chibi', Class: Chibi.ChibiCharacter, lib: Chibi },
  blocky: { label: 'Blocky', Class: Blocky.BlockyCharacter, lib: Blocky },
};

// closest equivalent when a part doesn't exist in the target style (null = leave it out)
export const FALLBACKS = {
  blocky: {
    hair: { swept: 'short', curly: 'afro' },
    facialHair: { fullBeard: 'beard' },
    accessories: { santaHat: 'beanie', bowtie: 'tie', icecream: 'coffee', balloon: null, belt: null, gloves: null },
  },
  chibi: {
    bottom: { widePants: 'pants' },
    shoes: { hightops: 'sneakers' },
    accessories: { camera: null, guitar: 'backpack' },
  },
};

export const PRESETS = {
  chibi: Object.fromEntries(Object.entries(CHIBI_PRESETS).map(([k, p]) => [k, { type: 'chibi', ...p }])),
  blocky: Object.fromEntries(Object.entries(BLOCKY_PRESETS).map(([k, p]) => [k, { type: 'blocky', ...p }])),
};

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const PARTS = ['hair', 'facialHair', 'top', 'bottom', 'shoes'];

/** Shared config shape: parts are objects, eyes are { style, color }, accessories are objects. */
export function toUniversal(config = {}) {
  const c = clone(config);
  for (const k of PARTS) if (typeof c[k] === 'string') c[k] = { style: c[k] };
  if (typeof c.eyes === 'string') c.eyes = { color: c.eyes };
  if (c.accessories) c.accessories = c.accessories.map((a) => (typeof a === 'string' ? { type: a } : a));
  return c;
}

/** Turn a universal config into one the given style understands. Returns { config, notes }. */
export function adapt(config, type) {
  const { Class, lib } = STYLES[type];
  const opts = Class.options, fb = FALLBACKS[type] ?? {}, notes = [];
  const c = toUniversal(config);
  delete c.type;
  for (const k of PARTS) {
    const p = c[k];
    if (!p?.style || opts[k].includes(p.style)) continue;
    const alt = fb[k]?.[p.style];
    notes.push(`${p.style} ${alt ? `shown as ${alt}` : 'not available'} in ${STYLES[type].label}`);
    c[k] = alt ? { ...p, style: alt } : { ...p, style: undefined };
    if (!alt) delete c[k].style;
  }
  if (c.accessories) {
    const seen = new Set();
    c.accessories = c.accessories.flatMap((a) => {
      let t = a.type;
      if (!lib.ACCESSORIES[t]) {
        const alt = fb.accessories?.[t];
        notes.push(`${t} ${alt ? `shown as ${alt}` : 'not available'} in ${STYLES[type].label}`);
        if (!alt) return [];
        t = alt;
        // keep the original item's look (e.g. a red Santa hat → red beanie)
        if (a.color === undefined) {
          const src = Blocky.ACCESSORIES[a.type] ?? Chibi.ACCESSORIES[a.type];
          if (src?.color) return seen.has(t) ? [] : (seen.add(t), [{ ...a, type: t, color: src.color }]);
        }
      }
      if (seen.has(t)) return [];
      seen.add(t);
      return [{ ...a, type: t }];
    });
  }
  if (type === 'blocky') {
    if (c.eyes) c.eyes = c.eyes.color;
    if (!c.eyes) delete c.eyes;
    delete c.cheeks;
  } else {
    delete c.freckles;
  }
  // drop undefined so the style's defaults apply
  for (const k of PARTS) if (c[k] && c[k].style === undefined) delete c[k].style;
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return { config: c, notes };
}

export class Character {
  /**
   * @param THREE  the three.js module
   * @param config any config; `type` picks the style (default 'chibi')
   * @param sizes  optional { blocky: { px }, chibi: { scale } } — defaults to DEFAULT_SIZES (equal heights)
   */
  constructor(THREE, config = {}, sizes = {}) {
    this.THREE = THREE;
    this.sizes = { chibi: { ...DEFAULT_SIZES.chibi, ...sizes.chibi }, blocky: { ...DEFAULT_SIZES.blocky, ...sizes.blocky } };
    this.root = new THREE.Group();
    this.root.name = 'Character';
    this.inner = null;
    this.set(config, true);
  }

  set(patch = {}, replace = false) {
    const next = toUniversal(replace ? patch : { ...this.config, ...patch });
    next.type = STYLES[next.type] ? next.type : 'chibi';
    const { Class } = STYLES[next.type];
    const { config, notes } = adapt(next, next.type);
    const playing = this.inner?.current?.getClip().name;
    if (this.inner instanceof Class) this.inner.set(config, true);
    else {
      if (this.inner) { this.root.remove(this.inner.root); this.inner.dispose(); }
      const size = this.sizes[next.type] ?? {};
      this.inner = new Class(this.THREE, config, size);
      this.root.add(this.inner.root);
      if (playing && this.inner.clipNames.includes(playing)) this.inner.play(playing, 0);
    }
    this.config = next;
    this.notes = notes;
    return this;
  }

  get type() { return this.config.type; }
  /** The config as the current style actually draws it (defaults filled in). */
  get resolved() {
    const r = toUniversal(this.inner.toJSON());
    if (this.type === 'blocky' && typeof this.inner.config.eyes === 'string') r.eyes = { ...(this.config.eyes ?? {}), color: this.inner.config.eyes };
    return { type: this.type, ...r };
  }
  toJSON() { return clone(this.config); }
  get clipNames() { return this.inner.clipNames; }
  get defaultClip() { return this.inner.defaultClip; }
  get current() { return this.inner.current; }
  get mixer() { return this.inner.mixer; }
  get clips() { return this.inner.clips; }
  get warnings() { return [...(this.inner.warnings ?? []), ...(this.notes ?? [])]; }
  play(name, fade) { this.inner.play(name, fade); return this; }
  update(dt) { this.inner.update(dt); }
  dispose() { this.inner?.dispose(); }

  static options(type) { return STYLES[type].Class.options; }
  static random(type = 'chibi', seed) { return { type, ...STYLES[type].Class.random(seed) }; }
}
