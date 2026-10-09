// A small login and sign-up screen for online mode. Plain DOM, no framework. It is shown when there is no session (or it has
// ended), and goes away once the server has accepted a login or a registration.

/** The account the current session belongs to, or null if nobody is logged in. */
export async function getAccount(base) {
  try {
    const r = await fetch(`${base}/api/auth/me`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    return (await r.json()).account;
  } catch { return null; }
}

async function post(base, path, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

export async function logout(base) {
  await post(base, '/api/auth/logout');
}

/**
 * Ask for a one-time ticket to open the realtime connection.
 * Returns { ticket }, or { loggedOut: true } when the session is no longer valid (401), or { retryable: true } for anything else
 * that is probably temporary (the server busy, a rate limit, no network): the caller should wait and try again.
 */
export async function mintTicket(base) {
  try {
    const r = await post(base, '/api/play/ticket');
    if (r.ok) return { ticket: r.json.ticket };
    if (r.status === 401) return { loggedOut: true };
    return { retryable: true };
  } catch { return { retryable: true }; }
}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};

/**
 * Show the screen and wait. Resolves with the account once the server has accepted a login or a registration.
 * `note` is a line shown above the form (for example "Your session has ended").
 */
export function showLogin(base, note = '') {
  return new Promise(resolve => {
    document.getElementById('loginScreen')?.remove();
    let mode = 'login';

    const message = el('p', { class: 'login-note', role: 'alert' }, note);
    const name = el('input', { id: 'loginName', name: 'username', type: 'text', autocomplete: 'username', maxlength: '24', required: '', spellcheck: 'false', autocapitalize: 'none' });
    const pass = el('input', { id: 'loginPass', name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '128', required: '' });
    const code = el('input', { id: 'loginCode', name: 'signupCode', type: 'text', autocomplete: 'off', maxlength: '100' });
    const codeRow = el('label', { class: 'login-row login-code', hidden: '' }, 'Sign-up code', code);
    const go = el('button', { type: 'submit', class: 'btn primary' }, 'Log in');
    const tabLogin = el('button', { type: 'button', class: 'login-tab', 'aria-pressed': 'true' }, 'Log in');
    const tabRegister = el('button', { type: 'button', class: 'login-tab', 'aria-pressed': 'false' }, 'Create account');

    const setMode = m => {
      mode = m;
      tabLogin.setAttribute('aria-pressed', String(m === 'login'));
      tabRegister.setAttribute('aria-pressed', String(m === 'register'));
      go.textContent = m === 'login' ? 'Log in' : 'Create account';
      pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
      hint.textContent = m === 'register' ? 'Letters, digits, dot, dash and underscore. Password: at least 8 characters.' : '';
      message.textContent = '';
    };
    tabLogin.addEventListener('click', () => setMode('login'));
    tabRegister.addEventListener('click', () => setMode('register'));
    const hint = el('p', { class: 'login-hint' });

    const form = el('form', { class: 'login-form', novalidate: '' },
      el('div', { class: 'login-tabs' }, tabLogin, tabRegister),
      message,
      el('label', { class: 'login-row' }, 'Username', name),
      el('label', { class: 'login-row' }, 'Password', pass),
      codeRow, hint, go);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      go.disabled = true;
      message.textContent = '';
      try {
        const body = { username: name.value, password: pass.value };
        if (mode === 'register' && code.value) body.signupCode = code.value;
        const r = await post(base, mode === 'login' ? '/api/auth/login' : '/api/auth/register', body);
        if (r.ok) { pass.value = ''; screen.remove(); resolve(r.json.account); return; }
        if (r.json.code === 'signup') codeRow.hidden = false; // the server wants a code: ask for it
        message.textContent = r.json.message || `Something went wrong (${r.status}).`;
        if (r.json.code === 'signup') code.focus(); else pass.select();
      } catch {
        message.textContent = 'Cannot reach the server. Try again in a moment.';
      } finally {
        go.disabled = false;
      }
    });

    const screen = el('div', { id: 'loginScreen', class: 'login-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'loginTitle' },
      el('div', { class: 'login-card' },
        el('p', { class: 'eyebrow' }, 'Floor plan · Draft 07'),
        el('h2', { id: 'loginTitle' }, 'Office Floor Sim'),
        form));
    document.body.append(screen);
    name.focus();
  });
}
