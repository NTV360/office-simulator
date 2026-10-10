import * as THREE from 'three';
import { follow, following, setView, viewId } from '../camera/controller.js';
import { VERB, isHelper } from '@office/shared';
import { isLocalPlayer } from '../player/player.js';
import { scene } from '../render/renderer.js';
import { fillAvatar } from './avatar.js';
import { $ } from './dom.js';

/* ================= Selection + UI ================= */
let selected = null;
const selRing = new THREE.Mesh(new THREE.RingGeometry(.4, .47, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthWrite: false }));

function select(p) {
  selected = p; $('person').hidden = !p; selRing.visible = !!p;
  if (p) $('pAvatar').dataset.key = ''; // (renderPerson fills it)
  if (!p && viewId() === 'follow') setView('free');
  renderPerson();
}
const fmt = t => { const h = Math.floor(t / 60) % 24, m = Math.floor(t % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
function statusText(p) {
  if (isLocalPlayer(p)) return 'Controlled by you';
  if (p.toiletUntil) return 'Deploying to the toilet';
  if (p.absent) return 'Not in today';
  if (p.state === 'controlled') return p.task?.kind === 'playerSit' ? `Sitting at ${p.task.spot?.place || 'a seat'}` : p.moving ? 'Walking around' : 'Standing here';
  if (p.state === 'away') return p.arrivedAt ? 'Gone home for the day' : `Not in yet, due around ${fmt(p.arriveAt)}`;
  const t = p.task; if (!t) return 'Getting settled';
  const going = p.state === 'walking';
  const where = t.spot?.place;
  switch (t.kind) {
    case 'work': return going ? `Heading back to ${where}` : p.chatWith ? `Chatting with ${p.chatWith.name.split(' ')[0]} at ${where}` : `${VERB[p.role]} at ${where}`;
    case 'meeting': return going ? `Walking to ${where} for ${t.meeting.topic}` : t.meeting.speaker === p ? `Presenting in ${where} (${t.meeting.topic})` : `In ${t.meeting.topic}, ${where}`;
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
    case 'clean': return going ? 'Heading off to clean' : { wipe: `Wiping the table at ${where}`, windowWipe: 'Wiping the windows', mop: 'Mopping the floor' }[t.anim] ?? `Tidying up ${where}`;
    case 'tv': return going ? 'Heading to the dining area to watch TV' : 'Watching a movie in the dining area';
    case 'snack': return going ? 'Getting a snack' : 'Grabbing a snack from the cabinet';
    case 'snackDesk': return going ? `Taking a snack back to ${where}` : `Having a snack at ${where}`;
    case 'whiteboard': return going ? 'Heading to the whiteboard' : t.anim === 'present' ? 'Leading a whiteboard discussion' : `Discussing at the whiteboard with ${t.partner.name.split(' ')[0]}`;
    case 'bucket': return 'Running for the bucket';
    case 'toilet': return 'Deploying to the toilet';
    case 'bucketBack': return 'Putting the bucket back';
    case 'exit': return 'Heading home';
  }
  return '';
}
function renderPerson() {
  const p = selected; if (!p) return;
  $('pName').textContent = p.name; $('pRole').textContent = `${p.title ?? p.role}${p.slot ? ' · ' + (p.slot.label ?? p.slot.place) : isHelper(p) ? '' : ' · visiting'}`;
  { // the avatar follows the person's picture, name and shirt (a changed picture shows without closing the card)
    const a = $('pAvatar'), color = p.spec?.top?.color ?? '#3e6e9c', key = `${p.photo ?? ''}|${p.name}|${color}`;
    if (a.dataset.key !== key) { a.dataset.key = key; fillAvatar(a, { name: p.name, photo: p.photo, color }); }
  }
  $('pStatus').textContent = statusText(p);
  $('pMeta').textContent = `In ${p.arrivedAt ? fmt(p.arrivedAt) : '—'} · leaves ~${fmt(p.leaveAt)} · coffee ×${p.coffees}`;
  $('pFollow').textContent = following() === p ? 'Following' : 'Follow';
}


function initPerson() {
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  selRing.renderOrder = 3;
  scene.add(selRing);
  $('pFollow').onclick = () => { if (!selected || selected.state === 'away') return; follow(selected); renderPerson(); };
  $('pClose').onclick = () => select(null);
}

export { fmt, renderPerson, selRing, select, selected, statusText, initPerson };
