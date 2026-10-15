// Disposable two-browser LiveKit voice check using local accounts and fake microphones only.
// Run with: npm run e2e:voice
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminJson, openPage, sleep, walkTo } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_VOICE_PORT) || 18084;
// Keep disposable verification away from the long-running LAN test stack's
// LiveKit ports; callers can still override the whole block explicitly.
const LIVEKIT_PORT = Number(process.env.E2E_VOICE_LIVEKIT_PORT) || 18180;
const TOKEN = 'e2e-voice-admin-token';
const KEY = 'e2e-voice-key';
const SECRET = 'e2e-voice-secret-not-production';
const base = `http://localhost:${PORT}`;
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: 'office-e2e-voice', WEB_PORT: String(PORT),
  LIVEKIT_HTTP_PORT: String(LIVEKIT_PORT), LIVEKIT_RTC_TCP_PORT: String(LIVEKIT_PORT + 1),
  LIVEKIT_RTC_PORT_RANGE_START: String(LIVEKIT_PORT + 2), LIVEKIT_RTC_PORT_RANGE_END: String(LIVEKIT_PORT + 22),
  LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET, LIVEKIT_URL: `ws://localhost:${LIVEKIT_PORT}`, LIVEKIT_API_URL: 'http://voice:7880',
  VOICE_ENABLED: 'true', VOICE_RANGE: '10', VOICE_ROOM: 'office-e2e', ADMIN_TOKEN: TOKEN,
  SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '',
  EMPLOYEE_IMPORT_MS: '86400000', ATTENDANCE_MS: '86400000', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', DATABASE_URL: 'postgres://office:office_dev_password@db:5432/office',
};
const compose = (...args) => spawnSync('docker', ['compose', '--profile', 'voice', ...args], { cwd: root, env, encoding: 'utf8' });
const admin = (method, endpoint, body) => adminJson(base, method, endpoint, body);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
async function waitFor(label, fn, timeout = 60000) {
  const end = Date.now() + timeout;
  for (;;) { const value = await fn().catch(() => null); if (value) return value; if (Date.now() >= end) throw new Error(`timed out waiting for ${label}`); await sleep(500); }
}
async function waitUp() {
  return waitFor('voice stack', async () => { const r = await fetch(`${base}/api/health`); const j = await r.json(); return j.status === 'ok' && j.db === 'ok' ? j : null; }, 120000);
}
const joined = page => page.waitForFunction(() => window.__sim.net?.joined && window.__sim.player.person, null, { timeout: 60000 });
const diagnostics = page => page.evaluate(() => window.__sim.net.voice?.diagnostics?.() ?? null);
const waitVoice = (page, expected) => waitFor(`voice ${expected}`, async () => (await diagnostics(page))?.state === expected ? true : null, 30000).catch(async error => {
  const state = await diagnostics(page).catch(() => null);
  throw new Error(`${error.message}; diagnostics=${JSON.stringify(state)}`);
});
let browser;
try {
  console.log(`starting isolated voice stack on ${base} (LiveKit ${LIVEKIT_PORT}) ...`);
  compose('down');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error(`docker compose up failed:\n${up.stderr}`);
  await waitUp();
  await waitFor('LiveKit', async () => { try { return (await fetch(`http://localhost:${LIVEKIT_PORT}`)).status < 500; } catch { return null; } }, 30000);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  // Disable client prediction so range assertions use authoritative snapshots,
  // not a locally predicted position that the server has not accepted yet.
  const [a, b] = await Promise.all([openPage(browser, base, '?trace&nopredict', { login: 'voice_ana' }), openPage(browser, base, '?trace&nopredict', { login: 'voice_ben' })]);
  await Promise.all([a.context.grantPermissions(['microphone'], { origin: base }), b.context.grantPermissions(['microphone'], { origin: base }), joined(a.page), joined(b.page)]);
  check('two disposable accounts join gameplay', true);
  // The office opens in the overview camera; enter first-person before sending
  // movement keys because only an active play view consumes locomotion input.
  // The V shortcut is intentionally ignored while the overview has focus, so
  // use the same public camera transition exposed for browser verification.
  await Promise.all([
    a.page.evaluate(() => window.__sim.setView('fp')),
    b.page.evaluate(() => window.__sim.setView('fp'))
  ]);
  await Promise.all([
    a.page.waitForFunction(() => window.__sim.ctl.active && window.__sim.ctl.mode === 'fp'),
    b.page.waitForFunction(() => window.__sim.ctl.active && window.__sim.ctl.mode === 'fp')
  ]);
  await Promise.all([a.page.click('#voiceConnect'), b.page.click('#voiceConnect'), waitVoice(a.page, 'connected'), waitVoice(b.page, 'connected')]);
  const local = await Promise.all([diagnostics(a.page), diagnostics(b.page)]);
  check('both browsers connect and publish local audio', local.every(s => s?.localAudio.some(p => p.track && p.enabled)), JSON.stringify(local));
  await walkTo(a.page, "people.find(p => p.name === 'voice_ben').pos");
  const nearby = await waitFor('nearby audio', async () => { const s = await Promise.all([diagnostics(a.page), diagnostics(b.page)]); return s.every(x => x?.allowedParticipants?.length === 2 && x.audioElements >= 1 && x.remoteAudio.every(p => p.publications.some(pub => pub.subscribed && pub.track))) ? s : null; }, 45000).catch(() => null);
  check('nearby players receive each other audio', !!nearby, nearby ? JSON.stringify(nearby) : 'no reciprocal audio element');
  await a.page.click('#voiceMute'); await waitVoice(a.page, 'muted'); check('mute changes local state', (await diagnostics(a.page))?.muted === true);
  await a.page.click('#voiceMute'); await waitVoice(a.page, 'connected'); check('unmute restores connected state', (await diagnostics(a.page))?.muted === false);
  const farSeat = await a.page.evaluate(() => {
    const self = window.__sim.player.person;
    const ben = window.__sim.people.find(p => p.name === 'voice_ben');
    // Only choose a target with a real navigation route from the current
    // position. Decorative approach points may exist outside the walk graph.
    const seat = window.__sim.interactables.all().filter(s => s.approach && ben &&
      Math.hypot(s.approach.x - ben.pos.x, s.approach.z - ben.pos.z) > 12 &&
      window.__sim.findPath({ x: self.pos.x, z: self.pos.z }, s.approach))
      .sort((a, b) => Math.hypot(b.approach.x - ben.pos.x, b.approach.z - ben.pos.z) - Math.hypot(a.approach.x - ben.pos.x, a.approach.z - ben.pos.z))[0];
    if (!seat) return null;
    const route = window.__sim.findPath({ x: self.pos.x, z: self.pos.z }, seat.approach);
    // The final approach point can be inside the furniture and therefore is
    // not a reliable locomotion target. Walk to the last graph waypoint
    // instead; it is still beyond the voice range and is guaranteed to be on
    // the traversable route returned by the shared navigator.
    const walkTarget = route?.slice(0, -1).find(point =>
      Math.hypot(point.x - ben.pos.x, point.z - ben.pos.z) > 10.5
    );
    if (!walkTarget) return null;
    window.__sim.voiceFarTarget = { x: walkTarget.x, z: walkTarget.z };
    return { id: seat.id, approach: seat.approach, walkTarget: window.__sim.voiceFarTarget, path: route.length };
  });
  if (!farSeat) throw new Error('could not select a distant target');
  console.log('voice far target:', JSON.stringify(farSeat));
  const walked = await walkTo(a.page, 'voiceFarTarget');
  console.log('voice far walk result:', JSON.stringify(await a.page.evaluate(walked => ({
    walked,
    target: window.__sim.voiceFarTarget,
    self: window.__sim.player.person?.pos,
    ben: window.__sim.people.find(p => p.name === 'voice_ben')?.pos,
    route: window.__sim.player.person ? window.__sim.findPath(window.__sim.player.person.pos, window.__sim.voiceFarTarget) : null,
    active: window.__sim.ctl.active,
    mode: window.__sim.ctl.mode,
    keys: [...window.__sim.ctl ? [] : []]
  }), walked)));
  const farState = await waitFor('actor leaving voice range', async () => a.page.evaluate(() => {
    const self = window.__sim.player.person;
    const ben = window.__sim.people.find(p => p.name === 'voice_ben');
    if (!self || !ben) return null;
    const distance = Math.hypot(self.pos.x - ben.pos.x, self.pos.z - ben.pos.z);
    return distance > 10 ? { distance, self: self.pos, ben: ben.pos } : null;
  }), 15000).catch(() => null);
  console.log(`voice far actor state: ${JSON.stringify(farState)}`);
  const out = await waitFor('range revocation', async () => { const s = await Promise.all([diagnostics(a.page), diagnostics(b.page)]); return s.every(x => x?.allowedParticipants?.length <= 1 && x.audioElements === 0 && x.remoteAudio.every(p => p.publications.every(pub => !pub.subscribed && !pub.track))) ? s : null; }, 45000).catch(() => null);
  check('moving beyond range revokes subscriptions', !!out, out ? JSON.stringify(out) : 'subscriptions remained');
  await walkTo(a.page, "people.find(p => p.name === 'voice_ben').pos");
  const back = await waitFor('range restoration', async () => { const s = await Promise.all([diagnostics(a.page), diagnostics(b.page)]); return s.every(x => x?.allowedParticipants?.length === 2 && x.audioElements >= 1) ? s : null; }, 45000).catch(() => null);
  check('returning within range restores subscriptions', !!back, back ? JSON.stringify(back) : 'subscriptions did not return');
  await a.page.click('#accountBox button:last-child'); await a.page.waitForSelector('#loginScreen', { timeout: 15000 });
  const loggedOut = await waitFor('logout cleanup', async () => { const s = await diagnostics(a.page); return s?.connected === false && s.audioElements === 0 && ['disconnected', 'session-ended'].includes(s.state) ? s : null; }, 15000).catch(() => null);
  check('logout disconnects voice and removes audio', !!loggedOut, loggedOut ? JSON.stringify(loggedOut) : 'voice state was not cleaned');
  check('logout rejects a voice token', (await a.page.evaluate(async () => (await fetch('/api/voice/token', { method: 'POST' })).status)) === 401);
  const errors = [...a.errors, ...b.errors].filter(e => !/WebSocket|502|503|net::|Failed to load resource|401|403/i.test(e));
  check('no unexpected browser errors', errors.length === 0, errors[0] ?? '');
} catch (error) { check('voice run completed', false, error.stack ?? error.message); }
finally {
  if (failures) {
    const logs = compose('logs', '--no-color', 'server', 'voice');
    const relevant = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`.split('\n').filter(line => /UpdateSubscriptions|VoiceAcl|ListParticipants/.test(line)).join('\n');
    if (relevant) console.error(relevant);
  }
  await browser?.close();
  compose('down');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
