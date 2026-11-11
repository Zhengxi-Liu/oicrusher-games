/**
 * Ocean - the sea for both games (the island sim and Carrier War): one big plane shaded entirely in the fragment shader.
 *   - ten crossing wave trains (long swells down to ripples) summed for height AND slope, so the normal is exact and animates smoothly;
 *     every train (and the ripples / foam) fades out once a pixel's footprint on the water gets near its wavelength - measured with screen-space
 *     derivatives, so it also works at the grazing angles of low flight, where one pixel spans hundreds of metres front-to-back near the horizon
 *     (a distance-only fade left aliased stripes there); the wave slope that is faded out is kept as roughness: the far sea turns into a soft,
 *     blurred sky reflection instead of moire
 *   - Schlick fresnel: looking down you see deep blue-green water that is lighter on the crests; at a grazing angle it mirrors the sky
 *   - the sun's glitter path and a soft glow, whitecaps on the steep crests, a little foam streaking
 *   - three.js fog and logarithmic depth work like on any other material
 * createOcean({sunDir}) -> {mesh, update(timeSeconds)}.
 */
import * as THREE from 'three';

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float time;
uniform vec3 sunDir;
uniform vec3 deepColor;
uniform vec3 crestColor;
uniform vec3 horizonColor;
uniform vec3 zenithColor;
uniform float opacity;
varying vec3 vWorld;
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>

// wave trains: one wind direction with a spread, long swell down to short chop. Each train fades out by itself once its
// wavelength is too small for the pixel footprint (foot = metres of water under one pixel, the long axis), so nothing aliases into stripes.
const int N = 8;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * noise(p) + 0.3 * noise(p * 2.1 + 7.3) + 0.2 * noise(p * 4.3 + 3.1); }

// returns height in x, slope (dh/dx, dh/dz) in yz, and how choppy / steep the surface is in w (for whitecaps)
float lostSlope;                                                 // the slope variance of the faded trains (-> roughness)
vec4 waves(vec2 p, float dist, float foot) {
  float h = 0.0, steep = 0.0; vec2 g = vec2(0.0); lostSlope = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float len = 150.0 * pow(0.6, fi);                          // 150 m swell ... ~4 m chop
    float ang = 0.6 + (hash(vec2(fi, 3.0)) - 0.5) * 1.9 + sin(fi * 5.3) * 0.25;       // all trains roughly downwind
    float amp = len * (0.0068 - 0.0004 * fi);
    float k = 6.2831853 / len, spd = sqrt(9.81 / k);
    vec2 d = vec2(cos(ang), sin(ang));
    float fade = (1.0 - smoothstep(len * 0.18, len * 0.5, foot)) * (1.0 - smoothstep(len * 25.0, len * 140.0, dist));   // gone before it can alias
    lostSlope += (1.0 - fade) * (amp * k) * (amp * k);
    float ph = k * dot(d, p) + time * spd * k * 0.9 + fi * 2.7;
    float s = sin(ph), c = cos(ph);
    float e = 0.5 + 0.5 * s; e = e * (0.6 + 0.4 * e);              // slightly peaked crests
    h += amp * fade * (2.0 * e - 1.0);
    float sl = amp * fade * k * 2.0 * (0.5 + 0.5 * s) * c;
    g += d * sl;
    steep += abs(sl) * (fi > 2.5 ? 1.0 : 0.3);
  }
  return vec4(h, g, steep);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 dx = dFdx(vWorld.xz), dy = dFdy(vWorld.xz);
  float foot = max(length(dx), length(dy));
  vec4 w = waves(vWorld.xz, dist, foot);
  float rough = clamp(sqrt(lostSlope) * 6.0, 0.0, 1.0);             // 0 = every wave resolved, 1 = all detail is below the pixel
  // fine ripples: a cheap animated normal perturbation that is faded by distance (kills the glitter shimmer at range)
  vec2 rp = vWorld.xz * 0.9 + vec2(time * 0.6, time * 0.35);
  vec2 rip = vec2(noise(rp) - noise(rp + vec2(5.2, 1.7)), noise(rp * 1.7 + 9.0) - noise(rp * 1.7 + vec2(3.3, 8.8))) * 0.08 * exp(-dist / 500.0) * (1.0 - smoothstep(0.4, 1.5, foot));
  vec3 N = normalize(vec3(-w.y - rip.x, 1.0, -w.z - rip.y));
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.35 + 0.65 * exp(-dist / 12000.0)));

  float cosv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  fres *= 1.0 - 0.25 * rough;                                       // a rough sea mirrors a little less at grazing angles
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  float up = clamp(R.y, 0.0, 1.0);
  vec3 skyCol = mix(horizonColor, zenithColor, pow(up, 0.5));
  skyCol = mix(skyCol, mix(horizonColor, zenithColor, 0.35), rough * 0.5);       // unresolved waves reflect a blurred patch of sky
  // sun: a broad warm sheen plus a glitter path that widens (blurs) with distance instead of sparkling per pixel
  float sunAmt = max(dot(R, sunDir), 0.0), blur = clamp(max(dist / 4000.0, rough), 0.0, 1.0);
  skyCol += vec3(1.0, 0.92, 0.75) * (pow(sunAmt, mix(700.0, 90.0, blur)) * mix(9.0, 2.2, blur) + pow(sunAmt, 40.0) * 0.28 + pow(sunAmt, 5.0) * 0.07);

  // body colour: deep water with a green-teal tint on the crests and a bit of light scattered through thin wave tops
  float crest = smoothstep(-1.2, 1.6, w.x);
  vec3 body = mix(deepColor, crestColor, crest * 0.8);
  body += vec3(0.02, 0.10, 0.09) * smoothstep(0.2, 1.8, w.x) * max(dot(N, sunDir), 0.0);
  body *= 0.5 + 0.5 * max(dot(N, sunDir), 0.0);
  vec3 col = mix(body, skyCol, fres);

  // whitecaps only where the surface is steep AND high, broken up by noise, plus thin foam streaks along the wind
  float breakup = fbm(vWorld.xz * 0.18 + vec2(time * 0.05, 0.0));
  float cap = smoothstep(0.7, 1.1, w.x * 0.35 + w.w * 2.2 + breakup * 0.45 - 0.1) * exp(-dist / 2500.0) * (1.0 - smoothstep(1.5, 5.0, foot));
  float streak = smoothstep(0.62, 0.9, fbm(vec2(vWorld.x * 0.5 + vWorld.z * 0.3, vWorld.z * 0.5 - vWorld.x * 0.3) * 0.12 + time * 0.03)) * smoothstep(0.0, 1.0, w.x + 0.6) * exp(-dist / 1500.0) * (1.0 - smoothstep(2.0, 6.0, foot));
  col = mix(col, vec3(0.88, 0.94, 0.97) * (0.55 + 0.4 * max(sunDir.y, 0.0)), clamp(cap * 0.55 + streak * 0.1, 0.0, 0.6));

  gl_FragColor = vec4(col, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createOcean({ sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(150)), opacity = 1, size = 90000 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, sunDir: { value: sunDir.clone().normalize() }, opacity: { value: opacity },
    deepColor: { value: new THREE.Color(0.012, 0.085, 0.15) }, crestColor: { value: new THREE.Color(0.04, 0.26, 0.32) },
    horizonColor: { value: new THREE.Color(0.55, 0.68, 0.80) }, zenithColor: { value: new THREE.Color(0.10, 0.27, 0.52) },
  }]);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: opacity < 1 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.frustumCulled = false; mesh.renderOrder = -1;
  return { mesh, update: t => { uniforms.time.value = t; } };
}
