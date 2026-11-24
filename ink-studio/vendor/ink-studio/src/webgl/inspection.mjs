// The scene depth never leaves the GPU. One tiny pass resolves all target probes.
export const inspectionDepth = Symbol('inspection depth capture');
const visibilityShader = `#version 300 es
precision highp float;
uniform sampler2D u_depth;
uniform vec4 u_probes[160];
uniform vec4 u_states[32];
out vec4 color;
void main(){
 int i=int(gl_FragCoord.x);float visible=0.0;
 for(int j=0;j<5;j++){
  if(float(j)>=u_states[i].z)break;
  vec4 p=u_probes[i*5+j];
  float depth=texture(u_depth,vec2(p.x,1.0-p.y)).r;
  visible+=float(u_states[i].y<.5||depth+p.w>=p.z);
 }
 color=vec4(vec3(visible/u_states[i].z*u_states[i].x),1);
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_scene,u_visibility,u_label,u_font;
uniform vec2 u_size,u_anchor;
uniform vec4 u_rect,u_labelRect,u_lens,u_crop,u_ripple;
uniform vec3 u_color;
uniform float u_width,u_corner,u_time,u_period;
uniform int u_slot,u_chars[64],u_count;
out vec4 color;
float segment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;float t=clamp(dot(p-a,d)/max(dot(d,d),.00001),0.0,1.0);return length(p-a-t*d);}
bool inside(vec2 p,vec4 r){return all(greaterThanEqual(p,r.xy))&&all(lessThan(p,r.xy+r.zw));}
void over(vec3 rgb,float a){color=vec4(rgb*a+color.rgb*(1.0-a),a+color.a*(1.0-a));}
void main(){
 float opacity=texelFetch(u_visibility,ivec2(u_slot,0),0).r;if(opacity<=0.0)discard;
 vec2 p=vec2(gl_FragCoord.x,u_size.y-gl_FragCoord.y);color=vec4(0);
 if(u_lens.z>0.0&&inside(p,u_lens)){
  vec2 source=floor(u_crop.xy+(p-u_lens.xy)/u_lens.zw*u_crop.zw);
  over(texture(u_scene,vec2((source.x+.5)/u_size.x,1.0-(source.y+.5)/u_size.y)).rgb,1.0);
 }
 if(u_count>0){
  float cell=u_ripple.w;vec2 grid=floor(p/cell),center=(grid+.5)*cell;
  float radius=min(u_ripple.y,mod(u_time,u_period)*u_ripple.x);
  float wave=max(0.0,1.0-abs(length(center-u_anchor)-radius)/u_ripple.z)*(1.0-radius/u_ripple.y);
  int ch=int(mod(grid.x*13.0+grid.y*7.0+floor(u_time*7.0),float(u_count)));
  int index=u_chars[ch];ivec2 pos=ivec2(mod(p,cell)/cell*vec2(6,8));
  ivec2 texel=ivec2(index%64*6,index/64*8)+pos;
  float bit=texelFetch(u_font,texel,0).r;over(u_color,bit*wave*.65);
 }
 float line=1e6;vec2 a=u_rect.xy,b=a+u_rect.zw;
 for(int j=0;j<4;j++){
  vec2 sign=vec2(j%2==0?1:-1,j<2?1:-1),q=vec2(j%2==0?a.x:b.x,j<2?a.y:b.y);
  line=min(line,segment(p,q,q+vec2(sign.x*min(u_corner,u_rect.z*.5),0)));
  line=min(line,segment(p,q,q+vec2(0,sign.y*min(u_corner,u_rect.w*.5))));
 }
 vec2 delta=abs(p-u_anchor);
 if((delta.x>=3.0&&delta.x<=7.0&&delta.y<=u_width*.5)||(delta.y>=3.0&&delta.y<=7.0&&delta.x<=u_width*.5))line=0.0;
 line=min(line,segment(p,vec2(b.x,a.y),u_labelRect.xy));
 if(u_lens.z>0.0){
  vec2 a=u_lens.xy,b=a+u_lens.zw;
  line=min(line,min(min(segment(p,a,vec2(b.x,a.y)),segment(p,vec2(b.x,a.y),b)),min(segment(p,b,vec2(a.x,b.y)),segment(p,vec2(a.x,b.y),a))));
 }
 if(line<=u_width*.5)over(u_color,1.0);
 if(inside(p,u_labelRect)){
  vec4 label=texelFetch(u_label,ivec2(p-u_labelRect.xy),0);over(label.rgb,label.a);
 }
 color*=opacity;
}`;
const copy = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform vec2 u_size;
out vec4 color;
void main(){color=texture(u_scene,gl_FragCoord.xy/u_size);}`;
export function createInspection(
  gl,
  { api, program, resources, target, textureUnit, fullscreen, maxSize, viewportLimit }
) {
  const base = target(),
    visibility = target(),
    depthCopy = target(),
    labels = resources.texture(),
    font = resources.texture();
  const visibleProgram = program(visibilityShader),
    overlayProgram = program(fragment),
    copyProgram = program(copy);
  const labelCache = new Map();
  let fontSettings, fontIndices;
  const upload = (texture, w, h, data, format = gl.RGBA) => {
    textureUnit(0, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format === gl.RED ? gl.R8 : gl.RGBA8, w, h, 0, format, gl.UNSIGNED_BYTE, data);
  };
  return function inspect(world, frame, settings, w, h, output, present) {
    if (w > Math.min(maxSize, viewportLimit[0]) || h > Math.min(maxSize, viewportLimit[1]))
      throw new RangeError('Inspection frame exceeds texture limit');
    base.resize(w, h);
    let capture;
    // Copy immediately: reflections/portals can reuse the renderer's geometry targets later.
    const receive = (scene, depth, camera) => {
      capture = { camera };
      depthCopy.resize(w, h);
      textureUnit(0, depth);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      fullscreen(copyProgram, depthCopy.framebuffer, w, h, { u_scene: 0, u_size: [w, h] });
    };
    present(world, { ...frame, [inspectionDepth]: receive }, w, h, base.framebuffer);
    if (!capture) throw new Error('Inspection could not capture the scene camera');
    const plan = api.plan(settings, {
      world,
      time: frame.interfaceTime ?? frame.time ?? world.lookSnapshot?.time ?? 0,
      sceneTime: frame.time ?? world.lookSnapshot?.time ?? 0,
      width: w,
      height: h,
      camera: capture.camera,
      focus: frame.inspectionFocus
    });
    if (!output) {
      if (gl.canvas.width !== w) gl.canvas.width = w;
      if (gl.canvas.height !== h) gl.canvas.height = h;
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    textureUnit(0, base.textures[0]);
    fullscreen(copyProgram, output, w, h, { u_scene: 0, u_size: [w, h] });
    if (!plan.targets.length) return;
    const glyphs = api.font(settings);
    if (fontSettings !== glyphs) {
      const entries = [...glyphs],
        height = Math.ceil(entries.length / 64) * 8,
        bitmap = new Uint8Array(384 * height);
      fontIndices = new Map();
      entries.forEach(([ch, bits], i) => {
        fontIndices.set(ch, i);
        for (let y = 0; y < 8; y++)
          bitmap.set(bits.subarray(y * 6, y * 6 + 6), (Math.floor(i / 64) * 8 + y) * 384 + (i % 64) * 6);
      });
      if (height > maxSize) throw new RangeError('Inspection glyph atlas exceeds texture limit');
      upload(font, 384, height, bitmap, gl.RED);
      fontSettings = glyphs;
      labelCache.clear();
    }
    const probes = new Float32Array(640),
      states = new Float32Array(128);
    plan.targets.forEach((item, i) => {
      probes.set(item.probes.flat(), i * 20);
      states[i * 4] = item.coverage;
      states[i * 4 + 1] = +item.occlusion;
      states[i * 4 + 2] = item.probes.length;
    });
    visibility.resize(plan.targets.length, 1);
    textureUnit(0, depthCopy.textures[0]);
    fullscreen(visibleProgram, visibility.framebuffer, plan.targets.length, 1, {
      u_depth: 0,
      u_probes: probes,
      u_states: states
    });
    textureUnit(0, base.textures[0]);
    textureUnit(1, visibility.textures[0]);
    textureUnit(3, font);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (let i = 0; i < plan.targets.length; i++) {
      const item = plan.targets[i],
        key = JSON.stringify([item.text, item.style, item.label.slice(2)]);
      let label = labelCache.get(key);
      if (!label) {
        label = api.labels(item, glyphs);
        if (labelCache.size >= 128) labelCache.clear();
        labelCache.set(key, label);
      }
      upload(labels, label.w, label.h, label.data);
      textureUnit(2, labels);
      textureUnit(0, base.textures[0]);
      const chars = new Int32Array(64),
        list = [...(item.ripple?.chars ?? '')];
      list.forEach((ch, j) => {
        if (!fontIndices.has(ch)) throw new RangeError('Missing inspection ripple glyph: ' + ch);
        chars[j] = fontIndices.get(ch);
      });
      const r = item.ripple;
      // Bounds include the ring, labels, leader, and optional lens. No full-frame CPU image or readback.
      const boxes = [
        item.rect,
        item.label,
        [
          item.anchor[0] - (r?.radius ?? 8),
          item.anchor[1] - (r?.radius ?? 8),
          (r?.radius ?? 8) * 2,
          (r?.radius ?? 8) * 2
        ]
      ];
      if (item.lens) boxes.push(item.lens.rect);
      const x = Math.max(0, Math.floor(Math.min(...boxes.map(b => b[0])) - 2)),
        y = Math.max(0, Math.floor(Math.min(...boxes.map(b => b[1])) - 2));
      const right = Math.min(w, Math.ceil(Math.max(...boxes.map(b => b[0] + b[2])) + 2)),
        bottom = Math.min(h, Math.ceil(Math.max(...boxes.map(b => b[1] + b[3])) + 2));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, h - bottom, right - x, bottom - y);
      fullscreen(overlayProgram, output, w, h, {
        u_scene: 0,
        u_visibility: 1,
        u_label: 2,
        u_font: 3,
        u_size: [w, h],
        u_anchor: item.anchor,
        u_rect: item.rect,
        u_labelRect: item.label,
        u_lens: item.lens?.rect ?? [0, 0, 0, 0],
        u_crop: item.lens?.crop ?? [0, 0, 0, 0],
        u_ripple: r ? [r.speed, r.radius, r.width, r.cell] : [0, 1, 1, 1],
        u_period: r?.period ?? 1,
        u_time: plan.time,
        u_color: item.style.rgb,
        u_width: item.style.width,
        u_corner: item.style.corner,
        u_slot: i,
        u_chars: chars,
        u_count: list.length
      });
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  };
}
