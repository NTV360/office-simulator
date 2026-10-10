// A stand-in for the company's employee records, for working on your own PC without Supabase credentials:   npm run dev:records
// It answers the few requests the office server makes (see apps/server/src/employees/supabase-source.ts) the way Supabase's REST interface does,
// from a small made-up company in scripts/dev-records.json (36 employees in 10 departments, day, mid and night shifts, interns, three saved
// looks and desks). Who is "clocked in" is made up when asked: everyone on the day or mid shift except about one in ten. Nothing here is real.
//
//   npm run dev:online           starts this for you when SUPABASE_URL is not set (turn it off with DEV_RECORDS=0)
//   npm run dev:records          on its own, for the Docker stack (see docs/GETTING-STARTED.md, "Test data")
// Port 18090 (DEV_RECORDS_PORT); the key is "dev-records-key" (DEV_RECORDS_KEY).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORT = Number(process.env.DEV_RECORDS_PORT) || 18090;
export const KEY = process.env.DEV_RECORDS_KEY || 'dev-records-key';

const tables = JSON.parse(fs.readFileSync(path.join(here, 'dev-records.json'), 'utf8'));

/** The attendance rows for right now: the day and mid shift are in (one in ten is not), the night shift is not. */
function attendances(now = new Date()) {
  const stamp = d => d.toISOString().slice(0, 19).replace('T', ' '); // the database's own text form, in UTC
  const shiftOf = new Map(tables.shifts.map(s => [s.shift_id, s.code]));
  const rows = [];
  tables.employees.forEach((e, i) => {
    if (shiftOf.get(e.shift_id) === 'NIGHT' || i % 10 === 7) return;
    const hoursAgo = 1 + (i % 4) * 0.5;
    rows.push({ employee_id: e.user_id, clock_in: stamp(new Date(now.getTime() - hoursAgo * 3600e3)), clock_out: null });
  });
  return rows;
}

export function startRecords({ port = PORT, key = KEY, host = '0.0.0.0', log = true } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.split('/').pop();
    if (req.headers.apikey !== key || req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401).end('{"message":"bad key"}'); return; }
    const rows = table === 'attendances' ? attendances() : tables[table];
    if (!rows) { res.writeHead(404).end('{"message":"no such table"}'); return; }
    if (log) console.log(`[records] ${table} (${rows.length} rows)`);
    const [from, to] = String(req.headers.range || '0-999').split('-').map(Number);
    if (from > 0 && from >= rows.length) { res.writeHead(416).end('{}'); return; }
    res.writeHead(rows.length > to + 1 ? 206 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(rows.slice(from, to + 1)));
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startRecords();
  console.log(`\nmade-up employee records on http://localhost:${PORT}  (key "${KEY}")\n` +
    `  local server:   SUPABASE_URL=http://localhost:${PORT}  SUPABASE_SECRET_KEY=${KEY}\n` +
    `  Docker stack:   SUPABASE_URL=http://host.docker.internal:${PORT}  SUPABASE_SECRET_KEY=${KEY}   (in .env, then docker compose up --build -d)\n` +
    'Ctrl+C stops it.');
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}
