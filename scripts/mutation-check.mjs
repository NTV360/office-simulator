// Proves the simulation tests can fail: break the simulation on purpose, one way at a time, and require the Node
// scenario tests to notice. Each file is put back afterwards, even if this script is interrupted.   npm run check:mutations
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sim = 'packages/shared/src/sim/';

const MUTATIONS = [
  ['a new day forgets to hide people', sim + 'day.ts', 'p.meeting = null; p.shown = false; scheduleDay(p);', 'p.meeting = null; scheduleDay(p);'],
  ['removing staff does not free their desk', sim + 'factory.ts', 'endTask(p); if (p.slot) p.slot.owner = null;', 'endTask(p);'],
  ['meetings never end', sim + 'meetings.ts', 'if (sim.t >= m.end) {', 'if (sim.t >= m.end + 100000) {'],
  ['walkers never move', sim + 'step.ts', 'else { p.pos.x += dx / d * step; p.pos.z += dz / d * step; moved += step; step = 0; }', 'else { moved += step; step = 0; }'],
  ['finishing a task skips its end hook (props stay in hand)', sim + 'tasks.ts', '  if (t.onEnd) t.onEnd(p);', ''],
  ['the simulation steps the human-controlled person', sim + 'step.ts', '  if (isDriven(p)) return;', ''],
  ['Hazel loses her late-stay rule', sim + 'factory.ts', 'if (p.name === HAZEL_NAME) p.leaveAt = HAZEL_LEAVE_AT;', ''],
  ['the new day does not clear the arrival record', sim + 'factory.ts', 'p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;', 'p.hadLunch = false; p.coffees = 0;'],
  ['the same seed no longer gives the same day', sim + 'tasks.ts', 'const free = (list: Spot[]): Spot[] => shuffle(list.filter(s => !s.occupant));', 'const free = (list: Spot[]): Spot[] => shuffle(list.filter(s => !s.occupant)).sort(() => Math.random() - .5);'],
  ['taking a person over does not stop what they were doing', sim + 'takeover.ts', "  endTask(p); // runs the task's end hook: props down, a shared seat freed\n", ''],
  ['handing a person back leaves the human in charge', sim + 'takeover.ts', "  p.controller = 'ai';\n", ''],
  ['taking over always teleports the person to the entrance', sim + 'takeover.ts', 'if (!p.shown || p.arrivedAt == null) {', 'if (true) {'],
  ['a guest who leaves is not removed', sim + 'takeover.ts', '  if (i >= 0) people.splice(i, 1);', ''],
  ['an input longer than 1 is not shortened (speed hack)', sim + 'driven.ts', 'if (len > 1) { mx /= len; mz /= len; }', ''],
  ['a stick pushed half way still walks at full speed', sim + 'driven.ts', ' * Math.min(1, len) * dt;', ' * dt;'],
  ['an old input never goes stale (the player is stuck walking)', sim + 'driven.ts', 'const live = input !== null && tick - input.tick >= 0 && tick - input.tick <= staleTicks ? input : null;', 'const live = input;'],
  ['standing up leaves the seat marked as taken', sim + 'driven.ts', 'if (t.spot.occupant === p) t.spot.occupant = null;', ''],
  ['a seat someone is in can still be taken by a second person (shared seat or desk)', sim + 'driven.ts', 'if (spot.occupant && spot.occupant !== p) return false;\n  if (!spot.shared) {', 'if (!spot.shared) {'],
  ['a role desk (HR, CTO, cleaner) seats a random role', sim + 'factory.ts', '(slot.role as string | undefined) ?? pick(roleBag)', 'pick(roleBag)'],
  ['role desks are not seated first', sim + 'state.ts', 'deskPool.push(...ordinary.slice(0, 1), ...special, ...ordinary.slice(1));', 'deskPool.push(...ordinary, ...special);'],
  ['a teleport is glided to instead of snapped to', sim + 'prediction.ts', 'if (error > this.snapDistance) {', 'if (error > 1e9) {'],
  ['a pull leaves the history unshifted (the same difference is corrected twice)', sim + 'prediction.ts', 'for (const e of this.trail) { e.x += dx; e.z += dz; }', ''],
  ['an old ack is believed', sim + 'prediction.ts', 'ack.seq < this.newest', 'false'],
  ['a chat line is heard from any distance', 'apps/server/src/play/chat.ts', 'Math.hypot(h.x - speaker.x, h.z - speaker.z) <= CHAT_RANGE', 'true'],
  ['a muted account can still chat', 'apps/server/src/play/chat.ts', "if (await this.lookup.muted(accountId)) return { ok: false, reason: 'muted' };", ''],
  ['there is no limit on chat lines', 'apps/server/src/play/chat.ts', "if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'rate' };", ''],
  ['chat keeps direction-changing characters', 'apps/server/src/play/chat.ts', "raw.replace(UNWANTED, ' ')", 'raw'],
  ['sitting goes through walls', sim + 'driven.ts', 'if (d < bestDistance && clearBetween(p.pos, spot.pos, SEAT_MARGIN)) {', 'if (d < bestDistance) {'],
];

const only = process.argv[2];
let missed = 0;
for (const [name, file, from, to] of MUTATIONS) {
  if (only && !name.includes(only)) continue;
  const full = path.join(root, file);
  const original = fs.readFileSync(full, 'utf8');
  if (original.split(from).length !== 2) { console.log(`  BROKEN SCRIPT  ${name}: the text to change is not in ${file} exactly once`); missed++; continue; }
  const restore = () => fs.writeFileSync(full, original);
  process.on('exit', restore);
  try {
    fs.writeFileSync(full, original.replace(from, () => to));
    const r = spawnSync('npx', ['vitest', 'run', sim + 'scenario.test.ts', sim + 'takeover.test.ts', sim + 'driven.test.ts', 'packages/shared/src/layout/stations.test.ts', sim + 'prediction.test.ts', 'apps/server/src/play/chat.test.ts'], { cwd: root, encoding: 'utf8', shell: true });
    const failed = r.status !== 0;
    console.log(`  ${failed ? 'caught' : 'MISSED'}  ${name}`);
    if (!failed) missed++;
  } finally {
    restore();
    process.removeListener('exit', restore);
  }
}
console.log(missed ? `\n${missed} mutation(s) not caught` : '\nevery mutation was caught');
process.exitCode = missed ? 1 : 0;
