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
  // For the attendance card: who is absent today (active employees with no clock-in today, office time) and
  // who did not tap out yesterday (their last record yesterday was closed automatically or is still open).
  r.get('/attendance/summary', async (req, res) => {
    const now = new Date(), today = officeDate(now), yesterday = officeDate(new Date(now.getTime() - 24 * 3600e3));
    const since = new Date(now.getTime() - 50 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const [{ data: atts, error }, { data: emps, error: empErr }] = await Promise.all([
      db.from('attendances').select('employee_id, clock_in, clock_out, clock_out_is_automatic').gte('clock_in', since).order('clock_in'),
      db.from('employees').select('user_id').is('deleted_at', null),
    ]);
    if (error) throw error;
    if (empErr) throw empErr;
    const inToday = new Set(), lastYesterday = new Map();
    for (const a of atts) {
      const day = officeDate(fromDbUtc(a.clock_in));
      if (day === today) inToday.add(a.employee_id);
      if (day === yesterday) lastYesterday.set(a.employee_id, a); // ordered by clock_in: the last one wins
    }
    const noTapOut = [...lastYesterday.values()].filter(a => !a.clock_out || a.clock_out_is_automatic).map(a => ({
      userId: a.employee_id, clockIn: fromDbUtc(a.clock_in).toISOString(), clockOut: a.clock_out ? fromDbUtc(a.clock_out).toISOString() : null, automatic: !!a.clock_out_is_automatic,
    }));
    res.json({ today, yesterday, absent: emps.map(e => e.user_id).filter(id => !inToday.has(id)), noTapOut });
  });

  return r;
}

export { attendanceRoutes };
