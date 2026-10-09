// Draw calls, triangles and frame time of the page, for comparing before and after a change to how the office is drawn.   npm run perf
// (Headless Chrome with software rendering: the absolute frame times mean little, but a change in them is real.)
import { chromium } from 'playwright';
import { startSite, openPage, sleep } from '../tests/browser/site.mjs';

const query = process.argv[2] || '?seed=1&offline';
const site = await startSite();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const { page } = await openPage(browser, site.url, query);
  await sleep(2500);
  const views = ['angle', 'top', 'third'];
  const out = {};
  for (const v of views) {
    await page.evaluate(view => window.__sim.setView(view), v);
    await sleep(1200);
    out[v] = await page.evaluate(() => new Promise(resolve => {
      const r = window.__sim.renderer, times = []; let last = performance.now(), n = 0;
      const f = () => {
        const t = performance.now(); times.push(t - last); last = t;
        if (++n < 90) requestAnimationFrame(f);
        else { times.shift(); times.sort((a, b) => a - b); resolve({ calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, frameMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1), p95Ms: +times[Math.floor(times.length * .95)].toFixed(1) }); }
      };
      requestAnimationFrame(f);
    }));
  }
  // 1000 more chairs and stools, then 200 of them moving every frame (the worst a busy office could ask for)
  await page.evaluate(() => { window.__sim.setView('angle'); });
  const measure = (shake) => page.evaluate(([shake]) => new Promise(resolve => {
    const w = window.__sim, r = w.renderer, times = []; let last = performance.now(), n = 0, k = 0;
    const f = () => {
      const t = performance.now(); times.push(t - last); last = t;
      if (shake) w.shakeObjects(shake === 1 ? [] : w.__stress.slice(0, 200), k++);
      if (++n < 90) requestAnimationFrame(f);
      else { times.shift(); times.sort((a, b) => a - b); resolve({ calls: r.info.render.calls, triangles: r.info.render.triangles, frameMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1), p95Ms: +times[Math.floor(times.length * .95)].toFixed(1) }); }
    };
    requestAnimationFrame(f);
  }), [shake]);
  out.stress1000 = await page.evaluate(() => { window.__sim.__stress = window.__sim.stressObjects(1000); return window.__sim.objectDrawCalls(); });
  await sleep(800);
  out.withThousand = await measure(0);
  out.withThousandMoving200 = await measure(2);
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close(); site.stop(); }
