/* Native XPBD cloth grids and strand constraints rendered into art rasters. */
(function (K) {
  const P = K.procedural, V = K.V;
  const { kinds, int, range, vector, size, color, draw, dot, line, clamp } = P.rasterSimSupport;
  const point = p => vector(p, 2) ? [...p, 0] : vector(p, 3) ? p.slice() : null;

  function fabric(options, recipe, cloth) {
    const dims = size(options, 262144);
    const { projection = [.44, -.16], gravity = [0, 85, 0], wind = [24, 0, 4],
      fade = .48, gust = 12, substeps = 6, damp = .8, thickness = .65, spheres = [], pins,
      stretch = .000001, bend = .0006, tear = 0, palette = ['#39587a', '#53879a', '#79bcb4', '#a4d3bd'],
      pinColor, widthPx = 2, stripeEvery = 0 } = options;
    if (!vector(projection, 2) || !vector(gravity, 3) || !vector(wind, 3) || !range(gust, 0, 1000) ||
        !range(fade, 0, 40) || !int(substeps, 1, 20) || !range(damp, 0, 100) || !range(thickness, 0, 40) ||
        ![stretch, bend].every(n => range(n, 0, 10)) || !(tear === 0 || range(tear, 1.01, 30)) ||
        !int(stripeEvery, 0, 48) || !range(widthPx, .25, 32) || !Array.isArray(spheres) || spheres.length > 32 ||
        !Array.from(spheres).every(s => point(s?.at) && range(s.r, .1, 1024)) ||
        !Array.isArray(palette) || !int(palette.length, 1, 32)) throw new RangeError('Invalid XPBD raster settings');
    const swatches = palette.flatMap(hex => [...color(hex), 255]);
    if (pinColor !== undefined) color(pinColor);
    let layout;
    const defaultPins = [], paths = [];
    if (cloth) {
      const { columns: nu = 14, rows: nv = 10, at = [12, 13, 0], u = [dims.width * .62, 0, .8],
        v = [0, dims.height * .55, 0], shear = .00002, pin = 'top' } = options;
      if (!int(nu, 2, 40) || !int(nv, 2, 40) || nu * nv > 1100 || !point(at) || !point(u) || !point(v) ||
          V.len(V.cross(point(u), point(v))) < 1e-5 || !range(shear, 0, 10) ||
          !['top', 'left', 'right', 'corners', 'none'].includes(pin)) throw new RangeError('Invalid cloth grid or attachment edge');
      layout = K.xpbd.clothGrid({ nu, nv, at: point(at), u: point(u), v: point(v), stretch, shear, bend, tear });
      const edge = (i, j) => pin === 'top' && j === 0 || pin === 'left' && i === 0 ||
        pin === 'right' && i === nu - 1 || pin === 'corners' && j === 0 && (i === 0 || i === nu - 1);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (edge(i, j)) defaultPins.push(j * nu + i);
      let face = 0;
      for (let y = 0; y < nv - 1; y++) for (let x = 0; x < nu - 1; x++) {
        const i = y * nu + x, { horizontal, vertical, faces } = layout;
        faces[face].guards = [faces[face].diagonal, horizontal[i], vertical[i]];
        faces[face + 1].guards = [faces[face + 1].diagonal, horizontal[i + nu], vertical[i + 1]];
        faces[face].band = faces[face + 1].band = x;
        face += 2;
      }
    } else {
      const strands = options.strands ?? [Array.from({ length: 16 }, (_, i) => [12 + i * 3, 11 + i * 1.3, 0])];
      if (!Array.isArray(strands) || !int(strands.length, 1, 24)) throw new RangeError('Expected 1 to 24 strands');
      layout = { points: [], links: [], faces: [] };
      for (const row of strands) {
        if (!Array.isArray(row) || !int(row.length, 2, 64) || !Array.from(row).every(p => point(p)) ||
            layout.points.length + row.length > 1100) throw new RangeError('Invalid strand points');
        const base = layout.points.length, start = layout.links.length;
        layout.points.push(...row.map(point));
        defaultPins.push(base);
        const links = K.xpbd.ropeLinks(row.length, stretch, tear, bend, true);
        for (const { a, b, guards, ...entry } of links)
          layout.links.push({ a: base + a, b: base + b, ...entry, ...(guards && { guards: guards.map(k => k + start) }) });
        paths.push({ start, count: links.length });
      }
    }
    const track = index => {
      if (typeof index === 'number') {
        if (!int(index, 0, layout.points.length - 1)) throw new RangeError('Invalid XPBD pin index');
        return [index, () => layout.points[index]];
      }
      const { index: i, at, keys } = index;
      if (!int(i, 0, layout.points.length - 1) || at !== undefined && !point(at) ||
          keys !== undefined && (!Array.isArray(keys) || !int(keys.length, 1, 512) || !Array.from(keys).every(k => point(k.value))))
        throw new RangeError('Invalid static or keyed XPBD pin');
      const keysTrack = keys && K.anim.keyframeTrack.create({ at: 'vector' },
        keys.map(({ time, ease, value }) => ({ time, ease, value: { at: point(value) } })));
      return [i, clock => keysTrack?.sample(clock).at ?? point(at) ?? layout.points[i]];
    };
    if (pins !== undefined && (!Array.isArray(pins) || pins.length > layout.points.length))
      throw new RangeError('Invalid XPBD pin set');
    const fixed = new Map(Array.from(pins ?? defaultPins, track));
    const solver = K.xpbd.sim({ gravity, damp, substeps, fixedStep: true, substepPins: true, thick: thickness,
      spheres: spheres.map(s => ({ c: point(s.at), r: s.r })),
      wind(x, y, z, time) { return [wind[0] + gust * Math.sin(time * 5 + x * .077 + y * .051),
        wind[1] + gust * .32 * Math.sin(time * 6 - z * .105), wind[2] + gust * .58 * Math.cos(time * 4 + x * .072)]; }
    });
    for (const [i, p] of layout.points.entries()) {
      solver.point(p, 1, thickness);
      solver.drag(i, fade);
    }
    for (const { a, b, compliance, ratio, guards } of layout.links) solver.link(a, b, compliance, ratio, guards);
    for (const [i, at] of fixed) solver.pin(i, at);
    if (fixed.size) solver.resetPose(layout.points.flatMap((p, i) => fixed.has(i) ? fixed.get(i)(0) : p));
    const air = options.air ?? .002;
    if (!range(air, 0, 1)) throw new RangeError('Invalid cloth air coefficient');
    for (const { nodes, guards } of layout.faces) solver.face(...nodes, air, guards);
    const pointAt = i => Array.from(solver.X.subarray(i * 3, i * 3 + 3));
    const screen = ([x, y, z]) => [x + z * projection[0], y + z * projection[1]];
    function frame() {
      const points = layout.points.map((_, i) => ({ id: i, point: pointAt(i), pinned: fixed.has(i) }));
      const commands = [];
      let image;
      if (cloth) {
        const faces = layout.faces.filter(f => !f.guards.some(solver.broken)).map(face => {
          const vertices = face.nodes.map(i => points[i].point);
          const [a, b, c] = vertices, n = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
          const lighting = Math.abs(V.dot(n, [.32, -.25, .91])), band = stripeEvery && face.band % stripeEvery === 0;
          const step = Math.floor(clamp(.1 + lighting * .76 + (band ? .17 : 0)) * palette.length);
          const u = (Math.min(palette.length - 1, step) + .5) / palette.length;
          return { depth: (a[2] + b[2] + c[2]) / 3, points: vertices.map(screen), u };
        });
        faces.sort((a, b) => a.depth - b.depth);
        if (faces.length) {
          const from = [], to = [], triangles = [];
          for (const { points, u } of faces) for (const [x, y] of points) {
            triangles.push(from.length);
            from.push([u, .5]);
            to.push([x / dims.width, y / dims.height]);
          }
          const strip = { width: palette.length, height: 1, channels: 4, data: swatches };
          image = P.rasterWarp.mesh(strip, { from, to, triangles }, { ...dims, filter: 'nearest' }).value;
        }
      } else {
        for (const [path, { start, count }] of paths.entries()) for (let i = 0; i < count; i++) {
          const { a, b, kind } = layout.links[start + i];
          if (kind !== 'stretch' || solver.broken(start + i)) continue;
          const mark = [screen(points[a].point), screen(points[b].point)];
          commands.push(line(mark, palette[(path + Math.floor(i / 5)) % palette.length],
            Math.max(.7, widthPx * (1 - i / count * .61))));
        }
      }
      if (pinColor) for (const i of fixed.keys()) commands.push(dot(screen(points[i].point), 1.5, pinColor));
      const value = image ? commands.length ? P.raster.blend(image, draw(dims, commands)) : image : draw(dims, commands);
      return { value, points, torn: solver.torn };
    }
    return { work: substeps * (layout.links.length * 4 + layout.points.length * 9), frame, capture: solver.motion,
      restore: solver.restoreMotion, step: (tick, dt) => solver.step(dt, tick * recipe.dt) };
  }
  kinds.cloth = (options, recipe) => fabric(options, recipe, true);
  kinds.strand = (options, recipe) => fabric(options, recipe, false);
})(KIT);
