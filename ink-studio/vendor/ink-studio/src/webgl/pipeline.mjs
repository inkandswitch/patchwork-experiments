import { createResources } from './resources.mjs';
import { splatShaderSources } from './shaders.mjs';

function plainVertex(source) {
  return source
    .replace('if (u_lampN > 0 &&', 'if (false &&')
    .replace('if (u_fineOn > 0.5 && plain', 'if (false && plain')
    .replace('if (i >= u_azn) break;', 'break;');
}

export function createSplatPipeline(gl, { ascii, specialize = true, sampleCoverage, coverageRules, stableDetail, cutaway, airflow } = {}) {
  const resources = createResources(gl);
  try {
    const { vertex, fragment } = splatShaderSources(ascii, sampleCoverage, { coverageRules, stableDetail, airflow });
    const full = resources.program(vertex, fragment);
    const variants = new Map();
    let plain, plainUnavailable = false, subset;
    let disposed = false;
    let orderCapacity = 0, orderCount = 0, hasReferences = false;
    const vao = resources.allocate('VertexArray');
    gl.bindVertexArray(vao);
    const cornerBuffer = resources.allocate('Buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const orderBuffer = resources.allocate('Buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, orderBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.INT, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    function check() {
      if (disposed) throw new Error('The Ink Studio splat pipeline has been disposed');
    }
    return {
      // Hosts may supply their own VAO or draw order. All three flags must
      // explicitly be false before the shader can omit their work.
      programFor(features) {
        check();
        if (features?.water || features?.portal || features?.instances || features?.contributions ||
            features?.masked || features?.layeredGlass || features?.materialStyles || features?.environment || features?.relighting || features?.optical || features?.cutaway || features?.hostDepth) {
          const water = Boolean(features.water), portal = Boolean(features.portal);
          const airPockets = Boolean(features.airPockets), layered = Boolean(features.layered), atlas = Boolean(features.atlas);
          const instances = Boolean(features.instances);
          const contributions = Boolean(features.contributions), masked = Boolean(features.masked), textured = Boolean(features.textured);
          const layeredGlass = Boolean(features.layeredGlass), materialStyles = Boolean(features.materialStyles);
          const environment = Boolean(features.environment),emitterFog=Boolean(features.emitterFog);
          const relighting = Boolean(features.relighting), optical = Boolean(features.optical);
          const key = +airPockets + 2 * layered + 4 * atlas + 8 * water + 16 * portal + 32 * instances +
            64 * contributions + 128 * masked + 256 * textured + 512 * layeredGlass + 1024 * materialStyles +
            2048 * environment + 4096 * relighting + 8192 * optical + 16384 * Boolean(features.cutaway)+32768*emitterFog+65536*Boolean(features.hostDepth);
          if (!variants.has(key)) {
            const shader = splatShaderSources(ascii, sampleCoverage, { water, airPockets, layered, atlas, portal, instances,
              contributions, masked, textured, layeredGlass, coverageRules, materialStyles, environment,emitterFog, relighting, optical, stableDetail, airflow, cutaway:features.cutaway ? cutaway : undefined, hostDepth:Boolean(features.hostDepth) });
            variants.set(key, resources.program(shader.vertex, shader.fragment));
          }
          return variants.get(key);
        }
        if (!specialize || plainUnavailable || features?.lamps !== false ||
            features.fine !== false || features.textZones !== false) return full;
        if (!plain) {
          try {
            plain = resources.program(plainVertex(vertex), fragment);
          } catch (error) {
            if (gl.isContextLost()) throw error;
            plainUnavailable = true;
            return full;
          }
        }
        return plain;
      },
      setOrder(indices, references = false) {
        check();
        if (!(indices instanceof Int32Array) || references && indices.length % 2)
          throw new TypeError('Draw order must be an Int32Array with the selected stride');
        gl.bindBuffer(gl.ARRAY_BUFFER, orderBuffer);
        if (indices.byteLength > orderCapacity) {
          gl.bufferData(gl.ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
          orderCapacity = indices.byteLength;
        } else if (indices.length) gl.bufferSubData(gl.ARRAY_BUFFER, 0, indices);
        if (references !== hasReferences) {
          gl.bindVertexArray(vao);
          gl.vertexAttribIPointer(1, 1, gl.INT, references ? 8 : 0, 0);
          if (references) {
            gl.enableVertexAttribArray(2);
            gl.vertexAttribIPointer(2, 1, gl.INT, 8, 4);
            gl.vertexAttribDivisor(2, 1);
          } else gl.disableVertexAttribArray(2);
          gl.bindVertexArray(null);
          hasReferences = references;
        }
        orderCount = indices.length / (references ? 2 : 1);
      },
      // The host sets the framebuffer, program uniforms, and blend state.
      draw(count = orderCount, geometry = vao) {
        check();
        if (!Number.isInteger(count) || count < 0 || (geometry === vao && count > orderCount))
          throw new RangeError('Invalid splat draw count');
        if (!count) return;
        gl.bindVertexArray(geometry);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      },
      drawSubset(indices) {
        check();
        if (!(indices instanceof Int32Array)) throw new TypeError('Subset order must be an Int32Array');
        if (!indices.length) return;
        if (!subset) {
          subset={vao:resources.allocate('VertexArray'),buffer:resources.allocate('Buffer')};
          gl.bindVertexArray(subset.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER,cornerBuffer);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
          gl.bindBuffer(gl.ARRAY_BUFFER,subset.buffer);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribIPointer(1,1,gl.INT,0,0);
          gl.vertexAttribDivisor(1,1);
        }
        if (subset.indices !== indices) {
          gl.bindBuffer(gl.ARRAY_BUFFER,subset.buffer);
          gl.bufferData(gl.ARRAY_BUFFER,indices,gl.DYNAMIC_DRAW);
          subset.indices=indices;
        }
        gl.bindVertexArray(subset.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,indices.length);
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
