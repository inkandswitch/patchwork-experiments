
// The toolkit also exposes this source through its browser bundle. Keep the
// module entry usable by hosts that import only the WebGL shader builders.
const fallbackCoverage = `
float contributionAlpha(float power, float density, bool solid) {
  if (power > 0.0 || power < -4.5) return 0.0;
  float g = density * exp(power);
  return solid ? 0.99 * smoothstep(0.38, 0.62, g) : min(0.99, g);
}`;

export const coverageSource = shared => shared?.glsl ?? fallbackCoverage;
export const policyUniforms = `
uniform highp sampler2D u_constraintSlots, u_constraintRows;
uniform int u_constraintDefault, u_constraintMap, u_constraintLab, u_constraintPairs;
int contributionSlot(int index) {
  int span = textureSize(u_constraintSlots, 0).x * 4;
  int slot = int(texelFetch(u_constraintSlots, ivec2((index % span) / 4, index / span), 0)[index & 3]);
  return slot > 0 ? slot : u_constraintDefault;
}
`;

export const maskUniforms = `
uniform int u_constraintMask;
vec4 maskSettings(int slot) { return texelFetch(u_constraintRows, ivec2(u_constraintMask, slot - 1), 0); }
`;
export const maskVaryings = textured => `
flat LOOK_IO vec4 v_maskCenter;
flat LOOK_IO vec3 v_maskNormal;
flat LOOK_IO vec3 v_maskAxis;
${textured ? 'flat LOOK_IO vec4 v_maskSecond;' : ''}
`;

export const maskFragment = textured => `
uniform vec2 u_lookViewport;
uniform mat4 u_lookProjection;
uniform float u_lookOrtho, u_lookRadius;
${textured ? 'uniform highp sampler2D u_maskTextures; uniform float u_maskTime;' : ''}
float maskAt(int slot) {
  vec4 settings = maskSettings(slot);
  if (settings.x == 0.0) return 1.0;
  vec2 screen = (gl_FragCoord.xy * 2.0 / u_lookViewport - 1.0) /
    vec2(u_lookProjection[0][0], u_lookProjection[1][1]);
  vec3 center = v_maskCenter.xyz;
  vec3 ray = vec3(u_lookOrtho > 0.5 ? vec2(0.0) : screen, -1.0);
  vec3 at = vec3(screen * (u_lookOrtho > 0.5 ? 1.0 : -center.z), center.z);
  float facing = dot(v_maskNormal, ray);
  vec3 offset = vec3(0.0);
  if (abs(facing) > 1e-7) {
    float advance = dot(v_maskNormal, center - at) / facing;
    if (abs(advance) <= u_lookRadius && -center.z + advance > 0.0)
      offset = at + advance * ray - center;
  }
  vec4 limits = texelFetch(u_constraintRows, ivec2(u_constraintMask + 2, slot - 1), 0);
  float scalar = v_maskCenter.w + dot(v_maskAxis, offset);
  ${textured ? `if (settings.x == 2.0) {
    vec2 uv = vec2(scalar,v_maskSecond.w + dot(v_maskSecond.xyz,offset));
    if (limits.w == 0.0 && (any(lessThan(uv,vec2(0))) || any(greaterThanEqual(uv,vec2(1))))) scalar=0.0;
    else {
      vec4 dim=texelFetch(u_constraintRows,ivec2(u_constraintMask+4,slot-1),0);
      bool repeat=texelFetch(u_constraintRows,ivec2(u_constraintMask+5,slot-1),0).x > 0.0;
      int frame=int(max(0.0,floor(u_maskTime*dim.w)));
      frame=repeat ? frame%int(dim.z) : min(frame,int(dim.z)-1);
      ivec2 pixel=ivec2(floor(fract(uv)*dim.xy));
      int at=int(limits.z)+(frame*int(dim.y)+pixel.y)*int(dim.x)+pixel.x;
      int width=textureSize(u_maskTextures,0).x;
      scalar=texelFetch(u_maskTextures,ivec2(at%width,at/width),0).r;
    }
  }` : ''}
  float f = clamp((scalar - limits.x) * limits.y, 0.0, 1.0);
  if (settings.z == 1.0) f = f * f * (3.0 - 2.0 * f);
  if (settings.z == 2.0) f = step(1.0, f);
  return settings.w > 0.0 ? 1.0 - f : f;
}
`;

export const maskVertex = textured => `
uniform highp sampler2D u_lookSites;
void placeMask(int index, int slot, vec3 posed, vec3 viewCenter, mat3 worldToRest, mat3 view) {
  v_maskCenter = vec4(viewCenter, 0.0);
  v_maskNormal = vec3(0.0);
  v_maskAxis = vec3(0.0);
  ${textured ? 'v_maskSecond = vec4(0.0);' : ''}
  if (slot == 0) return;
  vec4 settings = maskSettings(slot);
  if (settings.x == 0.0) return;
  ivec2 uv = ivec2((index & 511) * 2, index >> 9);
  vec3 normal = texelFetch(u_lookSites, uv, 0).xyz;
  vec3 rest = texelFetch(u_lookSites, uv + ivec2(1,0), 0).xyz;
  vec4 axis = texelFetch(u_constraintRows, ivec2(u_constraintMask + 1, slot - 1), 0);
  v_maskNormal = view * transpose(worldToRest) * normal;
  v_maskAxis = view * (settings.y > 0.0 ? transpose(worldToRest) * axis.xyz : axis.xyz);
  vec3 point=settings.y > 0.0 ? rest : posed;
  v_maskCenter.w = dot(point, axis.xyz) + axis.w;
  ${textured ? `if (settings.x == 2.0) {
    vec4 second=texelFetch(u_constraintRows,ivec2(u_constraintMask+3,slot-1),0);
    v_maskSecond=vec4(view*(settings.y > 0.0 ? transpose(worldToRest)*second.xyz : second.xyz),dot(point,second.xyz)+second.w);
  }` : ''}
}
`;

export const ownerMaskWrite = `
    float m = floor(maskAt(v_policySlot) * 65535.0 + 0.5);
    od = vec4(mod(m,256.0), floor(m/256.0), 0.0, 255.0) / 255.0;
`;
