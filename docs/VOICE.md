# Voice (phase 7)

Voice uses an optional self-hosted LiveKit service. Gameplay remains authoritative over Socket.IO; LiveKit carries microphone media only.

## Configuration

Set these server-only values in `.env` when voice is enabled:

- `VOICE_ENABLED=true`
- `LIVEKIT_URL`: the browser-reachable LiveKit WebSocket URL
- `LIVEKIT_API_URL`: optional server-only HTTP URL for LiveKit Room Service APIs; when omitted, it is derived from `LIVEKIT_URL`
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`: signing and Room Service credentials, never sent to a browser
- `VOICE_ROOM=office` (the server accepts only this room)
- `VOICE_RANGE=10` (metres; proximity policy uses authoritative player positions)

The compose stack includes the optional `voice` service under the `voice` profile; start it explicitly with `docker compose --profile voice up --build`. It requires non-default `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` values and does not publish a media listener when the ordinary stack is started. For other devices on the LAN, use a browser-reachable hostname and HTTPS/WSS at the edge; `localhost` is suitable only for local development. Microphone permission is a browser policy and must be granted by an explicit user action.

## What you hear

- **Distance.** Each voice is scaled by `(1 - distance/range)^2` (range 10 m by default): full volume beside you, about 16% at 6 m, silent at the range, and nothing is subscribed beyond it.
- **Direction.** Every voice is a 3D positional sound (a Web Audio HRTF panner): it comes from the side the speaker is on, and in front or behind on headphones. It is placed from where you stand and look (the camera's yaw, else the way you face), refreshed ten times a second, so turning your head or walking changes it at once. The speakers' own positions arrive from the server once a second.
- **Mic volume** (0 to 200%, 100% as it is): what others hear of you, a gain on the microphone track that is sent (a LiveKit audio processor). A browser without it keeps the plain microphone and says so.
- **Voices volume** (0 to 200%): a master level for everybody else, applied on top of the distance fade.

Both sliders are in the voice panel and are remembered in the browser between visits. The volume is applied once, by the gain node; applying it to the audio element as well would square it.

## Authentication and proximity

`POST /api/voice/token` is protected by the same-origin and authenticated-session guards as the existing play ticket endpoint. The server derives the participant identity and display name from the authenticated account and the current `PlayerManager` session. A request with an unknown room, unavailable voice configuration, expired/disabled session, or account that still must choose a password is refused.

The returned JWT is short-lived and grants joining the office room, publishing microphone audio, and LiveKit's base permission to subscribe. It does not enable automatic subscription: `VoiceAclService` uses the trusted LiveKit Room Service API to list published audio tracks and grant/revoke each listener's subscriptions from server-authoritative positions on a bounded cadence, while the client uses `autoSubscribe: false` and requests only the tracks currently returned by the server. Because the installed LiveKit API does not let `UpdateSubscriptions` override `canSubscribe`, the base permission is required for this flow; proximity enforcement is application-level and a malicious client could otherwise request another room track. Proximity candidates are calculated from authoritative positions; browser-submitted coordinates are not accepted.

Logout, disconnect, grace expiry, manager replacement, and shutdown must clear any client connection and stale ACL state; the gameplay server remains usable when voice is disabled.

## Verification boundary

Automated coverage currently covers configuration gating, room validation, bounded proximity selection, token claims, TTL, and restricted grants in `apps/server/src/voice/voice.test.ts`. `scripts/e2e-voice.mjs` runs a disposable Docker/LiveKit two-browser check with fake microphones and verifies nearby remote tracks, the gradual volume drop with distance (playback gain 1.0 beside the other player and about 0.16 at 6 m, following `(1 - distance/range)^2`; it reads the gain the page applies, not the sound itself), range revocation/restoration, mute/unmute, logout cleanup, and post-logout token rejection. It also checks the direction of the sound (ahead when facing the other player, to the side after a quarter turn, behind when turned away) and the two volume sliders (the voices slider halves the playback gain, the mic slider reaches the microphone processor, both saved and shown). `npm run e2e:lan` runs the same check through the LAN HTTPS edge on spare ports: the certificate and setup page over plain HTTP, the HTTPS certificate chain verified against the downloaded root (and refused without it), the voice address chaining to the same root, and voice over `wss://` through Caddy. Focused voice tests, workspace typechecks, production builds, and these runtime checks pass. The checks read the gains and positions the page applies; how it sounds is only confirmed by listening. Reconnect behavior remains explicit: gameplay disconnect tears down voice and requires the user to press Connect again after gameplay is restored.

For LAN deployment, use the optional `lan` edge together with the `voice` profile:

```text
SITE_ADDRESS=office.lan
VOICE_SITE_ADDRESS=voice.office.lan
LIVEKIT_URL=wss://voice.office.lan
LIVEKIT_API_URL=http://voice:7880
LIVEKIT_NODE_IP=192.168.1.10
LIVEKIT_RTC_TCP_PORT=7881
LIVEKIT_RTC_PORT_RANGE_START=50000
LIVEKIT_RTC_PORT_RANGE_END=50020
COOKIE_SECURE=true
docker compose --profile lan --profile voice up --build -d
```

The LAN edge listens on host ports 80/443, uses Caddy's persistent internal CA, and keeps the server-only Room Service URL on the Docker network. Make `office.lan` and `voice.office.lan` resolve to the host's LAN address (router DNS or each computer's hosts file), then onboard each client: open `http://office.lan` on it. That plain-HTTP page (the only thing served over HTTP; everything else is sent to HTTPS) has a **Download the certificate** button (`/ca.crt`, the public root certificate, never a key) and the install steps for Windows, macOS, Android/iPhone and Firefox. The same file is `/data/caddy/pki/authorities/local/root.crt` in the `caddy_data` volume. After installing it once, open `https://office.lan`. The edge image contains the web client it was built with, so rebuild it to give the LAN the current client. `npm run lan:rebuild` does this for a LAN stack that is already running: it reads that stack's settings (host names, ports, keys, passwords) from its containers into its own process, shows them with the secrets hidden, and changes nothing until you add `--yes` (`npm run lan:rebuild -- --yes`; the server restarts, so everybody online is disconnected for a minute, and the data and the certificate are kept). Open only HTTPS (80/443 as configured) and the LiveKit RTC TCP port plus the configured UDP range in the host firewall. `LIVEKIT_NODE_IP` must be the host's stable LAN address; do not use `localhost`.

The repository does not claim LAN verification merely from this configuration. First run `npm run check:lan` on the host; it checks the non-secret URL, address, port, secure-cookie, and credential prerequisites without printing secret values. Then repeat the two-browser check from two LAN clients through trusted HTTPS/WSS and the published RTC TCP/UDP path, and record certificate trust, firewall, ICE/media connectivity, browser errors, and logout/range cleanup. A Docker, certificate, firewall, or browser environment failure is a blocked check, not a source-code pass.

Health, inventory, holds, ragdoll/recovery, and medical contents remain session-only under the existing legacy world-save boundary.

## Real certificates instead (no client setup)

By default the LAN edge signs its certificates with Caddy's own CA, which every client has to trust once. With `LAN_TLS=cloudflare` it gets real, publicly trusted Let's Encrypt certificates for a domain you own, so browsers need nothing installed (the microphone needs a secure page, so this is also what makes voice work on every computer without warnings). The server need not be reachable from the internet: Caddy proves ownership with the DNS-01 challenge, briefly adding a TXT record to the domain's DNS through the Cloudflare API.

What it needs:

- A domain whose DNS is on **Cloudflare**, and two names under it, for example `office-sim.example.com` (the site) and `voice.office-sim.example.com` (voice). Let's Encrypt cannot certify `.internal`, `.local` or `.lan` names.
- A Cloudflare **API token** limited to the one zone, with Zone:DNS:Edit and Zone:Zone:Read. Keep it secret: it goes only in the server's `.env` as `CLOUDFLARE_API_TOKEN`.
- The office's own DNS answering those names with the server's LAN address (a small zone for just `office-sim.example.com` on the office DNS server, with `@` and `voice` A records). Nothing is added to the public DNS for them; the only public record is the short-lived `_acme-challenge` TXT that Caddy creates and removes itself. Caddy checks that record against public resolvers (`1.1.1.1`), because the office DNS is authoritative for the site names.
- If the HTTPS port is not 443, the voice address must include it: `LIVEKIT_URL=wss://voice.office-sim.example.com:8443`.

```text
LAN_TLS=cloudflare
CLOUDFLARE_API_TOKEN=<the token>
ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
SITE_ADDRESS=office-sim.example.com
VOICE_SITE_ADDRESS=voice.office-sim.example.com
LIVEKIT_URL=wss://voice.office-sim.example.com:8443
```

Try it first with the Let's Encrypt **staging** endpoint (`ACME_CA` above: no rate limits, but browsers do not trust its certificates), check the Caddy log for the certificate being obtained, then remove `ACME_CA` to get the real one. `npm run check:lan` checks the settings (a token that looks right, names under a real domain) without printing the token, and `npm run check:caddy` checks the edge's configuration in both modes without contacting Let's Encrypt or Cloudflare. In this mode the plain-HTTP port only redirects to HTTPS: there is no certificate download or setup page.
