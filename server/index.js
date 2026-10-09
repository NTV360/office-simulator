import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeApi } from './api.js';

// Production server (`npm start`, used on Render): the built app from dist/ plus the API at /api.
// Hosts like Render pass the port in $PORT and expect the server on 0.0.0.0.
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = root + 'dist';
if (existsSync(root + '.env')) process.loadEnvFile(root + '.env'); // local runs; Render sets real env vars
if (!existsSync(dist + '/index.html')) { console.error('dist/ is missing: run `npm run build` first'); process.exit(1); }

const app = express();
app.disable('x-powered-by');
app.use('/api', makeApi(process.env));
app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, path) => { if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
app.get('/{*any}', (req, res) => res.sendFile(dist + '/index.html'));

const port = Number(process.env.PORT) || 4173;
app.listen(port, '0.0.0.0', () => console.log(`Office Floor Sim on http://localhost:${port} (Supabase ${process.env.SUPABASE_URL ? 'configured' : 'not configured'})`));
