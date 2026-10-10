# Deployment

The app is the built front end (`npm run build` → `dist/`) plus a small Node server, the **BFF** (`server/`). The server serves `dist/` and answers `/api/...`, and it is the only part that talks to Supabase. The browser never sees the Supabase URL or keys. Deploy it as a **Web Service**; a Static Site can't run the API.

## Render: Web Service

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` (runs `node server/index.js`) |
| Node version | from `.node-version` (22), or set the `NODE_VERSION` environment variable |
| Environment variables | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Render supplies `PORT`) |

The server listens on `0.0.0.0` and on the port in `$PORT`. Without the Supabase variables the app still runs: `/api/health` reports `"supabase": false`, the other API calls answer 503, and players' looks are kept only in their browser.

## Supabase

1. Run the SQL in `supabase/migrations/` (SQL editor, or `supabase db push` with the Supabase CLI). It creates the tables with Row Level Security **on and no policies**, so only the server's secret key can read or write them.
2. Put the project URL and the **secret** key (or the legacy `service_role` key) in `.env` locally (copy `.env.example`) and in Render's environment settings. These are server-only: never give them a `VITE_` prefix, which would put them in the browser bundle.

## Run the production build locally

```
npm run build
npm start                 # http://localhost:4173, server + API, reads .env
PORT=8080 npm start       # pick a port the way Render does
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No open ports detected on 0.0.0.0` | The start command is not serving on `$PORT` on all interfaces. Use `npm start`. Do **not** use `npm run dev` (the dev server listens on `localhost:5173` only) or `npm run build` alone (it exits) |
| `dist/ is missing` on start | The build command did not run `npm run build` |
| `/api/...` answers 503 | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are not set on the service |
| `/api/...` answers 500 | See the service log (`[api]` lines): usually a wrong key, or the migration has not been run |
| `vite: not found` during the build | `vite` must be in `dependencies`, not `devDependencies`, because Render installs with `NODE_ENV=production`. It is; do not move it back |
| `Blocked request. This host is not allowed` | Only with `vite preview`: `preview.allowedHosts` in `vite.config.js` must stay `true` (or list your domain). `npm start` does not use Vite |
| Build fails with a Node version error | Vite 8 needs Node `^20.19.0` or `>=22.12.0` (set in `engines` and `.node-version`). Make sure Render is not overriding it with an older `NODE_VERSION` |
| Blank page after a successful deploy | Open the browser console. Check the build output has an `assets/` folder and that `index.html` is being served from `dist` (Static Site: publish directory must be `dist`) |

## Notes

- `window.__sim` (the debug hook) is still included in production builds. See [ROADMAP.md](ROADMAP.md).
- The production JavaScript is a single ~850 KB chunk (about 230 KB gzipped). Render serves it compressed.
