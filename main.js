import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { Sim, L, HALF, WAVE, swell } from './sim.js';
import { makeUniforms } from './shaders.js';
import { buildWorld } from './world.js';
import { Particles, Towers, Decor, Crabs, Treasures, Cursor } from './props.js';

// ---------- renderer / scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1d8aa3');
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 700);
const HOME = { pos: new THREE.Vector3(-9, 33, 34), target: new THREE.Vector3(1, 0, -1) };
camera.position.set(-30, 95, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 10; controls.maxDistance = 85;
controls.minPolarAngle = 0.12; controls.maxPolarAngle = 1.2;
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.enabled = false;

const sim = new Sim();
const U = makeUniforms(sim, HALF, L);
const world = buildWorld(scene, sim, U);
const parts = new Particles(scene);
const towers = new Towers(scene, sim, parts);
const decor = new Decor(scene, sim, U);
const crabs = new Crabs(scene, sim, 5);
const cursor = new Cursor(scene, sim, towers, decor);

// ---------- post: tilt-shift miniature look + grade ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const hts = new ShaderPass(HorizontalTiltShiftShader), vts = new ShaderPass(VerticalTiltShiftShader);
hts.uniforms.r.value = vts.uniforms.r.value = 0.5;
composer.addPass(hts); composer.addPass(vts);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(.299, .587, .114)); c.rgb = mix(vec3(l), c.rgb, 1.12);
      c.rgb *= vec3(1.03, 1.0, 0.96);
      float v = smoothstep(0.95, 0.3, length((vUv - .5) * vec2(1.15, 1.0))); c.rgb *= mix(0.72, 1.0, v);
      gl_FragColor = c; }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth || 1280, h = window.innerHeight || 720;
  renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  hts.uniforms.h.value = 3.6 / w; vts.uniforms.v.value = 3.6 / h;
  parts.mat.uniforms.uScale.value = h * 0.9;
}
window.addEventListener('resize', resize); resize();

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const state = { tool: 'raise', decor: 'flag', brush: 1.3, autoTide: true, tide: 0, stars: 0 };
const setTool = (t) => {
  state.tool = t;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('decor').classList.toggle('show', t === 'decor');
};
document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('#decor button').forEach((b) => b.addEventListener('click', () => {
  state.decor = b.dataset.d;
  document.querySelectorAll('#decor button').forEach((o) => o.classList.toggle('on', o === b));
}));
$('tide').addEventListener('input', (e) => { state.tide = +e.target.value; state.autoTide = false; $('autoTide').checked = false; });
$('autoTide').addEventListener('change', (e) => { state.autoTide = e.target.checked; });
$('brush').addEventListener('input', (e) => { state.brush = +e.target.value; });
$('wave').addEventListener('click', bigWave);
$('demo').addEventListener('click', () => (demo ? stopDemo() : startDemo()));
$('reset').addEventListener('click', resetBeach);

let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
const treasures = new Treasures(sim, decor, parts, (tr) => {
  state.stars++; $('starCount').textContent = state.stars;
  const s = $('stars'); s.classList.add('pop'); setTimeout(() => s.classList.remove('pop'), 250);
  toast(`挖到寶物：${tr.name}！`);
});

function bigWave() { WAVE.bigT = simClock + 0.5; U.uBigT.value = WAVE.bigT; toast('大浪來了！'); }
function resetBeach() { stopDemo(); sim.reset(); towers.clear(); decor.clear(); treasures.reset(); }

// ---------- pointer / tools ----------
const ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
let pointerIn = false, painting = false, hit = null, lastWall = null, wallTop = 0;
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerIn = true; });
canvas.addEventListener('pointerleave', () => { pointerIn = false; painting = false; });
canvas.addEventListener('pointerdown', (e) => {
  startAudio();
  if (e.button !== 0) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerIn = true;
  hit = pick();
  if (!hit) return;
  painting = true; lastWall = null;
  if (state.tool === 'tower') towers.add(hit.x, hit.z, 0.55 + state.brush * 0.22);
  if (state.tool === 'decor') decor.add(state.decor, hit.x, hit.z);
});
window.addEventListener('pointerup', () => { painting = false; });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const tools = ['raise', 'dig', 'wall', 'tower', 'smooth', 'decor'];
  if (e.key >= '1' && e.key <= '6') setTool(tools[+e.key - 1]);
  else if (e.key === '[' || e.key === ']') { state.brush = Math.min(3, Math.max(0.5, state.brush + (e.key === ']' ? 0.15 : -0.15))); $('brush').value = state.brush; }
  else if (e.key === 'w' || e.key === 'W') bigWave();
  else if (e.key === 'b' || e.key === 'B') (demo ? stopDemo() : startDemo());
  else if (e.key === 'r' || e.key === 'R') resetBeach();
});
function pick() {
  ray.setFromCamera(ndc, camera);
  const p = sim.raycast(ray.ray);
  return p && sim.inside(p.x, p.z, 0.6) ? p : null;
}

const SAND = new THREE.Color('#c9a26a'), SAND_LIGHT = new THREE.Color('#e8cf9c');
// continuous tool application at p for dt seconds (mult speeds things up for the demo)
function applyTool(tool, p, dt, r, mult = 1) {
  if (tool === 'raise') {
    sim.raise(p.x, p.z, r, 0.9 * dt * mult);
    if (Math.random() < 0.7) { const a = Math.random() * 6.28, d = Math.random() * r * 0.6; parts.spawn(p.x + Math.cos(a) * d, sim.heightAt(p.x, p.z) + 0.7, p.z + Math.sin(a) * d, 0, -0.5, 0, SAND, 0.07, 0.5); }
  } else if (tool === 'dig') {
    const removed = sim.dig(p.x, p.z, r, 0.75 * dt * mult);
    const n = Math.min(6, removed * 25);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; parts.spawn(p.x, sim.heightAt(p.x, p.z) + 0.05, p.z, Math.cos(a) * (1 + Math.random() * 1.5), 2 + Math.random() * 2, Math.sin(a) * (1 + Math.random() * 1.5), SAND, 0.06 + Math.random() * 0.05, 1); }
  } else if (tool === 'smooth') {
    sim.smoothAt(p.x, p.z, r, 7 * dt * mult);
  } else if (tool === 'wall') {
    const from = lastWall || p;
    const d = Math.hypot(p.x - from.x, p.z - from.z), steps = Math.max(1, Math.ceil(d / 0.12));
    for (let s = 1; s <= steps; s++) {
      const x = from.x + (p.x - from.x) * s / steps, z = from.z + (p.z - from.z) * s / steps;
      sim.wall(x, z, r * 0.45, Math.max(sim.sample(sim.h0, x, z), wallTop));
      if (Math.random() < 0.3) parts.spawn(x, sim.heightAt(x, z) + 0.1, z, (Math.random() - 0.5), 1.2, (Math.random() - 0.5), SAND_LIGHT, 0.06, 0.6);
    }
    lastWall = { x: p.x, z: p.z };
  }
}

// ---------- scripted demo: builds a little castle, cuts a channel, sends a wave ----------
let demo = null, demoHit = null, demoTool = null;
function* demoScript() {
  const C = { x: -6, z: -3 };
  const at = (r, a) => ({ x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r });
  const stroke = function* (tool, pts, frames, r, mult) {
    demoTool = tool; lastWall = null;
    if (tool === 'wall') wallTop = Math.max(...pts.map((p) => sim.heightAt(p.x, p.z))) + 0.6;
    for (const p of pts) for (let f = 0; f < frames; f++) { demoHit = { x: p.x, z: p.z }; applyTool(tool, demoHit, 1 / 60, r, mult); yield; }
  };
  // dig each spot until it sits below the low-tide line so the sea can fill it
  const trench = function* (pts, r) {
    demoTool = 'dig';
    for (const p of pts) for (let f = 0; f < 14 && (f < 2 || sim.heightAt(p.x, p.z) > -0.32); f++) { demoHit = { x: p.x, z: p.z }; applyTool('dig', demoHit, 1 / 60, r, 5); yield; }
  };
  const wait = function* (n) { for (let i = 0; i < n; i++) yield; };
  const ring = (r, n, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => at(r, a0 + (a1 - a0) * i / n));

  // moat
  yield* trench(ring(6.6, 120), 1.0);
  yield* stroke('smooth', ring(6.6, 40), 2, 1.2, 1);
  // walls: an octagon
  const oct = ring(3.7, 8, Math.PI / 8, Math.PI / 8 + Math.PI * 2);
  const path = [];
  for (let i = 0; i < 8; i++) for (let s = 0; s < 8; s++) path.push({ x: oct[i].x + (oct[i + 1].x - oct[i].x) * s / 8, z: oct[i].z + (oct[i + 1].z - oct[i].z) * s / 8 });
  yield* stroke('wall', path, 3, 1.3, 1);
  // towers on four corners, then the keep stacked three high
  demoTool = 'tower';
  for (let i = 0; i < 8; i += 2) { demoHit = oct[i]; towers.add(oct[i].x, oct[i].z, 0.72); yield* wait(40); }
  demoHit = C;
  towers.add(C.x, C.z, 1.15); yield* wait(80);
  towers.add(C.x, C.z, 1.15); yield* wait(80);
  towers.add(C.x, C.z, 1.15); yield* wait(80);
  // flags + trimmings
  demoTool = 'decor';
  for (let i = 0; i < 8; i += 2) { decor.add('flag', oct[i].x, oct[i].z); yield* wait(14); }
  decor.add('flag', C.x, C.z); yield* wait(14);
  for (let i = 0; i < 14; i++) { const p = at(4.6 + Math.random() * 0.6, Math.random() * 6.28); decor.add(['shell', 'pebble', 'star', 'shell'][i % 4], p.x, p.z); yield* wait(5); }
  // channel to the sea
  const ch = [];
  for (let x = C.x + 6.4; x < C.x + 22; x += 0.3) ch.push({ x, z: C.z + Math.sin((x - C.x) * 0.25) * 0.8 });
  yield* trench(ch, 0.9);
  demoHit = null; demoTool = null;
  yield* wait(240);
  bigWave();
}
function startDemo() { resetBeach(); demo = demoScript(); $('demo').classList.add('on'); }
function stopDemo() { demo = null; demoHit = null; demoTool = null; $('demo').classList.remove('on'); }

// ---------- ambient surf (starts on first interaction) ----------
let audio = null;
function startAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(ctx.destination); src.start();
    audio = { ctx, g, lp };
  } catch (e) { audio = { fail: true }; }
}

// ---------- loop ----------
let simClock = 0, acc = 0, wall = 0, intro = 0;
function frame(dt) {
  dt = Math.min(dt, 0.05);
  wall += dt;
  // intro camera glide
  if (intro < 1) {
    intro = Math.min(1, intro + dt / 3.2);
    const k = 1 - Math.pow(1 - intro, 3);
    const fit = Math.max(1, Math.min(2.3, 1.3 / camera.aspect));     // portrait screens: pull back so the beach fits
    controls.target.set(HOME.target.x - 3.5 * (fit - 1), 0, HOME.target.z);
    const home = HOME.pos.clone().sub(HOME.target).multiplyScalar(fit).add(controls.target);
    controls.maxDistance = 85 * fit;
    camera.position.lerpVectors(new THREE.Vector3(-30, 95, 110), home, k);
    camera.lookAt(controls.target);
    if (intro >= 1) { controls.enabled = true; if (!demo && !window.__noDemo) startDemo(); }
  }
  // tide
  if (state.autoTide) { state.tide = 0.05 + 0.3 * Math.sin(simClock * Math.PI * 2 / 160 - 1.2); $('tide').value = state.tide.toFixed(2); }
  sim.tide = state.tide;

  // tools
  hit = pointerIn ? pick() : null;
  if (painting && hit && !['tower', 'decor'].includes(state.tool)) {
    if (state.tool === 'wall' && !lastWall) wallTop = sim.heightAt(hit.x, hit.z) + 0.45 + state.brush * 0.15;
    applyTool(state.tool, hit, dt, state.brush);
  }
  if (demo && demo.next().done) stopDemo();

  // simulation at a fixed 60 Hz
  acc += dt; let n = 0;
  while (acc >= 1 / 60 && n < 2) { sim.step(1 / 60, simClock); simClock += 1 / 60; acc -= 1 / 60; n++; }
  if (n === 2) acc = 0;
  sim.upload();
  U.uTime.value = simClock; U.uTide.value = sim.tide;

  towers.update(dt); decor.update(dt); treasures.update(dt); parts.update(dt, sim);
  crabs.update(dt, wall, hit || demoHit);
  world.update(wall, dt);
  const showHit = demoHit ? { x: demoHit.x, z: demoHit.z } : hit;
  cursor.update(wall, showHit, demoHit ? demoTool : state.tool, demoHit ? 1.1 : state.brush, demoHit ? true : painting, state.decor);

  if (audio && audio.g) {
    const crest = Math.max(0, swell(10, simClock)) / 0.3;
    audio.g.gain.setTargetAtTime(0.05 + 0.22 * Math.min(1.5, crest), audio.ctx.currentTime, 0.3);
    audio.lp.frequency.setTargetAtTime(500 + 900 * Math.min(1, crest), audio.ctx.currentTime, 0.3);
  }
  if (controls.enabled) controls.update();
  composer.render();
}

let last = performance.now();
renderer.setAnimationLoop(() => { const now = performance.now(); frame((now - last) / 1000); last = now; });

// test hook: pump frames when the tab is throttled
window.__sc = { sim, towers, decor, camera, controls, U, state, frame: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) frame(dt); }, startDemo, stopDemo, bigWave, setTool };
