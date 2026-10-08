import * as THREE from 'three';

/* ================= Materials & textures ================= */
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
const tileTex = canvasTex(256, 256, (g, w) => {
  g.fillStyle = '#f2f4f5'; g.fillRect(0, 0, w, w);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(120,135,145,${Math.random() * .05})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
  g.strokeStyle = 'rgba(140,155,165,.35)'; g.lineWidth = 2;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, w); g.stroke(); g.beginPath(); g.moveTo(0, i * w / 2); g.lineTo(w, i * w / 2); g.stroke(); }
}, 1 / 1.2);
const carpetTex = canvasTex(128, 128, (g, w) => {
  g.fillStyle = '#d8e8dc'; g.fillRect(0, 0, w, w);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(60,110,80,${Math.random() * .08})`; g.fillRect(Math.random() * w, Math.random() * w, 1.5, 1.5); }
}, 1);
const woodTex = canvasTex(256, 256, (g, w) => {
  for (let i = 0; i < 8; i++) {
    const l = 78 + Math.random() * 6; g.fillStyle = `hsl(32,38%,${l}%)`; g.fillRect(0, i * 32, w, 32);
    g.fillStyle = 'rgba(120,85,50,.25)'; g.fillRect(0, i * 32, w, 1.5);
    const off = Math.random() * w; g.fillRect(off, i * 32, 1.5, 32);
    for (let k = 0; k < 6; k++) { g.strokeStyle = 'rgba(140,100,60,.08)'; g.beginPath(); const y = i * 32 + Math.random() * 32; g.moveTo(0, y); g.bezierCurveTo(80, y + 3, 160, y - 3, w, y); g.stroke(); }
  }
}, 1 / 1.6);

const M = {
  floor: new THREE.MeshStandardMaterial({ map: tileTex, roughness: .92 }),
  slab: new THREE.MeshStandardMaterial({ color: 0x9aa8b2, roughness: .9 }),
  carpet: new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  boothFloor: new THREE.MeshStandardMaterial({ color: 0xeee4d0, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1 }),
  wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: .8, polygonOffset: true, polygonOffsetFactor: -1 }),
  pad: new THREE.MeshStandardMaterial({ color: 0xc9d1d6, roughness: 1 }),
  mat: new THREE.MeshStandardMaterial({ color: 0x3b4a55, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xf6f7f7, roughness: .9 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x25323d, roughness: .7 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd0e4, transparent: true, opacity: .32, roughness: .1, metalness: .1, depthWrite: false }),
  mullion: new THREE.MeshStandardMaterial({ color: 0x3a93b8, roughness: .5, metalness: .2 }),
  deskTop: new THREE.MeshStandardMaterial({ color: 0xfafaf8, roughness: .55 }),
  deskEdge: new THREE.MeshStandardMaterial({ color: 0x8c9aa6, roughness: .5, metalness: .4 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0xbccbd8, roughness: 1 }),
  chairSeat: new THREE.MeshStandardMaterial({ color: 0x33424e, roughness: .9 }),
  chairSeat2: new THREE.MeshStandardMaterial({ color: 0x3d6f7d, roughness: .9 }),
  chairBase: new THREE.MeshStandardMaterial({ color: 0x1c2329, roughness: .5, metalness: .5 }),
  monitor: new THREE.MeshStandardMaterial({ color: 0x1b2126, roughness: .4, metalness: .3 }),
  keyboard: new THREE.MeshStandardMaterial({ color: 0xe4e8eb, roughness: .7 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x222a30, roughness: .6 }),
  confTable: new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: .45 }),
  sofa: new THREE.MeshStandardMaterial({ color: 0xdcc9a6, roughness: 1 }),
  sofaDark: new THREE.MeshStandardMaterial({ color: 0xc4ad85, roughness: 1 }),
  booth: new THREE.MeshStandardMaterial({ color: 0xefe2c8, roughness: .9 }),
  boothFrame: new THREE.MeshStandardMaterial({ color: 0xc39c62, roughness: .6 }),
  boothGlass: new THREE.MeshStandardMaterial({ color: 0xf4e3c0, transparent: true, opacity: .35, roughness: .1, depthWrite: false }),
  locker: new THREE.MeshStandardMaterial({ color: 0xe6dfec, roughness: .6, metalness: .1 }),
  lockerLine: new THREE.MeshStandardMaterial({ color: 0xb4a8c4, roughness: .6 }),
  counter: new THREE.MeshStandardMaterial({ color: 0xe5e9ec, roughness: .6 }),
  sinkCab: new THREE.MeshStandardMaterial({ color: 0xd5ebf2, roughness: .6 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc6ced4, roughness: .25, metalness: .8 }),
  diningWood: new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: .6 }),
  diningWood2: new THREE.MeshStandardMaterial({ color: 0x9c7a55, roughness: .6 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: .8 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x5f9a62, roughness: .8, flatShading: true }),
  leaf2: new THREE.MeshStandardMaterial({ color: 0x467f4f, roughness: .8, flatShading: true }),
  waterBottle: new THREE.MeshStandardMaterial({ color: 0x7fc1e3, transparent: true, opacity: .6, roughness: .1 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff5a4a }),
  blind: new THREE.MeshStandardMaterial({ roughness: .8, map: canvasTex(16, 32, (g, w, h) => { g.fillStyle = '#efebe3'; g.fillRect(0, 0, w, h); g.fillStyle = '#fbfaf7'; g.fillRect(0, 2, w, 8); g.fillStyle = '#cfc8bb'; g.fillRect(0, h - 5, w, 3); g.fillStyle = '#b9b1a3'; g.fillRect(0, h - 2, w, 2); }) }),
  blindRail: new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: .5, metalness: .2 }),
  brandPanel: new THREE.MeshStandardMaterial({ color: 0xf8f7f4, roughness: .6 }),
  turf: new THREE.MeshStandardMaterial({ color: 0x4f9a55, roughness: 1 }),
  turfDark: new THREE.MeshStandardMaterial({ color: 0x3f8146, roughness: 1 }),
  flag: new THREE.MeshStandardMaterial({ color: 0xd9433a, side: THREE.DoubleSide, roughness: .8 }),
  golfRed: new THREE.MeshStandardMaterial({ color: 0xd9694f, roughness: .7 }),
  golfBlue: new THREE.MeshStandardMaterial({ color: 0x3e6e9c, roughness: .7 }),
  golfBallY: new THREE.MeshStandardMaterial({ color: 0xf2d14a, roughness: .5 }),
  dartPanel: new THREE.MeshStandardMaterial({ color: 0x2b3a44, roughness: .9 }),
  dartSurround: new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: .7 }),
  chalk: new THREE.MeshStandardMaterial({ color: 0x24302a, roughness: 1 }),
  rack: new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: .5, metalness: .4 }),
  rackGlass: new THREE.MeshStandardMaterial({ color: 0x0d1418, transparent: true, opacity: .55, roughness: .1, metalness: .3 }),
  musicRug: new THREE.MeshStandardMaterial({ color: 0x8e5a4a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
  keyboardBody: new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: .4 }),
  guitarBody: new THREE.MeshStandardMaterial({ color: 0xc98a4b, roughness: .45 }),
  rug: new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  featureWall: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: .85 }),
  cabinet: new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: .7 }),
  cabinetLine: new THREE.MeshStandardMaterial({ color: 0xc2ad8c, roughness: .7 }),
  armchair: new THREE.MeshStandardMaterial({ color: 0x9fb6a6, roughness: 1 }),
  barTop: new THREE.MeshStandardMaterial({ color: 0xefe3cf, roughness: .5 }),
  notebook: [0xd9694f, 0x3f7fb5, 0xe2b65c, 0x5b8f6c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .8 })),
};

export { M, canvasTex };
