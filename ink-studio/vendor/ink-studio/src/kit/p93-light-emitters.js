// Convenient authoring for existing areaLights and volumeLighting definitions.
(function (K) {
  const A = AreaLights,
    C = LightCookies;
  const finish = raw => {
    A.prepare([raw]);
    return raw;
  };
  const rectangle = options => finish({ shape: 'rectangle', ...options });
  const disc = options => finish({ shape: 'disk', ...options });
  function line({ from, to, width = 0.04, normal, ...options }) {
    if (
      !from ||
      !to ||
      from.length !== 3 ||
      to.length !== 3 ||
      ![...from, ...to, width].every(Number.isFinite) ||
      width <= 0
    )
      throw new RangeError('A line light needs finite endpoints and positive width');
    const delta = K.V.sub(to, from),
      length = K.V.len(delta);
    if (length < 1e-6) throw new RangeError('A line light needs distinct endpoints');
    const axis = K.V.mul(delta, 1 / length),
      facing = normal ?? K.V.perp(axis),
      up = K.V.cross(facing, axis);
    if (Math.abs(K.V.dot(K.V.norm(facing), axis)) > 1e-6)
      throw new RangeError('Line light normal must be perpendicular to the endpoints');
    return finish({
      ...options,
      shape: 'line',
      at: K.V.lerp(from, to, 0.5),
      normal: facing,
      up,
      size: [length + width, width]
    });
  }
  function follow(graph, node, source) {
    if (typeof graph?.toWorld !== 'function') throw new TypeError('Follow needs a live scene hierarchy');
    const point = v => graph.toWorld(node, v),
      direction = v => K.V.sub(point(v), point([0, 0, 0]));
    return {
      ...source,
      at: t => point(typeof source.at === 'function' ? source.at(t) : (source.at ?? [0, 0, 0])),
      normal: t => {
        const matrix = K.M.cols(direction([1, 0, 0]), direction([0, 1, 0]), direction([0, 0, 1]));
        if (Math.abs(K.M.det(matrix)) < 1e-9) throw new RangeError('A followed emitter needs a nonsingular transform');
        return K.M.app(
          K.M.tr(K.M.inv(matrix)),
          typeof source.normal === 'function' ? source.normal(t) : (source.normal ?? [0, 0, 1])
        );
      },
      up: t => direction(typeof source.up === 'function' ? source.up(t) : (source.up ?? [0, 1, 0]))
    };
  }
  function report(definition, { time = 0 } = {}) {
    return A.prepare(definition, { time }).map(l => ({
      id: l.id,
      shape: l.shape,
      at: l.at,
      normal: l.normal,
      size: l.half.map(n => n * 2),
      intensity: l.intensity,
      volumeIntensity: l.volumeIntensity,
      samples: l.points.length,
      shadows: l.shadows,
      visible: l.visible,
      reflection: l.reflection,
      cookie: l.cookie
        ? {
            width: l.cookie.image.width,
            height: l.cookie.image.height,
            filter: l.cookie.image.filter,
            u: l.cookie.u,
            v: l.cookie.v,
            offset: l.cookie.offset,
            repeat: l.cookie.repeat
          }
        : null
    }));
  }
  K.lightEmitters = Object.freeze({
    rectangle,
    disc,
    line,
    follow,
    prepare: A.prepare,
    report,
    cookie: C.pattern,
    caustic: C.geometric,
    cookies: C
  });
})(KIT);
