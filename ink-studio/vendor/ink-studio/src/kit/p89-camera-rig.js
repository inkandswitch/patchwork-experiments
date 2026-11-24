/* Authored shots sampled on the same clock as the scene. */
(function (K) {
  const { V, M } = K,
    { clone, freeze } = K.procedural.data;
  const finite = Number.isFinite,
    range = (n, lo, hi) => finite(n) && n >= lo && n <= hi;
  const xyz = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(finite);
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Camera rig: ' + message);
  };
  const name = n => K.world.data.id(n);
  const record = o => K.world.data.record(o);
  const keys = (o, allowed) => record(o) && Object.keys(o).every(k => allowed.includes(k));
  const timeOK = t => finite(t) && t >= 0;
  const fovOK = fov => finite(fov) && fov > 0 && fov < Math.PI;
  const projectionOK = value => value === 'perspective' || value === 'orthographic';
  const minimumArm = 0.41;
  const defaultFov = (38 * Math.PI) / 180;
  const back = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
  const mix = (a, b, u) => (1 - u) * a + u * b;
  const logMix = (a, b, u) => Math.exp(mix(Math.log(a), Math.log(b), u));
  const height = ({ dist, fov }) => dist * Math.tan(fov / 2);

  function catalog(rows, kind, parse) {
    check(record(rows) && Object.keys(rows).length <= 128, 'expected a bounded ' + kind + ' catalog');
    return new Map(
      Object.entries(rows).map(([id, value]) => {
        check(name(id), 'invalid ' + kind + ' ID ' + id);
        return [id, parse(value, id)];
      })
    );
  }

  function target(row, id, parts) {
    if (row?.node !== undefined) {
      K.sceneGraph.reference({ node: row.node, ...(row.socket !== undefined && { socket: row.socket }) });
      check(
        keys(row, ['node', 'socket', 'offset', 'fallback']) &&
          (row.offset === undefined || xyz(row.offset)) &&
          (row.fallback === undefined || xyz(row.fallback)),
        'invalid hierarchy target ' + id
      );
      return row;
    }
    const { point, part, entity, socket, offset, fallback } = row ?? {};
    check(
      keys(row, ['point', 'part', 'entity', 'socket', 'offset', 'fallback']) &&
        (part === undefined || (name(part) && point !== undefined && (!parts || parts.has(part)))) &&
        (point === undefined || xyz(point)) &&
        (entity === undefined || (name(entity) && point === undefined)) &&
        (socket === undefined || (name(socket) && entity !== undefined)) &&
        (point !== undefined || entity !== undefined) &&
        (offset === undefined || xyz(offset)) &&
        (fallback === undefined || xyz(fallback)),
      'invalid framing target ' + id
    );
    return row;
  }

  function rail(row, id) {
    if (row?.interpolated !== undefined) {
      check(
        keys(row, ['interpolated']) && keys(row.interpolated, ['points', 'options']),
        'invalid interpolated rail: ' + id
      );
      return K.curve.interpolate(row.interpolated.points, row.interpolated.options ?? {});
    }
    if (row?.family !== undefined) {
      check(keys(row, ['family']), 'family rails accept only their family definition: ' + id);
      return K.curve.create(row.family);
    }
    const { points, curve = 1, closed = false } = row ?? {};
    check(
      keys(row, ['points', 'curve', 'closed']) &&
        Array.isArray(points) &&
        points.length >= (closed ? 3 : 2) &&
        points.length <= 128 &&
        Array.from(points).every(xyz) &&
        range(curve, 0, 1) &&
        typeof closed === 'boolean' &&
        points.every((p, i) => i === 0 || V.dist(p, points[i - 1]) > 1e-6) &&
        (!closed || V.dist(points[0], points.at(-1)) > 1e-6),
      'invalid rail ' + id
    );
    const path = K.anim.path(points, { curve, closed, steps: 24 });
    check(finite(path.length), 'rail length must be finite for ' + id);
    return path;
  }

  function progress(input, id) {
    if (range(input, 0, 1)) return { duration: 0, sample: () => input };
    check(
      Array.isArray(input) &&
        input.length > 0 &&
        input.length <= 1024 &&
        Array.from(input).every(key => keys(key, ['time', 'value', 'ease']) && range(key.value, 0, 1)),
      'invalid rail progress for ' + id
    );
    const track = K.anim.keyframeTrack.create(
      { progress: 'number' },
      input.map(key => ({ ...key, value: { progress: key.value } }))
    );
    return { duration: track.duration, sample: t => track.sample(t).progress };
  }

  function avoidanceSettings(input) {
    if (input === undefined || input === false) return null;
    const {
      radius = 0.12,
      start = 0.35,
      minDistance = 0.6,
      yawOffsets = [],
      ignore = [],
      field
    } = input === true ? {} : (input ?? {});
    check(
      (input === true || keys(input, ['radius', 'start', 'minDistance', 'yawOffsets', 'ignore', 'field'])) &&
        finite(radius) &&
        radius >= 0 &&
        timeOK(start) &&
        finite(minDistance) &&
        minDistance >= minimumArm &&
        Array.isArray(yawOffsets) &&
        yawOffsets.length <= 12 &&
        Array.from(yawOffsets).every(n => range(n, -Math.PI, Math.PI)) &&
        Array.isArray(ignore) &&
        ignore.length <= 128 &&
        (field === undefined || (typeof field === 'string' && /^[^/]+\/[^/]+$/.test(field))),
      'invalid avoidance settings'
    );
    return {
      radius,
      start,
      minDistance,
      yawOffsets: [0, ...new Set(yawOffsets.filter(n => n !== 0))],
      ignore: Array.from(ignore, selector => TargetSelectors.prepare(selector)),
      field
    };
  }

  function shotSequence(input, shots) {
    const rows = input ?? [{ time: 0, shot: shots.keys().next().value }];
    check(Array.isArray(rows) && rows.length > 0 && rows.length <= 1024, 'expected a bounded shot sequence');
    const easeNames = K.anim.keyframeTrack.eases;
    return Array.from(rows, (row, i) => {
      const { time, shot, blend = 0, ease = 'smooth', projectionAt = 0.5 } = row ?? {};
      const previous = rows[i - 1];
      check(
        keys(row, ['time', 'shot', 'blend', 'ease', 'projectionAt']) &&
          shots.has(shot) &&
          timeOK(time) &&
          timeOK(blend) &&
          timeOK(time + blend) &&
          range(projectionAt, 0, 1) &&
          easeNames.includes(ease) &&
          (i ? time > previous.time && time >= previous.time + (previous.blend ?? 0) : time === 0 && blend === 0),
        'invalid shot or overlapping transition at sequence row ' + i
      );
      return { time, shot, blend, ease, projectionAt };
    });
  }

  function framing(row, base, resolveTarget) {
    if (!row) return base.target;
    if (xyz(row)) return row;
    const frame = row.entity || row.part || row.node ? resolveTarget?.(row) : { point: row.point };
    if (!xyz(frame?.point)) return row.fallback ?? base.target;
    return row.offset
      ? V.add(frame.point, frame.rotation ? M.app(frame.rotation, row.offset) : row.offset)
      : frame.point;
  }

  function shotCamera(shot, time, base, channels, ctx) {
    const target = channels.target ?? framing(shot.focus, base, ctx.resolveTarget);
    const move = shot.motion?.sample(time) ?? {};
    const position =
      move.eye ?? shot.path?.at((channels.railProgress ?? shot.progress.sample(time)) * shot.path.length).p ?? shot.eye;
    const relative = position && V.sub(position, target),
      length = relative && V.len(relative),
      level = relative && Math.hypot(relative[0], relative[2]);
    check(!position || length > 1e-8, 'camera eye must differ from its target');
    const yaw =
      channels.yaw ?? (level > 1e-8 ? Math.atan2(relative[0], relative[2]) : (move.yaw ?? shot.yaw ?? base.yaw));
    const pitch =
      channels.pitch ?? (length > 1e-8 ? Math.atan2(relative[1], level) : (move.pitch ?? shot.pitch ?? base.pitch));
    let dist = length > 1e-8 ? length : (move.distance ?? shot.dist ?? base.dist);
    const sensorHeight =
      shot.sensorHeight ?? (shot.focalLength !== undefined ? CameraLens.defaultSensorHeight : base.sensorHeight);
    let fov = shot.fov ?? base.fov;
    if (shot.motion?.type === 'dollyZoom') {
      const frameHeight = shot.motion.frameHeight ?? shot.motion.sample(0).distance * Math.tan(fov / 2) * 2;
      fov = 2 * Math.atan(frameHeight / (2 * dist));
    }
    if (shot.framing) {
      const frameHeight = shot.framing.height / shot.framing.coverage;
      if (shot.framing.mode === 'lens') fov = 2 * Math.atan(frameHeight / (2 * dist));
      else dist = frameHeight / (2 * Math.tan(fov / 2));
    }
    const focusDistance = channels.focusDistance ?? shot.breathing?.focus.sample(time) ?? length ?? dist;
    if (shot.breathing) {
      const gain = K.clamp(1 + shot.breathing.amount * (shot.breathing.reference / focusDistance - 1), 0.25, 4);
      fov = 2 * Math.atan(Math.tan(fov / 2) / gain);
    }
    const lens = CameraLens.resolve({ fov, sensorHeight, focusDistance }, lensChannels(channels));
    const projection = channels.projection ?? shot.projection;
    return {
      target,
      yaw,
      pitch,
      dist: channels.dist ?? dist,
      fov: lens.fov,
      sensorHeight: lens.sensorHeight,
      focusDistance: lens.focusDistance,
      composition: channels.composition ?? shot.composition ?? base.composition ?? [0.5, 0.5],
      ortho: projection === undefined ? base.ortho : projection === 'orthographic'
    };
  }

  function blendCamera(a, b, u, useIncomingProjection) {
    if (u === 0 || u === 1) {
      const end = u === 0 ? a : b;
      return { ...end, ortho: useIncomingProjection ? b.ortho : a.ortho };
    }
    const dist = logMix(a.dist, b.dist, u);
    return {
      target: a.target.map((x, i) => mix(x, b.target[i], u)),
      dist,
      yaw: a.yaw + angle(b.yaw - a.yaw) * u,
      pitch: mix(a.pitch, b.pitch, u),
      fov: 2 * Math.atan(logMix(height(a), height(b), u) / dist),
      ...((a.sensorHeight !== undefined || b.sensorHeight !== undefined) && {
        sensorHeight: mix(
          a.sensorHeight ?? CameraStaging.defaultSensorHeight,
          b.sensorHeight ?? CameraStaging.defaultSensorHeight,
          u
        )
      }),
      composition: (a.composition ?? [0.5, 0.5]).map((v, i) => mix(v, (b.composition ?? [0.5, 0.5])[i], u)),
      ...((a.focusDistance !== undefined || b.focusDistance !== undefined) && {
        focusDistance: logMix(a.focusDistance ?? a.dist, b.focusDistance ?? b.dist, u)
      }),
      ortho: useIncomingProjection ? b.ortho : a.ortho
    };
  }

  function avoid(camera, settings, ctx, exclude, orbit) {
    if (!settings || (!ctx.clearance && !ctx.occlusion)) return { camera };
    const { target, dist, yaw, pitch } = camera,
      { radius, start, minDistance, yawOffsets } = settings;
    let best,
      turn = 0;
    for (const offset of yawOffsets) {
      const candidate = yaw + offset;
      if (offset && Math.abs(CameraStaging.constrain({ ...camera, yaw: candidate }, orbit).yaw - candidate) > 1e-9)
        continue;
      const direction = back(candidate, pitch);
      const origin = V.mad(target, direction, Math.min(start, dist)),
        length = Math.max(0, dist - start);
      let available = length;
      if (length && ctx.clearance) {
        available = 0;
        for (let i = 0; i < 256 && available < length; i++) {
          const room = ctx.clearance(V.mad(origin, direction, available), { radius, exclude }) - radius;
          check(finite(room) || room === Infinity, 'clearance must return a signed distance or positive infinity');
          if (room <= 0.001) break;
          available = Math.min(length, available + room);
        }
      } else if (length) {
        const hit = ctx.occlusion({ origin, direction, maxDistance: length + radius, radius, exclude });
        check(
          hit === undefined || (finite(hit) && hit >= 0),
          'occlusion must return a nonnegative distance or undefined'
        );
        if (hit !== undefined) available = Math.min(length, Math.max(0, hit - radius));
      }
      if (best === undefined || available > best + 1e-8) {
        best = available;
        turn = offset;
      }
      if (available === length) break;
    }
    const free = Math.min(start, dist) + best;
    const resolved = Math.max(Math.min(dist, Math.max(minDistance, orbit?.distance?.[0] ?? 0)), free);
    return {
      camera: { ...camera, yaw: yaw + turn, dist: resolved, fov: 2 * Math.atan(height(camera) / resolved) },
      avoidance: {
        requested: dist,
        available: free,
        shortened: resolved < dist - 1e-8,
        yawOffset: turn,
        occluded: free < resolved - 1e-8
      }
    };
  }

  function timed(value, kind, validate, id) {
    if (validate(value)) return { duration: 0, sample: () => value };
    check(
      Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 1024 &&
        value.every(key => keys(key, ['time', 'value', 'ease']) && validate(key.value)),
      'invalid motion track ' + id
    );
    const track = K.anim.keyframeTrack.create(
      { value: kind },
      value.map(key => ({ ...key, value: { value: key.value } }))
    );
    return { duration: track.duration, sample: t => track.sample(t).value };
  }
  function motion(row, id) {
    if (row === undefined) return;
    check(keys(row, ['type', 'yaw', 'pitch', 'distance', 'eye', 'frameHeight']), 'invalid motion ' + id);
    const fields =
      row.type === 'orbit'
        ? ['yaw', 'pitch', 'distance']
        : row.type === 'crane'
          ? ['eye']
          : row.type === 'dollyZoom'
            ? ['distance']
            : null;
    check(
      fields &&
        Object.keys(row).every(key =>
          ['type', ...(row.type === 'dollyZoom' ? ['frameHeight'] : []), ...fields].includes(key)
        ) &&
        fields.some(key => row[key] !== undefined) &&
        (row.type !== 'crane' || row.eye !== undefined) &&
        (row.type !== 'dollyZoom' || row.distance !== undefined) &&
        (row.frameHeight === undefined || (finite(row.frameHeight) && row.frameHeight > 0)),
      'invalid motion ' + id
    );
    const tracks = Object.fromEntries(
      fields
        .filter(key => row[key] !== undefined)
        .map(key => [
          key,
          timed(
            row[key],
            key === 'eye' ? 'vector' : 'number',
            key === 'eye'
              ? xyz
              : key === 'distance'
                ? n => finite(n) && n >= minimumArm
                : key === 'pitch'
                  ? n => range(n, -Math.PI / 2, Math.PI / 2)
                  : finite,
            id + '.' + key
          )
        ])
    );
    return {
      type: row.type,
      frameHeight: row.frameHeight,
      duration: Math.max(0, ...Object.values(tracks).map(t => t.duration)),
      sample: t => Object.fromEntries(Object.entries(tracks).map(([key, track]) => [key, track.sample(t)]))
    };
  }
  function subjectFraming(row, move, id) {
    if (row === undefined) return;
    check(
      keys(row, ['height', 'coverage', 'mode']) &&
        finite(row.height) &&
        row.height > 0 &&
        range(row.coverage ?? 0.6, 0.01, 1) &&
        ['distance', 'lens'].includes(row.mode ?? 'distance'),
      'invalid subject framing ' + id
    );
    const mode = row.mode ?? (move?.type === 'dollyZoom' ? 'lens' : 'distance');
    check(
      !(move?.type === 'dollyZoom' && (mode !== 'lens' || move.frameHeight !== undefined)),
      'dolly zoom needs one lens framing rule'
    );
    return { ...row, coverage: row.coverage ?? 0.6, mode };
  }
  function breathing(row, id) {
    if (row === undefined) return;
    check(
      keys(row, ['amount', 'reference', 'focus']) &&
        range(row.amount, -0.25, 0.25) &&
        finite(row.reference) &&
        row.reference > 0 &&
        row.focus !== undefined,
      'invalid lens breathing ' + id
    );
    return { ...row, focus: timed(row.focus, 'positive', n => finite(n) && n >= 0.05, id + '.focus') };
  }
  const lensChannels = channels =>
    Object.fromEntries(
      ['fov', 'focalLength', 'sensorHeight', 'focusDistance']
        .filter(key => channels[key] !== undefined)
        .map(key => [key, channels[key]])
    );

  function compile(definition, { parts } = {}) {
    const root = freeze(clone(definition));
    check(
      keys(root, ['targets', 'rails', 'shots', 'sequence', 'avoidance', 'orbit', 'duration']),
      'invalid definition'
    );
    const orbit = CameraStaging.orbit(root.orbit, minimumArm);
    const targets = catalog(root.targets ?? {}, 'target', (row, id) => target(row, id, parts));
    const rails = catalog(root.rails ?? {}, 'rail', rail);
    const shots = catalog(root.shots, 'shot', (row, id) => {
      const {
        target,
        rail,
        eye,
        progress: travel,
        dist,
        yaw,
        pitch,
        fov,
        focalLength,
        sensorHeight,
        projection
      } = row ?? {};
      check(
        keys(row, [
          'target',
          'rail',
          'progress',
          'eye',
          'dist',
          'yaw',
          'pitch',
          'fov',
          'focalLength',
          'sensorHeight',
          'projection',
          'motion',
          'framing',
          'composition',
          'lensBreathing'
        ]) &&
          (target === undefined || xyz(target) || targets.has(target)) &&
          (rail === undefined || rails.has(rail)) &&
          (eye === undefined || (xyz(eye) && rail === undefined)) &&
          (travel === undefined || rail !== undefined) &&
          (!(rail || eye || row.motion?.type === 'crane') || [dist, yaw, pitch].every(n => n === undefined)) &&
          (row.motion === undefined || (rail === undefined && eye === undefined)) &&
          (dist === undefined || (finite(dist) && dist >= minimumArm)) &&
          (yaw === undefined || finite(yaw)) &&
          (pitch === undefined || range(pitch, -Math.PI / 2, Math.PI / 2)) &&
          (fov === undefined || (fovOK(fov) && focalLength === undefined)) &&
          (sensorHeight === undefined || focalLength !== undefined) &&
          (projection === undefined || projectionOK(projection)),
        'invalid shot ' + id
      );
      const focus = targets.get(target) ?? target,
        move = motion(row.motion, id),
        framing = subjectFraming(row.framing, move, id),
        breath = breathing(row.lensBreathing, id);
      if (row.composition !== undefined) CameraLens.composition(row.composition);
      check(!(move?.type === 'dollyZoom' && projection === 'orthographic'), 'dolly zoom requires perspective');
      return {
        ...row,
        motion: move,
        framing,
        breathing: breath,
        fov: focalLength === undefined ? fov : CameraStaging.fieldOfView(focalLength, sensorHeight),
        focus,
        path: rails.get(rail),
        progress: progress(travel ?? 0, id)
      };
    });
    check(shots.size > 0, 'at least one shot is required');
    const sequence = shotSequence(root.sequence, shots);
    const avoidance = avoidanceSettings(root.avoidance);
    const end = Math.max(
      ...sequence.map(
        row =>
          row.time +
          Math.max(
            row.blend,
            shots.get(row.shot).progress.duration,
            shots.get(row.shot).motion?.duration ?? 0,
            shots.get(row.shot).breathing?.focus.duration ?? 0
          )
      )
    );
    const duration = root.duration ?? end;
    check(timeOK(duration) && duration >= end, 'duration must contain each scheduled blend and rail track');

    function sample(time, ctx = {}) {
      check(timeOK(time), 'sample time must be nonnegative and finite');
      const base = CameraLens.view(ctx.base);
      base.ortho ??= base.projection === 'orthographic';
      const channels = ctx.channels ?? {};
      const selected = ctx.shot ?? channels.shot;
      const index = sequence.findLastIndex(row => row.time <= time);
      const current = sequence[index],
        incoming = selected ?? current.shot;
      check(shots.has(incoming), 'unknown shot ' + incoming);
      const shot = shots.get(incoming);
      const dest = shotCamera(shot, selected === undefined ? time - current.time : time, base, channels, ctx);
      let camera = dest,
        blend,
        source;
      if (selected === undefined && current.blend && time < current.time + current.blend) {
        const prior = sequence[index - 1];
        source = shots.get(prior.shot);
        const phase = (time - current.time) / current.blend,
          weight = K.anim.ease(phase, current.ease);
        const from = shotCamera(source, time - prior.time, base, channels, ctx);
        camera = blendCamera(from, dest, weight, time >= current.time + current.blend * current.projectionAt);
        blend = { from: prior.shot, to: incoming, phase, weight };
      }
      check(
        xyz(camera.target) &&
          finite(camera.yaw) &&
          finite(camera.pitch) &&
          finite(camera.dist) &&
          camera.dist > 0 &&
          fovOK(camera.fov) &&
          finite(height(camera)),
        'sampled camera needs a finite pose and lens'
      );
      check(!(shot.motion?.type === 'dollyZoom' && camera.ortho), 'dolly zoom requires perspective');
      CameraLens.composition(camera.composition);
      const exclude = [
        ...new Set([shot.focus, source?.focus].map(focus => focus?.entity ?? focus?.part).filter(Boolean))
      ];
      camera = CameraStaging.constrain(camera, orbit);
      const result = avoid(camera, avoidance, ctx, exclude, orbit);
      return {
        time,
        shot: incoming,
        ...result,
        lens: CameraLens.resolve(result.camera),
        ...(shot.motion && { technique: shot.motion.type }),
        ...(blend && { blend })
      };
    }
    return Object.freeze({ duration, shots: Object.freeze([...shots.keys()]), sample, avoidance: freeze(avoidance) });
  }

  function channel(field, shots) {
    if (field === 'shot') return shots && { mode: 'step', validate: value => shots.includes(value) };
    if (field === 'railProgress' && !shots) return null;
    return Object.hasOwn(K.timeline.camera, field) ? K.timeline.camera[field] : null;
  }

  function bind(world, program, { query = world.lookSnapshot?.query, resolvePart } = {}) {
    const settings = program.avoidance;
    const base = { ...world.cam, target: world.cam.target?.slice() };
    function resolveTarget(row) {
      if (row.node) {
        const graph = world.sceneGraph;
        if (!graph?.has(row.node) || (row.socket && !graph.node(row.node).sockets.includes(row.socket))) return;
        const f = graph.frame({ node: row.node, ...(row.socket && { socket: row.socket }) });
        return f.visible ? { point: f.position, rotation: f.matrix } : undefined;
      }
      if (row.part) return resolvePart?.(row.part, row.point) ?? { point: row.point };
      return query?.frame({ entity: row.entity, socket: row.socket });
    }
    function sample(time, { shot, channels: overrides = {} } = {}) {
      const channels = {
        ...Object.fromEntries(
          (world.timeline?.sample(time).edits ?? []).flatMap(({ path, value }) =>
            path[0] === 'camera' ? [[path[1], value]] : []
          )
        ),
        ...overrides
      };
      const args = { shot, channels, base, resolveTarget };
      let picker;
      if (settings?.field && query?.field?.(settings.field)?.type === 'number')
        args.clearance = (point, { exclude }) => {
          const result = query.probe(settings.field, point, { exclude: exclude.length > 1 ? exclude : exclude[0] });
          return result.status === 'ok' ? result.value : Infinity;
        };
      else if (settings)
        args.occlusion = ({ origin, direction, maxDistance, radius, exclude }) => {
          picker ??= K.procedural.contributions.create(world, { time });
          const right = V.perp(direction),
            up = V.cross(direction, right);
          const origins = [
            origin,
            ...(radius ? [right, up].flatMap(axis => [-radius, radius].map(offset => V.mad(origin, axis, offset))) : [])
          ];
          let closest;
          for (const point of origins) {
            const hit = picker.ray({
              origin: point,
              direction,
              maxDistance: closest ?? maxDistance,
              water: false,
              accept: row =>
                row.solid &&
                !exclude.includes(row.target.entity) &&
                !exclude.includes(row.target.object) &&
                !settings.ignore.some(selector => TargetSelectors.matches(selector, row.target))
            }).solid;
            if (hit) closest = hit.distance;
          }
          return closest;
        };
      return program.sample(time, args);
    }
    world.cameraRig = Object.freeze({ duration: program.duration, shots: program.shots, sample });
    return world;
  }

  K.cameraStaging = CameraStaging;
  K.cameraRig = Object.freeze({
    compile,
    channel,
    bind,
    defaultFov,
    fovOK,
    projectionOK,
    control: K.cameraControl,
    blend: (a, b, u) => {
      check(range(u, 0, 1), 'blend weight must be in [0,1]');
      return blendCamera(CameraLens.view(a), CameraLens.view(b), u, u >= 0.5);
    },
    lens: CameraLens.resolve
  });
})(KIT);
