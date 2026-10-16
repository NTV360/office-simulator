// The music corner's keyboard and guitar make sound when you play them (ui/interact.js): a small synthesised
// piano, and plucked strings (Karplus-Strong) strummed as chords. The TV lounge plays songs (playSong). The audio
// starts with the first note.
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

// ----- songs for the TV lounge ("Play music", ui/games.js): chords, bass and drums on a loop, scheduled a little
// ahead on the audio clock
const SONGS = [
  { name: 'Lo-fi break', bpm: 78, chords: [[57, 60, 64, 67], [50, 57, 60, 65], [55, 59, 62, 65], [48, 55, 59, 64]] }, // Am7 Dm7 G7 Cmaj7
  { name: 'Sunny desk', bpm: 104, chords: [[48, 52, 55, 60], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]] }, // C G Am F
  { name: 'Night shift', bpm: 90, chords: [[40, 52, 55, 59], [48, 52, 55, 60], [43, 50, 55, 59], [50, 54, 57, 62]] }, // Em C G D
];
const song = { i: -1, timer: null, next: 0, beat: 0, noise: null };
function tone(c, midi, t, dur, level, type) {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = hz(midi);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .01); g.gain.exponentialRampToValueAtTime(QUIET, t + dur);
  o.connect(g).connect(audio.out); o.start(t); o.stop(t + dur + .05);
}
function hit(c, t, dur, level, freq) { // a burst of filtered noise: the snare and the hi-hat
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = song.noise; f.type = 'highpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(QUIET, t + dur);
  s.connect(f).connect(g).connect(audio.out); s.start(t); s.stop(t + dur);
}
function kick(c, t) {
  const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .12);
  g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(QUIET, t + .3); o.connect(g).connect(audio.out); o.start(t); o.stop(t + .32);
}
function scheduleSong() {
  const c = audio.ctx, s = SONGS[song.i], beat = 60 / s.bpm;
  while (song.next < c.currentTime + .3) {
    const b = song.beat, t = song.next, chord = s.chords[Math.floor(b / 4) % s.chords.length];
    if (b % 4 === 0) for (const m of chord) tone(c, m + 12, t, beat * 3.8, .045, 'triangle'); // the chord, once a bar
    if (b % 2 === 0) tone(c, chord[0] - 12, t, beat * 1.8, .16, 'triangle');                     // the bass
    if (b % 2 === 0) kick(c, t); else hit(c, t, .18, .22, 1200);                                 // kick, snare
    hit(c, t + beat / 2, .05, .08, 7000);                                                        // hi-hat
    song.next += beat; song.beat++;
  }
}
// Play song `i` (SONGS) from the start, or stop.
function playSong(i) {
  stopSong(); const c = context(); if (!c) return;
  if (!song.noise) { song.noise = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = song.noise.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; }
  Object.assign(song, { i, next: c.currentTime + .1, beat: 0 }); scheduleSong(); song.timer = setInterval(scheduleSong, 60);
}
function stopSong() { clearInterval(song.timer); song.timer = null; song.i = -1; }

export { CHORDS, SONGS, pianoNote, playSong, stopSong, strum };
