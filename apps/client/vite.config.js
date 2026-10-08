import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The client imports the shared package straight from its TypeScript source, so there is nothing to build
// first and edits show up live. (The server uses the built output instead.)
const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

// Hosts such as Render tell the app which port to listen on through $PORT and expect it on
// 0.0.0.0, not localhost. `npm start` serves the production build (dist/) that way.
// allowedHosts: true lets the host's public name through; this server only serves static files.
export default defineConfig({
  resolve: { alias: { '@office/shared': shared } },
  server: { fs: { allow: ['../..'] } }, // the dev server may read the shared package outside apps/client
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
});
