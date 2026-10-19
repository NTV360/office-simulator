// End to end: the body-part display and treating a chosen body part. Starts its own copy of the whole stack and puts two players in it (two real
// browsers). Ben takes a bandage from the medkit and punches Ana. Ana's HUD figure and Ben's view of Ana's 3D character must show the hurt part
// (and only that), Ben presses "Inspect Ana", sees her figure, clicks a body part and treats exactly that part; the colour then goes.
//   npm run e2e:limbs
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminJson, openPage, sleep, walkTo } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18086;
const TOKEN = 'e2e-limbs-admin-password';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-limbs', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', PHYSICS: 'on', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', LIVEKIT_API_KEY: 'e2e-disabled', LIVEKIT_API_SECRET: 'e2e-disabled-secret' };
const base = `http://localhost:${PORT}`;
const outDir = path.join(root, 'tests/browser/out');
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(300); } };
async function waitUp() {
  for (let i = 0; i < 90; i++) {
    try { const j = await (await fetch(base + '/api/health')).json(); if (j.status === 'ok' && j.db === 'ok') return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('the stack did not come up');
}
const joined = page => page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 60000 });
const fp = async page => { if (await page.evaluate(() => window.__sim.ctl.mode) !== 'fp') { await page.keyboard.press('v'); await sleep(400); } };
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) }).catch(() => {});
const healthOf = (page, name) => page.evaluate(n => { const p = window.__sim.people.find(x => x.name === n); return p && { ...p.mechanics.health }; }, name);
const sum = h => Object.values(h).reduce((a, b) => a + b, 0);
const MAX = { head: 40, body: 80, leftArm: 35, rightArm: 35, leftLeg: 45, rightLeg: 45 };
const LIMBS = Object.keys(MAX);
/** The colour level the page should show (the same rule as player/limb-health.js, written out again so a change to one is noticed). */
const levelOf = (limb, hp) => hp <= 0 ? 'out' : hp >= MAX[limb] ? 'ok' : hp / MAX[limb] > .35 ? 'hurt' : 'critical';
const figureLevels = (page, fig) => page.evaluate(f => {
  const root = document.querySelector(`#limbHud [data-fig="${f}"]`);
  if (!root || root.hidden) return null;
  return Object.fromEntries([...root.querySelectorAll('[data-limb]')].map(n => [n.dataset.limb, n.dataset.level]));
}, fig);
/** What the 3D character of `name` shows, as seen on this page: { limb: level or 'ok' when its shell is hidden }. */
const shellLevels = (page, name) => page.evaluate(n => {
  const p = window.__sim.people.find(x => x.name === n), s = p?.body.shells;
  if (!s) return null;
  const color = { e8b84a: 'hurt', d6402a: 'critical', '6b7075': 'out' };
  return Object.fromEntries(Object.entries(s).map(([k, m]) => [k, m.visible ? color[m.material.color.getHexString()] ?? '?' : 'ok']));
}, name);
const same = (a, b) => !!a && !!b && LIMBS.every(l => a[l] === b[l]);
const clickDom = (page, selector) => page.evaluate(sel => { const n = document.querySelector(sel); if (!n) return false; n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, selector);

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-limbs) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const [A, B] = [await openPage(browser, base, '?trace', { login: 'limb_ana' }), await openPage(browser, base, '?trace', { login: 'limb_ben' })];
  await Promise.all([A, B].map(x => joined(x.page)));
  const medkit = await A.page.evaluate(() => { const o = window.__sim.objects.all().find(x => x.type === 'medkit-box'); return o && { index: o.index, x: o.x, y: o.y, z: o.z }; });
  check('the office has a medkit', !!medkit);

  // ---- 1. nobody is hurt: every figure is green and no 3D part is coloured
  await Promise.all([A, B].map(x => fp(x.page)));
  await sleep(600);
  const fresh = await until(async () => { const f = await figureLevels(A.page, 'self'); return f && LIMBS.every(l => f[l] === 'ok') ? f : null; }, 8000);
  check('unhurt: Ana\'s own figure is all green', !!fresh, JSON.stringify(fresh));
  const freshShells = await shellLevels(B.page, 'limb_ana');
  check('unhurt: Ana\'s 3D character shows no colour on Ben\'s page', !!freshShells && LIMBS.every(l => freshShells[l] === 'ok'), JSON.stringify(freshShells));
  check('unhurt: no "Inspect" button with nobody near', await B.page.evaluate(() => document.getElementById('fpInspect').hidden));

  // ---- 2. Ben takes a bandage from the medkit
  await walkTo(B.page, "interactables.of('counter')[0].approach");
  await fp(B.page);
  let aimed = false;
  for (const dp of [0, .08, -.08, .16, -.16, .24, .32, -.24, .4]) {
    for (const dy of [0, .06, -.06, .12, -.12]) {
      await B.page.evaluate(([m, dp, dy]) => {
        const p = window.__sim.player.person, dx = m.x - p.pos.x, dz = m.z - p.pos.z;
        window.__sim.ctl.yaw = Math.atan2(dx, dz) + dy; window.__sim.ctl.pitch = Math.atan2(m.y + .06 - 1.5, Math.hypot(dx, dz)) + dp;
      }, [medkit, dp, dy]);
      if (await until(() => B.page.evaluate(i => window.__sim.medkitPick === i ? true : null, medkit.index), 700)) { aimed = true; break; }
    }
    if (aimed) break;
  }
  check('Ben looks at the medkit', aimed);
  await B.page.keyboard.press('e');
  await until(() => B.page.evaluate(() => { const p = document.getElementById('medboxPanel'); return p && !p.hidden ? true : null; }), 8000);
  await B.page.click('#medboxGrid .medbox-item.bandage');
  const got = await until(() => B.page.evaluate(() => window.__sim.player.person.inventory.items.some(i => i.type === 'bandage') ? true : null), 8000);
  check('Ben has a bandage', !!got);
  await B.page.click('#medboxClose');

  // ---- 3. Ben punches Ana until she is hurt in some part
  const posOf = (page, name) => page.evaluate(n => { const p = window.__sim.people.find(x => x.name === n); return p && { x: p.pos.x, z: p.pos.z }; }, name);
  const faceAndClose = async (page, name, within) => {
    const t = await posOf(page, name); if (!t) return Infinity;
    const d = await page.evaluate(([x, z]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = 0; return Math.hypot(x - p.pos.x, z - p.pos.z); }, [t.x, t.z]);
    if (d > within) { await page.keyboard.down('w'); await sleep(Math.min(900, (d - within + .15) * 600)); await page.keyboard.up('w'); }
    return d;
  };
  await walkTo(B.page, "(() => { const a = people.find(p => p.name === 'limb_ana'); return { x: a.pos.x + .3, z: a.pos.z + .45 }; })()");
  await fp(B.page);
  const hurtOnce = async () => {
    const hits = await until(async () => {
      if (await faceAndClose(B.page, 'limb_ana', .8) > .8) return null;
      const before = sum(await healthOf(A.page, 'limb_ana'));
      await B.page.keyboard.down('p'); await sleep(700); await B.page.keyboard.up('p');
      await sleep(1500);
      return sum(await healthOf(A.page, 'limb_ana')) < before ? true : null;
    }, 40000);
    await sleep(2500); // (the knockback ends)
    return !!hits;
  };
  check('Ben\'s punch hurt Ana', await hurtOnce());
  // (the server only ever damages the body today, so that is the part hurt here; every other part is covered by step 8)
  const ana = await healthOf(A.page, 'limb_ana');
  const hurtParts = LIMBS.filter(l => ana[l] < MAX[l]);
  check('Ana has a hurt part', hurtParts.length > 0, JSON.stringify(ana));

  // ---- 4. the figure on Ana's screen, and the colours on her character on Ben's screen, show those parts and no others
  const expected = Object.fromEntries(LIMBS.map(l => [l, levelOf(l, ana[l])]));
  const self = await until(async () => { const f = await figureLevels(A.page, 'self'); return same(f, expected) ? f : null; }, 8000);
  check('Ana\'s own figure shows exactly the hurt parts', !!self, `want ${JSON.stringify(expected)} got ${JSON.stringify(await figureLevels(A.page, 'self'))}`);
  const seen = await until(async () => { const s = await shellLevels(B.page, 'limb_ana'); return same(s, expected) ? s : null; }, 8000);
  check('Ana\'s 3D character is coloured on exactly those parts (Ben\'s view)', !!seen, `want ${JSON.stringify(expected)} got ${JSON.stringify(await shellLevels(B.page, 'limb_ana'))}`);
  await shot(A.page, 'limbs-1-ana-hud.png');

  // ---- 5. Ben picks the bandage, steps up to Ana: the Inspect button appears
  await B.page.keyboard.press('1');
  let near = Infinity;
  for (let i = 0; i < 12 && near > 1.0; i++) near = await faceAndClose(B.page, 'limb_ana', 1.0);
  near = await faceAndClose(B.page, 'limb_ana', 1.0);
  check('Ben stands within reach of Ana', near <= 1.2, near.toFixed(2));
  const btn = await until(() => B.page.evaluate(() => { const b = document.getElementById('fpInspect'); return !b.hidden && /Inspect limb_ana/.test(b.textContent) ? b.textContent : null; }), 6000);
  check('the page offers "Inspect limb_ana"', !!btn, btn ?? '');
  check('Ben\'s patient figure is not open before he inspects', (await figureLevels(B.page, 'patient')) === null || !(await B.page.evaluate(() => document.querySelector('#limbHud [data-fig="patient"] .limb-tools')?.hidden === false)));
  await clickDom(B.page, '#fpInspect');
  const patient = await until(async () => { const f = await figureLevels(B.page, 'patient'); return same(f, expected) ? f : null; }, 6000);
  check('after Inspect, Ben sees Ana\'s figure with the same colours', !!patient, JSON.stringify(await figureLevels(B.page, 'patient')));
  check('and the Treat / Done buttons', await B.page.evaluate(() => document.querySelector('#limbHud [data-fig="patient"] .limb-tools')?.hidden === false));
  await shot(B.page, 'limbs-2-ben-inspecting.png');

  // ---- 6. Ben clicks one body part (the least hurt, so it is not what the care would pick by itself) and treats it
  const choice = [...hurtParts].sort((a, b) => (MAX[a] - ana[a]) - (MAX[b] - ana[b]))[0];

  await clickDom(B.page, `#limbHud [data-fig="patient"] [data-limb="${choice}"]`);
  const marked = await until(() => B.page.evaluate(l => document.querySelector(`#limbHud [data-fig="patient"] [data-limb="${l}"]`)?.classList.contains('chosen') ? true : null, choice), 4000);
  check(`the clicked part (${choice}) is marked as the one to treat`, !!marked);
  const hint = await B.page.evaluate(() => document.querySelector('#limbHud [data-fig="patient"] .limb-pick')?.textContent);
  check('the figure says which part will be treated', /Treat:/.test(hint ?? ''), hint ?? '');
  await shot(B.page, 'limbs-3-ben-chosen.png');
  const before = await healthOf(A.page, 'limb_ana');
  await B.page.evaluate(() => { const t = document.querySelector('#limbHud [data-act="treat"]'); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  const bar = await until(() => B.page.evaluate(() => { const b = document.getElementById('careBar'); return b && !b.hidden ? true : null; }), 5000);
  check('Treat starts the care bar', !!bar);
  await sleep(3800);
  await B.page.evaluate(() => { const t = document.querySelector('#limbHud [data-act="treat"]'); t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
  const after = await until(async () => { const h = await healthOf(A.page, 'limb_ana'); return h && h[choice] > before[choice] ? h : null; }, 8000);
  check(`the chosen part (${choice}) healed`, !!after, `${before[choice]} -> ${after?.[choice]}`);
  const others = hurtParts.filter(l => l !== choice);
  check('the other hurt parts were left alone', !!after && others.every(l => after[l] === before[l]), JSON.stringify(others.map(l => [l, before[l], after?.[l]])));
  check('the bandage was used up', await B.page.evaluate(() => !window.__sim.player.person.inventory.items.some(i => i.type === 'bandage')));

  // ---- 7. the colours follow: Ana's figure and her 3D character both show the new state
  const expected2 = Object.fromEntries(LIMBS.map(l => [l, levelOf(l, after?.[l] ?? 0)]));
  const self2 = await until(async () => same(await figureLevels(A.page, 'self'), expected2) ? true : null, 8000);
  check('Ana\'s figure updated after the treatment', !!self2, JSON.stringify(await figureLevels(A.page, 'self')));
  const seen2 = await until(async () => same(await shellLevels(B.page, 'limb_ana'), expected2) ? true : null, 8000);
  check('so did her 3D character', !!seen2, JSON.stringify(await shellLevels(B.page, 'limb_ana')));
  await clickDom(B.page, '#limbHud [data-act="close"]');
  const closed = await until(() => B.page.evaluate(() => { const f = document.querySelector('#limbHud [data-fig="patient"]'); return !f || f.hidden || f.querySelector('.limb-tools')?.hidden ? true : null; }), 4000);
  check('Done closes the inspection', !!closed);
  await shot(B.page, 'limbs-4-after.png');

  // ---- 7b. aim-based hits: Ben punches Ana looking at different heights and each lands on the part he looks at (the server decides from his look)
  const punchAimed = async (pitch, label, wantRe) => {
    const before = await healthOf(A.page, 'limb_ana');
    const flashes0 = await A.page.evaluate(() => window.__sim.hitFx?.flashes ?? 0);
    let after = null;
    for (let tries = 0; tries < 6 && !after; tries++) {
      for (let i = 0; i < 10 && (await faceAndClose(B.page, 'limb_ana', .8)) > .8; i++) { /* step closer */ }
      await B.page.evaluate(p => { window.__sim.ctl.pitch = p; }, pitch);
      await B.page.keyboard.down('p'); await sleep(500); await B.page.keyboard.up('p');
      await sleep(1600); // (the hit, the knockback and the cool-down)
      const h = await healthOf(A.page, 'limb_ana');
      if (LIMBS.some(l => h[l] < before[l])) after = h;
    }
    const hurtNow = after ? LIMBS.filter(l => after[l] < before[l]) : [];
    check(`looking ${label}, the punch hurt only ${wantRe}`, hurtNow.length === 1 && new RegExp(`^(${wantRe})$`).test(hurtNow[0]), JSON.stringify(hurtNow));
    const flashes1 = await A.page.evaluate(() => window.__sim.hitFx?.flashes ?? 0);
    check('and the screen of the one hit flashed red for it', flashes1 > flashes0, `${flashes0} -> ${flashes1}`);
    if (hurtNow.length === 1) {
      const seen = await until(async () => { const s = await shellLevels(B.page, 'limb_ana'); return s && s[hurtNow[0]] !== 'ok' ? s : null; }, 8000);
      check(`and that part is coloured on her 3D character (${hurtNow[0]})`, !!seen, JSON.stringify(seen));
    }
    await sleep(2500);
  };
  await punchAimed(0, 'straight ahead', 'head');
  await shot(B.page, 'limbs-6-aim-head.png');
  await punchAimed(-.35, 'down at her chest', 'body');
  await punchAimed(-1.05, 'down at her feet', 'leftLeg|rightLeg');
  await shot(B.page, 'limbs-7-aim-legs.png');

  // ---- 7c. what Ana is told about her own state, at the bottom of her screen (her health is faked on her own page to get broken parts quickly)
  await A.page.evaluate(() => {
    const p = window.__sim.player.person, real = p.mechanics;
    window.__realMech = real;
    window.__fakeHealth = h => Object.defineProperty(p, 'mechanics', { configurable: true, get: () => ({ ...real, health: h }), set() {} });
    window.__unfake = () => Object.defineProperty(p, 'mechanics', { configurable: true, writable: true, value: real });
  });
  const condition = () => A.page.evaluate(() => { const b = document.getElementById('fpCondition'); return b && !b.hidden ? { text: b.textContent, tone: b.dataset.tone, glow: document.getElementById('lowVignette').dataset.tone ?? null } : null; });
  const say = async (health, want) => { await A.page.evaluate(h => window.__fakeHealth(h), health); return until(async () => { const c = await condition(); return c && c.text === want.text && c.tone === want.tone ? c : null; }, 6000); };
  check('an almost broken arm: "Your left arm is almost broken. Treat it immediately."',
    !!await say({ head: 40, body: 80, leftArm: 5, rightArm: 35, leftLeg: 45, rightLeg: 45 }, { text: 'Your left arm is almost broken. Treat it immediately.', tone: 'warn' }), JSON.stringify(await condition()));
  check('and the screen edges beat red while it is so', (await condition())?.glow === 'warn');
  check('a broken leg says what it means and what is almost broken',
    !!await say({ head: 40, body: 80, leftArm: 5, rightArm: 35, leftLeg: 45, rightLeg: 0 }, { text: "Your right leg is broken, you can't walk. Your left arm is almost broken. Treat them immediately.", tone: 'broken' }), JSON.stringify(await condition()));
  await shot(A.page, 'limbs-8-condition-broken.png');
  check('most of the body failing is called out as a whole',
    !!await say({ head: 5, body: 10, leftArm: 4, rightArm: 35, leftLeg: 45, rightLeg: 6 }, { text: 'Your whole body is severely damaged. Get treatment now.', tone: 'severe' }), JSON.stringify(await condition()));
  // (freeze the heartbeat at its peak, so the picture shows the red edges the way they look at their strongest)
  await A.page.evaluate(() => { for (const an of document.getElementById('lowVignette').getAnimations()) { an.pause(); an.currentTime = 140; } });
  await sleep(300);
  await shot(A.page, 'limbs-9-condition-severe.png');
  await A.page.evaluate(() => { for (const an of document.getElementById('lowVignette').getAnimations()) { an.currentTime = 0; an.play(); } });
  // a fresh hit on her own screen: healthy, then a big loss in one go; the flash is frozen a moment in, so the picture shows it
  await A.page.evaluate(() => window.__fakeHealth({ head: 40, body: 80, leftArm: 35, rightArm: 35, leftLeg: 45, rightLeg: 45 }));
  await sleep(800);
  // (inside the page, frame by frame, so the flash is caught the moment it starts and held there)
  const strength = await A.page.evaluate(async () => {
    const h = window.__sim.hitFx, n = h.flashes;
    window.__fakeHealth({ head: 40, body: 80, leftArm: 35, rightArm: 35, leftLeg: 45, rightLeg: 0 });
    for (let i = 0; i < 400 && h.flashes === n; i++) await new Promise(r => requestAnimationFrame(r));
    if (h.flashes === n || !h.lastAnimation) return -1;
    h.lastAnimation.pause(); h.lastAnimation.currentTime = 110;
    return h.lastStrength;
  });
  check('a leg breaking in one hit gives a strong flash', strength >= .9, String(strength));
  await sleep(250);
  await shot(A.page, 'limbs-10-hit-flash.png');
  await A.page.evaluate(() => window.__unfake());
  const gone = await until(async () => (await condition()) === null ? true : null, 6000);
  check('with the real health back (all well) the message and the red edges go away', !!gone && await A.page.evaluate(() => document.getElementById('lowVignette').dataset.tone === undefined));

  // ---- 8. every part at once (the server only damages the body today, so this one is fed to Ben's page): each of the six 3D shells and the figure
  // take the right colour, on the right part of the character. Look at tests/browser/out/limbs-5-all-parts.png to see them on the body.
  const fake = { head: 20, body: 30, leftArm: 5, rightArm: 0, leftLeg: 30, rightLeg: 44 };
  await B.page.evaluate(h => {
    const p = window.__sim.people.find(x => x.name === 'limb_ana'), real = p.mechanics;
    Object.defineProperty(p, 'mechanics', { configurable: true, get: () => ({ ...real, health: h }), set() {} }); // (snapshots cannot overwrite it)
  }, fake);
  // Ana turns to face Ben, so her front is in view
  await A.page.evaluate(([x, z]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = 0; }, await B.page.evaluate(() => { const p = window.__sim.player.person; return [p.pos.x, p.pos.z]; }));
  await sleep(1200);
  // step back from Ana (still looking at her) so her whole body is in view
  const ap = await posOf(B.page, 'limb_ana');
  await B.page.evaluate(([x, z]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = .12; }, [ap.x, ap.z]);
  await B.page.keyboard.down('s'); await sleep(1500); await B.page.keyboard.up('s');
  await B.page.evaluate(([x, z]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = .1; }, [ap.x, ap.z]);
  const wanted = Object.fromEntries(LIMBS.map(l => [l, levelOf(l, fake[l])]));
  const all = await until(async () => same(await shellLevels(B.page, 'limb_ana'), wanted) ? true : null, 8000);
  check('all six 3D shells take their colours', !!all, `want ${JSON.stringify(wanted)} got ${JSON.stringify(await shellLevels(B.page, 'limb_ana'))}`);
  await sleep(800);
  await shot(B.page, 'limbs-5-all-parts.png');

  // ---- 9. the game keeps running when the person under the crosshair is mid-chat with somebody who is gone (a player took over their partner's staff
  // character): the status line used to throw inside the frame loop and the whole page froze. Ana is made to look like that on Ben's page.
  await B.page.evaluate(() => {
    const p = window.__sim.people.find(x => x.name === 'limb_ana'), real = { state: p.state, task: p.task };
    window.__chatFake = () => { Object.defineProperty(p, 'state', { configurable: true, get: () => 'doing', set() {} }); Object.defineProperty(p, 'task', { configurable: true, get: () => ({ kind: 'chat', cat: 'chat', anim: 'talkStand', spot: { kind: 'chat', shared: false, place: 'the kitchen', pos: { x: 0, y: 0, z: 0 }, approach: { x: 0, y: 0, z: 0 }, face: 0 } }), set() {} }); };
    window.__chatReal = () => { delete p.state; delete p.task; p.state = real.state; p.task = real.task; };
    window.__chatFake();
  });
  const looked = await until(async () => {
    for (const pitch of [.1, 0, -.1, -.2, .2]) {
      await B.page.evaluate(([x, z, pitch]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = pitch; }, [(await posOf(B.page, 'limb_ana')).x, (await posOf(B.page, 'limb_ana')).z, pitch]);
      await sleep(450);
      const text = await B.page.evaluate(() => document.getElementById('fpLook')?.textContent ?? '');
      if (/Chatting with someone/.test(text)) return text;
    }
    return null;
  }, 15000);
  check('with the chat partner gone the crosshair line says "Chatting with someone" instead of throwing', !!looked, looked ?? 'no such text');
  const t0 = await B.page.evaluate(() => window.__sim.player.person.animT); await sleep(1500);
  const t1 = await B.page.evaluate(() => window.__sim.player.person.animT);
  check('and the frame loop is still running (the page did not freeze)', t1 > t0, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
  await B.page.evaluate(() => window.__chatReal());

  // ---- 10. turn all the way round in the real office (79 staff doing all sorts) twice: nothing may throw and the page keeps running
  for (let i = 0; i < 24; i++) {
    await B.page.evaluate(i => { window.__sim.ctl.yaw = i * (Math.PI / 6); window.__sim.ctl.pitch = i % 2 ? -.15 : .05; }, i);
    await sleep(350);
  }
  const t2 = await B.page.evaluate(() => window.__sim.player.person.animT); await sleep(800);
  check('turning round in the busy office, the page keeps running', (await B.page.evaluate(() => window.__sim.player.person.animT)) > t2);

  const errors = [...A.errors, ...B.errors].filter(e => !/401|403|Failed to load resource|WebSocket connection|WebSocket is already in CLOSING or CLOSED state|502/.test(e));
  check('no unexpected console errors in the browsers', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (err) {
  console.error('\nTHE SCRIPT FAILED:', err);
  failures++;
} finally {
  if (browser) await browser.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
