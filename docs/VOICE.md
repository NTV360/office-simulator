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

## Authentication and proximity

`POST /api/voice/token` is protected by the same-origin and authenticated-session guards as the existing play ticket endpoint. The server derives the participant identity and display name from the authenticated account and the current `PlayerManager` session. A request with an unknown room, unavailable voice configuration, expired/disabled session, or account that still must choose a password is refused.

The returned JWT is short-lived and grants joining the office room, publishing microphone audio, and LiveKit's base permission to subscribe. It does not enable automatic subscription: `VoiceAclService` uses the trusted LiveKit Room Service API to list published audio tracks and grant/revoke each listener's subscriptions from server-authoritative positions on a bounded cadence, while the client uses `autoSubscribe: false` and requests only the tracks currently returned by the server. Because the installed LiveKit API does not let `UpdateSubscriptions` override `canSubscribe`, the base permission is required for this flow; proximity enforcement is application-level and a malicious client could otherwise request another room track. Proximity candidates are calculated from authoritative positions; browser-submitted coordinates are not accepted.

Logout, disconnect, grace expiry, manager replacement, and shutdown must clear any client connection and stale ACL state; the gameplay server remains usable when voice is disabled.

## Verification boundary

Automated coverage currently covers configuration gating, room validation, bounded proximity selection, token claims, TTL, and restricted grants in `apps/server/src/voice/voice.test.ts`. `scripts/e2e-voice.mjs` runs a disposable Docker/LiveKit two-browser check with fake microphones and verifies nearby remote tracks, the gradual volume drop with distance (playback gain 1.0 beside the other player and about 0.16 at 6 m, following `(1 - distance/range)^2`; it reads the gain the page applies, not the sound itself), range revocation/restoration, mute/unmute, logout cleanup, and post-logout token rejection. Focused voice tests, workspace typechecks, production builds, and this runtime check pass. Reconnect behavior remains explicit: gameplay disconnect tears down voice and requires the user to press Connect again after gameplay is restored.

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

The LAN edge listens on host ports 80/443, uses Caddy's persistent internal CA, and keeps the server-only Room Service URL on the Docker network. Install `/data/caddy/pki/authorities/local/root.crt` from the `caddy_data` volume on every client, then make `office.lan` and `voice.office.lan` resolve to the host's LAN address. Open only HTTPS (80/443 as configured) and the LiveKit RTC TCP port plus the configured UDP range in the host firewall. `LIVEKIT_NODE_IP` must be the host's stable LAN address; do not use `localhost`.

The repository does not claim LAN verification merely from this configuration. First run `npm run check:lan` on the host; it checks the non-secret URL, address, port, secure-cookie, and credential prerequisites without printing secret values. Then repeat the two-browser check from two LAN clients through trusted HTTPS/WSS and the published RTC TCP/UDP path, and record certificate trust, firewall, ICE/media connectivity, browser errors, and logout/range cleanup. A Docker, certificate, firewall, or browser environment failure is a blocked check, not a source-code pass.

Health, inventory, holds, ragdoll/recovery, and medical contents remain session-only under the existing legacy world-save boundary.
