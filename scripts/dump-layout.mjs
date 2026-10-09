// Writes packages/shared/src/layout/office.json from the client's own furniture code (the source of truth until
// phase 5). The server loads that file. A browser check fails if it goes stale.   npm run layout:dump
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { openPage, root, startSite } from '../tests/browser/site.mjs';

const site = await startSite();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const { page } = await openPage(browser, site.url, '?seed=1');
  const layout = await page.evaluate(() => window.__sim.layoutData());
  const file = path.join(root, 'packages/shared/src/layout/office.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(layout, null, 1) + '\n');
  const kinds = {};
  for (const s of layout.spots) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  console.log(`wrote ${path.relative(root, file)}: ${layout.spots.length} spots, ${layout.obstacles.length} obstacles`);
  console.log(Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', '));
} finally {
  await browser.close();
  site.stop();
}
