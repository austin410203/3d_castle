// Sand + shallow-water simulation on a square heightfield.
// Water: virtual-pipe shallow water (forced at the domain edge by tide + incoming swell).
// Sand: packing-dependent slumping (talus), flow erosion with carried sediment, wetness that dries.
import * as THREE from 'three';

export const N = 256;            // cells per side
export const SIZE = 56;          // metres
export const L = SIZE / N;       // cell size
export const HALF = SIZE / 2;
const G = 9.81;

const sat = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { v = sat(v); return v * v * (3 - 2 * v); };

// ---------- the untouched beach ----------
export function shoreS(x, z) {
  return x + 3.2 * Math.sin(z * 0.09 + 0.6) + 1.6 * Math.sin(z * 0.21 + 2.0);
}
export function baseHeight(x, z) {
  const s = shoreS(x, z);
  let h;
  if (s < -16) h = 1.25 + 1.25 * smooth((-16 - s) / 12) + 0.18 * Math.sin(s * 0.5 + z * 0.37) * smooth((-16 - s) / 5);
  else {
    const beach = 1.25 - (s + 16) * 0.068;
    const shallow = -0.25 - (s - 6) * 0.022;
    const k = 0.35, hh = sat(0.5 + 0.5 * (beach - shallow) / k);   // smooth max
    h = shallow + (beach - shallow) * hh + k * hh * (1 - hh) * 0.5;
  }
  // sandbar with a tidal channel, lagoon behind it
  const bar = 0.44 * Math.exp(-(((s - 12) / 2.6) ** 2)) * (0.7 + 0.3 * Math.sin(z * 0.13 + 1)) * (1 - 0.9 * Math.exp(-(((z - 7) / 3.2) ** 2)));
  h += bar;
  // reef break and drop-off (outside the sim domain)
  h += 0.62 * Math.exp(-(((s - 42) / 3.2) ** 2));
  h -= 3.6 * smooth((s - 47) / 16);
  // gentle ripples
  h += 0.035 * Math.sin(x * 0.71 + z * 0.43) * Math.sin(z * 0.93 - x * 0.31);
  return h;
}

// ---------- incoming swell (shared with the ocean shader) ----------
export const WAVE = { T: 7.5, c: 3.0, A: 0.2, edge: HALF, bigT: -999, bigA: 0.75 };
export function swell(x, t) {
  const te = t - (WAVE.edge - x) / WAVE.c;            // time this crest left the domain edge
  const ph = te / WAVE.T;
  const p = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
  const shape = p * p * p * p - 0.273;
  const big = WAVE.bigA * Math.exp(-(((te - WAVE.bigT) / 1.6) ** 2));
  return WAVE.A * shape + big;
}

export class Sim {
  constructor() {
    const n = N * N;
    this.h = new Float32Array(n);
    this.h0 = new Float32Array(n);
    this.d = new Float32Array(n);
    this.fL = new Float32Array(n); this.fR = new Float32Array(n);
    this.fT = new Float32Array(n); this.fB = new Float32Array(n);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.pack = new Float32Array(n);
    this.sed = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.foam = new Float32Array(n);
    this.tide = 0;
    this.time = 0;
    this.fieldData = new Float32Array(n * 4);
    this.tex = new THREE.DataTexture(this.fieldData, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.reset();
  }

  cx(i) { return -HALF + (i + 0.5) * L; }

  reset() {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = this.cx(i), z = this.cx(j);
      const h = baseHeight(x, z);
      this.h[k] = this.h0[k] = h;
      this.d[k] = Math.max(0, this.tide - h);
      this.wet[k] = h < this.tide + 0.25 ? 1 : 0;
    }
    this.fL.fill(0); this.fR.fill(0); this.fT.fill(0); this.fB.fill(0);
    this.vx.fill(0); this.vz.fill(0); this.pack.fill(0); this.sed.fill(0); this.foam.fill(0);
    this.upload();
  }

  // ---------- queries ----------
  sample(arr, x, z) {
    let fx = (x + HALF) / L - 0.5, fz = (z + HALF) / L - 0.5;
    fx = Math.min(N - 1.001, Math.max(0, fx)); fz = Math.min(N - 1.001, Math.max(0, fz));
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * N + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + N] * (1 - u) + arr[k + N + 1] * u) * v;
  }
  idx(x, z) {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / L))), j = Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / L)));
    return j * N + i;
  }
  heightAt(x, z) { return this.sample(this.h, x, z); }
  depthAt(x, z) { return this.sample(this.d, x, z); }
  inside(x, z, m = 0) { return Math.abs(x) < HALF - m && Math.abs(z) < HALF - m; }

  // ray vs heightfield (world-space ray), returns THREE.Vector3 or null
  raycast(ray) {
    const p = new THREE.Vector3();
    let prev = null;
    for (let t = 0; t < 400; t += 0.12) {
      ray.at(t, p);
      if (!this.inside(p.x, p.z)) { if (prev && prev.inside) break; prev = { t, inside: false }; continue; }
      const h = this.heightAt(p.x, p.z);
      if (p.y <= h) {
        let a = prev ? prev.t : t - 0.12, b = t;
        for (let s = 0; s < 10; s++) { const m = (a + b) / 2; ray.at(m, p); if (p.y <= this.heightAt(p.x, p.z)) b = m; else a = m; }
        ray.at(b, p); p.y = this.heightAt(p.x, p.z);
        return p;
      }
      prev = { t, inside: true };
    }
    return null;
  }

  // ---------- brushes ----------
  // visit cells in a disc; fn(k, w, x, z, dist)
  each(x, z, r, fn) {
    const i0 = Math.max(1, Math.floor((x - r + HALF) / L)), i1 = Math.min(N - 2, Math.ceil((x + r + HALF) / L));
    const j0 = Math.max(1, Math.floor((z - r + HALF) / L)), j1 = Math.min(N - 2, Math.ceil((z + r + HALF) / L));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = this.cx(i), cz = this.cx(j), dist = Math.hypot(cx - x, cz - z);
      if (dist > r) continue;
      const q = dist / r;
      fn(j * N + i, Math.exp(-q * q * 3.2) * (1 - q * q), cx, cz, dist);
    }
  }
  raise(x, z, r, amt) {
    this.each(x, z, r, (k, w) => {
      this.h[k] += amt * w;
      this.pack[k] = Math.max(this.pack[k], 1.15 * w + this.pack[k] * (1 - w));
      this.wet[k] = Math.max(this.wet[k], 0.9);
      this.d[k] *= 1 - w;
    });
  }
  dig(x, z, r, amt) {
    let removed = 0;
    this.each(x, z, r, (k, w) => {
      const a = amt * w; this.h[k] -= a; removed += a;
      this.wet[k] = Math.max(this.wet[k], 0.75);
    });
    // banks of a fresh trench are pressed firm
    this.each(x, z, r * 1.6, (k, w, cx, cz, dist) => { if (dist > r * 0.8) this.pack[k] = Math.max(this.pack[k], 0.75); });
    return removed;
  }
  smoothAt(x, z, r, amt) {
    this.each(x, z, r, (k, w) => {
      const avg = (this.h[k - 1] + this.h[k + 1] + this.h[k - N] + this.h[k + N]) * 0.25;
      this.h[k] += (avg - this.h[k]) * Math.min(1, amt * w);
      this.pack[k] = Math.max(this.pack[k], 0.6 * w);
    });
  }
  // flat-topped packed ridge, top at absolute height `top`
  wall(x, z, r, top) {
    this.each(x, z, r * 1.9, (k, w, cx, cz, dist) => {
      const prof = dist < r * 0.55 ? 1 : 1 - smooth((dist - r * 0.55) / (r * 1.35));
      const target = this.h0[k] + (top - this.h0[k]) * prof;
      if (target > this.h[k]) { this.h[k] += (target - this.h[k]) * 0.35; this.d[k] = 0; }
      if (prof > 0.05) { this.pack[k] = Math.max(this.pack[k], 1.6 * prof); this.wet[k] = Math.max(this.wet[k], 0.95); }
    });
  }
  // solid column for a bucket tower (top flat, nearly vertical sides)
  column(x, z, r, top, pack = 3.2) {
    this.each(x, z, r, (k) => {
      if (top > this.h[k]) this.h[k] = top;
      this.pack[k] = pack; this.d[k] = 0; this.wet[k] = 1;
    });
  }
  loosen(x, z, r, p = 0.15) { this.each(x, z, r, (k) => { this.pack[k] = Math.min(this.pack[k], p); }); }

  // ---------- step ----------
  step(dt, t) {
    this.time = t;
    const { h, d, fL, fR, fT, fB } = this;
    const n = N;
    const damp = 1 - 1.2 * dt, dampShallow = 1 - 5.5 * dt;
    const kf = dt * G * L, area = L * L;

    // forced boundary: tide + swell
    for (let i = 0; i < n; i++) {
      for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
        const x = this.cx(k % n);
        const s = this.tide + swell(x, t);
        d[k] = Math.max(0, s - h[k]);
      }
    }

    // outflow fluxes
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, H = h[k] + d[k];
      if (d[k] <= 0) { fL[k] = fR[k] = fT[k] = fB[k] = 0; continue; }
      const dm = d[k] < 0.05 ? dampShallow : damp;
      let l = i > 0 ? Math.max(0, fL[k] * dm + kf * (H - h[k - 1] - d[k - 1])) : 0;
      let r = i < n - 1 ? Math.max(0, fR[k] * dm + kf * (H - h[k + 1] - d[k + 1])) : 0;
      let tt = j > 0 ? Math.max(0, fT[k] * dm + kf * (H - h[k - n] - d[k - n])) : 0;
      let b = j < n - 1 ? Math.max(0, fB[k] * dm + kf * (H - h[k + n] - d[k + n])) : 0;
      const sum = (l + r + tt + b) * dt;
      if (sum > 0) { const K = Math.min(1, d[k] * area / sum); l *= K; r *= K; tt *= K; b *= K; }
      fL[k] = l; fR[k] = r; fT[k] = tt; fB[k] = b;
    }
    // volume update + velocity (boundary cells are re-forced next step)
    const wt = this.tide - 0.03;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      const inn = fR[k - 1] + fL[k + 1] + fB[k - n] + fT[k + n];
      const out = fL[k] + fR[k] + fT[k] + fB[k];
      const d0 = d[k];
      let nd = d0 + dt * (inn - out) / area;
      // ground water seeps into holes dug below the water table; perched water soaks away
      if (h[k] < wt && h[k] + nd < wt) nd += (wt - h[k] - nd) * 0.25 * dt;
      else if (nd > 0 && h[k] > wt) nd = Math.max(0, nd - 0.006 * dt);
      d[k] = nd;
      if (nd - d0 > 0.22 * dt && nd < 0.7) this.foam[k] = Math.min(1, this.foam[k] + (nd - d0) / dt * 0.8);   // bore front
      const dav = Math.max(0.03, (d0 + nd) * 0.5);
      let vx = ((fR[k - 1] - fL[k]) + (fR[k] - fL[k + 1])) * 0.5 / (L * dav);
      let vz = ((fB[k - n] - fT[k]) + (fB[k] - fT[k + n])) * 0.5 / (L * dav);
      const sp = Math.hypot(vx, vz);
      if (sp > 4) { vx *= 4 / sp; vz *= 4 / sp; }
      this.vx[k] = nd > 0.004 ? vx : 0; this.vz[k] = nd > 0.004 ? vz : 0;
    }

    this.erode(dt);
    this.slump(dt);

    // wetness, packing loss under water, foam
    const { wet, pack, foam, vx, vz } = this;
    for (let k = 0; k < n * n; k++) {
      const dk = d[k];
      if (dk > 0.004) wet[k] = 1; else wet[k] = Math.max(h[k] < this.tide + 0.12 ? 0.85 : 0, wet[k] - dt / 50);
      const sp = Math.hypot(vx[k], vz[k]);
      if (dk > 0.015 && pack[k] > 0) pack[k] = Math.max(0, pack[k] - dt * (0.035 + 0.35 * sp * sp) * Math.min(1, dk * 6));
      const f = dk > 0.002 && dk < 0.6 ? Math.min(1, sp * 0.55 - 0.15) : 0;
      foam[k] = Math.max(f, foam[k] - dt * 0.9);
    }
  }

  erode(dt) {
    const { h, h0, d, vx, vz, sed, tmp, pack } = this, n = N;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (d[k] < 0.004) { if (sed[k] > 0) { h[k] += sed[k]; sed[k] = 0; } continue; }
      const sp = Math.hypot(vx[k], vz[k]);
      const built = h[k] > h0[k] + 0.02 ? 1 : 0.12;
      const cap = 0.05 * sp * Math.min(d[k], 0.35) * built * (1 - 0.7 * Math.min(1, pack[k] / 2));
      if (sed[k] < cap) { const e = Math.min(0.03, 1.6 * (cap - sed[k]) * dt); h[k] -= e; sed[k] += e; }
      else { const dep = 1.2 * (sed[k] - cap) * dt; h[k] += dep; sed[k] -= dep; }
    }
    // carry sediment downstream (semi-Lagrangian)
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (d[k] < 0.004) { tmp[k] = sed[k]; continue; }
      const x = this.cx(i) - vx[k] * dt, z = this.cx(j) - vz[k] * dt;
      tmp[k] = this.sample(sed, x, z);
    }
    sed.set(tmp);
  }

  slump(dt) {
    const { h, pack, tmp } = this, n = N;
    tmp.fill(0);
    const rate = Math.min(0.5, 14 * dt);
    const tal = (k) => (0.62 + 2.75 * Math.min(pack[k], 3.2)) * L;
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      for (const o of [1, n]) {
        const m = k + o, diff = h[k] - h[m];
        const hi = diff > 0 ? k : m, lo = diff > 0 ? m : k;
        const ex = Math.abs(diff) - tal(hi);
        if (ex > 0) { const mv = ex * rate * 0.25; tmp[hi] -= mv; tmp[lo] += mv; }
      }
    }
    for (let k = 0; k < n * n; k++) if (tmp[k] !== 0) { h[k] += tmp[k]; if (tmp[k] > 0.002) pack[k] = Math.min(pack[k], 0.4); }
  }

  upload() {
    const f = this.fieldData;
    for (let k = 0, o = 0; k < N * N; k++, o += 4) {
      f[o] = this.h[k]; f[o + 1] = this.d[k]; f[o + 2] = this.wet[k]; f[o + 3] = this.foam[k];
    }
    this.tex.needsUpdate = true;
  }
}
