import { CATS } from '../people/data.js';
import { phaseName } from '../sim/day.js';
import { log, logDirty, people, setLogDirty, sim } from '../sim/state.js';
import { $ } from './dom.js';
import { fmt, renderPerson } from './person.js';

const actsEl = $('acts');
actsEl.innerHTML = Object.entries(CATS).map(([k, v]) => `<li data-k="${k}"><span class="dot" style="background:${v.color}"></span><span>${v.name}</span><span class="n">0</span><span class="bar"><i style="background:${v.color};width:0"></i></span></li>`).join('');
function renderUI() {
  $('clock').textContent = fmt(sim.t);
  $('phase').innerHTML = `Day ${sim.day}<br>${phaseName(sim.t)}`;
  const counts = Object.fromEntries(Object.keys(CATS).map(k => [k, 0]));
  let present = 0;
  for (const p of people) { if (p.state === 'away') continue; present++; counts[p.state === 'walking' ? 'walk' : p.task?.kind === 'work' && p.chatWith ? 'chat' : (p.task?.cat || 'walk')]++; }
  $('present').textContent = `${present} / ${people.length} in`;
  actsEl.querySelectorAll('li').forEach(li => { const n = counts[li.dataset.k]; li.querySelector('.n').textContent = n; li.querySelector('.bar i').style.width = (present ? n / present * 100 : 0) + '%'; });
  if (logDirty) { $('log').innerHTML = log.map(l => `<li><time>${fmt(l.t)}</time>${l.msg.replace(/</g, '&lt;')}</li>`).join(''); setLogDirty(false); }
  renderPerson();
}

export { renderUI };
