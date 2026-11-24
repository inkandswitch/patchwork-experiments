/* Named generator samples routed to existing field, material and geometry consumers. */
(function (K) {
  const P = K.procedural, { freeze } = P.data, finite = Number.isFinite;
  const types = ['number', 'category', 'rgb', 'vec2', 'vec3'];
  const views = ['slice', 'contours', 'isosurface', 'streamlines', 'glyphs', 'lic'];
  const twoToWorld = (point, y = 0) => [point[0], y, point[1]];
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const tuple = (value, size) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length === size && Array.from(value).every(finite);
  const check = (ok, message) => { if (!ok) throw new TypeError('Field outputs: ' + message); };
  const unit = value => value === null || typeof value === 'string' && value.trim().length > 0;

  function boxFor(bounds, dimensions) {
    check(tuple(bounds?.min, dimensions) && tuple(bounds?.max, dimensions) &&
      Array.from(bounds.min).every((value, axis) =>
        value <= bounds.max[axis] && finite(bounds.max[axis] - value)), 'expected finite ordered bounds');
    return freeze({ min: Array.from(bounds.min), max: Array.from(bounds.max) });
  }

  function create({ bounds: extent, channels: specs, sample: sampleAll, sampleChannel } = {}) {
    const dimensions = extent?.min?.length;
    check(dimensions === 2 || dimensions === 3, 'expected a 2D or 3D sampling domain');
    const bounds = boxFor(extent, dimensions), spatialViews = K.fieldViews;
    check(record(specs) && (sampleAll === undefined || typeof sampleAll === 'function') &&
      (sampleChannel === undefined || typeof sampleChannel === 'function') && (sampleAll || sampleChannel),
      'expected named channel descriptors and a sample or sampleChannel function');
    const entries = Object.entries(specs);
    check(entries.length >= 1 && entries.length <= 64, 'expected 1–64 named channels');
    const descriptors = freeze(Object.fromEntries(entries.map(([name, descriptor]) => {
      const { type = 'number', units = null, range } = descriptor ?? {};
      check(name.trim().length > 0 && name.length <= 256 && record(descriptor) &&
        Object.keys(descriptor).every(key => ['type', 'units', 'range'].includes(key)) && types.includes(type) && unit(units) &&
        (range === undefined || type === 'number' && tuple(range, 2) && range[1] > range[0] && finite(range[1] - range[0])),
        'invalid descriptor for ' + name);
      return [name, { type, units, ...(range !== undefined && { range: Array.from(range) }) }];
    })));
    const channels = Object.freeze(Object.keys(descriptors));

    function info(name) {
      check(Object.hasOwn(descriptors, name), 'unknown channel ' + String(name));
      return descriptors[name];
    }
    function inside(point) {
      check(tuple(point, dimensions), 'expected finite ' + dimensions + 'D sample coordinates');
      return point.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]);
    }
    function rowAt(point) {
      const row = sampleAll(...point);
      check(row == null || record(row), 'expected a sample record or null');
      return row;
    }
    function valueFor(name, type, value) {
      if (value == null) return null;
      if (type === 'rgb') return Object.freeze(ColorCurves.color(value));
      if (type === 'vec2' || type === 'vec3') {
        check(tuple(value, type === 'vec2' ? 2 : 3), 'invalid vector sample for ' + name);
        return Object.freeze(Array.from(value));
      }
      check(type === 'number' ? finite(value) : Number.isSafeInteger(value) ||
        typeof value === 'string' && value.length > 0, 'invalid ' + type + ' sample for ' + name);
      return value;
    }
    const at = (row, name) => row != null && Object.hasOwn(row, name) ? row[name] : null;
    function sample(name, ...point) {
      const { type } = info(name);
      if (!inside(point)) return null;
      return valueFor(name, type, sampleChannel ? sampleChannel(name, ...point) : at(rowAt(point), name));
    }
    function read(...point) {
      if (!inside(point)) return null;
      const row = sampleAll && rowAt(point);
      if (sampleAll && row == null) return null;
      return Object.freeze(Object.fromEntries(channels.map(name => [name,
        valueFor(name, descriptors[name].type, sampleAll ? at(row, name) : sampleChannel(name, ...point))])));
    }

    function scalar(name, { map, missing = null } = {}) {
      const { type } = info(name);
      check((map === undefined ? type === 'number' : typeof map === 'function') && (missing === null || finite(missing)),
        'scalar output needs a numeric channel or an explicit map, and a finite or null fallback');
      return (...point) => {
        let value = sample(name, ...point);
        if (value !== null && map) value = map(value, ...point) ?? null;
        check(value === null || finite(value), 'scalar map must return a finite number or null');
        return value ?? missing;
      };
    }

    function source(name, { bounds: xyz, project, map, units = info(name).units, components = 'xz' } = {}) {
      const { type } = info(name), mapped = map !== undefined;
      check((mapped || ['number', 'vec2', 'vec3'].includes(type)) &&
        (project === undefined || typeof project === 'function' && xyz),
        'a world source needs a number or vector channel, and a custom projection needs XYZ bounds');
      const world = xyz === undefined
        ? dimensions === 3 ? bounds : { min: twoToWorld(bounds.min), max: twoToWorld(bounds.max) }
        : boxFor(xyz, 3);
      const evaluate = mapped ? scalar(name, { map }) : (...point) => sample(name, ...point);
      return spatialViews.source({
        type: mapped ? 'number' : type, units, bounds: world, components,
        sample(x, y, z) {
          const point = project ? project([x, y, z]) : dimensions === 3 ? [x, y, z] : [x, z];
          if (point == null) return null;
          check(tuple(point, dimensions), 'projection must return native coordinates or null');
          return evaluate(...point);
        }
      });
    }

    function pigment(name, { ramp, colors } = {}) {
      const { type, range = [0, 1] } = info(name);
      check(type === 'number' && colors === undefined || type === 'category' && ramp === undefined && record(colors) ||
        type === 'rgb' && ramp === undefined && colors === undefined,
        'pigment needs a numeric ramp, category colors, or an RGB channel');
      const packed = rgb => rgb.reduce((color, component) => color * 256 + Math.round(255 * component), 0);
      const tint = type === 'number' ? ColorCurves.ramp(ramp ?? {
        stops: [[range[0], '#192b68'], [range[1], '#ffad63']]
      }) : null;
      const palette = type === 'category'
        ? new Map(Object.entries(colors).map(([id, color]) => [id, packed(ColorCurves.color(color))])) : null;
      return (...point) => {
        const value = sample(name, ...point);
        if (value === null) return null;
        if (palette) return palette.get(String(value)) ?? null;
        return packed(tint ? tint(value) : value);
      };
    }

    function relief(name, { carrier, project, map, missing = 0, scale = 1, offset = 0,
      segments = [32, 32], maxTriangles, flip = false } = {}) {
      const height = scalar(name, { map, missing });
      check(typeof carrier?.sample === 'function' && finite(scale) && finite(offset) && finite(missing) &&
        (project === undefined || typeof project === 'function') && typeof flip === 'boolean',
        'relief needs a UV carrier, finite height controls and optional projection');
      return TexturedSurface.grid({ segments, maxTriangles, flip, point(u, v) {
        const uv = [u, v], { p, n } = carrier.sample(uv) ?? {};
        const length = tuple(n, 3) ? Math.hypot(...n) : 0;
        check(tuple(p, 3) && finite(length) && length > 0, 'relief carrier needs a finite point and nonzero normal');
        const point = project ? project({ uv, position: p }) : dimensions === 3 ? p : uv;
        check(point == null || tuple(point, dimensions), 'relief projection must return native coordinates or null');
        const value = point == null ? missing : height(...point);
        const distance = offset + scale * value;
        return Array.from(p, (coordinate, axis) => coordinate + distance * (n[axis] / length));
      } });
    }

    function density(name, { scale = 1, ...settings } = {}) {
      check(finite(scale) && scale >= 0 && (settings.map !== undefined || info(name).type === 'number'),
        'density needs a numeric output and a finite nonnegative scale');
      const field = source(name, settings);
      return P.density.bounded({ bounds: field.bounds, sample(x, y, z) {
        return Math.max(0, field.sample(x, y, z) ?? 0) * scale;
      } });
    }

    function view(name, { kind = 'slice', source: spatial, options } = {}) {
      check(views.includes(kind), 'unknown field view ' + kind);
      return spatialViews[kind](source(name, spatial), options);
    }

    function splats(builder, name, { kind, source: spatial, options, ...stamp } = {}) {
      return spatialViews.stamp(builder, view(name, { kind, source: spatial, options }), stamp);
    }

    function projected() {
      const names = Object.freeze(channels.filter(name => descriptors[name].type === 'number'));
      const output = Object.freeze({ sample });
      return Object.freeze({ dimensions, channels: names, frame: () => output });
    }

    return Object.freeze({ dimensions, bounds, channels, info, sample, read, scalar, source,
      pigment, relief, density, view, splats, projected });
  }

  K.fieldOutputs = Object.freeze({ create });
})(KIT);
