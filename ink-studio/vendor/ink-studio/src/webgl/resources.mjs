export function createResources(gl) {
  const release = [];
  function allocate(kind) {
    const resource = gl['create' + kind]();
    if (!resource) throw new Error('Could not allocate WebGL ' + kind);
    release.push(() => gl['delete' + kind](resource));
    return resource;
  }

  function texture() {
    const value = allocate('Texture');
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return value;
  }

  function program(vertex, fragment) {
    const p = gl.createProgram();
    if (!p) throw new Error('Could not allocate WebGL program');
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Could not allocate WebGL shader');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error('Ink Studio shader compilation failed: ' + gl.getShaderInfoLog(shader));
        gl.attachShader(p, shader);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('Ink Studio program linking failed: ' + gl.getProgramInfoLog(p));

      const u = Object.create(null), setters = Object.create(null);
      const methods = {
        [gl.FLOAT]: 'uniform1f', [gl.INT]: 'uniform1i', [gl.SAMPLER_2D]: 'uniform1i', [gl.SAMPLER_3D]: 'uniform1i', [gl.SAMPLER_2D_ARRAY]: 'uniform1i',
        [gl.INT_SAMPLER_2D]: 'uniform1i', [gl.UNSIGNED_INT_SAMPLER_2D]: 'uniform1i',
        [gl.FLOAT_VEC2]: 'uniform2fv', [gl.FLOAT_VEC3]: 'uniform3fv', [gl.FLOAT_VEC4]: 'uniform4fv',
        [gl.BOOL]: 'uniform1i', [gl.BOOL_VEC2]: 'uniform2iv', [gl.BOOL_VEC3]: 'uniform3iv',
        [gl.BOOL_VEC4]: 'uniform4iv', [gl.INT_VEC2]: 'uniform2iv', [gl.INT_VEC3]: 'uniform3iv',
        [gl.INT_VEC4]: 'uniform4iv', [gl.UNSIGNED_INT]: 'uniform1ui', [gl.UNSIGNED_INT_VEC2]: 'uniform2uiv',
        [gl.UNSIGNED_INT_VEC3]: 'uniform3uiv', [gl.UNSIGNED_INT_VEC4]: 'uniform4uiv',
        [gl.FLOAT_MAT2]: 'uniformMatrix2fv', [gl.FLOAT_MAT3]: 'uniformMatrix3fv', [gl.FLOAT_MAT4]: 'uniformMatrix4fv',
        [gl.FLOAT_MAT2x3]: 'uniformMatrix2x3fv', [gl.FLOAT_MAT2x4]: 'uniformMatrix2x4fv',
        [gl.FLOAT_MAT3x2]: 'uniformMatrix3x2fv', [gl.FLOAT_MAT3x4]: 'uniformMatrix3x4fv',
        [gl.FLOAT_MAT4x2]: 'uniformMatrix4x2fv', [gl.FLOAT_MAT4x3]: 'uniformMatrix4x3fv'
      };
      for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const name = info.name.replace(/\[0\]$/, '');
        const location = u[name] = gl.getUniformLocation(p, name);
        let method = methods[info.type];
        if (info.size > 1 && ['uniform1f', 'uniform1i', 'uniform1ui'].includes(method)) method += 'v';
        if (method?.startsWith('uniformMatrix')) setters[name] = value => gl[method](location, false, value);
        else if (method) setters[name] = value => gl[method](location, value);
      }
      release.push(() => gl.deleteProgram(p));
      return {
        p, u,
        set(values) {
          for (const name of Object.keys(values)) setters[name]?.(values[name]);
        }
      };
    } catch (error) {
      gl.deleteProgram(p);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  return {
    allocate, texture, program,
    dispose() {
      for (const remove of release.splice(0).reverse()) remove();
    }
  };
}
