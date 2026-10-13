// One account per employee in the roster snapshot, linked to their employee:  node scripts/make-accounts.mjs   (needs the dev server running)
// Usernames are firstname.lastname. Each account gets a generated first password (they must choose their own at first login). The passwords are
// written ONCE to tests/fixtures/accounts.local.csv (git-ignored) and never printed. Safe to run again: names that exist are skipped and reported.
//   MAKE_URL (default http://localhost:3000)   MAKE_ADMIN_TOKEN (default: the dev server's)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rosterFile = path.join(root, 'tests/fixtures/roster.local.json');
const outFile = path.join(root, 'tests/fixtures/accounts.local.csv');
const base = (process.env.MAKE_URL || 'http://localhost:3000').replace(/\/$/, '');
const headers = { 'content-type': 'application/json', authorization: `Bearer ${process.env.MAKE_ADMIN_TOKEN || 'dev-admin-token'}` };

if (!fs.existsSync(rosterFile)) { console.error('no roster snapshot: run npm run snapshot:roster first'); process.exit(1); }
const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));

// letters/digits only, accents folded; 3 to 24 characters; a number is added to keep two people apart
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const taken = new Set();
const people = roster.map(e => {
  let base = `${slug(e.firstName)}.${slug(e.lastName)}`.replace(/^\./, '').replace(/\.$/, '');
  if (base.length < 3) base = (base + slug(e.userId)).slice(0, 8);
  base = base.slice(0, 22);
  let name = base, n = 2;
  while (taken.has(name)) name = base.slice(0, 22 - String(n).length) + n++;
  taken.add(name);
  return { username: name, userId: e.userId, display: `${e.firstName} ${e.lastName}`.trim() };
});

async function call(method, route, body) {
  const res = await fetch(base + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const rows = [], failed = [];
for (let i = 0; i < people.length; i += 40) {
  const chunk = people.slice(i, i + 40);
  const { status, json } = await call('POST', '/api/admin/users/bulk', { usernames: chunk.map(p => p.username) });
  if (status !== 201 && status !== 200) { console.error(`bulk create failed (${status}): ${JSON.stringify(json).slice(0, 200)}`); process.exit(1); }
  json.results.forEach((r, k) => {
    const p = chunk[k];
    if (!r.ok) { failed.push(`${p.username}: ${r.message}`); return; }
    rows.push({ ...p, id: r.id, password: r.password });
  });
}

let linked = 0;
for (const r of rows) {
  const { status, json } = await call('POST', `/api/admin/users/${r.id}/employee`, { employeeId: r.userId });
  if (status === 200 || status === 201) linked++; else failed.push(`${r.username}: could not link (${status} ${JSON.stringify(json).slice(0, 120)})`);
}

if (rows.length) {
  const existed = fs.existsSync(outFile);
  const lines = rows.map(r => [r.display, r.username, r.password].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  fs.writeFileSync(outFile, (existed ? fs.readFileSync(outFile, 'utf8') : 'employee,username,first_password\n') + lines.join('\n') + '\n');
}
console.log(`made ${rows.length} accounts, linked ${linked}; ${failed.length} problems`);
failed.slice(0, 15).forEach(f => console.log('  ' + f));
if (rows.length) console.log(`first passwords saved to ${path.relative(root, outFile)} (git-ignored; each person must choose their own at first login)`);
