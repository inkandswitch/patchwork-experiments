/* Trim an existing surface against a bounded-slope height field. Keep the
   original face attributes and leave the cut edge open for another surface. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { V } = K;

  function clipHeightMesh(mesh, height, options = {}) {
    const { slopeBound, resolution = 0.12, budget = 100000 } = options;
    if (
      typeof height !== 'function' || !Number.isFinite(slopeBound) || slopeBound < 0 ||
      !Number.isFinite(resolution) || resolution <= 0 ||
      !Number.isSafeInteger(budget) || budget < 1 || budget > 1000000
    ) throw new Error('Height clipping needs a finite slope bound, positive resolution and a triangle budget');

    const output = P.geometry.builder();
    let visited = 0;
    function distance(p) {
      const h = height(p[0], p[2]);
      if (!Number.isFinite(h)) throw new Error('Clip height must be finite');
      return p[1] - h;
    }
    function mix(a, b, t) {
      const p = V.mad(a.p, V.sub(b.p, a.p), t);
      return { p, d: distance(p), uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t),
        n: V.mad(a.n, V.sub(b.n, a.n), t) };
    }
    function triangle(a, b, c, group) {
      output.triangle(a.p, b.p, c.p, group, [a.uv, b.uv, c.uv], [V.norm(a.n), V.norm(b.n), V.norm(c.n)]);
    }
    function edge(a, b) {
      if (slopeBound === 0) return mix(a, b, a.d / (a.d - b.d));
      let lo = 0, hi = 1;
      for (let i = 0; i < 18; i++) {
        const t = (lo + hi) / 2, d = distance(V.mad(a.p, V.sub(b.p, a.p), t));
        if ((d >= 0) === (a.d >= 0)) lo = t;
        else hi = t;
      }
      // Use the endpoint on the retained side of the bracket.
      return mix(a, b, a.d >= 0 ? lo : hi);
    }
    function trim(a, b, c, group, depth) {
      if (++visited > budget) throw new Error('Height clipping exceeds its triangle budget');
      const reach = Math.max(
        Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]),
        Math.hypot(b.p[0] - c.p[0], b.p[2] - c.p[2]),
        Math.hypot(c.p[0] - a.p[0], c.p[2] - a.p[2])
      );
      const uncertainty = slopeBound * reach;
      if (Math.min(a.d, b.d, c.d) >= uncertainty) {
        triangle(a, b, c, group);
        return;
      }
      if (Math.max(a.d, b.d, c.d) <= -uncertainty) return;
      if (uncertainty > 0 && reach > resolution && depth < 24) {
        const ab = mix(a, b, .5), bc = mix(b, c, .5), ca = mix(c, a, .5);
        trim(a, ab, ca, group, depth + 1);
        trim(ab, b, bc, group, depth + 1);
        trim(ca, bc, c, group, depth + 1);
        trim(ab, bc, ca, group, depth + 1);
        return;
      }
      const loop = [a, b, c], polygon = [];
      for (let i = 0; i < 3; i++) {
        const v = loop[i], next = loop[(i + 1) % 3];
        if (v.d >= 0) polygon.push(v);
        if ((v.d < 0) !== (next.d < 0)) polygon.push(edge(v, next));
      }
      for (let i = 1; i < polygon.length - 1; i++) triangle(polygon[0], polygon[i], polygon[i + 1], group);
    }
    function vertex(index) {
      const p = Array.from(mesh.positions.subarray(index * 3, index * 3 + 3));
      return { p, d: distance(p), uv: Array.from(mesh.uv.subarray(index * 2, index * 2 + 2)),
        n: Array.from(mesh.normals.subarray(index * 3, index * 3 + 3)) };
    }
    for (const group of mesh.groups) {
      for (let i = group.start; i < group.start + group.count; i += 3)
        trim(vertex(i), vertex(i + 1), vertex(i + 2), group, 0);
    }
    return output.finish();
  }

  P.geometry.clipHeightMesh = clipHeightMesh;
})(KIT);
