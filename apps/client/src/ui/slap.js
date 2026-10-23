import {
  SLAP_KO_FROM,
  SLAP_ROUNDS,
  inSlap,
  live,
  people,
  pick,
  slap,
  slapEnd,
  slapHit,
  slapPower,
  slapTurn,
  startSlap,
} from "@office/shared";
import { setView } from "../camera/controller.js";
import { camGoal } from "../camera/state.js";
import { chatSocket, onChatSocket } from "../net/online.js";
import { ctl } from "../player/control.js";
import { player, spawnPlayer, takeControl } from "../player/player.js";
import { standUp } from "../player/seating.js";
import { $, keyed } from "./dom.js";
import { selected } from "./person.js";

/* ================= Power Slap: challenges and the fight card ================= */
// "Power Slap" on someone's card (or, walking around, on whoever you look at) challenges them. In Simulate you pick
// who takes them on; in Live, or walking around, it is whoever you walk as. Someone in the office answers for
// themselves, and if they say yes you control the fighter, in third person (V for first). A fight between two people
// in the office can be taken over too: "Control …" on the fight card. People online are different: pick who you are under
// "Power Slap" in the dock, and anyone else online can challenge you, or you them, at any time; it waits for
// the other person to accept, the server referees (server/slap.js) and everyone online sees the fight.
// The card at the top shows a challenge for you and the fight going on (yours first). On your turn its power
// meter runs: SLAP (or Space or Enter) stops it, and the higher it was, the harder the slap.
const ME_KEY = "officeSim.slapMe";
// `pick`: who you are picking a fighter against; `picked`: the last fighter you picked.
const ui = {
  me: null,
  online: [],
  invite: null,
  note: "",
  noteUntil: 0,
  asking: false,
  pick: null,
  picked: null,
  turn: null,
  meterFrom: 0,
  faced: null,
  landed: null,
  shown: new Map(),
};
const EXCUSES = [
  "has a deadline",
  "just had lunch",
  "is scared of you",
  "says maybe after the sprint",
  "is in the middle of a bug",
];

const keyOf = (p) => String(p.userId ?? p.name); // who an employee is, online
const firstName = (name) => name.split(" ")[0];
const byKey = (key) =>
  people.find((p) => !p.helper && keyOf(p) === key) ?? null;
const isOnline = (p) =>
  !!p && keyOf(p) !== ui.me?.key && ui.online.some((o) => o.key === keyOf(p));
function note(text, secs = 5) {
  ui.note = text;
  ui.noteUntil = performance.now() + secs * 1000;
}

// The meter: 0 to 1 and back, about once a second.
function meter(now) {
  const x = ((now - ui.meterFrom) / 850) % 2;
  return x < 1 ? x : 2 - x;
}
// The fight to show: yours, else an online one, else the office's latest.
function featured() {
  let best = null,
    rank = -1;
  for (const m of slap.matches) {
    const r = m.mine !== null ? 2 : m.online ? 1 : 0;
    if (r >= rank) {
      best = m;
      rank = r;
    }
  }
  return best;
}
const myTurn = (m) =>
  !!m && m.phase === "wind" && m.waiting && m.mine === m.slapper;

// Fly the orbit camera to the table (not while you walk around as your character: you are there already).
function watch(m) {
  if (ctl.active || !m?.fighters) return;
  const [a, b] = m.spots.map((s) => s.pos);
  setView("free");
  camGoal.target.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  camGoal.dist = 7;
  camGoal.pitch = 0.55;
}

// "Power Slap" on someone's card. In Simulate you first pick who takes them on (and control them); in Live (real
// people) and while walking around, it is whoever you walk as.
function challenge(p) {
  if (isOnline(p)) return challengeOnline(keyOf(p), p.name);
  if (player.person && inSlap(player.person))
    return note("Finish your fight first");
  if (live.mode !== "live" && !ctl.active) return openPick(p);
  ask(p, null);
}
// Who can take someone on: anyone in the office who is free.
const fighters = (target) =>
  people
    .filter(
      (q) => q !== target && q.state !== "away" && !q.toiletUntil && !inSlap(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
function openPick(p) {
  const list = fighters(p),
    keep = [ui.picked, ui.me && byKey(ui.me.key)].find(
      (q) => q && list.includes(q),
    ); // last pick, else who you are online
  $("slapWho").replaceChildren(
    ...list.map((q) => new Option(q.name, keyOf(q))),
  );
  if (keep) $("slapWho").value = keyOf(keep);
  ui.pick = p;
  set("slapPickTitle", `Who takes on ${firstName(p.name)}?`);
}
function confirmPick() {
  const p = ui.pick,
    who = people.find((q) => keyOf(q) === $("slapWho").value);
  ui.pick = null;
  if (p && who) {
    ui.picked = who;
    ask(p, who);
  }
}
// Ask them; after a moment they say yes or no. Yes: `fighter` (null: whoever you walk as, else your own character)
// fights them, controlled by you in third person.
function ask(p, fighter) {
  if (ui.asking) return;
  ui.asking = true;
  note(`Waiting for ${firstName(p.name)} to answer…`, 3);
  setTimeout(() => {
    ui.asking = false;
    const why = p.toiletUntil
      ? "is Deploying to the toilet"
      : p.state === "away"
        ? "is not in the office"
        : inSlap(p)
          ? "is already in a fight"
          : p.meeting
            ? "is in a meeting"
            : !p.hazel && Math.random() < 0.3
              ? pick(EXCUSES)
              : null; // Hazel never says no
    if (why) return note(`${firstName(p.name)} said no: ${why}`);
    if (fighter && (fighter.state === "away" || inSlap(fighter)))
      return note(`${firstName(fighter.name)} is not free any more`);
    if (fighter && fighter !== player.person) {
      if (ctl.active) setView("free");
      takeControl(fighter);
    }
    const me = spawnPlayer();
    if (player.sitting) standUp(me);
    const m = startSlap(me, p, { mine: 0 });
    if (!m) return note("No free table in the dining area right now");
    note(`${firstName(p.name)} accepted!`, 3);
    if (!ctl.active) setView("third"); // fight it yourself
  }, 1400);
}
function challengeOnline(key, name) {
  if (!ui.me) {
    note("Pick who you are under Power Slap in the dock first");
    return;
  }
  const s = chatSocket();
  if (!s) {
    note("You are not online");
    return;
  }
  s.timeout(5000).emit("slap:challenge", { to: key }, (err, res) => {
    if (err) return note("The challenge did not go through");
    if (!res?.ok) return note(res?.error || "The challenge did not go through");
    note(`Waiting for ${firstName(name)} to accept…`, 20);
  });
}
function answer(accept) {
  const inv = ui.invite;
  if (!inv) return;
  ui.invite = null;
  chatSocket()?.emit("slap:answer", { id: inv.id, accept });
}
// The meter is stopped: a slap that hard. The server referees online fights.
function strike() {
  const m = featured();
  if (!myTurn(m)) return;
  const power = meter(performance.now());
  slapPower(m, power);
  if (m.online) chatSocket()?.emit("slap:power", { id: m.id, power });
}

// ----- who you are online, and who else is
// Who you are online. The server gives the first browser to be an employee a token that keeps them theirs
// (server/slap.js); it is kept with the choice in this browser.
function setMe(key) {
  const p = key ? byKey(key) : null,
    was = ui.me;
  ui.me = p
    ? {
        key,
        name: p.name,
        token: was?.key === key ? was.token : ui.token?.[key],
      }
    : null;
  claim(was);
}
function claim(was) {
  const s = chatSocket();
  if (!s) {
    renderOnline();
    return;
  } // offline: claimed on the next connect
  s.timeout(5000).emit("slap:iam", ui.me, (err, res) => {
    if (err) return; // offline: tried again on connect
    if (!res?.ok) {
      note(res?.error || "That did not work");
      ui.me = was ?? null;
      fillMe();
      renderOnline();
      return;
    }
    if (ui.me && res.token) {
      ui.me.token = res.token;
      (ui.token ??= {})[ui.me.key] = res.token;
    }
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(ui.me));
    } catch (_) {}
    renderOnline();
  });
  renderOnline();
}
function fillMe() {
  const list = people
    .filter((p) => !p.helper)
    .sort((a, b) => a.name.localeCompare(b.name));
  $("slapMe").replaceChildren(
    new Option("Nobody (not online)", ""),
    ...list.map((p) => new Option(p.name, keyOf(p))),
  );
  $("slapMe").value = ui.me?.key ?? "";
}
function renderOnline() {
  const others = ui.online.filter((o) => o.key !== ui.me?.key);
  $("slapOnline").replaceChildren(
    ...others.map((o) => {
      const li = document.createElement("li"),
        name = document.createElement("span"),
        b = document.createElement("button");
      name.textContent = o.name;
      b.type = "button";
      b.className = "btn sm";
      b.disabled = o.busy;
      b.textContent = o.busy ? "In a fight" : "Challenge";
      b.onclick = () => challengeOnline(o.key, o.name);
      li.append(name, b);
      return li;
    }),
  );
  $("slapNobody").hidden = others.length > 0;
}

// The person card's button: not for you, nor for someone already fighting.
function renderSlapButton(p) {
  const b = $("pSlap");
  b.hidden = !p || (!!ui.me && keyOf(p) === ui.me.key) || inSlap(p);
  if (!b.hidden)
    b.textContent = isOnline(p) ? "Challenge online" : "Power Slap";
}

// ----- the fight card, every frame (the meter moves); the DOM is only touched when something changed
function set(id, text) {
  if (ui.shown.get(id) !== text) {
    ui.shown.set(id, text);
    $(id).textContent = text;
  }
}
function show(id, on) {
  const el = $(id);
  if (el.hidden === on) el.hidden = !on;
}
function flag(id, cls, on) {
  const el = $(id);
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}
function bar(id, power) {
  const s = `scaleX(${Math.min(1, power / SLAP_ROUNDS).toFixed(3)})`;
  if (ui.shown.get(id) !== s) {
    ui.shown.set(id, s);
    $(id).style.transform = s;
  }
}
function stateText(m) {
  const [a, b] = m.names,
    s = m.names[m.slapper],
    r = m.names[1 - m.slapper];
  if (m.phase === "gather")
    return m.reason
      ? `${a} and ${b} are settling ${m.reason}`
      : "Heading to the dining area";
  if (m.phase === "wind")
    return myTurn(m) ? "Your slap. Stop the meter past KO" : `${s} winds up`;
  if (m.phase === "after")
    return m.ko ? `KO! ${r} is down` : `${r} is seeing birds`;
  return m.winner === null
    ? "Draw"
    : `${m.names[m.winner]} ${m.names[m.winner] === "You" ? "win" : "wins"} ${m.how === "ko" ? "by KO" : "on points"}`;
}
function updateSlapCard() {
  const now = performance.now(),
    m = featured(),
    inv = ui.invite;
  if (ui.note && now > ui.noteUntil) ui.note = "";
  const msg = inv ? `${inv.from.name} challenges you to a Power Slap` : ui.note;
  set("slapMsg", msg);
  show("slapMsg", !!msg);
  show("slapAnswer", !!inv);
  if (ui.pick && (ui.pick.state === "away" || inSlap(ui.pick))) ui.pick = null; // they went off
  show("slapPick", !!ui.pick);
  show("slapBoard", !!m);
  if (m) {
    const round = Math.min(
      SLAP_ROUNDS,
      m.phase === "wind"
        ? Math.floor(m.turn / 2) + 1
        : Math.max(1, Math.ceil(m.turn / 2)),
    );
    set("slapA", m.names[0]);
    set("slapB", m.names[1]);
    set("slapPtsA", String(Math.round(m.power[0] * 100)));
    set("slapPtsB", String(Math.round(m.power[1] * 100)));
    bar("slapBarA", m.power[0]);
    bar("slapBarB", m.power[1]);
    // whose turn it is (wind-up), or who won
    const lead =
      m.phase === "wind" ? m.slapper : m.phase === "end" ? m.winner : null;
    flag("slapSideA", "dim", lead === 1);
    flag("slapSideB", "dim", lead === 0);
    set(
      "slapRound",
      m.phase === "end" ? "Final" : `Round ${round} of ${SLAP_ROUNDS}`,
    );
    set("slapState", stateText(m));
    flag("slapState", "big", m.ko || m.phase === "end");
    const takeOver =
      !m.online && m.mine === null && m.phase !== "end" && !!m.fighters;
    show("slapAsA", takeOver);
    show("slapAsB", takeOver);
    if (takeOver) {
      set("slapAsA", `Control ${m.names[0]}`);
      set("slapAsB", `Control ${m.names[1]}`);
    }
    show("slapWatch", !!m.fighters && !ctl.active);
    show("slapActs", takeOver || (!!m.fighters && !ctl.active));
    // the card jolts as each slap lands, harder for a knockout
    const landed = m.phase === "after" ? `${m.id}:${m.turn}` : null;
    if (landed && landed !== ui.landed) {
      const c = $("slapCard");
      c.classList.remove("jolt", "jolt-ko");
      void c.offsetWidth;
      c.classList.add(m.ko ? "jolt-ko" : "jolt");
    }
    ui.landed = landed ?? ui.landed;
  }
  const mine = myTurn(m),
    turn = mine ? `${m.id}:${m.turn}` : null;
  if (turn !== ui.turn) {
    ui.turn = turn;
    ui.meterFrom = now;
  }
  show("slapMeterRow", mine);
  if (mine) $("slapMark").style.left = `${(meter(now) * 100).toFixed(1)}%`;
  show("slapCard", !!msg || !!m || !!ui.pick);
  // your fight, walking around: once at the table, the camera turns to face the other one
  const you = player.person;
  if (
    ctl.active &&
    m &&
    m.phase !== "gather" &&
    ui.faced !== m.id &&
    you?.task?.slap === m
  ) {
    ui.faced = m.id;
    ctl.yaw = you.task.spot.face;
    ctl.pitch = -0.1;
  }
  // walking around: challenge whoever you are looking at
  const target = ctl.active ? player.lookAt : null,
    can =
      !!target &&
      target.state !== "away" &&
      !inSlap(target) &&
      !inSlap(player.person);
  show("fpSlap", can);
  if (can)
    keyed(
      $("fpSlap"),
      ctl.coarse ? null : "P",
      `Power Slap ${firstName(target.name)}`,
    );
}
// Take control of one side of a fight in the office: walk as them in third person and slap with the meter.
function controlSide(side) {
  const m = featured();
  if (!m?.fighters || m.online) return;
  if (ctl.active) setView("free"); // let go of whoever you had first
  takeControl(m.fighters[side]); // (and their side of the fight)
  setView("third");
}
function challengeLooked() {
  if (ctl.active && player.lookAt && !$("fpSlap").hidden)
    challenge(player.lookAt);
}

function initSocket(s) {
  s.on("connect", () => {
    if (ui.me) claim(null);
  });
  s.on("slap:online", (list) => {
    ui.online = Array.isArray(list) ? list : [];
    renderOnline();
  });
  s.on("slap:invite", (inv) => {
    ui.invite = inv;
  });
  s.on("slap:invite-closed", ({ id }) => {
    if (ui.invite?.id === id) ui.invite = null;
  });
  s.on("slap:declined", ({ name, why }) => note(`${firstName(name)} ${why}`));
  // everyone online sees the fight with their own copies of the two employees (when they are in their office)
  s.on("slap:start", ({ id, a, b, table, first }) => {
    const pa = byKey(a.key),
      pb = byKey(b.key),
      mine = a.key === ui.me?.key ? 0 : b.key === ui.me?.key ? 1 : null;
    const m = startSlap(pa && pb ? pa : null, pa && pb ? pb : null, {
      online: true,
      id,
      table,
      first,
      mine,
      names: [firstName(a.name), firstName(b.name)],
    });
    if (mine !== null) {
      note("", 0);
      watch(m);
    }
  });
  const byId = (id) => slap.matches.find((m) => m.online && m.id === id);
  s.on("slap:turn", ({ id, slapper }) => {
    const m = byId(id);
    if (m) slapTurn(m, slapper);
  });
  s.on("slap:hit", ({ id, power, ko }) => {
    const m = byId(id);
    if (m) slapHit(m, power, ko);
  });
  s.on("slap:end", ({ id, winner, how }) => {
    const m = byId(id);
    if (m) slapEnd(m, winner, how);
  });
}

function initSlap() {
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY));
    if (saved?.key && byKey(saved.key))
      ui.me = {
        key: saved.key,
        name: byKey(saved.key).name,
        token: saved.token,
      };
  } catch (_) {}
  slap.on = true; // office arguments may end in a Power Slap (the server keeps it off: it referees online fights instead)
  onChatSocket(initSocket); // the socket exists after login (net/online.js); offline, the online parts just never fire
  $("slapMeter").style.setProperty("--ko", `${SLAP_KO_FROM * 100}%`); // the KO mark on the power meter
  $("slapBtn").addEventListener("click", fillMe); // the dock pop-up itself opens and closes like the others (ui/controls.js)
  $("slapMe").onchange = (e) => setMe(e.target.value);
  $("pSlap").onclick = () => {
    if (selected) challenge(selected);
  };
  $("slapYes").onclick = () => answer(true);
  $("slapNo").onclick = () => answer(false);
  $("slapGo").onclick = strike;
  $("slapWatch").onclick = () => watch(featured());
  $("slapPickGo").onclick = confirmPick;
  $("slapPickNo").onclick = () => {
    ui.pick = null;
  };
  $("slapWho").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmPick();
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") ui.pick = null;
  });
  $("slapAsA").onclick = () => controlSide(0);
  $("slapAsB").onclick = () => controlSide(1);
  $("fpSlap").onclick = challengeLooked;
  addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() === "p" &&
      !e.repeat &&
      e.target.tagName !== "INPUT"
    )
      challengeLooked();
  });
  // Space or Enter stops the meter (before Space can pause the clock)
  addEventListener(
    "keydown",
    (e) => {
      if (
        !myTurn(featured()) ||
        e.repeat ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
        (e.code !== "Space" && e.key !== "Enter")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      strike();
    },
    { capture: true },
  );
  renderOnline();
}

export { initSlap, renderSlapButton, updateSlapCard };
