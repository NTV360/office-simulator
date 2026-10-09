import { defineConfig, loadEnv } from 'vite';
import { makeApi } from './server/api.js';

// The BFF (server/api.js) runs inside Vite's dev and preview servers too, so `npm run dev` is still one
// command and the browser always calls /api on its own origin. Server env vars (no VITE_ prefix) are read
// from .env here and never reach the browser bundle. Restart the dev server after changing server/ code.
const bff = mode => {
  // a block body on purpose: Vite treats a function returned from these hooks as a post hook
  const mount = server => { server.middlewares.use('/api', makeApi({ ...loadEnv(mode, process.cwd(), ''), ...process.env })); };
  return { name: 'office-sim-bff', configureServer: mount, configurePreviewServer: mount };
};

// `npm run preview` serves the production build (dist/). Hosts such as Render pass the port in $PORT and
// expect 0.0.0.0; allowedHosts: true lets the host's public name through.
export default defineConfig(({ mode }) => ({
  plugins: [bff(mode)],
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
}));
