import { employeeById, fullName, jobTitle, roster } from '../people/roster.js';
import { fetchAttendanceSummary } from '../persistence/store.js';
import { people } from '../sim/state.js';
import { $ } from './dom.js';
import { select } from './person.js';

/* ================= Attendance tab ================= */
// An extra tab on the "On the floor" card: Absent (absent or no clock-in yet today, office time).
// From /api/attendance/summary, refreshed every two minutes. Click a name to open their card.
// Without the staff list the tab stays hidden.
const att = { data: null, tab: 'floor' };
const REFRESH_MS = 120000;

const dayLabel = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// One compact line per person: their name (hover for the department).
function row(userId) {
  const e = employeeById(userId); if (!e) return null;
  const p = people.find(q => q.userId === userId);
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.className = 'att-row'; b.title = `${fullName(e)} · ${jobTitle(e)}`;
  const n = document.createElement('span'); n.className = 'att-name'; n.textContent = fullName(e);
  b.append(n);
  if (p) b.onclick = () => select(p);
  li.append(b); return li;
}

function render() {
  const d = att.data, ready = !!d && !!roster.list;
  document.querySelectorAll('[data-ltab]').forEach(b => { if (b.dataset.ltab !== 'floor') b.hidden = !ready; b.setAttribute('aria-pressed', String(b.dataset.ltab === att.tab)); });
  if (!ready && att.tab !== 'floor') att.tab = 'floor';
  $('floorPane').hidden = att.tab !== 'floor'; $('attPane').hidden = att.tab === 'floor';
  if (!ready) return;
  $('attAbsentN').textContent = d.absent.length;
  if (att.tab === 'floor') return;
  const rows = d.absent.map(id => row(id)).filter(Boolean).sort((a, b) => a.textContent.localeCompare(b.textContent));
  $('attList').replaceChildren(...rows);
  $('attTitle').textContent = rows.length ? `Absent or didn\u2019t tap in · ${dayLabel(d.today)}` : `Everyone has tapped in · ${dayLabel(d.today)}`;
}

async function refresh() { const d = await fetchAttendanceSummary(); if (d) { att.data = d; render(); } }

function initAttendance() {
  document.querySelectorAll('[data-ltab]').forEach(b => b.onclick = () => { att.tab = b.dataset.ltab; render(); });
  render();
  if (!roster.list) return; // no staff list (API unavailable): just "On the floor"
  refresh(); setInterval(refresh, REFRESH_MS);
}

export { initAttendance };
