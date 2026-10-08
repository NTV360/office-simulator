import { defineConfig } from 'vite';

// Hosts such as Render tell the app which port to listen on through $PORT and expect it on
// 0.0.0.0, not localhost. `npm start` serves the production build (dist/) that way.
// allowedHosts: true lets the host's public name through; this server only serves static files.
export default defineConfig({
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
});
