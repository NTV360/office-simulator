import { TAU, angDiff } from "../core/util.js";
import { player } from "../player/player.js";
import { slap } from "../sim/slap.js";
import { DINING_TV_POS } from "../world/furniture/diningTv.js";
import { LOUNGE_TV_POS } from "../world/furniture/game.js";

/* ================= Animation ================= */
// Poses are written for a human with an elbow and a knee: hipY in metres for a .88 m hip, angles in radians.
// applyPose maps them onto the character pack's skeleton, which has no elbows or knees (see below).
const JOINTS = [
  "hipY",
  "seat",
  "lean",
  "lShX",
  "lShZ",
  "lEl",
  "rShX",
  "rShZ",
  "rEl",
  "lHip",
  "lKnee",
  "rHip",
  "rKnee",
  "headY",
  "headX",
];
const POSE_HIP = 0.88; // the standing hip height the poses are written for
const ARM_BEND = 0.5; // share of the elbow bend folded into the shoulder, so a bent arm still reaches forward
const HOLDING = new Set(["walk", "stand"]); // poses in which a carried pack item (coffee, phone...) is shown
function animKey(p) {
  if (p.down > 0) return "down"; // shot: flat on the floor, outranks everything
  if (p.scratch > 0) return "scratch";
  if (p.state === "player")
    return player.sitting
      ? p.task?.anim || "listenSit"
      : player.air
        ? "jump"
        : player.moving
          ? "walk"
          : player.gun != null
            ? "aim"
            : p.task?.anim || "stand"; // (standing: a game's pose, ui/games.js)
  if (p.state === "walking")
    return p.riding ? "ride" : p.task?.run || p.hazel ? "run" : "walk"; // Hazel runs, or rides her tricycle
  if (p.state !== "doing" || !p.task) return "stand";
  const t = p.task;
  if (t.kind === "meeting")
    return t.meeting?.teacher === p
      ? "present"
      : t.meeting && t.meeting.speaker === p
        ? "talkSit"
        : "listen"; // a class's teacher stands
  if (t.kind === "work" && p.chatWith) return "listenSit";
  if (t.kind === "work" && p.slack && p.slack.mode !== "work")
    return p.slack.mode === "movie" ? "watch" : "peek"; // Hazel (people/hazel.js)
  return t.anim;
}
function targetPose(p, k, T) {
  const o = {
    hipY: POSE_HIP,
    seat: 0,
    lean: 0,
    lShX: 0,
    lShZ: 0.07,
    lEl: -0.12,
    rShX: 0,
    rShZ: -0.07,
    rEl: -0.12,
    lHip: 0,
    lKnee: 0,
    rHip: 0,
    rKnee: 0,
    headY: 0,
    headX: 0,
  };
  const breathe = Math.sin(T * 1.6) * 0.012;
  const sit = () => {
    o.seat = 1;
    o.hipY = p.task?.spot?.hipY ?? 0.53;
    const hi = o.hipY > 0.65;
    o.lHip = o.rHip = hi ? -1.2 : -1.5;
    o.lKnee = o.rKnee = hi ? 0.95 : 1.45;
    o.lShX = o.rShX = -0.45;
    o.lEl = o.rEl = -0.75;
  };
  switch (k) {
    case "walk": {
      const s = Math.sin(p.walkPhase),
        c = Math.cos(p.walkPhase);
      o.lHip = -0.5 * s;
      o.rHip = 0.5 * s;
      o.lKnee = 0.08 + 0.65 * Math.max(0, c);
      o.rKnee = 0.08 + 0.65 * Math.max(0, -c);
      o.lShX = 0.42 * s;
      o.rShX = -0.42 * s;
      o.lEl = o.rEl = -0.3;
      o.hipY = 0.87 + 0.022 * Math.abs(Math.cos(p.walkPhase));
      o.lean = 0.05;
      break;
    }
    case "run": {
      const s = Math.sin(p.walkPhase),
        c = Math.cos(p.walkPhase);
      const stride = p.hazel ? 0.55 : 0.85; // Hazel: quick, short steps
      o.lHip = -stride * s;
      o.rHip = stride * s;
      o.lKnee = 0.2 + 1.1 * Math.max(0, c);
      o.rKnee = 0.2 + 1.1 * Math.max(0, -c);
      o.lShX = 0.8 * s;
      o.lEl = -1.2;
      o.rShX = p.body.bucket.visible ? -0.1 * s : -0.8 * s;
      o.rEl = p.body.bucket.visible ? -0.1 : -1.2; // the bucket hand stays down
      o.hipY = 0.86 + 0.05 * Math.abs(Math.cos(p.walkPhase));
      o.lean = 0.22;
      break;
    }
    // the helper: wiping a table, wiping a window (arm up), mopping the floor
    case "wipe":
      o.lean = 0.35;
      o.hipY = 0.85;
      o.lShX = -0.75;
      o.lEl = -0.3;
      o.rShX = -1.05 + Math.cos(T * 6) * 0.18;
      o.rShZ = Math.sin(T * 6) * 0.35;
      o.rEl = -0.25;
      o.headX = 0.35;
      break;
    case "windowWipe":
      o.rShX = -2.5 + Math.cos(T * 5) * 0.15;
      o.rShZ = -0.25 + Math.sin(T * 5) * 0.4;
      o.rEl = -0.2;
      o.lShX = -0.3;
      o.lEl = -0.4;
      o.headX = -0.3;
      o.lean = -0.04;
      break;
    case "mop": {
      const s = Math.sin(T * 3);
      o.lean = 0.18;
      o.lShX = -0.75;
      o.lEl = -0.5;
      o.rShX = -0.55;
      o.rEl = -0.4;
      o.lShZ = 0.1 + s * 0.3;
      o.rShZ = -0.1 + s * 0.3;
      o.headX = 0.3;
      o.headY = s * 0.2;
      break;
    }
    case "type":
      sit();
      o.lean = 0.12;
      o.lShX = -0.6;
      o.rShX = -0.6;
      o.lEl = -1.2 + Math.sin(T * 13) * 0.06;
      o.rEl = -1.2 + Math.sin(T * 13 + 2) * 0.06;
      o.lShZ = -0.05;
      o.rShZ = 0.05;
      o.headX = 0.1 + Math.sin(T * 0.4) * 0.05;
      o.headY = Math.sin(T * 0.23) * 0.15;
      break;
    // Hazel's movie: leaning back with her hands on the desk; laughing shakes her
    case "watch": {
      sit();
      o.lean = -0.08;
      o.lShX = o.rShX = -0.5;
      o.lEl = o.rEl = -0.9;
      o.headX = 0.05;
      if (p.slack.face === "laugh") {
        o.lean = -0.14 + Math.sin(T * 16) * 0.04;
        o.headX = -0.15 + Math.sin(T * 16) * 0.06;
      }
      break;
    }
    // Hazel on her tricycle (people/hazelRide.js): on the seat, hands on the bars, legs going round with the pedals
    case "ride": {
      sit();
      o.hipY = 0.34;
      o.lean = 0.12;
      o.lShX = o.rShX = -1.25;
      o.lEl = o.rEl = -0.25;
      o.lShZ = 0.12;
      o.rShZ = -0.12;
      const a = p.pedal ?? 0;
      o.lHip = -1.05 + Math.sin(a) * 0.3;
      o.rHip = -1.05 - Math.sin(a) * 0.3;
      o.headX = -0.05;
      break;
    }
    // alt-tabbed: hands back on the keys, looking over one shoulder, then the other (worried; people/hazel.js)
    case "peek":
      sit();
      o.lean = 0.12;
      o.lShX = o.rShX = -0.6;
      o.lEl = o.rEl = -1.2;
      o.headX = -0.05;
      o.headY = Math.sin(T * 4.5) * 1.0;
      break;
    case "eat":
      sit();
      o.lean = 0.1;
      o.lShX = -0.5;
      o.rShX = -0.55 - Math.max(0, Math.sin(T * 1.3)) * 0.5;
      o.rEl = -1.3 - Math.max(0, Math.sin(T * 1.3)) * 0.8;
      o.lEl = -1.1;
      o.headX = 0.15;
      break;
    case "listen":
      sit();
      o.lean = -0.03;
      o.lShX = o.rShX = -0.5;
      o.lEl = o.rEl = -1.0;
      o.headX = Math.sin(T * 2.1) * 0.04;
      break;
    case "listenSit":
      sit();
      o.lean = -0.02;
      o.lShX = o.rShX = -0.5;
      o.lEl = o.rEl = -0.9;
      break;
    case "talkSit":
      sit();
      o.lean = 0.08;
      o.lShX = -0.5;
      o.lEl = -0.9;
      o.rShX = -0.75 + Math.sin(T * 3.1) * 0.25;
      o.rEl = -1.1 + Math.sin(T * 4.3) * 0.3;
      o.rShZ = -0.2;
      o.headX = Math.sin(T * 5) * 0.05;
      break;
    case "relax":
      sit();
      o.lean = -0.18;
      o.lShX = o.rShX = -0.25;
      o.lEl = o.rEl = -0.6;
      o.headY = Math.sin(T * 0.3) * 0.5;
      o.headX = -0.05;
      break;
    case "phone":
      sit();
      o.lean = 0.02;
      o.rShX = -0.45;
      o.rShZ = 0.55;
      o.rEl = -2.55;
      o.lShX = -0.4 + Math.sin(T * 2.2) * 0.15;
      o.lEl = -1.0;
      o.headY = Math.sin(T * 0.5) * 0.3;
      o.headX = -0.05 + Math.sin(T * 4) * 0.03;
      break;
    case "piano": {
      sit();
      o.lean = 0.1;
      o.lShX = -0.75;
      o.rShX = -0.75;
      o.lEl = -1.0 + Math.sin(T * 7) * 0.08;
      o.rEl = -1.0 + Math.sin(T * 8 + 1) * 0.08;
      o.lShZ = 0.05 + Math.sin(T * 1.3) * 0.18;
      o.rShZ = -0.05 + Math.sin(T * 1.1 + 2) * 0.18;
      o.headX = 0.2;
      o.headY = Math.sin(T * 0.9) * 0.15;
      o.lean += Math.sin(T * 2) * 0.03;
      break;
    }
    case "guitar": {
      sit();
      o.lean = 0.06;
      o.lShX = -1.05;
      o.lShZ = 0.55;
      o.lEl = -1.2 + Math.sin(T * 3) * 0.05;
      o.rShX = -0.35;
      o.rShZ = -0.15;
      o.rEl = -1.35 + Math.sin(T * 12) * 0.2;
      o.headX = 0.25;
      o.headY = 0.35 + Math.sin(T * 2) * 0.08;
      break;
    }
    case "darts": {
      const ph = (T + (p.task?.spot?.dartOff || 0)) % 6;
      o.lShX = -0.3;
      o.lEl = -0.6;
      o.headX = -0.05;
      o.lean = 0.04;
      if (ph < 0.85) {
        o.rShX = -1.75;
        o.rEl = -1.85 + ph * 0.2;
        o.rShZ = -0.1;
      } else if (ph < 1.15) {
        const q = (ph - 0.85) / 0.3;
        o.rShX = -1.75 + q * 0.3;
        o.rEl = -1.7 + q * 1.5;
        o.lean = 0.1;
      } else if (ph < 2.4) {
        o.rShX = -1.3;
        o.rEl = -0.25;
      } else {
        o.rShX = -0.2;
        o.rEl = -0.5;
        o.headY = Math.sin(T) * 0.2;
      }
      break;
    }
    case "putt": {
      const ph = (T + (p.task?.spot?.pos.z || 0)) % 8,
        sw = ph < 1.4 ? Math.sin((ph / 1.4) * TAU) * 0.28 : 0;
      o.lean = 0.32;
      o.lShX = -0.42;
      o.rShX = -0.42;
      o.lShZ = -0.22 + sw;
      o.rShZ = 0.22 + sw;
      o.lEl = o.rEl = -0.12;
      o.lHip = o.rHip = -0.12;
      o.lKnee = o.rKnee = 0.22;
      o.hipY = 0.85;
      o.headX = 0.45;
      if (ph > 1.4 && ph < 4.5) {
        o.headY = 0.9;
        o.headX = 0.15;
      }
      if (ph > 4.3 && ph < 5.2) {
        o.rShX = -2.6;
        o.rEl = -0.3;
        o.headX = -0.1;
      }
      break;
    }
    // you putting (ui/games.js): addressing the ball; `swing` seconds after you putt, the stroke, then watching it roll
    case "putter": {
      const ph = p.task.swing,
        sw = ph < 1.2 ? Math.sin((ph / 1.2) * TAU) * 0.32 : 0;
      o.lean = 0.32;
      o.lShX = -0.42;
      o.rShX = -0.42;
      o.lShZ = -0.22 + sw;
      o.rShZ = 0.22 + sw;
      o.lEl = o.rEl = -0.12;
      o.lHip = o.rHip = -0.12;
      o.lKnee = o.rKnee = 0.22;
      o.hipY = 0.85;
      o.headX = 0.45;
      if (ph > 0.6 && ph < 3) {
        o.headY = 0.9;
        o.headX = 0.15;
      }
      break;
    }
    // you at a whiteboard (ui/interact.js): the pen hand up on the board, moving while you draw
    case "drawBoard": {
      const d = p.task.drawing;
      o.rShX = -1.75 + (d ? Math.sin(T * 9) * 0.12 : 0);
      o.rShZ = -0.15 + (d ? Math.cos(T * 7) * 0.15 : 0);
      o.rEl = -0.45;
      o.lShX = -0.15;
      o.lEl = -0.3;
      o.headX = -0.12;
      o.lean = 0.03;
      break;
    }
    // you at the dartboard (ui/games.js): a dart held up by your eye, and for a moment after `throwT` the throw
    case "dartAim": {
      const t = p.task.throwT;
      o.lShX = -0.3;
      o.lEl = -0.6;
      o.headX = -0.05;
      o.lean = 0.04;
      if (t < 0.3) {
        const k = t / 0.3;
        o.rShX = -1.75 + k * 0.45;
        o.rEl = -1.7 + k * 1.45;
        o.lean = 0.1;
      } else {
        o.rShX = -1.75;
        o.rEl = -1.85;
        o.rShZ = -0.1;
      }
      break;
    }
    case "game": {
      sit();
      o.lean = 0.06 + Math.sin(T * 1.3) * 0.04;
      o.lShX = -0.85;
      o.rShX = -0.85;
      o.lShZ = -0.32;
      o.rShZ = 0.32;
      o.lEl = -1.05 + Math.sin(T * 9) * 0.04;
      o.rEl = -1.05 + Math.sin(T * 11 + 1) * 0.04;
      o.headX = 0.05;
      break;
    }
    case "drinkSit": {
      sit();
      o.lShX = -0.5;
      o.lEl = -1.1;
      o.rShX = -0.5;
      o.rEl = -1.4;
      if (T % 7 < 1.3) {
        o.rEl = -2.35;
        o.rShX = -0.6;
        o.headX = -0.18;
      }
      o.headY = Math.sin(T * 0.35) * 0.5;
      break;
    }
    case "drink": {
      o.rShX = -0.45;
      o.rEl = -1.5;
      const sip = T % 6 < 1.2;
      if (sip) {
        o.rEl = -2.35;
        o.rShX = -0.55;
        o.headX = -0.18;
      }
      o.lShZ = 0.12;
      o.headY = Math.sin(T * 0.4) * 0.4;
      break;
    }
    case "sink":
      o.lean = 0.2;
      o.lShX = o.rShX = -0.75;
      o.lEl = -0.6 + Math.sin(T * 7) * 0.15;
      o.rEl = -0.6 + Math.sin(T * 7 + 1.5) * 0.15;
      o.headX = 0.3;
      break;
    case "locker":
      o.lShX = -1.1 + Math.sin(T * 2) * 0.2;
      o.lEl = -0.4;
      o.rShX = -0.6;
      o.rEl = -0.5 + Math.sin(T * 3) * 0.2;
      o.headX = Math.sin(T) * 0.1;
      break;
    case "present":
      o.rShX = -1.75 + Math.sin(T * 1.7) * 0.25;
      o.rShZ = -0.25 + Math.sin(T * 2.3) * 0.2;
      o.rEl = -0.35;
      o.lShX = Math.sin(T * 1.1) * 0.15;
      o.headY = Math.sin(T * 0.6) * 0.5;
      o.headX = -0.08;
      break;
    case "talkStand":
      o.rShX = -0.55 + Math.sin(T * 2.7) * 0.3;
      o.rEl = -1.2 + Math.sin(T * 3.9) * 0.3;
      o.rShZ = -0.15;
      o.lShX = Math.sin(T * 1.3) * 0.1;
      o.headX = Math.sin(T * 4.4) * 0.05;
      break;
    // Power Slap (sim/slap.js): squared up, winding up and swinging the right hand across, taking it with the hands
    // behind the back (the head snaps round, harder for a harder slap), seeing birds, knocked down flat, arms up
    case "slapReady":
      o.lShZ = 0.2;
      o.rShZ = -0.2;
      o.lEl = o.rEl = -0.5;
      o.hipY = 0.87 + Math.sin(T * 5) * 0.008;
      o.headX = -0.05;
      break;
    case "slapWind":
      o.rShX = 0.55;
      o.rShZ = -1.35;
      o.rEl = -0.35;
      o.lShX = -0.2;
      o.lShZ = 0.25;
      o.lean = -0.06;
      o.headX = -0.05;
      break;
    case "slapHit":
      o.rShX = -1.45;
      o.rShZ = 0.55;
      o.rEl = -0.05;
      o.lShX = 0.25;
      o.lShZ = 0.2;
      o.lean = 0.14;
      break;
    case "slapBrace":
      o.lShX = o.rShX = 0.6;
      o.lShZ = 0.12;
      o.rShZ = -0.12;
      o.lEl = o.rEl = -0.3;
      o.headX = -0.12;
      break;
    case "slapTake": {
      const s = 0.5 + p.task.slap.last * 0.7;
      o.lShX = o.rShX = 0.6;
      o.lShZ = 0.12;
      o.rShZ = -0.12;
      o.lEl = o.rEl = -0.3;
      o.headY = -s;
      o.headX = 0.25;
      o.lean = -0.2 - s * 0.1;
      o.hipY = 0.86;
      break;
    }
    case "slapDizzy":
      o.lShX = o.rShX = 0.45;
      o.lShZ = 0.3;
      o.rShZ = -0.3;
      o.lEl = o.rEl = -0.2;
      o.headY = Math.sin(T * 6) * 0.35;
      o.headX = 0.1 + Math.cos(T * 6) * 0.12;
      o.lean = Math.sin(T * 3) * 0.1;
      break;
    case "slapKO":
      o.hipY = POSE_HIP - p.body.standHip + 0.12;
      o.lean = -1.35;
      o.lHip = o.rHip = -1.5;
      o.lShX = o.rShX = -0.3;
      o.lShZ = 1.1;
      o.rShZ = -1.1;
      o.lEl = o.rEl = -0.1;
      o.headX = -0.25;
      o.headY = 0.4;
      break;
    case "cheer": {
      const h = Math.max(0, Math.sin(T * 7));
      o.lShX = o.rShX = -2.7 - h * 0.2;
      o.lShZ = 0.35;
      o.rShZ = -0.35;
      o.lEl = o.rEl = -0.15;
      o.hipY = 0.88 + h * 0.05;
      o.headX = -0.2;
      break;
    }
    case "scratch":
      o.rShX = -2.1;
      o.rShZ = -0.25;
      o.rEl = -2.3 + Math.sin(T * 9) * 0.25;
      o.lean = 0.06;
      o.headX = 0.12 + Math.sin(T * 4) * 0.03;
      o.headY = Math.sin(T * 2.5) * 0.1;
      break;
    case "down": // shot: flat on their back for a couple of seconds
      o.hipY = POSE_HIP - p.body.standHip + 0.12;
      o.lean = -1.35;
      o.lHip = o.rHip = -1.5;
      o.lShX = o.rShX = -0.3;
      o.lShZ = 1.1;
      o.rShZ = -1.1;
      o.lEl = o.rEl = -0.1;
      o.headX = -0.25;
      o.headY = 0.4;
      break;
    case "aim": // gun drawn, right arm levelled forward
      o.rShX = -1.45;
      o.rShZ = -0.12;
      o.rEl = -0.08;
      o.lShZ = 0.16;
      o.headY = -0.1;
      o.lean = 0.04;
      break;
    case "jump": // Roblox-style: arms up, knees tucked
      o.lShX = o.rShX = -2.6;
      o.lShZ = 0.3;
      o.rShZ = -0.3;
      o.lEl = o.rEl = -0.2;
      o.lHip = -0.7;
      o.rHip = -0.35;
      o.lKnee = 1.3;
      o.rKnee = 1.0;
      o.lean = 0.1;
      break;
    default:
      o.lShX = Math.sin(T * 0.9) * 0.05;
      o.rShX = -Math.sin(T * 0.9) * 0.05;
      break;
  }
  o.lean += breathe;
  // look at someone
  let look = null;
  if (p.task?.meeting && p.task.meeting.speaker && p.task.meeting.speaker !== p)
    look = p.task.meeting.speaker.pos;
  else if (k === "listenSit" && p.chatWith) look = p.chatWith.pos;
  else if (k === "talkSit" && p.task?.meeting) {
    const others = p.task.meeting.members.filter((q) => q !== p);
    if (others.length) look = others[Math.floor(T / 2.5) % others.length].pos;
  } else if (k === "talkStand" && p.task?.partner) look = p.task.partner.pos;
  else if (
    (k === "game" || (k === "relax" && p.task?.spot?.game)) &&
    p.state !== "player"
  )
    look = LOUNGE_TV_POS;
  else if (
    p.state === "doing" &&
    (p.task?.kind === "tv" ||
      (p.task?.kind === "lunch" && p.task.spot?.kind === "dining"))
  )
    look = DINING_TV_POS; // watching the dining TV
  if (p.state === "doing" && p.task?.kind !== "slap")
    look = fightNear(p) ?? look; // a Power Slap nearby beats all that
  if (look) {
    const a = Math.atan2(look.x - p.pos.x, look.z - p.pos.z);
    o.headY = Math.max(-1.1, Math.min(1.1, angDiff(p.face, a)));
  }
  return o;
}
// Where a bystander looks when a Power Slap is going on within 7 m of them (null: none).
function fightNear(p) {
  for (const m of slap.matches)
    if (
      m.fighters &&
      m.phase !== "gather" &&
      m.spots[0].pos.distanceToSquared(p.pos) < 49
    )
      return m.spots[0].pos;
  return null;
}
const SNAPPY = new Set(["walk", "run", "jump", "slapHit", "slapTake"]); // poses reached quickly
function applyPose(p, dt) {
  const k = animKey(p),
    o = targetPose(p, k, p.animT),
    c = p.pose,
    rate = 1 - Math.exp(-dt * (SNAPPY.has(k) ? 22 : 9));
  for (const j of JOINTS)
    c[j] = c[j] === undefined ? o[j] : c[j] + (o[j] - c[j]) * rate;
  const b = p.body,
    hold = HOLDING.has(k) ? b.hold : null;
  // standing poses move the hips relative to this character's own leg length; seated poses put them on the seat
  const hip = (b.standHip + c.hipY - POSE_HIP) * (1 - c.seat) + c.hipY * c.seat;
  b.hips.position.y = hip / b.unit;
  b.spine.rotation.x = c.lean;
  arm(b.armL, hold?.L, c.lShX, c.lShZ, c.lEl, 1);
  arm(b.armR, hold?.R, c.rShX, c.rShZ, c.rEl, -1);
  b.legL.rotation.x = c.lHip;
  b.legR.rotation.x = c.rHip;
  b.neck.rotation.set(c.headX, c.headY, 0);
  for (const it of b.items) if (it.visible !== !!hold) it.visible = !!hold;
}
// One-piece arm: the shoulder takes part of the elbow bend. While carrying a pack item, use the pack's pose for it.
function arm(node, held, shX, shZ, el, side) {
  if (held?.pose)
    node.rotation.set(held.pose.x ?? 0, 0, -(held.pose.z ?? 0) * side);
  else
    node.rotation.set((shX + el * ARM_BEND) * (held ? held.swing : 1), 0, shZ);
}

export { applyPose };
