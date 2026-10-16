// Power Slap rules, shared by the office's own fights (sim/slap.js) and the server's online ones
// (server/slap.js). Plain data, no Three.js or DOM.
const SLAP_ROUNDS = 3; // one slap each per round
// Seconds: a slapper winds up (people), waits for the power meter (you), the hit and the reaction, the result.
// `gather` is how long the server gives online fighters to get to the table.
const SLAP_TIME = { wind: 1.3, think: 10, after: 2.4, end: 4, gather: 12 };
const SLAP_LATE = .2; // the power of a slap when the meter runs out

const SLAP_KO_FROM = .55; // slaps weaker than this never knock anyone down
// The chance that a slap of this power (0-1) knocks the other one down: none below SLAP_KO_FROM, one in two at full power.
function koChance(power) { return Math.max(0, power - SLAP_KO_FROM) * 1.1; }

export { SLAP_KO_FROM, SLAP_LATE, SLAP_ROUNDS, SLAP_TIME, koChance };
