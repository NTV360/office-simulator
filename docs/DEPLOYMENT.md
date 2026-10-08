# Deployment

The app is a static site: `npm run build` produces `dist/` (HTML, JS, CSS, the logo), and nothing needs a server beyond serving those files. The repo is set up to run on Render either as a **Static Site** or as a **Web Service**.

## Render: Web Service

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Node version | from `.node-version` (22), or set the `NODE_VERSION` environment variable |
| Environment variables | none needed (Render supplies `PORT`) |

`npm start` runs `vite preview`, configured in [`vite.config.js`](../vite.config.js) to listen on `0.0.0.0` and on the port in `$PORT`, and to accept the service's public hostname.

## Render: Static Site (simpler)

Because there is no server-side code, a Static Site is the lighter choice: no server process, no port.

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Publish directory | `dist` |

## Run the production build locally

```
npm run build
npm start                 # http://localhost:4173
PORT=8080 npm start       # pick a port the way Render does
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No open ports detected on 0.0.0.0` | The start command is not serving on `$PORT` on all interfaces. Use `npm start`. Do **not** use `npm run dev` (the dev server listens on `localhost:5173` only) or `npm run build` alone (it exits) |
| `vite: not found` during the build | `vite` must be in `dependencies`, not `devDependencies`, because Render installs with `NODE_ENV=production`. It is; do not move it back |
| `Blocked request. This host is not allowed` | The preview server rejected the public hostname. `preview.allowedHosts` in `vite.config.js` must stay `true` (or list your domain) |
| Build fails with a Node version error | Vite 8 needs Node `^20.19.0` or `>=22.12.0` (set in `engines` and `.node-version`). Make sure Render is not overriding it with an older `NODE_VERSION` |
| Blank page after a successful deploy | Open the browser console. Check the build output has an `assets/` folder and that `index.html` is being served from `dist` (Static Site: publish directory must be `dist`) |

## Notes

- `window.__sim` (the debug hook) is still included in production builds. See [ROADMAP.md](ROADMAP.md).
- The production JavaScript is a single ~600 KB chunk (about 160 KB gzipped). Render serves it compressed.
