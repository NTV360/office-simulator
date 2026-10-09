import { openCreator } from '../ui/creator.js';

// Your character on the server: read it, save it, and open the character lab with the server's save. The server makes whatever is sent valid
// again (PUT /api/character); the lab only offers valid choices. Shown the first time a person with a desk logs in (it cannot be skipped
// then) and again from the "Character" button next to the account name, and from the HUD.

/** Your saved look and the starting look. Null if the server cannot be reached or you are logged out. */
export async function getCharacter(base) {
  try {
    const r = await fetch(`${base}/api/character`, { credentials: 'same-origin' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Save a look. Resolves { ok, spec } (the look as the server made it valid) or { ok: false, message }. */
export async function saveCharacter(base, spec) {
  try {
    const r = await fetch(`${base}/api/character`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }),
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, spec: json.spec };
    return { ok: false, message: json.message || `Something went wrong (${r.status}).` };
  } catch { return { ok: false, message: 'Cannot reach the server. Try again in a moment.' }; }
}

/**
 * Open the character lab, starting from `start`, saving to the server. Resolves with the saved look, or null if it was closed without
 * saving (only possible when `required` is false).
 */
export function showCreator(base, start, { required = false, onLogout = null } = {}) {
  return openCreator({ start, required, onLogout, onSave: spec => saveCharacter(base, spec) });
}
