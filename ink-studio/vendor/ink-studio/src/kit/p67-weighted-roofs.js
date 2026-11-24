/* Pitched roof faces traced by a weighted inward polygon wavefront. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-9,
    det = (a, b) => a[0] * b[1] - a[1] * b[0],
    dot = (a, b) => a[0] * b[0] + a[1] * b[1],
    sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
    distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    area = points => points.reduce((sum, p, i) =>
      sum + det(sub(p, points[0]), sub(points[(i + 1) % points.length], points[0])), 0) * 0.5,
    integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;

  function weightedRoof(rings, {
    pitch = Math.PI / 5, pitches, maxEvents = 720, maxChecks = 3500000, maxFaces = 22000
  } = {}) {
    const profile = P.construct.profile(rings),
      count = profile.edges.length, bounds = profile.bounds;
    if (count > 240 || !integer(maxEvents, 1, 3000) || !integer(maxChecks, 1, 30000000) ||
      !integer(maxFaces, 1, 120000) || (pitches !== undefined && (
        !Array.isArray(pitches) || pitches.length !== profile.rings.length ||
        pitches.some((ring, i) => !Array.isArray(ring) || ring.length !== profile.rings[i].length)
      ))) throw new Error('Weighted roofs need bounded rings and one pitch per source edge');
    const origin = bounds.min.map((v, i) => v + (bounds.max[i] - v) * 0.5),
      extent = Math.max(1, ...bounds.max.map((v, i) => v - bounds.min[i])), tolerance = extent * 1e-8,
      local = p => sub(p, origin), world = p => [p[0] + origin[0], p[1] + origin[1]],
      atY = (p, h) => [p[0] + origin[0], h, p[1] + origin[1]],
      work = { checks: 0, events: 0 },
      faces = [], arcs = [], panels = [], events = [], flatRidges = new Set(), slots = profile.rings.map(() => []);
    let token = 0;
    for (const edge of profile.edges) {
      const angle = pitches?.[edge.ring][edge.source] ?? pitch;
      if (!Number.isFinite(angle) || angle < 0.035 || angle > 1.52)
        throw new Error('Roof pitches are radians between 0.035 and 1.52');
      const delta = sub(edge.b, edge.a), l = Math.hypot(...delta),
        dir = [delta[0] / l, delta[1] / l], normal = [-dir[1], dir[0]],
        speed = 1 / Math.tan(angle), c = dot(normal, local(edge.a));
      slots[edge.ring].push({ token: token++, key: edge.ring + '/' + edge.source, normal, dir, speed, c, pitch: angle });
    }
    const scale = Math.max(...slots.flat().map(e => e.speed)),
      timeTolerance = tolerance / scale, loopArea = profile.rings.reduce((sum, ring) => sum + area(ring), 0);
    const rhs = (edge, time) => edge.c + edge.speed * time;
    function meet(a, b, time) {
      const d = det(a.normal, b.normal);
      if (Math.abs(d) < EPS) return null;
      const from = rhs(a, time), to = rhs(b, time);
      return [(from * b.normal[1] - a.normal[1] * to) / d, (a.normal[0] * to - from * b.normal[0]) / d];
    }
    function velocity(a, b) {
      const d = det(a.normal, b.normal);
      return [(a.speed * b.normal[1] - a.normal[1] * b.speed) / d, (a.normal[0] * b.speed - a.speed * b.normal[0]) / d];
    }
    function vertex(a, b, time) {
      const p = meet(a, b, time);
      return p ? { p, v: velocity(a, b), reflex: det(a.dir, b.dir) < -EPS } : null;
    }
    const shift = (p, dt) => [p.p[0] + p.v[0] * dt, p.p[1] + p.v[1] * dt],
      nextIndex = (i, n) => (i + 1) % n, prevIndex = (i, n) => (i + n - 1) % n;
    for (const ring of slots) {
      for (let i = ring.length - 1; i >= 0 && ring.length > 2; i--) {
        const a = ring[i], b = ring[nextIndex(i, ring.length)];
        if (Math.abs(det(a.normal, b.normal)) > EPS) continue;
        if (dot(a.normal, b.normal) < 0 || Math.abs(a.c - b.c) > tolerance ||
          Math.abs(a.speed - b.speed) > EPS)
          throw new Error('Consecutive parallel roof edges need compatible pitches');
        ring.splice(nextIndex(i, ring.length), 1);
        if (i >= ring.length) i = ring.length - 1;
      }
    }
    let active = slots, time = 0, status = 'ok', reason = '';

    function normalize(ring, time, snapshot) {
      while (ring.length >= 3) {
        let adjusted = false;
        for (const [i, a] of ring.entries()) {
          const j = nextIndex(i, ring.length), b = ring[j];
          if (Math.abs(det(a.normal, b.normal)) >= EPS) continue;
          if (dot(a.normal, b.normal) > 0) {
            const keepA = rhs(a, time + 4 * timeTolerance) >= rhs(b, time + 4 * timeTolerance);
            ring.splice(keepA ? j : i, 1);
          } else {
            if (Math.abs(rhs(a, time) + rhs(b, time)) > 8 * tolerance) return null;
            const start = meet(ring[prevIndex(i, ring.length)], a, time) ?? snapshot.get(a.token)?.a,
              end = meet(b, ring[nextIndex(j, ring.length)], time) ?? snapshot.get(b.token)?.b;
            if (!start || !end) return null;
            const difference = dot(a.dir, sub(end, start));
            if (Math.abs(difference) <= tolerance) {
              ring.splice(Math.max(i, j), 1);
              ring.splice(Math.min(i, j), 1);
            } else ring.splice(difference > 0 ? j : i, 1);
          }
          adjusted = true;
          break;
        }
        if (adjusted) continue;
        const points = ring.map((e, i) => vertex(ring[prevIndex(i, ring.length)], e, time)),
          kept = ring.filter((edge, i) => {
            const a = points[i], b = points[nextIndex(i, ring.length)],
              length = dot(edge.dir, sub(b.p, a.p)), rate = dot(edge.dir, sub(b.v, a.v));
            return length > tolerance || (length >= -tolerance && rate > EPS);
          });
        if (kept.length === ring.length) return ring;
        ring = kept;
      }
      return [];
    }

    function strip(edge, a, b, c, d, low, high) {
      const shape = [[a,low],[b,low],[c,high],[d,high]], filtered = [];
      for (const passage of shape)
        if (!filtered.length || distance(filtered.at(-1)[0], passage[0]) > tolerance) filtered.push(passage);
      if (filtered.length > 1 && distance(filtered[0][0], filtered.at(-1)[0]) <= tolerance) filtered.pop();
      const flat = filtered.map(([p]) => p), measure = flat.length >= 3 ? area(flat) : 0;
      if (measure <= tolerance * tolerance) return;
      const planar = flat.map(world), sd = P.geometry.profileDistance(planar),
        rect = {
          min: [0,1].map(i => Math.min(...planar.map(p => p[i]))),
          max: [0,1].map(i => Math.max(...planar.map(p => p[i])))
        };
      panels.push({ edge, sd, bounds: rect, measure });
      faces.push({ key: edge.key + '/' + faces.length, edge: edge.key, pitch: edge.pitch,
        points: filtered.map(([p,h]) => atY(p,h)), planar, rise: [low, high] });
    }

    trace:
    while (active.length) {
      if (work.events >= maxEvents) { status = 'budget'; reason = 'event limit'; break; }
      const wave = active.map(ring => ({
        ring, points: ring.map((edge, i) => vertex(ring[prevIndex(i, ring.length)], edge, time))
      }));
      if (wave.some(({ points }) => points.some(p => !p))) { status = 'degenerate'; reason = 'parallel wavefront'; break; }
      let best = null;
      function take(event) {
        if (event.dt < -timeTolerance || !Number.isFinite(event.dt)) return;
        event.dt = Math.max(0, event.dt);
        if (!best || event.dt < best.dt - timeTolerance ||
          (Math.abs(best.dt - event.dt) <= timeTolerance && best.kind === 'edge' && event.kind !== 'edge')) best = event;
      }
      for (const [w, region] of wave.entries()) {
        const { ring, points } = region;
        for (const [i, edge] of ring.entries()) {
          if (work.checks >= maxChecks) { status = 'budget'; reason = 'event search'; break trace; }
          work.checks++;
          const j = nextIndex(i, ring.length), rate = dot(edge.dir, sub(points[j].v, points[i].v)),
            run = dot(edge.dir, sub(points[j].p, points[i].p));
          if (rate < -EPS) take({ kind: 'edge', w, i, dt: -run / rate });
          if (!points[i].reflex) continue;
          for (const [other, front] of wave.entries()) for (const [slot, face] of front.ring.entries()) {
            if (work.checks >= maxChecks) { status = 'budget'; reason = 'event search'; break trace; }
            work.checks++;
            if (w === other && (slot === i || slot === prevIndex(i, ring.length))) continue;
            const rate = dot(points[i].v, face.normal) - face.speed;
            if (rate >= -EPS) continue;
            const dt = (rhs(face, time) - dot(points[i].p, face.normal)) / rate;
            if (dt < -timeTolerance || (best && dt > best.dt + timeTolerance)) continue;
            const p = shift(points[i], dt), a = shift(front.points[slot], dt),
              b = shift(front.points[nextIndex(slot, front.ring.length)], dt),
              along = dot(face.dir, sub(p, a)), span = dot(face.dir, sub(b, a));
            if (along < -tolerance || along > span + tolerance || span <= tolerance) continue;
            // Just-created reflex vertices may start on a nonadjacent continuation of their own edge.
            if (dt <= timeTolerance && w === other && ring[prevIndex(i, ring.length)].key === face.key) continue;
            take({ kind: w === other ? 'split' : 'join', w, i, other, slot, dt });
          }
        }
      }
      if (!best) { status = 'degenerate'; reason = 'wavefront did not close'; break; }
      const high = time + best.dt, snapshot = new Map(),
        { w, i } = best, source = active[w], vertexPoint = shift(wave[w].points[i], best.dt),
        edges = active.flat(), pairChecks = edges.length * (edges.length - 1) * 0.5;
      if (faces.length + edges.length > maxFaces) {
        status = 'budget'; reason = 'face limit'; break;
      }
      if (work.checks + pairChecks > maxChecks) { status = 'budget'; reason = 'ridge search'; break; }
      work.checks += pairChecks;
      for (const { ring, points } of wave) for (const [j, edge] of ring.entries()) {
        const start = points[j], end = points[nextIndex(j, ring.length)],
          a = shift(start, best.dt), b = shift(end, best.dt);
        snapshot.set(edge.token, { a, b });
        if (best.dt <= timeTolerance) continue;
        strip(edge, start.p, end.p, b, a, time, high);
        if (distance(a, start.p) > tolerance)
          arcs.push({ a: atY(start.p, time), b: atY(a, high), kind: start.reflex ? 'valley' : 'ridge',
            edges: [ring[prevIndex(j, ring.length)].key, edge.key] });
      }
      for (const [i, a] of edges.entries()) for (let j = i + 1; j < edges.length; j++) {
        const b = edges[j];
        if (dot(a.normal, b.normal) > -1 + EPS || Math.abs(det(a.normal,b.normal)) >= EPS ||
          Math.abs(rhs(a,high) + rhs(b,high)) > tolerance) continue;
        const front = snapshot.get(a.token), back = snapshot.get(b.token), first = dot(a.dir, front.a),
          lo = Math.max(first, dot(a.dir, back.b)), hi = Math.min(dot(a.dir,front.b), dot(a.dir,back.a));
        if (hi - lo <= tolerance) continue;
        const start = front.a.map((v, k) => v + (lo - first) * a.dir[k]),
          end = front.a.map((v, k) => v + (hi - first) * a.dir[k]),
          names = [a.key,b.key].sort(), coords = [start,end].map(p => p.map(v => Math.round(v / tolerance)).join(',')).sort(),
          key = JSON.stringify([names,coords,Math.round(high / timeTolerance)]);
        if (flatRidges.has(key)) continue;
        flatRidges.add(key);
        arcs.push({ a: atY(start,high), b: atY(end,high), kind: 'ridge', edges: names });
      }
      events.push({ kind: best.kind, at: atY(vertexPoint, high), time: high });
      work.events++;
      if (best.kind === 'split' || best.kind === 'join') {
        const target = active[best.other], hit = target[best.slot], copy = { ...hit, token: token++ },
          rotate = (array, start) => array.slice(start).concat(array.slice(0, start)),
          around = rotate(source, i);
        snapshot.set(copy.token, snapshot.get(hit.token));
        if (best.kind === 'split') {
          const split = around.indexOf(hit);
          active.splice(w, 1, around.slice(0, split + 1), [copy, ...around.slice(split + 1)]);
        } else {
          const other = rotate(target, best.slot);
          active = active.filter((_, i) => i !== w && i !== best.other);
          active.push([...around, copy, ...other.slice(1), hit]);
        }
      } else source.splice(i,1);
      time = high;
      active = active.map(ring => normalize(ring, time, snapshot));
      if (active.some(ring => ring === null)) { status = 'degenerate'; reason = 'unresolved simultaneous event'; break; }
      active = active.filter(ring => ring.length >= 3);
    }

    const coverage = panels.reduce((sum, p) => sum + p.measure, 0);
    if (status === 'ok' && Math.abs(coverage - loopArea) > Math.max(1e-7 * loopArea, 12 * tolerance * tolerance)) {
      status = 'degenerate';
      reason = 'roof faces do not cover the footprint';
    }
    function query(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Roof coordinates must be finite');
      const here = local([x,z]);
      for (const { edge, bounds: rect, sd } of panels) {
        if (x < rect.min[0] - tolerance || x > rect.max[0] + tolerance ||
          z < rect.min[1] - tolerance || z > rect.max[1] + tolerance || sd(x,z) > tolerance) continue;
        return { height: Math.max(0, (dot(edge.normal, here) - edge.c) / edge.speed), edge: edge.key, pitch: edge.pitch };
      }
      return null;
    }
    function solid({ base = 0, thickness = 0.11 } = {}) {
      if (status !== 'ok' || !Number.isFinite(base) || !Number.isFinite(thickness) || thickness <= 0)
        throw new Error('A roof solid needs a complete roof and positive thickness');
      return P.data.freeze({
        bounds: { min: [bounds.min[0], base - thickness, bounds.min[1]], max: [bounds.max[0], base + time, bounds.max[1]] },
        cost: panels.length + profile.cost,
        sd(x, y, z) {
          const local = query(x,z), top = base + (local?.height ?? 0);
          return Math.max(profile.sd(x,z), y - top, top - y - thickness);
        }
      });
    }
    return P.data.freeze({ status, reason, profile, faces, arcs, events, height: time,
      coverage, area: loopArea, work, query, solid });
  }
  P.construct.weightedRoof = weightedRoof;
})(KIT);
