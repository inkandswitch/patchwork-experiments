/* View-dependent construction of bounded procedural preview assets. */
(function (K) {
  const P = K.procedural, V = K.V, { clone, freeze } = P.data;
  const finite = Number.isFinite, positive = n => finite(n) && n > 0;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const vector = (p, size) => list(p) && p.length === size && Array.from(p).every(finite);
  const check = (ok, message) => { if (!ok) throw new RangeError('Scale preview: ' + message); };
  const programs = new WeakSet();
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][\w./-]{0,95}$/.test(value);
  const axes = [0, 1, 2];
  const sides = Array.from({ length: 8 }, (_, corner) => axes.flatMap(axis =>
    corner & (1 << axis) ? [] : [[corner, corner | (1 << axis)]])).flat();

  function checkedView({ view, width, height, focal, ortho = false, near = .4, far = Infinity } = {}) {
    check(vector(view, 16) && positive(width) && positive(height) && positive(focal) && typeof ortho === 'boolean' &&
      positive(near) && (finite(far) || far === Infinity) && far > near, 'expected camera view, art dimensions and clip range');
    return { view, width, height, focal, ortho, near, far };
  }

  function camera(world, frame = {}) {
    const width = frame.width ?? frame.w, height = frame.height ?? frame.h, pixelSize = frame.pixelSize ?? frame.px ?? 1;
    check(positive(width) && positive(height) && positive(pixelSize), 'expected viewport and art pixel size');
    const artWidth = Math.ceil(width / pixelSize), artHeight = Math.ceil(height / pixelSize);
    const staging = CameraStaging.prepare(frame.cameraStaging ?? world.look?.cameraStaging);
    const sampled = CameraLens.frame(world, frame, width, height, { orbit: staging?.orbit, impulse: CameraImpulses.frame });
    const view = CameraLens.artView(sampled, artHeight, world.look?.stable, frame.stable);
    const focal = artHeight / (2 * sampled.tangent * (sampled.ortho ? sampled.dist : 1));
    return checkedView({ view, width: artWidth, height: artHeight, focal, ortho: Boolean(sampled.ortho),
      near: sampled.clipNear, far: sampled.clipFar });
  }

  function screen(bounds, basis, { view, width, height, focal, ortho, near, far }) {
    function component(p, axis) {
      return p[0] * view[axis] + p[1] * view[axis + 4] + p[2] * view[axis + 8];
    }
    const transform = p => [component(p, 0) + view[12], component(p, 1) + view[13], -(component(p, 2) + view[14])];
    const box = Array.from({ length: 8 }, (_, corner) => transform(axes.map(axis =>
      (corner & (1 << axis) ? bounds.max : bounds.min)[axis])));
    const candidates = box.filter(([, , z]) => z >= near && z <= far);
    for (const [a, b] of sides) for (const depth of [near, far]) {
      const [u, v] = [box[a], box[b]];
      if ((u[2] < depth && v[2] > depth) || (v[2] < depth && u[2] > depth)) {
        const p = V.lerp(u, v, (depth - u[2]) / (v[2] - u[2]));
        candidates.push([p[0], p[1], depth]);
      }
    }
    if (!candidates.length) return { visible: false, width: 0, height: 0, pixelsPerWorld: 0 };
    const projected = candidates.map(([x, y, z]) => [x * focal / (ortho ? 1 : z), y * focal / (ortho ? 1 : z)]);
    const [x, y] = [0, 1].map(axis => projected.map(p => p[axis]));
    const loX = Math.min(...x), hiX = Math.max(...x), loY = Math.min(...y), hiY = Math.max(...y);
    const leafDepth = Math.max(...candidates.map(p => p[2]));
    let pixelsPerWorld = focal / (ortho ? 1 : leafDepth);
    if (basis) {
      const p = transform(bounds.min.map((value, axis) => value + (bounds.max[axis] - value) / 2));
      const depth = Math.max(near, p[2]), [u, v] = basis.map(dir =>
        [0, 1].map(axis => component(dir, axis) + (ortho ? 0 : p[axis] / depth * component(dir, 2))));
      // Use the smaller singular value so a tilted chart refines only when both directions can be resolved.
      const a = u[0] * u[0] + u[1] * u[1], b = u[0] * v[0] + u[1] * v[1], c = v[0] * v[0] + v[1] * v[1];
      const tangential = Math.sqrt((a + c + Math.hypot(a - c, 2 * b)) / 2);
      pixelsPerWorld *= tangential ? Math.abs(u[0] * v[1] - u[1] * v[0]) / tangential : 0;
    }
    return { visible: loX < width / 2 && hiX > -width / 2 && loY < height / 2 && hiY > -height / 2 &&
      hiX > loX && hiY > loY, width: hiX - loX, height: hiY - loY, pixelsPerWorld };
  }

  function create({ id = 'preview', bounds, basis, levels, minPixels = 2.5, minWorldSize = 0, maxWork = Infinity } = {}) {
    check(idOK(id) && vector(bounds?.min, 3) && vector(bounds?.max, 3) && axes.every(i =>
      Math.abs(bounds.min[i]) <= 1e12 && Math.abs(bounds.max[i]) <= 1e12 && bounds.min[i] <= bounds.max[i]) &&
      axes.filter(i => bounds.max[i] > bounds.min[i]).length >= 2 &&
      Array.isArray(levels) && integer(levels.length, 1, 16) && positive(minPixels) &&
      finite(minWorldSize) && minWorldSize >= 0 && (maxWork === Infinity || integer(maxWork, 1, Number.MAX_SAFE_INTEGER)),
    'expected bounds, detail levels and positive budgets');
    const box = freeze({ min: Array.from(bounds.min), max: Array.from(bounds.max) });
    if (basis !== undefined) {
      check(Array.isArray(basis) && basis.length === 2 && Array.from(basis).every(v =>
        vector(v, 3) && Math.hypot(...v) > 1e-9 && finite(Math.hypot(...v))) && Math.abs(V.dot(V.norm(basis[0]), V.norm(basis[1]))) < 1e-7,
      'chart axes must be nonzero and perpendicular');
      basis = basis.map(v => V.norm(Array.from(v)));
    }
    const ids = new Set();
    const definitions = Array.from(levels, (row, i) => {
      const { id: key = String(i), feature, work, build } = row ?? {};
      check(idOK(key) && !ids.has(key) && positive(feature) && integer(work, 1, Number.MAX_SAFE_INTEGER) &&
        typeof build === 'function' && (!i || feature < levels[i - 1].feature && work >= levels[i - 1].work),
      'levels need distinct IDs, shrinking features, increasing work and a builder');
      ids.add(key);
      return { id: key, index: i, feature, work, build };
    });
    check(definitions[0].feature >= minWorldSize && definitions[0].work <= maxWork, 'world budgets must fit the coarse preview');
    const tiers = freeze(definitions.map(({ build, ...tier }) => tier)), assets = new Map();
    function inspect(view) {
      const projected = screen(box, basis, checkedView(view));
      if (!projected.visible) return freeze({ id, level: null, projected, limitedBy: ['visibility'] });
      let index = 0, limitedBy = [];
      for (const level of tiers.slice(1)) {
        if (level.feature < minWorldSize) limitedBy.push('world-size');
        if (level.work > maxWork) limitedBy.push('work');
        if (level.feature * projected.pixelsPerWorld < minPixels) limitedBy.push('art-pixels');
        if (limitedBy.length) break;
        index = level.index;
      }
      const level = tiers[index];
      return freeze({ id, level, projected, featurePixels: level.feature * projected.pixelsPerWorld, limitedBy });
    }
    function select(view) {
      const report = inspect(view), level = report.level;
      if (!level) return Object.freeze({ ...report, asset: null });
      if (!assets.has(level.index)) {
        const asset = definitions[level.index].build(level);
        check(asset != null, 'a level builder must return an asset');
        assets.set(level.index, asset);
      }
      return Object.freeze({ ...report, asset: assets.get(level.index) });
    }
    const out = Object.freeze({ id, bounds: box, levels: tiers, inspect, select });
    programs.add(out);
    return out;
  }

  function tiling({ id = 'tiling', bounds, basis, minPixels, minWorldSize, maxWork, build = layout => layout,
    depth = 5, maxPieces = 65536, ...definition } = {}) {
    const impl = P.tiles.quasiperiodic;
    check(typeof build === 'function' && integer(maxPieces, 1, 65536), 'tiling needs a piece budget and build callback');
    const recipe = clone(Object.fromEntries(Object.entries(definition).filter(([, value]) => value !== undefined)));
    const levels = impl.levels({ ...recipe, depth }).filter(row => row.pieces <= maxPieces).map(row => ({
      id: String(row.depth), feature: row.feature, work: row.visited,
      build: level => build(impl({ ...recipe, depth: row.depth, maxPieces }), level)
    }));
    return create({ id, bounds, basis, minPixels, minWorldSize, maxWork, levels });
  }

  function menger({ id = 'menger', minPixels, minWorldSize, maxWork = 250000,
    iterations = 3, build = form => form, pose, bounds, gap = 1 / 3 } = {}) {
    check(integer(iterations, 1, 5) && typeof build === 'function', 'Menger previews need 1–5 iterations and a build callback');
    const recipe = { family: 'menger', pose: pose && clone(pose), bounds: bounds && clone(bounds), gap };
    const first = P.forms.fractal({ ...recipe, iterations: 1 });
    const scale = recipe.pose ? P.transforms.distanceScale(P.transforms.local(recipe.pose)) : 1;
    const levels = Array.from({ length: iterations }, (_, i) => {
      const n = i + 1, samples = 3 ** n;
      return { id: String(n), feature: 2 * gap * scale / 3 ** i, work: samples ** 3 * n,
        build: level => build(i === 0 ? first : P.forms.fractal({ ...recipe, iterations: n }),
          { ...level, iterations: n, samplesPerAxis: samples }) };
    });
    return create({ id, bounds: first.bounds, minPixels, minWorldSize, maxWork, levels });
  }

  function surfaces(previews, view, report) {
    check(Array.isArray(previews) && integer(previews.length, 0, 8) && Array.from(previews).every(p => programs.has(p)) &&
      new Set(previews.map(p => p.id)).size === previews.length, 'expected up to eight previews with distinct IDs');
    const selected = previews.map(preview => preview.select(view));
    if (report) report(selected.map(({ asset, ...row }) => row));
    return selected.map(({ asset }) => asset);
  }

  P.lod.preview = Object.freeze({ create, camera, tiling, menger, surfaces });
})(KIT);
