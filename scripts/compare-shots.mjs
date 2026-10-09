// How different two sets of pictures (from scripts/shots.mjs) are: the share of pixels that differ by more than a little, and the worst one.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [a, b] = [process.argv[2], process.argv[3]];
if (!a || !b) { console.log('usage: node scripts/compare-shots.mjs <before> <after>'); process.exit(2); }
const dir = n => path.join(root, 'tests/browser/out/shots', n);
const names = fs.readdirSync(dir(a)).filter(f => f.endsWith('.png'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let worst = 0;
for (const f of names) {
  if (!fs.existsSync(path.join(dir(b), f))) { console.log(f.padEnd(14), 'missing in', b); worst = 1; continue; }
  const [x, y] = [fs.readFileSync(path.join(dir(a), f)).toString('base64'), fs.readFileSync(path.join(dir(b), f)).toString('base64')];
  const r = await page.evaluate(async ([x, y]) => {
    const load = async s => { const img = new Image(); img.src = 'data:image/png;base64,' + s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const [p, q] = [await load(x), await load(y)];
    if (p.width !== q.width || p.height !== q.height) return { size: true };
    let diff = 0, big = 0, max = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
      if (d > 0) diff++; if (d > 24) big++; if (d > max) max = d;
    }
    return { pixels: p.data.length / 4, diff, big, max };
  }, [x, y]);
  if (r.size) { console.log(f.padEnd(14), 'different sizes'); worst = 1; continue; }
  const share = r.big / r.pixels;
  worst = Math.max(worst, share);
  console.log(f.padEnd(14), `${(r.diff / r.pixels * 100).toFixed(3)}% pixels differ, ${(share * 100).toFixed(3)}% by more than a little, largest difference ${r.max}`);
}
await browser.close();
console.log(worst > 0.01 ? `\nTOO DIFFERENT (worst ${(worst * 100).toFixed(2)}%)` : '\nthe same, to the eye');
process.exitCode = worst > 0.01 ? 1 : 0;
