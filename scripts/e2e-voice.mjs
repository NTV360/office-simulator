// Disposable two-browser LiveKit voice check using local accounts and fake microphones only.
// Run with: npm run e2e:voice
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { adminJson, openPage, sleep, walkTo } from '../tests/browser/site.mjs';

// E2E_VOICE_LAN=1 (npm run e2e:lan): the same check, but through the LAN HTTPS edge (Caddy) on spare ports: the certificate download and setup page
// over plain HTTP, the certificate chain verified against the downloaded root (and refused without it), and voice over wss:// through the edge.
const LAN = process.env.E2E_VOICE_LAN === '1';
const HTTP_PORT = Number(process.env.E2E_LAN_HTTP_PORT) || 18580;
const HTTPS_PORT = Number(process.env.E2E_LAN_HTTPS_PORT) || 18543;
// The page and the browsers talk to the edge, whose certificate comes from its own authority: the Node side of this script (account set-up) and the
// browser contexts do not verify it here. Whether the certificate really chains to the downloaded root is checked explicitly below, with the root.
if (LAN) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_VOICE_PORT) || 18084;
// Keep disposable verification away from the long-running LAN test stack's
// LiveKit ports; callers can still override the whole block explicitly.
const LIVEKIT_PORT = Number(process.env.E2E_VOICE_LIVEKIT_PORT) || 18180;
const TOKEN = 'e2e-voice-admin-token';
const KEY = 'e2e-voice-key';
const SECRET = 'e2e-voice-secret-not-production';
const devBase = `http://localhost:${PORT}`; // (the plain development endpoint: always on this host)
const base = LAN ? `https://localhost:${HTTPS_PORT}` : devBase;
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: LAN ? 'office-e2e-lan' : 'office-e2e-voice', WEB_PORT: String(PORT),
  ...(LAN ? { SITE_ADDRESS: 'localhost', VOICE_SITE_ADDRESS: 'voice.localhost', LAN_HTTP_PORT: String(HTTP_PORT), LAN_HTTPS_PORT: String(HTTPS_PORT), COOKIE_SECURE: 'true', LIVEKIT_NODE_IP: '127.0.0.1' } : {}),
  LIVEKIT_HTTP_PORT: String(LIVEKIT_PORT), LIVEKIT_RTC_TCP_PORT: String(LIVEKIT_PORT + 1),
  LIVEKIT_RTC_PORT_RANGE_START: String(LIVEKIT_PORT + 2), LIVEKIT_RTC_PORT_RANGE_END: String(LIVEKIT_PORT + 22),
  LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET, LIVEKIT_URL: LAN ? `wss://voice.localhost:${HTTPS_PORT}` : `ws://localhost:${LIVEKIT_PORT}`, LIVEKIT_API_URL: 'http://voice:7880',
  VOICE_ENABLED: 'true', VOICE_RANGE: '10', VOICE_ROOM: 'office-e2e', ADMIN_TOKEN: TOKEN,
  SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '',
  EMPLOYEE_IMPORT_MS: '86400000', ATTENDANCE_MS: '86400000', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', DATABASE_URL: 'postgres://office:office_dev_password@db:5432/office',
};
const compose = (...args) => spawnSync('docker', ['compose', '--profile', 'voice', ...(LAN ? ['--profile', 'lan'] : []), ...args], { cwd: root, env, encoding: 'utf8' });
const admin = (method, endpoint, body) => adminJson(base, method, endpoint, body);
/** One request to the edge by IP (no name lookup needed), as a client would: plain HTTP, or HTTPS with the given trust. */
const edgeGet = (secure, pathname, { host = 'localhost', ca } = {}) => new Promise((resolve, reject) => {
  const options = { host: '127.0.0.1', port: secure ? HTTPS_PORT : HTTP_PORT, path: pathname, headers: { host }, ...(secure ? { servername: host, rejectUnauthorized: true, ...(ca ? { ca } : {}) } : {}) };
  (secure ? https : http).get(options, res => { let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); }).on('error', reject);
});
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
async function waitFor(label, fn, timeout = 60000) {
  const end = Date.now() + timeout;
  for (;;) { const value = await fn().catch(() => null); if (value) return value; if (Date.now() >= end) throw new Error(`timed out waiting for ${label}`); await sleep(500); }
}
async function waitUp() {
  return waitFor('voice stack', async () => { const r = await fetch(`${devBase}/api/health`); const j = await r.json(); return j.status === 'ok' && j.db === 'ok' ? j : null; }, 120000);
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
  if (LAN) {
    // a new computer's first minutes: the setup page and the root certificate over plain HTTP, then HTTPS that chains to that certificate
    const root = await waitFor('the certificate download', async () => { const r = await edgeGet(false, '/ca.crt'); return r.status === 200 && r.body.includes('BEGIN CERTIFICATE') ? r : null; }, 60000);
    const cert = new X509Certificate(root.body);
    check('the root certificate can be downloaded over plain HTTP, and is a certificate authority', /x509-ca-cert/.test(root.headers['content-type'] ?? '') && cert.ca === true, `${root.headers['content-type']} ${cert.subject.replace(/\n/g, ' ')}`);
    const page = await edgeGet(false, '/');
    check('plain HTTP shows a setup page with the download and the install steps', page.status === 200 && /Download the certificate/.test(page.body) && /Trusted Root/.test(page.body));
    const moved = await edgeGet(false, '/api/health');
    check('any other plain HTTP address is sent to HTTPS', moved.status === 301 && String(moved.headers.location).startsWith(`https://localhost:${HTTPS_PORT}/`), `${moved.status} ${moved.headers.location}`);
    const port = await edgeGet(false, '/lan.json');
    check('the setup page can learn the HTTPS port', port.status === 200 && JSON.parse(port.body).httpsPort === HTTPS_PORT, port.body);
    const trusted = await edgeGet(true, '/api/health', { ca: root.body }).catch(e => ({ error: e.code ?? e.message }));
    check('HTTPS verifies against the downloaded root', trusted.status === 200, JSON.stringify(trusted.error ?? trusted.status));
    const voiceHost = await edgeGet(true, '/', { host: 'voice.localhost', ca: root.body }).catch(e => ({ error: e.code ?? e.message }));
    check('the voice address chains to the same root', voiceHost.status === 200, JSON.stringify(voiceHost.error ?? voiceHost.status));
    const untrusted = await edgeGet(true, '/api/health').then(r => r.status, e => e.code ?? e.message);
    check('HTTPS is refused by a computer that has not installed the certificate', typeof untrusted === 'string' && /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/.test(untrusted), String(untrusted));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  // Disable client prediction so range assertions use authoritative snapshots,
  // not a locally predicted position that the server has not accepted yet.
  const [a, b] = await Promise.all([openPage(browser, base, '?trace&nopredict', { login: 'voice_ana', ignoreHTTPSErrors: LAN }), openPage(browser, base, '?trace&nopredict', { login: 'voice_ben', ignoreHTTPSErrors: LAN })]);
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
    window.__sim.voiceFarRoute = route.map(q => ({ x: q.x, z: q.z })); // (the middle of the walk is measured on the way)
    return { id: seat.id, approach: seat.approach, walkTarget: window.__sim.voiceFarTarget, path: route.length };
  });
  if (!farSeat) throw new Error('could not select a distant target');
  console.log('voice far target:', JSON.stringify(farSeat));
  // Gradual attenuation: beside Ben the voice is loud, a few metres off it is quieter but still there, and past the range it is gone (below).
  // The playback gain the page applies is read from its audio elements (the same number it gives its Web Audio gain).
  const gainNow = async () => a.page.evaluate(() => {
    const ben = window.__sim.people.find(p => p.name === 'voice_ben'), self = window.__sim.player.person;
    const gains = window.__sim.net.voice?.diagnostics?.().audioGains ?? [];
    return { distance: Math.hypot(self.pos.x - ben.pos.x, self.pos.z - ben.pos.z), gain: gains.find(g => Number.isFinite(g)) ?? null };
  });
  const near = await waitFor('a playback gain beside Ben', async () => { const g = await gainNow(); return g.gain !== null && g.gain > 0 ? g : null; }, 15000).catch(() => null);
  // The sound itself, not only the gain the page applies: the peak of the signal reaching the speakers while the fake microphone beeps.
  const level = page => page.evaluate(() => window.__sim.net.voice.measureOutput(3000));
  const peak = o => Math.max(o?.left ?? 0, o?.right ?? 0);
  const nearOut = await level(a.page);
  const midTarget = await a.page.evaluate(() => {
    const ben = window.__sim.people.find(p => p.name === 'voice_ben'), self = window.__sim.player.person;
    const points = [{ x: self.pos.x, z: self.pos.z }, ...(window.__sim.voiceFarRoute ?? [])];
    const dist = q => Math.hypot(q.x - ben.pos.x, q.z - ben.pos.z);
    for (let i = 1; i < points.length; i++) {
      const d0 = dist(points[i - 1]), d1 = dist(points[i]);
      if (d0 < 5.5 && d1 >= 5.5) { const t = (5.5 - d0) / (d1 - d0); return window.__sim.voiceMidTarget = { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t }; }
    }
    return null;
  });
  if (midTarget) await walkTo(a.page, 'voiceMidTarget');
  const mid = midTarget ? await waitFor('a mid-range playback gain', async () => { const g = await gainNow(); return g.distance > 4 && g.distance < 8 && g.gain !== null && g.gain > 0 ? g : null; }, 15000).catch(() => null) : null;
  const midOut = mid ? await level(a.page) : null;
  console.log('voice output peaks (real signal): near', JSON.stringify(nearOut), 'mid', JSON.stringify(midOut));
  check('the signal itself is there beside the speaker, and clearly quieter further off but still audible',
    peak(nearOut) > .01 && peak(midOut) > .001 && peak(midOut) < .6 * peak(nearOut), JSON.stringify({ nearOut, midOut }));
  check('volume drops gradually with distance: loud beside you, quieter further off, not cut off', !!near && !!mid && near.gain > mid.gain && Math.abs(mid.gain - (1 - mid.distance / 10) ** 2) < .15, JSON.stringify({ near, mid, midTarget }));
  // Direction: facing Ben he is straight ahead; turn a quarter and he is at the listener's side (the page places the sound from the live view).
  const look = await a.page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ben = window.__sim.people.find(p => p.name === 'voice_ben'), self = window.__sim.player.person, ctl = window.__sim.ctl;
    const distance = Math.hypot(ben.pos.x - self.pos.x, ben.pos.z - self.pos.z);
    const face = Math.atan2(ben.pos.x - self.pos.x, ben.pos.z - self.pos.z);
    ctl.yaw = ctl.yawGoal = face; await wait(500);
    const facing = window.__sim.net.voice.diagnostics().audioPlacement[0];
    ctl.yaw = ctl.yawGoal = face + Math.PI / 2; await wait(500);
    const turned = window.__sim.net.voice.diagnostics().audioPlacement[0];
    const turnedOut = await window.__sim.net.voice.measureOutput(2500);
    ctl.yaw = ctl.yawGoal = face + Math.PI; await wait(500);
    const behind = window.__sim.net.voice.diagnostics().audioPlacement[0];
    ctl.yaw = ctl.yawGoal = face - Math.PI / 2; await wait(500);
    const leftOut = await window.__sim.net.voice.measureOutput(2500);
    return { distance, facing, turned, behind, turnedOut, leftOut };
  });
  const d = look.distance;
  console.log('voice ears (real signal): speaker on the right', JSON.stringify(look.turnedOut), 'on the left', JSON.stringify(look.leftOut));
  check('the sound reaches the ear on the speaker\'s side more: right ear when they are on your right, left ear when on your left',
    look.turnedOut.right > 1.3 * look.turnedOut.left && look.leftOut.left > 1.3 * look.leftOut.right, JSON.stringify({ turnedOut: look.turnedOut, leftOut: look.leftOut }));
  check('the voice comes from where the speaker is: ahead when you face them, to the side when you turn, behind when you turn away',
    !!look.facing && !!look.turned && !!look.behind && look.facing.ahead > .8 * d && Math.abs(look.facing.right) < .2 * d && look.turned.right > .8 * d && Math.abs(look.turned.ahead) < .2 * d && look.behind.ahead < -.8 * d, JSON.stringify(look));
  // Volume controls: the voices slider scales how loud the other player is to you; the mic slider is a gain on what you send (a processor on the track).
  const vol = await a.page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const diag = () => window.__sim.net.voice.diagnostics();
    const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    window.__sim.ctl.yaw = window.__sim.ctl.yawGoal = 0;
    await wait(300);
    const before = diag().audioGains[0];
    set('voiceVoicesVolume', 50); await wait(400);
    const half = diag().audioGains[0];
    set('voiceMicVolume', 40); await wait(400);
    const d = diag();
    const saved = { mic: localStorage.getItem('office.voice.mic'), voices: localStorage.getItem('office.voice.voices') };
    const labels = { mic: document.getElementById('voiceMicValue').textContent, voices: document.getElementById('voiceVoicesValue').textContent };
    set('voiceVoicesVolume', 100); set('voiceMicVolume', 100); await wait(400);
    return { before, half, mic: d.micVolume, micActive: d.micVolumeActive, voices: d.voiceVolume, saved, labels, restored: diag().audioGains[0] };
  });
  check('the voices slider halves how loud the other player is, and the mic slider reaches the microphone track (both saved, both shown)',
    vol.before > 0 && Math.abs(vol.half - vol.before / 2) < .02 && vol.mic === .4 && vol.micActive === true && vol.voices === .5 && vol.saved.mic === '0.4' && vol.saved.voices === '0.5' && vol.labels.mic === '40%' && vol.labels.voices === '50%' && Math.abs(vol.restored - vol.before) < .02, JSON.stringify(vol));
  // The sliders on the real signal: Ana's Voices slider halves what reaches her speakers; Ben's Mic slider at 40% makes him that much quieter to her.
  const setSlider = (page, id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  await a.page.evaluate(() => { window.__sim.ctl.yaw = window.__sim.ctl.yawGoal = 0; });
  await sleep(500);
  const baseLevel = peak(await level(a.page));
  await setSlider(a.page, 'voiceVoicesVolume', 50); await sleep(500);
  const voicesHalf = peak(await level(a.page));
  await setSlider(a.page, 'voiceVoicesVolume', 100); await setSlider(b.page, 'voiceMicVolume', 40); await sleep(800);
  const micLow = peak(await level(a.page));
  await setSlider(b.page, 'voiceMicVolume', 100); await sleep(500);
  console.log('voice slider peaks (real signal): base', baseLevel, 'voices 50%', voicesHalf, 'ben mic 40%', micLow);
  check('on the real signal: the Voices slider at 50% halves the level, and the other player\'s Mic slider at 40% lowers it to about 40%',
    baseLevel > .001 && Math.abs(voicesHalf / baseLevel - .5) < .15 && Math.abs(micLow / baseLevel - .4) < .15, JSON.stringify({ baseLevel, voicesHalf, micLow }));
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
  if (!out) console.log('range diagnostics:', JSON.stringify({ ana: await diagnostics(a.page), ben: await diagnostics(b.page), distance: await a.page.evaluate(() => { const s = window.__sim.player.person, q = window.__sim.people.find(p => p.name === 'voice_ben'); return Math.hypot(s.pos.x - q.pos.x, s.pos.z - q.pos.z); }) }));
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
