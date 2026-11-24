/* Data encodings share native splats and retain a source address per mark. */
(function (K) {
  const { clone, freeze } = K.procedural.data, { V } = K;
  const finite = Number.isFinite, own = (o, k) => o != null && Object.hasOwn(o, k);
  const id = value => K.world.data.id(value);
  const record = value => K.world.data.record(value);
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const number = (value, min, max) => finite(value) && value >= min && value <= max;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(finite);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  const keyOK = value => typeof value === 'string' || finite(value);
  const check = (ok, message) => { if (!ok) throw new TypeError('Data marks: ' + message); };
  const maxMarks = 20000, slotsPerMark = 2, black = [0, 0, 0];
  const xAxis = [1, 0, 0], yAxis = [0, 1, 0], zAxis = [0, 0, 1];
  const shapes = ['point', 'disc', 'bar', 'cross'];
  const defaults = { size: .12, color: '#fef4cb', opacity: 1, shape: 'point', motion: [0, 0, 0] };
  const names = ['position', 'size', 'color', 'opacity', 'shape', 'motion'];
  const fieldOK = field => text(field) && !field.startsWith('look/') && !['world/data-mark', 'data-mark'].includes(field);
  const siteOK = site => site === undefined || xyz(site) || record(site);
  const boundedPoint = value => xyz(value) && value.every(n => Math.abs(n) <= 1e8);

  function color(value) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
      const n = parseInt(value.slice(1), 16);
      return [n >>> 16, (n >>> 8) & 255, n & 255];
    }
    return xyz(value) && value.every(n => number(n, 0, 255)) ? value.slice() : undefined;
  }

  const normalize = {
    position: value => boundedPoint(value) ? value : undefined,
    motion: value => boundedPoint(value) ? value : undefined,
    size: value => number(value, 0, 1e5) ? value : undefined,
    opacity: value => number(value, 0, 1) ? value : undefined,
    color,
    shape: value => shapes.includes(value) ? value : undefined,
    component: value => finite(value) ? value : undefined
  };

  function worldPath(path) {
    return path === undefined ? [] : K.world.data.selector(path);
  }

  function member(value, path) {
    return path.length ? K.world.data.read(value, path) : value;
  }

  function numericScale(settings, channel) {
    const { domain, range, clamp = true } = settings ?? {};
    check(fields(settings, ['domain', 'range', 'clamp']) && Array.isArray(domain) && domain.length === 2 &&
      domain.every(finite) && domain[1] > domain[0] && finite(domain[1]-domain[0]) &&
      Array.isArray(range) && range.length === 2 && typeof clamp === 'boolean' && channel !== 'shape',
      'invalid numeric scale for ' + channel);
    const [a,b] = range.map(normalize[channel]);
    check(a !== undefined && b !== undefined, 'invalid scale range for ' + channel);
    const mix = (a, b, t) => (1-t)*a + t*b;
    return value => {
      if (!finite(value)) return undefined;
      let t = (value-domain[0])/(domain[1]-domain[0]);
      if (clamp) t = K.clamp(t, 0, 1);
      return Array.isArray(a) ? a.map((n, i) => mix(n, b[i], t)) : mix(a, b, t);
    };
  }

  function encoding(input, channel, source) {
    if (['position', 'motion'].includes(channel) && Array.isArray(input) && input.length === 3 && !xyz(input)) {
      const components = input.map(item => encoding(item, 'component', source));
      return { dynamic: components.some(component => component.dynamic),
        read: state => normalize[channel](components.map(component => component.read(state))) };
    }
    const accept = normalize[channel];
    if (!record(input)) {
      const literal = accept(input);
      check(literal !== undefined, 'invalid literal for ' + channel);
      return { read: () => literal };
    }

    const { column, field, at, args, units, path, map, scale, fallback } = input;
    const columnRead = column !== undefined;
    check(fields(input, ['column', 'field', 'at', 'args', 'units', 'path', 'map', 'scale', 'fallback']) &&
      (columnRead ? (id(column) || column === '$position') && field === undefined && at === undefined && args === undefined :
        fieldOK(field) && siteOK(at) && (args === undefined || record(args))) &&
      (units === undefined || text(units)) && (map === undefined || scale === undefined), 'invalid encoding for ' + channel);
    const parts = worldPath(path);
    const fallbackValue = accept(fallback);
    check(fallback === undefined || fallbackValue !== undefined, 'invalid fallback for ' + channel);
    let transform = value => value;
    if (scale !== undefined) transform = numericScale(scale, channel);
    if (map !== undefined) {
      check(record(map) && Object.keys(map).length > 0 && Object.keys(map).length <= 256 &&
        Object.values(map).every(value => accept(value) !== undefined), 'invalid category map for ' + channel);
      transform = value => (typeof value === 'string' || typeof value === 'boolean' || finite(value)) &&
        own(map, String(value)) ? map[String(value)] : undefined;
    }
    if (columnRead && source.dataset) {
      const meta = source.dataset.description, position = column === '$position' && meta.kind === 'spatial';
      const descriptor = position ? { units: 'world' } : own(meta.columns, column) && meta.columns[column];
      check(descriptor, 'unknown column ' + column + ' in ' + meta.id);
      if (units !== undefined) {
        check(descriptor.units !== undefined, 'column ' + column + ' has no units');
        K.dataInputs.convert(0, descriptor.units, units);
      }
    }
    if (columnRead && !source.dataset) check(units === undefined, 'field collection columns have no declared units');
    const queryValue = (state) => {
      const answer = state.query?.probe(field, at ?? state.point, args);
      if (answer?.status !== 'ok') return undefined;
      let value = member(answer.value, parts);
      if (units !== undefined && value != null) {
        const from = answer.units ?? state.query.field?.(field)?.units;
        check(typeof from === 'string', 'field ' + field + ' has no declared units');
        value = K.dataInputs.convert(value, from, units);
      }
      return value;
    };
    return { dynamic: !columnRead, read(state) {
      let value;
      if (!columnRead) value = queryValue(state);
      else if (source.dataset) {
        const read = source.dataset.sample({ column, ...(source.clock ? { time: state.time } : { row: state.row }),
          ...(units !== undefined && { units }) });
        value = read.status === 'ok' ? member(read.value, parts) : undefined;
      } else value = member(own(state.record, column) ? state.record[column] : undefined, parts);
      return (value == null ? undefined : accept(transform(value))) ?? fallbackValue;
    } };
  }

  function sourceOf(spec, inputs, fixed) {
    const { dataset: name, field, sample = 'rows', at, args, path, key, limit = maxMarks } = spec ?? {};
    check(fields(spec, ['dataset', 'field', 'sample', 'at', 'args', 'path', 'key', 'limit']) &&
      Number.isSafeInteger(limit) && limit > 0 && limit <= maxMarks, 'invalid mark source');
    if (name !== undefined) {
      check(id(name) && [field, at, args, path, key].every(value => value === undefined) &&
        ['rows', 'time'].includes(sample), 'invalid typed dataset source');
      const dataset = inputs.get(name);
      const clock = sample === 'time';
      check(!clock || dataset.description.kind === 'series', 'time sampling needs a series dataset');
      const count = Math.min(limit, dataset.rows.length);
      const rows = clock ? undefined : dataset.rows.slice(0, count).map((record, row) => {
        const feature = dataset.features?.[row], indexKey = dataset.description.key;
        const key = indexKey === undefined ? feature?.id : record[indexKey];
        return { row, key, source: { dataset: name, row, ...(key !== undefined && { key }), record,
          ...(feature && { geometry: feature.geometry }) } };
      });
      return { dataset, clock, count: clock ? 1 : count, read(time) {
        if (!clock) return rows;
        const interval = dataset.interval(time);
        if (!interval) return [{ time, source: { dataset: name, time, record: null }, status: 'outside' }];
        const { index: row, next, weight } = interval;
        return [{ row, time, source: { dataset: name, row, time, record: dataset.rows[row],
          ...(next !== undefined && { next: { row: next, record: dataset.rows[next] }, weight }) } }];
      } };
    }
    check(!fixed, 'source field collections require a simulation snapshot');
    check(fieldOK(field) && spec.sample === undefined && siteOK(at) && (args === undefined || record(args)),
      'invalid field collection source');
    const select = worldPath(path), keyPath = worldPath(key);
    return { read(time, query) {
      const result = query?.probe(field, at, args);
      if (result?.status !== 'ok') return [];
      const value = member(result.value, select);
      check(Array.isArray(value) || record(value), field + ' must return rows or a keyed record');
      const entries = Array.isArray(value) ? value.slice(0, limit).entries() : Object.entries(value).slice(0, limit);
      return Array.from(entries, ([index, value], row) => {
        check(record(value), 'expected a record in ' + field + ' at row ' + row);
        const key = keyPath.length ? member(value, keyPath) : typeof index === 'string' ? index : undefined;
        check(!keyPath.length || keyOK(key), 'missing or invalid row key in ' + field);
        const snapshot = freeze(clone(value));
        return { row, key, record: snapshot, time, source: { field, row, ...(key !== undefined && { key }), record: snapshot } };
      });
    } };
  }

  function markId(layer, source, clock) {
    if (clock) return layer + '/time';
    if (source.key === undefined) return layer + '/row/' + source.row;
    const mark = layer + '/' + typeof source.key + '/' + JSON.stringify(source.key);
    check(mark.length <= 256, 'source key is too long in ' + layer);
    return mark;
  }

  function prepare(definition, { dataInputs = K.dataInputs.prepare(), fixed = false } = {}) {
    if (definition === undefined) return null;
    check(record(definition) && Object.keys(definition).length <= 64 && Object.keys(definition).every(id),
      'expected named mark layers');
    const layers = Object.entries(freeze(clone(definition))).map(([name, layer]) => {
      check(fields(layer, ['source', 'channels', 'missing']) && fields(layer.channels, names) &&
        ['skip', 'error'].includes(layer.missing ?? 'skip'), 'invalid layer ' + name);
      const source = sourceOf(layer.source, dataInputs, fixed);
      const input = { ...defaults, ...layer.channels };
      if (input.position === undefined && source.dataset?.description.kind === 'spatial') input.position = { column: '$position' };
      const channels = names.map(name => [name, encoding(input[name], name, source)]);
      const dynamic = !!source.clock || source.count === undefined || layer.channels.motion !== undefined ||
        channels.some(([, read]) => read.dynamic);
      return { name, source, channels, dynamic, missing: layer.missing ?? 'skip' };
    });
    check(layers.reduce((n, layer) => n + (layer.source.count ?? 0), 0) <= maxMarks, 'mark count exceeds its budget');
    function sample(time = 0, { query } = {}) {
      check(finite(time), 'expected finite scene seconds');
      const marks = [], keys = new Set();
      const snapshot = typeof query === 'function' ? query() : query;
      for (const layer of layers) {
        const rows = layer.source.read(time, snapshot);
        check(rows.length + marks.length <= maxMarks, 'mark count exceeds its budget');
        for (const row of rows) {
          const mark = markId(layer.name, row, layer.source.clock);
          check(!keys.has(mark), 'duplicate source key for ' + mark);
          keys.add(mark);
          const state = { ...row, time, query: snapshot };
          const base = { id: mark, layer: layer.name, source: row.source };
          const values = {};
          let missing = row.status && 'time';
          if (!missing) for (const [name, channel] of layer.channels) {
            const value = channel.read(state);
            if (value === undefined) { missing = name; break; }
            values[name] = value;
            if (name === 'position') state.point = value;
          }
          if (!missing) {
            values.position = V.mad(values.position, values.motion, time);
            if (!boundedPoint(values.position)) missing = 'motion';
          }
          if (missing) {
            check(layer.missing !== 'error', mark + ' is missing a valid ' + missing);
            marks.push({ ...base, status: 'missing', channel: missing });
          } else marks.push({ ...base, status: values.opacity === 0 || values.size === 0 ? 'hidden' : 'visible', channels: values });
        }
      }
      return freeze(marks);
    }
    return Object.freeze({ dynamic: layers.some(layer => layer.dynamic), sample });
  }

  function draw(builder, mark, reserve) {
    const start = builder.count();
    if (mark.status === 'visible') {
      const { position: p, size, color, opacity, shape } = mark.channels;
      if (shape === 'point') builder.iso(...p, size, color, opacity);
      if (shape === 'disc') builder.axial(...p, zAxis, size*.12, size, color, opacity);
      if (shape === 'bar') builder.stick(...p, yAxis, size, size*.26, color, opacity);
      if (shape === 'cross') {
        builder.stick(...p, xAxis, size, size*.18, color, opacity);
        builder.stick(...p, yAxis, size, size*.18, color, opacity);
      }
    }
    if (reserve) while (builder.count() < start + slotsPerMark)
      builder.iso(0, -50, 0, 1, black, 0);
  }

  function stamp(builder, marks, { reserve = false } = {}) {
    const first = builder.count();
    for (const mark of marks) {
      const start = builder.count();
      draw(builder, mark, reserve);
      if (builder.count() > start) builder.describeSplats?.(start, builder.count(), {
        object: 'dataMarks/' + mark.layer, material: 'data-mark', target: { mark: mark.id, markLayer: mark.layer }
      });
    }
    return first;
  }

  function bind(world, marks, program, { first = 0, query } = {}) {
    function lookup(rows) {
      const index = new Map(rows.map(mark => [mark.id, mark]));
      return Object.freeze({ get: id => index.get(id) });
    }
    let records = marks, snapshot = lookup(marks);
    const live = program?.dynamic && marks.length > 0;
    const scratch = live && makeBuilder(0, world.pal, { renderMetadata: false, initialCapacity: marks.length*slotsPerMark });
    function update(time, stage) {
      const next = program.sample(time, { query });
      check(next.length === records.length && next.every((mark, i) => mark.id === records[i].id), 'live mark source changed row identity');
      for (const mark of next) draw(scratch, mark, true);
      const data = scratch.take(), offset = first*16;
      for (let i = 0; i < data.length; i++) if (world.data[offset+i] !== data[i]) {
        world.data[offset+i] = data[i];
        stage.touch(first + Math.floor(i/16));
      }
      records = next;
      snapshot = lookup(next);
    }
    const api = Object.freeze({
      get: id => snapshot.get(id),
      snapshot: () => snapshot,
      list({ layer, offset = 0, limit = 100 } = {}) {
        check((layer === undefined || id(layer)) && Number.isSafeInteger(offset) && offset >= 0 &&
          Number.isSafeInteger(limit) && limit >= 1 && limit <= maxMarks, 'invalid mark list options');
        const filtered = layer === undefined ? records : records.filter(row => row.layer === layer);
        return { total: filtered.length, marks: filtered.slice(offset, offset+limit) };
      }
    });
    world.dataMarks = api;
    return live ? { update(dt, time, stage) { update(time + stage.t0, stage); } } : null;
  }

  K.dataMarks = Object.freeze({ prepare, stamp, bind });
})(KIT);
