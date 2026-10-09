import express from 'express';
import { attendanceRoutes } from './routes/attendance.js';
import { employeeRoutes } from './routes/employees.js';
import { makeSupabase } from './supabase.js';

// The BFF (backend for frontend): the only part of the app that talks to Supabase. The browser calls /api/...
// on our own origin and never sees the Supabase URL or keys. Mounted at /api by server/index.js in
// production and by the Vite dev server in development (vite.config.js).
function makeApi(env) {
  const api = express(), db = makeSupabase(env);
  api.disable('x-powered-by');
  api.use(express.json({ limit: '16kb' }));

  api.get('/health', (req, res) => res.json({ ok: true, supabase: !!db }));
  api.use((req, res, next) => (db ? next() : res.status(503).json({ error: 'Supabase is not configured on the server' })));
  api.use(employeeRoutes(db));
  api.use(attendanceRoutes(db));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // Express 5 sends errors thrown in async handlers here. Log the detail; don't leak it to the browser.
  api.use((err, req, res, next) => {
    console.error('[api]', req.method, req.originalUrl, err);
    if (res.headersSent) return next(err);
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'Server error' });
  });
  return api;
}

export { makeApi };
