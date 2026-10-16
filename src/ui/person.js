import * as THREE from 'three';
import { follow, following, setView, viewId } from '../camera/controller.js';
import { VERB } from '../people/data.js';
import { HAZEL_LOCKED } from '../people/hazel.js';
import { player, takeControl } from '../player/player.js';
import { live } from '../sim/live.js';
import { scene } from '../render/renderer.js';
import { openCreator } from './creator.js';
import { fillAvatar } from './avatar.js';
import { $ } from './dom.js';
import { renderSlapButton } from './slap.js';

/* ================= Selection + UI ================= */
let selected = null;
const selRing = new THREE.Mesh(new THREE.RingGeometry(.4, .47, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthWrite: false }));

// The card sits in the bottom-left corner, lifted above the dock only when they would overlap.
// (Phones: the stylesheet places it.)
function placeCard() {
  const card = $('person'); card.style.bottom = '';
  if (card.hidden || matchMedia('(max-width:760px)').matches) return;
  const dock = $('dock').getBoundingClientRect(), r = card.getBoundingClientRect();
  const clash = dock.width > 0 && r.left < dock.right && r.right > dock.left; // a hidden dock has no size
  card.style.bottom = clash ? `${Math.round(innerHeight - dock.top + 10)}px` : '16px';
}
function select(p) {
  selected = p; $('person').hidden = !p; selRing.visible = !!p;
  placeCard();
  if (p) fillAvatar($('pAvatar'), { name: p.name, photo: p.photo, color: p.spec.top.color });
  if (!p && viewId() === 'follow') setView('free');
  renderPerson();
}
// Sim minutes as HH:MM. No time (still clocked in, not in today) shows as a dash.
const fmt = t => { if (!Number.isFinite(t)) return '—'; const h = Math.floor(t / 60) % 24, m = Math.floor(t % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
function statusText(p) {
  if (p.state === 'player') return 'Controlled by you';
  if (p.toiletUntil) return 'Deploying to the toilet';
  if (p.absent) return 'Not in today';
  if (p.state === 'away') return p.arrivedAt ? 'Gone home for the day' : `Not in yet, due around ${fmt(p.arriveAt)}`;
  const t = p.task; if (!t) return 'Getting settled';
  const going = p.state === 'walking';
  const where = t.spot?.place;
  switch (t.kind) {
    case 'work': return going ? `Heading back to ${where}` : p.chatWith ? `Chatting with ${p.chatWith.name.split(' ')[0]} at ${where}` : `${VERB[p.role]} at ${where}`;
    case 'meeting': return going ? `Walking to ${where} for ${t.meeting.topic}` : t.meeting.teacher === p ? `Teaching the ${t.meeting.topic} in ${where}` : t.meeting.speaker === p ? `Presenting in ${where} (${t.meeting.topic})` : `In ${t.meeting.topic}, ${where}`;
    case 'phone': return going ? `Looking for a quiet booth` : `On a call in ${where}`;
    case 'coffee': return going ? 'Getting coffee' : 'Making coffee at the counter top';
    case 'bar': return going ? 'Taking coffee to the bar table' : 'Having coffee at the bar table';
    case 'storage': return going ? 'Heading to the storage room' : 'Grabbing supplies from storage';
    case 'sink': return going ? 'Taking a mug to the sink' : 'Washing a mug';
    case 'locker': return going ? `Going to ${where}` : `At ${where}`;
    case 'piano': return going ? 'Heading to the keyboard' : 'Playing the keyboard';
    case 'guitar': return going ? 'Grabbing the guitar' : 'Playing guitar';
    case 'darts': return going ? 'Heading to the dartboard' : 'Playing darts';
    case 'golf': return going ? 'Heading to the mini golf green' : 'Putting on the mini golf green';
    case 'game': return going ? 'Heading to the TV lounge for a game' : 'Playing PS5 in the TV lounge';
    case 'sofa': return going ? `Taking a break on ${where}` : `Relaxing on ${where}`;
    case 'lunch': return going ? `Bringing lunch to ${where}` : `Having lunch at ${where}`;
    case 'lunchDesk': return going ? 'Taking lunch back to the desk' : `Eating lunch at ${where}`;
    case 'chat': return going ? `Walking over to ${t.partner.name.split(' ')[0]}` : `Chatting with ${t.partner.name.split(' ')[0]}`;
    case 'clean': return going ? 'Heading off to clean' : { table: `Wiping the table at ${where}`, window: 'Wiping the windows', floor: 'Mopping the floor', organize: `Tidying up ${where}` }[t.job];
    case 'tv': return going ? 'Heading to the dining area to watch TV' : 'Watching a movie in the dining area';
    case 'snack': return going ? 'Getting a snack' : `Grabbing a snack from ${where}`;
    case 'snackDesk': return going ? `Taking a snack back to ${where}` : `Having a snack at ${where}`;
    case 'whiteboard': return going ? 'Heading to the whiteboard' : t.anim === 'present' ? 'Leading a whiteboard discussion' : `Discussing at the whiteboard with ${t.partner.name.split(' ')[0]}`;
    case 'bucket': return 'Running for the bucket';
    case 'toilet': return 'Deploying to the toilet';
    case 'bucketBack': return 'Putting the bucket back';
    case 'exit': return 'Heading home';
    case 'slap': { const them = t.partner.id === -1 ? 'you' : t.partner.name.split(' ')[0], m = t.slap;
      if (going) return `Running to the dining area for a Power Slap with ${them}`;
      if (m.phase === 'end' && m.winner !== null) return m.fighters[m.winner] === p ? `Won a Power Slap against ${them}` : m.how === 'ko' ? `Knocked out by ${them}` : `Lost a Power Slap to ${them}`;
      return m.reason ? `Settling ${m.reason} with ${them}: Power Slap` : `Power Slap against ${them}`; }
  }
  return '';
}
function renderPerson() {
  const p = selected; if (!p) return;
  $('pName').textContent = p.name; $('pRole').textContent = p.seat ? `${p.title ?? p.role} · ${p.seat.label ?? p.seat.place}` : p.title ?? p.role;
  $('pStatus').textContent = statusText(p);
  // just the time in; nothing when they have not arrived (the status line already says so)
  $('pMeta').textContent = Number.isFinite(p.arrivedAt) ? `Time in ${fmt(p.arrivedAt)}` : '';
  $('pMeta').hidden = !Number.isFinite(p.arrivedAt);
  $('pFollow').textContent = following() === p ? 'Following' : 'Follow';
  $('pEdit').hidden = !p.userId && !p.hazel; // only real employees have a saved character (Hazel's button just says no)
  renderSlapButton(p);
  // walking as them: only in Simulate (in Live they are the real people at work), and not mid-fight for your own character
  const you = player.person?.id === -1 ? player.person : null;
  $('pControl').hidden = live.mode === 'live' || p.state === 'away' || !!p.task?.slap?.online || !!you?.task?.slap;
}


function initPerson() {
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  selRing.renderOrder = 3;
  scene.add(selRing);
  $('pFollow').onclick = () => { if (!selected || selected.state === 'away') return; follow(selected); renderPerson(); };
  $('pClose').onclick = () => select(null);
  addEventListener('resize', placeCard);
  $('pControl').onclick = () => { if (selected) { takeControl(selected); setView('third'); } };
  $('pEdit').onclick = () => {
    if (selected?.hazel) alert(HAZEL_LOCKED); // her look is fixed
    else if (selected?.userId) openCreator(selected.userId);
  };
}

export { fmt, renderPerson, selRing, select, selected, statusText, initPerson };
