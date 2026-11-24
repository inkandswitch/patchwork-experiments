/* UV-addressed surface stamps retain texture detail and alpha independently of splat spacing. */
(function (K) {
  const A = K.authoring;
  function fitted(raw, options) {
    const asset = A.assetMeshes.validate(raw);
    const mesh = K.mesh.fit(K.mesh.make(asset.positions, asset.triangles), {
      size: options.size, at: options.at, turn: options.turn, up: options.up
    });
    // Keep UV addressing on the fitted triangles, including nonuniformly placed assets.
    const sampler = A.assetTextures.sampler({ ...asset, positions: Array.from(mesh.pos) });
    return { asset, mesh, sampler };
  }

  function splat(builder, raw, options = {}) {
    if (options.geometry === 'sdf') return sdfSplat(builder, raw, options);
    if (options.geometry !== undefined && options.geometry !== 'mesh') throw Error('Unknown asset geometry mode');
    const { V } = K;
    const { asset, mesh, sampler } = fitted(raw, options);
    const res = options.res ?? .06;
    const maxSplats = options.maxSplats ?? 250000;
    if (!(Number.isFinite(res) && res > 0) || !Number.isSafeInteger(maxSplats) || maxSplats < 1)
      throw Error('Asset surface stamps need positive spacing and a splat budget');
    const light = V.norm(options.light ?? [-.5, .8, .7]);
    const ambient = options.ambient ?? .36;
    if (!Number.isFinite(ambient) || ambient < 0 || ambient > 1) throw Error('Invalid asset ambient light');
    const triangles = [];
    let total = 0;
    for (let face = 0; face < asset.triangles.length / 3; face++) {
      const p = Array.from(mesh.tri.slice(face * 3, face * 3 + 3), i => Array.from(mesh.pos.slice(i * 3, i * 3 + 3)));
      const ab = V.sub(p[1], p[0]), ac = V.sub(p[2], p[0]);
      const cross = V.cross(ab, ac), area = V.len(cross) / 2;
      const count = Math.max(1, Math.ceil(area / (res * res * .68)));
      total += count;
      if (total > maxSplats) throw Error('Asset surface stamps exceed the splat budget');
      triangles.push({ face, p, ab, ac, normal: V.norm(cross), count });
    }
    const first = builder.count();
    for (const { face, p, ab, ac, normal, count } of triangles) {
      const uu = V.dot(ab, ab), uv = V.dot(ab, ac), vv = V.dot(ac, ac), den = uu * vv - uv * uv;
      if (den < 1e-16) continue;
      const uAxis = V.mul(V.sub(V.mul(ab, vv), V.mul(ac, uv)), 1 / den);
      const vAxis = V.mul(V.sub(V.mul(ac, uu), V.mul(ab, uv)), 1 / den);
      const settings = { layers: { atlas: {
        type: 'projected', ink: true,
        pattern({ sample }, output) {
          const q = V.sub(sample.position, p[0]);
          const u = V.dot(q, uAxis), v = V.dot(q, vAxis);
          if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) { output[4] = 0; return; }
          const material = sampler.materialAt(face, u, v, normal);
          const irradiance = ambient + (1 - ambient) * Math.max(0, V.dot(material.normal, light));
          const rgb = A.assetTextures.shade(material, { irradiance, light, view: V.norm(sample.view) });
          for (let k = 0; k < 3; k++) output[k] = rgb[k];
          output[4] = material.opacity;
        }
      } } };
      for (let i = 0; i < count; i++) {
        let u = (i + .5) / count, v = ((i + .5) * .6180339887498949) % 1;
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const point = V.add(p[0], V.add(V.mul(ab, u), V.mul(ac, v)));
        builder.surfaceNext(settings, ...normal, light, 1);
        builder.disc(...point, normal, res * .84, res * .035, builder.P[options.color ?? 1], 3);
      }
    }
    builder.describeSplats?.(first, builder.count(), { object: options.object ?? 'imported-asset', material: 'uv-atlas' });
    return { first, count: builder.count() - first, mesh };
  }

  function world(raw, options = {}) {
    const asset = A.assetMeshes.validate(raw);
    const sampler = A.assetTextures.sampler(asset);
    const colors = [], assignments = [];
    for (let face = 0; face < asset.triangles.length / 3; face++) {
      const color = sampler.at(face, 1 / 3, 1 / 3);
      colors.push({ name: 'face-' + face, rgb: color });
      assignments.push(face);
    }
    const source = K.mesh.make(asset.positions, asset.triangles, null, assignments, colors);
    const look = K.mesh.look(source, { hues: options.hues ?? 10, shades: options.shades ?? 5, bg: options.background ?? 0x070a12,
      pal: options.palette });
    const builder = makeBuilder(options.seed ?? 1, look.pal);
    const placed = splat(builder, asset, options);
    const box = K.mesh.box(placed.mesh), target = box.lo.map((x, i) => (x + box.hi[i]) / 2);
    const radius = Math.hypot(...box.hi.map((x, i) => (x - box.lo[i]) / 2));
    return builder.finish({
      cam: { target, dist: radius * 3.6, yaw: .43, pitch: .15, sway: 0, ...options.cam },
      radius: Math.max(1, radius), detail: 1 / (options.res ?? .06), dither: 0,
      look: { pixelSize: 2 }, mesh: { ...K.mesh.info(placed.mesh), mode: 'uv', geometry: options.geometry ?? 'mesh', hues: look.ramps.length },
      ...(placed.field && { sdf: { dimensions: placed.field.n, spacing: placed.field.h,
        sourceTriangles: asset.triangles.length / 3, reconstructedTriangles: placed.mesh.tri.length / 3 } })
    });
  }

  function field(raw, options = {}) {
    const { asset, mesh, sampler } = fitted(raw, options);
    const cutoff = options.alphaCutoff ?? .5;
    const cells = options.cells ?? 64;
    if (!Number.isInteger(cells) || cells < 2 || cells > 128 ||
        options.thick !== undefined && (!Number.isFinite(options.thick) || options.thick < 0))
      throw Error('Asset fields need 2–128 cells and nonnegative thickness');
    if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 1) throw Error('Invalid field alpha cutoff');
    const positions = [], triangles = [], sourceFaces = [];
    function emit(face, points, a, b, c) {
      const center = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3];
      if (sampler.opacityAt(face, ...center) < cutoff) return;
      if (triangles.length >= 600000) throw Error('Alpha field exceeds its triangle budget');
      const [origin, u, v] = points;
      const first = positions.length / 3;
      for (const [x, y] of [a, b, c]) positions.push(...K.V.add(origin, K.V.add(K.V.mul(u, x), K.V.mul(v, y))));
      triangles.push(first, first+1, first+2);
      sourceFaces.push(face);
    }
    for (let face=0; face<asset.triangles.length/3; face++) {
      const ids=Array.from(mesh.tri.slice(face*3,face*3+3));
      const p=ids.map(i=>Array.from(mesh.pos.slice(i*3,i*3+3)));
      const points=[p[0], K.V.sub(p[1],p[0]), K.V.sub(p[2],p[0])];
      const map=asset.texture?.maps[asset.texture.faces[face]];
      let steps=1;
      if (map && map.alphaMode && map.alphaMode!=='OPAQUE' && map.image!==undefined) {
        const image=asset.texture.images[map.image], uv=asset.texture.uv;
        const span=axis=>Math.max(...ids.map(i=>uv[i*2+axis]))-Math.min(...ids.map(i=>uv[i*2+axis]));
        steps=Math.min(128, Math.max(1, Math.ceil(2*Math.max(span(0)*image.width,span(1)*image.height))));
      }
      for (let i=0;i<steps;i++) for (let j=0;j<steps-i;j++) {
        const a=[i/steps,j/steps], b=[(i+1)/steps,j/steps], c=[i/steps,(j+1)/steps];
        emit(face,points,a,b,c);
        if (i+j+1<steps) emit(face,points,b,[(i+1)/steps,(j+1)/steps],c);
      }
    }
    if (!triangles.length) throw Error('Asset has no visible surface at this alpha cutoff');
    const result = K.mesh.field(K.mesh.make(positions,triangles),{cells,thick:options.thick});
    // Distance-grid ownership points into the visible patches, retaining their original UV face.
    result.sourceFaces = Int32Array.from(sourceFaces);
    result.sourcePositions = mesh.pos.slice();
    result.sourceFace = (x, y, z) => result.sourceFaces[result.tri(x, y, z)];
    return result;
  }

  function sdfSplat(builder, raw, options) {
    const placed = fitted(raw, options);
    const grid = options.field ?? field(raw, options);
    if (typeof grid.sd !== 'function' || typeof grid.sourceFace !== 'function')
      throw Error('Textured SDF stamps need an asset field with source-face ownership');
    // A supplied field owns its coordinate frame, even when the caller omits its original fit options.
    const sampler = grid.sourcePositions ? A.assetTextures.sampler({
      ...placed.asset, positions: Array.from(grid.sourcePositions)
    }) : placed.sampler;
    const res = options.res ?? .06;
    const maxSplats = options.maxSplats ?? 250000;
    if (!Number.isFinite(res) || res <= 0 || !Number.isSafeInteger(maxSplats) || maxSplats < 1)
      throw Error('Asset surface stamps need positive spacing and a splat budget');
    const light = K.V.norm(options.light ?? [-.5, .8, .7]);
    const ambient = options.ambient ?? .36;
    if (!Number.isFinite(ambient) || ambient < 0 || ambient > 1) throw Error('Invalid asset ambient light');
    const surface = { layers: { atlas: {
      type: 'projected', ink: true,
      pattern({ sample }, output) {
        const p = sample.position;
        const source = grid.sourceFace(...p);
        if (!Number.isInteger(source) || source < 0) { output[4] = 0; return; }
        const material = sampler.materialAtPoint(source, ...p, sample.normal);
        const irradiance = ambient + (1 - ambient) * Math.max(0, K.V.dot(material.normal, light));
        const rgb = A.assetTextures.shade(material, { irradiance, light, view: K.V.norm(sample.view) });
        for (let k = 0; k < 3; k++) output[k] = rgb[k];
        output[4] = material.opacity;
      }
    } } };
    const sculpt = makeSculpt(builder);
    sculpt.sun = light;
    const solid = K.sdf.solid(sculpt, grid, { r: [options.color ?? 1], surface }, {
      resolution: options.resolution ?? grid.h, maxCells: options.maxCells ?? 2000000, res
    });
    const first = builder.count();
    // Preflight the same area-sampling rule used by mesh solids before mutating the builder.
    let samples = 0;
    const { pos, tri } = solid.mesh;
    for (let i = 0; i < tri.length; i += 3) {
      const [a, b, c] = Array.from(tri.slice(i, i + 3), id => Array.from(pos.slice(id * 3, id * 3 + 3)));
      samples += K.V.len(K.V.cross(K.V.sub(b, a), K.V.sub(c, a))) / (1.6 * res * res);
    }
    if (Math.floor(samples + .5) > maxSplats) throw Error('Asset surface stamps exceed the splat budget');
    sculpt.bake();
    builder.describeSplats?.(first, builder.count(), { object: options.object ?? 'imported-asset', material: 'sdf-uv-atlas' });
    return { first, count: builder.count() - first, mesh: solid.mesh, field: grid };
  }
  A.assetSurfaces = Object.freeze({ splat, world, field });
})(KIT);
