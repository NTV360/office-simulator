import { NEVER, isHelper } from "@office/shared";
import * as THREE from "three";
import { follow, following, setView, viewId } from "../camera/controller.js";
import { isLocalPlayer } from "../player/player.js";
import { scene } from "../render/renderer.js";
import { fillAvatar } from "./avatar.js";
import { $ } from "./dom.js";
import { describeStatus, fmt } from "./status-text.js";

/* ================= Selection + UI ================= */
let selected = null;
const selRing = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.47, 40),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }),
);

// The card sits in the bottom-left corner, lifted above the dock only when they would overlap (phones: the stylesheet places it). The chat panel
// (net/chat.js) stands above the card while it is open: `--card-top` is how far up the card reaches from the bottom of the window.
function placeCard() {
  const card = $("person"),
    root = document.documentElement.style;
  card.style.bottom = "";
  if (card.hidden) {
    root.removeProperty("--card-top");
    return;
  }
  if (!matchMedia("(max-width:760px)").matches) {
    const dock = $("dock").getBoundingClientRect(),
      r = card.getBoundingClientRect();
    const clash = dock.width > 0 && r.left < dock.right && r.right > dock.left; // a hidden dock has no size
    card.style.bottom = clash
      ? `${Math.round(innerHeight - dock.top + 10)}px`
      : "16px";
  }
  root.setProperty(
    "--card-top",
    `${Math.round(innerHeight - card.getBoundingClientRect().top + 10)}px`,
  );
}
function select(p) {
  selected = p;
  $("person").hidden = !p;
  selRing.visible = !!p;
  if (p) $("pAvatar").dataset.key = ""; // (renderPerson fills it)
  if (!p && viewId() === "follow") setView("free");
  renderPerson();
}
function renderPerson() {
  const p = selected;
  if (!p) return;
  $("pName").textContent = p.name;
  $("pRole").textContent =
    `${p.title ?? p.role}${p.slot ? " · " + (p.slot.label ?? p.slot.place) : isHelper(p) ? "" : " · visiting"}`;
  {
    // the avatar follows the person's picture, name and shirt (a changed picture shows without closing the card)
    const a = $("pAvatar"),
      color = p.spec?.top?.color ?? "#3e6e9c",
      key = `${p.photo ?? ""}|${p.name}|${color}`;
    if (a.dataset.key !== key) {
      a.dataset.key = key;
      fillAvatar(a, { name: p.name, photo: p.photo, color });
    }
  }
  $("pStatus").textContent = statusText(p);
  // just the time in; nothing when they have not arrived (the status line already says so)
  const inAt =
    p.arrivedAt && Number.isFinite(p.arrivedAt) && p.arrivedAt < NEVER
      ? p.arrivedAt
      : null;
  $("pMeta").textContent = inAt === null ? "" : `Time in ${fmt(inAt)}`;
  $("pMeta").hidden = inAt === null;
  $("pFollow").textContent = following() === p ? "Following" : "Follow";
  $("pEdit").hidden = !isLocalPlayer(p); // the look you can change is your own character's
  renderSlapButton(p);
  // walking as them: only offline (online they are real people at work), and not mid-fight
  $("pControl").hidden =
    !!player.online ||
    p === player.person ||
    p.state === "away" ||
    !!p.task?.slap?.online ||
    !!player.person?.task?.slap;
  placeCard();
}

function initPerson() {
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  selRing.renderOrder = 3;
  scene.add(selRing);
  $("pFollow").onclick = () => {
    if (!selected || selected.state === "away") return;
    follow(selected);
    renderPerson();
  };
  $("pClose").onclick = () => select(null);
  $("pControl").onclick = () => {
    if (selected && !$("pControl").hidden) {
      takeControl(selected);
      setView("third");
    }
  };
  $("pEdit").onclick = () => {
    if (isLocalPlayer(selected)) openCreator();
  };
  addEventListener("resize", placeCard);
}

const statusText = (p) => describeStatus(p, isLocalPlayer(p));
export { fmt, initPerson, renderPerson, selRing, select, selected, statusText };
