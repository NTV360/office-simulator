import './admin.css';
import { deskSeats } from '@office/shared';

// The admin page (/admin). One password (the server's ADMIN_TOKEN); with it you make accounts, hand out and reset passwords,
// disable people, and give or take desks. Plain DOM, and only ever text (nothing from the server is put in as HTML).
//
// Passwords are kept on the server only as one-way hashes, so nobody can look one up. What this page can do is SET a password
// (typed or generated) and show it to you ONCE, at that moment, to read out or print. The person then chooses their own.

const KEY = 'officeAdminPassword';
const app = document.getElementById('app');
let password = '';
try { password = sessionStorage.getItem(KEY) || ''; } catch { /* storage may be blocked: then you type it each visit */ }
const remember = v => { password = v; try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* fine */ } };

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
};

async function api(method, path, body) {
  const r = await fetch('/api/admin' + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + password }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const problem = r => (r.body && r.body.message) || `Something went wrong (${r.status}).`;

/** Copy text. (navigator.clipboard needs https; this page is often plain http on the office network, so fall back.) */
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  const t = el('textarea'); t.style.position = 'fixed'; t.style.left = '-9999px'; t.value = text; document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* no */ } t.remove(); return ok;
}
const csv = rows => rows.map(r => r.map(c => /[",\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? '')).join(',')).join('\n') + '\n';
function download(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const when = d => (d ? new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never');

// ---------------------------------------------------------------- login
function showLogin(note = '') {
  employees = null; importInfo = null; settings = null; ui.linkPick.clear(); ui.staffFilter = ''; // (nothing from the last login stays)
  const pass = el('input', { type: 'password', id: 'adminPassword', autocomplete: 'current-password', required: true });
  const msg = el('p', { class: 'a-note', role: 'alert' }, note);
  const form = el('form', { class: 'a-card a-login' },
    el('h2', {}, 'Admin'), el('p', {}, 'Type the admin password.'),
    el('label', {}, 'Password', pass), msg,
    el('button', { type: 'submit', class: 'a-btn primary' }, 'Enter'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    remember(pass.value); pass.value = '';
    await start();
  });
  app.replaceChildren(form);
  pass.focus();
}

// ---------------------------------------------------------------- state and data
let accounts = [], slots = [], audit = [], settings = null;
/** The staff list (null: the server has none, e.g. no database) and what the last import did. */
let employees = null, importInfo = null;
const SEATS = deskSeats();
const ui = { filter: '', panel: new Map(), picked: new Map(), armed: null, staffFilter: '', linkPick: new Map() };
let tableHost, statsHost, bulkResult, auditHost, officeHost, staffHost;

async function load() {
  const [u, s] = await Promise.all([api('GET', '/users'), api('GET', '/slots')]);
  if (u.status !== 200 || s.status !== 200) return u.status !== 200 ? u : s;
  accounts = u.body; slots = s.body;
  const a = await api('GET', '/audit?limit=100'); // (the log is a nice-to-have: the page works without it)
  audit = a.status === 200 ? a.body : [];
  const st = await api('GET', '/settings');
  settings = st.status === 200 ? st.body : null;
  const em = await api('GET', '/employees'), im = await api('GET', '/import');
  employees = em.status === 200 ? em.body : null;
  importInfo = im.status === 200 ? im.body : null;
  return null;
}
/** A desk by name: its island and its number, e.g. "Table B · seat 9" (every desk gets a different one). */
const deskLabel = s => `${s.place.charAt(0).toUpperCase()}${s.place.slice(1)} · seat ${s.spot.split(":")[1]}`;
const slotOf = spot => slots.find(s => s.spot === spot);
const freeDesks = () => slots.filter(s => s.status === 'unclaimed');

async function start() {
  if (!password) return showLogin();
  let failed;
  try { failed = await load(); } catch { remember(''); return showLogin('Cannot reach the server. Try again in a moment.'); }
  if (failed) {
    remember('');
    return showLogin(failed.status === 403 ? 'Wrong password.' : failed.status === 429 ? 'Too many wrong tries. Wait a minute and try again.'
      : failed.status === 404 ? 'The admin page is switched off on this server (no admin password is set).' : problem(failed));
  }
  showMain();
}

// ---------------------------------------------------------------- the page
function showMain() {
  statsHost = el('span', { class: 'a-stats', id: 'adminStats' });
  tableHost = el('div', { id: 'adminAccounts' });
  const refresh = el('button', { type: 'button', class: 'a-btn', id: 'adminRefresh', onclick: async () => { await reload(); } }, 'Refresh');
  const logout = el('button', { type: 'button', class: 'a-btn', id: 'adminLogout', onclick: () => { remember(''); ui.panel.clear(); ui.picked.clear(); accounts = []; audit = []; showLogin(); } }, 'Log out');
  bulkResult = el('div', { id: 'bulkResult' });
  auditHost = el('div', { id: 'adminAudit' });
  officeHost = el('section', { class: 'a-card', id: 'adminOffice' });
  staffHost = el('section', { class: 'a-card', id: 'adminStaff' });
  app.replaceChildren(
    el('div', { class: 'a-top' }, el('h1', {}, 'Office Floor Sim · Admin'), statsHost, refresh, logout),
    officeHost,
    staffHost,
    makeCard(),
    el('section', { class: 'a-card' },
      el('h2', {}, 'Accounts'),
      el('p', {}, 'Passwords are kept as one-way hashes, so an existing password cannot be looked up. Set a new one and it is shown to you once; the person then chooses their own.'),
      el('input', { type: 'text', class: 'a-search', id: 'adminFilter', placeholder: 'Search by name…', 'aria-label': 'Search accounts', oninput: e => { ui.filter = e.target.value; drawTable(); } }),
      tableHost),
    el('section', { class: 'a-card' },
      el('h2', {}, 'Recent activity'),
      el('p', {}, 'What admins have done here, newest first (the last 100). Passwords are never written to it.'),
      auditHost));
  drawAll();
}

async function reload() {
  let failed;
  try { failed = await load(); } catch { return; }
  if (failed) { remember(''); return showLogin(failed.status === 403 ? 'Wrong password.' : problem(failed)); }
  drawAll();
}
function drawAll() { drawStats(); drawOffice(); drawStaff(); drawTable(); drawAudit(); }

const ACTIONS = {
  'account.create': 'Made an account', 'account.bulk-create': 'Made accounts', 'password.set': 'Set a password', 'account.disable': 'Disabled an account',
  'account.enable': 'Enabled an account', 'account.mute': 'Muted an account', 'account.unmute': 'Unmuted an account', 'desk.assign': 'Gave a desk', 'desk.release': 'Took a desk away', 'settings.update': 'Changed settings', 'employees.import': 'Imported the employee records', 'employee.link': 'Linked an account to an employee', 'employee.unlink': 'Unlinked an account from an employee', 'employee.desk': 'Chose an employee\'s desk', announce: 'Sent an announcement',
};
function drawAudit() {
  const rows = audit.map(l => {
    const d = l.detail && typeof l.detail === 'object' ? l.detail : {};
    const extra = Object.entries(d).filter(([k]) => k !== 'ip').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
    return el('tr', { 'data-action': l.action },
      el('td', { class: 'hide-s' }, when(l.at)), el('td', {}, ACTIONS[l.action] || l.action), el('td', { class: 'mono' }, l.target || ''), el('td', {}, extra), el('td', { class: 'hide-s mono' }, d.ip || ''));
  });
  auditHost.replaceChildren(rows.length
    ? el('div', { class: 'a-scroll' }, el('table', { class: 'a-table' },
      el('thead', {}, el('tr', {}, ['When', 'What', 'Who', 'Details', 'From'].map((h, i) => el('th', { class: i === 0 || i === 4 ? 'hide-s' : '' }, h)))), el('tbody', {}, rows)))
    : el('p', {}, 'Nothing yet.'));
}

/** The simulated office: how many people it has (never fewer than the accounts' desks), the clock speed, pause. */
function drawOffice() {
  if (!settings) { officeHost.replaceChildren(); return; }
  const claimed = slots.filter(s => s.status === 'claimed').length;
  const count = el('input', { type: 'number', id: 'officeSlots', min: String(claimed), max: String(settings.maxSlots), step: '1', value: String(settings.slots), 'aria-label': 'People in the office' });
  const speed = el('select', { id: 'officeSpeed', 'aria-label': 'Clock speed' }, [0.25, 0.5, 1, 2, 3, 5, 8].map(v => el('option', { value: String(v), selected: v === settings.speed }, v + 'x')));
  const paused = el('input', { type: 'checkbox', id: 'officePaused', checked: settings.paused });
  const note = el('p', { class: 'a-note', role: 'alert' });
  const save = el('button', { type: 'button', class: 'a-btn primary', id: 'officeSave' }, 'Save');
  save.addEventListener('click', async () => {
    note.className = 'a-note'; note.textContent = '';
    const n = Number(count.value);
    if (!Number.isInteger(n) || n < 0 || n > settings.maxSlots) { note.textContent = `People must be a whole number from 0 to ${settings.maxSlots}.`; return; }
    save.disabled = true;
    const r = await api('PUT', '/settings', { slots: n, speed: Number(speed.value), paused: paused.checked });
    save.disabled = false;
    if (r.status !== 200) { note.textContent = problem(r); return; }
    await reload();
    const again = document.getElementById('officeNote');
    if (again) { again.className = 'a-note a-ok'; again.textContent = 'Saved.'; }
  });
  note.id = 'officeNote';
  officeHost.replaceChildren(
    el('h2', {}, 'The office'),
    el('p', {}, `People in the simulated office (up to ${settings.maxSlots}, one per desk). People with an account always stay; lowering the number only removes people nobody owns. Everyone online sees a change at once.`),
    el('div', { class: 'a-row' },
      el('label', { class: 'a-field' }, 'People', count), el('label', { class: 'a-field' }, 'Clock speed', speed),
      el('label', { class: 'a-row' }, paused, 'Paused'), save),
    note,
    clockControls());
}

/** Simulate or Live: one clock for the whole office. Choosing restarts the day (everyone is seated as the new clock says), so it asks first. */
function clockControls() {
  const note = el('span', { class: 'a-note', id: 'clockNote', role: 'alert' });
  const choose = (label, id, body, pressed) => {
    const b = sure(label, id, async () => {
      const r = await api('PUT', '/settings', body);
      if (r.status !== 200) { note.textContent = problem(r); return; }
      await reload();
    }, pressed ? 'a-btn primary' : 'a-btn');
    b.setAttribute('aria-pressed', String(pressed));
    return b;
  };
  const isLive = settings.clockMode === 'live';
  return el('div', { id: 'adminClock' },
    el('h3', {}, 'The clock'),
    el('p', {}, isLive
      ? `Live: the real time in the office's time zone${settings.attendance ? ', and who is clocked in' : ' (the employee records are not readable, so everyone follows their shift)'}. There is no speed.`
      : 'Simulate: the office runs its own faster day. Live follows the real time and who is clocked in.'),
    el('div', { class: 'a-row' },
      choose('Simulate from the morning', 'clock-day', { clockMode: 'sim', simStart: 'day' }, false),
      choose('Simulate from the night', 'clock-night', { clockMode: 'sim', simStart: 'night' }, false),
      choose('Live', 'clock-live', { clockMode: 'live' }, isLive),
      note));
}

// ---------------------------------------------------------------- the staff list
const ago = d => (d ? when(d) : 'never');
const DASH = '\u2014';

/** The staff list: where each employee sits, which account plays them, and the import from the company's records. */
function drawStaff() {
  if (employees === null) {
    staffHost.replaceChildren(el('h2', {}, 'Staff'), el('p', {}, 'The staff list is not available (the server has no database).'));
    return;
  }
  const info = importInfo;
  const note = el('p', { class: 'a-note', role: 'alert', id: 'staffNote' });
  const runImport = async force => {
    note.textContent = '';
    const r = await api('POST', '/import', force ? { force: true } : {});
    if (r.status >= 300) note.textContent = problem(r);
    await reload();
  };
  let status;
  if (!info || !info.configured) status = 'The employee records are not connected (SUPABASE_URL and SUPABASE_SECRET_KEY are not set). What is stored stays as it is.';
  else if (info.lastImportOk === null) status = 'Not imported yet.';
  else if (info.lastImportOk) { const r = info.lastResult; status = `Imported ${ago(info.lastImportAt)}${r ? `: ${r.added} new, ${r.updated} changed, ${r.removed} gone, ${r.restored} back` : ''}.`; }
  else status = `The last import (${ago(info.lastImportAt)}) failed and changed nothing: ${info.lastImportError}`;
  if (info && info.configured && info.lastAttendanceOk === false) status += ` Who is clocked in could not be read (${info.lastAttendanceError}).`;
  const head = el('div', { class: 'a-row' },
    el('p', { id: 'importStatus' }, status),
    info && info.configured && el('button', { type: 'button', class: 'a-btn', id: 'importNow', onclick: () => runImport(false) }, 'Import now'),
    info && info.configured && info.lastImportOk === false && /import anyway/.test(info.lastImportError || '') && sure('Import anyway', 'import-force', () => runImport(true)));

  const q = ui.staffFilter.trim().toLowerCase();
  const list = employees.filter(e => !q || e.name.toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q));
  const linkable = accounts.filter(a => !a.employeeId && !a.slotSpot).sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  const body = el('tbody');
  for (const e of list) {
    const rowNote = el('span', { class: 'a-note' });
    const takenByOthers = new Set(employees.filter(x => x.userId !== e.userId && x.desk).map(x => x.desk));
    const seats = SEATS.filter(s => (!s.island.department || s.island.department === e.department) && !takenByOthers.has(s.id));
    const current = SEATS.find(s => s.id === e.desk);
    if (current && !seats.includes(current)) seats.unshift(current); // (the desk they have is always shown, whatever the rules)
    const deskSel = el('select', { 'aria-label': `Desk for ${e.name}`, 'data-desk': e.name },
      el('option', { value: '' }, DASH + ' any free desk ' + DASH),
      seats.map(s => el('option', { value: s.id, selected: s.id === e.desk }, s.label)));
    deskSel.addEventListener('change', async () => {
      const r = await api('PUT', `/employees/${e.userId}`, { desk: deskSel.value || null });
      if (r.status >= 300) { rowNote.textContent = problem(r); return; }
      await reload();
    });
    let accountCell;
    if (e.account) {
      accountCell = el('div', { class: 'a-row' }, el('span', { class: 'mono', 'data-linked': e.account.username }, e.account.username),
        sure('Unlink', 'unlink', () => act(() => api('POST', `/users/${e.account.id}/employee`, { employeeId: null }), rowNote)));
    } else {
      if (!linkable.some(a => String(a.id) === ui.linkPick.get(e.userId))) ui.linkPick.delete(e.userId); // (the account may have been linked elsewhere since)
      const sel = el('select', { 'aria-label': `Account for ${e.name}`, 'data-link': e.name },
        el('option', { value: '' }, DASH + (linkable.length ? ' no account ' : ' no free account ') + DASH),
        linkable.map(a => el('option', { value: String(a.id), selected: ui.linkPick.get(e.userId) === String(a.id) }, a.username)));
      sel.addEventListener('change', () => ui.linkPick.set(e.userId, sel.value));
      accountCell = el('div', { class: 'a-row' }, sel, el('button', { type: 'button', class: 'a-btn', 'data-do': 'link', onclick: () => {
        const id = ui.linkPick.get(e.userId);
        if (id) { ui.linkPick.delete(e.userId); act(() => api('POST', `/users/${id}/employee`, { employeeId: e.userId }), rowNote); }
      } }, 'Link'));
    }
    body.append(el('tr', { 'data-employee': e.name },
      el('td', {}, e.name, e.intern && el('span', { class: 'a-chip' }, 'intern'), !e.inOffice && el('span', { class: 'a-chip warn' }, 'not in the office')),
      el('td', { class: 'hide-s' }, e.department || ''), el('td', {}, deskSel), el('td', {}, accountCell, rowNote)));
  }
  if (!list.length) body.append(el('tr', {}, el('td', { colspan: '4' }, employees.length ? 'No one matches.' : 'No employees yet.')));
  staffHost.replaceChildren(
    el('h2', {}, 'Staff'),
    el('p', {}, 'The employees of the office, imported (read-only) from the company\'s records. Link an account to an employee and that person plays them: their name, look, desk and shift. The desk and the look chosen here are kept and an import never overwrites them.'),
    head, note,
    el('input', { type: 'text', class: 'a-search', id: 'staffFilter', placeholder: 'Search by name or department\u2026', 'aria-label': 'Search staff', value: ui.staffFilter, oninput: e => { ui.staffFilter = e.target.value; drawStaff(); const f = document.getElementById('staffFilter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } } }),
    el('div', { class: 'a-scroll' }, el('table', { class: 'a-table' },
      el('thead', {}, el('tr', {}, ['Employee', 'Department', 'Desk', 'Account'].map((h, i) => el('th', { class: i === 1 ? 'hide-s' : '' }, h)))), body)));
}

function drawStats() {
  const withDesk = accounts.filter(a => a.slotSpot).length;
  statsHost.textContent = `${accounts.length} accounts · ${withDesk} with a desk · ${accounts.filter(a => a.online).length} online · ${freeDesks().length} desks free`;
}

// ---------------------------------------------------------------- making accounts
function makeCard() {
  const names = el('textarea', { id: 'bulkNames', placeholder: 'ana.reyes\nben.cruz\n…', spellcheck: 'false', autocapitalize: 'none', 'aria-label': 'Usernames, one per line' });
  const desk = el('input', { type: 'checkbox', id: 'bulkDesk' });
  const note = el('p', { class: 'a-note', role: 'alert' });
  const go = el('button', { type: 'button', class: 'a-btn primary', id: 'bulkGo' }, 'Make accounts');
  go.addEventListener('click', async () => {
    const list = names.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    note.textContent = '';
    if (!list.length) { note.textContent = 'Type at least one username (letters, digits, dot, dash or underscore, 3 to 24 characters).'; return; }
    go.disabled = true; note.className = 'a-note'; note.textContent = 'Working…';
    try {
      const results = [];
      for (let i = 0; i < list.length; i += 200) {
        const r = await api('POST', '/users/bulk', { usernames: list.slice(i, i + 200) });
        if (r.status !== 201) { note.textContent = problem(r); return; }
        results.push(...r.body.results);
      }
      if (desk.checked) await giveDesks(results);
      names.value = '';
      showResults(results);
      note.textContent = '';
      await reload();
    } catch { note.textContent = 'Cannot reach the server. Try again in a moment.'; } finally { go.disabled = false; }
  });
  return el('section', { class: 'a-card' },
    el('h2', {}, 'Make accounts'),
    el('p', {}, 'One username per line. Each gets a generated first password, shown once below, which they replace at their first login.'),
    el('label', { class: 'a-field' }, 'Usernames', names),
    el('label', { class: 'a-row' }, desk, 'Also give each a free desk, in order'),
    el('div', { class: 'a-row' }, go), note, bulkResult);
}

/** Give each new account the next free desk. Fills in result.desk. */
async function giveDesks(results) {
  const s = await api('GET', '/slots');
  const free = s.status === 200 ? s.body.filter(x => x.status === 'unclaimed') : [];
  for (const r of results) {
    if (!r.ok) continue;
    const d = free.shift();
    if (!d) { r.desk = ''; r.deskNote = 'no free desk'; continue; }
    const a = await api('POST', `/users/${r.id}/assign-slot`, { spot: d.spot });
    if (a.status === 201) r.desk = deskLabel(d); else { r.desk = ''; r.deskNote = problem(a); }
  }
}

function showResults(results) {
  const made = results.filter(r => r.ok);
  const rows = [['username', 'password', 'desk'], ...made.map(r => [r.username, r.password, r.desk ?? ''])];
  const table = el('table', { class: 'a-table', id: 'bulkTable' },
    el('thead', {}, el('tr', {}, ['Username', 'First password', 'Desk', 'Result'].map(h => el('th', {}, h)))),
    el('tbody', {}, results.map(r => el('tr', {},
      el('td', { class: 'mono' }, r.username),
      el('td', {}, r.ok ? el('span', { class: 'a-pw' }, r.password) : ''),
      el('td', {}, r.ok ? (r.desk || r.deskNote || '') : ''),
      el('td', {}, r.ok ? el('span', { class: 'a-chip on' }, 'made') : el('span', { class: 'a-chip bad' }, r.message || r.code))))));
  const copied = el('span', { class: 'a-ok' });
  bulkResult.replaceChildren(
    el('h2', {}, `${made.length} made, ${results.length - made.length} not`),
    el('p', {}, 'These passwords are shown only now. Copy or download them before you leave this page.'),
    el('div', { class: 'a-row' },
      el('button', { type: 'button', class: 'a-btn', id: 'bulkCopy', onclick: async () => { copied.textContent = (await copyText(csv(rows))) ? 'Copied.' : 'Could not copy; use Download.'; } }, 'Copy as CSV'),
      el('button', { type: 'button', class: 'a-btn', id: 'bulkDownload', onclick: () => download('new-accounts.csv', csv(rows)) }, 'Download CSV'), copied),
    el('div', { class: 'a-scroll' }, table));
}

// ---------------------------------------------------------------- the accounts table
/** A button that needs a second click within 4 seconds (no pop-up dialogs). */
function sure(label, what, run, cls = 'a-btn warn') {
  const b = el('button', { type: 'button', class: cls, 'data-do': what }, label);
  b.addEventListener('click', () => {
    if (ui.armed && ui.armed.b === b) { clearTimeout(ui.armed.t); ui.armed = null; run(); return; }
    if (ui.armed) { clearTimeout(ui.armed.t); ui.armed.b.textContent = ui.armed.label; }
    b.textContent = 'Sure?';
    ui.armed = { b, label, t: setTimeout(() => { b.textContent = label; ui.armed = null; }, 4000) };
  });
  return b;
}
const act = async (run, accountNote) => {
  const r = await run();
  if (r.status >= 300) { accountNote.textContent = problem(r); return false; }
  await reload();
  return true;
};

function drawTable() {
  const q = ui.filter.trim().toLowerCase();
  const list = accounts.filter(a => !q || a.username.toLowerCase().includes(q)).sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
  const free = freeDesks();
  const body = el('tbody');
  for (const a of list) {
    const note = el('span', { class: 'a-note' });
    const desk = slotOf(a.slotSpot);
    let deskCell;
    if (a.employeeId) deskCell = el('span', { 'data-employee': a.employeeId }, 'plays ' + ((employees && employees.find(e => e.userId === a.employeeId)?.name) || 'an employee'));
    else if (a.slotSpot) deskCell = desk ? deskLabel(desk) : a.slotSpot;
    else {
      const sel = el('select', { 'aria-label': `Desk for ${a.username}`, 'data-pick': a.username },
        el('option', { value: '' }, free.length ? '— no desk —' : '— none free —'),
        free.map(d => el('option', { value: d.spot, selected: ui.picked.get(a.id) === d.spot }, `${deskLabel(d)} (${d.person})`)));
      sel.addEventListener('change', () => ui.picked.set(a.id, sel.value));
      deskCell = el('div', { class: 'a-row' }, sel, el('button', { type: 'button', class: 'a-btn', 'data-do': 'assign', onclick: () => { const spot = ui.picked.get(a.id); if (spot) { ui.picked.delete(a.id); act(() => api('POST', `/users/${a.id}/assign-slot`, { spot }), note); } } }, 'Give'));
    }
    const chips = [
      a.role === 'admin' && el('span', { class: 'a-chip' }, 'admin'),
      a.online && el('span', { class: 'a-chip on' }, 'online'),
      a.mustChangePassword && el('span', { class: 'a-chip warn' }, 'new password needed'),
      a.disabled && el('span', { class: 'a-chip bad' }, 'disabled'),
      a.muted && el('span', { class: 'a-chip warn' }, 'muted'),
    ];
    const actions = el('div', { class: 'a-actions' },
      el('button', { type: 'button', class: 'a-btn', 'data-do': 'password', onclick: () => { ui.panel.set(a.id, ui.panel.has(a.id) ? undefined : { typed: '', result: null }); if (!ui.panel.get(a.id)) ui.panel.delete(a.id); drawTable(); } }, 'Password'),
      sure(a.disabled ? 'Enable' : 'Disable', 'disable', () => act(() => api('POST', `/users/${a.id}/disabled`, { disabled: !a.disabled }), note)),
      el('button', { type: 'button', class: 'a-btn', 'data-do': 'mute', title: a.muted ? 'Let them chat again' : 'Nobody will see what they type', onclick: () => act(() => api('POST', `/users/${a.id}/muted`, { muted: !a.muted }), note) }, a.muted ? 'Unmute' : 'Mute'),
      a.slotSpot && sure('Take desk', 'release', () => act(() => api('POST', `/users/${a.id}/release-slot`), note)),
      note);
    body.append(el('tr', { class: a.disabled ? 'off' : '', 'data-user': a.username },
      el('td', { class: 'mono' }, a.username), el('td', {}, deskCell), el('td', {}, chips), el('td', { class: 'hide-s' }, when(a.lastLoginAt)), el('td', {}, actions)));
    const p = ui.panel.get(a.id);
    if (p) body.append(passwordPanel(a, p, note));
  }
  if (!list.length) body.append(el('tr', {}, el('td', { colspan: '5' }, accounts.length ? 'No account matches.' : 'No accounts yet. Make some above.')));
  tableHost.replaceChildren(el('div', { class: 'a-scroll' }, el('table', { class: 'a-table' },
    el('thead', {}, el('tr', {}, ['Username', 'Desk', 'Status', 'Last login', ''].map((h, i) => el('th', { class: i === 3 ? 'hide-s' : '' }, h)))), body)));
}

function passwordPanel(a, p, note) {
  const typed = el('input', { type: 'text', 'aria-label': `New password for ${a.username}`, placeholder: 'leave empty to generate one', autocomplete: 'off', spellcheck: 'false', value: p.typed });
  typed.addEventListener('input', () => { p.typed = typed.value; });
  const out = el('div', {});
  const err = el('p', { class: 'a-note', role: 'alert' });
  const copied = el('span', { class: 'a-ok' });
  if (p.result) {
    out.append(el('p', {}, `New password for ${p.result.username}: `, el('span', { class: 'a-pw', 'data-result': 'password' }, p.result.password)),
      el('p', {}, 'Shown once. They were signed out, and must choose their own password at their next login. ',
        el('button', { type: 'button', class: 'a-btn', onclick: async () => { copied.textContent = (await copyText(p.result.password)) ? 'Copied.' : 'Could not copy.'; } }, 'Copy'), ' ', copied));
  }
  const set = el('button', { type: 'button', class: 'a-btn primary', 'data-do': 'set-password' }, 'Set password');
  set.addEventListener('click', async () => {
    set.disabled = true;
    const r = await api('POST', `/users/${a.id}/password`, p.typed ? { password: p.typed } : {});
    set.disabled = false;
    if (r.status !== 201) { err.textContent = problem(r); return; }
    p.typed = ''; p.result = r.body;
    await reload();
  });
  return el('tr', { class: 'a-panel' }, el('td', { colspan: '5' },
    el('div', { class: 'a-row' }, typed, set, el('button', { type: 'button', class: 'a-btn', onclick: () => { ui.panel.delete(a.id); drawTable(); } }, 'Close')), err, out));
}

start();
