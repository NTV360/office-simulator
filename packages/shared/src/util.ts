// Small helpers used by the simulation and the client, including the two random streams.
//
// Two separate streams of randomness:
//
//  - The SIMULATION stream: random(), rnd(), pick(), shuffle(). By default it is Math.random, exactly as
//    before. setSeed(n) switches it to a seeded generator so the same seed replays the same office day
//    (setSeed(null) switches back). Only code that decides what people do or look like may use it.
//  - The VISUAL stream: vrandom(), vrnd(), vpick(). Always Math.random. Use these for anything that is
//    only about how things are drawn (textures, desk clutter, the fighting-game animation, camera choices).
//
// Keeping them apart matters: visual code runs at unpredictable moments, and if it drew from the seeded
// stream it would shift every later simulation draw and make seeded runs irreproducible.

let source: () => number = Math.random;
let draws = 0;

/** One number in [0, 1) from the simulation stream. */
const random = (): number => { draws++; return source(); };

/**
 * How many numbers the simulation stream has produced. The fingerprint includes it, so an added, dropped
 * or reordered draw is caught even when it does not change an outcome yet.
 */
const drawCount = (): number => draws;

// mulberry32: a small, fast, well-behaved seeded generator.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed the simulation stream (null or undefined goes back to Math.random). */
function setSeed(seed: number | null | undefined): void {
  source = seed == null ? Math.random : mulberry32(seed);
}

/** A number in [a, b) from the simulation stream. */
const rnd = (a: number, b: number): number => a + random() * (b - a);

/** A random element of the array (simulation stream). */
const pick = <T>(a: readonly T[]): T => a[Math.floor(random() * a.length)];

/** Shuffle the array in place (simulation stream) and return it. */
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The visual stream (never seeded).
const vrandom = Math.random;
const vrnd = (a: number, b: number): number => a + vrandom() * (b - a);
const vpick = <T>(a: readonly T[]): T => a[Math.floor(vrandom() * a.length)];

const TAU = Math.PI * 2;

/** The shortest signed angle from a to b, in (-PI, PI]. */
const angDiff = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export { TAU, angDiff, drawCount, pick, random, rnd, setSeed, shuffle, vpick, vrandom, vrnd };
