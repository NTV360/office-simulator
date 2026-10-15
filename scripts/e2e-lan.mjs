// The voice check through the LAN HTTPS edge (Caddy), on spare ports: the certificate download and setup page, the certificate chain, and voice over wss://.
//   npm run e2e:lan
process.env.E2E_VOICE_LAN = '1';
await import('./e2e-voice.mjs');
