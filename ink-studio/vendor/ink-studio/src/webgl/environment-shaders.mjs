export const fogLimit = 16;

const rays = `
uniform vec3 u_envEye, u_envRight, u_envUp, u_envBack;
uniform vec4 u_envCamera; // tangent, aspect, orthographic, eye setback
uniform vec2 u_envSkyView;
uniform float u_envHorizon;
vec2 envScreen(vec2 pixel, vec2 size) { return 2.0 * pixel / size - 1.0; }
vec3 envOffset(vec2 p) { return p.x * u_envRight + p.y * u_envUp; }
vec3 envSkyRay(vec2 pixel, vec2 size) {
  return normalize(envOffset(envScreen(pixel,size) * u_envSkyView) - u_envBack);
}
`;

const data = `
uniform highp sampler2D u_envData;
vec4 envRow(int index) {
  return texelFetch(u_envData, ivec2(index & 63, index >> 6), 0);
}
`;

export function environmentMediaSource(lighting=false){ return rays + data + (lighting?`uniform highp sampler3D u_eFogField;uniform vec3 u_eFogMin,u_eFogExtent,u_eFogSize;vec3 eFogLight(vec3 p){vec3 uv=(clamp((p-u_eFogMin)/u_eFogExtent,vec3(0),vec3(1))*(u_eFogSize-1.0)+.5)/u_eFogSize;return texture(u_eFogField,uv).rgb;}`:'') + `
uniform int u_envFogCount, u_envCardSize;
uniform int u_envPaletteFog, u_envPaletteStart, u_envPaletteCard;
vec3 envPalette(vec3 base, int index, vec4 signals) {
  if (index < 0) return base;
  vec4 field = envRow(index);
  if (field.x < 0.5) return base;
  vec4 transfer = envRow(index+1);
  float value = clamp((signals[int(field.y)]-field.z)/field.w,0.0,1.0);
  int first = int(transfer.x), count = int(transfer.y);
  if (field.x < 1.5) {
    for (int i=32; i>=0; i--) {
      if (i >= count) continue;
      vec4 stop = envRow(first+i);
      if (value >= stop.w) return mix(base,stop.rgb,transfer.z);
    }
    return base;
  }
  return mix(base,envRow(first+int(floor(value*float(count-1)+0.5))).rgb,transfer.z);
}
uniform highp sampler2D u_envCard, u_envCloudLight;
uniform float u_envBands, u_envCloudHardness;
float envBand(float value) {
  return u_envBands > 1.0 ? floor(clamp(value,0.0,1.0)*(u_envBands-1.0)+0.5)/(u_envBands-1.0) : value;
}
uniform vec4 u_envCardFrame, u_envCloudStyle, u_envCloudDomain, u_envCloudHeight;
uniform vec3 u_envCardRight, u_envCardUp, u_envCardNormal, u_envCloudRGB, u_envCloudSun, u_envCloudLightRGB;

bool envSlab(inout vec2 hit, float pos, float dir, float lo, float hi) {
  if (abs(dir) < 1e-10) return pos > lo && pos < hi;
  vec2 a = (vec2(lo,hi) - pos) / dir;
  hit = vec2(max(hit.x,min(a.x,a.y)),min(hit.y,max(a.x,a.y)));
  return hit.y > hit.x;
}
bool envRadial(inout vec2 hit, float a, float b, float c) {
  if (a < 1e-10) return c < 0.0;
  float delta = b*b - a*c;
  if (delta <= 0.0) return false;
  float r = sqrt(delta);
  hit = vec2(max(hit.x,(-b-r)/a),min(hit.y,(-b+r)/a));
  return hit.y > hit.x;
}
bool envFogInterval(vec3 origin, vec3 ray, float stop, int index, out vec2 hit) {
  vec4 first = envRow(index), second = envRow(index+1), range = envRow(index+3);
  hit = vec2(range.x,min(range.y,stop));
  if (hit.y <= hit.x) return false;
  if (first.w < 0.5) return envSlab(hit,origin.y,ray.y,first.y,second.y);
  if (first.w < 1.5) return envSlab(hit,origin.x,ray.x,first.x,second.x) &&
    envSlab(hit,origin.y,ray.y,first.y,second.y) && envSlab(hit,origin.z,ray.z,first.z,second.z);
  vec3 offset = origin-first.xyz;
  if (first.w < 2.5) return envRadial(hit,1.0,dot(offset,ray),dot(offset,offset)-range.z*range.z);
  float p = dot(offset,second.xyz), d = dot(ray,second.xyz);
  return envSlab(hit,p,d,0.0,second.w) &&
    envRadial(hit,1.0-d*d,dot(offset,ray)-p*d,dot(offset,offset)-p*p-range.z*range.z);
}
vec4 envFog(vec3 origin, vec3 ray, float stop, float setback) {
  const int budget = ${2*fogLimit};
  vec2 events[budget];
  int n = 0;
  for (int i=0; i<${fogLimit}; i++) {
    if (i >= u_envFogCount) break;
    vec2 hit;
    if (envFogInterval(origin,ray,stop,4*i,hit)) {
      events[n++] = vec2(hit.x,float(i+1));
      events[n++] = vec2(hit.y,-float(i+1));
    }
  }
  for (int i=1; i<budget; i++) {
    if (i >= n) break;
    vec2 value = events[i];
    int j = i;
    for (; j>0; j--) {
      if (events[j-1].x <= value.x) break;
      events[j] = events[j-1];
    }
    events[j] = value;
  }
  vec4 result = vec4(0,0,0,1), medium = vec4(0);
  ${lighting?'vec3 luminous=vec3(0);':''}
  float last = 0.0;
  int fieldMask = 0;
  float rateFloor = n > 0 ? (events[n-1].x-events[0].x)/64.0 : 0.0;
  for (int i=0; i<budget; i++) {
    if (i >= n) break;
    vec2 event = events[i];
    if (medium.a > 1e-10 && event.x > last) {
      if (fieldMask != 0) {
        float stepSize = event.x-last;
        for (int v=0; v<${fogLimit}; v++) {
          if ((fieldMask & (1 << v)) != 0) stepSize = min(stepSize,envRow(u_envPaletteStart+v*2+1).w);
        }
        stepSize = max(stepSize, max(rateFloor,1e-5));
        for (int j=0; j<64; j++) {
          float from = last+float(j)*stepSize;
          if (from >= event.x) break;
          float distance = min(stepSize,event.x-from), depth = from+distance*0.5;
          vec3 point = origin+ray*depth, color = medium.rgb;
          ${lighting?'vec3 litColor=luminous;':''}
          for (int v=0; v<${fogLimit}; v++) {
            if ((fieldMask & (1 << v)) == 0) continue;
            vec4 source = envRow(v*4+2);
            vec3 tint = envPalette(source.rgb,u_envPaletteStart+v*2,vec4(max(0.0,depth-setback),point.y,0.0,0.0));
            vec3 change = (tint-source.rgb)*source.a;
            color += change;
            ${lighting?'if(envRow(v*4+3).w>.5)litColor+=change;':''}
          }
          ${lighting?'if(dot(litColor,vec3(1))>0.0)color+=litColor*(eFogLight(point)-1.0);':''}
          float alpha = 1.0-exp(-medium.a*distance);
          result.rgb += result.a*alpha*color/medium.a;
          result.a *= 1.0-alpha;
        }
      } else {
      ${lighting?`if(dot(luminous,vec3(1))>0.0){
        float ds=(event.x-last)/4.0,alpha=1.0-exp(-medium.a*ds);
        for(int j=0;j<4;j++){vec3 p=origin+ray*(last+(float(j)+.5)*ds);vec3 light=eFogLight(p);
          result.rgb+=result.a*alpha*(medium.rgb-luminous+luminous*light)/medium.a;result.a*=1.0-alpha;}
      }else{`:''}
      float alpha = 1.0-exp(-medium.a*(event.x-last));
      result.rgb += result.a * alpha * medium.rgb / medium.a;
      result.a *= 1.0-alpha;
      ${lighting?'}':''}
      }
    }
    int volumeIndex = int(abs(event.y))-1;
    if (u_envPaletteFog != 0 && envRow(u_envPaletteStart+volumeIndex*2).x > 0.5) {
      int bit = 1 << volumeIndex;
      if (event.y > 0.0) fieldMask |= bit;
      else fieldMask &= ~bit;
    }
    vec4 volume = envRow(4*volumeIndex+2);
    medium += sign(event.y)*vec4(volume.rgb*volume.a,volume.a);
    ${lighting?'if(envRow(4*(int(abs(event.y))-1)+3).w>.5)luminous+=sign(event.y)*volume.rgb*volume.a;':''}
    last = event.x;
  }
  if (u_envBands > 1.0 && result.a < 1.0) {
    float alpha = 1.0-result.a, styled = envBand(alpha);
    result = vec4(result.rgb*(styled/alpha),1.0-styled);
  }
  return result;
}
vec3 envCardTexel(ivec2 p) {
  if (any(lessThan(p,ivec2(0))) || any(greaterThanEqual(p,ivec2(u_envCardSize)))) return vec3(0);
  return texelFetch(u_envCard,p,0).rgb;
}
float envLightTexel(ivec2 p) {
  if (any(lessThan(p,ivec2(0))) || any(greaterThanEqual(p,textureSize(u_envCloudLight,0)))) return 0.0;
  return texelFetch(u_envCloudLight,p,0).r;
}
float envCone(vec2 point) {
  vec2 xy = (point-u_envCloudDomain.xy)/u_envCloudDomain.zw - 0.5;
  ivec2 p = ivec2(floor(xy));
  vec2 f = fract(xy);
  return mix(mix(envLightTexel(p),envLightTexel(p+ivec2(1,0)),f.x),
    mix(envLightTexel(p+ivec2(0,1)),envLightTexel(p+ivec2(1)),f.x),f.y);
}
vec4 envCard(vec3 origin, vec3 ray, float start, float stop) {
  if (u_envCardSize == 0) return vec4(0,0,0,1);
  float d = -dot(ray,u_envCardNormal);
  if (d <= 1e-8) return vec4(0,0,0,1);
  vec3 delta = u_envCardFrame.xyz-origin;
  float plane = -dot(delta,u_envCardNormal)/d;
  vec3 point = plane*ray-delta;
  vec2 uv = (0.5 + 0.5*vec2(dot(point,u_envCardRight),dot(point,u_envCardUp))/u_envCardFrame.w)*float(u_envCardSize)-0.5;
  ivec2 p = ivec2(floor(uv));
  vec2 f = fract(uv);
  vec3 texel = mix(mix(envCardTexel(p),envCardTexel(p+ivec2(1,0)),f.x),
    mix(envCardTexel(p+ivec2(0,1)),envCardTexel(p+ivec2(1)),f.x),f.y);
  if (texel.x <= 0.0) return vec4(0,0,0,1);
  vec2 span = plane + texel.yz/(texel.x*d);
  vec2 clip = vec2(max(start,span.x),min(stop,span.y));
  if (clip.y <= clip.x) return vec4(0,0,0,1);
  float mass = texel.x*(clip.y-clip.x)/((span.y-span.x)*d);
  float coverage = 1.0-exp(-mass), hardness = u_envCloudHardness;
  if (hardness > 0.5) coverage = clamp(0.5+(coverage-0.5)*(1.0+(hardness-0.5)*13.0),0.0,1.0);
  else if (hardness < 0.5) coverage = mix(coverage,acos(1.0-2.0*coverage)/3.14159265359,1.0-2.0*hardness);
  float alpha = u_envCloudHeight.z*coverage;
  vec3 at = origin + ray * (0.5*(clip.x+clip.y));
  float brightness = 0.0, density = coverage;
  if (u_envCloudHeight.w > 0.0) {
    float y = clamp((at.y-u_envCloudHeight.x)/u_envCloudHeight.y,0.0,1.0);
    density = envCone(at.xz);
    float rim = pow(max(0.0,dot(u_envCloudSun,ray)),12.0);
    float up = envCone(at.xz+u_envCloudSun.xz*u_envCloudHeight.w);
    float relief = clamp(0.52 + 1.45*(density-up),0.0,1.0);
    float light = clamp(u_envCloudStyle.x + u_envCloudStyle.w *
      (u_envCloudStyle.y*(0.24+0.76*relief)*(0.48+0.52*y)+u_envCloudStyle.z*rim),0.0,1.0);
    brightness = light*(0.49+0.51*exp(-mass*0.58));
  }
  vec3 color = envPalette(u_envCloudRGB,u_envPaletteCard,vec4(0.0,at.y,density,brightness));
  color = mix(color,u_envCloudLightRGB,brightness);
  return vec4(alpha*color,1.0-alpha);
}
vec3 envMedia(vec3 color, vec2 pixel, vec2 size, float axialDepth) {
  if (u_envFogCount == 0 && u_envCardSize == 0) return color;
  bool ortho = u_envCamera.z > 0.5;
  vec2 screen = envScreen(pixel,size) * u_envCamera.xy;
  vec3 offset = envOffset(screen);
  float axial = ortho ? 1.0 : inversesqrt(1.0+dot(screen,screen));
  vec3 origin = ortho ? u_envEye+offset : u_envEye;
  vec3 ray = ortho ? -u_envBack : (offset-u_envBack)*axial;
  float stop = min(axialDepth,u_envHorizon)/axial;
  if (u_envCardSize > 0) {
    vec4 card = envCard(origin,ray,u_envCamera.w,stop);
    color = card.rgb + card.a*color;
  }
  if (u_envFogCount > 0) {
    vec4 fog = envFog(origin,ray,stop,u_envCamera.w/axial);
    color = fog.rgb + fog.a*color;
  }
  return color;
}
`;}
export const environmentMediaGLSL=environmentMediaSource();


const sky = `
uniform int u_envHasSky, u_envSkySplats, u_envSkyStart, u_envBackdropSampled;
uniform highp sampler2D u_envBackdrop;
uniform vec3 u_envBackground, u_envZenith, u_envSkyHorizon, u_envGround, u_envSun, u_envSunRGB;
uniform vec3 u_envSunParams;
vec3 envBackdrop(vec2 pixel, vec2 size) {
  if (u_envBackdropSampled == 1) {
    vec2 pos = pixel * vec2(textureSize(u_envBackdrop,0)) / size;
    return texelFetch(u_envBackdrop,ivec2(pos),0).rgb;
  }
  if (u_envHasSky == 0) return u_envBackground;
  vec3 ray = envSkyRay(pixel,size);
  float y = ray.y, angle = dot(ray,u_envSun);
  float fade = envBand(y > 0.0 ? sqrt(y) : clamp(-y*3.0,0.0,1.0));
  float disk = y >= 0.0 ? 0.92*clamp((angle-u_envSunParams.x)/max(1e-8,u_envSunParams.y-u_envSunParams.x),0.0,1.0) : 0.0;
  float glow = angle > 0.0 && y >= 0.0 ? 0.22*exp(-19.0*(1.0-angle)) : 0.0;
  vec3 color = mix(mix(u_envSkyHorizon,y > 0.0 ? u_envZenith : u_envGround,fade),u_envSunRGB,
    clamp((disk+glow)*u_envSunParams.z,0.0,1.0));
  for (int i=0; i<u_envSkySplats; i++) {
    int at = u_envSkyStart + i*4;
    vec4 n = envRow(at), r = envRow(at+1), u = envRow(at+2), s = envRow(at+3);
    float z = dot(ray,n.xyz);
    if (z <= 0.0) continue;
    vec2 q = vec2(dot(ray,r.xyz),dot(ray,u.xyz))/(z*vec2(r.w,u.w));
    float d = dot(q,q);
    if (d < 9.0) color = mix(color,s.rgb,n.w*exp(-0.5*d));
  }
  return color;
}
`;

export const environmentBackgroundGLSL = environmentMediaGLSL + sky;
export const environmentBackgroundSource=(lighting=false)=>environmentMediaSource(lighting)+sky;
export const environmentBackgroundShader = (layeredGlass,lighting=false) => `#version 300 es
precision highp float; precision highp int;
${environmentMediaSource(lighting)+sky}
uniform vec2 u_envViewport;
layout(location=0) out vec4 scene;
layout(location=1) out vec4 depth;
${layeredGlass ? 'layout(location=2) out vec4 back; layout(location=3) out vec4 through;' : ''}
void main() {
  scene = vec4(envMedia(envBackdrop(gl_FragCoord.xy,u_envViewport),gl_FragCoord.xy,u_envViewport,u_envHorizon),1);
  depth = vec4(1,0,0,1);
  ${layeredGlass ? 'back = scene; through = vec4(1);' : ''}
}`;
