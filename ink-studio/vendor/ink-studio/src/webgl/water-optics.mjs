import { environmentBackgroundGLSL,environmentBackgroundSource } from './environment-shaders.mjs';

// Exact ray intervals through the published water columns. Distance is in
// world units, independently of perspective, ortho, and the scene depth ramp.
export const waterGLSL = (airPockets, layered, atlas) => `
${airPockets ? '#define WATER_AIR_POCKETS' : ''}
uniform highp sampler2D u_waterData;
uniform int u_waterCount;
${layered ? '#define WATER_LAYERED' : ''}
${atlas ? '#define WATER_ATLAS' : ''}
#if defined(WATER_LAYERED) || defined(WATER_ATLAS)
precision highp int;
#endif
#ifdef WATER_ATLAS
uniform int u_waterNodeCount, u_waterBodyBase, u_waterStyleBase;
vec4 waterTexel(int i) {
  int width = textureSize(u_waterData, 0).x;
  return texelFetch(u_waterData, ivec2(i % width, i / width), 0);
}
#else
#ifdef WATER_LAYERED
uniform int u_waterSpanMode[8];
#endif
uniform vec4 u_waterMin[8], u_waterMax[8], u_waterGrid[8];
uniform vec4 u_waterTint[8], u_waterLoss[8], u_waterHighlight[8];
#endif

struct WaterStyle {
  vec4 tint, loss, highlight;
  int index;
  #ifdef WATER_ATLAS
  vec4 deep, sediment, depth;
  #else
  float refraction;
  #endif
};
WaterStyle readWaterStyle(int i) {
  #ifdef WATER_ATLAS
  int at = u_waterStyleBase + i * 6;
  return WaterStyle(waterTexel(at), waterTexel(at + 1), waterTexel(at + 2), i,
    waterTexel(at + 3), waterTexel(at + 4), waterTexel(at + 5));
  #else
  return WaterStyle(u_waterTint[i], u_waterLoss[i], u_waterHighlight[i], i, u_waterMax[i].w);
  #endif
}
uniform mat4 u_waterView;
uniform vec3 u_waterEye;
uniform vec3 u_waterCamera;
uniform vec4 u_arrivalPlane;
uniform float u_waterTime, u_waterWindGain;

// Captures reuse the same body/style index in the column and atlas layouts.
uniform sampler2D u_waterReflections;
uniform int u_waterReflectionBase, u_waterReflectionCount;
uniform vec4 u_waterReflectionActive, u_waterReflectionHeights;
uniform vec2 u_waterReflectionGrid, u_waterReflectionViewport;
uniform mat4 u_waterProjection;
vec3 waterReflectedColor(WaterStyle style, vec3 p, vec2 ripple) {
  if (u_waterReflectionCount == 0) return style.highlight.rgb;
  int offset = u_waterReflectionBase + style.index;
  int width = textureSize(u_waterData, 0).x;
  vec3 binding = texelFetch(u_waterData, ivec2(offset % width, offset / width), 0).xyz;
  int slot = int(binding.x) - 1;
  if (slot < 0 || u_waterReflectionActive[slot] == 0.0 || abs(p.y-u_waterReflectionHeights[slot]) > 0.002) return style.highlight.rgb;
  vec4 clip = u_waterProjection * u_waterView * vec4(p, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  vec2 normal = (mat3(u_waterView) * vec3(ripple.x, 0.0, ripple.y)).xy;
  uv += binding.y * normal / u_waterReflectionViewport;
  vec2 tile = vec2(slot % 2, slot / 2), size = vec2(textureSize(u_waterReflections, 0)) / u_waterReflectionGrid;
  vec2 edge = 0.5 / size;
  vec2 at = (tile + clamp(uv, edge, 1.0-edge)) / u_waterReflectionGrid;
  vec3 reflected = texture(u_waterReflections, at).rgb;
  if (binding.z > 0.0) {
    vec2 blur = binding.z / u_waterReflectionViewport;
    reflected *= 0.4;
    reflected += texture(u_waterReflections,(tile+clamp(uv+vec2(blur.x,0),edge,1.0-edge))/u_waterReflectionGrid).rgb * 0.15;
    reflected += texture(u_waterReflections,(tile+clamp(uv-vec2(blur.x,0),edge,1.0-edge))/u_waterReflectionGrid).rgb * 0.15;
    reflected += texture(u_waterReflections,(tile+clamp(uv+vec2(0,blur.y),edge,1.0-edge))/u_waterReflectionGrid).rgb * 0.15;
    reflected += texture(u_waterReflections,(tile+clamp(uv-vec2(0,blur.y),edge,1.0-edge))/u_waterReflectionGrid).rgb * 0.15;
  }
  return reflected * style.highlight.rgb;
}

bool waterSlab(inout vec2 interval, float p, float d, float low, float high) {
  if (abs(d) < 1e-8) return p >= low && p < high;
  vec2 times = (vec2(low, high) - p) / d;
  interval = vec2(max(interval.x, min(times.x, times.y)), min(interval.y, max(times.x, times.y)));
  return interval.x < interval.y;
}

#ifdef WATER_AIR_POCKETS
uniform int u_waterAirCount;
uniform vec4 u_waterAirMin[8], u_waterAirMax[8];

bool airSlab(inout vec2 interval, float p, float d, float low, float high) {
  if (abs(d) < 1e-8) return p > low && p < high;
  return waterSlab(interval, p, d, low, high);
}

bool inAir(float t, vec2 air[8], int count) {
  for (int i = 0; i < 8; i++) {
    if (i >= count || air[i].x > t) break;
    if (t < air[i].y) return true;
  }
  return false;
}

float wetLength(vec2 wet, vec2 air[8], int count) {
  float remaining = wet.y - wet.x;
  float cursor = wet.x;
  for (int i = 0; i < 8; i++) {
    if (i >= count || air[i].x >= wet.y) break;
    float a = max(cursor, air[i].x), b = min(wet.y, air[i].y);
    if (b > a) {
      remaining -= b - a;
      cursor = b;
    }
  }
  return max(0.0, remaining);
}
#endif

void waterSurface(int body, vec3 p, vec3 ray, vec4 column, WaterStyle style, inout vec3 light, inout vec3 through,
                  inout vec3 mark) {
  vec4 highlight = style.highlight;
  vec2 flow = clamp(column.zw, vec2(-4.0), vec2(4.0));
  vec2 position = p.xz - flow * (u_waterTime * 0.25);
  vec2 phase = vec2(dot(position, vec2(3.1, 1.9)), dot(position, vec2(-1.7, 4.4))) +
    u_waterTime * vec2(2.0, -1.6);
  vec2 ripple = sin(phase);
  float grazing = pow(max(0.0, 1.0 - abs(ray.y)), 3.0);
  float foam = (1.0 - smoothstep(0.05, 0.4, column.y - column.x)) *
    smoothstep(0.08, 0.73, (ripple.x + ripple.y) * 0.5) * style.tint.w;
  float reflection = highlight.w * (0.16 + 0.84 * grazing);
  if (highlight.w < 0.0) {
    float f0 = -1.0 - highlight.w;
    reflection = f0 > 0.0 ? f0 + (1.0 - f0) * pow(1.0 - abs(ray.y), 5.0) : 0.0;
  }
  float opacity = clamp(reflection + foam, 0.0, 1.0);
  light += through * mix(waterReflectedColor(style, p, ripple * (1.0 + u_waterWindGain)), vec3(0.9, 0.98, 0.94), foam) * opacity;
  through *= 1.0 - opacity;
  #ifdef WATER_ATLAS
  float refraction = style.deep.w;
  #else
  float refraction = style.refraction;
  #endif
  if (mark.x == 0.0 && refraction > 0.0) {
    vec2 shift = round(ripple * refraction);
    mark = vec3(1.0, float(body) / 255.0, ((shift.x + 4.0) + 9.0 * (shift.y + 4.0)) / 255.0);
  }
}

void waterInterval(int body, vec3 eye, vec3 ray, float limit, float start, float end,
                   vec4 column, bool exposed, bool layered, WaterStyle style, vec2 depthBounds,
                   #ifdef WATER_AIR_POCKETS
                   vec2 air[8], int airCount,
                   #endif
                   inout vec3 light, inout vec3 through, inout vec3 mark,
                   inout float caustic, inout bool surfaceSeen) {
  vec2 wet = vec2(start, end);
  bool horizontal = abs(ray.y) < 1e-8;
  bool inside = (eye.y > column.x || (layered && eye.y == column.x)) && eye.y < column.y;
  if (horizontal ? inside : waterSlab(wet, eye.y, ray.y, column.x, column.y)) {
    float top = horizontal ? -1.0 : (column.y - eye.y) / ray.y;
    bool surface = exposed && (layered || !surfaceSeen) && top >= start && top <= end && top < limit;
    float endpointY = eye.y + ray.y * limit;
    bool endpoint = wet.y == limit && (!layered || (exposed && endpointY >= column.x && endpointY < column.y));
    float distance = wet.y - wet.x;
    #ifdef WATER_AIR_POCKETS
    surface = surface && !inAir(top, air, airCount);
    endpoint = endpoint && !inAir(limit, air, airCount);
    distance = wetLength(wet, air, airCount);
    #endif
    if (surface && ray.y < 0.0)
      waterSurface(body, eye + ray * top, ray, column, style, light, through, mark);
    vec3 transmission = exp(-style.loss.rgb * distance);
    vec3 tint = style.tint.rgb;
    #ifdef WATER_ATLAS
    vec3 center = eye + ray * ((wet.x + wet.y) * 0.5);
    float deep = smoothstep(style.depth.x, style.depth.y, depthBounds.y - center.y);
    tint = mix(tint, style.deep.rgb, deep);
    if (style.sediment.w > 0.0) {
      vec3 drift = vec3(column.z, 0.03, column.w) * u_waterTime;
      vec3 grainPoint = (center - drift) * style.depth.w;
      vec3 bucket = floor(grainPoint), offset = fract(grainPoint) - 0.5;
      float grain = fract(sin(dot(bucket, vec3(2.13, 3.71, 5.73))) * 17368.429);
      float fleck = 1.0 - smoothstep(0.01, 0.19, dot(offset, offset));
      float nearBed = exp(-max(0.0, center.y - depthBounds.x) / style.depth.z);
      float grains = style.sediment.w * (0.22 + 0.78 * fleck * smoothstep(0.65, 0.97, grain)) *
        nearBed * (1.0 - exp(-1.8 * distance));
      light += through * style.sediment.rgb * grains;
      through *= 1.0 - grains * 0.65;
    }
    #endif
    light += through * (1.0 - transmission) * tint;
    through *= transmission;
    if (surface && ray.y > 0.0)
      waterSurface(body, eye + ray * top, ray, column, style, light, through, mark);
    surfaceSeen = surfaceSeen || surface;
    if (endpoint) {
      vec3 p = eye + ray * limit;
      float depth = column.y - p.y;
      vec2 xz = p.xz - clamp(column.zw, vec2(-4.0), vec2(4.0)) * (u_waterTime * 0.17);
      float a = sin(dot(xz, vec2(7.1, 3.8)) + u_waterTime * 2.1);
      float b = sin(dot(xz, vec2(-5.2, 6.4)) - u_waterTime * 1.7);
      caustic = smoothstep(0.78, 0.98, abs(a * b)) * exp(-max(0.0, depth) * 1.2) * style.loss.w;
    }
  }
}

void waterColumns(int body, vec3 eye, vec3 ray, float limit,
                  #ifdef WATER_AIR_POCKETS
                  vec2 air[8], int airCount,
                  #endif
                  inout vec3 light, inout vec3 through,
                  inout vec3 mark, inout float caustic) {
  #ifdef WATER_ATLAS
  int at = u_waterBodyBase + body * 4;
  vec4 low = waterTexel(at), high = waterTexel(at + 1), grid = waterTexel(at + 2);
  int styleId = int(high.w);
  #ifdef WATER_LAYERED
  bool layered = waterTexel(at + 3).x > 0.5;
  #endif
  WaterStyle style = readWaterStyle(styleId);
  #else
  vec4 low = u_waterMin[body], high = u_waterMax[body], grid = u_waterGrid[body];
  #ifdef WATER_LAYERED
  bool layered = u_waterSpanMode[body] == 1;
  #endif
  WaterStyle style = readWaterStyle(body);
  #endif
  vec2 range = vec2(0.0, limit);
  if (!waterSlab(range, eye.x, ray.x, low.x, high.x) ||
      !waterSlab(range, eye.z, ray.z, low.z, high.z)) return;
  vec2 origin = (eye.xz - low.xz) / grid.xy, direction = ray.xz / grid.xy;
  if (abs(ray.x) < 1e-8) direction.x = 0.0;
  if (abs(ray.z) < 1e-8) direction.y = 0.0;
  vec2 crossing = origin + direction * range.x;
  ivec2 count = ivec2(grid.zw), stepCell = ivec2(sign(direction));
  ivec2 cell = ivec2(floor(crossing));
  if (stepCell.x < 0 && crossing.x == floor(crossing.x)) cell.x--;
  if (stepCell.y < 0 && crossing.y == floor(crossing.y)) cell.y--;
  cell = clamp(cell, ivec2(0), count - 1);
  vec2 face = vec2(cell) + max(vec2(stepCell), 0.0);
  vec2 next = vec2(direction.x == 0.0 ? 1e30 : (face.x - origin.x) / direction.x,
                   direction.y == 0.0 ? 1e30 : (face.y - origin.y) / direction.y);
  vec2 stride = vec2(direction.x == 0.0 ? 0.0 : abs(1.0 / direction.x),
                     direction.y == 0.0 ? 0.0 : abs(1.0 / direction.y));
  float start = range.x;
  bool surfaceSeen = false;
  for (int cellStep = 0; cellStep < 128; cellStep++) {
    float end = max(start, min(range.y, min(next.x, next.y)));
    #ifdef WATER_ATLAS
    vec4 column = waterTexel(int(low.w) + cell.y * count.x + cell.x);
    #else
    vec4 column = texelFetch(u_waterData, cell + ivec2(0, int(low.w)), 0);
    #endif
    if (end > start) {
      #ifdef WATER_LAYERED
      if (layered) {
        int first = int(column.x), length = int(column.y);
        for (int i = 0; i < 32; i++) {
          if (i >= length) break;
          int slot = ray.y < 0.0 ? length - 1 - i : i;
          #ifdef WATER_ATLAS
          int offset = first + slot * 2;
          vec4 span = waterTexel(offset), info = waterTexel(offset + 1);
          bool exposed = info.y > 0.5;
          WaterStyle localStyle = style;
          if (int(info.x) != styleId) localStyle = readWaterStyle(int(info.x));
          vec2 depthBounds = info.zw;
          #else
          int width = textureSize(u_waterData, 0).x, offset = first + slot;
          int flags = int(slot < 16 ? column.z : column.w);
          bool exposed = (flags & (1 << (slot % 16))) != 0;
          vec4 span = texelFetch(u_waterData, ivec2(offset % width, offset / width), 0);
          WaterStyle localStyle = style;
          vec2 depthBounds = span.xy;
          #endif
          waterInterval(body, eye, ray, limit, start, end, span, exposed, true, localStyle, depthBounds,
            #ifdef WATER_AIR_POCKETS
            air, airCount,
            #endif
            light, through, mark, caustic, surfaceSeen);
        }
      } else
      #endif
      if (column.y > column.x) waterInterval(body, eye, ray, limit, start, end, column, true, false, style, column.xy,
        #ifdef WATER_AIR_POCKETS
        air, airCount,
        #endif
        light, through, mark, caustic, surfaceSeen);
    }
    if (end >= range.y) break;
    bvec2 crossFace = lessThanEqual(next, vec2(end));
    if (crossFace.x) { cell.x += stepCell.x; next.x += stride.x; }
    if (crossFace.y) { cell.y += stepCell.y; next.y += stride.y; }
    if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, count))) break;
    start = end;
  }
}

vec3 waterPaint(vec3 color, vec2 pixel, vec2 size, float axial, out vec3 mark) {
  mark = vec3(0);
  if (u_waterCount == 0 || axial <= 0.0) return color;
  vec2 plane = (pixel * 2.0 / size - 1.0) * u_waterCamera.xy;
  bool ortho = u_waterCamera.z > 0.5;
  mat3 basis = transpose(mat3(u_waterView));
  vec3 eye = u_waterEye + (ortho ? basis * vec3(plane, 0.0) : vec3(0));
  vec3 direction = basis * vec3(ortho ? vec2(0) : plane, -1.0);
  float rayScale = length(direction);
  vec3 ray = direction / rayScale;
  float limit = axial * rayScale;
  float startSide = dot(u_arrivalPlane, vec4(eye, 1.0));
  if (startSide < 0.0) {
    float into = dot(u_arrivalPlane.xyz, ray);
    if (into <= 0.0) return color;
    float entrance = -startSide / into;
    if (entrance >= limit) return color;
    eye += ray * entrance;
    limit -= entrance;
  }
  #ifdef WATER_AIR_POCKETS
  vec2 air[8];
  int airCount = 0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_waterAirCount) break;
    vec3 low = u_waterAirMin[i].xyz, high = u_waterAirMax[i].xyz;
    vec2 hit = vec2(0.0, 1e30);
    if (!airSlab(hit, eye.x, ray.x, low.x, high.x) || !airSlab(hit, eye.y, ray.y, low.y, high.y) ||
        !airSlab(hit, eye.z, ray.z, low.z, high.z) || hit.x >= limit) continue;
    int at = airCount;
    for (int j = 0; j < 8; j++) {
      if (at <= 0 || air[at - 1].x <= hit.x) break;
      air[at] = air[at - 1];
      at--;
    }
    air[at] = hit;
    airCount++;
  }
  #endif
  vec3 light = vec3(0), through = vec3(1);
  float caustic = 0.0;
  #ifdef WATER_ATLAS
  // Each hit uses a stackless BVH walk bounded by the next nearer entry.
  // Body interiors are disjoint, so its exit is the next search cursor.
  float cursor = 0.0;
  for (int j = 0; j < u_waterCount; j++) {
    int body = -1, node = 0;
    float first = limit, exit = limit;
    while (node < u_waterNodeCount) {
      vec4 low = waterTexel(node * 2), high = waterTexel(node * 2 + 1);
      vec2 hit = vec2(cursor, first);
      if (waterSlab(hit, eye.x, ray.x, low.x, high.x) &&
          waterSlab(hit, eye.y, ray.y, low.y, high.y) &&
          waterSlab(hit, eye.z, ray.z, low.z, high.z)) {
        if (high.w < 0.0) {
          node++;
          continue;
        }
        body = int(high.w);
        first = hit.x;
        // The search bound clips hit.y and must not clip the actual exit.
        vec2 extent = vec2(cursor, limit);
        waterSlab(extent, eye.x, ray.x, low.x, high.x);
        waterSlab(extent, eye.y, ray.y, low.y, high.y);
        waterSlab(extent, eye.z, ray.z, low.z, high.z);
        exit = extent.y;
      }
      node = int(low.w);
    }
    if (body < 0) break;
    waterColumns(body, eye, ray, limit,
      #ifdef WATER_AIR_POCKETS
      air, airCount,
      #endif
      light, through, mark, caustic);
    if (exit >= limit) break;
    cursor = exit;
  }
  #else
  float starts[8];
  for (int i = 0; i < 8; i++) {
    starts[i] = 1e30;
    if (i >= u_waterCount) break;
    vec3 low = u_waterMin[i].xyz, high = u_waterMax[i].xyz;
    vec2 hit = vec2(0.0, limit);
    if (waterSlab(hit, eye.x, ray.x, low.x, high.x) && waterSlab(hit, eye.y, ray.y, low.y, high.y) &&
        waterSlab(hit, eye.z, ray.z, low.z, high.z)) starts[i] = hit.x;
  }
  for (int j = 0; j < 8; j++) {
    int body = -1;
    float first = 1e30;
    for (int i = 0; i < 8; i++) {
      if (i >= u_waterCount) break;
      if (starts[i] < first) { body = i; first = starts[i]; }
    }
    if (body < 0) break;
    starts[body] = 1e30;
    waterColumns(body, eye, ray, limit,
      #ifdef WATER_AIR_POCKETS
      air, airCount,
      #endif
      light, through, mark, caustic);
  }
  #endif
  return light + through * mix(color, vec3(0.93, 1.0, 0.86), caustic);
}
`;

export const waterBackgroundShader = (airPockets, layered, atlas, environment, layeredGlass,emitterFog=false) => `#version 300 es
precision highp float;
${waterGLSL(airPockets, layered, atlas)}
uniform vec2 u_waterViewport;
uniform vec3 u_waterBackground;
${environment ? environmentBackgroundSource(emitterFog) : ''}
layout(location=0) out vec4 scene;
layout(location=1) out vec4 depth;
layout(location=2) out vec4 mask;
${layeredGlass ? 'layout(location=3) out vec4 back; layout(location=4) out vec4 through;' : ''}
void main() {
  vec3 mark;
  vec3 source = ${environment ? 'envBackdrop(gl_FragCoord.xy,u_waterViewport)' : 'u_waterBackground'};
  vec3 color = waterPaint(source,gl_FragCoord.xy,u_waterViewport,400.0,mark);
  ${environment ? 'color = envMedia(color,gl_FragCoord.xy,u_waterViewport,u_envHorizon);' : ''}
  scene = vec4(color,1);
  depth = vec4(1, 0, 0, 1);
  mask = vec4(mark, 1);
  ${layeredGlass ? 'back = scene; through = vec4(1);' : ''}
}`;
