/* One seconds clock for scene channels, reusable sequences, audio and events. */
(function (K) {
  const { clone, freeze } = K.procedural.data;
  const timeOK = value => Number.isFinite(value) && value >= 0;
  const vector = value => Array.isArray(value) && value.length > 0 && Array.from(value).every(Number.isFinite);
  const camera = Object.freeze({ target: { size: 3 }, dist: { mode: 'positive' },
    yaw: { mode: 'radians' }, pitch: { mode: 'number' }, sway: { mode: 'number' },
    fov: { mode: 'positive', validate: value => value < Math.PI },
    focalLength: {mode:'positive'}, sensorHeight:{mode:'positive'}, focusDistance:{mode:'positive'},
    composition:{size:2,validate:value=>value.every(n=>n>=0&&n<=1)},
    projection: { mode: 'step', validate: value => K.cameraRig.projectionOK(value) },
    railProgress: { mode: 'number', validate: value => value >= 0 && value <= 1 } });
  const own = (obj, key) => Object.hasOwn(obj, key);
  const has = (a, b) => Object.keys(a).every(key => b.includes(key));
  const maxItems = 10000;

  function compile(definition, { channel } = {}) {
    const { record, check, id, selector } = K.world.data;
    const root = clone(definition);
    const catalog = root?.sequences ?? {};
    check(record(catalog) && Object.keys(catalog).length <= 1024, 'Expected a bounded timeline sequence catalog');
    const compiled = new Map(), visiting = new Set(), points = [], sounds = [], lanes = [], targets = new Map();
    let budget = 0;
    function spend(count = 1) {
      budget += count;
      check(budget <= maxItems, 'Timeline exceeds its expanded item budget');
    }
    function list(value, name) {
      check(value === undefined || Array.isArray(value) && value.length <= maxItems, 'Expected a bounded timeline ' + name + ' array');
      return value ?? [];
    }
    function items(input, type, parse) {
      const ids = new Set();
      return list(input, type).map(row => {
        check(record(row) && id(row.id) && !ids.has(row.id) && timeOK(row.time), 'Invalid or duplicate timeline ' + type + ' ID or time');
        ids.add(row.id);
        return { type, ...parse(row), id: row.id, time: row.time };
      });
    }
    function track(row) {
      check(record(row) && has(row, ['target', 'keys', 'mode']), 'Invalid timeline track');
      const target = freeze(selector(row.target).map(String));
      const settings = channel ? channel(target) : {};
      check(settings, 'Unsupported timeline target ' + target.join('/'));
      const raw = list(row.keys, 'keyframe');
      spend(raw.length);
      check(raw.length && raw.every(key => record(key) && own(key, 'value') && has(key, ['time', 'value', 'ease'])),
        'Timeline tracks need keyframes with times and values');
      const first = raw[0].value;
      const mode = settings.mode ?? row.mode ?? (settings.size || vector(first) ? 'vector' :
        Number.isFinite(first) ? 'number' : 'step');
      check(['number', 'positive', 'radians', 'vector', 'step', 'orientation'].includes(mode) &&
        (row.mode === undefined || row.mode === mode), 'Invalid interpolation for timeline target ' + target.join('/'));
      const size = settings.size ?? (mode === 'orientation' ? 9 : vector(first) ? first.length : 0);
      const discrete = mode === 'step', split = size && (mode === 'radians' || mode === 'positive');
      check(size <= 64, 'Timeline vectors support up to 64 components');
      const components = split ? Array.from({ length: size }, (_, i) => String(i)) : [];
      const schema = split ? Object.fromEntries(components.map(i => [i, mode])) : { value: discrete ? 'number' : mode };
      const keys = raw.map(({ time, value, ease }, index) => {
        check((size ? vector(value) && value.length === size : discrete || Number.isFinite(value)) &&
          (mode !== 'step' || ease === undefined || ease === 'step') &&
          (!settings.validate || settings.validate(value)), 'Invalid keyframe value for ' + target.join('/'));
        const columns = split ? Object.fromEntries(components.map(i => [i, value[i]])) : { value: discrete ? index : value };
        return { time, value: columns, ease: discrete ? 'step' : ease };
      });
      const keyed = K.anim.keyframeTrack.create(schema, keys);
      return { target, duration: keyed.duration, sample(time) {
        const columns = keyed.sample(time);
        return discrete ? freeze(raw[columns.value].value) : split ? components.map(i => columns[i]) : columns.value;
      } };
    }
    function sequence(input, name, depth) {
      check(depth <= 32 && record(input) && has(input, name === null ?
        ['duration', 'tracks', 'markers', 'audio', 'events', 'clips', 'sequences'] :
        ['duration', 'tracks', 'markers', 'audio', 'events', 'clips']), 'Invalid timeline sequence ' + (name ?? '(root)'));
      const tracks = list(input.tracks, 'tracks').map(track);
      check(new Set(tracks.map(({ target }) => JSON.stringify(target))).size === tracks.length,
        'A timeline sequence needs one track per target');
      const markers = items(input.markers, 'marker', row => {
        check(has(row, ['id', 'time', 'label']) && (row.label === undefined || typeof row.label === 'string'),
          'Invalid timeline marker label');
        return row.label === undefined ? {} : { label: row.label };
      });
      const events = items(input.events, 'event', row => {
        check(has(row, ['id', 'time', 'kind', 'detail']) && id(row.kind) && record(row.detail ?? {}), 'Invalid timeline world event');
        return { kind: row.kind, detail: row.detail ?? {} };
      });
      const audio = items(input.audio, 'audio', row => {
        const { cue, duration = 0, offset = 0, gain = 1 } = row;
        check(has(row, ['id', 'time', 'cue', 'duration', 'offset', 'gain']) &&
          typeof cue === 'string' && cue.length > 0 && cue.length <= 512 &&
          [duration, offset, gain, offset + duration].every(timeOK), 'Invalid timeline audio cue');
        return { cue, duration, offset, gain };
      });
      const clips = items(input.clips, 'clip', row => {
        check(has(row, ['id', 'time', 'sequence', 'in', 'out', 'duration']) &&
          id(row.sequence) && own(catalog, row.sequence), 'Unknown timeline sequence ' + row.sequence);
        const source = named(row.sequence, depth + 1);
        const { in: start = 0, out: end = source.duration, duration = end - start } = row;
        check([start, end, duration].every(timeOK) && start < end && end <= source.duration && duration > 0,
          'Invalid trim or duration on timeline clip ' + row.id);
        return { source, start, end, duration };
      });
      const content = [...markers, ...audio, ...events];
      let end = tracks.reduce((end, track) => Math.max(end, track.duration), 0);
      for (const item of [...content, ...clips]) end = Math.max(end, item.time + (item.duration ?? 0));
      const duration = input.duration ?? end;
      check(timeOK(duration) && duration >= end, 'Timeline duration must contain its keys, cues and clips');
      return { duration, tracks, content, clips };
    }
    function named(name, depth) {
      check(depth <= 32 && !visiting.has(name), 'Timeline sequence cycle or depth limit at ' + name);
      if (compiled.has(name)) return compiled.get(name);
      visiting.add(name);
      const next = sequence(catalog[name], name, depth);
      visiting.delete(name);
      compiled.set(name, next);
      return next;
    }
    for (const name of Object.keys(catalog)) {
      check(id(name), 'Invalid timeline sequence name ' + name);
      named(name, 1);
    }
    const graph = sequence(root, null, 0);

    function expand(node, low, high, start, end, rate, path, depth) {
      check(depth <= 32 && Number.isFinite(rate) && rate > 0, 'Timeline nesting or retiming limit exceeded');
      spend(node.tracks.length + node.content.length + node.clips.length + 1);
      const mapped = local => local === low ? start : local === high ? end : start + (local - low) / rate;
      for (const tr of node.tracks) {
        const key = JSON.stringify(tr.target);
        targets.set(key, tr.target);
        lanes.push({ key, tr, low, high, start, end, rate });
      }
      for (const item of node.content) {
        if (item.type === 'audio' && item.duration > 0) {
          const from = Math.max(low, item.time), to = Math.min(high, item.time + item.duration);
          if (from >= to) continue;
          const offset = item.offset + (from - item.time), time = mapped(from), end = mapped(to);
          const clip = { ...item, path, time, end, duration: end - time, offset, rate };
          sounds.push(clip);
          points.push({ ...clip, phase: 'start' }, { ...clip, time: end, phase: 'end' });
        } else if (item.time >= low && item.time <= high) points.push({ ...item, path, time: mapped(item.time) });
      }
      for (const clip of node.clips) {
        const finish = clip.time + clip.duration;
        const from = Math.max(low, clip.time), to = Math.min(high, finish);
        if (from > to) continue;
        const scale = (clip.end - clip.start) / clip.duration;
        const local = time => time === clip.time ? clip.start : time === finish ? clip.end : clip.start + (time - clip.time) * scale;
        expand(clip.source, local(from), local(to), mapped(from), mapped(to), rate * scale, [...path, clip.id], depth + 1);
      }
    }
    expand(graph, 0, graph.duration, 0, graph.duration, 1, [], 0);
    for (const target of targets.values())
      for (let n = 1; n < target.length; n++)
        check(!targets.has(JSON.stringify(target.slice(0, n))), 'Timeline tracks cannot address both a property and its child');
    // A clip ending at a cut hands off before the next audio clip starts.
    points.sort((a, b) => a.time - b.time || Number(b.phase === 'end') - Number(a.phase === 'end'));
    sounds.sort((a, b) => a.time - b.time);
    freeze(points);
    freeze(sounds);
    function after(time) {
      let low = 0, high = points.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (points[mid].time <= time) low = mid + 1;
        else high = mid;
      }
      return low;
    }
    function sample(time) {
      check(timeOK(time), 'Timeline sample time must be finite and nonnegative');
      const edits = new Map(), clamped = Math.min(time, graph.duration);
      for (const { key, tr, low, high, start, end, rate } of lanes) {
        if (clamped >= start && clamped <= end) {
          const at = clamped === end ? high : low + (clamped - start) * rate;
          edits.set(key, { op: 'set', path: tr.target, value: tr.sample(at) });
        }
      }
      const audio = sounds.filter(clip => clip.time <= time && time < clip.end)
        .map(clip => ({ ...clip, position: clip.offset + (time - clip.time) * clip.rate }));
      return { time, edits: [...edits.values()], audio };
    }
    return freeze({
      duration: graph.duration, targets: [...targets.values()], markers: points.filter(row => row.type === 'marker'),
      events: points.filter(row => row.type === 'event'), audio: sounds, sample,
      between(from, to) {
        check(Number.isFinite(from) && timeOK(to) && from <= to, 'Timeline range must be finite and ordered');
        return points.slice(after(from), after(to));
      }
    });
  }
  K.timeline = Object.freeze({ compile, camera, maxItems });
})(KIT);
