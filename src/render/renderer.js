import * as THREE from 'three';

/* ================= Renderer, scene, camera ================= */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);

const hemi = new THREE.HemisphereLight(0xf4f8fb, 0xaab4bb, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e2, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xdfe9f2, 0.35);
fill.position.set(-20, 30, 25); scene.add(fill);

function readToken(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#e6ecef'; }
const groundMat = new THREE.MeshStandardMaterial({ color: readToken('--ground'), roughness: 1 });
function applyTheme() { scene.background = new THREE.Color(readToken('--bg')); groundMat.color.set(readToken('--ground')); }
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

export { camera, groundMat, hemi, renderer, scene, sun };
