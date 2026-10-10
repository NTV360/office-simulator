import { Router } from 'express';
import { normalizeSpec } from '../../src/character/spec.js';
import { deskSeat } from '../../src/config/desks.js';

// The office staff: active employees with their department, saved character look and chosen desk
// (both kept in character_information.character_data, the desk as its `desk` field, e.g. 'A3'), plus their
// profile picture URL. Only names and department leave the server; contact details,
// birth dates, emergency contacts, RFID values and access roles stay in the database.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Employment types whose code or description says intern/OJT. If the table can't be read (no grant yet),
// nobody is marked as an intern rather than failing the whole staff list.
async function internTypes(db) {
  const { data, error } = await db.from('employment_types').select('employment_type_id, code, description');
  if (error) { console.warn('[api] employment_types unreadable, no interns marked:', error.message); return new Set(); }
  return new Set(data.filter(t => /intern|ojt|trainee/i.test(`${t.code} ${t.description ?? ''}`)).map(t => t.employment_type_id));
}

// Shift times as minutes since midnight: { code: 'DAY', start: 540, end: 1080 }. A shift that ends after
// midnight (NIGHT 21:00-06:00) has end < start. Unreadable table: no shifts (everyone works the default day).
async function shiftTimes(db) {
  const { data, error } = await db.from('shifts').select('shift_id, code, start_time, end_time');
  if (error) { console.warn('[api] shifts unreadable, default hours used:', error.message); return new Map(); }
  const mins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  return new Map(data.map(s => [s.shift_id, { code: s.code, start: mins(s.start_time), end: mins(s.end_time) }]));
}

// The profile picture URL from employees.metadata (only an https link; nothing else from metadata is sent).
function profileImage(metadata) {
  let m = metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return null; } }
  const url = m?.profileImage;
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

function employeeRoutes(db) {
  const r = Router();

  r.get('/employees', async (req, res) => {
    const { data: rows, error } = await db.from('employees')
      .select('user_id, first_name, last_name, employment_type_id, shift_id, metadata, department:departments(name)')
      .is('deleted_at', null).order('first_name');
    if (error) throw error;
    const interns = await internTypes(db), shifts = await shiftTimes(db);
    const { data: looks, error: lookErr } = await db.from('character_information').select('user_id, character_data');
    if (lookErr) throw lookErr;
    const lookOf = new Map(looks.map(l => [l.user_id, l.character_data]));
    res.json(rows.map(e => ({
      userId: e.user_id, firstName: e.first_name, lastName: e.last_name,
      photo: profileImage(e.metadata), department: e.department?.name ?? null, intern: interns.has(e.employment_type_id), shift: shifts.get(e.shift_id) ?? null,
      character: lookOf.has(e.user_id) ? normalizeSpec(lookOf.get(e.user_id)) : null,
      desk: deskSeat(lookOf.get(e.user_id)?.desk)?.id ?? null,
    })));
  });

  // Save an employee's look and desk: { character, desk } (desk: a seat id from config/desks.js, or null for
  // "any free desk"). The look is validated with normalizeSpec; a desk someone else chose is refused (409).
  r.put('/characters/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!UUID.test(userId)) return res.status(400).json({ error: 'Invalid user id' });
    if (!req.body || typeof req.body.character !== 'object') return res.status(400).json({ error: 'Body must be { character }' });
    const { data: emp, error: empErr } = await db.from('employees').select('user_id').eq('user_id', userId).is('deleted_at', null).maybeSingle();
    if (empErr) throw empErr;
    if (!emp) return res.status(404).json({ error: 'No such employee' });
    const desk = req.body.desk == null ? null : deskSeat(req.body.desk)?.id;
    if (desk === undefined) return res.status(400).json({ error: 'Unknown desk' });
    if (desk) {
      const { data: taken, error: takenErr } = await db.from('character_information').select('user_id').eq('character_data->>desk', desk).neq('user_id', userId).limit(1);
      if (takenErr) throw takenErr;
      if (taken.length) return res.status(409).json({ error: `Desk ${desk} is already taken` });
    }
    const character = normalizeSpec(req.body.character);
    const { error } = await db.from('character_information').upsert({ user_id: userId, character_data: { ...character, desk }, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ userId, character, desk });
  });

  return r;
}

export { employeeRoutes };
