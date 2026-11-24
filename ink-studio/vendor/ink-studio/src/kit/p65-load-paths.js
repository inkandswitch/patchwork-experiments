/* Rule-based beam, column and brace placement for procedural construction. */
(function (K) {
  const P = K.procedural, V = K.V,
    EPS = 1e-8,
    name = s => typeof s === 'string' && s.length > 0 && s.length <= 500,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e6,
    positive = n => finite(n) && n > EPS,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(finite),
    integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;

  function loadPaths(nodes, spans, {
    ground, clear, maxSpan = 2.6, maxDrop = 7, postStep = maxSpan * 0.2, nominalLoad = 1,
    minHeight = 0.12, braceAfter = 1.6, braceRun = maxSpan * 0.29,
    maxSamples = 12000, maxChecks = 1200000, mergePosts = true
  } = {}) {
    if (
      !Array.isArray(nodes) || nodes.length > 4096 || !Array.isArray(spans) || spans.length > 4096 ||
      typeof ground !== 'function' || (clear !== undefined && typeof clear !== 'function') ||
      ![maxSpan, maxDrop, postStep, nominalLoad, minHeight, braceAfter, braceRun].every(positive) ||
      maxDrop < minHeight || !integer(maxSamples, 1, 120000) || !integer(maxChecks, 1, 10000000) ||
      typeof mergePosts !== 'boolean'
    ) throw new Error('Load paths need bounded sockets, spans and a ground field');
    const anchors = new Map(), spanKeys = new Set(),
      columns = new Map(), beams = [], braces = [], results = [], work = { samples: 0, checks: 0 };
    for (const item of nodes) {
      const { id, point, bearing = false } = item ?? {};
      if (!name(id) || !vector(point) || anchors.has(id) || typeof bearing !== 'boolean')
        throw new Error('Load path sockets need unique IDs, finite points and a bearing flag');
      anchors.set(id, { id, point: point.slice(), bearing });
    }
    const jobs = spans.map(item => {
      const { id, a, b, load = nominalLoad } = item ?? {};
      if (!name(id) || spanKeys.has(id) || a === b || !anchors.has(a) || !anchors.has(b) || !positive(load))
        throw new Error('Load path spans need unique IDs, two sockets and positive line load');
      spanKeys.add(id);
      const from = anchors.get(a), to = anchors.get(b), delta = V.sub(to.point, from.point), run = V.len(delta);
      if (!positive(run)) throw new Error('Load path sockets must have distinct positions');
      return { id, from, to, delta, run, load };
    });
    const permitted = (a, b, info) => !clear || clear(a.slice(), b.slice(), info);
    const socketBases = new Map();
    function support(top, key, bearing, endpoint) {
      if (bearing) return { key, top, base: top, height: 0, column: false, endpoint };
      const y = ground(top[0], top[2]);
      if (y === undefined || y === null) return null;
      if (!finite(y)) throw new Error('Load path height must be finite at support samples');
      const height = top[1] - y, base = [top[0], y, top[2]];
      if (height < -EPS || height > maxDrop || (height > minHeight && !permitted(base, top, { role: 'column', key }))) return null;
      return { key, top, base, height: Math.max(0, height), column: height > minHeight, endpoint };
    }
    function endpoint(socket, job) {
      const key = JSON.stringify(['socket', socket.id, ...(mergePosts ? [] : [job.id])]);
      if (!socketBases.has(key)) socketBases.set(key, support(socket.point, key, socket.bearing, true));
      return socketBases.get(key);
    }
    let status = 'ok';
    for (const job of jobs) {
      const { id, from, to, delta, run, load } = job,
        limit = maxSpan * Math.min(1, Math.sqrt(nominalLoad / load)),
        intervals = Math.max(1, Math.ceil(run / Math.min(limit * 0.65, postStep)));
      if (work.samples + intervals + 1 > maxSamples) {
        status = 'budget';
        results.push({ id, status });
        break;
      }
      const hits = [];
      for (let i = 0; i <= intervals; i++) {
        work.samples++;
        const t = i / intervals,
          candidate = i === 0 ? endpoint(from, job) : i === intervals ? endpoint(to, job)
            : support(V.mad(from.point, delta, t), JSON.stringify(['post', id, i]), false, false);
        if (candidate) hits.push({ t, ...candidate });
      }
      const choice = new Int32Array(hits.length).fill(-1), cost = new Float64Array(hits.length).fill(Infinity);
      if (hits[0]?.t !== 0 || hits.at(-1)?.t !== 1) {
        status = 'unsupported';
        results.push({ id, status: 'unsupported', limit });
        continue;
      }
      cost[0] = 0;
      let exhausted = false;
      search:
      for (let i = 1; i < hits.length; i++) {
        const b = hits[i];
        for (let j = i - 1; j >= 0; j--) {
          const a = hits[j], length = (b.t - a.t) * run;
          if (length > limit + EPS) break;
          if (work.checks >= maxChecks) { exhausted = true; break search; }
          work.checks++;
          const score = cost[j] + Number(!b.endpoint && b.column) + b.height / (maxDrop * 12) + 0.01;
          if (score >= cost[i] || !permitted(a.top, b.top, { role: 'beam', span: id })) continue;
          cost[i] = score;
          choice[i] = j;
        }
      }
      if (exhausted) {
        status = 'budget';
        results.push({ id, status, limit });
        break;
      }
      if (choice.at(-1) < 0) {
        status = 'unsupported';
        results.push({ id, status: 'unsupported', limit });
        continue;
      }
      const path = [];
      for (let i = hits.length - 1; i >= 0; i = choice[i]) path.push(hits[i]);
      path.reverse();
      function note(post, carried) {
        const saved = columns.get(post.key);
        if (saved) {
          saved.load += carried;
          if (saved.spans.at(-1) !== id) saved.spans.push(id);
        } else columns.set(post.key, { key: post.key, top: post.top, base: post.base, height: post.height,
          column: post.column, load: carried, spans: [id] });
      }
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], span = (b.t - a.t) * run, weight = load * span,
          key = JSON.stringify(['beam', id, a.key, b.key]);
        note(a, weight * 0.5);
        note(b, weight * 0.5);
        beams.push({ key, span: id, a: a.top, b: b.top, length: span, load: weight, supports: [a.key, b.key] });
        for (const [j, post] of [a, b].entries()) {
          if (!post.column || post.height < braceAfter || span < postStep * 0.4) continue;
          const other = j ? a : b, run = Math.min(braceRun, span * 0.43), drop = Math.min(post.height * 0.58, run * 1.22),
            start = [post.top[0], post.top[1] - drop, post.top[2]],
            end = V.mad(post.top, V.sub(other.top, post.top), run / span);
          if (permitted(start, end, { role: 'brace', span: id, post: post.key })) {
            braces.push({ key: JSON.stringify(['brace', key, post.key]), a: start, b: end, beam: key, column: post.key });
          }
        }
      }
      results.push({ id, status: 'ok', limit, supports: path.map(p => p.key) });
    }
    return P.data.freeze({ status, spans: results, bearings: [...columns.values()], beams, braces, work });
  }
  P.construct.loadPaths = loadPaths;
})(KIT);
