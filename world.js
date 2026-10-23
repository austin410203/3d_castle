// Static-ish scenery: lights, sim terrain + water meshes, outer beach/seabed, open ocean, plants, corals, rocks, palms, gulls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { N, L, HALF, baseHeight, shoreS } from './sim.js';
import { terrainMaterials, simWaterMaterial, oceanMaterial, addGroundFX } from './shaders.js';

const OUT = 140;                 // outer world half size
const rnd = mulberry(7);
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = (a, b) => a + (b - a) * rnd();
const col = (hex) => new THREE.Color(hex);

export function buildWorld(scene, sim, U) {
  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xd6ecff, 0xe9c48c, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.7);
  sun.position.copy(U.uSunDir.value).multiplyScalar(70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 20; sc.far = 140;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ---------- sim terrain (vertex per cell, edge vertices pushed to the domain border) ----------
  const pos = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3);
  const edge = (i) => (i === 0 ? -HALF : i === N - 1 ? HALF : -HALF + (i + 0.5) * L);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 3; pos[k] = edge(i); pos[k + 2] = edge(j); nrm[k + 1] = 1;
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  grid.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  grid.setIndex(new THREE.BufferAttribute(idx, 1));
  grid.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HALF * 1.6);
  const tm = terrainMaterials(U);
  const terrain = new THREE.Mesh(grid, tm.mat);
  terrain.customDepthMaterial = tm.depth;
  terrain.castShadow = terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  scene.add(terrain);

  const water = new THREE.Mesh(grid, simWaterMaterial(U));
  water.frustumCulled = false; water.renderOrder = 2;
  scene.add(water);

  // ---------- outer ground (seabed, beach, dunes) ----------
  const SEG = 320, step = (2 * OUT) / SEG;    // step = L*... lines up with the domain border at ±HALF
  const gg = new THREE.PlaneGeometry(2 * OUT, 2 * OUT, SEG, SEG); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position, gc = new Float32Array(gp.count * 3);
  const cDry = col('#f3d7a0'), cWet = col('#cfb27c'), cBed = col('#b09c6b'), cReef = col('#9aa27a'), cDeep = col('#5d9c94'), cGrass = col('#86ad55'), cGrass2 = col('#5f9142'), tmp = new THREE.Color();
  for (let v = 0; v < gp.count; v++) {
    const x = gp.getX(v), z = gp.getZ(v);
    const inner = Math.abs(x) < HALF - 0.01 && Math.abs(z) < HALF - 0.01;
    const h = baseHeight(x, z);
    gp.setY(v, inner ? -8 : h - 0.03);
    const s = shoreS(x, z), nz = Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.29 - x * 0.13);
    if (h < -0.05) tmp.copy(cWet).lerp(cBed, Math.min(1, -h / 0.3)).lerp(cReef, Math.min(1, Math.max(0, (s - 34) / 8))).lerp(cDeep, Math.min(1, Math.max(0, (-h - 1.4) / 2.5)));
    else if (h < 0.25) tmp.copy(cWet).lerp(cDry, h / 0.25);
    else tmp.copy(cDry);
    const g = Math.min(1, Math.max(0, (-s - 19 + nz * 3) / 4));
    if (g > 0) tmp.lerp(nz > 0.1 ? cGrass2 : cGrass, g);
    tmp.multiplyScalar(0.94 + 0.08 * Math.sin(x * 1.7) * Math.sin(z * 1.3));
    gc[v * 3] = tmp.r; gc[v * 3 + 1] = tmp.g; gc[v * 3 + 2] = tmp.b;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, addGroundFX(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), U));
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- open ocean ----------
  const BED = 512, bed = new Float32Array(BED * BED * 4);
  for (let j = 0; j < BED; j++) for (let i = 0; i < BED; i++) {
    const x = -OUT + (i + 0.5) / BED * 2 * OUT, z = -OUT + (j + 0.5) / BED * 2 * OUT;
    bed[(j * BED + i) * 4] = baseHeight(x, z);
  }
  const bedTex = new THREE.DataTexture(new Uint16Array(bed.length).map((_, k) => THREE.DataUtils.toHalfFloat(bed[k])), BED, BED, THREE.RGBAFormat, THREE.HalfFloatType);
  bedTex.magFilter = bedTex.minFilter = THREE.LinearFilter; bedTex.needsUpdate = true;
  U.uBed.value = bedTex; U.uBedHalf.value = OUT;
  const og = new THREE.PlaneGeometry(2 * OUT, 2 * OUT, 280, 280); og.rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(og, oceanMaterial(U));
  ocean.frustumCulled = false; ocean.renderOrder = 1;
  scene.add(ocean);

  // ---------- plants on the dunes ----------
  const lowPoly = (geo, amp, seed) => {
    const p = geo.attributes.position, r2 = mulberry(seed);
    const map = new Map();
    for (let v = 0; v < p.count; v++) {
      const key = `${p.getX(v).toFixed(3)},${p.getY(v).toFixed(3)},${p.getZ(v).toFixed(3)}`;
      if (!map.has(key)) map.set(key, [(r2() - 0.5) * amp, (r2() - 0.5) * amp, (r2() - 0.5) * amp]);
      const j = map.get(key); p.setXYZ(v, p.getX(v) + j[0], p.getY(v) + j[1], p.getZ(v) + j[2]);
    }
    geo.computeVertexNormals(); return geo;
  };
  const bushGeo = lowPoly(new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), 0.28, 3);
  const greens = ['#4f8f3a', '#6aa84f', '#3f7a3a', '#8fbf5a', '#5c9a45', '#77b255'];
  const flowers = ['#f3a6c0', '#f4f0e2', '#f6b56b', '#e86f7a'];
  const bushes = [];
  for (let t = 0; t < 6000 && bushes.length < 1500; t++) {
    const x = R(-90, -14), z = R(-80, 80), s = shoreS(x, z);
    if (s > -19.5 + Math.sin(z * 0.4) * 1.5) continue;
    if (Math.abs(x) < HALF && Math.abs(z) < HALF && s > -24) continue;
    const dens = Math.min(1, (-s - 19) / 6);
    if (rnd() > dens * 0.9) continue;
    const sc = R(0.5, 1.6) * (rnd() < 0.15 ? 1.8 : 1);
    bushes.push({ x, z, sc, c: rnd() < 0.12 ? flowers[(rnd() * flowers.length) | 0] : greens[(rnd() * greens.length) | 0] });
  }
  const bushMesh = new THREE.InstancedMesh(bushGeo, addGroundFX(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), U, false), bushes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  bushes.forEach((b, i) => {
    q.setFromEuler(e.set(0, R(0, 6.28), 0));
    m4.compose(v3.set(b.x, baseHeight(b.x, b.z) + b.sc * 0.25, b.z), q, s3.set(b.sc * R(0.9, 1.3), b.sc * R(0.55, 0.85), b.sc * R(0.9, 1.3)));
    bushMesh.setMatrixAt(i, m4); bushMesh.setColorAt(i, col(b.c).multiplyScalar(R(0.85, 1.1)));
  });
  bushMesh.castShadow = bushMesh.receiveShadow = true;
  scene.add(bushMesh);

  // beach grass tufts (some inside the play area: they follow the sand)
  const blade = new THREE.ConeGeometry(0.035, 0.55, 3); blade.translate(0, 0.27, 0);
  const tuftParts = [];
  for (let b = 0; b < 7; b++) { const g = blade.clone(); g.rotateZ(R(-0.5, 0.5)); g.rotateY(b * 0.9); g.rotateX(R(-0.4, 0.4)); g.scale(1, R(0.6, 1.2), 1); tuftParts.push(g); }
  const tuftGeo = mergeGeometries(tuftParts);
  const tufts = [];
  for (let t = 0; t < 9000 && tufts.length < 2600; t++) {
    const x = R(-80, -4), z = R(-75, 75), s = shoreS(x, z);
    if (s > -13 || rnd() > Math.min(1, (-s - 13) / 8)) continue;
    tufts.push({ x, z, sc: R(0.7, 1.4), r: R(0, 6.3), inDomain: sim.inside(x, z, 0.3) });
  }
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, addGroundFX(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), U, false), tufts.length);
  const tuftColors = ['#9bb85a', '#b9c46a', '#7ea24a', '#c8c47a'];
  const placeTuft = (t, i) => {
    q.setFromEuler(e.set(0, t.r, 0));
    const y = t.inDomain ? sim.heightAt(t.x, t.z) : baseHeight(t.x, t.z);
    const buried = t.inDomain && sim.depthAt(t.x, t.z) > 0.05;
    m4.compose(v3.set(t.x, y - 0.02, t.z), q, s3.setScalar(buried ? 0.001 : t.sc));
    tuftMesh.setMatrixAt(i, m4);
  };
  tufts.forEach((t, i) => { placeTuft(t, i); tuftMesh.setColorAt(i, col(tuftColors[i % 4]).multiplyScalar(R(0.85, 1.1))); });
  tuftMesh.castShadow = true;
  scene.add(tuftMesh);

  // palms
  const palms = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#9c7a52', roughness: 0.9, flatShading: true });
  const frondMat = new THREE.MeshStandardMaterial({ color: '#4c9a3c', roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
  for (const [px, pz] of [[-24, -16], [-27, 3], [-22.5, 14], [-31, -6], [-26, 24], [-29, -26], [-34, 12]]) {
    const g = new THREE.Group();
    const lean = new THREE.Vector3(R(0.6, 1.6), 0, R(-1, 1));
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.2, 2.5, lean.z * 0.2), new THREE.Vector3(lean.x, 5.2, lean.z));
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.17, 6), trunkMat); trunk.castShadow = true; g.add(trunk);
    const crown = new THREE.Group(); crown.position.copy(curve.getPoint(1)); g.add(crown);
    for (let f = 0; f < 8; f++) {
      const leaf = new THREE.PlaneGeometry(2.6, 0.55, 6, 1);
      const lp = leaf.attributes.position;
      for (let v = 0; v < lp.count; v++) { const x = lp.getX(v) + 1.3; lp.setXYZ(v, x, -0.12 * x * x + lp.getY(v) * 0 , lp.getY(v) * (1 - x / 2.8)); }
      leaf.computeVertexNormals();
      const m = new THREE.Mesh(leaf, frondMat); m.rotation.y = f / 8 * Math.PI * 2 + R(-0.2, 0.2); m.rotation.z = R(0.05, 0.35); m.castShadow = true;
      crown.add(m);
    }
    g.position.set(px, baseHeight(px, pz) - 0.05, pz);
    scene.add(g); palms.push({ g, crown, ph: R(0, 6) });
  }

  // ---------- corals, seagrass, rocks ----------
  const coralGeoA = lowPoly(new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), 0.3, 11);
  const branch = [];
  for (let b = 0; b < 6; b++) { const c = new THREE.CylinderGeometry(0.09, 0.14, 1.1, 5); c.translate(0, 0.5, 0); c.rotateZ(R(-0.8, 0.8)); c.rotateY(b * 1.1); branch.push(c); }
  const coralGeoB = mergeGeometries(branch.map((g) => g.toNonIndexed()));
  const coralCols = ['#f28b9b', '#f4a261', '#b884cf', '#ef6f6c', '#f6c56b', '#e8838f', '#5fb7a5', '#d96aa7'];
  const coralA = [], coralB = [], grass = [];
  for (let t = 0; t < 40000 && (coralA.length < 900 || grass.length < 3200); t++) {
    const x = R(-20, 110), z = R(-95, 95), h = baseHeight(x, z), s = shoreS(x, z);
    if (s < 15 || h > -0.32 || h < -3.2) continue;
    if (sim.inside(x, z, -0.5) && s < 22) continue;
    const reef = Math.exp(-(((s - 42) / 7) ** 2));
    if (rnd() < 0.35 + reef * 0.5) { if (coralA.length + coralB.length < 1400) (rnd() < 0.45 ? coralB : coralA).push({ x, z, h }); }
    else if (grass.length < 3200) grass.push({ x, z, h });
  }
  const coralMat = addGroundFX(new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true }), U);
  const mkInst = (geo, list, mat, fn) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((c, i) => { fn(c, i, im); });
    scene.add(im); return im;
  };
  mkInst(coralGeoA, coralA, coralMat, (c, i, im) => {
    const sc = R(0.25, 0.75); q.setFromEuler(e.set(R(-0.3, 0.3), R(0, 6), 0));
    im.setMatrixAt(i, m4.compose(v3.set(c.x, c.h, c.z), q, s3.set(sc * R(0.9, 1.4), sc * R(0.4, 0.8), sc)));
    im.setColorAt(i, col(coralCols[(rnd() * coralCols.length) | 0]));
  });
  mkInst(coralGeoB, coralB, coralMat, (c, i, im) => {
    const sc = R(0.3, 0.7); q.setFromEuler(e.set(0, R(0, 6), 0));
    im.setMatrixAt(i, m4.compose(v3.set(c.x, c.h - 0.05, c.z), q, s3.setScalar(sc)));
    im.setColorAt(i, col(coralCols[(rnd() * coralCols.length) | 0]));
  });
  mkInst(new THREE.SphereGeometry(1, 6, 4), grass, addGroundFX(new THREE.MeshStandardMaterial({ roughness: 1 }), U), (c, i, im) => {
    const sc = R(0.12, 0.42); q.setFromEuler(e.set(0, R(0, 6), 0));
    im.setMatrixAt(i, m4.compose(v3.set(c.x, c.h, c.z), q, s3.set(sc * R(1, 1.8), sc * 0.35, sc)));
    im.setColorAt(i, col(rnd() < 0.7 ? '#2f7a55' : '#5d9c4a').multiplyScalar(R(0.7, 1.1)));
  });
  const rockGeo = lowPoly(new THREE.DodecahedronGeometry(1, 0).toNonIndexed(), 0.35, 21);
  const rocks = [];
  for (let t = 0; t < 3000 && rocks.length < 90; t++) {
    const x = R(-60, 90), z = R(-90, 90), h = baseHeight(x, z), s = shoreS(x, z);
    if (sim.inside(x, z, -1)) continue;
    if ((s > 36 && s < 48) || (s < -17 && rnd() < 0.3)) rocks.push({ x, z, h });
  }
  const rockMesh = mkInst(rockGeo, rocks, addGroundFX(new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.9, flatShading: true }), U), (c, i, im) => {
    const sc = R(0.4, 1.6); q.setFromEuler(e.set(R(0, 3), R(0, 6), R(0, 3)));
    im.setMatrixAt(i, m4.compose(v3.set(c.x, c.h + sc * 0.1, c.z), q, s3.set(sc, sc * R(0.5, 0.8), sc * R(0.7, 1.1))));
    im.setColorAt(i, col('#a29c90').multiplyScalar(R(0.75, 1.1)));
  });
  rockMesh.castShadow = true;

  // ---------- gulls ----------
  const gullMat = new THREE.MeshStandardMaterial({ color: '#fbfbf6', roughness: 0.7, side: THREE.DoubleSide });
  const gulls = [];
  for (let g = 0; g < 4; g++) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), gullMat); body.scale.set(1, 0.8, 2.6); grp.add(body);
    const wingGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.2), new THREE.Vector3(0.75, 0.05, 0.05), new THREE.Vector3(1.05, 0, -0.15), new THREE.Vector3(0, 0, -0.2)]);
    wingGeo.setIndex([0, 1, 3, 1, 2, 3]); wingGeo.computeVertexNormals();
    const wl = new THREE.Mesh(wingGeo, gullMat), wr = new THREE.Mesh(wingGeo, gullMat); wr.scale.x = -1;
    const tipMat = new THREE.MeshStandardMaterial({ color: '#555', side: THREE.DoubleSide });
    const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), tipMat); tip.rotation.x = -Math.PI / 2; tip.position.set(0.95, 0.01, -0.1);
    wl.add(tip); wr.add(tip.clone());
    grp.add(wl, wr);
    grp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    grp.scale.setScalar(0.6);
    scene.add(grp);
    gulls.push({ grp, wl, wr, cx: R(-12, 18), cz: R(-12, 12), r: R(9, 18), y: R(6, 9), w: R(0.12, 0.22) * (g % 2 ? 1 : -1), ph: R(0, 6) });
  }

  let tuftClock = 0;
  return {
    sun, terrain, water, ocean, ground,
    update(t, dt) {
      for (const p of palms) { p.crown.rotation.z = Math.sin(t * 0.9 + p.ph) * 0.04; p.crown.rotation.x = Math.sin(t * 0.7 + p.ph * 2) * 0.03; }
      for (const g of gulls) {
        const a = t * g.w + g.ph;
        g.grp.position.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(t * 0.5 + g.ph) * 0.6, g.cz + Math.sin(a) * g.r);
        g.grp.rotation.set(0, -a + (g.w > 0 ? Math.PI : 0), Math.sign(g.w) * 0.25);
        const flap = Math.sin(t * 7 + g.ph) * (0.5 + 0.5 * Math.sin(t * 0.4 + g.ph) > 0.45 ? 0.55 : 0.08);
        g.wl.rotation.z = flap; g.wr.rotation.z = -flap;
      }
      tuftClock += dt;
      if (tuftClock > 0.4) {
        tuftClock = 0;
        tufts.forEach((tf, i) => { if (tf.inDomain) placeTuft(tf, i); });
        tuftMesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
