// Pictures of the furniture, with the people hidden so they are the same every time, for comparing before and after a change to how it
// is drawn.   node scripts/shots.mjs <name> [query]      then   node scripts/compare-shots.mjs <before-name> <after-name>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite, openPage, sleep } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'shot';
const query = process.argv[3] || '?seed=1&offline';
const VIEWS = { desks: [527, 190, 14], desks2: [520, 640, 16], dining: [544, 1000, 12], conf: [262, 132, 17], bar: [450, 105, 8], booths: [582, 916, 10], stations: [330, 1062, 9], whole: [400, 560, 60] };
const out = path.join(root, 'tests/browser/out/shots', name);
fs.mkdirSync(out, { recursive: true });
const site = await startSite();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const { page } = await openPage(browser, site.url, query);
  await page.evaluate(() => { document.querySelectorAll('.card, #more, #veil').forEach(c => { c.style.display = 'none'; }); window.__sim.peopleGroup.visible = false; window.__sim.setView('free'); window.__sim.wall.goal = 0.2; window.__sim.wall.h = 0.2; });
  for (const [view, [cx, cy, dist]] of Object.entries(VIEWS)) {
    await page.evaluate(([cx, cy, dist]) => {
      const w = window.__sim;
      for (const c of [w.camState, w.camGoal]) { c.target.set((cx - 397.85) * 0.041, 0, (cy - 577.05) * 0.041); c.dist = dist; c.pitch = 1.1; c.yaw = 0.4; }
    }, [cx, cy, dist]);
    await sleep(1500);
    await page.screenshot({ path: path.join(out, view + '.png') });
  }
  console.log('wrote', Object.keys(VIEWS).length, 'pictures to', path.relative(root, out));
} finally { await browser.close(); site.stop(); }
