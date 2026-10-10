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
  ['Hazel loses her late-stay rule', sim + 'factory.ts', 'if (p.name === HAZEL_NAME) p.leaveAt = Math.min(DAY_END - 3, end + 62);', ''],
  ['the new day does not clear the arrival record', sim + 'factory.ts', 'p.hadLunch = false; p.arrivedAt = null; p.coffees = 0;', 'p.hadLunch = false; p.coffees = 0;'],
  ['the same seed no longer gives the same day', sim + 'tasks.ts', 'const free = (list: Spot[]): Spot[] => shuffle(list.filter(s => !s.occupant));', 'const free = (list: Spot[]): Spot[] => shuffle(list.filter(s => !s.occupant)).sort(() => Math.random() - .5);'],
  ['taking a person over does not stop what they were doing', sim + 'takeover.ts', "  endTask(p); // runs the task's end hook: props down, a shared seat freed\n", ''],
  ['handing a person back leaves the human in charge', sim + 'takeover.ts', "  p.controller = 'ai';\n", ''],
  ['taking over always teleports the person to the entrance', sim + 'takeover.ts', 'if (!p.shown || p.arrivedAt == null) {', 'if (true) {'],
  ['a guest who leaves is not removed', sim + 'takeover.ts', '  if (i >= 0) people.splice(i, 1);', ''],
  ['an input longer than 1 is not shortened (speed hack)', sim + 'driven.ts', 'if (len > 1) { mx /= len; mz /= len; }', ''],
  ['games can start on any working hour, not just breaks', sim + 'tasks.ts', 'if (onBreak(p, t)) { if (play(p)) return; }\n  else if (p.task', 'if (play(p)) return;\n  else if (p.task'],
  ['two people can be on the toilet run with the one bucket', sim + 'tasks.ts', 'if (!s || s.occupant || bucketTaken()) return false;', 'if (!s || s.occupant) return false;'],
  ['someone on the toilet run stays drawn', sim + 'tasks.ts', "endTask(q); q.state = 'away'; q.task = null; q.shown = false;", "endTask(q); q.state = 'away'; q.task = null;"],
  ['a break does not stop desk work', sim + 'step.ts', '{ p.breakKey = key; p.until = sim.t; }', '{ p.breakKey = key; }'],
  ['every shift uses the day shift break times', sim + 'schedule.ts', 'const from = t - (p.shiftStart ?? DEFAULT_SHIFT.start);', 'const from = t - DEFAULT_SHIFT.start;'],
  ['made-up staff can sit in the HR office', sim + 'factory.ts', '?? deskPool.find(s => open(s) && !s.department) ?? null;', '?? deskPool.find(s => open(s)) ?? null;'],
  ['a desk someone chose is given to whoever comes first', sim + 'factory.ts', "const open = (s: Spot) => !s.owner && !chosen.has(s.deskId ?? '');", 'const open = (s: Spot) => !s.owner;'],
  ['a removed person stays in the meeting they were in', sim + 'factory.ts', 'for (const m of meetings) { m.members = m.members.filter(x => x !== p); if (m.speaker === p) m.speaker = null; }', ''],
  ['a change in the toilet or clocked-in flag is not sent', 'apps/server/src/net/broadcaster.ts', 'a.absent !== b.absent || a.toilet !== b.toilet ||', ''],
  ['a linked account renames the employee to the account name', 'apps/server/src/play/player-manager.ts', 'if (!person.userId) person.name = account.username; // (an employee keeps', 'person.name = account.username; // (an employee keeps'],
  ['unlinking an account renames the employee to an NPC name', 'apps/server/src/play/player-manager.ts', 'if (!person.userId) person.name = npcName(); // (an employee keeps their own name)', 'person.name = npcName();'],
  ['an import overwrites the look chosen here', 'apps/server/src/employees/employee-store.ts', ', character = old.character ?? e.character;', ', character = e.character;'],
  ['a returning employee keeps a desk somebody else has taken', 'apps/server/src/employees/employee-store.ts', 'const desk = oldDesk ?? seedDesk, character', 'const desk = old.desk ?? seedDesk, character'],
  ['a much shorter list than the stored one replaces it', 'apps/server/src/employees/employee.service.ts', 'if (!opts.force && stored >= SHRINK_FLOOR && list.length < stored / 2)', 'if (false)'],
  ['control characters stay in names', 'apps/server/src/employees/supabase-source.ts', "v.replace(INVISIBLE, '').trim()", 'v.trim()'],
  ['unreadable shifts are taken as no shifts', 'apps/server/src/employees/supabase-source.ts', "await this.rows('shifts',", "await this.optional('shifts',"],
  ['a redirect is followed with the key', 'apps/server/src/employees/supabase-source.ts', "redirect: 'error',", "redirect: 'follow',"],
  ['the snapshot does not tell the browsers the clock is Live', 'apps/server/src/net/broadcaster.ts', "paused: sim.paused, live: live.mode === 'live', full,", 'paused: sim.paused, full,'],
  ['the codec drops the Live flag', 'packages/shared/src/protocol/codec.ts', '| (msg.live ? 4 : 0)', ''],
  ['the helper is removed with the staff', 'packages/shared/src/sim/factory.ts', 'const removable = (p: Person): boolean => isAi(p) && hasSlot(p) && p.owner === undefined;', 'const removable = (p: Person): boolean => isAi(p) && p.owner === undefined;'],
  ['the helper never goes home', 'packages/shared/src/sim/tasks.ts', 'export function cleanNext(p: Person): void {', 'export function cleanNext(p: Person): void { p.leaveAt = 1e9;'],
  ['the helper keeps the cloth in her hand', 'packages/shared/src/sim/tasks.ts', 'onStart: q => show(q, true), onEnd: q => show(q, false) })', 'onStart: q => show(q, true) })'],
  ['the server forgets the helper after a restart', 'apps/server/src/world/world.ts', 'ensureHelper(); // (she is not saved', '// (she is not saved'],
  ['an idle helper searches every tick instead of waiting', 'packages/shared/src/sim/step.ts', 'if (!isHelper(p) || sim.t >= p.until) chooseNext(p);', 'chooseNext(p);'],
  ['the wire takes any profile picture address', 'packages/shared/src/protocol/codec.ts', "const photo = PHOTO_URL.test(rawPhoto) ? rawPhoto : '';", 'const photo = rawPhoto;'],
  ['the import takes any profile picture address', 'apps/server/src/employees/supabase-source.ts', "(typeof v === 'string' && PHOTO_URL.test(v) ? v : null);", "(typeof v === 'string' ? v : null);"],
  ['the import asks for the whole metadata', 'apps/server/src/employees/supabase-source.ts', 'select=user_id,photo:metadata->>profileImage&', 'select=user_id,metadata&'],
  ['an import that could not read the pictures clears the stored ones', 'apps/server/src/employees/employee-store.ts', 'character = old.character ?? e.character, photo = e.photo === undefined ? old.photo : e.photo;', 'character = old.character ?? e.character, photo = e.photo ?? null;'],
  ["a chair can be put in a wall", "packages/shared/src/world/placement.ts", "if (!walkPx(px, py)) return 'blocked';", ""],
  ["a chair can be put on another chair", "packages/shared/src/world/placement.ts", "CATALOGUE[q.type].radius) return 'crowded';", "CATALOGUE[q.type].radius) return null;"],
  ["a seat can be moved where nobody could walk to it", "packages/shared/src/world/placement.ts", "if (!walkPx(ax, ay) || !findPath(ENTRY, a)) return 'unreachable';", ""],
  ["a chair somebody sits in can be picked up", "packages/shared/src/world/placement.ts", "if (seat && seatInUse(seat)) return 'in-use';", ""],
  ["a thing in somebody's hands can be picked up again", "packages/shared/src/world/placement.ts", "if (o.carriedBy !== null) return 'carried';", ""],
  ["a small thing can go off its desk", "packages/shared/src/world/placement.ts", "z > top[3] - me.radius) return 'off-desk';", "z > top[3] - me.radius) return null;"],
  ["anybody can move a desk chair", "apps/server/src/play/object-actions.ts", "return owner.account !== undefined && owner.account === accountId;", "return true;"],
  ["things can be picked up from across the room", "apps/server/src/play/object-actions.ts", "if (!inReach(person, o.x, o.z)) return no('too-far');", ""],
  ["things can be put down across the room", "apps/server/src/play/object-actions.ts", "if (!inReach(person, x, z)) return no('too-far');", ""],
  ["a person can carry two things", "apps/server/src/play/object-actions.ts", "if (isSeated(person) || carriedBy(person.id)) return no('busy');", "if (isSeated(person)) return no('busy');"],
  ["moving things is not limited", "apps/server/src/play/player-manager.ts", "if (s.objectTokens < 1) return false;", ""],
  ["what a person carried stays out when they are handed back", "packages/shared/src/sim/takeover.ts", "releaseCarried(p.id); // what they carried goes back where it started", ""],
  ["the autopilot walks to a chair somebody carries", "packages/shared/src/sim/tasks.ts", "if (typeof spot.object === 'string' && objects.byId(spot.object)?.carriedBy != null) return false;", ""],
  ["a person can sit while carrying", "packages/shared/src/sim/driven.ts", " || carriedBy(p.id)) return false; // (put down what you carry first)", ") return false;"],
  ["a person who changed more than their place is sent as only moved", "apps/server/src/net/broadcaster.ts", "=> same({ ...a, x: b.x, z: b.z, face: b.face, walkPhase: b.walkPhase }, b);", "=> true;"],
  ["the move records are left out of the snapshot", "packages/shared/src/protocol/codec.ts", "      writeMoves(w, msg.moves ?? []);", "      writeMoves(w, []);"],
  ["the whole record is not repeated after a change", "apps/server/src/net/broadcaster.ts", "this.repeat.set(p.id, REPEAT_WHOLE); }", "}"],
  ["the mirror ignores the move records", "packages/shared/src/protocol/mirror.ts", "    for (const m of s.moves ?? []) { // people who only moved", "    for (const m of []) { // people who only moved"],
  ['an empty answer from the records is taken as everyone having left', 'apps/server/src/employees/employee.service.ts', "if (list.length === 0) throw new SourceError('the employee records came back empty; nothing was changed');", ''],
  ['the secret key is in the message when the records refuse', 'apps/server/src/employees/supabase-source.ts', '`${table}: the employee records answered ${res.status}`', '`${table}: the employee records answered ${res.status} (${this.key})`'],
  ['a row with no valid id or name is imported', 'apps/server/src/employees/supabase-source.ts', 'if (!id || !first || seen.has(id)) { skipped++; continue; }', 'if (!id) { skipped++; continue; }'],
  ['an employee who belongs to an account is removed when they leave the records', 'packages/shared/src/sim/factory.ts', 'const removable = (p: Person): boolean => isAi(p) && hasSlot(p) && p.owner === undefined;', 'const removable = (p: Person): boolean => isAi(p) && hasSlot(p);'],
  ['an accessory named like an object method (constructor, toString) is accepted', 'packages/shared/src/character/spec.ts', 'Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined', 'table[key]'],
  ['a man can be in a dress', 'packages/shared/src/character/spec.ts', "if (spec.body === 'male' && spec.top.style === 'dress') spec.top.style = 'tshirt';", ''],
  ['skateboards and hoverboards are allowed in the office', 'packages/shared/src/character/spec.ts', 'return !!d && !SLOTS_OFF.includes(d.slot); };', 'return !!d; };'],
  ['a player can choose the furious face', 'packages/shared/src/character/spec.ts', 'return { ...normalizeSpec(input), angry: false };', 'return normalizeSpec(input);'],
  ['a spec can carry any number of accessories', 'packages/shared/src/character/spec.ts', 'seen.has(name) || seen.size >= MAX_ACCESSORIES', 'seen.has(name)'],
  ['an employee without a saved look gets a different look on every load', 'packages/shared/src/sim/factory.ts', 'randomSpec(role, seededRandom(e.userId))', 'randomSpec(role)'],
  ['someone not clocked in gets an infinite time (it cannot be sent or saved)', sim + 'live.ts', 'p.arriveAt = NEVER; p.leaveAt = NEVER;', 'p.arriveAt = Infinity; p.leaveAt = Infinity;'],
  ['a takeover leaves the toilet bucket with the human', sim + 'takeover.ts', 'putBucketBack(p); p.toiletUntil = null; // (a person on the toilet run is not out of the building any more)', ''],
  ['a shift that starts before 06:00 ends before it starts', sim + 'schedule.ts', 'while (end <= start) end += 24 * 60;', 'if (end <= s.start) end += 24 * 60;'],
  ['anyone can choose a desk in the HR office', sim + 'factory.ts', 's.deskId === who.desk && !s.owner && mayUse(s))', 's.deskId === who.desk && !s.owner)'],
  ['a server restarted in Live sends everybody home', sim + 'persist.ts', "live.date = mode === 'live' ? liveDay() : null;", 'live.date = null;'],
  ['the bottom row of a desk island is numbered from 1 again', 'packages/shared/src/layout/desks.ts', 'const n = si * isl.cols + c + 1;', 'const n = c + 1;'],
  ['an HR desk is not reserved for the HR department', 'packages/shared/src/layout/desks.ts', "department: 'Human Resources', room: true", 'room: true'],
  ['a stick pushed half way still walks at full speed', sim + 'driven.ts', ' * Math.min(1, len) * dt;', ' * dt;'],
  ['an old input never goes stale (the player is stuck walking)', sim + 'driven.ts', 'const live = input !== null && tick - input.tick >= 0 && tick - input.tick <= staleTicks ? input : null;', 'const live = input;'],
  ['standing up leaves the seat marked as taken', sim + 'driven.ts', 'if (t.spot.occupant === p) t.spot.occupant = null;', ''],
  ['a seat someone is in can still be taken by a second person (shared seat or desk)', sim + 'driven.ts', 'if (spot.occupant && spot.occupant !== p) return false;\n  if (!spot.shared) {', 'if (!spot.shared) {'],
  ['a teleport is glided to instead of snapped to', sim + 'prediction.ts', 'if (error > this.snapDistance) {', 'if (error > 1e9) {'],
  ['a pull leaves the history unshifted (the same difference is corrected twice)', sim + 'prediction.ts', 'for (const e of this.trail) { e.x += dx; e.z += dz; }', ''],
  ['an old ack is believed', sim + 'prediction.ts', 'ack.seq < this.newest', 'false'],
  ['a chat line is heard from any distance', 'apps/server/src/play/chat.ts', 'Math.hypot(h.x - speaker.x, h.z - speaker.z) <= CHAT_RANGE', 'true'],
  ['a muted account can still chat', 'apps/server/src/play/chat.ts', "if (await this.isMuted(accountId)) return { ok: false, reason: 'muted' };", ''],
  ['there is no limit on chat lines', 'apps/server/src/play/chat.ts', "if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'rate' };", ''],
  ['chat keeps direction-changing characters', 'apps/server/src/play/chat.ts', "raw.replace(UNWANTED, ' ')", 'raw'],
  ['emotes have no cooldown', 'apps/server/src/play/emotes.ts', "if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'cooldown' };", ''],
  ['an emote that is not on the list is accepted', 'apps/server/src/play/emotes.ts', "if (typeof kind !== 'string' || !(EMOTE_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'bad' };", ''],
  ['a running player is pulled back by a repeated ack', sim + 'prediction.ts', 'if (!at && !idle) {', 'if (false) {'],
  ['a moved chair leaves its seat behind', 'packages/shared/src/world/objects.ts', 'spot.pos.x = x + p.x; spot.pos.z = z + p.z;', ''],
  ['moved objects are not saved', sim + 'persist.ts', 'objects: movedObjects().map(', 'objects: [].map('],
  ['a restore forgets the moved objects', sim + 'persist.ts', 'if (o) setObjectPose(o, s.x, s.z, s.rot);', ''],
  ['the layout fingerprint follows a moved chair', 'packages/shared/src/protocol/convert.ts', 'if (locked && locked.spots ===', 'if (false && locked && locked.spots ==='],
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
    const r = spawnSync('npx', ['vitest', 'run', sim + 'scenario.test.ts', 'packages/shared/src/world/placement.test.ts', 'apps/server/src/play/object-actions.test.ts', sim + 'helper.test.ts', 'apps/server/src/world/world.test.ts', sim + 'takeover.test.ts', sim + 'driven.test.ts', sim + 'prediction.test.ts', 'packages/shared/src/layout/desks.test.ts', 'packages/shared/src/character/spec.test.ts', sim + 'schedule.test.ts', sim + 'live.test.ts', sim + 'roster.test.ts', sim + 'activities.test.ts', 'apps/server/src/net/broadcaster.test.ts', 'apps/server/src/net/mirror.test.ts', 'apps/server/src/employees/employee-store.test.ts', 'apps/server/src/employees/supabase-source.test.ts', 'apps/server/src/employees/roster-sync.test.ts', 'apps/server/src/play/employee-link.test.ts', 'apps/server/src/admin/admin.employees.test.ts', 'apps/server/src/play/chat.test.ts', 'apps/server/src/net/emote.gateway.test.ts', 'packages/shared/src/world/objects.test.ts'], { cwd: root, encoding: 'utf8', shell: true });
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
