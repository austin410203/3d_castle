// Materials: displaced sand terrain (+ its shadow depth material), sim water, open ocean, outer ground FX.
import * as THREE from 'three';

export const NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = .005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0., 2.);
}
float cloudShadow(vec2 xz, float t) { return smoothstep(0.5, 0.74, fbm(xz * 0.021 + t * vec2(0.011, 0.004))); }
`;

// fragment-side bilinear field lookup: smooth wet/water contours instead of per-triangle sawtooth
const FIELD_FS = /* glsl */`
uniform sampler2D uField; uniform float uCell;
void fieldTaps(vec2 xz, out vec4 a, out vec4 b, out vec4 c, out vec4 d, out vec2 f) {
  float n = 2.0 * uHalf / uCell;
  vec2 g = (xz + uHalf) / uCell - 0.5; vec2 i = floor(g); f = g - i;
  a = texture2D(uField, (i + vec2(0.5, 0.5)) / n); b = texture2D(uField, (i + vec2(1.5, 0.5)) / n);
  c = texture2D(uField, (i + vec2(0.5, 1.5)) / n); d = texture2D(uField, (i + vec2(1.5, 1.5)) / n);
}
vec4 fieldBi(vec2 xz) { vec4 a, b, c, d; vec2 f; fieldTaps(xz, a, b, c, d, f); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float wd(vec4 s) { return s.g > 0.003 ? s.g : -0.06; }
float waterBi(vec2 xz) { vec4 a, b, c, d; vec2 f; fieldTaps(xz, a, b, c, d, f); return mix(mix(wd(a), wd(b), f.x), mix(wd(c), wd(d), f.x), f.y); }
// four bilinear taps half a cell apart = wider tent filter → round contours instead of grid stair-steps
vec4 fieldSmooth(vec2 xz) { float o = uCell * 0.5;
  return 0.25 * (fieldBi(xz + vec2(-o, -o)) + fieldBi(xz + vec2(o, -o)) + fieldBi(xz + vec2(-o, o)) + fieldBi(xz + vec2(o, o))); }
float waterSmooth(vec2 xz) { float o = uCell * 0.5;
  return 0.25 * (waterBi(xz + vec2(-o, -o)) + waterBi(xz + vec2(o, -o)) + waterBi(xz + vec2(-o, o)) + waterBi(xz + vec2(o, o))); }
`;

const FIELD_VS = /* glsl */`
uniform sampler2D uField; uniform float uHalf; uniform float uCell;
vec4 fieldAt(vec2 xz) { return texture2D(uField, (xz + uHalf) / (2.0 * uHalf)); }
`;

// shared uniforms object — mutate .value from main loop
export function makeUniforms(sim, HALF, L) {
  return {
    uField: { value: sim.tex }, uHalf: { value: HALF }, uCell: { value: L },
    uTime: { value: 0 }, uTide: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.6, 0.62, 0.5).normalize() },
    uWT: { value: 7.5 }, uWc: { value: 3 }, uWA: { value: 0.2 }, uWedge: { value: HALF },
    uBigT: { value: -999 }, uBigA: { value: 0.75 },
    uBed: { value: null }, uBedHalf: { value: 140 },
  };
}

export function terrainMaterials(U) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
${FIELD_VS}
varying vec4 vF; varying vec3 vW;`)
      .replace('#include <beginnormal_vertex>', `
float hl = fieldAt(position.xz - vec2(uCell, 0.)).r, hr = fieldAt(position.xz + vec2(uCell, 0.)).r;
float hd = fieldAt(position.xz - vec2(0., uCell)).r, hu = fieldAt(position.xz + vec2(0., uCell)).r;
vec3 objectNormal = normalize(vec3(hl - hr, 2.0 * uCell, hd - hu));`)
      .replace('#include <begin_vertex>', `vF = fieldAt(position.xz);
vec3 transformed = vec3(position.x, vF.r, position.z);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uHalf;
${NOISE}
${FIELD_FS}
varying vec4 vF; varying vec3 vW;`)
      .replace('#include <color_fragment>', `
vec4 Fb = fieldSmooth(vW.xz);
vec3 dryC = pow(vec3(0.96, 0.85, 0.64), vec3(2.2));
vec3 wetC = pow(vec3(0.76, 0.62, 0.43), vec3(2.2));
float grain = fbm(vW.xz * 2.3);
float speck = hash12(floor(vW.xz * 48.0));
float blot = fbm(vW.xz * 0.18);
vec3 sandC = mix(dryC, wetC, smoothstep(0.0, 1.0, Fb.b) * 0.9);
sandC *= 0.86 + 0.2 * grain + 0.1 * (speck - 0.5) + 0.12 * (blot - 0.5);
sandC = mix(sandC, sandC * vec3(0.55, 0.5, 0.45), step(0.985, speck) * 0.7);
float dep = Fb.g;
sandC = mix(sandC, sandC * vec3(0.80, 0.93, 0.90), smoothstep(0.02, 0.7, dep));
diffuseColor.rgb = sandC;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(roughness, 0.5, Fb.b * 0.7);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // wind ripples on dry sand, wave ripples under water
  vec2 rp = vW.xz;
  float warp = fbm(rp * 0.35) * 6.0;
  float ph = dot(rp, vec2(0.86, 0.5)) * 7.0 + warp;
  float amp = mix(0.18, 0.1, Fb.b) * (0.6 + 0.8 * fbm(rp * 0.5 + 3.0));
  vec2 gr = vec2(0.86, 0.5) * cos(ph) * amp;
  gr += (vec2(fbm(rp * 6.0 + 1.3), fbm(rp * 6.0 + 7.1)) - 0.5) * 0.35;
  normal = normalize(normal - (viewMatrix * vec4(gr.x, 0.0, gr.y, 0.0)).xyz);
}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
float cau = caustic(vW.xz * 0.13 + 0.06 * vec2(fbm(vW.xz * 0.3 + uTime * 0.1)), uTime * 0.55);
gl_FragColor.rgb += vec3(0.85, 1.0, 0.95) * cau * smoothstep(0.01, 0.12, dep) * (1.0 - smoothstep(0.8, 2.8, dep)) * 0.32;
gl_FragColor.rgb *= 1.0 - 0.22 * cloudShadow(vW.xz, uTime);`);
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
${FIELD_VS}`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.x, fieldAt(position.xz).r, position.z);`);
  };
  return { mat, depth };
}

const WATER_FS = /* glsl */`
uniform float uTime; uniform vec3 uSunDir; uniform float uHalf; uniform float uOuter;
${NOISE}
${FIELD_FS}
varying float vD; varying float vFoam; varying vec3 vW; varying vec3 vN;
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  float D = vD, foamV = vFoam;
  if (uOuter > 0.5) { if (abs(vW.x) < uHalf && abs(vW.z) < uHalf) discard; }
  else { D = waterSmooth(vW.xz); foamV = fieldBi(vW.xz).a; }
  if (D < 0.0) discard;
  vec2 q = vW.xz; float t = uTime, e = 0.18;
  vec2 drift = vec2(t * 0.32, t * 0.11);
  float n1 = fbm(q * 0.9 + drift);
  float nx = fbm(q * 0.9 + vec2(e, 0.) + drift) - n1;
  float nz = fbm(q * 0.9 + vec2(0., e) + drift) - n1;
  vec3 n = normalize(vN + vec3(-nx, 0., -nz) * 2.4 * smoothstep(0.0, 0.25, D));
  vec3 V = normalize(cameraPosition - vW);
  vec3 shallow = toLin(vec3(0.30, 0.86, 0.80)), mid = toLin(vec3(0.07, 0.68, 0.74)), deep = toLin(vec3(0.02, 0.36, 0.55));
  vec3 col = mix(shallow, mid, smoothstep(0.04, 1.0, D));
  col = mix(col, deep, smoothstep(1.0, 4.5, D));
  float alpha = mix(0.3, 0.95, smoothstep(0.0, 2.2, D)) * smoothstep(0.0, 0.02, D);
  float fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col = mix(col, toLin(vec3(0.62, 0.85, 0.96)), fr * 0.35);
  alpha = max(alpha, fr * 0.4 * smoothstep(0.0, 0.03, D));
  vec3 H = normalize(uSunDir + V);
  float sp = pow(max(dot(n, H), 0.0), 260.0) * 2.6;
  float fn = fbm(q * 3.4 + vec2(t * 0.22, -t * 0.09));
  float shore = (1.0 - smoothstep(0.0, 0.07, D)) * smoothstep(0.38, 0.62, fn + 0.12);
  float flow = smoothstep(0.42, 0.7, fbm(q * 2.6 - vec2(t * 0.5, t * 0.1)) + foamV * 0.45) * smoothstep(0.05, 0.4, foamV);
  float fm = clamp(max(shore, flow), 0., 1.);
  col = mix(col, vec3(1.0), fm * 0.93);
  alpha = max(alpha, fm * 0.96);
  col += vec3(1.0, 0.94, 0.82) * sp; alpha = min(1.0, alpha + sp);
  col *= 1.0 - 0.18 * cloudShadow(q, t);
  gl_FragColor = vec4(col, alpha);
}`;

export function simWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uOuter: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
${FIELD_VS}
varying float vD; varying float vFoam; varying vec3 vW; varying vec3 vN;
float surf(vec2 xz) { vec4 f = fieldAt(xz); return f.g > 0.003 ? f.r + f.g : f.r + 0.004; }  // dry verts hug the sand; the fragment D test trims the edge
void main() {
  vec4 F = fieldAt(position.xz);
  float y = surf(position.xz);
  vD = F.g > 0.003 ? F.g : -0.05;
  vFoam = F.a;
  float sl = surf(position.xz - vec2(uCell, 0.)), sr = surf(position.xz + vec2(uCell, 0.));
  float sd = surf(position.xz - vec2(0., uCell)), su = surf(position.xz + vec2(0., uCell));
  vN = normalize(vec3(sl - sr, 2. * uCell, sd - su));
  vec4 wp = modelMatrix * vec4(position.x, y, position.z, 1.);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: WATER_FS,
  });
}

const SWELL = /* glsl */`
uniform float uTime, uTide, uWT, uWc, uWA, uWedge, uBigT, uBigA;
float swell(float x) {
  float te = uTime - (uWedge - x) / uWc;
  float p = 0.5 + 0.5 * cos(6.2831853 * te / uWT);
  float s = p * p * p * p - 0.273;
  float b = (te - uBigT) / 1.6;
  return uWA * s + uBigA * exp(-b * b);
}`;

export function oceanMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uOuter: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
${SWELL}
uniform sampler2D uBed; uniform float uBedHalf;
varying float vD; varying float vFoam; varying vec3 vW; varying vec3 vN;
void main() {
  vec3 p = position;
  float sw = swell(p.x);
  float y = uTide + sw;
  float bed = texture2D(uBed, (p.xz + uBedHalf) / (2. * uBedHalf)).r;
  vD = y - bed;
  float dx = swell(p.x + 0.4) - swell(p.x - 0.4);
  vN = normalize(vec3(-dx / 0.8, 1., 0.));
  float shallow = 1.0 - smoothstep(0.35, 1.5, vD);
  vFoam = clamp(smoothstep(0.06, 0.24, sw) * shallow * 1.3 + shallow * 0.25, 0., 1.);
  vec4 wp = modelMatrix * vec4(p.x, y, p.z, 1.);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: WATER_FS,
  });
}

// caustics + cloud shadows for ordinary lit meshes (outer seabed, vegetation)
export function addGroundFX(mat, U, caustics = true) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime; s.uniforms.uTide = U.uTide;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uTide;
${NOISE}
varying vec3 vW;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
${caustics ? `float dep = uTide - vW.y;
float cau = caustic(vW.xz * 0.13 + 0.06 * vec2(fbm(vW.xz * 0.3 + uTime * 0.1)), uTime * 0.55);
gl_FragColor.rgb += vec3(0.85, 1.0, 0.95) * cau * smoothstep(0.01, 0.15, dep) * (1.0 - smoothstep(0.8, 3.0, dep)) * 0.3;` : ''}
gl_FragColor.rgb *= 1.0 - 0.22 * cloudShadow(vW.xz, uTime);`);
  };
  return mat;
}
