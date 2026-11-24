export const transitionVertex = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const prelude = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_from, u_to, u_mask;
uniform vec2 u_size;
uniform vec4 u_color;
uniform vec2 u_anchor, u_direction;
uniform float u_progress, u_phase, u_time, u_value;
uniform float u_cells, u_bands, u_steps, u_strength, u_seed, u_softness, u_width;
uniform int u_fromCover, u_toCover, u_hasMask;
uniform int u_fromFlip, u_toFlip, u_maskFlip;
vec2 oriented(vec2 uv, int flip) { return vec2(uv.x, flip != 0 ? 1.0 - uv.y : uv.y); }
vec4 sourceFrom(vec2 uv) {
  return u_fromCover != 0 ? u_color : texture(u_from, clamp(oriented(uv, u_fromFlip), 0.0, 1.0));
}
vec4 sourceTo(vec2 uv) {
  return u_toCover != 0 ? u_color : texture(u_to, clamp(oriented(uv, u_toFlip), 0.0, 1.0));
}
float maskAt(vec2 uv) {
  vec4 value = texture(u_mask, clamp(oriented(uv, u_maskFlip), 0.0, 1.0));
  return value.r * value.a;
}
float hash(vec2 v) {
  uvec2 bits = uvec2(ivec2(v)) + uvec2(uint(u_seed), uint(u_seed) * 11u);
  uint n = (bits.x * 1664525u + bits.y * 1013904223u) ^ 2246822519u;
  n = (n ^ (n >> 16u)) * 2246822519u;
  n = (n ^ (n >> 13u)) * 3266489917u;
  return float(n >> 8u) / 16777216.0;
}
float luma(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }
float reveal(float rank) {
  if (u_value <= 0.0) return 0.0;
  if (u_value >= 1.0) return 1.0;
  return u_softness > 0.0
    ? smoothstep(rank - u_softness, rank + u_softness, u_value)
    : step(rank, u_value);
}
vec4 swapAt(vec2 uv, float rank) { return mix(sourceFrom(uv), sourceTo(uv), reveal(rank)); }
vec2 metric(vec2 uv) { return uv * u_size / min(u_size.x, u_size.y); }
vec2 grid() { return max(vec2(1.0), floor(u_size / u_cells)); }
float axisRank(vec2 uv, vec2 dir) {
  float bounds = abs(dir.x) + abs(dir.y);
  return bounds > 0.0 ? 0.5 + dot(uv - 0.5, dir) / bounds : uv.x;
}
float aperture(vec2 uv, bool diamond) {
  vec2 q = abs(metric(uv - u_anchor));
  vec2 limit = metric(max(u_anchor, 1.0 - u_anchor));
  return diamond ? (q.x + q.y) / max(0.001, limit.x + limit.y) : length(q) / max(0.001, length(limit));
}
`;

const bodies = {
  mix: 'return mix(sourceFrom(uv), sourceTo(uv), u_value);',
  stepped: 'return mix(sourceFrom(uv), sourceTo(uv), floor(u_value * u_steps) / u_steps);',
  silhouette: `
    vec4 a = sourceFrom(uv), b = sourceTo(uv);
    float subject = u_hasMask != 0 ? maskAt(uv) : smoothstep(0.30, 0.64, luma(a.rgb));
    vec4 shade = vec4(mix(a.rgb * 0.27, u_color.rgb, 0.18), a.a);
    vec4 held = mix(b, shade, subject);
    return u_value < 0.58 ? mix(a, held, u_value / 0.58) : mix(held, b, (u_value - 0.58) / 0.42);`,
  light: `
    vec4 a = sourceFrom(uv), b = sourceTo(uv);
    float local = 1.0 - smoothstep(u_width * 0.35, u_width, length(metric(uv - u_anchor)));
    float lamp = u_hasMask != 0 ? maskAt(uv) : local;
    float fade = mix(min(1.0, u_value / 0.55), max(0.0, (u_value - 0.78) / 0.22), lamp);
    return mix(a, b, fade);`,
  slit: 'return swapAt(uv, abs(uv.y - u_anchor.y) / max(u_anchor.y, 1.0 - u_anchor.y));',
  eyelid: `
    float x = (uv.x - u_anchor.x) / max(u_anchor.x, 1.0 - u_anchor.x);
    float curve = mix(1.0, sqrt(max(0.0, 1.0 - x * x)), u_strength);
    float y = (uv.y - u_anchor.y) / max(u_anchor.y, 1.0 - u_anchor.y);
    return swapAt(uv, abs(y + u_direction.y * (1.0 - u_value) * 0.15) / max(0.04, curve));`,
  upperLid: `
    float x = (uv.x - u_anchor.x) * 2.0;
    return swapAt(uv, uv.y + u_strength * x * x * (1.0 - u_value) * 0.25);`,
  squint: `
    float x = (uv.x - u_anchor.x) * 2.0;
    float y = abs(uv.y - u_anchor.y) / max(u_anchor.y, 1.0 - u_anchor.y);
    float open = reveal(y / max(0.12, 1.0 - x * x * u_strength));
    vec4 image = sourceTo(uv);
    float glare = clamp(u_width, 0.0, 1.0);
    return mix(sourceFrom(uv), vec4(mix(image.rgb, vec3(1.0), glare), image.a), open);`,
  circle: 'return swapAt(uv, aperture(uv, false));',
  diamond: 'return swapAt(uv, aperture(uv, true));',
  faint: `
    vec2 center = u_anchor + u_direction * (1.0 - u_value) * u_strength;
    vec2 delta = metric(uv - center);
    delta.y *= 1.75;
    return swapAt(uv, length(delta) / length(metric(vec2(1.0, 1.75))));`,
  split: 'return swapAt(uv, abs(uv.x - u_anchor.x) / max(u_anchor.x, 1.0 - u_anchor.x));',
  wipe: 'return swapAt(uv, axisRank(uv, u_direction));',
  stairs: `
    vec2 stepped = vec2(uv.x, (floor(uv.y * u_bands) + 0.5) / u_bands);
    return swapAt(uv, axisRank(stepped, u_direction));`,
  clock: `
    vec2 delta = metric(uv - u_anchor);
    float angle = atan(delta.x, delta.y) / 6.28318530718;
    return swapAt(uv, fract(angle * sign(u_direction.x) + u_width));`,
  blinds: `
    float stripe = uv.y * u_bands;
    return swapAt(uv, (mod(floor(stripe), 2.0) + fract(stripe)) * 0.5);`,
  door: `
    float x = axisRank(uv, u_direction);
    float edge = u_value * (1.0 + u_width);
    if (u_value <= 0.0) return sourceFrom(uv);
    if (u_value >= 1.0) return sourceTo(uv);
    if (x < edge - u_width) return sourceTo(uv);
    if (x < edge) {
      float jamb = (x - edge + u_width) / max(0.001, u_width);
      if (u_hasMask != 0) {
        vec4 panel = texture(u_mask, oriented(vec2(jamb, uv.y), u_maskFlip));
        return mix(sourceFrom(uv), panel, panel.a);
      }
      return vec4(u_color.rgb * (jamb < 0.16 || jamb > 0.84 ? 1.15 : 0.65), 1.0);
    }
    return sourceFrom(uv);`,
  checker: `
    vec2 tile = floor(uv * grid());
    return swapAt(uv, (mod(tile.x + tile.y, 2.0) + hash(tile)) * 0.5);`,
  random: 'return swapAt(uv, (floor(hash(floor(uv * grid())) * u_steps) + 0.5) / u_steps);',
  flood: `
    vec2 size = grid(), tile = floor(uv * size), center = floor(u_anchor * size);
    float radius = length((tile - center) / size);
    float total = length(max(u_anchor, 1.0 - u_anchor));
    return swapAt(uv, min(0.995, 0.84 * radius / total + 0.16 * hash(tile)));`,
  spiral: `
    float size = max(3.0, floor(min(u_size.x, u_size.y) / u_cells));
    size = 2.0 * floor(size * 0.5) + 1.0;
    vec2 tile = floor(uv * size) - floor(size * 0.5);
    float ring = max(abs(tile.x), abs(tile.y));
    float offset = tile.y == ring ? tile.x + ring :
      tile.x == ring ? 3.0 * ring - tile.y :
      tile.y == -ring ? 5.0 * ring - tile.x : 7.0 * ring + tile.y;
    float side = 2.0 * ring + 1.0;
    float index = side * side - 1.0 - offset;
    return swapAt(uv, 1.0 - (index + 0.5) / (size * size));`,
  scan: 'return swapAt(uv, (floor((1.0 - uv.y) * u_size.y) + 0.5) / u_size.y);',
  pixel: `
    if (u_value <= 0.0) return sourceFrom(uv);
    if (u_value >= 1.0) return sourceTo(uv);
    float block = 1.0 + floor(max(0.0, sin(u_value * 3.14159265359)) * (u_cells - 1.0));
    vec2 coord = (floor(uv * u_size / block) + 0.5) * block / u_size;
    return u_value < 0.5 ? sourceFrom(coord) : sourceTo(coord);`,
  dither: `
    ivec2 pt = ivec2(floor(uv * u_size / u_cells));
    const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float rank = (bayer[(pt.x & 3) + (pt.y & 3) * 4] + 0.5) / 16.0;
    return swapAt(uv, rank);`,
  colors: `
    vec4 a = sourceFrom(uv);
    float brightness = u_direction.x < 0.0 ? 1.0 - luma(a.rgb) : luma(a.rgb);
    vec3 quant = floor(a.rgb * 7.999);
    float bucket = floor(brightness * (u_steps - 1.0)) + 0.76 * hash(quant.rg + vec2(17.0, 7.0) * quant.b);
    return mix(a, sourceTo(uv), reveal((bucket + 0.12) / u_steps));`,
  strips: `
    float band = mod(floor(uv.y * u_bands), 2.0);
    float x = uv.x + (band * 2.0 - 1.0) * u_value;
    return x < 0.0 || x >= 1.0 ? sourceTo(uv) : sourceFrom(vec2(x, uv.y));`,
  rush: `
    float lane = floor(uv.y * u_bands);
    float speed = 0.55 + hash(vec2(lane, 27.0)) * 0.65;
    float x = uv.x + u_value * speed * 1.9;
    vec4 base = x >= 1.0 ? sourceTo(uv) : sourceFrom(vec2(x, uv.y));
    float streak = step(0.65, hash(vec2(lane, 12.0))) * step(0.82, fract(x * 3.0));
    return mix(base, vec4(vec3(0.86, 0.91, 1.0), 1.0), streak * sin(u_value * 3.14159265) * u_strength);`,
  exposure: `
    vec4 a = sourceFrom(uv);
    vec3 bright = min(vec3(1.0), a.rgb * (1.0 + 3.0 * u_value));
    return mix(vec4(bright, a.a), sourceTo(uv), u_value * u_value);`,
  palette: `
    vec4 a = sourceFrom(uv);
    vec3 shadow = vec3(0.10, 0.06, 0.27), light = vec3(0.92, 0.57, 0.76);
    float level = floor(luma(a.rgb) * u_steps) / u_steps;
    vec3 shifted = mix(shadow, light, level);
    shifted = mix(shifted, u_color.rgb, 0.24);
    return vec4(mix(a.rgb, shifted, u_value * u_strength), a.a);`,
  era: `
    float band = floor(uv.y * u_bands);
    float rank = (mod(band, 2.0) + uv.y) * 0.5;
    return swapAt(uv, rank);`,
  threat: `
    vec4 a = sourceFrom(uv), b = sourceTo(uv);
    float local = 1.0 - smoothstep(u_width * 0.75, u_width, length(metric(uv - u_anchor)));
    float subject = u_hasMask != 0 ? maskAt(uv) : local;
    float holdThreat = (1.0 - smoothstep(0.50, 1.0, u_value)) * subject;
    float visible = 1.0 - reveal(1.0 - aperture(uv, false));
    return mix(b, a, max(visible, holdThreat));
  `,
  afterimage: `
    vec4 ghost = sourceFrom(uv), destination = sourceTo(uv);
    float mask = u_hasMask != 0 ? maskAt(uv) : 1.0 - smoothstep(u_width * 0.55, u_width, length(metric(uv - u_anchor)));
    return mix(destination, ghost, mask * (1.0 - u_value) * u_strength);`,
  ripple: `
    if (u_value <= 0.0) return sourceFrom(uv);
    if (u_value >= 1.0) return sourceTo(uv);
    float q = axisRank(uv, u_direction), wave = q - u_value;
    float displaced = sin(wave * u_bands) * exp(-abs(wave) * 16.0) * u_strength * sin(u_value * 3.14159265);
    vec2 at = uv - vec2(u_direction.y, -u_direction.x) * displaced;
    return mix(sourceFrom(at), sourceTo(at), reveal(q));`,
  ink: `
    vec2 q = metric(uv), extent = metric(vec2(1.0));
    float distance = 2.0;
    for (int i = 0; i < 8; ++i) {
      vec2 pt = vec2(hash(vec2(i, 1)), hash(vec2(i, 2))) * extent;
      if (i == 0) pt = metric(u_anchor);
      distance = min(distance, length((q - pt) / extent) * (0.72 + 0.52 * hash(vec2(i, 3))));
    }
    float ragged = hash(floor(uv * u_size / u_cells)) * 0.105;
    return swapAt(uv, clamp(distance * 1.43 + ragged, 0.002, 0.998));`
};

export const transitionShaders = Object.freeze(Object.keys(bodies));

export function transitionFragment({ source, uniforms = '' }) {
  return prelude + '\n' + uniforms + '\nvec4 transition(vec2 uv) {\n' + source +
    '\n}\nvoid main() { outColor = transition(v_uv); }\n';
}

export function builtinTransitionFragment(name) {
  return Object.hasOwn(bodies, name) ? transitionFragment({ source: bodies[name] }) : undefined;
}
