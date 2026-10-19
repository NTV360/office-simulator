import { NEVER, VERB } from '@office/shared';

// What a person is doing, as one line of text (the person card, and the name under the crosshair). No browser needed, so it is unit tested.
// A chat partner or a meeting may be gone when this is read (a player took over the partner's staff character, or the snapshot has not named the
// meeting yet): that says "someone" / "a meeting" instead of throwing, because this runs inside the frame loop.
const topicOf = t => t.meeting?.topic || 'a meeting';
const first = q => q?.name?.split(' ')[0] || 'someone';
// Sim minutes as HH:MM. No time (still clocked in, not in today) shows as a dash.
const fmt = t => { if (!Number.isFinite(t) || t >= NEVER) return '—'; const h = Math.floor(t / 60) % 24, m = Math.floor(t % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
function describeStatus(p, isMe) {
  if (isMe) return 'Controlled by you';
  if (p.toiletUntil) return 'Deploying to the toilet';
  if (p.absent) return 'Not in today';
  if (p.state === 'controlled') return p.task?.kind === 'playerSit' ? `Sitting at ${p.task.spot?.place || 'a seat'}` : p.moving ? 'Walking around' : 'Standing here';
  if (p.state === 'away') return p.arrivedAt ? 'Gone home for the day' : `Not in yet, due around ${fmt(p.arriveAt)}`;
  const t = p.task; if (!t) return 'Getting settled';
  const going = p.state === 'walking';
  const where = t.spot?.place ?? 'their spot';
  switch (t.kind) {
    case 'work': return going ? `Heading back to ${where}` : p.chatWith ? `Chatting with ${first(p.chatWith)} at ${where}` : `${VERB[p.role] ?? 'Working'} at ${where}`;
    case 'meeting': return going ? `Walking to ${where} for ${topicOf(t)}` : t.spot?.kind === 'teach' ? `Teaching the ${topicOf(t)} in ${where}` : t.meeting?.speaker === p ? `Presenting in ${where} (${topicOf(t)})` : `In ${topicOf(t)}, ${where}`;
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
    case 'chat': return going ? `Walking over to ${first(t.partner)}` : `Chatting with ${first(t.partner)}`;
    case 'clean': return going ? 'Heading off to clean' : { wipe: `Wiping the table at ${where}`, windowWipe: 'Wiping the windows', mop: 'Mopping the floor' }[t.anim] ?? `Tidying up ${where}`;
    case 'tv': return going ? 'Heading to the dining area to watch TV' : 'Watching a movie in the dining area';
    case 'snack': return going ? 'Getting a snack' : `Grabbing a snack from ${where}`;
    case 'snackDesk': return going ? `Taking a snack back to ${where}` : `Having a snack at ${where}`;
    case 'whiteboard': return going ? 'Heading to the whiteboard' : t.anim === 'present' ? 'Leading a whiteboard discussion' : `Discussing at the whiteboard with ${first(t.partner)}`;
    case 'bucket': return 'Running for the bucket';
    case 'toilet': return 'Deploying to the toilet';
    case 'bucketBack': return 'Putting the bucket back';
    case 'exit': return 'Heading home';
  }
  return '';
}

export { describeStatus, fmt, first };
