import { people } from '@office/shared';
import { $ } from './dom.js';
import { select } from './person.js';

/* ================= Attendance tab ================= */
// An extra tab on the "On the floor" card: who is absent, or has not tapped in, today (office time). It is read from the server (GET /api/attendance/summary:
// names only, for signed-in players), when you are in the office, and refreshed every two minutes. Click a name to open their card (if they are in the
// office). Without a staff list on the server the tab stays hidden.
const att = { data: null, tab: 'floor', timer: null, base: '', busy: false };
const REFRESH_MS = 120000;

const dayLabel = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// One compact line per person: their name.
function row(name) {
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.className = 'att-row'; b.title = name;
  const n = document.createElement('span'); n.className = 'att-name'; n.textContent = name; // (text, never markup)
  b.append(n);
  b.onclick = () => { const p = people.find(q => q.name === name); if (p) select(p); };
  li.append(b); return li;
}

function render() {
  const d = att.data, ready = !!d;
  document.querySelectorAll('[data-ltab]').forEach(b => { if (b.dataset.ltab !== 'floor') b.hidden = !ready; b.setAttribute('aria-pressed', String(b.dataset.ltab === att.tab)); });
  if (!ready && att.tab !== 'floor') att.tab = 'floor';
  $('floorPane').hidden = att.tab !== 'floor'; $('attPane').hidden = att.tab === 'floor';
  if (!ready) return;
  $('attAbsentN').textContent = d.absent.length;
  if (att.tab === 'floor') return;
  $('attList').replaceChildren(...[...d.absent].sort((a, b) => a.localeCompare(b)).map(row));
  $('attTitle').textContent = d.absent.length ? `Absent or didn’t tap in · ${dayLabel(d.today)}` : `Everyone has tapped in · ${dayLabel(d.today)}`;
}

async function refresh() {
  if (att.busy) return;
  att.busy = true;
  try {
    const r = await fetch(`${att.base}/api/attendance/summary`, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
    const d = r.ok ? await r.json() : null;
    att.data = d && typeof d.today === 'string' && Array.isArray(d.absent) ? { today: d.today, absent: d.absent.filter(n => typeof n === 'string') } : null;
  } catch { att.data = null; } finally { att.busy = false; }
  render();
}

/** `base` is where /api lives. The tab only reads while `setActive(true)` (we are in the office: the route needs a signed-in account). */
function initAttendance({ base = '' } = {}) {
  att.base = base;
  document.querySelectorAll('[data-ltab]').forEach(b => { b.onclick = () => { att.tab = b.dataset.ltab; render(); }; });
  render();
  return {
    setActive(on) {
      clearInterval(att.timer); att.timer = null;
      if (on) { void refresh(); att.timer = setInterval(refresh, REFRESH_MS); }
      else { att.data = null; att.tab = 'floor'; render(); } // (nothing from one login is left for the next)
    },
  };
}

export { initAttendance };
