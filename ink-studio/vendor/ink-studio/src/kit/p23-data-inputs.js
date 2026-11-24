/* Typed, renderer-independent inputs retained with the authored scene. */
(function (K) {
  const { clone, freeze, isImmutable } = K.procedural.data;
  const finite = Number.isFinite, own = (o, k) => o != null && Object.hasOwn(o, k);
  const record = o => K.world.data.record(o);
  const id = value => K.world.data.id(value);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  const shape = (o, keys) => record(o) && Object.keys(o).every(key => keys.includes(key));
  const vector = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(finite);
  const check = (condition, message) => { if (!condition) throw new TypeError(message); };
  const maxRows = 100000, maxCells = 1000000, maxText = 8 * 1024 * 1024;
  const cache = new WeakMap();
  const positionColumn = { type: 'vec3', units: 'world' };
  const empty = {};
  const numeric = new Set(['number', 'integer', 'vec2', 'vec3']);
  const formats = ['csv', 'tsv', 'json', 'geojson'];
  const units = new Map(Object.entries({
    '1': ['ratio', 1], '%': ['ratio', .01],
    mm: ['length', .001], cm: ['length', .01], m: ['length', 1], km: ['length', 1000],
    in: ['length', .0254], ft: ['length', .3048], mi: ['length', 1609.344],
    ms: ['time', .001], s: ['time', 1], min: ['time', 60], h: ['time', 3600], d: ['time', 86400],
    rad: ['angle', 1], deg: ['angle', Math.PI / 180],
    'm/s': ['speed', 1], 'km/h': ['speed', 1 / 3.6], mph: ['speed', .44704],
    g: ['mass', .001], kg: ['mass', 1],
    Pa: ['pressure', 1], hPa: ['pressure', 100], kPa: ['pressure', 1000],
    K: ['temperature', 1], degC: ['temperature', 1, 273.15], degF: ['temperature', 5 / 9, 273.15 - 32 * 5 / 9]
  }));

  function converter(from, to) {
    if (to === undefined || to === from) return value => value;
    const a = units.get(from), b = units.get(to);
    check(a && b && a[0] === b[0], 'Incompatible units ' + from + ' and ' + to);
    const scale = a[1] / b[1], offset = ((a[2] ?? 0) - (b[2] ?? 0)) / b[1];
    const convert = n => {
      const value = n * scale + offset;
      check(finite(value), 'Unit conversion produced a non-finite value');
      return value;
    };
    return value => Array.isArray(value) ? value.map(convert) : convert(value);
  }

  function delimited(source, delimiter) {
    check(typeof source === 'string' && source.length <= maxText, 'Expected bounded delimited text');
    const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    const rows = [];
    let row = [], value = '', state = 'start', cells = 0;
    function cell() {
      check(++cells <= maxCells && row.length < 256, 'Delimited input exceeds its cell or column budget');
      row.push(value);
      value = '';
      state = 'start';
    }
    function line() {
      cell();
      check(rows.length <= maxRows, 'Delimited input exceeds its row budget');
      rows.push(row);
      row = [];
    }
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (state === 'quoted') {
        if (ch !== '"') value += ch;
        else if (input[i+1] === '"') { value += '"'; i++; }
        else state = 'closed';
      } else if (ch === delimiter) cell();
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && input[i+1] === '\n') i++;
        line();
      } else if (ch === '"' && state === 'start') state = 'quoted';
      else {
        check(ch !== '"' && state !== 'closed', 'Invalid quote at delimited record ' + (rows.length + 1));
        state = 'text';
        value += ch;
      }
    }
    check(state !== 'quoted', 'Unterminated quoted field at delimited record ' + (rows.length + 1));
    if (state !== 'start' || row.length) line();
    return rows;
  }

  function timestamp(value) {
    const parts = typeof value === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
    if (!parts) return NaN;
    const iso = parts[1] + '.' + (parts[2] ?? '').padEnd(3, '0') + 'Z';
    const ms = Date.parse(iso);
    return finite(ms) && new Date(ms).toISOString() === iso ? ms : NaN;
  }

  function column(name, spec) {
    const { type, units: unit, missing = {}, source = name } = spec ?? {};
    check(shape(spec, ['type', 'units', 'missing', 'source']) && text(source) &&
      !['__proto__', 'prototype', 'constructor'].includes(source) &&
      (numeric.has(type) ? text(unit) : unit === undefined && ['string', 'boolean', 'timestamp'].includes(type)),
      'Invalid type or units for column ' + name);
    check(shape(missing, ['mode', 'tokens', 'value']), 'Invalid missing-value policy for column ' + name);
    const { mode = 'error', tokens = [], value } = missing;
    check(['error', 'null', 'default'].includes(mode) &&
      Array.isArray(tokens) && tokens.length <= 64 && tokens.every(token => typeof token === 'string' || finite(token) ||
        typeof token === 'boolean') && (mode === 'default' ? own(missing, 'value') : !own(missing, 'value')),
      'Invalid missing-value policy for column ' + name);
    const accepts = {
      number: finite, integer: Number.isSafeInteger, vec2: input => vector(input, 2), vec3: input => vector(input, 3),
      boolean: input => typeof input === 'boolean', string: input => typeof input === 'string',
      timestamp: input => finite(timestamp(input))
    }[type];
    check(mode !== 'default' || accepts(value), 'Invalid missing-value default for column ' + name);
    let parse = input => input;
    if (type === 'number' || type === 'integer') parse = input =>
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim()) ? Number(input) : NaN;
    if (type === 'boolean') parse = input => input === 'true' ? true : input === 'false' ? false : undefined;
    if (type === 'vec2' || type === 'vec3') parse = input => {
      try { return JSON.parse(input); } catch { return null; }
    };
    const exact = new Set(tokens), delimitedTokens = new Set(tokens.map(String));
    return { type, units: unit, source, describe: { type, ...(source !== name && { source }),
      ...(unit !== undefined && { units: unit }), missing: { mode, tokens,
      ...(mode === 'default' && { value }) } }, read(raw, index, isText) {
      const empty = raw == null || (isText ? raw === '' || delimitedTokens.has(raw) : exact.has(raw));
      const label = 'column ' + name + ' at row ' + (index + 1);
      if (empty) {
        check(mode !== 'error', 'Missing ' + label);
        return mode === 'default' ? value : null;
      }
      const result = isText ? parse(raw) : raw;
      check(accepts(result), 'Expected ' + type + ' in ' + label);
      return result;
    } };
  }

  const d2r = Math.PI / 180, semiMajor = 6378137, e2 = 1 / 298.257223563 * (2 - 1 / 298.257223563);
  function geographic(p) {
    return (vector(p, 2) || vector(p, 3)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  }
  function ecef([lon, lat, h = 0]) {
    lon *= d2r;
    lat *= d2r;
    const s = Math.sin(lat), c = Math.cos(lat), n = semiMajor / Math.sqrt(1 - e2*s*s);
    return [(n+h)*c*Math.cos(lon), (n+h)*c*Math.sin(lon), (n*(1-e2)+h)*s];
  }

  function coordinateSystem(spec, columns, geojson) {
    check(shape(spec, ['crs', 'axes', 'units', 'columns', 'origin', 'worldUnitsPerMeter']), 'Expected an explicit coordinate system');
    const { crs, origin, columns: names, worldUnitsPerMeter: scale = 1 } = spec;
    check(finite(scale) && scale > 0, 'worldUnitsPerMeter must be positive and finite');
    let project, sourceUnits, canonical;
    if (crs === 'cartesian') {
      const { axes, units: unit } = spec, offset = origin === undefined ? [0, 0, 0] : origin;
      check(!geojson && typeof axes === 'string' && /^[xyz]{2,3}$/.test(axes) &&
        new Set(axes).size === axes.length && (unit === 'world' || units.get(unit)?.[0] === 'length') &&
        vector(offset, 3) && (unit !== 'world' || spec.worldUnitsPerMeter === undefined),
        'Cartesian coordinates need distinct axes, length units or world units, and a world XYZ origin');
      sourceUnits = Array(axes.length).fill(unit);
      canonical = { crs, axes, units: unit, origin: offset, ...(unit !== 'world' && { worldUnitsPerMeter: scale }) };
      const factor = unit === 'world' ? 1 : units.get(unit)[1] * scale;
      project = values => {
        const xyz = offset.slice();
        for (let i = 0; i < axes.length; i++) xyz['xyz'.indexOf(axes[i])] += values[i] * factor;
        return xyz;
      };
    } else {
      const mercator = crs === 'EPSG:3857', latFirst = crs === 'EPSG:4326';
      const axes = mercator ? 'easting-northing' : latFirst ? 'lat-lon' : 'lon-lat';
      const unit = mercator ? 'm' : 'deg';
      check((geojson ? crs === 'OGC:CRS84' : mercator || latFirst || crs === 'OGC:CRS84') &&
        (spec.axes === undefined || spec.axes === axes) && (spec.units === undefined || spec.units === unit) &&
        geographic(origin), 'Geographic coordinates need a supported CRS and a WGS84 longitude-latitude origin');
      sourceUnits = [unit, unit, 'm'];
      canonical = { crs, axes, units: unit, origin, worldUnitsPerMeter: scale };
      const centre = ecef(origin), lon = origin[0]*d2r, lat = origin[1]*d2r;
      const slon = Math.sin(lon), clon = Math.cos(lon), slat = Math.sin(lat), clat = Math.cos(lat);
      project = values => {
        let [x, y, height = origin[2] ?? 0] = values;
        if (mercator) {
          const edge = Math.PI * semiMajor;
          check(Math.abs(x) <= edge + 1e-6 && Math.abs(y) <= edge + 1e-6,
            'Web Mercator coordinate is outside the supported tile extent');
          x = Math.max(-1, Math.min(1, x / edge)) * 180;
          y = Math.atan(Math.sinh(y / semiMajor)) / d2r;
        } else if (latFirst) [x,y] = [y,x];
        check(geographic([x,y,height]), 'Longitude or latitude is out of range');
        const [dx, dy, dz] = K.V.sub(ecef([x,y,height]), centre), horizontal = clon*dx + slon*dy;
        return [(-slon*dx + clon*dy)*scale, (clat*horizontal + slat*dz)*scale, (-slat*horizontal + clat*dz)*scale];
      };
    }
    check(geojson ? names === undefined :
      Array.isArray(names) && (crs === 'cartesian' ? names.length === sourceUnits.length : [2,3].includes(names.length)) &&
      new Set(names).size === names.length && Array.from(names).every(name =>
        ['number', 'integer'].includes(columns.get(name)?.type)), 'Spatial rows need distinct numeric coordinate columns');
    const conversions = names?.map((name, i) => converter(columns.get(name).units, sourceUnits[i]));
    function point(values) {
      check(vector(values, values.length) && (geojson ? [2,3].includes(values.length) : values.length === names.length),
        'Expected finite spatial coordinates');
      const position = project(values);
      check(vector(position, 3), 'Projection produced a non-finite position');
      return position;
    }
    return { describe: { ...canonical, ...(names && { columns: names }), output: { axes: 'xyz', units: 'world' } },
      point, row: row => point(names.map((name, i) => {
        check(row[name] !== null, 'Missing spatial coordinate ' + name);
        return conversions[i](row[name]);
      })) };
  }

  function featureRows(data, coordinates) {
    check(record(data) && !own(data, 'crs'), 'Expected GeoJSON using its declared WGS84 coordinates');
    const raw = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] :
      [{ type: 'Feature', properties: null, geometry: data }];
    check(Array.isArray(raw) && raw.length <= maxRows, 'Expected a bounded GeoJSON collection');
    let vertices = 0;
    const each = (values, minimum, read) => {
      check(Array.isArray(values) && values.length >= minimum, 'Invalid GeoJSON coordinate array');
      return Array.from(values, read);
    };
    function point(value) {
      check(++vertices <= 500000 && Array.isArray(value), 'Invalid or excessive GeoJSON positions');
      return coordinates.point(value);
    }
    const line = values => each(values, 2, point);
    const polygon = values => each(values, 1, ring => {
      const points = each(ring, 4, point), first = ring[0], last = ring.at(-1);
      check(first.length === last.length && first.every((n, i) => n === last[i]), 'GeoJSON polygon rings must close');
      return points;
    });
    function geometry(value, depth = 0) {
      check(depth <= 16 && record(value), 'Invalid or deeply nested GeoJSON geometry');
      const { type, coordinates, geometries } = value;
      if (type === 'GeometryCollection') return { type, geometries: each(geometries, 0, child => geometry(child, depth + 1)) };
      const read = {
        Point: point, MultiPoint: values => each(values, 0, point), LineString: line,
        MultiLineString: values => each(values, 0, line), Polygon: polygon, MultiPolygon: values => each(values, 0, polygon)
      };
      check(own(read, type), 'Unsupported GeoJSON geometry ' + type);
      return { type, coordinates: read[type](coordinates) };
    }
    return raw.map((feature, i) => {
      check(record(feature) && feature.type === 'Feature' && !own(feature, 'crs') &&
        (feature.properties === null || record(feature.properties)) &&
        (feature.id === undefined || typeof feature.id === 'string' || finite(feature.id)),
        'Invalid GeoJSON feature at row ' + (i+1));
      return { ...(feature.id !== undefined && { id: feature.id }), properties: feature.properties ?? {},
        geometry: feature.geometry === null ? null : geometry(feature.geometry) };
    });
  }

  function series(spec, columns, rows) {
    const { column: clock, interpolation = 'linear', outside = 'missing', origin } = spec ?? {};
    const descriptor = columns.get(clock);
    check(shape(spec, ['column', 'interpolation', 'outside', 'origin']) &&
      ['number', 'integer', 'timestamp'].includes(descriptor?.type) && rows.length &&
      ['linear', 'step'].includes(interpolation) && ['missing', 'clamp'].includes(outside),
      'A time series needs rows, a numeric or UTC timestamp column, and a sampling policy');
    const date = descriptor.type === 'timestamp';
    const base = origin === undefined ? (date ? rows[0][clock] : 0) : origin;
    const read = date ? value => timestamp(value) : value => value;
    const start = read(base);
    check(finite(start), 'Invalid time series origin');
    const toSeconds = date ? n => n / 1000 : converter(descriptor.units, 's');
    const times = rows.map((row, index) => {
      check(row[clock] !== null, 'Missing time at row ' + (index+1));
      return toSeconds(read(row[clock]) - start);
    });
    check(times.every((t, i) => finite(t) && (!i || t > times[i-1] && finite(t-times[i-1]))),
      'Time series keys must be finite and strictly increasing');
    function locate(t) {
      let lo = 0, hi = times.length-1;
      if (t < times[lo] || t > times[hi]) {
        if (outside === 'missing') return null;
        return { index: t < times[lo] ? lo : hi };
      }
      while (hi-lo > 1) {
        const mid = (lo+hi) >>> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid;
      }
      if (t === times[hi]) return { index: hi };
      return { index: lo, ...(t > times[lo] && interpolation === 'linear' && { next: hi, weight: (t-times[lo])/(times[hi]-times[lo]) }) };
    }
    return { locate, timeAt: row => times[row], describe: { column: clock, origin: base, interpolation, outside, units: 's',
      range: [times[0], times.at(-1)] } };
  }

  function sampleOptions(input, dataset = false) {
    const { column, row, key, time, at, units, maxDistance } = input ?? {};
    const selectors = [row, key, time, at].filter(value => value !== undefined);
    check(shape(input, ['column', 'row', 'key', 'time', 'at', 'units', 'maxDistance', ...(dataset ? ['dataset'] : [])]) &&
      (!dataset || id(input.dataset)) && (id(column) || column === '$position') && selectors.length <= 1 &&
      (row === undefined || Number.isSafeInteger(row) && row >= 0) && (key === undefined || typeof key === 'string' || finite(key)) &&
      (time === undefined || finite(time)) && (at === undefined || vector(at, 3)) && (units === undefined || text(units)) &&
      (maxDistance === undefined || at !== undefined && finite(maxDistance) && maxDistance >= 0), 'Invalid data sample selector');
  }

  function compile(name, spec) {
    const { kind, format = 'json', file, columns: schema, key, time, coordinates, data } = spec ?? {};
    const geojson = format === 'geojson', isText = format === 'csv' || format === 'tsv';
    check(shape(spec, ['kind', 'format', 'file', 'columns', 'key', 'time', 'coordinates', 'data']) &&
      ['table', 'series', 'spatial'].includes(kind) && formats.includes(format) && (!geojson || kind === 'spatial') &&
      (kind === 'series') === (time !== undefined) && (kind === 'spatial') === (coordinates !== undefined), 'Invalid dataset definition');
    check(file === undefined && own(spec, 'data'), 'Resolve the dataset file before loading typed inputs');
    check(record(schema) && Object.keys(schema).length <= 128 && (geojson || Object.keys(schema).length > 0) &&
      Object.keys(schema).every(id), 'Expected named typed columns');
    const columns = new Map(Object.entries(schema).map(([key, spec]) => [key, column(key, spec)]));
    check(key === undefined || ['number', 'integer', 'string'].includes(columns.get(key)?.type), 'Invalid row key column');
    const coords = kind === 'spatial' && coordinateSystem(coordinates, columns, geojson);
    let raw = data, features;
    if (!isText && typeof raw === 'string') {
      check(raw.length <= maxText, 'JSON input exceeds its text budget');
      raw = JSON.parse(raw.replace(/^\uFEFF/, ''));
    }
    const names = [...columns.keys()], sourceNames = names.map(name => columns.get(name).source);
    if (isText) {
      const [header, ...records] = delimited(raw, format === 'csv' ? ',' : '\t');
      check(header?.length && header.every(text) && new Set(header).size === header.length &&
        sourceNames.every(name => header.includes(name)), 'Delimited headers must be unique and include all typed columns');
      const indices = sourceNames.map(name => header.indexOf(name));
      raw = records.map((row, i) => {
        check(row.length === header.length, 'Wrong number of fields at delimited record ' + (i+2));
        return Object.fromEntries(sourceNames.map((source, j) => [source, row[indices[j]]]));
      });
    } else if (geojson) {
      features = featureRows(raw, coords);
      raw = features.map(feature => feature.properties);
    }
    check(Array.isArray(raw) && raw.length <= maxRows && raw.length * names.length <= maxCells, 'Expected a bounded JSON row array');
    const rows = freeze(Array.from(raw, (row, index) => {
      check(record(row), 'Expected an object at row ' + (index + 1));
      return Object.fromEntries(names.map(name => {
        const reader = columns.get(name);
        return [name, reader.read(own(row, reader.source) ? row[reader.source] : undefined, index, isText)];
      }));
    }));
    const index = new Map();
    const spatial = kind === 'spatial' ? K.world.spatial.create() : null;
    if (spatial) {
      features = freeze(rows.map((properties, i) => {
        const source = features?.[i], geometry = geojson ? source.geometry : { type: 'Point', coordinates: coords.row(properties) };
        return { ...(source?.id !== undefined && { id: source.id }), geometry, properties };
      }));
    }
    for (let i = 0; i < rows.length; i++) {
      const value = key === undefined ? features?.[i]?.id : rows[i][key];
      check((key === undefined || value !== null) && (value === undefined || !index.has(value)), 'Missing or duplicate row key: ' + value);
      if (value !== undefined) index.set(value, i);
      const geometry = features?.[i].geometry;
      if (geometry?.type === 'Point') {
        const point = geometry.coordinates;
        spatial.set(i, { min: point, max: point, value: point, rank: i });
      }
    }
    const clock = kind === 'series' && series(time, columns, rows);
    const description = freeze({ id: name, kind, format, rowCount: rows.length, ...(key !== undefined && { key }),
      columns: Object.fromEntries([...columns].map(([key, value]) => [key, value.describe])),
      ...(coords && { coordinates: coords.describe }), ...(clock && { time: clock.describe }) });

    function sample(input, sceneTime = 0) {
      sampleOptions(input);
      const { column: keyColumn, key, time, at, units, maxDistance = Infinity } = input;
      const isPosition = keyColumn === '$position';
      const meta = isPosition && spatial ? positionColumn : columns.get(keyColumn);
      check(meta, 'Unknown column ' + keyColumn + ' in ' + name);
      check(units === undefined || meta.units !== undefined, 'Column ' + keyColumn + ' has no units');
      const convert = converter(meta.units, units);
      let { row } = input, later;
      if (at !== undefined) {
        check(spatial, 'Position sampling needs a spatial dataset');
        const nearest = spatial.nearest(at, (entry, point) => K.V.dist(entry.value, point));
        if (!nearest || nearest.value > maxDistance) return { status: 'outside', reason: 'no point in sampling range' };
        row = nearest.id;
      } else if (key !== undefined) row = index.get(key);
      else if (row === undefined && clock) {
        const t = time ?? sceneTime;
        check(finite(t), 'Expected finite scene seconds for time-series sampling');
        const interval = clock.locate(t);
        if (!interval) return { status: 'outside', reason: 'outside the time series' };
        row = interval.index;
        later = interval;
      } else check(time === undefined, 'Time sampling needs a time series');
      if (row === undefined || row >= rows.length)
        return { status: 'missing', reason: 'no matching data row' };
      const geometry = features?.[row]?.geometry;
      let value = isPosition ? (geometry?.type === 'Point' ? geometry.coordinates : null) : rows[row][keyColumn];
      if (later?.next !== undefined && ['number', 'vec2', 'vec3'].includes(meta.type) && keyColumn !== clock.describe.column) {
        const b = rows[later.next][keyColumn], weight = later.weight;
        const mix = (a, b) => a*(1-weight) + b*weight;
        value = value === null || b === null ? null : Array.isArray(value) ? value.map((a, i) => mix(a, b[i])) : mix(value, b);
      }
      if (value === null) return { status: 'missing', reason: 'missing data value', row };
      return { status: 'ok', value: convert(value), row, ...(meta.units !== undefined && { units: units ?? meta.units }) };
    }
    return Object.freeze({ description, rows, ...(features && { features }), ...(clock && { timeAt: clock.timeAt, interval(time) {
      check(finite(time), 'Expected finite scene seconds for time-series sampling');
      return clock.locate(time);
    } }), sample });
  }

  function entries(definition) {
    check(record(definition) && Object.keys(definition).length <= 128 && Object.keys(definition).every(id), 'Expected named data inputs');
    return Object.entries(definition);
  }

  function embed(definition, read) {
    check(typeof read === 'function', 'A dataset file resolver is required');
    return freeze(clone(Object.fromEntries(entries(definition).map(([name, spec]) => {
      if (spec?.file === undefined) return [name, spec];
      const { file, ...rest } = spec;
      check(typeof file === 'string' && file.trim().length > 0 && file.length <= 4096 && !file.includes('\0') &&
        !own(spec, 'data'), 'Dataset ' + name + ' needs a single data file or inline data');
      const data = read(file);
      check(typeof data === 'string' && data.length <= maxText, 'Dataset ' + name + ' needs bounded text');
      return [name, { ...rest, data }];
    }))));
  }

  function prepare(definition = empty) {
    if (cache.has(definition)) return cache.get(definition);
    const frozen = definition === empty || isImmutable(definition);
    const datasets = new Map(entries(frozen ? definition : clone(definition)).map(([name, spec]) => {
      try { return [name, compile(name, spec)]; }
      catch (error) { throw new TypeError('Data input ' + name + ': ' + error.message, { cause: error }); }
    }));
    function get(name) {
      check(datasets.has(name), 'Unknown data input ' + name);
      return datasets.get(name);
    }
    const result = Object.freeze({
      describe: () => [...datasets.values()].map(dataset => dataset.description),
      get,
      sample(input, sceneTime) {
        sampleOptions(input, true);
        const { dataset, ...options } = input;
        return get(dataset).sample(options, sceneTime);
      }
    });
    if (frozen) cache.set(definition, result);
    return result;
  }

  K.dataInputs = Object.freeze({ prepare, embed, sampleOptions: input => sampleOptions(input, true),
    convert(value, from, to) {
      check(finite(value) || vector(value, 2) || vector(value, 3), 'Unit conversion needs a numeric value');
      return converter(from, to)(value);
    } });
})(KIT);
