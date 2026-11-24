/* Dependency-free palette authoring on the existing OKLab/OKLCh ramp math. */
(function (K) {
  const P = K.procedural,
    C = P.materials.perceptual,
    freeze = P.data.freeze,
    clone = P.data.clone,
    TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
    mix = (a, b, t) => a + (b - a) * t;
  const record = v =>
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const check = (yes, message) => {
    if (!yes) throw new TypeError('Palette: ' + message);
  };
  const fields = (v, names) => record(v) && Object.keys(v).every(k => names.includes(k));
  const name = v =>
    typeof v === 'string' && v.length > 0 && v.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(v);
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const unpack = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map(v => v / 255);
  const lch = rgb => {
    const [L, a, b] = C.lab(rgb);
    return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
  };
  const encode = ([L, c, h]) =>
    C.gamut([clamp(L), Math.max(0, c) * Math.cos((h * Math.PI) / 180), Math.max(0, c) * Math.sin((h * Math.PI) / 180)]);
  const brands = { path: new WeakSet(), recipe: new WeakSet(), animation: new WeakSet() };
  function canonical(value) {
    if (value && typeof value === 'object') {
      if (Object.values(brands).some(set => set.has(value))) return canonical(value.snapshot());
      if (Array.isArray(value)) return value.map(canonical);
      check(record(value), 'definitions must contain plain JSON data');
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, canonical(v)])
      );
    }
    check(
      value === undefined ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        Number.isFinite(value),
      'definitions must contain JSON values'
    );
    return value;
  }
  const mode = h => ['short', 'long', 'increasing', 'decreasing'].includes(h);
  function interpolate(a, b, t, space = 'lch', hue = 'short') {
    if (t === 0) return a.slice();
    if (t === 1) return b.slice();
    if (space === 'lab') {
      const A = C.lab(a),
        B = C.lab(b);
      return C.gamut(A.map((v, i) => mix(v, B[i], t)));
    }
    const A = lch(a),
      B = lch(b),
      h1 = A[1] < 1e-6 ? B[2] : A[2],
      h2 = B[1] < 1e-6 ? h1 : B[2];
    return encode([
      mix(A[0], B[0], t),
      mix(A[1], B[1], t),
      h1 + ((C.angle((h1 * Math.PI) / 180, (h2 * Math.PI) / 180, hue) * 180) / Math.PI) * t
    ]);
  }
  function channel(def, kind) {
    if (def === undefined) return null;
    const valid = v => (kind === 'hue' ? number(v, -36000, 36000) : number(v, 0, 1));
    if (typeof def === 'number') {
      check(valid(def), 'invalid ' + kind + ' channel');
      return () => def;
    }
    check(
      fields(def, ['stops', 'interpolation']) &&
        Array.isArray(def.stops) &&
        def.stops.length >= 2 &&
        def.stops.length <= 256,
      'invalid ' + kind + ' curve'
    );
    check(
      def.stops.every(p => Array.isArray(p) && p.length === 2 && number(p[0], 0, 1) && valid(p[1])) &&
        def.stops[0][0] === 0 &&
        def.stops.at(-1)[0] === 1,
      kind + ' curve must cover 0–1 with valid channel values'
    );
    return ColorCurves.scalar(def);
  }
  function path(definition) {
    if (brands.path.has(definition)) return definition;
    if (fields(definition, ['transfer']) && definition.transfer) {
      const t = definition.transfer;
      check(fields(t, ['reference', 'anchor', 'options']), 'invalid transfer path');
      return transfer(t.reference, t.anchor, t.options);
    }
    check(
      fields(definition, ['colors', 'curves', 'steps', 'interpolation', 'hue']),
      'path needs colors and/or hue, chroma, lightness curves'
    );
    const def = canonical(definition),
      { curves = {}, steps = 7, interpolation = 'linear', hue = 'short' } = def;
    check(
      fields(curves, ['hue', 'chroma', 'lightness']) &&
        Number.isSafeInteger(steps) &&
        steps >= 2 &&
        steps <= 4096 &&
        ColorCurves.modes.includes(interpolation) &&
        mode(hue),
      'invalid path settings'
    );
    const custom = [
      channel(curves.lightness, 'lightness'),
      channel(curves.chroma, 'chroma'),
      channel(curves.hue, 'hue')
    ];
    let stops;
    if (def.colors !== undefined) {
      check(
        Array.isArray(def.colors) && def.colors.length >= 2 && def.colors.length <= 64,
        'path needs 2–64 color anchors'
      );
      stops = def.colors.map((v, i) => {
        const explicit = fields(v, ['at', 'color']);
        const at = explicit ? v.at : i / (def.colors.length - 1),
          rgb = C.parse(explicit ? v.color : v);
        check(number(at, 0, 1), 'invalid anchor position');
        return { at, rgb, lch: lch(rgb) };
      });
      check(
        stops[0].at === 0 && stops.at(-1).at === 1 && stops.every((p, i) => !i || p.at > stops[i - 1].at),
        'anchors must increase from 0 to 1'
      );
      // Neutral anchors borrow a neighboring chromatic hue instead of inventing a red detour.
      for (let i = 0; i < stops.length; i++)
        if (stops[i].lch[1] < 1e-6) {
          let nearest = null;
          for (let j = 0; j < stops.length; j++)
            if (stops[j].lch[1] >= 1e-6 && (!nearest || Math.abs(j - i) < nearest.distance))
              nearest = { h: stops[j].lch[2], distance: Math.abs(j - i) };
          stops[i].lch[2] = nearest?.h ?? 0;
        }
      for (let i = 1; i < stops.length; i++)
        stops[i].lch[2] =
          stops[i - 1].lch[2] +
          (C.angle((stops[i - 1].lch[2] * Math.PI) / 180, (stops[i].lch[2] * Math.PI) / 180, hue) * 180) / Math.PI;
    } else check(custom.every(Boolean), 'a path without colors needs all three channels');
    const requested = t => {
      check(Number.isFinite(t), 'path coordinate must be finite');
      t = clamp(t);
      let base = [0.5, 0.1, 0];
      if (stops) {
        const high = ColorCurves.segmentIndex(stops, t),
          b = stops[high],
          a = stops[Math.max(0, high - 1)],
          w = a === b ? 0 : t === b.at ? 1 : ColorCurves.weight(interpolation, (t - a.at) / (b.at - a.at));
        base = a.lch.map((v, i) => mix(v, b.lch[i], w));
      }
      return base.map((v, i) => (custom[i] ? custom[i](t) : v));
    };
    const sample = t => {
      check(Number.isFinite(t), 'path coordinate must be finite');
      if (stops && !custom.some(Boolean)) {
        const exact = stops.find(p => p.at === clamp(t));
        if (exact) return exact.rgb.slice();
      }
      return encode(requested(t));
    };
    const api = finishPath(def, steps, sample, requested);
    brands.path.add(api);
    return api;
  }
  function finishPath(def, steps, sample, requested) {
    const rgb = Array.from({ length: steps }, (_, i) => sample(i / (steps - 1)));
    return freeze({
      rgb,
      hex: rgb.map(C.toHex),
      sample,
      lch: requested,
      inspect(t) {
        const desired = requested(t),
          rgb = sample(t),
          actual = lch(rgb);
        return {
          requested: desired,
          mapped: actual,
          rgb,
          hex: C.toHex(rgb),
          gamutMapped: Math.abs(actual[1] - desired[1]) > 1e-6
        };
      },
      snapshot: () => clone(def)
    });
  }
  function transfer(reference, anchor, options = {}) {
    check(fields(options, ['steps', 'pivot', 'strength', 'hueStrength']), 'invalid transfer settings');
    const { steps = 7, pivot = 0.5, strength = 1, hueStrength = 1 } = options;
    check(
      Number.isSafeInteger(steps) &&
        steps >= 2 &&
        steps <= 4096 &&
        number(pivot, 0, 1) &&
        number(strength, 0, 1) &&
        number(hueStrength, 0, 1),
      'invalid transfer range'
    );
    const source = path(Array.isArray(reference) ? { colors: reference } : reference),
      target = C.parse(anchor),
      A = lch(target),
      B = source.lch(pivot);
    const requested = t => {
      const p = source.lch(t),
        L =
          p[0] <= B[0]
            ? A[0] * (B[0] > 1e-9 ? p[0] / B[0] : 1)
            : A[0] + ((1 - A[0]) * (p[0] - B[0])) / Math.max(1e-9, 1 - B[0]);
      const c = B[1] > 1e-6 ? (A[1] * p[1]) / B[1] : A[1] + p[1] - B[1];
      return [
        mix(A[0], clamp(L), strength),
        Math.max(0, mix(A[1], c, strength)),
        A[2] + (p[2] - B[2]) * hueStrength * strength
      ];
    };
    const api = finishPath(
      { transfer: { reference: source.snapshot(), anchor: canonical(anchor), options: canonical(options) } },
      steps,
      t => (t === pivot ? target.slice() : encode(requested(t))),
      requested
    );
    brands.path.add(api);
    return api;
  }
  const curve = values => ({ stops: values.map((v, i) => [i / (values.length - 1), v]), interpolation: 'smooth' });
  function rolePath(input, anchors) {
    check(
      fields(input, [
        'anchor',
        'color',
        'path',
        'steps',
        'lightness',
        'chromaScale',
        'hueShift',
        'curves',
        'reference',
        'pivot',
        'strength',
        'hueStrength'
      ]),
      'invalid role recipe'
    );
    const kinds = ['anchor', 'color', 'path'].filter(k => Object.hasOwn(input, k));
    check(kinds.length === 1, 'each role needs exactly one anchor, color or path');
    const steps = input.steps ?? (kinds[0] === 'color' ? 1 : 7);
    check(Number.isSafeInteger(steps) && steps >= 1 && steps <= 32, 'role steps must be 1–32');
    if (kinds[0] === 'color') {
      check(
        steps === 1 && Object.keys(input).every(k => ['color', 'steps'].includes(k)),
        'a constant role has one color'
      );
      const rgb = C.parse(input.color);
      return { steps, sample: () => rgb.slice() };
    }
    if (kinds[0] === 'path') {
      check(
        Object.keys(input).every(k => ['path', 'steps'].includes(k)),
        'a path role accepts path and steps'
      );
      return { steps, ...path(input.path) };
    }
    check(name(input.anchor) && Object.hasOwn(anchors, input.anchor), 'unknown role anchor: ' + input.anchor);
    if (input.reference !== undefined) {
      check(
        Object.keys(input).every(k => ['anchor', 'steps', 'reference', 'pivot', 'strength', 'hueStrength'].includes(k)),
        'reference roles accept transfer options'
      );
      return {
        steps,
        ...transfer(input.reference, anchors[input.anchor], {
          steps: Math.max(2, steps),
          pivot: input.pivot,
          strength: input.strength,
          hueStrength: input.hueStrength
        })
      };
    }
    const A = lch(C.parse(anchors[input.anchor])),
      lightness = input.lightness ?? [0.14, 0.94],
      chromaScale = input.chromaScale ?? [0.3, 1, 0.12],
      hueShift = input.hueShift ?? [-16, 10];
    check(
      Array.isArray(lightness) &&
        lightness.length === 2 &&
        lightness.every(v => number(v, 0, 1)) &&
        lightness[0] <= lightness[1],
      'invalid role lightness range'
    );
    check(
      Array.isArray(chromaScale) && chromaScale.length === 3 && chromaScale.every(v => number(v, 0, 8)),
      'invalid role chroma scale'
    );
    check(
      Array.isArray(hueShift) && hueShift.length === 2 && hueShift.every(v => number(v, -360, 360)),
      'invalid role hue shift'
    );
    const generated = {
      lightness: curve([lightness[0], clamp(A[0], lightness[0], lightness[1]), lightness[1]]),
      chroma: curve(chromaScale.map(v => Math.min(1, A[1] * v))),
      hue: curve([A[2] + hueShift[0], A[2], A[2] + hueShift[1]]),
      ...input.curves
    };
    check(fields(input.curves ?? {}, ['lightness', 'chroma', 'hue']), 'invalid role curves');
    return { steps, ...path({ curves: generated, steps: Math.max(2, steps) }) };
  }
  function recipe(definition) {
    if (brands.recipe.has(definition)) return definition;
    check(fields(definition, ['anchors', 'roles', 'background']), 'recipe needs anchors and named roles');
    const def = canonical(definition),
      { anchors, roles } = def;
    check(
      record(anchors) &&
        Object.keys(anchors).length >= 1 &&
        Object.keys(anchors).length <= 32 &&
        Object.keys(anchors).every(name),
      'invalid named anchors'
    );
    for (const c of Object.values(anchors)) C.parse(c);
    check(
      record(roles) &&
        Object.keys(roles).length >= 1 &&
        Object.keys(roles).length <= 32 &&
        Object.keys(roles).every(n => name(n) && n !== 'background'),
      'invalid roles; background is reserved'
    );
    const first = lch(C.parse(Object.values(anchors)[0]));
    const background =
      def.background === undefined ? encode([0.065, Math.min(first[1], 0.018), first[2]]) : C.parse(def.background);
    const rgb = [unpack(C.toHex(background))],
      indices = { background: [0] },
      ramps = { background: [C.toHex(background)] },
      paths = {};
    for (const [role, input] of Object.entries(roles)) {
      const p = rolePath(input, anchors);
      paths[role] = p;
      check(rgb.length + p.steps <= 48, 'recipes support at most 48 palette slots including background');
      indices[role] = [];
      ramps[role] = [];
      for (let i = 0; i < p.steps; i++) {
        const hex = C.toHex(p.sample(p.steps === 1 ? 0.5 : i / (p.steps - 1)));
        indices[role].push(rgb.length);
        ramps[role].push(hex);
        rgb.push(unpack(hex));
      }
    }
    const result = freeze({
      palette: rgb.map(C.toHex),
      rgb,
      roles: indices,
      ramps,
      sampleRole(role, t) {
        check(name(role) && Object.hasOwn(indices, role), 'unknown role: ' + role);
        check(Number.isFinite(t), 'shade must be finite');
        return role === 'background' ? rgb[0].slice() : paths[role].sample(t);
      },
      inspectRole(role, t) {
        check(name(role) && Object.hasOwn(indices, role), 'unknown role: ' + role);
        check(Number.isFinite(t), 'shade must be finite');
        if (paths[role]?.inspect) return { role, shade: clamp(t), ...paths[role].inspect(t) };
        const color = role === 'background' ? rgb[0] : paths[role].sample(t),
          point = lch(color);
        return {
          role,
          shade: clamp(t),
          requested: point,
          mapped: point.slice(),
          rgb: color.slice(),
          hex: C.toHex(color),
          gamutMapped: false
        };
      },
      snapshot: () => clone(def)
    });
    brands.recipe.add(result);
    return result;
  }
  function duotone(primary, accent, options = {}) {
    check(fields(options, ['roles', 'background']), 'invalid duotone options');
    C.parse(primary);
    C.parse(accent);
    return recipe({
      anchors: { primary, accent },
      ...canonical(options),
      roles: options.roles ?? { primary: { anchor: 'primary' }, accent: { anchor: 'accent' } }
    });
  }
  function animate(definition) {
    if (brands.animation.has(definition)) return definition;
    check(fields(definition, ['keys', 'playback', 'space', 'hue', 'interpolation']), 'invalid palette animation');
    const { keys, playback = 'clamp', space = 'lch', hue = 'short', interpolation = 'smooth' } = definition;
    check(
      Array.isArray(keys) &&
        keys.length >= 2 &&
        keys.length <= 128 &&
        ['clamp', 'loop', 'pingpong'].includes(playback) &&
        ['lab', 'lch'].includes(space) &&
        mode(hue) &&
        ColorCurves.modes.includes(interpolation),
      'invalid animation settings'
    );
    const frames = keys.map((key, i) => {
      check(
        fields(key, ['time', 'recipe']) &&
          number(key.time, 0, 1e9) &&
          (!i ? key.time === 0 : key.time > keys[i - 1].time),
        'animation keys must increase from time zero'
      );
      return { at: key.time, recipe: recipe(key.recipe) };
    });
    const roles = frames[0].recipe.roles,
      labels = Object.keys(roles),
      duration = frames.at(-1).at;
    for (const key of frames)
      check(
        Object.keys(key.recipe.roles).length === labels.length &&
          labels.every(n => key.recipe.roles[n]?.length === roles[n].length),
        'animated roles and shade counts must stay constant'
      );
    const align = frame => {
      const rgb = [];
      for (const n of labels)
        roles[n].forEach((id, i) => {
          rgb[id] = frame.recipe.rgb[frame.recipe.roles[n][i]];
        });
      return rgb;
    };
    const aligned = frames.map(align);
    if (playback === 'loop')
      check(
        aligned[0].every((rgb, i) => rgb.every((v, c) => Math.abs(v - aligned.at(-1)[i][c]) < 1e-8)),
        'loop endpoints must match; add a closing key or use pingpong'
      );
    function sample(seconds) {
      check(Number.isFinite(seconds), 'animation time must be finite');
      let t = clamp(seconds, 0, duration);
      if (playback === 'loop') t = ((seconds % duration) + duration) % duration;
      if (playback === 'pingpong') {
        t = ((seconds % (duration * 2)) + duration * 2) % (duration * 2);
        if (t > duration) t = duration * 2 - t;
      }
      const high = ColorCurves.segmentIndex(frames, t),
        b = frames[high],
        a = frames[Math.max(0, high - 1)],
        low = Math.max(0, high - 1);
      const w = a === b ? 0 : t === b.at ? 1 : ColorCurves.weight(interpolation, (t - a.at) / (b.at - a.at));
      const rgb = aligned[low].map((color, i) => interpolate(color, aligned[high][i], w, space, hue));
      const palette = rgb.map(C.toHex),
        ramps = Object.fromEntries(labels.map(n => [n, roles[n].map(i => palette[i])]));
      return freeze({ time: seconds, phase: t, palette, rgb, roles, ramps });
    }
    const api = freeze({
      duration,
      roles,
      sample,
      keyTimes: frames.map(p => p.at),
      snapshot: () => ({
        playback,
        space,
        hue,
        interpolation,
        keys: frames.map(p => ({ time: p.at, recipe: p.recipe.snapshot() }))
      })
    });
    brands.animation.add(api);
    return api;
  }
  function bind(world, program, options = {}) {
    check(
      world && Array.isArray(world.pal) && world.pal.length > 0 && world.pal.length <= 64,
      'binding needs a splat world with 1–64 palette slots'
    );
    world.pal.forEach(C.parse);
    check(fields(options, ['roles']), 'invalid binding options');
    const animated = brands.animation.has(program) || (record(program) && Object.hasOwn(program, 'keys'));
    const source = animated ? animate(program) : recipe(program),
      sample = time => (animated ? source.sample(time) : source);
    const initial = sample(0),
      mapping = [];
    if (options.roles === undefined) {
      check(
        world.pal.length === initial.palette.length && world.pal.every((v, i) => v === initial.palette[i]),
        'world palette must match the first recipe, or supply named role mappings'
      );
      for (let i = 0; i < world.pal.length; i++) mapping.push({ slot: i, index: i });
    } else {
      check(
        record(options.roles) && Object.keys(options.roles).length > 0,
        'binding roles must map world role names to recipe role names'
      );
      for (const [from, to] of Object.entries(options.roles)) {
        check(
          name(from) && name(to) && Object.hasOwn(world.paletteRoles ?? {}, from) && Object.hasOwn(initial.roles, to),
          'unknown mapped palette role'
        );
        const ids = world.paletteRoles[from];
        check(
          Array.isArray(ids) &&
            ids.length > 0 &&
            ids.every(i => Number.isSafeInteger(i) && i >= 0 && i < world.pal.length),
          'invalid world role slots'
        );
        ids.forEach((slot, i) =>
          mapping.push({ slot, role: to, shade: ids.length === 1 ? 0.5 : i / (ids.length - 1) })
        );
      }
    }
    const grade = new Float32Array(world.pal.length * 3),
      scratch = new Float32Array(grade.length),
      view = { ...world },
      anim = {},
      base = world.pal.slice();
    const mapped = new Set(mapping.map(row => row.slot));
    const roleLayout =
      options.roles && Object.fromEntries(Object.keys(options.roles).map(n => [n, world.paletteRoles[n].slice()]));
    const fill = (state, priorGrade) => {
      const prior = priorGrade && mapped.size < base.length ? Array.from(priorGrade) : null;
      if (prior) check(prior.length >= base.length * 3 && prior.every(Number.isFinite), 'invalid prior grade');
      for (let i = 0; i < base.length; i++)
        scratch.set(prior && !mapped.has(i) ? prior.slice(i * 3, i * 3 + 3) : unpack(base[i]), i * 3);
      const assigned = new Map();
      for (const row of mapping) {
        let rgb = state.rgb[row.index];
        if (row.role) {
          const ids = state.roles[row.role],
            x = row.shade * (ids.length - 1),
            a = Math.floor(x),
            b = Math.min(ids.length - 1, a + 1);
          rgb = interpolate(state.rgb[ids[a]], state.rgb[ids[b]], x - a);
        }
        const prior = assigned.get(row.slot);
        check(
          !prior || rgb.every((v, c) => Math.abs(v - prior[c]) < 1e-6),
          'overlapping role mappings disagree on a palette slot'
        );
        assigned.set(row.slot, rgb);
        scratch.set(rgb, row.slot * 3);
      }
      const seen = new Map();
      for (let i = 0; i < base.length; i++) {
        const color = base[i],
          prior = seen.get(color),
          rgb = scratch.subarray(i * 3, i * 3 + 3);
        check(
          !prior || rgb.every((v, c) => Math.abs(v - prior[c]) < 1e-6),
          'duplicate source colors cannot animate to different colors'
        );
        if (!prior) seen.set(color, Array.from(rgb));
      }
    };
    // Validate every key before playback, and validate interpolated mappings before committing an update.
    for (const time of animated ? source.keyTimes : [0]) fill(sample(time), world.anim?.grade);
    function update(seconds) {
      check(Number.isFinite(seconds), 'binding time must be finite');
      check(
        world.pal.length === base.length && world.pal.every((v, i) => v === base[i]),
        'source palette layout changed; rebind it'
      );
      const state = sample(seconds);
      if (roleLayout)
        check(
          Object.entries(roleLayout).every(
            ([name, ids]) =>
              world.paletteRoles?.[name]?.length === ids.length &&
              ids.every((id, i) => world.paletteRoles[name][i] === id)
          ),
          'source role layout changed; rebind it'
        );
      fill(state, world.anim?.grade);
      grade.set(scratch);
      for (const key of Object.keys(view)) if (!Object.hasOwn(world, key)) delete view[key];
      Object.assign(view, world);
      for (const key of Object.keys(anim)) delete anim[key];
      Object.assign(anim, world.anim, { grade });
      view.anim = anim;
      if (!view.paletteRoles) view.paletteRoles = initial.roles;
      return view;
    }
    update(0);
    return Object.freeze({ world: view, grade, update, sample, source });
  }
  K.palette = Object.freeze({ path, transfer, recipe, duotone, animate, bind, extract: PaletteExtract.extract,
    hueBrightness: PaletteFields.hueBrightness, polar: PaletteFields.polar, coverage: PaletteFields.coverage,
    chromaField: PaletteFields.chromaField, ramp: PaletteFields.ramp, plot: P.materials.palettePlot,
    chart: P.materials.paletteChart, reviewPairs: P.materials.palettePairReview, reviewRamp: P.materials.reviewRamp,
    distributions: PaletteDistributions.analyze, compareDistributions: PaletteDistributions.compare,
    fitDither: P.materials.fitDither, reviewDither: P.materials.reviewDither, lightingRamps: P.materials.lightingRamps });
})(KIT);
