// Interactive props: sand particles, bucket towers, decorations + flags, crabs, buried treasures, tool cursor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shoreS } from './sim.js';

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const RED = '#e2402f';
const SAND_WET = new THREE.Color('#c9a26a'), SAND_DRY = new THREE.Color('#efd5a2');

// grain texture shared by sculpted props
function grainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 215 + Math.random() * 40; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- particles ----------------
export class Particles {
  constructor(scene, max = 3000) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.a = new Float32Array(max); this.s = new Float32Array(max);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - .5; float r = length(d); if (r > .5) discard; gl_FragColor = vec4(vC, vA * smoothstep(.5, .3, r)); }`,
    });
    this.mat = m;
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 3;
    scene.add(this.points);
    this.cursor = 0;
  }
  spawn(x, y, z, vx, vy, vz, color, size = 0.07, life = 1.2) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.c.set([color.r, color.g, color.b], i * 3); this.s[i] = size; this.life[i] = life; this.age[i] = 0;
  }
  puff(x, y, z, n, color, spread = 1, up = 2) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = Math.random() * spread;
      this.spawn(x + Math.cos(a) * 0.1, y + 0.05, z + Math.sin(a) * 0.1, Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s, color, 0.05 + Math.random() * 0.06, 0.6 + Math.random() * 0.8);
    }
  }
  update(dt, sim) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.a[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; this.a[i] = 0; continue; }
      const o = i * 3;
      this.v[o + 1] -= 9.8 * dt * 0.9;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      const g = sim.inside(this.p[o], this.p[o + 2]) ? sim.heightAt(this.p[o], this.p[o + 2]) : -9;
      if (this.p[o + 1] < g) { this.p[o + 1] = g; this.v[o] *= 0.3; this.v[o + 1] = 0; this.v[o + 2] *= 0.3; }
      this.a[i] = 1 - t * t;
    }
    for (const k of ['position', 'alpha', 'color', 'size']) this.geo.attributes[k].needsUpdate = true;
  }
}

// ---------------- bucket towers ----------------
function towerGeometry() {
  const prof = [[0, 0], [1, 0], [1, 0.05], [0.97, 0.09], [0.96, 0.31], [0.99, 0.34], [0.95, 0.38], [0.935, 0.62], [0.96, 0.65], [0.92, 0.69], [0.895, 0.9], [0.915, 0.92], [0.915, 1], [0.7, 1], [0.7, 0.95], [0, 0.95]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 30);
  const parts = [lathe.toNonIndexed()];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const b = new THREE.BoxGeometry(0.34, 0.2, 0.22).toNonIndexed();
    b.translate(0, 1.1, 0.8); b.rotateY(i / n * Math.PI * 2);
    parts.push(b);
  }
  // window slit
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
  g.computeVertexNormals();
  return g;
}
function bucketGeometry() {
  const prof = [[0.001, 0], [0.9, 0], [1.08, 1.0], [1.12, 1.02], [1.12, 1.07], [1.04, 1.07], [0.85, 0.07], [0.001, 0.07]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  const handle = new THREE.TorusGeometry(1.1, 0.035, 6, 20, Math.PI); handle.rotateZ(Math.PI); handle.translate(0, 1.0, 0);
  return mergeGeometries([g.toNonIndexed(), handle.toNonIndexed()].map((p) => { p.deleteAttribute('uv'); return p; }));
}

export class Towers {
  constructor(scene, sim, parts) {
    this.scene = scene; this.sim = sim; this.parts = parts; this.list = [];
    this.geo = towerGeometry(); this.bucketGeo = bucketGeometry();
    this.grain = grainTexture();
    this.bucketMat = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.4 });
    this.clock = 0;
  }
  // r: base radius. returns tower
  add(x, z, r) {
    const sim = this.sim;
    let base = sim.heightAt(x, z);
    // stacking: clicked on the top of an existing tower → snap to its centre and shrink
    const host = this.list.find((t) => t.state !== 'crumble' && Math.hypot(t.x - x, t.z - z) < t.r * 0.85 && Math.abs(base - t.top) < 0.25);
    if (host) { x = host.x; z = host.z; base = host.top; r = Math.min(r, host.r * 0.68); }
    const hgt = r * 1.25;
    const mat = new THREE.MeshStandardMaterial({ color: SAND_WET.clone(), roughness: 0.95, map: this.grain, bumpMap: this.grain, bumpScale: 2 });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, base - 0.02, z); mesh.scale.set(r, hgt, r); mesh.rotation.y = Math.random() * 6;
    mesh.visible = false;
    const bucket = new THREE.Mesh(this.bucketGeo, this.bucketMat.clone());
    bucket.material.transparent = true; bucket.castShadow = true;
    bucket.scale.set(r, hgt, r); bucket.rotation.x = Math.PI;      // upside-down
    this.scene.add(mesh, bucket);
    const t = { x, z, r, hgt, base, top: base + hgt, mesh, bucket, state: 'pour', t: 0, wet: 1, low: 0, host };
    this.list.push(t);
    return t;
  }
  update(dt) {
    const sim = this.sim;
    this.clock += dt;
    const check = this.clock > 0.2; if (check) this.clock = 0;
    for (const T of this.list) {
      T.t += dt;
      if (T.state === 'pour') {
        const k = T.t;
        const yTop = T.base + T.hgt * 1.07;
        if (k < 0.35) { T.bucket.position.set(T.x, yTop + 3 * (1 - ease(k / 0.35)), T.z); T.bucket.scale.y = T.hgt; }
        else if (k < 0.62) { const s = Math.sin((k - 0.35) / 0.27 * Math.PI * 3) * 0.04; T.bucket.position.set(T.x, yTop, T.z); T.bucket.scale.set(T.r * (1 + s), T.hgt * (1 - s), T.r * (1 + s)); }
        else {
          if (!T.mesh.visible) {
            T.mesh.visible = true;
            sim.column(T.x, T.z, T.r * 0.62, T.top - 0.03);
            this.parts.puff(T.x, T.base, T.z, 40, SAND_WET, 1.6, 1.2);
          }
          const u = (k - 0.62) / 0.6;
          T.bucket.position.set(T.x + u * 0.6, yTop + ease(u) * 2.5, T.z);
          T.bucket.material.opacity = 1 - ease(u);
          const w = Math.sin(u * 9) * Math.exp(-u * 4) * 0.05;
          T.mesh.scale.set(T.r * (1 + w), T.hgt * (1 - w), T.r * (1 + w));
          if (u >= 1) { this.scene.remove(T.bucket); T.bucket.material.dispose(); T.bucket = null; T.state = 'stand'; T.mesh.scale.set(T.r, T.hgt, T.r); }
        }
        continue;
      }
      if (T.state === 'stand') {
        // drying / re-wetting
        const d = sim.depthAt(T.x + T.r * 1.1, T.z) + sim.depthAt(T.x - T.r * 1.1, T.z) + sim.depthAt(T.x, T.z + T.r * 1.1) + sim.depthAt(T.x, T.z - T.r * 1.1);
        if (d > 0.02) T.wet = 1; else T.wet = Math.max(0, T.wet - dt / 45);
        T.mesh.material.color.copy(SAND_DRY).lerp(SAND_WET, T.wet);
        if (d > 0.08 && Math.random() < d * dt * 12) {
          const a = Math.random() * 6.28;
          this.parts.spawn(T.x + Math.cos(a) * T.r, T.base + 0.05, T.z + Math.sin(a) * T.r, Math.cos(a) * 1.2, 1.5 + Math.random() * 2, Math.sin(a) * 1.2, new THREE.Color(1, 1, 1), 0.09, 0.7);
        }
        // waves lapping at the base soften it; enough soaking and the tower gives way
        let soak = 0;
        for (let a = 0; a < 4; a++) {
          const px = T.x + Math.cos(a * 1.571) * T.r * 1.05, pz = T.z + Math.sin(a * 1.571) * T.r * 1.05;
          const dd = sim.depthAt(px, pz);
          if (dd > 0.01) { const vx = sim.sample(sim.vx, px, pz), vz = sim.sample(sim.vz, px, pz); soak += (0.03 + 0.7 * (vx * vx + vz * vz)) * Math.min(1, dd * 6); }
        }
        T.soak = (T.soak || 0) + soak * 0.8 * dt;
        const limit = 2 * T.r / 0.8, sag = Math.min(1, T.soak / limit);
        T.mesh.scale.y = T.hgt * (1 - 0.07 * sag * sag);
        if (check) {
          const hc = sim.heightAt(T.x, T.z);
          if (T.soak > limit || hc < T.top - T.hgt * 0.4 || (T.host && T.host.state !== 'stand' && T.host.state !== 'pour')) this.crumble(T);
        }
        continue;
      }
      if (T.state === 'crumble') {
        const u = T.t / 1.3;
        T.mesh.scale.set(T.r * (1 + 0.45 * ease(u)), T.hgt * (1 - 0.8 * ease(u)), T.r * (1 + 0.45 * ease(u)));
        T.mesh.position.y = T.base - 0.02 - ease(u) * 0.1;
        T.mesh.rotation.z = Math.sin(T.t * 20) * 0.03 * (1 - u);
        if (Math.random() < 0.6) this.parts.puff(T.x + (Math.random() - 0.5) * T.r, T.base + T.hgt * (1 - u), T.z + (Math.random() - 0.5) * T.r, 2, SAND_WET, 1.2, 0.6);
        if (u >= 1) { this.scene.remove(T.mesh); T.mesh.material.dispose(); T.state = 'gone'; }
      }
    }
    this.list = this.list.filter((T) => T.state !== 'gone' || T.t < 3);
  }
  crumble(T) {
    T.state = 'crumble'; T.t = 0;
    // the packed column becomes loose sand: lower it to a mound and let it slump
    this.sim.each(T.x, T.z, T.r * 0.75, (k) => { this.sim.h[k] = Math.min(this.sim.h[k], T.base + T.hgt * 0.45); });
    this.sim.loosen(T.x, T.z, T.r * 1.1, 0.12);
    this.parts.puff(T.x, T.base + T.hgt * 0.5, T.z, 50, SAND_WET, 2, 1);
    for (const o of this.list) if (o.host === T && o.state === 'stand') setTimeout(() => o.state === 'stand' && this.crumble(o), 150);
  }
  clear() { for (const T of this.list) { this.scene.remove(T.mesh); if (T.bucket) this.scene.remove(T.bucket); } this.list = []; }
}

// ---------------- decorations ----------------
function starGeometry(r1 = 0.2, r2 = 0.08) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? r2 : r1; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); return g;
}
function shellGeometry() {
  const g = new THREE.SphereGeometry(0.16, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let v = 0; v < p.count; v++) {
    const x = p.getX(v), z = p.getZ(v), a = Math.atan2(z, x);
    const ridge = 1 + 0.08 * Math.cos(a * 12);
    p.setXYZ(v, x * ridge, p.getY(v) * 0.55, z * ridge * 0.9 + 0.04 * (p.getY(v) / 0.16));
  }
  g.computeVertexNormals(); return g;
}
function flagGroup(mat, clothMat) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.75, 6), mat); pole.position.y = 0.37; g.add(pole);
  const cg = new THREE.PlaneGeometry(0.42, 0.26, 10, 2); cg.translate(0.21, 0, 0);
  const cloth = new THREE.Mesh(cg, clothMat); cloth.position.y = 0.6; g.add(cloth);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

export class Decor {
  constructor(scene, sim, U) {
    this.scene = scene; this.sim = sim; this.items = [];
    const M = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    this.poleMat = M('#f6efe0');
    this.clothMat = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.6, side: THREE.DoubleSide });
    this.clothMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = U.uTime;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
float ph = modelMatrix[3].x * 2.7 + modelMatrix[3].z * 1.3;
float amt = transformed.x / 0.42;
transformed.z += sin(transformed.x * 14.0 - uTime * 9.0 + ph) * 0.045 * amt;
transformed.y += sin(transformed.x * 9.0 - uTime * 6.0 + ph) * 0.015 * amt - amt * amt * 0.03;`);
    };
    this.geos = {
      shell: shellGeometry(), star: starGeometry(), pebble: new THREE.DodecahedronGeometry(0.12, 1),
      wood: (() => { const g = new THREE.CylinderGeometry(0.05, 0.07, 1.3, 6, 3); g.rotateZ(Math.PI / 2); const p = g.attributes.position; for (let v = 0; v < p.count; v++) p.setY(v, p.getY(v) + Math.sin(p.getX(v) * 2.5) * 0.05); g.computeVertexNormals(); return g; })(),
      weed: (() => { const parts = []; for (let i = 0; i < 6; i++) { const c = new THREE.ConeGeometry(0.04, 0.5, 4); c.translate(0, 0.2, 0); c.rotateZ((i - 2.5) * 0.25); c.rotateY(i); parts.push(c.toNonIndexed()); } return mergeGeometries(parts); })(),
      coin: new THREE.CylinderGeometry(0.12, 0.12, 0.03, 18),
      bottle: (() => { const prof = [[0.001, 0], [0.1, 0], [0.11, 0.05], [0.11, 0.28], [0.05, 0.36], [0.04, 0.44], [0.05, 0.46], [0.001, 0.46]]; const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12); g.rotateZ(Math.PI / 2); g.translate(0.23, 0.1, 0); return g; })(),
      pearl: new THREE.SphereGeometry(0.08, 14, 10),
    };
    this.mats = {
      shell: ['#f7c6c7', '#fbe3d0', '#f2a7b5', '#fff4ea'].map((c) => M(c, 0.5)),
      star: ['#f08a4b', '#e85d5d', '#f3b04a', '#b46ad6'].map((c) => M(c, 0.8)),
      pebble: ['#9aa0a6', '#b8b0a2', '#6f7b85', '#d8d2c6'].map((c) => M(c, 0.6)),
      wood: ['#a4886a', '#8f7a63', '#b9a184'].map((c) => M(c, 0.9)),
      weed: ['#3f8a4a', '#5aa04f', '#2f6f44'].map((c) => M(c, 0.8)),
      coin: [new THREE.MeshStandardMaterial({ color: '#f2c24b', metalness: 0.9, roughness: 0.3 })],
      bottle: [new THREE.MeshStandardMaterial({ color: '#6fcf97', roughness: 0.1, transparent: true, opacity: 0.75 })],
      pearl: [new THREE.MeshStandardMaterial({ color: '#fff6f2', roughness: 0.15, metalness: 0.2 })],
    };
  }
  make(kind) {
    if (kind === 'flag') return flagGroup(this.poleMat, this.clothMat);
    const mats = this.mats[kind];
    const m = new THREE.Mesh(this.geos[kind], mats[(Math.random() * mats.length) | 0]);
    m.castShadow = true; return m;
  }
  add(kind, x, z, opts = {}) {
    const obj = this.make(kind);
    obj.rotation.y = kind === 'flag' ? Math.PI : Math.random() * 6.28;   // flags stream inland (wind off the sea)
    if (kind === 'pebble') obj.scale.set(1.2, 0.6, 1);
    const it = { obj, kind, x, z, born: 0, yOff: kind === 'coin' ? 0.02 : kind === 'pearl' ? 0.07 : 0.0, float: kind === 'wood' || kind === 'weed' || kind === 'bottle', spin: opts.spin || 0, hop: opts.hop || 0 };
    obj.position.set(x, this.sim.heightAt(x, z), z);
    this.scene.add(obj); this.items.push(it);
    if (this.items.length > 400) { const old = this.items.shift(); this.scene.remove(old.obj); }
    return it;
  }
  update(dt) {
    const sim = this.sim;
    for (const it of this.items) {
      it.born += dt;
      const s = it.born < 0.4 ? 1 + Math.sin(it.born / 0.4 * Math.PI) * 0.35 - (1 - it.born / 0.4) * 0.6 : 1;
      it.obj.scale.setScalar(Math.max(0.01, s));
      if (it.kind === 'pebble') it.obj.scale.y *= 0.6;
      if (it.float && sim.inside(it.x, it.z, 0.5)) {
        const k = sim.idx(it.x, it.z);
        if (sim.d[k] > 0.05) { it.x += sim.vx[k] * dt * 0.6; it.z += sim.vz[k] * dt * 0.6; }
      }
      let y = sim.heightAt(it.x, it.z) + it.yOff;
      if (it.float) y = Math.max(y, y + sim.depthAt(it.x, it.z) - 0.04);
      if (it.hop > 0) { it.hop = Math.max(0, it.hop - dt); y += Math.sin((1 - it.hop / 1.2) * Math.PI) * 0.9; it.obj.rotation.y += dt * 8; }
      it.obj.position.set(it.x, y, it.z);
    }
  }
  clear() { for (const it of this.items) this.scene.remove(it.obj); this.items = []; }
}

// ---------------- crabs ----------------
export class Crabs {
  constructor(scene, sim, count = 4) {
    this.sim = sim; this.list = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#e5673a', roughness: 0.6 });
    const eye = new THREE.MeshStandardMaterial({ color: '#222' });
    for (let c = 0; c < count; c++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 6), mat); body.scale.set(1, 0.45, 0.75); body.position.y = 0.09; g.add(body);
      const claws = [];
      for (const s of [-1, 1]) {
        const arm = new THREE.Group(); arm.position.set(s * 0.13, 0.08, 0.11);
        const claw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 5), mat); claw.scale.set(1, 0.7, 1.3); claw.position.set(s * 0.05, 0.03, 0.06); arm.add(claw);
        g.add(arm); claws.push(arm);
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), eye); e.position.set(s * 0.05, 0.17, 0.09); g.add(e);
      }
      const legs = [];
      for (const s of [-1, 1]) for (let l = 0; l < 3; l++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mat);
        leg.geometry.translate(0.08 * s, 0, 0);
        leg.position.set(s * 0.12, 0.07, -0.05 + l * 0.06); leg.rotation.z = -s * 0.5; g.add(leg); legs.push({ leg, s, l });
      }
      g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      scene.add(g);
      this.list.push({ g, claws, legs, x: -2 + c * 2, z: -10 + c * 6, tx: 0, tz: 0, wait: Math.random() * 2, hide: 0, ph: Math.random() * 6 });
    }
    for (const c of this.list) this.pick(c);
  }
  pick(c) {
    const sim = this.sim;
    for (let t = 0; t < 30; t++) {
      const x = c.x + (Math.random() - 0.5) * 8, z = c.z + (Math.random() - 0.5) * 8;
      if (!sim.inside(x, z, 2)) continue;
      const h = sim.heightAt(x, z);
      if (h > sim.tide - 0.02 && h < sim.tide + 0.9 && sim.depthAt(x, z) < 0.02) { c.tx = x; c.tz = z; return; }
    }
    // drift towards the waterline if lost
    c.tx = c.x + 2; c.tz = c.z;
  }
  update(dt, t, cursor) {
    const sim = this.sim;
    for (const c of this.list) {
      const dep = sim.depthAt(c.x, c.z);
      if (dep > 0.06) c.hide = Math.min(1, c.hide + dt * 3); else c.hide = Math.max(0, c.hide - dt * 0.8);
      let speed = 0;
      if (c.wait > 0) c.wait -= dt;
      else {
        let dx = c.tx - c.x, dz = c.tz - c.z;
        let sp = 0.9;
        if (cursor && Math.hypot(cursor.x - c.x, cursor.z - c.z) < 2.2) { dx = c.x - cursor.x; dz = c.z - cursor.z; sp = 2.6; }
        const d = Math.hypot(dx, dz);
        if (d < 0.1) { c.wait = 0.5 + Math.random() * 3; this.pick(c); }
        else {
          const nx = c.x + dx / d * sp * dt, nz = c.z + dz / d * sp * dt;
          if (sim.inside(nx, nz, 1.5)) { c.x = nx; c.z = nz; } else this.pick(c);
          speed = sp;
          c.g.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;     // crabs walk sideways
        }
      }
      const y = sim.heightAt(c.x, c.z) - c.hide * 0.22;
      c.g.position.set(c.x, y, c.z);
      c.g.scale.setScalar(1 - c.hide * 0.3);
      for (const L of c.legs) L.leg.rotation.z = -L.s * (0.5 + Math.sin(t * 22 + L.l * 2 + (L.s > 0 ? 0 : 1.5)) * 0.35 * Math.min(1, speed));
      c.claws.forEach((a, i) => { a.rotation.x = Math.sin(t * 3 + c.ph + i) * 0.25; a.rotation.y = (i ? -1 : 1) * (0.2 + Math.sin(t * 5 + c.ph) * 0.15); });
    }
  }
}

// ---------------- buried treasures ----------------
const TREASURES = [['star', '海星'], ['shell', '粉紅海螺'], ['bottle', '漂流瓶'], ['coin', '古金幣'], ['pearl', '珍珠']];
export class Treasures {
  constructor(sim, decor, parts, onFind) {
    this.sim = sim; this.decor = decor; this.parts = parts; this.onFind = onFind; this.reset();
  }
  reset() {
    this.list = [];
    for (let t = 0; t < 500 && this.list.length < 14; t++) {
      const x = (Math.random() - 0.5) * 50, z = (Math.random() - 0.5) * 50, s = shoreS(x, z);
      if (s < -15 || s > 7) continue;
      const [kind, name] = TREASURES[(Math.random() * TREASURES.length) | 0];
      this.list.push({ x, z, h0: this.sim.heightAt(x, z), kind, name, found: false });
    }
    this.twinkle = 2;
  }
  update(dt) {
    this.twinkle -= dt;
    const live = this.list.filter((t) => !t.found);
    if (this.twinkle < 0 && live.length) {
      this.twinkle = 2.5 + Math.random() * 3;
      const t = live[(Math.random() * live.length) | 0];
      for (let i = 0; i < 6; i++) this.parts.spawn(t.x + (Math.random() - 0.5) * 0.3, this.sim.heightAt(t.x, t.z) + 0.05, t.z + (Math.random() - 0.5) * 0.3, 0, 0.6 + Math.random(), 0, new THREE.Color(1.6, 1.5, 0.9), 0.06, 0.9);
    }
    for (const t of live) {
      if (this.sim.heightAt(t.x, t.z) < t.h0 - 0.2) {
        t.found = true;
        this.decor.add(t.kind, t.x, t.z, { hop: 1.2 });
        for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28; this.parts.spawn(t.x, this.sim.heightAt(t.x, t.z) + 0.3, t.z, Math.cos(a) * 1.5, 2 + Math.random(), Math.sin(a) * 1.5, new THREE.Color(1.8, 1.6, 0.8), 0.08, 1); }
        this.onFind(t);
      }
    }
  }
}

// ---------------- tool cursor ----------------
export class Cursor {
  constructor(scene, sim, towers, decor) {
    this.sim = sim; this.scene = scene;
    const M = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.4 });
    const handleM = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.5 });
    // shovel
    const shovel = new THREE.Group();
    const bs = new THREE.Shape(); bs.moveTo(-0.15, 0); bs.lineTo(0.15, 0); bs.lineTo(0.16, 0.26); bs.quadraticCurveTo(0, 0.44, -0.16, 0.26); bs.lineTo(-0.15, 0);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bs, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }), M);
    blade.rotation.x = Math.PI; blade.position.y = 0.0;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8), M); handle.position.y = 0.42;
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 14), handleM); grip.position.y = 0.92;
    shovel.add(blade, handle, grip);
    // rake
    const rake = new THREE.Group();
    const rh = handle.clone(); rake.add(rh); rake.add(grip.clone());
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), M); rake.add(bar);
    for (let i = 0; i < 7; i++) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.025), M); tooth.position.set(-0.22 + i * 0.073, -0.07, 0); rake.add(tooth); }
    // bucket ghost
    const bucket = new THREE.Mesh(towers.bucketGeo, new THREE.MeshStandardMaterial({ color: RED, roughness: 0.4, transparent: true, opacity: 0.55 }));
    bucket.rotation.x = Math.PI;
    this.models = { shovel, rake, bucket };
    for (const m of Object.values(this.models)) { m.traverse((o) => { if (o.isMesh) o.castShadow = true; }); m.visible = false; scene.add(m); }
    this.ghost = null; this.decor = decor;
    // brush ring
    const ringGeo = new THREE.BufferGeometry(); ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
    this.ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false }));
    this.ring.renderOrder = 5; this.ring.frustumCulled = false;
    scene.add(this.ring);
    this.ghostKind = null;
  }
  setGhost(kind) {
    if (this.ghostKind === kind) return;
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghostKind = kind; this.ghost = null;
    if (kind) { this.ghost = this.decor.make(kind); this.ghost.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.6; } }); this.scene.add(this.ghost); }
  }
  update(t, hit, tool, r, active, decorKind) {
    const show = !!hit;
    this.ring.visible = show && tool !== 'decor';
    for (const m of Object.values(this.models)) m.visible = false;
    this.setGhost(show && tool === 'decor' ? decorKind : null);
    if (!show) return;
    const sim = this.sim;
    const rr = tool === 'tower' ? 0.55 + r * 0.22 : tool === 'wall' ? r * 0.45 : r;
    const p = this.ring.geometry.attributes.position;
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2, x = hit.x + Math.cos(a) * rr, z = hit.z + Math.sin(a) * rr;
      p.setXYZ(i, x, sim.heightAt(x, z) + 0.04, z);
    }
    p.needsUpdate = true;
    const y = sim.heightAt(hit.x, hit.z);
    if (tool === 'tower') {
      const b = this.models.bucket; b.visible = true;
      const s = 0.55 + r * 0.22;
      b.scale.set(s, s * 1.25, s); b.position.set(hit.x, y + s * 1.25 * 1.07 + 0.9 + Math.sin(t * 3) * 0.08, hit.z);
    } else if (tool === 'decor') {
      if (this.ghost) { this.ghost.position.set(hit.x, y + 0.05 + Math.abs(Math.sin(t * 4)) * 0.12, hit.z); this.ghost.rotation.y = tool === 'decor' && decorKind === 'flag' ? Math.PI : t; }
    } else {
      const m = tool === 'smooth' ? this.models.rake : this.models.shovel; m.visible = true;
      let lift = 0.35, tilt = -0.6, roll = 0.35;
      if (active) {
        if (tool === 'dig') { const c = (t * 3.2) % 1; lift = 0.05 + (c < 0.5 ? c : 1 - c) * 0.8; tilt = -0.9 + Math.sin(c * Math.PI * 2) * 0.5; }
        else if (tool === 'raise' || tool === 'wall') { lift = 0.08 + Math.abs(Math.sin(t * 9)) * 0.3; tilt = -1.25; }
        else { lift = 0.05; roll = 0.35 + Math.sin(t * 10) * 0.25; tilt = -0.25; }
      } else lift += Math.sin(t * 2.5) * 0.06;
      m.position.set(hit.x + 0.25, y + lift, hit.z + 0.25);
      m.rotation.set(tilt, 0.6, roll);
    }
  }
}
