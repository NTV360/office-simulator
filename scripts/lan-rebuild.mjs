// Rebuild a running LAN test stack with the current code, keeping every setting it has now (host names, ports, keys, passwords) and its data.
// The edge image holds the web client it was built with, so a LAN that was started earlier keeps serving that older client until it is rebuilt.
//   npm run lan:rebuild                   show what would be rebuilt (nothing is changed)
//   npm run lan:rebuild -- --yes          rebuild it (the server restarts: everybody online is disconnected for a minute)
//   npm run lan:rebuild -- office-lan-test --yes    another compose project name (the default is office-lan-test)
// The settings are read from the running containers into this process only; secrets are never printed or written to a file.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const project = args.find(a => !a.startsWith('--')) ?? 'office-lan-test';

const docker = (...a) => spawnSync('docker', a, { cwd: root, encoding: 'utf8' });
const inspect = service => {
  const r = docker('inspect', `${project}-${service}-1`);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout)[0]; } catch { return null; }
};
const envOf = c => Object.fromEntries((c?.Config?.Env ?? []).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const hostPort = (c, containerPort) => c?.NetworkSettings?.Ports?.[containerPort]?.[0]?.HostPort;

const containers = Object.fromEntries(['web-lan', 'web', 'server', 'voice', 'db'].map(s => [s, inspect(s)]));
for (const need of ['web-lan', 'server', 'voice']) {
  if (!containers[need]) { console.error(`There is no running "${project}-${need}-1" container: is the LAN stack up, under another project name?`); process.exit(1); }
}

const server = envOf(containers.server), edge = envOf(containers['web-lan']), db = envOf(containers.db);
const cmd = (containers.voice.Config.Cmd ?? []).join(' ');
const udp = /--udp-port (\d+)-(\d+)/.exec(cmd), node = /--node-ip (\S+)/.exec(cmd);

const settings = {
  SITE_ADDRESS: edge.SITE_ADDRESS, VOICE_SITE_ADDRESS: edge.VOICE_SITE_ADDRESS,
  LAN_HTTP_PORT: hostPort(containers['web-lan'], '80/tcp'), LAN_HTTPS_PORT: hostPort(containers['web-lan'], '443/tcp'),
  WEB_PORT: hostPort(containers.web, '80/tcp'),
  LIVEKIT_HTTP_PORT: hostPort(containers.voice, '7880/tcp'), LIVEKIT_RTC_TCP_PORT: hostPort(containers.voice, '7881/tcp'),
  LIVEKIT_RTC_PORT_RANGE_START: udp?.[1], LIVEKIT_RTC_PORT_RANGE_END: udp?.[2], LIVEKIT_NODE_IP: node?.[1],
  POSTGRES_USER: db.POSTGRES_USER, POSTGRES_PASSWORD: db.POSTGRES_PASSWORD, POSTGRES_DB: db.POSTGRES_DB,
};
for (const name of ['VOICE_ENABLED', 'LIVEKIT_URL', 'LIVEKIT_API_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'VOICE_ROOM', 'VOICE_RANGE', 'COOKIE_SECURE', 'GRACE_MS', 'TICK_RATE',
  'SLOT_COUNT', 'SIM_SPEED', 'SIM_PAUSED', 'WORLD_SEED', 'PHYSICS', 'TZ', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_TOKEN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY',
  'EMPLOYEE_IMPORT_MS', 'ATTENDANCE_MS', 'RESET_WORLD', 'SAVE_INTERVAL_MS', 'AUTH_LOGINS_PER_MINUTE']) settings[name] = server[name];

const secret = /SECRET|PASSWORD|TOKEN|KEY/;
console.log(`Stack "${project}" will be rebuilt with the current code and these settings (secrets hidden):`);
for (const [k, v] of Object.entries(settings)) if (v !== undefined) console.log(`  ${k}=${secret.test(k) && v ? '***' : v}`);
const missing = Object.entries(settings).filter(([k, v]) => v === undefined && !/^(POSTGRES_|SUPABASE_|ADMIN_|AUTH_|EMPLOYEE_|ATTENDANCE_|WORLD_SEED|TZ$|RESET_WORLD|SAVE_INTERVAL)/.test(k)).map(([k]) => k);
if (missing.length) { console.error(`\nCould not read: ${missing.join(', ')}. Nothing was changed.`); process.exit(1); }

if (!yes) { console.log('\nDry run: nothing was changed. Add --yes to rebuild (the server restarts and everybody online is disconnected for a minute).'); process.exit(0); }

const env = { ...process.env };
for (const [k, v] of Object.entries(settings)) if (v !== undefined) env[k] = v;
console.log('\nRebuilding (this takes a few minutes) ...');
const up = spawnSync('docker', ['compose', '-p', project, '--profile', 'lan', '--profile', 'voice', 'up', '--build', '-d'], { cwd: root, env, stdio: 'inherit' });
if (up.status !== 0) { console.error('docker compose failed; the previous containers may have been replaced: see the output above.'); process.exit(1); }

const base = `http://127.0.0.1:${settings.WEB_PORT}`;
let healthy = false;
for (let i = 0; i < 90 && !healthy; i++) {
  try { const j = await (await fetch(`${base}/api/health`)).json(); healthy = j.status === 'ok' && j.db === 'ok'; } catch { /* not up yet */ }
  if (!healthy) await new Promise(r => setTimeout(r, 1000));
}
const cert = await fetch(`http://127.0.0.1:${settings.LAN_HTTP_PORT}/ca.crt`).then(r => r.text()).catch(() => '');
console.log(healthy ? 'The server is healthy.' : 'The server did not report healthy within 90 s: check `docker compose logs`.');
console.log(cert.includes('BEGIN CERTIFICATE') ? `The setup page and certificate are at http://${settings.SITE_ADDRESS}:${settings.LAN_HTTP_PORT}/ (the certificate is unchanged: computers that already installed it keep working).` : 'The certificate download did not answer yet.');
process.exitCode = healthy ? 0 : 1; // (not process.exit: on Windows it can trip a harmless Node assertion while the last request closes)
