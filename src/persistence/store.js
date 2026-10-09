// Saving and loading through our own API (server/), plus a copy of the player's look in this browser.
// The browser never talks to Supabase directly. Every call is safe to fail: storage can be blocked,
// and the API can be down or not configured (then the sim falls back to made-up staff).
const SPEC_KEY = 'officeSim.playerSpec';

const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };

function loadLocalSpec() { try { return JSON.parse(read(SPEC_KEY)); } catch (_) { return null; } }
function saveLocalSpec(spec) { write(SPEC_KEY, JSON.stringify(spec)); }

// Active employees: [{ userId, firstName, lastName, department, intern, character, desk }].
// Null if the API can't be reached in a few seconds.
async function fetchEmployees() {
  try {
    const res = await fetch('/api/employees', { signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}
// Today's attendance: { now, records: [{ userId, clockIn, clockOut }] } (ISO times), or null if unavailable.
async function fetchAttendance() {
  try {
    const res = await fetch('/api/attendance', { signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}
// Store an employee's look and desk (character_information). Returns { ok, error }.
async function saveCharacter(userId, character, desk) {
  try {
    const res = await fetch(`/api/characters/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ character, desk }) });
    return res.ok ? { ok: true } : { ok: false, error: (await res.json().catch(() => ({}))).error };
  } catch (_) { return { ok: false, error: 'the server could not be reached' }; }
}

export { fetchAttendance, fetchEmployees, loadLocalSpec, saveCharacter, saveLocalSpec };
