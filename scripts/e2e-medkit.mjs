// End to end: the medkit on the kitchen counter and timed care. Starts its own copy of the whole stack and puts two players in it (two real
// browsers). One opens the medkit with E, sees the grid of what is in it, takes a bandage and a first-aid box, and watches the box fill up again.
// The other punches them; they pick the bandage on the hotbar and hold E: the bar fills, the limb heals only after 3 seconds and the bandage is
// used up, while letting go early heals nothing and keeps it.
//   npm run e2e:medkit
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminJson, openPage, sleep, walkTo } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18085;
const TOKEN = 'e2e-medkit-admin-password';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-medkit', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', PHYSICS: 'on', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', LIVEKIT_API_KEY: 'e2e-disabled', LIVEKIT_API_SECRET: 'e2e-disabled-secret' };
const base = `http://localhost:${PORT}`;
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
/** Turn the view to look at a point (x, y, z), from eye height. */
const lookAtPoint = (page, x, y, z) => page.evaluate(([x, y, z]) => {
  const p = window.__sim.player.person, dx = x - p.pos.x, dz = z - p.pos.z;
  window.__sim.ctl.yaw = Math.atan2(dx, dz); window.__sim.ctl.pitch = Math.atan2(y - 1.5, Math.hypot(dx, dz));
}, [x, y, z]);
/** Sweep the view about the medkit until the page says it is the thing E would open (a person's eye height depends on their body). */
const aimAtMedkit = async (page, m) => {
  for (const dp of [0, .08, -.08, .16, -.16, .24, .32, -.24, .4]) for (const dy of [0, .06, -.06, .12, -.12]) {
    await page.evaluate(([m, dp, dy]) => {
      const p = window.__sim.player.person, dx = m.x - p.pos.x, dz = m.z - p.pos.z;
      window.__sim.ctl.yaw = Math.atan2(dx, dz) + dy; window.__sim.ctl.pitch = Math.atan2(m.y + .06 - 1.5, Math.hypot(dx, dz)) + dp;
    }, [m, dp, dy]);
    if (await until(() => page.evaluate(i => window.__sim.medkitPick === i ? true : null, m.index), 700)) return true;
  }
  return false;
};
const myItems = page => page.evaluate(() => (window.__sim.player.person.inventory?.items ?? []).map(i => ({ id: i.id, type: i.type, x: i.x, y: i.y, rotation: i.rotation })));
const myHealth = page => page.evaluate(() => ({ ...window.__sim.player.person.mechanics.health }));
const FULL = 280; // (a person's health in total: head 40, body 80, each arm 35, each leg 45)
const sum = h => Object.values(h).reduce((a, b) => a + b, 0);
const count = (page, cls) => page.evaluate(c => document.querySelectorAll(`#medboxGrid .medbox-item.${c}`).length, cls);
const notices = page => page.evaluate(() => [...document.querySelectorAll('.chat-line')].map(e => e.textContent));

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-medkit) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const [A, B] = [await openPage(browser, base, '?trace', { login: 'med_ana' }), await openPage(browser, base, '?trace', { login: 'med_ben' })];
  await Promise.all([A, B].map(x => joined(x.page)));
  const medkit = await A.page.evaluate(() => { const o = window.__sim.objects.all().find(x => x.type === 'medkit-box'); return o && { index: o.index, x: o.x, y: o.y, z: o.z }; });
  check('the office has a medkit on the kitchen counter', !!medkit && medkit.z > 17 && medkit.z < 19, JSON.stringify(medkit));

  // ---- 1. Ana walks to the counter, looks at the medkit and presses E: the menu shows the grid
  await walkTo(A.page, "interactables.of('counter')[0].approach");
  await fp(A.page);
  const aimed = await aimAtMedkit(A.page, medkit);
  const prompt = await until(() => A.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /medkit/i.test(b.textContent) ? b.textContent : null; }), 8000);
  check('standing at the counter and looking at it, the page offers to open the medkit', aimed && !!prompt, prompt ?? 'no prompt');
  if (!prompt) console.log('medkit diagnostics:', JSON.stringify(await A.page.evaluate(m => {
    const p = window.__sim.player.person, b = document.getElementById('fpObj');
    return { pos: { x: p.pos.x, z: p.pos.z }, dist: Math.hypot(p.pos.x - m.x, p.pos.z - m.z), yaw: window.__sim.ctl.yaw, pitch: window.__sim.ctl.pitch, mode: window.__sim.ctl.mode, active: window.__sim.ctl.active, sitting: !!window.__sim.player.sitting, pick: window.__sim.objectPick, medkitPick: window.__sim.medkitPick, medkitFar: window.__sim.medkitFar, rayHit: window.__sim.rayHit, drawn: window.__sim.drawnInfo?.(m.index), prompt: b?.textContent, hidden: b?.hidden };
  }, medkit)), 'errors:', JSON.stringify(A.errors.slice(0, 3)));
  await A.page.keyboard.press('e');
  const shown = await until(() => A.page.evaluate(() => { const p = document.getElementById('medboxPanel'); return p && !p.hidden ? true : null; }), 8000);
  check('E opens the medbox menu', !!shown);
  const full = await until(async () => (await count(A.page, 'bandage')) === 10 && (await count(A.page, 'first-aid-box')) === 5 ? true : null, 8000);
  check('it shows 10 bandages and 5 first-aid boxes', !!full, `${await count(A.page, 'bandage')} / ${await count(A.page, 'first-aid-box')}`);

  // ---- 2. take one of each; they are in the inventory (1 cell and 2 cells), the box has one less of each, and it fills up again
  await A.page.click('#medboxGrid .medbox-item.bandage');
  await A.page.click('#medboxGrid .medbox-item.first-aid-box');
  const got = await until(async () => { const i = await myItems(A.page); return i.some(x => x.type === 'bandage') && i.some(x => x.type === 'first-aid-box') ? i : null; }, 8000);
  check('a bandage and a first-aid box are now in Ana\'s inventory', !!got, JSON.stringify(got));
  // (a bandage is made again every 5 s, so by the time the page looks it may be back: the first-aid box, made every 15 s, is the steady one)
  const less = await until(async () => (await count(A.page, 'first-aid-box')) === 4 ? true : null, 8000);
  check('the menu shows one less first-aid box', !!less);
  const back = await until(async () => (await count(A.page, 'bandage')) === 10 && (await count(A.page, 'first-aid-box')) === 5 ? true : null, 25000);
  check('the box fills up again by itself (a bandage in 5 s, a first-aid box in 15 s)', !!back);
  await A.page.click('#medboxClose');
  check('the Close button hides the menu', await A.page.evaluate(() => document.getElementById('medboxPanel').hidden));

  // ---- 3. Ben walks up and punches Ana, so something is hurt
  const ana = () => B.page.evaluate(() => window.__sim.people.find(p => p.name === 'med_ana')?.pos && { x: window.__sim.people.find(p => p.name === 'med_ana').pos.x, z: window.__sim.people.find(p => p.name === 'med_ana').pos.z });
  await walkTo(B.page, "(() => { const a = people.find(p => p.name === 'med_ana'); return { x: a.pos.x + .3, z: a.pos.z + .45 }; })()");
  await fp(B.page);
  const hurt = await until(async () => {
    const a = await ana(); if (!a) return null;
    // face Ana and, while further than a punch reaches (.95 m), step towards her first
    const d = await B.page.evaluate(([x, z]) => { const p = window.__sim.player.person; window.__sim.ctl.yaw = Math.atan2(x - p.pos.x, z - p.pos.z); window.__sim.ctl.pitch = 0; return Math.hypot(x - p.pos.x, z - p.pos.z); }, [a.x, a.z]);
    if (d > .8) { await B.page.keyboard.down('w'); await sleep(Math.min(900, (d - .6) * 600)); await B.page.keyboard.up('w'); return null; }
    await B.page.keyboard.down('p'); await sleep(700); await B.page.keyboard.up('p');
    await sleep(1500);
    const h = await myHealth(A.page);
    return sum(h) < FULL ? h : null;
  }, 40000);
  check('Ben\'s punch hurt Ana', !!hurt, JSON.stringify(hurt));
  if (!hurt) {
    console.log('punch diagnostics:', JSON.stringify({
      ben: await B.page.evaluate(() => { const p = window.__sim.player.person; return { x: p.pos.x, z: p.pos.z, face: p.face, yaw: window.__sim.ctl.yaw, attack: p.mechanics.attack, posture: p.mechanics.posture }; }),
      ana: await A.page.evaluate(() => { const p = window.__sim.player.person; return { x: p.pos.x, z: p.pos.z, health: p.mechanics.health, posture: p.mechanics.posture }; }),
    }));
  }
  await sleep(2500); // (the knockback ends)

  // ---- 4. Ana picks the bandage on the hotbar and holds E: 3 seconds, then the hurt limb heals and the bandage is used up
  // (what is taken from the medkit goes onto the first free hotbar slots by itself: the bandage on 1, the first-aid box on 2)
  const slots = await until(() => A.page.evaluate(() => { const p = window.__sim.player.person, h = p.inventory.hotbar, t = id => p.inventory.items.find(i => i.id === id)?.type; return t(h[0]) === 'bandage' && t(h[1]) === 'first-aid-box' ? [h[0], h[1]] : null; }), 8000);
  check('the bandage and the first-aid box are on the hotbar by themselves', !!slots, JSON.stringify(slots));
  await A.page.keyboard.press('1');
  const picked = await until(() => A.page.evaluate(() => document.querySelector('#inventoryHotbar [data-slot="0"]')?.classList.contains('selected') ? true : null), 5000);
  check('pressing 1 picks that slot', !!picked);
  // look along the floor, away from the medkit, so E means care and not "open the medkit"
  await A.page.evaluate(() => { window.__sim.ctl.yaw = Math.PI / 2; window.__sim.ctl.pitch = 0; });
  await sleep(600);
  const hint = await until(() => A.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden || b.textContent ? (/Hold E/.test(b.textContent) ? b.textContent : null) : null; }), 6000);
  check('the page says what holding E will do', !!hint, hint ?? '');

  // letting go early heals nothing and keeps the bandage
  const beforeCancel = await myHealth(A.page);
  await A.page.keyboard.down('e');
  const barShown = await until(() => A.page.evaluate(() => { const b = document.getElementById('careBar'); return b && !b.hidden ? true : null; }), 5000);
  check('holding E shows the care bar', !!barShown);
  await sleep(1000);
  await A.page.keyboard.up('e');
  await sleep(2500);
  check('letting go after 1 second healed nothing and kept the bandage', sum(await myHealth(A.page)) === sum(beforeCancel) && (await myItems(A.page)).some(i => i.type === 'bandage'));
  check('and the bar is gone', await A.page.evaluate(() => document.getElementById('careBar').hidden));

  // holding it through: healed, used up
  await A.page.keyboard.down('e');
  await sleep(3800);
  await A.page.keyboard.up('e');
  const healed = await until(async () => sum(await myHealth(A.page)) > sum(beforeCancel) ? true : null, 6000);
  const gone = !(await myItems(A.page)).some(i => i.type === 'bandage');
  check('holding E for 3 seconds healed Ana and used up the bandage', !!healed && gone, `${sum(beforeCancel)} -> ${sum(await myHealth(A.page))}`);
  const said = (await notices(A.page)).some(t => /Treated/.test(t));
  check('she is told it worked', said);

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
