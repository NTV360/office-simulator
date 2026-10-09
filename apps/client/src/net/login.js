// A small login screen for online mode. Plain DOM, no framework. It is shown when there is no session (or it has ended), and goes
// away once the server has accepted a login. There is no sign-up: an admin makes everybody's account and gives a first password,
// which the person replaces with their own on first login (the second step of this screen).

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
    if (r.status === 403 && r.json.code === 'must-change-password') return { loggedOut: true }; // (the login screen asks for a new password)
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
 * Show the screen and wait. Resolves with the account once the server has accepted a login (and, for an account an admin has just
 * made, once the person has chosen their own password). `note` is a line shown above the form (for example "Your session has ended").
 */
export function showLogin(base, note = '') {
  return new Promise(resolve => {
    document.getElementById('loginScreen')?.remove();

    const message = el('p', { class: 'login-note', role: 'alert' }, note);
    const name = el('input', { id: 'loginName', name: 'username', type: 'text', autocomplete: 'username', maxlength: '24', required: '', spellcheck: 'false', autocapitalize: 'none' });
    const pass = el('input', { id: 'loginPass', name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '128', required: '' });
    const go = el('button', { type: 'submit', class: 'btn primary' }, 'Log in');
    const hint = el('p', { class: 'login-hint' }, 'Your account is made by an admin. Ask them if you cannot log in.');
    const title = el('h2', { id: 'loginTitle' }, 'Office Floor Sim');
    const rowName = el('label', { class: 'login-row' }, 'Username', name);
    const rowPass = el('label', { class: 'login-row' }, 'Password', pass);
    const form = el('form', { class: 'login-form', novalidate: '' }, message, rowName, rowPass, hint, go);

    let step = 'login'; // then 'change': choose your own password
    let account = null, current = '';
    const next = el('input', { id: 'loginNew', name: 'new-password', type: 'password', autocomplete: 'new-password', maxlength: '128', required: '' });
    const again = el('input', { id: 'loginNew2', name: 'new-password-again', type: 'password', autocomplete: 'new-password', maxlength: '128', required: '' });

    const toChangeStep = () => {
      step = 'change';
      title.textContent = 'Choose your password';
      rowName.remove(); rowPass.remove();
      hint.textContent = 'An admin set your first password. Choose one only you know: at least 8 characters.';
      message.textContent = '';
      go.textContent = 'Save and continue';
      form.insertBefore(el('label', { class: 'login-row' }, 'New password', next), hint);
      form.insertBefore(el('label', { class: 'login-row' }, 'New password again', again), hint);
      next.focus();
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      go.disabled = true;
      message.textContent = '';
      try {
        if (step === 'login') {
          const r = await post(base, '/api/auth/login', { username: name.value, password: pass.value });
          if (!r.ok) { message.textContent = r.json.message || `Something went wrong (${r.status}).`; pass.select(); return; }
          account = r.json.account; current = pass.value; pass.value = '';
          if (account.mustChangePassword) toChangeStep(); else { screen.remove(); resolve(account); }
          return;
        }
        if (next.value !== again.value) { message.textContent = 'The two new passwords are not the same.'; again.select(); return; }
        const r = await post(base, '/api/auth/password', { current, next: next.value });
        if (!r.ok) { message.textContent = r.json.message || `Something went wrong (${r.status}).`; next.select(); return; }
        current = ''; next.value = again.value = '';
        screen.remove(); resolve({ ...account, mustChangePassword: false });
      } catch {
        message.textContent = 'Cannot reach the server. Try again in a moment.';
      } finally {
        go.disabled = false;
      }
    });

    const screen = el('div', { id: 'loginScreen', class: 'login-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'loginTitle' },
      el('div', { class: 'login-card' },
        el('p', { class: 'eyebrow' }, 'Floor plan · Draft 07'),
        title,
        form));
    document.body.append(screen);
    name.focus();
  });
}
