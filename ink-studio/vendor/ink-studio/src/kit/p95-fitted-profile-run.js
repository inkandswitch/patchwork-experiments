/* Repeat closed profile sections along a routed spine. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { V } = K;
  const EPS = 1e-7;
  const vector = (value, length) =>
    Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);

  function compact(path) {
    const points = [];
    for (const point of path) {
      if (points.length && V.dist(points.at(-1), point) <= EPS) continue;
      const a = points.at(-2), b = points.at(-1);
      if (a && b) {
        const prior = V.sub(b, a), next = V.sub(point, b);
        if (V.dot(prior, next) > 0 && V.len(V.cross(prior, next)) <= EPS * V.len(prior) * V.len(next))
          points.pop();
      }
      points.push(point);
    }
    return points;
  }

  function prism(from, to, side, up, profile, meta) {
    const vertices = [from, to].flatMap(center =>
      profile.map(([x, y]) => V.add(V.mad(center, side, x), V.mul(up, y))));
    const n = profile.length, order = Array.from({length:n}, (_, i) => i);
    const faces = [order, order.map(i => i + n)];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push([i, j, j + n, i + n]);
    }
    return P.pieces.convex(vertices, faces, meta);
  }

  function fittedProfileRun({ path, profiles, pitch, gap = 0, up = [0,1,0], budget = 1024 } = {}) {
    if (!Array.isArray(path) || path.length < 2 || path.length > 4096 ||
        !Array.from(path).every(point => vector(point, 3)) ||
        !Array.isArray(profiles) || profiles.length < 1 || profiles.length > 8 ||
        !Array.from(profiles).every(ring => Array.isArray(ring) && ring.length >= 3 &&
          ring.length <= 32 && Array.from(ring).every(point => vector(point, 2))) ||
        !vector(up, 3) || V.len(up) <= EPS ||
        !Number.isFinite(gap) || gap < 0 || gap >= 1 ||
        !Number.isFinite(pitch) || pitch <= 0 ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 8192)
      throw new Error('Fitted profile runs need a finite spine, convex profiles, pitch and joint fraction');
    const points = compact(path);
    if (points.length < 2) throw new Error('A fitted spine needs distinct points');
    const axis = V.norm(up), sides = [];
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const delta = V.sub(points[i], points[i - 1]), side = V.cross(axis, delta), span = V.len(delta);
      if (V.len(side) <= EPS * span)
        throw new Error('A fitted spine cannot run parallel to its up vector');
      sides.push(V.norm(side));
      length += span;
    }
    const count = Math.max(1, Math.round(length / pitch)), unit = length / count;
    if (!Number.isFinite(length) || count > budget) throw new Error('Fitted spine exceeds its piece budget');
    // Coincident rails partition the spine using the established station and
    // end-joint rules. The profile prisms provide the separate cross section.
    const layout = P.fittedRibbon({ inner:points, outer:points, pitch, gap:unit * gap, budget });
    if (layout.fragmentCount * profiles.length > budget) throw new Error('Fitted spine exceeds its profile budget');
    const sections = profiles.map(ring => ring.map(point => point.slice()));
    return Object.freeze({
      length:layout.length, unit:layout.unit, count:layout.cells.length,
      pieces(meta = {}) {
        return layout.cells.flatMap(cell => cell.fragments.flatMap((fragment, index) =>
          sections.map((profile, section) => prism(
            fragment.points[0], fragment.points[1], sides[fragment.edge], axis, profile,
            { ...meta, key:`${meta.key ?? 'run'}/${cell.key}/${index}/${section}` }
          ))));
      }
    });
  }

  P.fittedProfileRun = fittedProfileRun;
})(KIT);
