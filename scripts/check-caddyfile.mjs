// Check the LAN edge's Caddy configuration in both TLS modes, without touching Let's Encrypt or Cloudflare:
//   npm run check:caddy            builds the edge image (cached after the first time) and checks it
//   npm run check:caddy -- --no-build <image>   check an image that is already built
// For each mode (LAN_TLS=internal, LAN_TLS=cloudflare) it runs `caddy validate` and `caddy adapt` inside the image with made-up values, and
// checks what the configuration says: where the certificates come from, and what the plain-HTTP port serves. Needs Docker; nothing is started.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const image = args.find(a => !a.startsWith('--')) ?? 'office-sim-web-lan:check';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const docker = (a, opts = {}) => spawnSync('docker', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

if (!noBuild) {
  console.log(`building ${image} (the first time compiles Caddy with the Cloudflare plugin: a few minutes) ...`);
  const b = docker(['build', '-f', 'docker/web-lan.Dockerfile', '-t', image, '.'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (b.status !== 0) { console.error('the image did not build'); process.exit(1); }
}

// made-up tokens in the shape of real Cloudflare ones, the old 40-character kind and the newer 53-character cfut_ kind: the plugin refuses anything of another shape
const token = 'A'.repeat(40), newToken = 'cfut_' + 'A'.repeat(48);
const modes = {
  internal: { LAN_TLS: 'internal' },
  cloudflare: { LAN_TLS: 'cloudflare', CLOUDFLARE_API_TOKEN: token, ACME_CA: 'https://acme-staging-v02.api.letsencrypt.org/directory' },
};
const run = (env, command) => {
  const e = ['-e', 'SITE_ADDRESS=office-sim.example.com', '-e', 'VOICE_SITE_ADDRESS=voice.office-sim.example.com', '-e', 'LAN_HTTPS_PORT=8443', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])];
  return docker(['run', '--rm', ...e, '--entrypoint', 'caddy', image, command, '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
};

const plugin = docker(['run', '--rm', '--entrypoint', 'caddy', image, 'list-modules']);
check('the image has the Cloudflare DNS plugin', /dns\.providers\.cloudflare/.test(plugin.stdout));

for (const [mode, env] of Object.entries(modes)) {
  const valid = run(env, 'validate');
  check(`${mode}: the Caddyfile is valid`, valid.status === 0, valid.status === 0 ? '' : (valid.stderr.match(/"msg":"([^"]*error[^"]*|loading[^"]*)"/)?.[1] ?? valid.stderr.split('\n').find(l => /error/i.test(l)) ?? '').slice(0, 200));
  const adapted = run(env, 'adapt');
  let cfg = null;
  try { cfg = JSON.parse(adapted.stdout); } catch { /* reported below */ }
  check(`${mode}: the configuration can be read`, !!cfg);
  if (!cfg) continue;
  const policies = cfg.apps?.tls?.automation?.policies ?? [];
  const forSite = policies.filter(p => (p.subjects ?? []).some(s => s.endsWith('example.com')));
  const issuers = forSite.flatMap(p => p.issuers ?? []);
  const health = policies.find(p => (p.subjects ?? []).includes('127.0.0.1'));
  check(`${mode}: the health-check address always uses the internal CA`, health?.issuers?.[0]?.module === 'internal');
  const servers = Object.values(cfg.apps.http.servers);
  const plain = servers.find(s => (s.listen ?? []).includes(':80'));
  const paths = JSON.stringify(plain?.routes ?? []);
  if (mode === 'internal') {
    check('internal: both site names use the internal CA', issuers.length > 0 && issuers.every(i => i.module === 'internal'));
    check('internal: plain HTTP still serves the root certificate and the setup page', /\/ca\.crt/.test(paths) && /\/setup/.test(paths));
  } else {
    check('cloudflare: both site names get Let\'s Encrypt certificates by the Cloudflare DNS challenge', issuers.length > 0 && issuers.every(i => i.module === 'acme' && i.challenges?.dns?.provider?.name === 'cloudflare'));
    check('cloudflare: the DNS check uses public resolvers (the office DNS answers for the site names itself)', issuers.every(i => (i.challenges?.dns?.resolvers ?? []).includes('1.1.1.1')));
    check('cloudflare: the ACME endpoint follows ACME_CA', issuers.every(i => i.ca === env.ACME_CA));
    check('cloudflare: plain HTTP offers no certificate download or setup page, only the redirect', !/\/ca\.crt/.test(paths) && !/\/setup/.test(paths) && /office-sim\.example\.com:8443/.test(paths));
    check('cloudflare: the token is read from the environment, not written into the configuration', !adapted.stdout.includes(token));
  }
}

// the newer Cloudflare tokens (cfut_...) are longer than the old 40-character ones: the edge must accept both
const newer = run({ ...modes.cloudflare, CLOUDFLARE_API_TOKEN: newToken }, 'validate');
check('cloudflare: the newer, longer (cfut_) token shape is accepted too', newer.status === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
