import './admin.css';

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
  const t = el('textarea', { style: 'position:fixed;left:-9999px' }); t.value = text; document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* no */ } t.remove(); return ok;
}
const csv = rows => rows.map(r => r.map(c => /[",\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? '')).join(',')).join('\n') + '\n';
function download(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(a); a.click(); a.remove();
}
const when = d => (d ? new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never');

// ---------------------------------------------------------------- login
function showLogin(note = '') {
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
let accounts = [], slots = [];
const ui = { filter: '', panel: new Map(), picked: new Map(), armed: null };
let tableHost, statsHost, bulkResult;

async function load() {
  const [u, s] = await Promise.all([api('GET', '/users'), api('GET', '/slots')]);
  if (u.status !== 200 || s.status !== 200) return u.status !== 200 ? u : s;
  accounts = u.body; slots = s.body;
  return null;
}
/** A desk by name: its island and its number, e.g. "Desk 02 · seat 9" (every desk gets a different one). */
const deskLabel = s => `${s.place} · seat ${s.spot.split(":")[1]}`;
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
  const logout = el('button', { type: 'button', class: 'a-btn', id: 'adminLogout', onclick: () => { remember(''); showLogin(); } }, 'Log out');
  bulkResult = el('div', { id: 'bulkResult' });
  app.replaceChildren(
    el('div', { class: 'a-top' }, el('h1', {}, 'Office Floor Sim · Admin'), statsHost, refresh, logout),
    makeCard(),
    el('section', { class: 'a-card' },
      el('h2', {}, 'Accounts'),
      el('p', {}, 'Passwords are kept as one-way hashes, so an existing password cannot be looked up. Set a new one and it is shown to you once; the person then chooses their own.'),
      el('input', { type: 'text', class: 'a-search', id: 'adminFilter', placeholder: 'Search by name…', 'aria-label': 'Search accounts', oninput: e => { ui.filter = e.target.value; drawTable(); } }),
      tableHost));
  drawAll();
}

async function reload() {
  let failed;
  try { failed = await load(); } catch { return; }
  if (failed) { remember(''); return showLogin(failed.status === 403 ? 'Wrong password.' : problem(failed)); }
  drawAll();
}
function drawAll() { drawStats(); drawTable(); }

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
    if (a.slotSpot) deskCell = desk ? deskLabel(desk) : a.slotSpot;
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
    ];
    const actions = el('div', { class: 'a-actions' },
      el('button', { type: 'button', class: 'a-btn', 'data-do': 'password', onclick: () => { ui.panel.set(a.id, ui.panel.has(a.id) ? undefined : { typed: '', result: null }); if (!ui.panel.get(a.id)) ui.panel.delete(a.id); drawTable(); } }, 'Password'),
      sure(a.disabled ? 'Enable' : 'Disable', 'disable', () => act(() => api('POST', `/users/${a.id}/disabled`, { disabled: !a.disabled }), note)),
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
