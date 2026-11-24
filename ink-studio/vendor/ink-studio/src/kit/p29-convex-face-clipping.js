/* Keep planar faces as polygons through successive half-space clips. Triangulate
   only at the consumer, so the number of cuts is independent of mesh diagonals. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { V } = K;
  const EPS = 1e-8;
  const finite = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const evalPlane = (plane, point) =>
    plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] - plane.offset;

  function cutPolygon(points, values, min, max, collect) {
    if (max <= EPS) return points;
    if (min >= -EPS) return [];
    const kept = [];
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const d = values[i];
      const next = values[j];
      const p = points[i];
      if (d <= EPS) kept.push(p);
      if (Math.abs(d) <= EPS) collect?.(p);
      if ((d < -EPS && next > EPS) || (d > EPS && next < -EPS)) {
        const crossing = V.mad(p, V.sub(points[j], p), d / (d - next));
        kept.push(crossing);
        collect?.(crossing);
      }
    }
    return kept;
  }

  function validate(faces, planes, minimum) {
    if (
      !Array.isArray(faces) ||
      faces.length < minimum ||
      faces.length > 1024 ||
      !Array.from(faces).every(face =>
        Array.isArray(face?.points) && face.points.length >= 3 && face.points.length <= 512 &&
        Array.from(face.points).every(finite)
      ) ||
      !Array.isArray(planes) ||
      planes.length > 1024 ||
      !Array.from(planes).every(plane =>
        finite(plane?.normal) && V.len(plane.normal) > EPS && Number.isFinite(plane.offset)
      )
    ) throw new Error('Convex face clipping needs bounded finite faces and half spaces');
  }

  function planeValues(points, plane) {
    let min = Infinity;
    let max = -Infinity;
    const values = points.map(point => {
      const d = evalPlane(plane, point);
      min = Math.min(min, d);
      max = Math.max(max, d);
      return d;
    });
    return { values, min, max };
  }

  function clipPlanarFaces(faces, planes) {
    validate(faces, planes, 0);
    const out = [];
    for (const face of faces) {
      let points = face.points;
      for (const plane of planes) {
        const { values, min, max } = planeValues(points, plane);
        points = cutPolygon(points, values, min, max);
        if (points.length < 3) break;
      }
      if (points.length >= 3) out.push({ ...face, points });
    }
    return out;
  }

  function clipConvexFaces(faces, planes, { capTag } = {}) {
    validate(faces, planes, 4);
    let shell = faces.map(face => ({ points: face.points, tag: face.tag }));
    for (const plane of planes) {
      let inside = false;
      let outside = false;
      const faceValues = shell.map(({ points }) => {
        const span = planeValues(points, plane);
        inside ||= span.min < -EPS;
        outside ||= span.max > EPS;
        return span;
      });
      if (!outside) continue;
      if (!inside) return [];
      const next = [];
      const cap = [];
      const collect = point => {
        if (!cap.some(q => q.every((value, i) => Math.abs(value - point[i]) <= EPS))) cap.push(point);
      };
      for (let i = 0; i < shell.length; i++) {
        const { points, tag } = shell[i];
        const { values, min, max } = faceValues[i];
        const kept = cutPolygon(points, values, min, max, collect);
        if (kept.length >= 3) next.push({ points: kept, tag });
        if (max <= EPS && max >= -EPS)
          for (let j = 0; j < points.length; j++)
            if (Math.abs(values[j]) <= EPS) collect(points[j]);
      }
      if (cap.length >= 3) {
        const center = cap.reduce((sum, point) => V.mad(sum, point, 1 / cap.length), [0, 0, 0]);
        const n = V.norm(plane.normal);
        const x = V.norm(V.cross(Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], n));
        const y = V.cross(n, x);
        const angle = point => {
          const q = V.sub(point, center);
          return Math.atan2(V.dot(q, y), V.dot(q, x));
        };
        cap.sort((a, b) => angle(a) - angle(b));
        next.push({ points: cap, tag: plane.tag ?? capTag });
      }
      shell = next;
    }
    return shell;
  }

  P.geometry.clipConvexFaces = clipConvexFaces;
  P.geometry.clipPlanarFaces = clipPlanarFaces;
})(KIT);
