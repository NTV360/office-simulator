// Validate the non-secret prerequisites for a two-client LAN voice check.
// Run with: node --env-file=.env scripts/check-lan-config.mjs
// This intentionally prints only pass/fail facts, never credential values.
import { isIP } from 'node:net';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const url = (name, protocols) => {
  const value = required(name);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a URL`); }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${name} must use ${protocols.join(' or ')}`);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') throw new Error(`${name} must be reachable from LAN clients`);
  return parsed;
};
const port = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
  return value;
};
const failures = [];
const check = (label, fn) => {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (error) { failures.push(`${label}: ${error.message}`); console.log(`FAIL  ${label} (${error.message})`); }
};

check('LAN site address is configured', () => {
  const value = required('SITE_ADDRESS');
  if (value.includes('/') || value.includes(':') || value === 'localhost') throw new Error('use a LAN DNS name, not a URL or localhost');
});
check('voice site address is configured', () => {
  const value = required('VOICE_SITE_ADDRESS');
  if (value.includes('/') || value.includes(':') || value === 'localhost') throw new Error('use a LAN DNS name, not a URL or localhost');
});
// Where the certificates come from (docker/caddy-tls/): "internal" is Caddy's own CA (each client trusts it once); "cloudflare" is real Let's Encrypt
// certificates for a domain you own, so nothing is installed anywhere.
const tlsMode = (process.env.LAN_TLS || 'internal').trim().toLowerCase();
check('certificate mode is known', () => {
  if (!['internal', 'cloudflare'].includes(tlsMode)) throw new Error('LAN_TLS must be internal or cloudflare');
});
if (tlsMode === 'cloudflare') {
  check('real certificates: a Cloudflare API token is set', () => {
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required (a token limited to editing DNS in the domain\'s one zone)');
    if (!/^[A-Za-z0-9_-]{40}$/.test(token)) throw new Error('CLOUDFLARE_API_TOKEN does not look like a Cloudflare API token (40 letters, digits, - or _)');
  });
  check('real certificates: both names are under a domain you own', () => {
    for (const name of ['SITE_ADDRESS', 'VOICE_SITE_ADDRESS']) {
      const value = required(name).toLowerCase();
      if (isIP(value) || !/^([a-z0-9-]+\.){2,}[a-z]{2,}$/.test(value)) throw new Error(`${name} must be a name like office-sim.example.com`);
      if (/\.(internal|local|lan|localhost|test|example|invalid|arpa|home)$/.test(value)) throw new Error(`${name} must be under a real, public domain: Let's Encrypt cannot certify ".${value.split('.').pop()}" names`);
    }
  });
  check('real certificates: the ACME endpoint is a URL', () => {
    const value = process.env.ACME_CA?.trim();
    if (!value) return;
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('ACME_CA must be a URL'); }
    if (parsed.protocol !== 'https:') throw new Error('ACME_CA must use https:');
    if (/staging/.test(parsed.hostname)) console.log('NOTE  ACME_CA is the Let\'s Encrypt STAGING endpoint: browsers do not trust its certificates. Remove ACME_CA once it works.');
  });
}
check('voice is enabled', () => {
  if (!['true', '1'].includes((process.env.VOICE_ENABLED || '').toLowerCase())) throw new Error('set VOICE_ENABLED=true');
});
check('browser LiveKit URL is LAN WSS', () => {
  const parsed = url('LIVEKIT_URL', ['wss:']);
  if (parsed.hostname !== process.env.VOICE_SITE_ADDRESS?.trim()) throw new Error('hostname must match VOICE_SITE_ADDRESS');
});
check('server LiveKit API URL stays internal', () => {
  const parsed = url('LIVEKIT_API_URL', ['http:', 'https:']);
  if (parsed.hostname !== 'voice') throw new Error('use the compose service name voice');
});
check('LiveKit node address is set', () => {
  const value = required('LIVEKIT_NODE_IP');
  if (!isIP(value)) throw new Error('use a valid host LAN IP address');
});
check('HTTPS edge ports are valid', () => {
  const http = port('LAN_HTTP_PORT', 80);
  const https = port('LAN_HTTPS_PORT', 443);
  if (http === https) throw new Error('HTTP and HTTPS ports must differ');
});
check('LiveKit RTC ports are valid', () => {
  const tcp = port('LIVEKIT_RTC_TCP_PORT', 7881);
  const start = port('LIVEKIT_RTC_PORT_RANGE_START', 50000);
  const end = port('LIVEKIT_RTC_PORT_RANGE_END', 50020);
  const http = port('LAN_HTTP_PORT', 80);
  const https = port('LAN_HTTPS_PORT', 443);
  if (start > end) throw new Error('RTC range start must not exceed end');
  if (tcp >= start && tcp <= end) throw new Error('RTC TCP port must not overlap the UDP range');
  if ([tcp, start, end].some(candidate => candidate === http || candidate === https)) throw new Error('RTC ports must not overlap HTTPS ports');
});
check('secure cookies are enabled', () => {
  if ((process.env.COOKIE_SECURE || '').toLowerCase() !== 'true') throw new Error('set COOKIE_SECURE=true for HTTPS');
});
check('voice credentials are non-default', () => {
  const key = required('LIVEKIT_API_KEY');
  const secret = required('LIVEKIT_API_SECRET');
  if (key === 'devkey' || secret === 'devsecret' || secret === 'change-this-server-only-secret') throw new Error('replace development credentials');
});

if (failures.length) {
  console.error(`\n${failures.length} LAN prerequisite(s) failed. No client verification was run.`);
  process.exitCode = 1;
} else {
  console.log('\nLAN prerequisites pass. Continue with the two-client browser check; this does not prove ICE/media connectivity.');
}
