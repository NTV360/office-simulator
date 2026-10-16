// The music corner's keyboard and guitar make sound when you play them (ui/interact.js): a small synthesised
// piano, and plucked strings (Karplus-Strong) strummed as chords. The audio starts with the first note you play.
const audio = { ctx: null, out: null, strings: new Map() };
// Guitar chords, low string to high, as MIDI notes (40 is the low E).
const CHORDS = [
  ['C', [48, 52, 55, 60, 64]], ['G', [43, 47, 50, 55, 59, 67]], ['D', [50, 57, 62, 66]], ['Em', [40, 47, 52, 55, 59, 64]],
  ['Am', [45, 52, 57, 60, 64]], ['F', [41, 48, 53, 57, 60, 65]], ['A', [45, 52, 57, 61, 64]], ['E', [40, 47, 52, 56, 59, 64]],
];
const QUIET = .0008;

function context() {
  if (!audio.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null;
    audio.ctx = new Ctx(); audio.out = audio.ctx.createGain(); audio.out.gain.value = .5; audio.out.connect(audio.ctx.destination);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio.ctx;
}
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

// Play a piano note; returns a function that lets go of it (the note then fades quickly).
function pianoNote(midi) {
  const c = context(); if (!c) return () => {};
  const t = c.currentTime, f = hz(midi), env = c.createGain(), tone = c.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = Math.min(9000, f * 7);
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(.3, t + .005); env.gain.exponentialRampToValueAtTime(QUIET, t + 3);
  // a bright fundamental with two softer overtones
  const oscs = [[1, 'triangle', 1], [2, 'sine', .3], [3, 'sine', .1]].map(([k, type, level]) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f * k; g.gain.value = level;
    o.connect(g).connect(tone); o.start(t); o.stop(t + 3.05); return o;
  });
  tone.connect(env).connect(audio.out);
  return () => {
    const n = c.currentTime; env.gain.cancelScheduledValues(n); env.gain.setValueAtTime(Math.max(env.gain.value, QUIET), n);
    env.gain.exponentialRampToValueAtTime(QUIET, n + .25);
    for (const o of oscs) try { o.stop(n + .3); } catch (_) {}
  };
}

// A plucked string's sound: a burst of noise that a short delay line averages into a decaying tone.
function stringSound(c, f) {
  const rate = c.sampleRate, n = Math.floor(rate * 2.4), period = Math.max(2, Math.round(rate / f));
  const buf = c.createBuffer(1, n, rate), out = buf.getChannelData(0), ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  for (let i = 0, j = 0; i < n; i++) { const k = (j + 1) % period; out[i] = ring[j]; ring[j] = (ring[j] + ring[k]) * .5 * .996; j = k; }
  return buf;
}
// Strum chord `i` (CHORDS) down, or up from the high string.
function strum(i, up = false) {
  const c = context(); if (!c) return;
  const notes = up ? [...CHORDS[i][1]].reverse() : CHORDS[i][1];
  notes.forEach((midi, k) => {
    if (!audio.strings.has(midi)) audio.strings.set(midi, stringSound(c, hz(midi)));
    const s = c.createBufferSource(), g = c.createGain(); s.buffer = audio.strings.get(midi); g.gain.value = .32;
    s.connect(g).connect(audio.out); s.start(c.currentTime + k * .018);
  });
}

export { CHORDS, pianoNote, strum };
