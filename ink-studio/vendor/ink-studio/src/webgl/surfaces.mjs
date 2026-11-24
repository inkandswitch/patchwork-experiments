import { environmentMediaSource } from './environment-shaders.mjs';
import { emitterGLSL } from './light-emitters.mjs';
import { waterGLSL } from './water-optics.mjs';
import { createResources } from './resources.mjs';

// Opaque pixel cutouts share an atlas and depth buffer with the splat pass.
export function createSurfacePipeline(gl, { updatesSince, geometryUpdatesSince, cutaway } = {}) {
  const resources = createResources(gl);
  try {
    const shaders = new Map();
    function shaderFor(wet, section, lighting, environment) {
      const key = [
        wet?.airPockets,
        wet?.layered,
        wet?.atlas,
        !!wet,
        !!section,
        !!lighting,
        !!environment?.media,
        !!environment?.lit
      ].join('/');
      if (shaders.has(key)) return shaders.get(key);
      const shader = resources.program(
        `#version 300 es
precision highp float;
layout(location=0) in vec3 a_point;
layout(location=1) in vec2 a_texel;
uniform mat4 u_view,u_proj;
out vec2 v_texel;
out vec3 v_world;
${lighting ? 'layout(location=2)in vec2 a_light;out vec2 v_light;' : ''}
out float v_depth;
out vec3 v_camera;
void main(){
  vec4 p=u_view*vec4(a_point,1.0);
  ${lighting ? 'v_light=a_light;' : ''}
  v_texel=a_texel;v_world=a_point;v_depth=-p.z;v_camera=p.xyz;
  gl_Position=u_proj*p;
}`,
        `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec4 u_range,u_splatPlane;
${wet ? waterGLSL(wet.airPockets, wet.layered, wet.atlas) : 'uniform vec4 u_arrivalPlane;'}
uniform vec2 u_surfaceViewport;
uniform vec3 u_fog;
uniform bool u_index, u_graphDepth;
${section ? cutaway : ''}
${environment?.media ? environmentMediaSource(environment.lit) : ''}
${lighting ? emitterGLSL : ''}
${lighting ? 'uniform highp sampler2DArray u_surfaceLit;uniform int u_surfaceLightCount;in vec2 v_light;' : ''}
in vec2 v_texel;
in vec3 v_world;
in float v_depth;
in vec3 v_camera;
layout(location=0) out vec4 color;
layout(location=1) out vec4 depth;
layout(location=2) out vec4 water;
void main(){
  vec4 ink=texelFetch(u_atlas,ivec2(v_texel),0);
  if(ink.a<.5||dot(u_arrivalPlane,vec4(v_world,1.0))<0.0||dot(u_splatPlane,vec4(v_camera,1.0))<0.0)discard;
  ${section ? 'float margin=sectionMargin(v_world,v_depth); if(margin<0.0)discard;' : ''}
  float d=clamp((v_depth-u_range.x)/(u_range.y-u_range.x),0.0,1.0);
  float fog=u_range.z<1.0?smoothstep(u_range.z,1.0,d)*u_range.w:0.0;
  vec3 mark=vec3(0.0), rgb=ink.rgb;
  ${lighting ? 'if(!u_index){vec3 irradiance=vec3(0);for(int i=0;i<32;i++){if(i>=u_surfaceLightCount)break;irradiance+=texelFetch(u_surfaceLit,ivec3(ivec2(v_light),i),0).rgb;}rgb=eSRGB(min(vec3(1),eLinear(rgb)*(vec3(1)+irradiance)));}' : ''}
  ${wet ? 'if(!u_index)rgb=waterPaint(rgb,gl_FragCoord.xy,u_surfaceViewport,v_depth,mark);' : ''}
  ${environment?.media ? 'if(!u_index)rgb=envMedia(rgb,gl_FragCoord.xy,u_surfaceViewport,v_depth);' : ''}
  rgb=mix(rgb,u_fog,fog);
  ${section ? 'rgb=mix(rgb,u_sectionEdge.rgb,sectionInk(margin));' : ''}
  color=u_index?vec4(0.0):vec4(rgb,1.0);
  depth=vec4(d,0.0,0.0,1.0);water=vec4(mark,1.0);
  if(u_index&&u_graphDepth){float z=round(d*16777215.0);water=vec4(mod(z,256.0),mod(floor(z/256.0),256.0),floor(z/65536.0),255.0)/255.0;}
}`
      );
      shaders.set(key, shader);
      return shader;
    }
    const vao = resources.allocate('VertexArray'),
      buffer = resources.allocate('Buffer'),
      texture = resources.texture();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    let active,
      activeVertices,
      revision = -1,
      geometryRevision = -1,
      width = 0,
      height = 0,
      disposed = false,
      staging = new Uint8Array(0);
    const stats = { textureBytes: 0, geometryBytes: 0 };
    function upload(atlas) {
      stats.textureBytes = 0;
      stats.geometryBytes = 0;
      if (disposed) throw new Error('Surface pipeline has been disposed');
      const next = atlas?.revision ?? 0,
        nextGeometry = atlas?.geometryRevision ?? 0;
      if (
        active === atlas &&
        revision === next &&
        geometryRevision === nextGeometry &&
        activeVertices === atlas.vertices &&
        width === atlas.width &&
        height === atlas.height
      )
        return;
      if (
        !atlas ||
        !(atlas.vertices instanceof Float32Array) ||
        atlas.vertices.length % 15 ||
        !Number.isSafeInteger(atlas.width) ||
        atlas.width < 1 ||
        !Number.isSafeInteger(atlas.height) ||
        atlas.height < 1 ||
        !(atlas.pixels instanceof Uint8Array) ||
        atlas.pixels.length !== atlas.width * atlas.height * 4 ||
        !Number.isSafeInteger(next) ||
        next < 0 ||
        !Number.isSafeInteger(nextGeometry) ||
        nextGeometry < 0
      )
        throw new RangeError('Invalid sprite surface atlas');
      if (Math.max(atlas.width, atlas.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE))
        throw new RangeError('Surface atlas exceeds GPU size limit');
      const replace = active !== atlas || width !== atlas.width || height !== atlas.height;
      if (replace || activeVertices !== atlas.vertices) {
        if (!atlas.vertices.every(Number.isFinite)) throw new RangeError('Invalid sprite surface geometry');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, atlas.vertices, nextGeometry ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        stats.geometryBytes = atlas.vertices.byteLength;
      }
      if (!replace && activeVertices === atlas.vertices && geometryRevision !== nextGeometry) {
        const changes = geometryUpdatesSince?.(atlas, geometryRevision);
        const first = changes?.length ? Math.min(...changes.map(r => r.first)) : 0,
          end = changes?.length ? Math.max(...changes.map(r => r.first + r.count)) : atlas.vertices.length / 5;
        const values = atlas.vertices.subarray(first * 5, end * 5);
        if (!values.every(Number.isFinite)) throw new RangeError('Invalid sprite surface geometry');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, first * 20, values);
        stats.geometryBytes = values.byteLength;
      }
      gl.activeTexture(gl.TEXTURE0 + 6);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (replace) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          atlas.width,
          atlas.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          atlas.pixels
        );
        stats.textureBytes = atlas.pixels.byteLength;
      } else if (revision !== next) {
        const changes = updatesSince?.(atlas, revision);
        let x = 0,
          y = 0,
          w = atlas.width,
          h = atlas.height;
        if (changes?.length) {
          x = Math.min(...changes.map(r => r.x));
          y = Math.min(...changes.map(r => r.y));
          w = Math.max(...changes.map(r => r.x + r.width)) - x;
          h = Math.max(...changes.map(r => r.y + r.height)) - y;
        }
        const bytes = w * h * 4;
        if (staging.length < bytes) staging = new Uint8Array(bytes);
        for (let row = 0; row < h; row++)
          staging.set(
            atlas.pixels.subarray(((y + row) * atlas.width + x) * 4, ((y + row) * atlas.width + x + w) * 4),
            row * w * 4
          );
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, staging.subarray(0, bytes));
        stats.textureBytes = bytes;
      }
      active = atlas;
      activeVertices = atlas.vertices;
      revision = next;
      geometryRevision = nextGeometry;
      width = atlas.width;
      height = atlas.height;
    }
    let lightProgram,
      lightTexture,
      lightBuffer,
      lightSize = [],
      lightKey,
      lightRows,
      lastSide,
      lightGeometry,
      lightRevision,
      lightPositions,
      lightCount,
      lightResolution;
    const lightVAO = resources.allocate('VertexArray'),
      lightInstanceBuffer = resources.allocate('Buffer'),
      lightUVBuffer = resources.allocate('Buffer');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lightUVBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(lightVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, lightInstanceBuffer);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    function shadeAtlas(atlas, lighting, view) {
      const resolution = lighting.frame.emitterSurfaceResolution ?? 16;
      if (!Number.isSafeInteger(resolution) || resolution < 4 || resolution > 64)
        throw new RangeError('Surface light resolution must be 4..64');
      const columns = Math.min(64, Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE) / resolution));
      if (
        lightGeometry !== atlas.vertices ||
        lightRevision !== (atlas.geometryRevision ?? 0) ||
        lightResolution !== resolution
      ) {
        lightResolution = resolution;
        lightCount = atlas.vertices.length / 15;
        lightPositions = new Float32Array(lightCount * 9);
        const uv = new Float32Array(lightCount * 6);
        for (let i = 0; i < lightCount; i++) {
          const x = (i % columns) * resolution,
            y = Math.floor(i / columns) * resolution;
          for (let j = 0; j < 3; j++) {
            lightPositions.set(atlas.vertices.subarray(i * 15 + j * 5, i * 15 + j * 5 + 3), i * 9 + j * 3);
            uv.set([x + 0.5 + (j === 1 ? resolution - 1 : 0), y + 0.5 + (j === 2 ? resolution - 1 : 0)], i * 6 + j * 2);
          }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, lightInstanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lightPositions, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, lightUVBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
        lightGeometry = atlas.vertices;
        lightRevision = atlas.geometryRevision ?? 0;
      }
      const eye = [0, 1, 2].map(
        k => -(view[k * 4] * view[12] + view[k * 4 + 1] * view[13] + view[k * 4 + 2] * view[14])
      );
      let side = 0;
      for (let i = 0; i < lightPositions.length; i += 9) {
        const a = lightPositions.subarray(i, i + 3),
          u = [0, 1, 2].map(k => lightPositions[i + 3 + k] - a[k]),
          v = [0, 1, 2].map(k => lightPositions[i + 6 + k] - a[k]),
          n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        side = (Math.imul(side, 31) + (n.reduce((s, v, k) => s + v * (eye[k] - a[k]), 0) < 0 ? 1 : 0)) | 0;
      }
      const key = [lightGeometry, lightRevision, lighting.shadow, resolution];
      const same = (a, b) => a?.length === b.length && b.every((v, i) => v === a[i]);
      if (same(lightKey, key) && same(lightRows, lighting.rows) && side === lastSide) {
        gl.activeTexture(gl.TEXTURE0 + 24);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lightTexture);
        return;
      }
      let allChanged = !same(lightKey, key) || side !== lastSide;
      const previous = lightRows;
      lightKey = key;
      lightRows = lighting.rows.slice();
      lastSide = side;
      if (!lightTexture) {
        lightTexture = resources.allocate('Texture');
        gl.activeTexture(gl.TEXTURE0 + 24);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lightTexture);
        for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
        for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE);
      }
      lightBuffer ??= resources.allocate('Framebuffer');
      gl.activeTexture(gl.TEXTURE0 + 24);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, lightTexture);
      const size = [columns * resolution, Math.max(1, Math.ceil(lightCount / columns)) * resolution];
      if (size[1] > gl.getParameter(gl.MAX_TEXTURE_SIZE))
        throw new RangeError('Surface lighting charts exceed the GPU atlas budget');
      if (lightSize[0] !== size[0] || lightSize[1] !== size[1] || lightSize[2] !== lighting.count) {
        if (size[0] * size[1] * lighting.count > 16777216)
          throw new RangeError('Surface lighting cache exceeds its texel budget');
        gl.texImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          gl.RGBA16F,
          ...size,
          Math.max(1, lighting.count),
          0,
          gl.RGBA,
          gl.FLOAT,
          null
        );
        lightSize = [...size, lighting.count];
        allChanged = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightBuffer);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, lightTexture, 0, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Surface lightmap target is incomplete');
      lightProgram ??= resources.program(
        `#version 300 es
precision highp float;layout(location=0)in vec3 a_a;layout(location=1)in vec3 a_b;layout(location=2)in vec3 a_c;uniform vec2 u_lightSize;uniform float u_lightResolution;uniform int u_lightColumns;uniform vec3 u_surfaceEye;out vec3 v_world;flat out vec3 v_normal;void main(){vec2 q=vec2(gl_VertexID&1,gl_VertexID>>1);vec2 uv=(q*u_lightResolution-.5)/(u_lightResolution-1.0);v_world=a_a+(a_b-a_a)*uv.x+(a_c-a_a)*uv.y;v_normal=normalize(cross(a_b-a_a,a_c-a_a));if(dot(v_normal,u_surfaceEye-a_a)<0.0)v_normal=-v_normal;vec2 tile=vec2(gl_InstanceID%u_lightColumns,gl_InstanceID/u_lightColumns)*u_lightResolution;gl_Position=vec4((tile+q*u_lightResolution)/u_lightSize*2.0-1.0,0,1);}`,
        `#version 300 es
precision highp float;${emitterGLSL}
in vec3 v_world;flat in vec3 v_normal;out vec4 color;void main(){color=vec4(eLighting(v_world,v_normal,false,vec3(0)),1);}`
      );
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.viewport(0, 0, lightSize[0], lightSize[1]);
      gl.useProgram(lightProgram.p);
      lightProgram.set({
        ...lighting.uniforms,
        u_lightSize: lightSize.slice(0, 2),
        u_lightColumns: columns,
        u_lightResolution: resolution,
        u_surfaceEye: eye
      });
      gl.bindVertexArray(lightVAO);
      for (let i = 0; i < lighting.count; i++) {
        if (!allChanged && same(previous?.subarray(i * 44, i * 44 + 44), lighting.rows.subarray(i * 44, i * 44 + 44)))
          continue;
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, lightTexture, 0, i);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
        lightProgram.set({ u_ePick: i + 1 });
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
      }
    }
    function draw(
      atlas,
      {
        lighting,
        environment,
        view,
        projection,
        range,
        fog,
        index = false,
        graphDepth = false,
        arrivalPlane = [0, 0, 0, 0],
        clip = [0, 0, 0, 0],
        water,
        wet,
        width = 1,
        height = 1,
        section
      }
    ) {
      upload(atlas);
      if (lighting?.active && !index) {
        const framebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
          viewport = gl.getParameter(gl.VIEWPORT),
          blend = gl.isEnabled(gl.BLEND),
          depth = gl.isEnabled(gl.DEPTH_TEST);
        shadeAtlas(atlas, lighting, view);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(...viewport);
        if (blend) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
        if (depth) gl.enable(gl.DEPTH_TEST);
        else gl.disable(gl.DEPTH_TEST);
      }
      gl.activeTexture(gl.TEXTURE0 + 6);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const shader = shaderFor(wet, section, !index && lighting?.active, environment);
      gl.useProgram(shader.p);
      shader.set({
        u_view: view,
        u_proj: projection,
        u_range: range,
        u_fog: fog,
        u_atlas: 6,
        u_surfaceLightCount: lighting?.count ?? 0,
        u_surfaceLit: 24,
        u_index: +index,
        u_graphDepth: graphDepth,
        u_arrivalPlane: arrivalPlane,
        u_splatPlane: clip,
        u_surfaceViewport: [width, height],
        ...water,
        ...section,
        ...environment?.uniforms,
        ...lighting?.uniforms
      });
      gl.bindVertexArray(vao);
      if (!index && lighting?.active) gl.enableVertexAttribArray(2);
      else gl.disableVertexAttribArray(2);
      gl.drawArrays(gl.TRIANGLES, 0, active.vertices.length / 5);
      gl.activeTexture(gl.TEXTURE0);
    }
    return {
      draw,
      get stats() {
        return { ...stats };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        resources.dispose();
      }
    };
  } catch (error) {
    resources.dispose();
    throw error;
  }
}
