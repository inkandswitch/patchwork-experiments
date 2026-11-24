/* Headless scene, camera and lighting resources built with the native toolkit. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph;
  const { integer, range, vector, record, color, packed, indexed } = P.sceneGraphSupport;

  function camera(options = {}) {
    if (options.projection !== undefined && !['perspective', 'orthographic'].includes(options.projection) ||
        options.ortho !== undefined && typeof options.ortho !== 'boolean')
      throw new RangeError('Camera projection must be perspective or orthographic');
    return CameraLens.view({}, options);
  }

  function cameraTrack(definition, options = {}) {
    return K.cameraRig.compile(definition).sample(options.time ?? 0, {
      base: camera(options.base), shot: options.shot, channels: options.channels
    });
  }

  function light(kind, options = {}) {
    const { id = kind, ...settings } = options;
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Lights need a name');
    if (kind === 'sun') {
      const { direction = [-.6, .8, .4], ambient = .34, intensity = .87, shadows = true, ...rest } = settings;
      if (!vector(direction, 3) || K.V.len(direction) < 1e-8 || !range(ambient, 0, 4) ||
          !range(intensity, 0, 4) || typeof shadows !== 'boolean') throw new RangeError('Invalid directional light settings');
      return { kind, id, settings: { ...rest, direction: K.V.norm(direction), ambient, intensity, shadows } };
    }
    if (!['point', 'rectangle', 'disk', 'line'].includes(kind)) throw new RangeError('Unknown graph light kind ' + kind);
    const defaults = kind === 'point' ? { shape: 'line', size: [.005, .005], sampleGrid: 1, visible: false } :
      { shape: kind, size: [1, .6] };
    const area = { ...defaults, at: [0, 2, 3], ...settings, id, shape: defaults.shape };
    AreaLights.prepare([area]);
    return { kind, id, settings: area };
  }

  function lightOptions(lights) {
    if (!Array.isArray(lights) || lights.length > 17) throw new RangeError('Invalid scene light list');
    let sun;
    const areaLights = [], ids = new Set();
    for (const row of lights) {
      if (!record(row) || typeof row.id !== 'string' || ids.has(row.id) || !record(row.settings))
        throw new TypeError('Scene lights need unique IDs and authored settings');
      ids.add(row.id);
      if (row.kind === 'sun') {
        if (sun) throw new RangeError('The scene accepts one directional sun');
        sun = light(row.kind, { ...row.settings, id: row.id }).settings;
      } else if (['point', 'rectangle', 'disk', 'line'].includes(row.kind)) {
        areaLights.push({ ...row.settings, id: row.id });
      } else throw new RangeError('Unknown graph light kind ' + row.kind);
    }
    AreaLights.prepare(areaLights);
    return { ...(sun && { liveSun: sun }), ...(areaLights.length && { areaLights }) };
  }

  function object(source, { id = 'object', material = id, color: tint, resolution = .075, cells = 52, thickness,
    emissive = false } = {}) {
    if (typeof id !== 'string' || !id.trim() || typeof material !== 'string' || !material.trim() ||
        !range(resolution, .0001, 1e3) || !integer(cells, 8, 112) ||
        thickness !== undefined && !range(thickness, 0, 1000) || typeof emissive !== 'boolean')
      throw new RangeError('Invalid scene object resolution, thickness, cells or labels');
    const mesh = indexed(source);
    if (tint !== undefined) {
      mesh.vcol = null;
      mesh.tmat.fill(0);
      mesh.mats = [{ name: material, rgb: color(tint) }];
    }
    return { mesh, id, material, resolution, cells, ...(thickness !== undefined && { thickness }), emissive };
  }

  function area(mesh) {
    const { tri, pos } = mesh;
    let total = 0;
    for (let i = 0; i < tri.length; i += 3) {
      const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
      const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      total += .5 * K.V.len(K.V.cross(u, v));
    }
    return total;
  }

  function world(objects, { seed = 0, lights = [], camera: view, background = '#171d30', look = {},
    palette: authoredPalette, style = {}, surfaces } = {}) {
    if (!Array.isArray(objects) || !integer(objects.length, 1, 32) || !Number.isSafeInteger(seed) ||
        !record(look) || !record(style)) throw new RangeError('Scene needs 1 to 32 mesh objects and finite settings');
    const rows = Array.from(objects, row => object(row?.mesh, row)), ids = new Set(rows.map(row => row.id));
    if (ids.size !== rows.length) throw new RangeError('Scene mesh objects need unique IDs');
    let work = 0, triangles = 0, fieldCells = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const backgroundHex = packed(color(background));
    const palette = [backgroundHex];
    if (authoredPalette !== undefined) {
      if (!P.graphTypes.validator('palette')(authoredPalette)) throw new RangeError('Invalid scene palette');
      const values = authoredPalette.palette ?? authoredPalette;
      for (const entry of Array.from(values)) {
        const hex = typeof entry === 'number' ? entry : packed(color(entry));
        if (palette.length < 256 && !palette.includes(hex)) palette.push(hex);
      }
    }
    const views = rows.map(row => {
      const { mesh, resolution, cells } = row, { lo, hi } = K.mesh.box(mesh), surface = area(mesh);
      if (!(surface > 0) || (work += surface / (.8 * resolution ** 2)) > 220000 ||
          (triangles += mesh.tri.length / 3) > 180000 || (fieldCells += (cells + 7) ** 3) > 12000000)
        throw new RangeError('Scene mesh bake exceeds its surface or field budget');
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(lo[axis], min[axis]);
        max[axis] = Math.max(hi[axis], max[axis]);
      }
      const view = K.mesh.look(mesh, { bg: backgroundHex, hues: 8, shades: 5 });
      if (authoredPalette === undefined) for (const hex of view.pal.slice(1))
        if (palette.length < 256 && !palette.includes(hex)) palette.push(hex);
      return view;
    });
    if (palette.length < 2) palette.push(backgroundHex === 0xffffff ? 0 : 0xffffff);
    const target = min.map((n, i) => (n + max[i]) / 2), radius = Math.max(.5, K.V.dist(min, max) / 2);
    const light = lightOptions(lights);
    const { ambient = .38, sky = .24, sunStrength = .63, direction = [-.58, .8, .42] } = style;
    if (![ambient, sky, sunStrength].every(n => range(n, 0, 4)) || !vector(direction, 3) || K.V.len(direction) < 1e-8)
      throw new RangeError('Invalid baked scene lighting');
    const B = makeBuilder(seed, palette), S = makeSculpt(B);
    S.keepRenderSdf = Boolean(SdfAssist.prepare(look.sdfAssist));
    S.sun = K.V.norm(direction);
    S.amb = ambient;
    S.sky = sky;
    S.sunK = sunStrength;
    for (const [i, row] of rows.entries()) {
      const field = K.mesh.field(row.mesh, { cells: row.cells, thick: row.thickness });
      // Resolve the sampled face hue into the world palette while retaining object and material ownership.
      const baked = views[i];
      const ramps = baked.ramps.map(ramp => ramp.map(slot => {
        const hex = baked.pal[slot], rgb = [hex >> 16, hex >> 8 & 255, hex & 255];
        let best = Infinity, index = 1;
        for (let i = 1; i < palette.length; i++) {
          const candidate = palette[i];
          const d = (rgb[0] - (candidate >> 16)) ** 2 + (rgb[1] - (candidate >> 8 & 255)) ** 2 + (rgb[2] - (candidate & 255)) ** 2;
          if (d < best) { best = d; index = i; }
        }
        return index;
      }));
      const mat = { r: ramps[0], materialId: row.material, em: row.emissive, tex(x, y, z, _ny, level) {
        const face = field.tri(x, y, z), ramp = ramps[face < 0 ? 0 : baked.triHue[face]];
        return ramp[K.clamp(Math.floor(level * ramp.length), 0, ramp.length - 1)];
      } };
      K.mesh.solid(S, row.mesh, mat, { field, res: row.resolution, objectId: row.id });
    }
    S.bake();
    return B.finish({ ...light, radius, dither: 0, look: { splatCoverage: 'continuous', ...look },
      cam: camera({ target, dist: Math.max(1, radius * 3.65), yaw: .36, pitch: .18, ...view }),
      ...(surfaces && { spriteSurfaces: surfaces }) });
  }

  Object.assign(A, { camera, cameraTrack, light, lightOptions, object, world });
})(KIT);
