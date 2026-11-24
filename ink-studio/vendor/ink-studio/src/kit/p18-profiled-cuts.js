/* A bounded arbitrary profile extruded through an affine frame. */
(function (K) {
  const P = K.procedural;
  const { V, M } = K;

  function polygonDistance(points) {
    if (
      !Array.isArray(points) ||
      points.length < 3 ||
      points.length > 256 ||
      !points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    ) {
      throw new Error('Cut profiles need 3 to 256 finite planar points');
    }
    const profile = P.data.clone(points);
    P.geometry.triangulate2D(profile);
    for (let i = 0; i < profile.length; i++) {
      const a = profile[i];
      const b = profile[(i + 1) % profile.length],
        x = b[0] - a[0],
        y = b[1] - a[1];
      const lengthSquared = x * x + y * y;
      if (!(lengthSquared > 0) || !Number.isFinite(lengthSquared)) throw new Error('Cut profile has an invalid edge');
    }
    return P.geometry.profileDistance(profile);
  }

  function profileCut({ profile, span, frame = P.transforms.local() }) {
    const distance2D = polygonDistance(profile);
    if (
      !Array.isArray(span) ||
      span.length !== 2 ||
      !span.every(Number.isFinite) ||
      span[0] >= span[1] ||
      !Array.isArray(frame?.t) ||
      frame.t.length !== 3 ||
      !frame.t.every(Number.isFinite)
    ) {
      throw new Error('Profile extrusions need finite ordered depth and a finite frame');
    }
    const depth = span.slice(),
      scale = P.transforms.distanceScale(frame),
      inverse = M.inv(frame.R);
    const pose = { R: Array.from(frame.R), t: frame.t.slice() };
    const inversePoint = point => M.app(inverse, V.sub(point, pose.t));
    const localDistance = ([x, y, z], thickness = 0) =>
      Math.max(distance2D(x, y) - thickness, depth[0] - z, z - depth[1]);
    const distance = point => localDistance(inversePoint(point)) * scale;
    const bounds = P.spatial.boxOf(profile.flatMap(([x, y]) => depth.map(z => P.transforms.point(pose, [x, y, z]))));

    function subtract(solidDistance) {
      if (typeof solidDistance !== 'function') throw new Error('Profile subtraction needs a solid distance field');
      return point => Math.max(solidDistance(point), -distance(point));
    }
    function lining(thickness, solidDistance = () => -Infinity) {
      if (!Number.isFinite(thickness) || thickness <= 0 || typeof solidDistance !== 'function') {
        throw new Error('Profile lining needs positive local thickness and an optional solid field');
      }
      // The longitudinal extent remains fixed. Lining runs on the profile boundary.
      return point =>
        Math.max(solidDistance(point), -distance(point), localDistance(inversePoint(point), thickness) * scale);
    }
    return Object.freeze({
      bounds: P.data.freeze(bounds),
      distance,
      subtract,
      lining,
      sample: point => P.transforms.point(pose, point),
      project: inversePoint
    });
  }
  P.profileCut = profileCut;
})(KIT);
