// Shared emitter evaluation. A small GPU receiver pass feeds the existing relight table.
export const emitterGLSL = `
uniform highp sampler2D u_eData,u_eCookies;
uniform highp sampler3D u_eShadow;
uniform int u_eCount,u_eFogCount,u_ePick;
uniform vec3 u_eShadowMin,u_eShadowSize;
uniform float u_eShadowStep,u_eAmbient;
uniform vec4 u_eSun;
uniform vec3 u_eSunColor;
vec4 eRow(int light,int row){return texelFetch(u_eData,ivec2(light*11+row,0),0);}
vec3 eLinear(vec3 s){return mix(s/12.92,pow((s+.055)/1.055,vec3(2.4)),step(vec3(.04045),s));}
vec3 eSRGB(vec3 s){s=max(s,vec3(0));return mix(s*12.92,1.055*pow(s,vec3(1.0/2.4))-.055,step(vec3(.0031308),s));}
float eShadow(vec3 p,vec3 toLight,float stop,float bias){
  if(u_eShadowStep<=0.0)return 1.0;
  float t=max(bias,u_eShadowStep*.12);
  for(int k=0;k<40;k++){
    if(t>=stop-bias)return 1.0;
    vec3 uv=((p+toLight*t-u_eShadowMin)/u_eShadowStep+.5)/u_eShadowSize;
    if(any(lessThan(uv,vec3(0)))||any(greaterThan(uv,vec3(1)))){t+=u_eShadowStep;continue;}
    float d=texture(u_eShadow,uv).r;
    if(d<max(.0015,u_eShadowStep*.025))return 0.0;
    t+=max(u_eShadowStep*.12,d*.8);
  }
  return 1.0;
}
vec3 eCookie(int i,vec3 p){
  vec4 region=eRow(i,6);if(region.z<=0.0)return vec3(1);
  vec4 at=eRow(i,0),n=eRow(i,1),u=eRow(i,7),v=eRow(i,8),move=eRow(i,9);
  vec3 delta=at.xyz-p;float forward=-dot(delta,n.xyz);if(forward<=0.0)return vec3(0);
  vec2 uv=vec2(.5-dot(delta,u.xyz)/forward,.5-dot(delta,v.xyz)/forward);
  if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))return vec3(0);
  uv=(uv-.5)*move.zw+.5+move.xy;if(v.w>.5)uv=fract(uv);
  if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))return vec3(0);
  if(u.w<.5)return texelFetch(u_eCookies,ivec2(region.xy+floor(uv*region.zw)),0).rgb;
  vec2 q=uv*region.zw-.5,f=fract(q);ivec2 a=ivec2(floor(q)),lo=ivec2(region.xy),hi=ivec2(region.zw)-1;
  return mix(mix(texelFetch(u_eCookies,lo+clamp(a,ivec2(0),hi),0).rgb,texelFetch(u_eCookies,lo+clamp(a+ivec2(1,0),ivec2(0),hi),0).rgb,f.x),mix(texelFetch(u_eCookies,lo+clamp(a+ivec2(0,1),ivec2(0),hi),0).rgb,texelFetch(u_eCookies,lo+clamp(a+ivec2(1),ivec2(0),hi),0).rgb,f.x),f.y);
}
vec2 eDisk(vec2 a){if(a.x==0.0&&a.y==0.0)return vec2(0);bool wide=abs(a.x)>abs(a.y);float r=wide?a.x:a.y,angle=.78539816339*(wide?a.y/a.x:2.0-a.x/a.y);return r*vec2(cos(angle),sin(angle));}
vec3 eLighting(vec3 p,vec3 normal,bool fog,vec3 viewRay){
  vec3 sum=vec3(0);
  for(int i=0;i<32;i++){
    if(i>=u_eCount||(fog&&i>=u_eFogCount))break;if(u_ePick>0&&i!=u_ePick-1)continue;
    vec4 c=eRow(i,4),params=eRow(i,5);float power=fog?c.w:params.x;if(power<=0.0)continue;
    vec4 at=eRow(i,0),n=eRow(i,1),u=eRow(i,2),v=eRow(i,3);
    if(distance(p,at.xyz)>at.w+length(vec2(u.w,v.w)))continue;
    vec3 transmission=eCookie(i,p);if(max(transmission.r,max(transmission.g,transmission.b))<=0.0)continue;
    int type=int(n.w),grid=fog?1:int(params.y);float total=0.0,lit=0.0;
    for(int j=0;j<64;j++){
      int count=type==2?grid:type>=3?1:grid*grid;if(j>=count)break;
      vec2 q=vec2(2.0*(float(j%grid)+.5)/float(grid)-1.0,2.0*(float(j/grid)+.5)/float(grid)-1.0);
      if(type==1)q=eDisk(q);if(type==2)q.y=0.0;
      vec3 sampleAt=at.xyz+(type<3?q.x*(type==2?max(0.0,u.w-v.w):u.w)*u.xyz+q.y*v.w*v.xyz:vec3(0));
      vec3 delta=sampleAt-p;float d=length(delta);if(d<=params.w||d>=at.w)continue;vec3 dir=delta/d;
      float facing=-dot(dir,n.xyz),receive=fog?1.0:max(0.0,dot(normal,dir));
      float angular=type>=3?1.0:type==2?1.0:max(0.0,params.z>=2.0?abs(facing):facing);
      if(type==3){float outer=u.w,inner=v.w;if(facing<outer)continue;float edge=inner==outer?1.0:clamp((facing-outer)/(inner-outer),0.0,1.0);angular*=edge*edge*(3.0-2.0*edge);}
      float amount=receive*angular*pow(1.0-d/at.w,2.0);total+=amount;
      bool shadows=mod(params.z,2.0)>.5&&(!fog||eRow(i,10).y>.5);
      float visible=shadows?eShadow(p+(fog?vec3(0):normal*params.w),dir,d,params.w):1.0;
      lit+=amount*visible;
    }
    float count=float(type==2?grid:type>=3?1:grid*grid),visibility=total>0.0?lit/total:0.0;
    float steps=eRow(i,10).x;
    if(steps>1.0)lit=total*floor(visibility*(steps-1.0)+.5)/(steps-1.0);
    sum+=(fog?eSRGB(c.rgb):c.rgb)*transmission*(power*lit/max(count,1.0));
  }
  return sum;
}
vec3 ePaint(vec3 rgb,vec3 p,vec3 n){return eSRGB(min(vec3(1),eLinear(rgb)*(vec3(1)+eLighting(p,n,false,vec3(0)))));}
`;

const same = (a, b) => a?.length === b.length && b.every((n, i) => n === a[i]);
const white = [1, 1, 1];
export function createLightEmitters(gl, resources, { table, textureUnit }, maxSize, toolkit) {
  const K = toolkit.KIT,
    A = toolkit.AreaLights ?? K?.areaLights,
    C = toolkit.LightCookies ?? K?.lightCookies;
  if (!A || !C) return { prepare: () => null, compose: (state, world, time, rows, active) => active, fog: () => {} };
  const lightTable = table(352, 26, maxSize),
    receivers = table(1024, 28, maxSize);
  const blankBase = resources.texture();
  textureUnit(25, blankBase);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1, 1, 1, 0]));
  const cookieTexture = resources.texture(),
    shadowTexture = resources.allocate('Texture'),
    factorTexture = resources.texture(),
    factorBuffer = resources.allocate('Framebuffer');
  const vao = resources.allocate('VertexArray');
  const bakedTexture = resources.allocate('Texture');
  let bakeProgram,
    bakedSize = [];
  gl.activeTexture(gl.TEXTURE0 + 30);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, bakedTexture);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
  let display,
    displayKey,
    lastDisplayImages,
    program,
    factorSize = [],
    lastCookies,
    gridSources = [],
    grid,
    normalRows,
    lastPoses,
    lastLights,
    lastBase,
    lastResolution,
    lastShadowRevision;
  const fogTexture = resources.allocate('Texture'),
    fogBuffer = resources.allocate('Framebuffer');
  let fogProgram,
    fogSize = [],
    fogKey,
    fogLights;
  gl.activeTexture(gl.TEXTURE0 + 25);
  gl.bindTexture(gl.TEXTURE_3D, fogTexture);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
    gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0.35, 0.35, 0.35, 1]));
  const customSources = new WeakMap(),
    cookieIDs = new WeakMap();
  let nextCookieID = 1;
  let receiverWorld,
    receiverData,
    receiverMetadata,
    receiverStatic = false,
    lastFactorShadow;
  gl.activeTexture(gl.TEXTURE0 + 29);
  gl.bindTexture(gl.TEXTURE_3D, shadowTexture);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
    gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1000]));
  function prepare(world, frame, time, capture = false, camera) {
    const areas = A.prepare(frame.areaLights === true ? world.areaLights : (frame.areaLights ?? world.areaLights), {
      time
    });
    const raw = frame.volumeLighting ?? world.volumeLighting;
    const media = raw ? K.atmosphere.lighting(raw, world.pal, { time }) : null;
    const locals = [...(media?.point ? [media.point] : []), ...(media?.locals ?? [])];
    const lamps = [
      ...areas.map(l => ({
        ...l,
        type: l.shape === 'rectangle' ? 0 : l.shape === 'disk' ? 1 : 2,
        surface: l.intensity,
        volume: frame.volumeLocalLights === false ? 0 : l.volumeIntensity
      })),
      ...locals
        .filter(l => l.intensity || l.surfaceIntensity)
        .map(l => ({
          ...l,
          type: l.direction ? 3 : 4,
          normal: l.direction ?? [0, 0, 1],
          half: [0, 0],
          u: [1, 0, 0],
          v: [0, 1, 0],
          linearRGB: l.rgb.map(n => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)),
          surface: l.surfaceIntensity ?? 0,
          volume: frame.volumeLocalLights === false ? 0 : l.intensity,
          sampleGrid: 1,
          shadows: l.castsShadow,
          bias: 0.025,
          cookie: l.cookie?.projection
        }))
    ];
    lamps.sort((a, b) => Number(b.volume > 0) - Number(a.volume > 0));
    if (lamps.length > 32)
      throw new RangeError('Native emitter lighting supports up to 32 active shaped/volume lights');
    if (!lamps.length && !raw?.sun && !world.atmosphere?.some(v => v.lit)) return null;
    if (!gl.getExtension('EXT_color_buffer_float'))
      throw new Error('Native emitter lighting needs EXT_color_buffer_float');
    const images = [...new Set(lamps.map(l => l.cookie?.image).filter(Boolean))];
    const regions = new Map();
    let x = 0,
      y = 0,
      shelf = 0;
    const width = Math.min(maxSize, 1024);
    for (const image of images) {
      if (image.width > width || image.height > maxSize)
        throw new RangeError('Light cookie exceeds native atlas limits');
      if (x + image.width > width) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (y + image.height > maxSize) throw new RangeError('Light cookie atlas is full');
      regions.set(image, [x, y, image.width, image.height]);
      x += image.width;
      shelf = Math.max(shelf, image.height);
    }
    const height = Math.max(1, y + shelf);
    textureUnit(27, cookieTexture);
    if (!same(lastCookies, images)) {
      const pixels = new Uint8Array(width * height * 4);
      for (const [image, [x, y]] of regions)
        for (let j = 0; j < image.height; j++)
          pixels.set(image.data.subarray(j * image.width * 4, (j + 1) * image.width * 4), ((y + j) * width + x) * 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      lastCookies = images;
    }
    const sources = lamps.some(l => l.shadows) ? A.staticSources(world) : [];
    if (media?.shadow?.field) {
      const r = world.radius ?? 10;
      const bounds = { min: [-r, -r, -r], max: [r, r, r] };
      let source = customSources.get(media.shadow.field);
      if (!source) {
        source = { distance: media.shadow.field, bounds };
        customSources.set(media.shadow.field, source);
      }
      sources.push(source);
    }

    if (
      !same(gridSources, sources) ||
      lastResolution !== (frame.emitterShadowResolution ?? 48) ||
      lastShadowRevision !== frame.emitterShadowRevision
    ) {
      grid = A.shadowField(sources, { resolution: frame.emitterShadowResolution ?? 48 });
      gridSources = sources;
      lastResolution = frame.emitterShadowResolution ?? 48;
      lastShadowRevision = frame.emitterShadowRevision;
      gl.activeTexture(gl.TEXTURE0 + 29);
      gl.bindTexture(gl.TEXTURE_3D, shadowTexture);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.R16F,
        ...(grid?.size ?? [1, 1, 1]),
        0,
        gl.RED,
        gl.FLOAT,
        grid?.data ?? new Float32Array([1000])
      );
    }
    gl.activeTexture(gl.TEXTURE0 + 29);
    gl.bindTexture(gl.TEXTURE_3D, shadowTexture);
    const rows = new Float32Array(352 * 4);
    lamps.forEach((l, i) => {
      const p = i * 44,
        cookie = l.cookie;
      rows.set(
        [
          ...l.at,
          l.radius,
          ...l.normal,
          l.type,
          ...l.u,
          l.type === 3 ? l.outerCos : l.half[0],
          ...l.v,
          l.type === 3 ? l.innerCos : l.half[1],
          ...(l.linearRGB ?? l.rgb),
          l.volume,
          l.surface,
          l.points ? (l.shape === 'line' ? l.points.length : Math.sqrt(l.points.length)) : 1,
          (l.twoSided ? 2 : 0) + (l.shadows ? 1 : 0),
          l.bias ?? 0.025
        ],
        p
      );
      if (cookie && !cookieIDs.has(cookie.image)) cookieIDs.set(cookie.image, nextCookieID++);
      if (cookie) {
        rows.set(regions.get(cookie.image), p + 24);
        rows.set([...cookie.u, +(cookie.image.filter === 'linear'), ...cookie.v, +!!cookie.wrap], p + 28);
        rows.set([...cookie.offset, ...cookie.repeat], p + 36);
      }
      rows.set(
        [l.shadowSteps ?? 0, +(frame.volumeLocalShadows !== false), cookie ? cookieIDs.get(cookie.image) : 0, 0],
        p + 40
      );
    });
    lightTable.upload(rows);
    const uniforms = {
      u_eData: 26,
      u_eCookies: 27,
      u_eShadow: 29,
      u_eCount: lamps.length,
      u_ePick: 0,
      u_eFogCount: lamps.filter(l => l.volume > 0).length,
      u_eShadowMin: grid?.min ?? [0, 0, 0],
      u_eShadowSize: grid?.size ?? [1, 1, 1],
      u_eShadowStep: grid?.step ?? 0,
      u_eAmbient: media?.ambient ?? 0.35,
      u_eSun: [...(media?.sun?.direction ?? [0, 1, 0]), media?.sun?.intensity ?? 0],
      u_eSunColor: media?.sun?.rgb ?? white
    };
    const visible = areas.filter(
      l =>
        l.intensity &&
        (capture ? l.reflection : l.visible) &&
        (l.twoSided || !camera || l.normal.reduce((n, v, k) => n + v * (camera.eye[k] - l.at[k]), 0) > 0)
    );
    const nextDisplay = JSON.stringify(
      visible.map(l => [
        l.at,
        l.normal,
        l.u,
        l.v,
        l.half,
        l.rgb,
        l.intensity,
        l.shape,
        l.cookie?.image && images.indexOf(l.cookie.image)
      ])
    );
    if (nextDisplay !== displayKey || lastDisplayImages !== lastCookies) {
      const dim = 64,
        width = Math.max(1, visible.length * dim),
        pixels = new Uint8Array(width * dim * 4),
        vertices = [];
      visible.forEach((l, i) => {
        for (let y = 0; y < dim; y++)
          for (let x = 0; x < dim; x++) {
            const u = (2 * (x + 0.5)) / dim - 1,
              v = 1 - (2 * (y + 0.5)) / dim;
            const outside =
              l.shape === 'disk'
                ? u * u + v * v > 1
                : l.shape === 'line'
                  ? Math.hypot(
                      Math.max(0, Math.abs(u) * l.half[0] - Math.max(0, l.half[0] - l.half[1])),
                      v * l.half[1]
                    ) > l.half[1]
                  : false;
            if (outside) continue;
            const ink = l.cookie ? C.sample(l.cookie.image, (u + 1) / 2, (1 - v) / 2) : white,
              p = (y * width + i * dim + x) * 4;
            for (let k = 0; k < 3; k++) pixels[p + k] = Math.round(255 * l.rgb[k] * Math.min(1, l.intensity) * ink[k]);
            pixels[p + 3] = 255;
          }
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 1],
          [1, 0],
          [1, 1]
        ])
          vertices.push(
            ...l.at.map((n, k) => n + l.u[k] * (u * 2 - 1) * l.half[0] + l.v[k] * (1 - v * 2) * l.half[1]),
            i * dim + 0.5 + u * (dim - 1),
            0.5 + v * (dim - 1)
          );
      });
      display = { width, height: dim, pixels, vertices: Float32Array.from(vertices) };
      displayKey = nextDisplay;
      lastDisplayImages = lastCookies;
    }
    return {
      count: lamps.length,
      shadow: grid,
      active: true,
      surface: lamps.some(l => l.surface > 0),
      uniforms,
      areas,
      rows,
      world,
      frame,
      time,
      capture,
      display: display?.vertices.length ? display : null
    };
  }
  function fog(state, world, frame) {
    if (!state) return;
    const sources = frame.atmosphere === false ? [] : (world.atmosphere ?? []).filter(v => v.lit);
    if (!sources.length) return;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity],
      radius = world.radius ?? 10;
    for (const v of sources) {
      let a = v.min,
        b = v.max;
      if (!a && v.type === 'sphere') {
        a = v.at.map(n => n - v.radius);
        b = v.at.map(n => n + v.radius);
      }
      if (!a && v.type === 'shaft') {
        a = v.from.map((n, k) => Math.min(n, v.to[k]) - v.radius);
        b = v.from.map((n, k) => Math.max(n, v.to[k]) + v.radius);
      }
      if (!a) {
        a = [-radius, v.bottom ?? -radius, -radius];
        b = [radius, v.top ?? radius, radius];
      }
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a[k]);
        max[k] = Math.max(max[k], b[k]);
      }
    }
    const resolution = frame.emitterFogResolution ?? 48;
    if (!Number.isSafeInteger(resolution) || resolution < 8 || resolution > 128)
      throw new RangeError('Emitter fog resolution must be 8..128');
    const extent = max.map((n, k) => n - min[k]),
      step = Math.max(...extent) / (resolution - 1),
      size = extent.map(n => Math.max(2, Math.ceil(n / step - 1e-9) + 1));
    gl.activeTexture(gl.TEXTURE0 + 25);
    gl.bindTexture(gl.TEXTURE_3D, fogTexture);
    const key = [
        ...min,
        ...extent,
        resolution,
        state.shadow,
        ...state.uniforms.u_eSun,
        ...state.uniforms.u_eSunColor,
        state.uniforms.u_eAmbient
      ],
      lights = state.rows.subarray(0, state.uniforms.u_eFogCount * 44);
    if (!same(fogKey, key) || !same(fogLights, lights)) {
      fogKey = key;
      fogLights = lights.slice();
      if (!same(fogSize, size)) {
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, ...size, 0, gl.RGBA, gl.FLOAT, null);
        fogSize = size;
      }
      fogProgram ??= resources.program(
        `#version 300 es
precision highp float;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`,
        `#version 300 es
precision highp float;${emitterGLSL}
uniform vec3 u_fogMin,u_fogExtent,u_fogSize;uniform int u_fogSlice;out vec4 color;void main(){vec3 p=u_fogMin+vec3(gl_FragCoord.xy-.5,float(u_fogSlice))/(u_fogSize-1.0)*u_fogExtent;vec3 light=vec3(u_eAmbient)+eLighting(p,vec3(0),true,vec3(0));if(u_eSun.w>0.0)light+=u_eSunColor*u_eSun.w*eShadow(p,u_eSun.xyz,20.0,.025);color=vec4(light,1);}`
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, fogBuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, size[0], size[1]);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(fogProgram.p);
      fogProgram.set({ ...state.uniforms, u_fogMin: min, u_fogExtent: extent, u_fogSize: size });
      gl.bindVertexArray(vao);
      for (let z = 0; z < size[2]; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, fogTexture, 0, z);
        fogProgram.set({ u_fogSlice: z });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    Object.assign(state.uniforms, { u_eFogField: 25, u_eFogMin: min, u_eFogExtent: extent, u_eFogSize: size });
  }
  function compose(state, world, time, baseRows, baseActive) {
    if (!state?.surface) return baseActive;
    if (!world.count) return baseActive;
    if (receiverWorld !== world || receiverData !== world.data || receiverMetadata !== world.renderMetadata) {
      normalRows = null;
      receiverData = world.data;
      receiverStatic = !world.anim;
      for (let i = 0; i < world.count && receiverStatic; i++)
        receiverStatic = (Math.round(world.data[i * 16 + 11]) & 15) === 0;
      receiverWorld = world;
      receiverMetadata = world.renderMetadata;
    }
    const reuse =
      receiverStatic && !world.anim && normalRows?.length === world.count * 8 && state.frame.changedRows?.length === 0;
    const rows = normalRows?.length === world.count * 8 ? normalRows : new Float32Array(world.count * 8);
    if (!reuse) {
      const sample = K.splatFrames.create(world, time, K.M);
      for (let i = 0; i < world.count; i++) {
        const q = i * 8,
          o = i * 16,
          f = sample(i),
          n = f.normal,
          p = f.position();
        if ((Math.round(world.data[o + 11]) & 15) !== 0) receiverStatic = false;
        rows.set([...p, world.data[o + 3], ...(n ?? [0, 0, 0]), world.data[o + 7]], q);
        if (Math.round(world.data[o + 11]) & (32 | 64 | 256) || !n) rows[q + 3] = 0;
      }
    }
    normalRows = rows;
    const posesChanged = !same(lastPoses, rows),
      base = baseActive ? baseRows : null;
    if (
      !posesChanged &&
      same(lastLights, state.rows) &&
      (base === null ? lastBase === null : same(lastBase, base)) &&
      lastFactorShadow === grid
    ) {
      textureUnit(21, factorTexture);
      return true;
    }
    if (posesChanged) {
      receivers.upload(rows);
      lastPoses = rows.slice();
    }
    const previousLights = lastLights,
      allChanged = posesChanged || lastFactorShadow !== grid;
    lastLights = state.rows.slice();
    lastBase = base?.slice() ?? null;
    lastFactorShadow = grid;
    if (!baseActive) textureUnit(21, blankBase);
    const size = [512, Math.max(1, Math.ceil(world.count / 512))],
      vertex = `#version 300 es
precision highp float;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
    bakeProgram ??= resources.program(
      vertex,
      `#version 300 es
precision highp float;${emitterGLSL}
uniform highp sampler2D u_eReceivers;uniform int u_eReceiverCount;out vec4 color;void main(){ivec2 p=ivec2(gl_FragCoord.xy);int i=p.x+p.y*512;if(i>=u_eReceiverCount){color=vec4(0);return;}vec4 at=texelFetch(u_eReceivers,ivec2(p.x*2,p.y),0),n=texelFetch(u_eReceivers,ivec2(p.x*2+1,p.y),0);color=vec4(at.w>0.0?eLighting(at.xyz,normalize(n.xyz),false,vec3(0)):vec3(0),1);}`
    );
    program ??= resources.program(
      vertex,
      `#version 300 es
precision highp float;${emitterGLSL}
uniform highp sampler2D u_eReceivers,u_eBase;uniform highp sampler2DArray u_eBaked;uniform bool u_eHasBase;uniform int u_eReceiverCount;out vec4 color;void main(){ivec2 p=ivec2(gl_FragCoord.xy);int i=p.x+p.y*512;if(i>=u_eReceiverCount){color=vec4(0);return;}vec4 n=texelFetch(u_eReceivers,ivec2(p.x*2+1,p.y),0),base=u_eHasBase?texelFetch(u_eBase,p,0):vec4(1,1,1,0);vec3 light=vec3(0);for(int j=0;j<32;j++){if(j>=u_eCount)break;light+=texelFetch(u_eBaked,ivec3(p,j),0).rgb;}vec3 rgb=vec3(mod(n.w,256.0),mod(floor(n.w/256.0),256.0),floor(n.w/65536.0))/255.0,lit=eSRGB(min(vec3(1),eLinear(rgb)*(vec3(1)+light)));color=vec4(lit/max(rgb,vec3(.00001))*(base.w>0.0?base.rgb:vec3(1)),1);}`
    );
    let refreshAll = allChanged;
    gl.activeTexture(gl.TEXTURE0 + 30);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, bakedTexture);
    if (!same(bakedSize, [...size, state.count])) {
      if (size[0] * size[1] * state.count > 16777216)
        throw new RangeError('Emitter receiver lighting exceeds its texel budget');
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA16F, ...size, Math.max(1, state.count), 0, gl.RGBA, gl.FLOAT, null);
      bakedSize = [...size, state.count];
      refreshAll = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, factorBuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, ...size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(vao);
    gl.useProgram(bakeProgram.p);
    bakeProgram.set({ ...state.uniforms, u_eReceivers: 28, u_eReceiverCount: world.count });
    for (let i = 0; i < state.count; i++) {
      if (!refreshAll && same(previousLights?.subarray(i * 44, i * 44 + 44), state.rows.subarray(i * 44, i * 44 + 44)))
        continue;
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, bakedTexture, 0, i);
      bakeProgram.set({ u_ePick: i + 1 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!same(factorSize, size)) {
      textureUnit(30, factorTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ...size, 0, gl.RGBA, gl.FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, factorBuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, factorTexture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Emitter lighting target is incomplete');
      factorSize = size;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, factorBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, factorTexture, 0);
    gl.viewport(0, 0, ...size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(program.p);
    program.set({
      ...state.uniforms,
      u_eReceivers: 28,
      u_eBaked: 30,
      u_eBase: 21,
      u_eHasBase: +baseActive,
      u_eReceiverCount: world.count
    });
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    textureUnit(21, factorTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }
  return { prepare, compose, fog };
}
