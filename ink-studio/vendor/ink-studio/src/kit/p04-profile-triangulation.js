/* Ear triangulation of a simple 2D profile, without holes. Returned indices refer
   to input vertices; concave caps can share their retained boundary exactly. */
(function (K) {
  const A = K.procedural,
    EPS = 1e-10;
  A.geometry.triangulate2D = points => {
    if (
      !Array.isArray(points) ||
      points.length < 3 ||
      !points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    )
      throw new Error('Profile triangulation needs finite 2D vertices');
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      area = points.reduce((s, a, i) => {
        const b = points[(i + 1) % points.length];
        return s + a[0] * b[1] - a[1] * b[0];
      }, 0),
      ids = points.map((p, i) => i),
      out = [];
    if (Math.abs(area) < EPS) throw new Error('Profile has no area');
    if (area < 0) ids.reverse();
    while (ids.length > 3) {
      let found = false;
      for (let i = 0; i < ids.length; i++) {
        const a = ids[(i + ids.length - 1) % ids.length],
          b = ids[i],
          c = ids[(i + 1) % ids.length],
          turn = cross(points[a], points[b], points[c]);
        if (Math.abs(turn) < EPS) {
          ids.splice(i, 1);
          found = true;
          break;
        }
        if (turn < 0) continue;
        if (
          ids.some(
            j =>
              j !== a &&
              j !== b &&
              j !== c &&
              cross(points[a], points[b], points[j]) >= -EPS &&
              cross(points[b], points[c], points[j]) >= -EPS &&
              cross(points[c], points[a], points[j]) >= -EPS
          )
        )
          continue;
        out.push([a, b, c]);
        ids.splice(i, 1);
        found = true;
        break;
      }
      if (!found) throw new Error('Profile is not simple or cannot be triangulated');
    }
    out.push(ids.slice());
    return out;
  };
})(KIT);
