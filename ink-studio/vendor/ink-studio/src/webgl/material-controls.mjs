// A GPU finish pass composes with the shared relative-light table. Painted
// pixel/fine detail keeps its authored texture rather than being replaced.
const vertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const fragment = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D u_matData,u_matSource,u_matBones,u_matBase;
uniform int u_matRows,u_matCount;uniform bool u_matHasBase,u_matOrtho,u_matLiveLight;
uniform vec3 u_matEye,u_matView,u_matLight;uniform float u_matTime;
out vec4 color;
vec4 setting(int id,int slot){int q=id*9+slot;return texelFetch(u_matData,ivec2(q%1024,u_matRows+q/1024),0);}
vec3 unit(vec3 a,vec3 fallback){float l=length(a);return l>1e-8?a/l:fallback;}
mat3 bone(int id,out vec3 translation){int i=id*3;ivec2 p=ivec2(i%768,i/768);vec4 a=texelFetch(u_matBones,p,0),b=texelFetch(u_matBones,p+ivec2(1,0),0),c=texelFetch(u_matBones,p+ivec2(2,0),0);translation=vec3(a.w,b.w,c.w);return transpose(mat3(a.xyz,b.xyz,c.xyz));}
float lobe(vec4 p,vec3 n,vec3 t,vec3 b,vec3 v,vec3 light,float visibility,float steps){
 vec3 h=unit(v+light,n);float nt=dot(n,h);if(dot(n,light)<=0.0||nt<=0.0)return 0.0;
 float ht=dot(t,h),hb=dot(b,h),c=cos(p.w),s=sin(p.w);
 float response=exp(-pow((ht*c+hb*s)/nt/max(.001,p.x),2.0))*exp(-pow((hb*c-ht*s)/nt/max(.001,p.y),2.0));
 float w=clamp(response*p.z*visibility,0.0,1.0);return steps>1.0?floor(w*steps+.5)/steps:w;
}
void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);int i=pixel.x+pixel.y*512;
 vec4 previous=u_matHasBase?texelFetch(u_matBase,pixel,0):vec4(1,1,1,0);
 if(i>=u_matCount){color=vec4(0);return;}
 vec4 normal=texelFetch(u_matData,ivec2(pixel.x*2,pixel.y),0),axis=texelFetch(u_matData,ivec2(pixel.x*2+1,pixel.y),0);
 int id=int(normal.w)-1;ivec2 source=ivec2(pixel.x*4,pixel.y);
 vec4 at=texelFetch(u_matSource,source,0),shape=texelFetch(u_matSource,source+ivec2(2,0),0),animation=texelFetch(u_matSource,source+ivec2(3,0),0);
 int flags=int(shape.w),kind=flags&15;
 if(id<0||at.w<=0.0||(flags&(32768|32))!=0){color=previous;return;}
 vec3 position=at.xyz,n=normal.xyz,t=axis.xyz;mat3 transform=mat3(1);
 float ph=animation.x,sp=animation.y,rg=animation.z,ex=animation.w,time=u_matTime;
 if(kind==5){float a=time*sp,c=cos(a),s=sin(a);transform=mat3(c,0,-s,0,1,0,s,0,c);position=transform*position;}
 else if(kind==12||kind==13){vec3 move;transform=bone(int(ph+.5),move);vec3 p=transform*position+move;
  if(rg>0.0){vec3 move2;mat3 second=bone(int(sp+.5),move2);p=mix(p,second*position+move2,rg);transform=transform*(1.0-rg)+second*rg;}
  position=p;if(kind==13){position.x+=.022*sin(time*1.9+position.y*1.3+position.z*.9+1.0);position.y+=.0132*sin(time*2.47+position.x*1.1+1.0);}}
 else if(kind==6)position.y+=sin(time*sp+ph)*rg;
 else if(kind==8){float f=.2+.8*abs(sin(time*sp+ph));position.x=rg+(position.x-rg)*f;position.z=ex+(position.z-ex)*f;position.y+=.14*sin(time*sp*.31+ph);}
 else if(kind==9)position.xz*=1.0+rg*sin(time*sp+ph-position.y*ex);
 else if(kind==10){float q=length(position.xz),w=min(1.0,q*.22);position.y+=rg*w*sin(time*sp+ph-q*ex);position.xz+=rg*.6*w*vec2(-position.z,position.x)/max(q,.01)*sin(time*sp*.7+ph-q*ex*.6);}
 else if(kind==14){float spread=rg*max(0.0,position.y-ex);position.x+=spread*sin(time*sp+ph);position.z+=spread*.6*sin(time*sp*.73+ph*1.7);}
 else if(kind==2||kind==3||kind==15){float phase=fract(time*sp/max(rg,.000001)+ph);position.y+=(kind==3?1.0:-1.0)*phase*rg;
  if(kind==3)position.x+=sin(phase*7.0+ph*50.0)*.25*phase;
  if(kind==15){position.x+=sin(phase*11.0+ph*40.0)*ex;position.z+=cos(phase*7.0+ph*23.0)*ex*.6;}}
 else if(kind==11){position.x+=rg*sin(time*sp+position.y*1.3+position.z*.9+ph);position.y+=rg*.6*sin(time*sp*1.3+position.x*1.1+ph);}
 if(abs(determinant(transform))>1e-8)n=transpose(inverse(transform))*n;t=transform*t;
 n=unit(n,vec3(0,1,0));t-=n*dot(t,n);t=unit(t,unit(cross(abs(n.x)<.8?vec3(1,0,0):vec3(0,1,0),n),vec3(1,0,0)));
 vec3 b=cross(n,t),v=unit(u_matOrtho?u_matView:u_matEye-position,n),light=unit(u_matLiveLight?u_matLight:setting(id,8).xyz,vec3(0,1,0));
 float packed=texelFetch(u_matSource,source+ivec2(1,0),0).w;
 vec3 original=vec3(mod(packed,256.0),mod(floor(packed/256.0),256.0),floor(packed/65536.0))/255.0;
 vec3 rgb=min(vec3(1),original*(previous.w>0.0?previous.rgb:vec3(1)));
 vec4 diffuse=setting(id,0);rgb*=mix(vec3(1),diffuse.rgb,diffuse.a);
 vec4 sky=setting(id,3),horizon=setting(id,4),ground=setting(id,5);
 float nv=clamp(dot(n,v),0.0,1.0),up=n.y*2.0*nv-v.y,q=clamp(abs(up)/.8,0.0,1.0);q=q*q*(3.0-2.0*q);
 vec3 reflected=mix(horizon.rgb,up<0.0?ground.rgb:sky.rgb,q);
 float reflection=clamp((horizon.a+(1.0-horizon.a)*pow(1.0-nv,ground.a))*sky.a,0.0,1.0);
 rgb=mix(rgb,reflected,reflection);
 vec4 spec=setting(id,1),specColor=setting(id,2),coat=setting(id,6),coatColor=setting(id,7);
 rgb=mix(rgb,specColor.rgb,lobe(spec,n,t,b,v,light,axis.w,specColor.a));
 rgb=mix(rgb,coatColor.rgb,lobe(coat,n,t,b,v,light,axis.w,coatColor.a));
 color=vec4(rgb/max(original,vec3(.00001)),1);
}`;

export function createMaterialControls(gl, resources, targets, maxSize, kit) {
  const K = kit.KIT,
    api = kit.MaterialControls ?? K?.material,
    S = kit.SurfaceLook ?? K?.surface;
  const has = world => !!world.surfaces?.some(s => s.settings?.materialControls);
  if (!api || !S) return { has: () => false, compose: (w, f, c, t, a) => a };
  let source,
    sourceData,
    carrierCount,
    metadata,
    definitions,
    revision,
    references,
    rows,
    slots,
    active,
    normalHeight,
    buffer,
    output,
    blank,
    vao,
    program,
    size = [],
    track,
    trackSource;
  function rgb(value, fallback) {
    if (value === undefined) return fallback;
    if (Array.isArray(value)) return value;
    const h = typeof value === 'string' ? parseInt(value.slice(1), 16) : source.pal[value];
    return [(h >>> 16) & 255, (h >> 8) & 255, h & 255].map(n => n / 255);
  }
  function packet(binding) {
    const { settings, light } = binding,
      layers = settings.layers ?? {},
      names = ['control-diffuse', 'control-reflection', 'control-specular', 'control-coating'];
    const compiled = S.prepare(
      { ...settings, layers: Object.fromEntries(names.map(name => [name, layers[name]])) },
      source.pal,
      light,
      source.surfaceEffects,
      { paletteRoles: source.paletteRoles }
    );
    const get = name => compiled.layers.find(l => l.id === name),
      d = get(names[0]),
      r = get(names[1]),
      s = get(names[2]),
      c = get(names[3]);
    if (compiled.layers.some(l => l.mask || l.drive || l.spatialMask))
      throw new Error(
        'Native material-control slots do not accept masks or signal drives; add them as separate surface layers'
      );
    return [
      ...rgb(d?.color, [1, 1, 1]),
      d?.strength ?? 0,
      ...(s?.roughness ?? [0.45, 0.45]),
      s?.strength ?? 0,
      s?.rotation ?? 0,
      ...rgb(s?.color, [1, 1, 1]),
      s?.steps ?? settings.steps ?? 0,
      ...rgb(r?.sky, [0.6, 0.78, 0.97]),
      r?.strength ?? 0,
      ...rgb(r?.horizon, [0.86, 0.91, 0.97]),
      r?.f0 ?? 0.04,
      ...rgb(r?.ground, [0.21, 0.23, 0.28]),
      r?.power ?? 5,
      ...(c?.roughness ?? [0.12, 0.12]),
      c?.strength ?? 0,
      c?.rotation ?? 0,
      ...rgb(c?.color, [1, 1, 1]),
      c?.steps ?? settings.steps ?? 0,
      ...(light ?? [0, 1, 0]),
      0
    ];
  }
  function prepare(world, frame) {
    const nextRevision = frame.materialRevision ?? world.materialRevision;
    const changed =
      source !== world ||
      sourceData !== world.data ||
      carrierCount !== world.count ||
      references?.length !== world.surfaces.length ||
      metadata !== world.surfaceData ||
      definitions !== world.surfaces ||
      revision !== nextRevision ||
      references?.some((s, i) => s !== world.surfaces[i].settings);
    if (changed) {
      source = world;
      sourceData = world.data;
      carrierCount = world.count;
      metadata = world.surfaceData;
      definitions = world.surfaces;
      revision = nextRevision;
      references = definitions.map(s => s.settings);
      normalHeight = Math.ceil(world.count / 512);
      rows = new Float32Array((normalHeight + Math.ceil((definitions.length * 9) / 1024)) * 4096);
      active = [];
      definitions.forEach((binding, i) => {
        if (binding.settings?.materialControls) rows.set(packet(binding), normalHeight * 4096 + i * 36);
      });
      for (let i = 0; i < world.count; i++)
        if (definitions[metadata?.[i * 8] - 1]?.settings?.materialControls) active.push(i);
      buffer ??= targets.table(1024, 31, maxSize);
    }
    if (changed || world.anim?.rig || frame.changedRows?.length !== 0) {
      const rig = world.anim?.rig,
        rest = world.rest ?? world.anim?.base ?? world.data,
        matrices = new Map();
      for (const i of active) {
        const q = i * 8,
          slot = metadata[q] - 1,
          setting = definitions[slot].settings;
        const position = [0, 1, 2].map(a => (rest[i * 16 + a] - (setting.origin?.[a] ?? 0)) / (setting.scale ?? 1));
        let n = Array.from(metadata.subarray(q + 1, q + 4)),
          t =
            metadata[q + 5] || metadata[q + 6] || metadata[q + 7]
              ? Array.from(metadata.subarray(q + 5, q + 8))
              : (setting.direction ?? [1, 0, 0]);
        const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
        if (typeof t === 'string') t = axes[t] ?? axes.x;
        else if (typeof t === 'function') t = t(position, n);
        else if (t.type === 'circular') t = K.V.cross(axes[t.axis] ?? axes.y, position);
        else if (t.type === 'weave') {
          const along = axes[t.along] ?? (Array.isArray(t.along) ? t.along : axes.x),
            across = axes[t.across] ?? (Array.isArray(t.across) ? t.across : axes.y),
            scale = t.scale ?? 0.2;
          t =
            (Math.floor(K.V.dot(along, position) / scale) + Math.floor(K.V.dot(across, position) / scale)) & 1
              ? along
              : across;
        } else if (!Array.isArray(t)) t = axes.x;
        if (!Array.isArray(t) || t.length !== 3 || !t.every(Number.isFinite))
          throw new TypeError('Material direction must produce finite XYZ');
        const part = rig?.free?.[i] ? 0 : rig?.bid?.[i];
        if (part) {
          let m = matrices.get(part);
          if (!m) {
            const A = rig.M.subarray(part * 12, part * 12 + 9);
            m = { A, normal: Math.abs(K.M.det(A)) > 1e-8 ? K.M.tr(K.M.inv(A)) : K.M.id() };
            matrices.set(part, m);
          }
          n = K.M.app(m.normal, n);
          t = K.M.app(m.A, t);
        }
        rows.set([...n, slot + 1, ...t, metadata[q + 4]], q);
      }
      buffer.upload(rows);
    } else buffer.bind();
  }
  function compose(world, frame, camera, time, baseActive) {
    if (frame.materialControls === false || !world.count || !has(world)) return baseActive;
    if (!program && !gl.getExtension('EXT_color_buffer_float'))
      throw new Error('Native material controls require EXT_color_buffer_float');
    try {
      prepare(world, frame);
    } catch (error) {
      source = null;
      throw error;
    }
    program ??= resources.program(vertex, fragment);
    vao ??= resources.allocate('VertexArray');
    output ??= resources.texture();
    blank ??= resources.texture();
    if (!baseActive) {
      targets.textureUnit(21, blank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1, 1, 1, 0]));
    }
    const next = [512, Math.ceil(world.count / 512)];
    if (size[0] !== next[0] || size[1] !== next[1]) {
      targets.textureUnit(31, output);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...next, 0, gl.RGBA, gl.FLOAT, null);
      size = next;
      buffer.bind();
    }
    const target = (slots ??= resources.allocate('Framebuffer'));
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Material finish framebuffer is incomplete');
    if (trackSource !== world.surfaceLight) {
      trackSource = world.surfaceLight;
      track = trackSource ? S.prepareLightTrack(trackSource) : null;
    }
    const light = frame.materialLight ?? track?.(time);
    if (
      light &&
      (!Array.isArray(light) || light.length !== 3 || !light.every(Number.isFinite) || Math.hypot(...light) < 1e-8)
    )
      throw new TypeError('Material light needs a nonzero finite XYZ direction');
    gl.viewport(0, 0, ...size);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(vao);
    gl.useProgram(program.p);
    program.set({
      u_matData: 31,
      u_matSource: 0,
      u_matBones: 4,
      u_matBase: 21,
      u_matRows: normalHeight,
      u_matCount: world.count,
      u_matHasBase: baseActive,
      u_matEye: camera.eye,
      u_matView: [camera.view[2], camera.view[6], camera.view[10]],
      u_matOrtho: camera.ortho,
      u_matTime: time,
      u_matLight: light ?? [0, 1, 0],
      u_matLiveLight: !!light
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targets.textureUnit(21, output);
    return true;
  }
  return { has, compose };
}
