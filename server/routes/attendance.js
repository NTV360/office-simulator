import { Router } from 'express';
import { fromDbUtc, officeDate } from '../../src/config/office.js';

// Who is in the office: each employee's latest attendance from the last 20 hours (long enough to cover a
// night shift that started yesterday). Clocked in and not out = in the office; clocked out = gone home;
// no record = not in today. Only the times leave the server.
const WINDOW_HOURS = 20;

function attendanceRoutes(db) {
  const r = Router();
  r.get('/attendance', async (req, res) => {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const { data, error } = await db.from('attendances').select('employee_id, clock_in, clock_out')
      .gte('clock_in', since).order('clock_in', { ascending: false });
    if (error) throw error;
    const latest = new Map();
    for (const a of data) if (!latest.has(a.employee_id)) latest.set(a.employee_id, a);
    res.json({ now: new Date().toISOString(), records: [...latest.values()].map(a => ({
      userId: a.employee_id, clockIn: fromDbUtc(a.clock_in)?.toISOString() ?? null, clockOut: fromDbUtc(a.clock_out)?.toISOString() ?? null,
    })) });
  });
  // For the attendance tab: who is absent today (active employees with no clock-in today, office time).
  r.get('/attendance/summary', async (req, res) => {
    const now = new Date(), today = officeDate(now);
    const since = new Date(now.getTime() - 26 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const [{ data: atts, error }, { data: emps, error: empErr }] = await Promise.all([
      db.from('attendances').select('employee_id, clock_in').gte('clock_in', since),
      db.from('employees').select('user_id').is('deleted_at', null),
    ]);
    if (error) throw error;
    if (empErr) throw empErr;
    const inToday = new Set(atts.filter(a => officeDate(fromDbUtc(a.clock_in)) === today).map(a => a.employee_id));
    res.json({ today, absent: emps.map(e => e.user_id).filter(id => !inToday.has(id)) });
  });

  return r;
}

export { attendanceRoutes };
