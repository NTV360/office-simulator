// The office's time zone. The live clock and "today" for attendance are in this zone; the attendances
// table stores clock-in and clock-out times in UTC. Plain data and helpers, shared with the server.
const OFFICE_TZ = 'Asia/Manila';

const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: OFFICE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));

// Minutes since midnight in the office (fractional, so the clock moves smoothly).
function officeMinutes(date = new Date()) { const p = parts(date); return +p.hour * 60 + +p.minute + +p.second / 60 + date.getMilliseconds() / 60000; }
// The office's calendar date, 'YYYY-MM-DD'.
function officeDate(date = new Date()) { const p = parts(date); return `${p.year}-${p.month}-${p.day}`; }
// A database timestamp without time zone ('2026-09-30 02:07:58.296', stored as UTC) as a Date.
function fromDbUtc(ts) { return ts ? new Date(String(ts).replace(' ', 'T').replace(/Z?$/, 'Z')) : null; }

export { OFFICE_TZ, fromDbUtc, officeDate, officeMinutes };
