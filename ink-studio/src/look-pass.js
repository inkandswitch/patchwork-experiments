// Ink's look over a host image: upstream's own palette resolve (POST_FS, plain
// path) run on a picture the host drew, at art resolution, in one ink world's
// palette and look settings. Palette snap, Bayer dither, tone and colour grade
// always; hole fill, outlines, part lines and contact shade only with a depth.
//
// Mirrors upstream (shapeshift-labs-ink-studio c883375, pristine line numbers),
// to re-check on an upstream update:
//   src/webgl/shaders.mjs   pixelShaderSources(PixelLook, { packedTone: true })
//                           .POST_VS / .POST_FS: the program itself (:687-:1228)
//   src/webgl/renderer.mjs  :31-37    rgb() and palette(): u_pal as 64 sRGB triples
//                           :106      pixelSources() defaults (packedTone: true)
//                           :275-282  fullscreen(): one triangle, empty VAO
//                           :284-311  prepareTone(): stops in row 0, thresholds below
//                           :955-958  framePalette(): tone definition and grade
//                           :1041,:1062-1063  look.outline / look.lines
//                           :1105-1129  the resolve's uniforms, plain path
//                                       (not colored, no pixel materials, sprites,
//                                       paint, water, glass, cleanup or bypass)
//   src/webgl/shaders.mjs   :449-454 and render-graph.mjs:41  packed depth (24-bit dn
//                           in rgb, a = valid), decoded here into u_depth.r
// Upstream reads u_depth.r as depth normalized in the camera's depthRange (1 =
// nothing there), .g as glass thickness and .b as carried light; both are 0 here.

import { pixelShaderSources } from "../vendor/ink-studio/src/webgl/shaders.mjs";
import { createResources } from "../vendor/ink-studio/src/webgl/resources.mjs";

const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];

function palette(values, max = 64) {
  const result = new Float32Array(max * 3);
  for (let i = 0; i < Math.min(max, values.length); i++) result.set(rgb(values[i]), i * 3);
  return result;
}

const UNPACK_FS = `#version 300 es
precision highp float;
uniform highp sampler2D u_packed;
out vec4 o;
void main() {
  vec4 d = texelFetch(u_packed, ivec2(gl_FragCoord.xy), 0);
  float n = dot(round(d.rgb * 255.0), vec3(1.0, 256.0, 65536.0)) / 16777215.0;
  o = vec4(d.a < 0.5 ? 1.0 : n, 0.0, 0.0, 1.0);
}`;

// Texture units this pass uses (its own program, so its own numbering).
const SCENE = 0, DEPTH = 1, TONE = 2, FLOAT_DUMMY = 3, INT_DUMMY = 4, UINT_DUMMY = 5;

export function createLookPass(gl, toolkit) {
  const PixelLook = toolkit?.PixelLook;
  if (typeof PixelLook?.glsl !== "string") throw new TypeError("createLookPass needs the ink toolkit with PixelLook");
  const blueNoise = toolkit.KIT?.procedural?.materials?.blueNoise;
  const resources = createResources(gl);
  try {
    const sources = pixelShaderSources(PixelLook, { packedTone: true });
    const resolve = resources.program(sources.POST_VS, sources.POST_FS);
    const unpack = resources.program(sources.POST_VS, UNPACK_FS);
    const vao = resources.allocate("VertexArray");
    const floatDepth = !!gl.getExtension("EXT_color_buffer_float");

    // Every sampler the program declares gets a unit: ours, or a 1×1 texture
    // of the matching kind (a float/int mismatch is a draw error in WebGL).
    const supplied = { u_scene: SCENE, u_crispScene: SCENE, u_depth: DEPTH, u_crispDepth: DEPTH, u_toneStops: TONE };
    const dummyUnit = { [gl.SAMPLER_2D]: FLOAT_DUMMY, [gl.INT_SAMPLER_2D]: INT_DUMMY, [gl.UNSIGNED_INT_SAMPLER_2D]: UINT_DUMMY };
    const samplers = {};
    for (let i = 0, n = gl.getProgramParameter(resolve.p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const { name, type } = gl.getActiveUniform(resolve.p, i);
      if (![gl.SAMPLER_2D, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY].includes(type)) continue;
      if (name in supplied) samplers[name] = supplied[name];
      else if (type in dummyUnit) samplers[name] = dummyUnit[type];
      else throw new Error("Ink look pass: unexpected sampler " + name + " in the upstream resolve");
    }

    const toneTexture = resources.texture();
    const dummies = [
      [FLOAT_DUMMY, resources.texture(), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)],
      [INT_DUMMY, resources.texture(), gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, new Int32Array(4)],
      [UINT_DUMMY, resources.texture(), gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, new Uint32Array(4)]
    ];
    withUnpack(() => {
      for (const [, texture, internal, format, kind, data] of dummies) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, format, kind, data);
      }
    });

    const depthTexture = resources.texture(), depthBuffer = resources.allocate("Framebuffer");
    const colorTexture = resources.texture(), colorBuffer = resources.allocate("Framebuffer");
    let depthSize = [0, 0], colorSize = [0, 0], toneKey, tone;
    gl.bindTexture(gl.TEXTURE_2D, null);

    function withUnpack(upload) {
      const settings = [
        [gl.UNPACK_ALIGNMENT, 4], [gl.UNPACK_FLIP_Y_WEBGL, false], [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
        [gl.UNPACK_ROW_LENGTH, 0], [gl.UNPACK_SKIP_PIXELS, 0], [gl.UNPACK_SKIP_ROWS, 0]
      ];
      const previous = settings.map(([kind]) => gl.getParameter(kind));
      const unpackBuffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      try {
        for (const [kind, value] of settings) gl.pixelStorei(kind, value);
        upload();
      } finally {
        settings.forEach(([kind], i) => gl.pixelStorei(kind, previous[i]));
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBuffer);
      }
    }

    function sized(texture, framebuffer, size, width, height, internal, format, kind) {
      if (size[0] === width && size[1] === height) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, kind, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("Ink look pass could not build a render target");
      size[0] = width;
      size[1] = height;
    }

    // renderer.mjs prepareTone(), with its texture on our own unit.
    function prepareTone(definition) {
      const next = JSON.stringify(definition);
      if (toneKey !== next) {
        const prepared = definition ? PixelLook.prepareTone(definition,
          blueNoise ? ({ seed }) => blueNoise({ seed }) : undefined) : null;
        if (prepared) {
          const width = Math.max(48, prepared.width), height = prepared.height + 1;
          const table = new Float32Array(width * height * 4);
          prepared.stops.forEach(([at, hex], i) => table.set([...rgb(parseInt(hex.slice(1), 16)), at], i * 4));
          for (let y = 0; y < prepared.height; y++) for (let x = 0; x < prepared.width; x++)
            table[((y + 1) * width + x) * 4] = prepared.thresholds[y * prepared.width + x];
          gl.bindTexture(gl.TEXTURE_2D, toneTexture);
          withUnpack(() => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, table));
        }
        toneKey = next;
        tone = prepared;
      }
      return tone ? { u_toneOn: 1, u_toneCut: tone.cutoff, u_toneAmt: tone.amount, u_toneN: tone.stops.length,
        u_toneThSize: [tone.width, tone.height] } : { u_toneOn: 0 };
    }

    function draw(program, framebuffer, width, height, values) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.bindVertexArray(vao);
      gl.useProgram(program.p);
      program.set(values);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function bind(unit, texture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    let disposed = false;
    return {
      apply({ world, source, width, height, target, time = 0, depth, depthRange, dither = 0.35, outline = true }) {
        if (disposed) throw new Error("The ink look pass has been disposed");
        if (!world?.pal?.length) throw new TypeError("The ink look pass needs a world with a palette");
        if (!gl.isTexture(source)) throw new TypeError("The ink look pass needs a source texture");
        if (![width, height].every(n => Number.isSafeInteger(n) && n > 0))
          throw new RangeError("The ink look pass needs a positive integer art size");
        if (!target || ![target.width, target.height].every(n => Number.isSafeInteger(n) && n > 0))
          throw new TypeError("The ink look pass needs a target { framebuffer, width, height }");
        const hasDepth = depth != null;
        if (hasDepth && (!gl.isTexture(depth) || !Array.isArray(depthRange) && !ArrayBuffer.isView(depthRange) ||
            depthRange.length !== 2 || !(depthRange[1] > depthRange[0])))
          throw new TypeError("A depth needs its depthRange [near, far] with far > near");

        const look = world.look ?? {};
        const span = hasDepth ? depthRange[1] - depthRange[0] : 1;   // upstream's 2 * camera.radius
        // renderer.mjs:955-958 (grading and tone both on: no raw, stages or coverage here)
        const paletteFrame = PixelLook.framePalette?.(world, { time }, { grading: true, tone: true }) ??
          { toneDefinition: look.tone, grade: world.anim?.grade };
        const { toneDefinition, colorGrade, grade } = paletteFrame;
        const pal = palette(world.pal), palCount = Math.min(world.pal.length, 64);
        const lineIndex = world.outline?.c ?? 0;
        const lines = hasDepth && outline && look.lines;
        const toneValues = prepareTone(toneDefinition);

        for (const test of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.SAMPLE_ALPHA_TO_COVERAGE])
          gl.disable(test);
        gl.colorMask(true, true, true, true);

        // u_depth: upstream's normalized depth in .r, 1 where nothing is there.
        if (floatDepth) sized(depthTexture, depthBuffer, depthSize, width, height, gl.R32F, gl.RED, gl.FLOAT);
        else sized(depthTexture, depthBuffer, depthSize, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
        if (hasDepth) {
          bind(0, depth);
          draw(unpack, depthBuffer, width, height, { u_packed: 0 });
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, depthBuffer);
          gl.clearBufferfv(gl.COLOR, 0, [1, 0, 0, 1]);
        }

        const direct = target.width === width && target.height === height;
        if (!direct) sized(colorTexture, colorBuffer, colorSize, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
        bind(SCENE, source);
        bind(DEPTH, depthTexture);
        bind(TONE, tone ? toneTexture : dummies[0][1]);
        for (const [unit, texture] of dummies) bind(unit, texture);
        // renderer.mjs:1105-1129, plain path
        draw(resolve, direct ? target.framebuffer ?? null : colorBuffer, width, height, {
          ...samplers, ...toneValues,
          u_pixOn: 0, u_keyOn: 0, u_sprOn: 0, u_paintOn: false, u_markA: 0,
          u_pal: pal, u_n: palCount, u_luma: 0, u_bypass: 0, u_colored: 0,
          u_dither: dither * 0.3 * (world.dither ?? 1),
          u_line: rgb(world.pal[lineIndex] ?? 0),
          u_remapLine: colorGrade && Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < palCount ? lineIndex + 1 : 0,
          u_edge: hasDepth && outline ? (world.outline?.edge ?? 0) / span : 0,
          u_lines: +!!lines, u_lineGap: lines ? (lines.gap ?? 0.3) / span : 1,
          u_lineK: lines ? (lines.k ?? 0.55) : 1, u_lineLit: lines ? (lines.lit ?? 1.15) : 1,
          u_refract: world.refract ?? 6,
          u_ao: hasDepth && world.ao ? (world.ao.k ?? 0.5) : 0, u_aor: (world.ao?.range ?? 0.4) / span,
          u_gk: 0, u_bars: 0,
          u_grade: +!!grade, ...(grade ? { u_out: grade, u_outl: grade } : {})
        });
        if (!direct) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, colorBuffer);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer ?? null);
          gl.blitFramebuffer(0, 0, width, height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }

        for (const unit of [SCENE, DEPTH, TONE, FLOAT_DUMMY, INT_DUMMY, UINT_DUMMY]) bind(unit, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(null);
        gl.useProgram(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
