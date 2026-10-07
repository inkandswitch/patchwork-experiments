// The raymarching shader. The user's field arrives as a GLSL function
// generated from the IR (see lang/glsl.js); everything else here is fixed.
//
// Sphere tracing against max(field, bounds box), with soft shadows, a little
// ambient occlusion, a shadow-catching ground grid at the bottom of the
// bounds, and five looks: shaded, normals, mean curvature, zebra stripes
// (reflection lines, for judging how smooth a blend is) and a slice that cuts
// the part open at a height and paints the distance field on the cut.

import { GLSL_HELPERS } from "../lang/glsl.js";

export const MODES = [
  { value: 0, key: "shaded", label: "Shaded" },
  { value: 1, key: "normals", label: "Normals" },
  { value: 2, key: "curvature", label: "Curvature" },
  { value: 3, key: "zebra", label: "Zebra" },
  { value: 4, key: "slice", label: "Slice" },
];

export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** @param {string} userGLSL  the output of toGLSL(ir, "isf_user") */
export function fragmentShader(userGLSL) {
  return `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform vec3 uEye, uRight, uUp, uFwd;
uniform float uTanHalf;
uniform vec3 uBMin, uBMax;
uniform int uMode;
uniform float uSliceY;
uniform vec3 uColor, uBg, uInk, uWarm, uCool;
uniform int uZero;
uniform int uMaxSteps;
out vec4 fragColor;

${GLSL_HELPERS}

${userGLSL}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float field(vec3 p) {
  vec3 c = (uBMin + uBMax) * 0.5;
  vec3 h = (uBMax - uBMin) * 0.5;
  return max(isf_user(p), sdBox(p - c, h));
}

float map(vec3 p) {
  float d = field(p);
  if (uMode == 4) d = max(d, p.y - uSliceY);
  return d;
}

vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 lo = min(t0, t1);
  vec3 hi = max(t0, t1);
  return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

float sceneSize() { return length(uBMax - uBMin); }

vec3 calcNormal(vec3 p, float h) {
  // tetrahedron gradient; the loop keeps the compiler from inlining map() four times
  vec3 n = vec3(0.0);
  for (int i = uZero; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * map(p + e * h);
  }
  return normalize(n);
}

// mean curvature ≈ ∇²f / (2|∇f|), both from the same four tetrahedral samples
// (exact for a true distance field; approximate where the field is not one)
float meanCurvature(vec3 p, float h) {
  float s = 0.0;
  vec3 g = vec3(0.0);
  for (int i = uZero; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    float f = map(p + e * h);
    s += f;
    g += e * f;
  }
  float lap = (s - 4.0 * map(p)) * 3.0 / (2.0 * h * h);
  float grad = length(g) * 3.0 / (4.0 * h);
  return 0.5 * lap / max(grad, 1e-3);
}

float softShadow(vec3 ro, vec3 rd, float tmax, float size) {
  float res = 1.0;
  float t = 0.002 * size;
  for (int i = uZero; i < 56; i++) {
    float h = map(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.002 * size, 0.08 * size);
    if (res < 0.003 || t > tmax) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float ambientOcclusion(vec3 p, vec3 n, float size) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = uZero; i < 5; i++) {
    float h = size * (0.004 + 0.05 * float(i) / 4.0);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.9;
  }
  return clamp(1.0 - 6.0 * occ / size, 0.0, 1.0);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 ro = uEye;
  vec3 rd = normalize(uFwd + uTanHalf * (uv.x * uRight + uv.y * uUp));
  float pixel = 2.0 * uTanHalf / uRes.y;
  float size = sceneSize();

  vec3 bg = toLinear(uBg);
  vec3 ink = toLinear(uInk);
  vec3 base = toLinear(uColor);
  vec3 sun = normalize(vec3(0.55, 0.8, 0.35));

  // background: the editor fill with a whisper of vertical gradient
  vec3 col = mix(bg, mix(bg, ink, 0.06), clamp(0.5 - 0.5 * uv.y, 0.0, 1.0));

  vec2 tb = boxHit(ro, rd, uBMin, uBMax);
  float tSurf = -1.0;
  if (tb.y > max(tb.x, 0.0)) {
    float t = max(tb.x, 0.0);
    for (int i = 0; i < 400; i++) {
      if (i >= uMaxSteps) break;
      float d = map(ro + rd * t);
      float eps = max(pixel * t * 0.5, 1e-6 * size);
      if (d < eps) { tSurf = t; break; }
      t += d * 0.9;
      if (t > tb.y) break;
    }
  }

  // ground: a shadow catcher at the bottom of the bounds
  float floorY = uBMin.y;
  float tGround = rd.y < 0.0 && ro.y > floorY ? (floorY - ro.y) / rd.y : -1.0;
  if (tGround > 0.0 && (tSurf < 0.0 || tGround < tSurf)) {
    vec3 gp = ro + rd * tGround;
    vec3 c = (uBMin + uBMax) * 0.5;
    float r = length(gp.xz - c.xz) / size;
    float fade = exp(-r * r * 3.5);
    float sh = softShadow(gp + vec3(0.0, 1e-4 * size, 0.0), sun, size * 2.0, size);
    // 10 cm grid (1 cm when the part is small)
    float cell = size > 0.6 ? 0.1 : 0.01;
    vec2 g = abs(fract(gp.xz / cell + 0.5) - 0.5) / fwidth(gp.xz / cell);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    vec3 gcol = mix(bg, ink, 0.05 + 0.06 * line);
    gcol *= mix(0.72, 1.0, sh);
    col = mix(col, gcol, fade);
  }

  if (tSurf > 0.0) {
    vec3 p = ro + rd * tSurf;
    float h = max(pixel * tSurf, 2e-5 * size);
    vec3 n = calcNormal(p, h);
    if (uMode == 1) {
      col = toLinear(n * 0.5 + 0.5);
    } else {
      vec3 albedo = base;
      if (uMode == 2) {
        float H = meanCurvature(p, max(h * 4.0, size * 0.002));
        float k = tanh(H * size * 0.08);
        albedo = k > 0.0 ? mix(mix(base, bg, 0.55), toLinear(uWarm), k) : mix(mix(base, bg, 0.55), toLinear(uCool), -k);
      } else if (uMode == 3) {
        vec3 r = reflect(rd, n);
        float s = sin(asin(clamp(r.y, -1.0, 1.0)) * 18.0);
        float w = fwidth(s);
        float stripe = smoothstep(-w, w, s);
        albedo = mix(ink, bg, stripe);
      }
      float sh = softShadow(p + n * h * 2.0, sun, size * 2.0, size);
      float ao = ambientOcclusion(p, n, size);
      float dif = clamp(dot(n, sun), 0.0, 1.0) * sh;
      float sky = 0.5 + 0.5 * n.y;
      vec3 hv = normalize(sun - rd);
      float spe = pow(clamp(dot(n, hv), 0.0, 1.0), 48.0) * dif;
      float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
      vec3 lin = vec3(0.0);
      lin += 1.25 * dif * vec3(1.0, 0.97, 0.92);
      lin += 0.45 * sky * ao * mix(vec3(1.0), bg, 0.3);
      lin += 0.25 * fre * ao * bg;
      col = albedo * lin + (uMode == 3 ? 0.0 : 0.25) * spe;
      if (uMode == 3) col = mix(albedo, col, 0.35);
    }
  }

  // slice plane: paint the field where the cut is visible
  if (uMode == 4 && abs(rd.y) > 1e-6) {
    float tp = (uSliceY - ro.y) / rd.y;
    vec3 sp = ro + rd * tp;
    bool inBox = all(greaterThanEqual(sp, uBMin - 1e-6)) && all(lessThanEqual(sp, uBMax + 1e-6));
    if (tp > 0.0 && inBox && (tSurf < 0.0 || tp <= tSurf + pixel * tp * 2.0)) {
      float f = field(sp);
      float spacing = size / 40.0;
      float fw = fwidth(f / spacing);
      float bands = abs(fract(f / spacing + 0.5) - 0.5) / max(fw, 1e-6);
      float iso = 1.0 - min(bands, 1.0);
      float zero = 1.0 - min(abs(f) / max(fwidth(f), 1e-9) / 1.5, 1.0);
      vec3 inside = mix(base, ink, 0.10 + 0.30 * iso);
      vec3 outside = mix(bg, mix(toLinear(uCool), toLinear(uWarm), 0.5), 0.06 + 0.5 * iso * exp(-abs(f) / (size * 0.25)));
      vec3 c = f < 0.0 ? inside : outside;
      c = mix(c, ink, zero * 0.85);
      // solid where the cut is inside the part; see-through elsewhere so the part below shows
      float alpha = f < 0.0 ? 1.0 : clamp(0.55 + 0.45 * max(iso, zero), 0.0, 1.0);
      col = mix(col, c, alpha);
    }
  }

  fragColor = vec4(toSrgb(col), 1.0);
}
`;
}
