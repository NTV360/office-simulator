// A copy of the player's look in this browser, for the private (offline) office. Online, the look is the account's and lives on the server
// (net/creator.js). Storage can be blocked, so every call is safe to fail.
const SPEC_KEY = 'officeSim.playerSpec';

const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* blocked: the look is just not kept */ } };

function loadLocalSpec() { try { return JSON.parse(read(SPEC_KEY)); } catch (_) { return null; } }
function saveLocalSpec(spec) { write(SPEC_KEY, JSON.stringify(spec)); }

export { loadLocalSpec, saveLocalSpec };
