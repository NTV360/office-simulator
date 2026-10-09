// Checks the documentation: every relative link and heading anchor resolves, and every repository path
// written in backticks (apps/, packages/, docker/, scripts/, tests/) exists.   npm run check:docs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];
// Docs that describe files that do not exist yet (plans and briefs) are exempt from the path check.
const PATHS_EXEMPT = new Set(['docs/MULTIPLAYER-PLAN.md', 'docs/PARALLEL-WORK.md', 'docs/PHASE-1-BREAKDOWN.md', 'docs/PHASE-2-BREAKDOWN.md']);

const slug = h => h.toLowerCase().replace(/`/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
const anchors = {};
for (const f of files) anchors[f] = new Set([...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1])));

let bad = 0, total = 0;
const problem = msg => { console.log('  ' + msg); bad++; };
for (const f of files) {
  const txt = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of txt.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^https?:/.test(link)) continue;
    total++;
    const [p, a] = link.split('#');
    const target = p ? path.posix.normalize(path.posix.join(path.posix.dirname(f), p)) : f;
    if (!fs.existsSync(path.join(root, target))) { problem(`missing file    ${f}: ${link}`); continue; }
    if (a && target.endsWith('.md') && !anchors[target]?.has(a)) problem(`missing anchor  ${f}: ${link}`);
  }
  if (PATHS_EXEMPT.has(f)) continue;
  for (const m of txt.matchAll(/`((?:apps|packages|docker|scripts|tests)\/[\w\/.\-*]+)`/g)) {
    if (m[1].includes('*')) continue;
    total++;
    if (!fs.existsSync(path.join(root, m[1]))) problem(`missing path    ${f}: ${m[1]}`);
  }
}
console.log(bad ? `${bad} problem(s) in ${total} links and paths` : `docs ok: ${total} links and paths resolve`);
process.exitCode = bad ? 1 : 0;
