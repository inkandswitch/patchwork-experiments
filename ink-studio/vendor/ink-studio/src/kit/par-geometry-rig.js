/* Pixel-space skeletal binds and poses over the native raster mesh warp. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, T = P.transforms;
  const { integer, range, vector, record, pixels, list } = P.sceneGraphSupport;
  const valid = P.graphTypes.validator('raster');
  const name = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value);
  const restVector = ([x, y]) => [x, y, 0];

  function topology(bones) {
    if (!Array.isArray(bones) || !integer(bones.length, 1, 96)) throw new RangeError('Sprite rigs need 1 to 96 bones');
    const byId = new Map(), order = [], path = new Set();
    for (const bone of bones) {
      const { id, parent, pivot, tip = pivot } = bone ?? {};
      if (!name(id) || byId.has(id) || parent !== undefined && !name(parent) || !vector(pivot, 2) || !vector(tip, 2))
        throw new RangeError('Sprite bone needs a unique ID, a pivot and an optional parent and tip');
      byId.set(id, { id, ...(parent !== undefined && { parent }), pivot: pivot.slice(), tip: tip.slice() });
    }
    const visited = new Set();
    function visit(id) {
      if (visited.has(id)) return;
      if (path.has(id) || !byId.has(id)) throw new RangeError('Sprite bones need existing parents without cycles');
      path.add(id);
      const bone = byId.get(id);
      if (bone.parent !== undefined) visit(bone.parent);
      path.delete(id);
      visited.add(id);
      order.push(bone);
    }
    for (const id of byId.keys()) visit(id);
    return order;
  }

  function spriteGeometry(width, height, mesh, segments) {
    if (mesh === undefined) {
      if (!vector(segments, 2) || !segments.every(n => integer(n, 1, 64))) throw new RangeError('Sprite grid segments must be 1 to 64');
      const grid = TexturedSurface.grid({ segments, point: (u, v) => [u * width, v * height, 0] });
      return {
        points: Array.from({ length: grid.points.length / 3 }, (_, i) => Array.from(grid.points.slice(i * 3, i * 3 + 2))),
        triangles: Array.from(grid.triangles)
      };
    }
    const { points, triangles } = mesh;
    if (!Array.isArray(points) || !integer(points.length, 3, 16384) || !Array.from(points).every(p => vector(p, 2)) ||
        !list(triangles) || !validFaces(triangles, points.length))
      throw new RangeError('Sprite topology needs pixel-space vertices and valid triangle indices');
    return { points: points.map(p => p.slice()), triangles: Array.from(triangles) };
  }

  function validFaces(triangles, count) {
    if (!integer(triangles.length, 3, 98304) || triangles.length % 3) return false;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      if (![a, b, c].every(n => integer(n, 0, count - 1)) || a === b || b === c || a === c) return false;
    }
    return true;
  }

  function normalized(row, ids) {
    if (!record(row) || !Object.keys(row).length || Object.keys(row).length > ids.size ||
        Object.entries(row).some(([id, n]) => !ids.has(id) || !range(n, 0, 1e6)))
      throw new RangeError('Sprite weights need named bones and nonnegative finite values');
    const pairs = Object.entries(row).filter(([, weight]) => weight > 0);
    const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
    if (!total) throw new RangeError('Every sprite vertex needs a positive weight');
    return Object.fromEntries(pairs.map(([id, weight]) => [id, weight / total]));
  }

  function distance2([x, y], { pivot: [u, v], tip: [a, b] }) {
    const dx = a - u, dy = b - v, length = dx * dx + dy * dy;
    const along = length > 0 ? K.clamp(((x - u) * dx + (y - v) * dy) / length, 0, 1) : 0;
    return (x - u - dx * along) ** 2 + (y - v - dy * along) ** 2;
  }

  function bindSprite(source, bones, { mesh, segments = [12, 12], weights, influences = 2, smoothness = 1.5 } = {}) {
    if (!valid(source)) throw new TypeError('Sprite binding needs a source raster');
    const { width, height } = source;
    pixels(width, height);
    const order = topology(bones), { points, triangles } = spriteGeometry(width, height, mesh, segments),
      ids = new Set(order.map(bone => bone.id));
    if (!integer(influences, 1, 4) || !range(smoothness, .01, 1e4) ||
        weights !== undefined && (!Array.isArray(weights) || weights.length !== points.length))
      throw new RangeError('Sprite bind needs aligned vertex weights or a valid automatic bind');
    const bind = weights === undefined ? points.map(point => {
      const nearby = order.map(bone => [bone.id, distance2(point, bone)]);
      nearby.sort((a, b) => a[1] - b[1]);
      return normalized(Object.fromEntries(nearby.slice(0, influences).map(([id, d]) => [id, 1 / (smoothness ** 2 + d)])), ids);
    }) : Array.from(weights, row => normalized(row, ids));
    return { width, height, bones: order, points, triangles, weights: bind };
  }

  function poseRow(value = {}) {
    if (!record(value) || Object.keys(value).some(key => !['angle', 'translate', 'scale'].includes(key)))
      throw new TypeError('Sprite pose needs angle, translate and scale channels');
    const { angle = 0, translate = [0, 0], scale = 1 } = value;
    if (!range(angle, -1e6, 1e6) || !vector(translate, 2) || !range(scale, .001, 100))
      throw new RangeError('Invalid sprite bone pose');
    return { angle, translate, scale };
  }

  function spritePose(tracks, time = 0) {
    if (!record(tracks) || Object.keys(tracks).length > 96 || !Number.isFinite(time))
      throw new RangeError('Sprite pose needs bounded tracks and finite time');
    return Object.fromEntries(Object.entries(tracks).map(([id, rows]) => {
      if (!name(id) || !Array.isArray(rows) || !integer(rows.length, 1, 4096))
        throw new RangeError('Sprite bone track needs an ID and 1 to 4096 keys');
      const keys = Array.from(rows, ({ time, ease, ...value }) => ({ time, ease, value: poseRow(value) }));
      const track = K.anim.keyframeTrack.create({ angle: 'radians', translate: 'vector', scale: 'positive' }, keys);
      return [id, track.sample(time)];
    }));
  }

  function skinSprite(source, bind, pose = {}, options = {}) {
    if (!valid(source) || source.width !== bind?.width || source.height !== bind?.height || !record(pose))
      throw new TypeError('Sprite skin needs the original raster dimensions, a bind and a pose');
    const { width = source.width, height = source.height, filter = 'nearest', ...settings } = options;
    pixels(width, height);
    const geometry = bindSprite(source, bind.bones, { mesh: { points: bind.points, triangles: bind.triangles }, weights: bind.weights });
    const bones = new Map(), ids = new Set(geometry.bones.map(bone => bone.id));
    if (Object.keys(pose).some(id => !ids.has(id))) throw new RangeError('Sprite pose references an unknown bone');
    for (const { id, pivot, parent } of geometry.bones) {
      const { angle, translate, scale } = poseRow(Object.hasOwn(pose, id) ? pose[id] : undefined), xyz = restVector(pivot);
      const local = T.local({ rotation: [0, 0, angle], scale: [scale, scale, 1] });
      local.t = K.V.add(restVector(translate), K.V.sub(xyz, T.point(local, xyz)));
      bones.set(id, parent === undefined ? local : T.combine(bones.get(parent), local));
    }
    const points = geometry.points.map((point, i) => {
      const out = [0, 0], xyz = restVector(point);
      for (const [id, weight] of Object.entries(geometry.weights[i])) {
        const [x, y] = T.point(bones.get(id), xyz);
        out[0] += x * weight;
        out[1] += y * weight;
      }
      if (!vector(out, 2)) throw new RangeError('Sprite deformation exceeds coordinate limits');
      return out;
    });
    const from = geometry.points.map(([x, y]) => [x / source.width, y / source.height]);
    const to = points.map(([x, y]) => [x / width, y / height]);
    const result = P.rasterWarp.mesh(source, { from, to, triangles: geometry.triangles },
      { ...settings, width, height, filter, edge: settings.edge ?? 'transparent' });
    const joints = Object.fromEntries(geometry.bones.map(({ id, pivot, tip }) => [id, {
      pivot: T.point(bones.get(id), restVector(pivot)).slice(0, 2),
      tip: T.point(bones.get(id), restVector(tip)).slice(0, 2)
    }]));
    return { ...result, points, joints };
  }

  Object.assign(A, { bindSprite, spritePose, skinSprite });
})(KIT);
