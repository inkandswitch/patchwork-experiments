// k1-stage: what a living diorama runs on.
//   stage  : the world's clock. Systems are added to it and run in order every frame; it remembers which rows of splats were
//            written so the page sends only those to the graphics card.
//   paint  : every splat's colour is its baked colour passed through a list of painters (soot, frost, artwork, light, tint).
//            A painter says which splats need doing again; nobody writes a colour directly, so effects stack without fighting.
//   rig    : named parts, each moved as a whole by a 3x3 matrix about a joint (a turn, or a squash); splat shapes follow.
//   pool   : spare splats kept hidden, lent out to particles, debris and fresh surfaces.
//   pick   : where a line from the eye first meets the diorama.
(function (K) {
  const V = K.V;
  K.stage = W => {
    K.seed(0x9e3779b9 ^ W.count);
    const D = W.data,
      N = W.count,
      base = Float32Array.from(D),
      rows = new Uint8Array(Math.ceil(N / 512)),
      st = {
        W,
        D,
        N,
        base,
        rows,
        systems: [],
        painters: [],
        time: 0,
        stateful: true,
        start: 0,
        count: N,
        kick: null,
        grade: null,
        parts: null
      };
    const flag = new Uint8Array(N),
      queue = new Int32Array(N);
    let qn = 0,
      atmosphereProgram,
      atmosphereHistory,
      domains = null,
      advanceDomains = true,
      domainFrame = -1,
      domainEpoch = -1;
    const routed = new WeakMap();
    let previousDirection, preparedDirection;
    st.motionSettings = () => {
      const source = W.look?.artDirection;
      if (source !== previousDirection) {
        preparedDirection = ArtDirection.prepare(source);
        previousDirection = source;
      }
      return Object.hasOwn(st, 'motionDirection') ? st.motionDirection : preparedDirection;
    };
    st.sceneWind = () => {
      const options = st.motionEnvironment ?? {};
      const sampled = EnvironmentFrame.timeline(W, options, 0, null, K.weather.tracks);
      const weather = EnvironmentFrame.opticalWeather(W, options, sampled, options.weatherFronts !== false);
      const exposure = SceneExposure.settings(W.sceneExposure, options.sceneExposure);
      const field = EnvironmentFrame.wind(W, options, {
        ...sampled,
        weather,
        exposure
      });
      return (x, y, z, t) => {
        const [vx, vz] = field.airAt(x, y, z, options.skyTime ?? t + (st.t0 ?? 0)).velocity;
        return [vx, 0, vz];
      };
    };
    const rgba = [0, 0, 0, 0];
    st.touch = i => {
      rows[i >> 9] = 1;
    };
    st.repaint = i => {
      if (!flag[i]) {
        flag[i] = 1;
        queue[qn++] = i;
      }
    };
    st.repaintAll = ids => {
      for (let k = 0; k < ids.length; k++) st.repaint(ids[k]);
    };
    const clothSystems = [];
    st.useTimeDomains = (clocks, { advance = true } = {}) => {
      if (!clocks?.read || typeof advance !== 'boolean') throw new TypeError('Expected shared time domains');
      for (const sys of st.systems) {
        const route = routed.get(sys) ?? clothRoutes.get(sys);
        if (route && !clocks.has(route.domain)) throw new Error('Unknown clock ' + route.domain);
      }
      for (const sys of st.systems) {
        const route = routed.get(sys) ?? clothRoutes.get(sys);
        if (route) {
          route.epoch = -1;
          route.time = null;
        }
      }
      domains = clocks;
      advanceDomains = advance;
      domainFrame = domainEpoch = -1;
      st.t0 = 0;
      W.timeDomains = clocks;
      return st;
    };
    st.clockFor = sys => domains?.read(routed.get(sys)?.domain ?? 'animation');
    st.setTimeDomain = (sys, domain) => {
      if (!st.systems.includes(sys)) throw new Error('System must be installed on this stage');
      if (domain === null) {
        routed.delete(sys);
        clothRoutes.delete(sys);
      } else {
        if (typeof domain !== 'string' || (domains && !domains.has(domain))) throw new Error('Unknown system clock');
        routed.set(sys, { domain, epoch: -1, time: null });
      }
      return sys;
    };
    st.add = (sys, options = {}) => {
      if (options.domain !== undefined) {
        if (typeof options.domain !== 'string' || (domains && !domains.has(options.domain)))
          throw new Error('Unknown system clock');
        routed.set(sys, { domain: options.domain, epoch: -1, time: null });
      }
      st.systems.push(sys);
      if (sys.independentCloth) clothSystems.push(sys);
      if (sys.paint) st.painters.push(sys);
      if (sys.bind) sys.bind(st);
      return sys;
    };
    // A route cursor belongs to the system, so repeated draws never replay fixed ticks.
    function runSystem(sys, c) {
      if (!sys.update) return;
      const r = c.route;
      if (!domains || !r) {
        sys.update(c.dt, c.time, st, c.clock);
        return;
      }
      if (r.epoch !== domains.epoch) {
        r.epoch = domains.epoch;
        r.time = null;
      }
      if (c.clock.step !== null) {
        if (c.clock.steps.length) {
          for (const step of c.clock.steps)
            if (r.time === null || step.time > r.time) {
              sys.update(step.dt, step.time, st, c.clock);
              r.time = step.time;
            }
        } else if (r.time === null) {
          sys.update(0, c.time, st, c.clock);
          r.time = c.time;
        }
      } else if (r.time === null || c.time !== r.time) {
        sys.update(r.time === null ? c.clock.sampleDt : Math.max(0, c.time - r.time), c.time, st, c.clock);
        r.time = c.time;
      }
    }
    const clothRoutes = new WeakMap();
    st.hasIndependentCloth = () => clothSystems.length > 0;
    st.advanceCloth = (dt, time) => {
      for (const system of clothSystems) {
        if (!domains) {
          system.update(dt, time - st.t0, st);
          continue;
        }
        let route = routed.get(system) ?? clothRoutes.get(system);
        if (!route) {
          route = { domain: 'animation', epoch: -1, time: null };
          clothRoutes.set(system, route);
        }
        const clock = domains.read(route.domain);
        runSystem(system, {
          route,
          clock,
          dt: clock.sampleDt,
          time: clock.sampleTime
        });
      }
    };
    st.update = (dt, t, { separateCloth = false } = {}) => {
      const sceneTime = t;
      if (domains) {
        if (advanceDomains) domains.advance(dt);
        const clock = domains.read('animation');
        t = clock.sampleTime;
        dt = domainFrame === domains.frameId && domainEpoch === domains.epoch ? 0 : clock.sampleDt;
      } else {
        if (st.t0 === undefined) st.t0 = t;
        t -= st.t0;
        dt = dt < 0 ? 0 : dt > 0.05 ? 0.05 : dt;
      }
      st.time = t;
      st.dt = dt;
      const context = sys => {
        const route = routed.get(sys) ?? (domains && sys.independentCloth ? clothRoutes.get(sys) : undefined),
          clock = domains && domains.read(route?.domain ?? 'animation');
        return {
          route,
          clock,
          dt: clock ? (domainFrame === domains.frameId && domainEpoch === domains.epoch ? 0 : clock.sampleDt) : dt,
          time: clock?.sampleTime ?? t
        };
      };
      for (let k = st.systems.length - 1; k >= 0; k--) {
        const sys = st.systems[k],
          c = context(sys);
        if (sys.pre) sys.pre(c.dt, c.time, st, c.clock);
      }
      for (const sys of st.systems) if (!(separateCloth && sys.independentCloth)) runSystem(sys, context(sys));
      for (let k = 0; k < qn; k++) {
        const i = queue[k],
          o = i * 16,
          c = base[o + 7];
        flag[i] = 0;
        rgba[0] = (c % 256) / 255;
        rgba[1] = (Math.floor(c / 256) % 256) / 255;
        rgba[2] = Math.floor(c / 65536) / 255;
        rgba[3] = base[o + 3];
        for (const p of st.painters) p.paint(i, rgba, st);
        D[o + 7] =
          Math.round(K.clamp(rgba[0], 0, 1) * 255) +
          Math.round(K.clamp(rgba[1], 0, 1) * 255) * 256 +
          Math.round(K.clamp(rgba[2], 0, 1) * 255) * 65536;
        D[o + 3] = rgba[3];
        rows[i >> 9] = 1;
      }
      qn = 0;
      for (const system of st.systems)
        if (system.post) {
          const c = context(system);
          system.post(c.dt, c.time, st, c.clock);
        }
      atmosphereHistory?.capture(domains ? domains.read('animation').sampleTime : sceneTime, socketPose);
      if (domains) {
        domainFrame = domains.frameId;
        domainEpoch = domains.epoch;
      }
      return true;
    };
    st.poke = (o, d) => {
      let hit = null;
      for (const s of st.systems)
        if (s.poke) {
          if (!hit) hit = K.pick(st, o, d);
          s.poke(hit, o, d, st.time, st);
        }
      return hit;
    };
    st.partOf = i => (st.rig ? st.rig.bid[i] : 0);
    // named points to hang things on (an eye, a pipe's mouth): given where they are at rest and which rig part carries them; where() says where one is now
    const sockets = (st.sockets = Object.create(null));
    st.socket = (name, p, part, dir) => {
      sockets[name] = { p, part: part || null, dir: dir || [0, 1, 0] };
    };
    st.where = name => {
      const s = sockets[name];
      return !s ? null : s.part && st.rig && st.rig.has(s.part) ? st.rig.at(s.part, s.p) : s.p;
    };
    function socketPose({ socket: name }) {
      const s = sockets[name];
      if (!s) return null;
      const p = st.where(name);
      const dir = s.part && st.rig?.has(s.part) ? V.sub(st.rig.at(s.part, V.add(s.p,s.dir)),p) : s.dir;
      return { p, dir };
    }
    st.trackAtmosphere = program => {
      if (atmosphereProgram === program) return;
      atmosphereProgram = program;
      const targets = program?.targets?.filter(target => target.entity === undefined);
      atmosphereHistory = targets?.length ? K.atmosphere.emitters.history(targets,program.lifetime) : null;
    };
    st.atmosphereSocket = (target,time) => atmosphereHistory?.has(target) ? atmosphereHistory.at(target,time) : socketPose(target);
    st.trackAtmosphere(W.atmosphereEmitters);
    W.anim = st;
    return st;
  };
  // which palette colour each splat was baked with (255 if none matches): a cheap way to pick splats by what they are
  K.palIndex = st => {
    const pal = st.W.pal,
      m = new Map();
    pal.forEach((h, k) => m.set(((h >> 16) & 255) + (h & 0xff00) + ((h & 255) << 16), k));
    const out = new Uint8Array(st.N);
    for (let i = 0; i < st.N; i++) {
      const k = m.get(st.base[i * 16 + 7]);
      out[i] = k === undefined ? 255 : k;
    }
    return out;
  };
  // ---- pool: n hidden splats made before B.finish(); take() lends the next one (oldest first once all are out)
  K.pool = (B, n) => {
    const first = B.count();
    for (let i = 0; i < n; i++) B.iso(0, -99, 0, 0.05, B.P[0], 0, { nd: true });
    let next = 0;
    const pl = {
      first,
      n,
      live: new Float32Array(n),
      take() {
        const k = next;
        next = (next + 1) % n;
        return first + k;
      },
      // write one splat: a round one (s) or a long one (axis, half-length sl, half-width sw); col is a packed colour (B.P[i]); alpha 0 hides it
      put(st, i, x, y, z, s, col, alpha, ax, sl) {
        if (st.physicsOwned?.[i]) return;
        const D = st.D,
          o = i * 16;
        D[o] = x;
        D[o + 1] = y;
        D[o + 2] = z;
        D[o + 3] = alpha;
        D[o + 7] = col;
        if (st.base) { st.base[o + 3] = alpha; st.base[o + 7] = col; }
        if (ax) {
          const p = s * s,
            d = sl * sl - p;
          D[o + 4] = p + d * ax[0] * ax[0];
          D[o + 5] = d * ax[0] * ax[1];
          D[o + 6] = d * ax[0] * ax[2];
          D[o + 8] = p + d * ax[1] * ax[1];
          D[o + 9] = d * ax[1] * ax[2];
          D[o + 10] = p + d * ax[2] * ax[2];
        } else {
          const v = s * s;
          D[o + 4] = v;
          D[o + 5] = 0;
          D[o + 6] = 0;
          D[o + 8] = v;
          D[o + 9] = 0;
          D[o + 10] = v;
        }
        st.rows[i >> 9] = 1;
      },
      hide(st, i) {
        if (st.physicsOwned?.[i]) return;
        st.D[i * 16 + 3] = 0;
        if (st.base) st.base[i * 16 + 3] = 0;
        st.D[i * 16 + 1] = -99;
        st.rows[i >> 9] = 1;
      }
    };
    return pl;
  };
  // ---- rig
  K.rig = (B, S) => {
    const names = ['still'],
      ids = Object.create(null),
      owner = [],
      rig = { names, resolve: null };
    rig.part = name => ids[name] || (names.push(name), (ids[name] = names.length - 1));
    rig.has = name => !!ids[name];
    // the bake reports each solid's splats; a solid's tag names its part (rig.resolve can decide instead: return a part, 0 for still, or undefined)
    const prev = S.emit;
    S.emit = (pr, n0, n1) => {
      if (prev) prev(pr, n0, n1);
      if (n1 <= n0 || !pr) return;
      let b = rig.resolve ? rig.resolve(pr) : undefined;
      if (b === undefined) b = pr.tag ? rig.part(pr.tag) : 0;
      if (b) for (let i = n0; i < n1; i++) owner[i] = b;
    };
    rig.own = (name, fn) => {
      const n0 = B.count(),
        b = typeof name === 'number' ? name : rig.part(name);
      fn();
      for (let i = n0; i < B.count(); i++) owner[i] = b;
    };
    rig.assign = (name, indices) => {
      if (!Array.isArray(indices) && !ArrayBuffer.isView(indices)) throw new TypeError('Rig ownership needs splat indices');
      const selected = Array.from(indices);
      if (!selected.every(i => Number.isSafeInteger(i) && i >= 0)) throw new RangeError('Invalid rig splat index');
      if(typeof name!=='string'&&!(Number.isSafeInteger(name)&&name>=0&&name<names.length))throw new TypeError('Invalid rig part');
      if(B?.count&&!selected.every(i=>i<B.count()))throw new RangeError('Invalid rig splat index');
      const b=typeof name==='number'?name:rig.part(name); for(const i of selected)owner[i]=b;
      return rig;
    };
    rig.bind = st => {
      const N = st.N,
        bid = (rig.bid = new Uint16Array(N)),
        initialParts = names.length;
      let NP = initialParts;
      for (let i = 0; i < N; i++) bid[i] = owner[i] > 0 ? owner[i] : 0;
      const cnt = new Int32Array(NP);
      for (let i = 0; i < N; i++) cnt[bid[i]]++;
      const list = (rig.list = []);
      for (let b = 0; b < NP; b++) list.push(new Int32Array(b ? cnt[b] : 0));
      cnt.fill(0);
      for (let i = 0; i < N; i++) {
        const b = bid[i];
        if (b) list[b][cnt[b]++] = i;
      }
      let Mx = (rig.M = new Float32Array(NP * 12)),
        dirty = (rig.dirty = new Uint8Array(NP));
      for (let b = 0; b < NP; b++) {
        Mx[b * 12] = 1;
        Mx[b * 12 + 4] = 1;
        Mx[b * 12 + 8] = 1;
      }
      rig.assign = (name, indices) => {
        if (!Array.isArray(indices) && !ArrayBuffer.isView(indices)) throw new TypeError('Rig ownership needs splat indices');
        const selected=Array.from(indices);
        if(!selected.every(i=>Number.isSafeInteger(i)&&i>=0&&i<N))throw new RangeError('Invalid rig splat index');
        if(typeof name!=='string'&&!(Number.isSafeInteger(name)&&name>=0&&name<names.length))throw new TypeError('Invalid rig part');
        const b=typeof name==='number'?name:rig.part(name);
        if(!Number.isSafeInteger(b)||b<0||b>=names.length)throw new RangeError('Invalid rig part');
        if(names.length>65535)throw new RangeError('Rig part budget exceeded');
        if(names.length>NP){
          const next=new Float32Array(names.length*12);next.set(Mx);const flags=new Uint8Array(names.length);flags.set(dirty);
          for(let i=NP;i<names.length;i++){next[i*12]=next[i*12+4]=next[i*12+8]=1;list.push(new Int32Array(0));}
          NP=names.length;Mx=rig.M=next;dirty=rig.dirty=flags;
        }
        const affected=new Set([b]);for(const i of selected){affected.add(bid[i]);bid[i]=b;}
        for(const part of affected)if(part)list[part]=Int32Array.from(Array.from({length:N},(_,i)=>i).filter(i=>bid[i]===part));
        dirty[b]=1;return rig;
      };
      st.rig = rig;
      st.parts = names;
      rig.st = st;
      // x' = A (x - o) + p : part b is turned or squashed by A about the point o, which itself goes to p
      rig.set = (b, A, o, p) => {
        if (typeof b === 'string') b = ids[b];
        if (!b) return;
        const k = b * 12;
        for (let i = 0; i < 9; i++) Mx[k + i] = A[i];
        Mx[k + 9] = p[0] - (A[0] * o[0] + A[1] * o[1] + A[2] * o[2]);
        Mx[k + 10] = p[1] - (A[3] * o[0] + A[4] * o[1] + A[5] * o[2]);
        Mx[k + 11] = p[2] - (A[6] * o[0] + A[7] * o[1] + A[8] * o[2]);
        dirty[b] = 1;
      };
      // the same for a child: A and where its joint has gone are worked out from the parent's matrix
      rig.child = (b, parent, A, o, local = o) => {
        if (typeof parent === 'string') parent = ids[parent];
        const k = parent * 12,
          P = Mx.subarray(k, k + 9),
          q = [
            P[0] * local[0] + P[1] * local[1] + P[2] * local[2] + Mx[k + 9],
            P[3] * local[0] + P[4] * local[1] + P[5] * local[2] + Mx[k + 10],
            P[6] * local[0] + P[7] * local[1] + P[8] * local[2] + Mx[k + 11]
          ];
        rig.set(b, K.M.mul(P, A), o, q);
      };
      rig.at = (b, v) => {
        if (typeof b === 'string') b = ids[b];
        const k = b * 12;
        return [
          Mx[k] * v[0] + Mx[k + 1] * v[1] + Mx[k + 2] * v[2] + Mx[k + 9],
          Mx[k + 3] * v[0] + Mx[k + 4] * v[1] + Mx[k + 5] * v[2] + Mx[k + 10],
          Mx[k + 6] * v[0] + Mx[k + 7] * v[1] + Mx[k + 8] * v[2] + Mx[k + 11]
        ];
      };
      rig.free = new Uint8Array(N); // splats that have left their part (broken off): the rig no longer moves them
      rig.apply = () => {
        const D = st.D,
          R = st.base,
          rows = st.rows,
          fr = rig.free;
        for (let b = 1; b < NP; b++) {
          if (!dirty[b]) continue;
          dirty[b] = 0;
          const L = list[b],
            k = b * 12,
            a = Mx[k],
            bb = Mx[k + 1],
            c = Mx[k + 2],
            d = Mx[k + 3],
            e = Mx[k + 4],
            f = Mx[k + 5],
            g = Mx[k + 6],
            h = Mx[k + 7],
            ii = Mx[k + 8],
            tx = Mx[k + 9],
            ty = Mx[k + 10],
            tz = Mx[k + 11];
          for (let n = 0; n < L.length; n++) {
            const i = L[n];
            if (fr[i] || st.physicsOwned?.[i]) continue;
            const o = i * 16,
              x = R[o],
              y = R[o + 1],
              z = R[o + 2],
              c00 = R[o + 4],
              c01 = R[o + 5],
              c02 = R[o + 6],
              c11 = R[o + 8],
              c12 = R[o + 9],
              c22 = R[o + 10];
            D[o] = a * x + bb * y + c * z + tx;
            D[o + 1] = d * x + e * y + f * z + ty;
            D[o + 2] = g * x + h * y + ii * z + tz;
            const m00 = a * c00 + bb * c01 + c * c02,
              m01 = a * c01 + bb * c11 + c * c12,
              m02 = a * c02 + bb * c12 + c * c22,
              m10 = d * c00 + e * c01 + f * c02,
              m11 = d * c01 + e * c11 + f * c12,
              m12 = d * c02 + e * c12 + f * c22,
              m20 = g * c00 + h * c01 + ii * c02,
              m21 = g * c01 + h * c11 + ii * c12,
              m22 = g * c02 + h * c12 + ii * c22;
            D[o + 4] = m00 * a + m01 * bb + m02 * c;
            D[o + 5] = m00 * d + m01 * e + m02 * f;
            D[o + 6] = m00 * g + m01 * h + m02 * ii;
            D[o + 8] = m10 * d + m11 * e + m12 * f;
            D[o + 9] = m10 * g + m11 * h + m12 * ii;
            D[o + 10] = m20 * g + m21 * h + m22 * ii;
            rows[i >> 9] = 1;
          }
        }
      };
      // where a part's splats sit at rest: middle and extent
      rig.box = b => {
        if (typeof b === 'string') b = ids[b];
        const L = list[b],
          lo = [1e9, 1e9, 1e9],
          hi = [-1e9, -1e9, -1e9];
        for (let n = 0; n < L.length; n++)
          for (let k = 0; k < 3; k++) {
            const v = st.base[L[n] * 16 + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
          }
        return { lo, hi, c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], n: L.length };
      };
      return rig;
    };
    return rig;
  };
  K.rig.fromGroups = (stage, groups) => {
    if(stage.rig)throw new Error('Stage already has a rig; assign groups on the existing rig');
    const rig=K.rig({count:()=>stage.N},{});
    for(const [name,indices]of Object.entries(groups)){
      if(!Array.from(indices).every(i=>Number.isSafeInteger(i)&&i>=0&&i<stage.N))throw new RangeError('Invalid rig splat index');
      rig.assign(name,indices);
    }
    rig.bind(stage);return rig;
  };
  // ---- pick: splats are binned into cells once (at rest); a line is walked through the cells until it passes close to one
  K.grid = (st, cell) => {
    const D = st.base,
      N = st.N,
      lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < N; i++) {
      if (D[i * 16 + 3] <= 0 || D[i * 16 + 1] < -50) continue;
      for (let k = 0; k < 3; k++) {
        const v = D[i * 16 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    cell = cell || 0.5;
    const dim = [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k] + 1e-3) / cell))),
      nc = dim[0] * dim[1] * dim[2],
      head = new Int32Array(nc).fill(-1),
      next = new Int32Array(N).fill(-1);
    const cellOf = (x, y, z) => {
      const ix = Math.floor((x - lo[0]) / cell),
        iy = Math.floor((y - lo[1]) / cell),
        iz = Math.floor((z - lo[2]) / cell);
      return ix < 0 || iy < 0 || iz < 0 || ix >= dim[0] || iy >= dim[1] || iz >= dim[2]
        ? -1
        : (ix * dim[1] + iy) * dim[2] + iz;
    };
    for (let i = 0; i < N; i++) {
      if (D[i * 16 + 3] <= 0 || D[i * 16 + 1] < -50) continue;
      const c = cellOf(D[i * 16], D[i * 16 + 1], D[i * 16 + 2]);
      if (c >= 0) {
        next[i] = head[c];
        head[c] = i;
      }
    }
    const g = {
      lo,
      hi,
      dim,
      cell,
      head,
      next,
      cellOf,
      // every splat (by its place at rest) within r of a point: fn(i, distance)
      near(x, y, z, r, fn) {
        const a = [x, y, z],
          i0 = [0, 1, 2].map(k => Math.max(0, Math.floor((a[k] - r - lo[k]) / cell))),
          i1 = [0, 1, 2].map(k => Math.min(dim[k] - 1, Math.floor((a[k] + r - lo[k]) / cell)));
        for (let ix = i0[0]; ix <= i1[0]; ix++)
          for (let iy = i0[1]; iy <= i1[1]; iy++)
            for (let iz = i0[2]; iz <= i1[2]; iz++)
              for (let i = head[(ix * dim[1] + iy) * dim[2] + iz]; i >= 0; i = next[i]) {
                const d = Math.hypot(D[i * 16] - x, D[i * 16 + 1] - y, D[i * 16 + 2] - z);
                if (d <= r) fn(i, d);
              }
      }
    };
    return g;
  };
  // where the line from o along d first comes within reach of a solid, visible splat (as the splats stand now). null if it meets nothing
  K.pick = (st, o, d, reach) => {
    const D = st.D,
      N = st.N;
    reach = reach || 0.16;
    let best = 1e9,
      bi = -1;
    for (let i = 0, q = 0; i < N; i++, q += 16) {
      if (D[q + 3] < 1 || D[q + 1] < -50) continue;
      const px = D[q] - o[0],
        py = D[q + 1] - o[1],
        pz = D[q + 2] - o[2],
        t = px * d[0] + py * d[1] + pz * d[2];
      if (t <= 0 || t > best + 0.3) continue;
      const ex = px - d[0] * t,
        ey = py - d[1] * t,
        ez = pz - d[2] * t;
      if (ex * ex + ey * ey + ez * ez < reach * reach && t < best) {
        best = t;
        bi = i;
      }
    }
    return bi < 0
      ? null
      : {
          i: bi,
          t: best,
          p: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best],
          part: st.rig ? st.rig.bid[bi] : 0
        };
  };
  /* Bones on the graphics card. Splats tagged this way are kept as they were made, and the page turns and moves each one by its bone's matrix
     (12 numbers: a 3x3 turn by rows, then the move), so a frame costs a few kilobytes however many splats are carried.
       K.bones.tag(W, ids, bid, bid2, w2)   mark splats ids[j] as carried by bone bid[j] (and, by the share w2[j], by bone bid2[j] too: its place is
                                  blended, its shape follows the first). Only plain splats can be: those with a motion of their own are
                                  left alone and their places in ids are returned in .cpu, for the caller to move as before.  -> { boned, cpu }
       K.bones.posed(W)           a copy of the data with every carried splat put where its bone has it (what the headless tools draw and measure)
       K.bones.bind(W, { ids, bid, bid2, w2, M, pose(t, dt), react })   the whole of it: tags, remembers the rest pose, and gives the world an
                                  anim whose update calls pose (which fills M) and moves what could not be tagged
     The world's anim then offers { bones: Float32Array(12 * n), boned } beside its update, and takes the animation tools:
       anim.warp = map            a K.deform map everything on the bones is put through (each bone goes where the map sends the middle of what
                                  it carries); null for none
       anim.flinch(p, { k, kind })   a blow: a squash and spring back about where it stands, a hit stop on its own clock, a jog of the camera
       anim.poke(eye, dir)        a tap: flinches if the line meets it (only there when react is true: a tap does nothing unless asked for)
     Splats that sway as hair and grass do are carried too and still sway (their own kind, 13). */
  K.bones = {
    tag(W, ids, bid, bid2, w2) {
      const D = W.data,
        gpu = [],
        cpu = [];
      for (let j = 0; j < ids.length; j++) {
        const o = ids[j] * 16,
          kraw = Math.round(D[o + 11]);
        /* a plain splat becomes kind 12; one that sways as grass and hair do (kind 11 with the usual wind) becomes kind 13, which is carried
           and then swayed, so a coat can ride bones and still stir */
        const windy =
          kraw % 16 === 11 && D[o + 12] === 1 && Math.abs(D[o + 13] - 1.9) < 1e-4 && Math.abs(D[o + 14] - 0.022) < 1e-4;
        if (kraw % 16 === 0 || windy) {
          D[o + 11] = windy ? kraw + 2 : kraw + 12;
          D[o + 12] = bid[j];
          D[o + 13] = w2 && w2[j] > 0 ? bid2[j] : 0;
          D[o + 14] = w2 && w2[j] > 0 ? w2[j] : 0;
          gpu.push(ids[j]);
        } else cpu.push(j);
      }
      return { boned: Int32Array.from(gpu), cpu };
    },
    /* the whole arrangement in one call: remember the splats at rest, hand the plain ones to the graphics card, and give the world an anim whose
       update calls pose(t, dt) (which fills M, 12 numbers a bone) and then moves by hand the few splats that could not be handed over.
       o: ids, bid, bid2, w2 (optional second bone and its share), M, pose */
    bind(W, o) {
      const D = W.data,
        ids = o.ids,
        NA = ids.length,
        bid = o.bid,
        bid2 = o.bid2,
        w2 = o.w2,
        M = o.M,
        rest = new Float32Array(NA * 9);
      for (let j = 0; j < NA; j++) {
        const q = ids[j] * 16;
        rest[j * 9] = D[q];
        rest[j * 9 + 1] = D[q + 1];
        rest[j * 9 + 2] = D[q + 2];
        rest[j * 9 + 3] = D[q + 4];
        rest[j * 9 + 4] = D[q + 5];
        rest[j * 9 + 5] = D[q + 6];
        rest[j * 9 + 6] = D[q + 8];
        rest[j * 9 + 7] = D[q + 9];
        rest[j * 9 + 8] = D[q + 10];
      }
      const tg = K.bones.tag(W, ids, bid, bid2, w2),
        CPU = tg.cpu,
        rows = new Uint8Array(Math.ceil(W.count / 512)),
        NBN = M.length / 12;
      /* the middle of what each bone carries, and the box round all of it, at rest: what a map needs to know to bend the bones */
      const MID = new Float32Array(NBN * 4),
        lo = [1e9, 1e9, 1e9],
        hi = [-1e9, -1e9, -1e9];
      for (let j = 0; j < NA; j++) {
        const b = bid[j] * 4;
        for (let a = 0; a < 3; a++) {
          const v = rest[j * 9 + a];
          MID[b + a] += v;
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
        MID[b + 3]++;
      }
      for (let b = 0; b < NBN; b++) if (MID[b * 4 + 3]) for (let a = 0; a < 3; a++) MID[b * 4 + a] /= MID[b * 4 + 3];
      let WB = null,
        flinch = null,
        held = 0;
      const base = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2],
        size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      /* the bones as a map bends them: each goes where the map sends the middle of what it carries, stretched as the map stretches space
         there. Bones that carry nothing are left alone */
      const bend = map => {
        if (!WB) WB = new Float32Array(M.length);
        WB.set(M);
        for (let b = 0; b < NBN; b++) {
          if (!MID[b * 4 + 3]) continue;
          const k = b * 12,
            c = [MID[b * 4], MID[b * 4 + 1], MID[b * 4 + 2]],
            A = [M[k], M[k + 1], M[k + 2], M[k + 3], M[k + 4], M[k + 5], M[k + 6], M[k + 7], M[k + 8]],
            t = [M[k + 9], M[k + 10], M[k + 11]],
            q = V.add(K.M.app(A, c), t),
            J = K.deform.jac(map, q),
            JA = K.M.mul(J, A),
            nt = V.add(map(q), K.M.app(J, V.sub(t, q)));
          for (let i = 0; i < 9; i++) WB[k + i] = JA[i];
          WB[k + 9] = nt[0];
          WB[k + 10] = nt[1];
          WB[k + 11] = nt[2];
        }
        return WB;
      };
      W.anim = {
        start: ids[0],
        count: ids[NA - 1] - ids[0] + 1,
        bones: M,
        boned: tg.boned,
        rows,
        /* a K.deform map everything on these bones is put through (a reaction field, a squash, a smear, a cage); null for none */
        warp: null,
        base,
        size,
        /* A blow, from the animation tools: it squashes and springs back about where it stands (K.acts.hit), its own clock stops for a
           moment (the hit stop), and the camera is jogged. p is where it was struck. Whatever it was doing carries on underneath */
        flinch(p, o2) {
          flinch = { age: 0, p: p || base, k: (o2 && o2.k) || 0.6, kind: (o2 && o2.kind) || 'wood' };
          return W.anim;
        },
        /* a tap: if the line from the eye meets it, it flinches. Returns where, or null. (Only when o.react is true: otherwise a tap on it
           does nothing at all) */
        poke:
          o.react !== true
            ? undefined
            : (eye, dir) => {
                const d = K.bones.posed(W),
                  boned = tg.boned,
                  r2 = Math.pow(Math.max(0.12, size * 0.02), 2);
                let best = 1e9;
                for (let n = 0; n < boned.length; n++) {
                  const q = boned[n] * 16,
                    x = d[q] - eye[0],
                    y = d[q + 1] - eye[1],
                    z = d[q + 2] - eye[2],
                    t = x * dir[0] + y * dir[1] + z * dir[2];
                  if (t <= 0 || t >= best) continue;
                  const px = x - dir[0] * t,
                    py = y - dir[1] * t,
                    pz = z - dir[2] * t;
                  if (px * px + py * py + pz * pz < r2) best = t;
                }
                if (best > 1e8) return null;
                const at = [eye[0] + dir[0] * best, eye[1] + dir[1] * best, eye[2] + dir[2] * best];
                W.anim.flinch(at);
                return at;
              },
        update(dt, t) {
          const an = W.anim;
          /* through a hit stop its clock stands still, and stays that much behind afterwards */
          if (flinch && flinch.age < K.acts.ACTION.hitStop) held += dt;
          o.pose(t - held, flinch && flinch.age < K.acts.ACTION.hitStop ? 0 : dt);
          let map = an.warp;
          if (flinch) {
            flinch.age += dt;
            const h = K.acts.hit(flinch.age, flinch.kind),
              k = flinch.k,
              sx = 1 + (h.x - 1) * k,
              sy = 1 + (h.y - 1) * k,
              user = map,
              sq = p => [
                base[0] + (p[0] - base[0]) * sx,
                base[1] + (p[1] - base[1]) * sy,
                base[2] + (p[2] - base[2]) * sx
              ];
            map = user ? p => sq(user(p)) : sq;
            const kk = K.acts.kick(flinch.age, size * 0.006 * k, 0.09);
            an.kick = kk[0] || kk[1] ? [kk[0], kk[1], 0] : null;
            if (flinch.age > 0.55) {
              flinch = null;
              an.kick = null;
            }
          }
          const Mx = (an.bones = map ? bend(map) : M);
          for (let n = 0; n < CPU.length; n++) {
            const j = CPU[n],
              k = bid[j] * 12,
              r = j * 9,
              q = ids[j] * 16,
              x = rest[r],
              y = rest[r + 1],
              z = rest[r + 2],
              a = Mx[k],
              b = Mx[k + 1],
              c = Mx[k + 2],
              d = Mx[k + 3],
              e = Mx[k + 4],
              f = Mx[k + 5],
              g = Mx[k + 6],
              h = Mx[k + 7],
              i = Mx[k + 8],
              c00 = rest[r + 3],
              c01 = rest[r + 4],
              c02 = rest[r + 5],
              c11 = rest[r + 6],
              c12 = rest[r + 7],
              c22 = rest[r + 8];
            if(W.anim?.physicsOwned?.[ids[j]])continue;
            D[q] = a * x + b * y + c * z + Mx[k + 9];
            D[q + 1] = d * x + e * y + f * z + Mx[k + 10];
            D[q + 2] = g * x + h * y + i * z + Mx[k + 11];
            if (w2 && w2[j] > 0) {
              const m = bid2[j] * 12,
                w = w2[j];
              D[q] += (Mx[m] * x + Mx[m + 1] * y + Mx[m + 2] * z + Mx[m + 9] - D[q]) * w;
              D[q + 1] += (Mx[m + 3] * x + Mx[m + 4] * y + Mx[m + 5] * z + Mx[m + 10] - D[q + 1]) * w;
              D[q + 2] += (Mx[m + 6] * x + Mx[m + 7] * y + Mx[m + 8] * z + Mx[m + 11] - D[q + 2]) * w;
            }
            const m00 = a * c00 + b * c01 + c * c02,
              m01 = a * c01 + b * c11 + c * c12,
              m02 = a * c02 + b * c12 + c * c22,
              m10 = d * c00 + e * c01 + f * c02,
              m11 = d * c01 + e * c11 + f * c12,
              m12 = d * c02 + e * c12 + f * c22,
              m20 = g * c00 + h * c01 + i * c02,
              m21 = g * c01 + h * c11 + i * c12,
              m22 = g * c02 + h * c12 + i * c22;
            D[q + 4] = m00 * a + m01 * b + m02 * c;
            D[q + 5] = m00 * d + m01 * e + m02 * f;
            D[q + 6] = m00 * g + m01 * h + m02 * i;
            D[q + 8] = m10 * d + m11 * e + m12 * f;
            D[q + 9] = m10 * g + m11 * h + m12 * i;
            D[q + 10] = m20 * g + m21 * h + m22 * i;
            rows[ids[j] >> 9] = 1;
          }
          return true;
        }
      };
      return W.anim;
    },
    posed(W) {
      const an = W.anim,
        bm = an && an.bones,
        bd = an && an.boned,
        D = W.data;
      if (!bm || !bd) return D;
      const out = W.posedBuf && W.posedBuf.length === D.length ? W.posedBuf : (W.posedBuf = new Float32Array(D.length));
      out.set(D);
      for (let j = 0; j < bd.length; j++) {
        const o = bd[j] * 16;
        const kind=Math.round(D[o+11])%16;
        if(kind!==12&&kind!==13)continue;
        const k = D[o + 12] * 12,
          x = D[o],
          y = D[o + 1],
          z = D[o + 2],
          a = bm[k],
          b = bm[k + 1],
          c = bm[k + 2],
          d = bm[k + 3],
          e = bm[k + 4],
          f = bm[k + 5],
          g = bm[k + 6],
          h = bm[k + 7],
          i = bm[k + 8],
          c00 = D[o + 4],
          c01 = D[o + 5],
          c02 = D[o + 6],
          c11 = D[o + 8],
          c12 = D[o + 9],
          c22 = D[o + 10];
        out[o] = a * x + b * y + c * z + bm[k + 9];
        out[o + 1] = d * x + e * y + f * z + bm[k + 10];
        out[o + 2] = g * x + h * y + i * z + bm[k + 11];
        const windy = Math.round(D[o + 11]) % 16 === 13;
        out[o + 11] = D[o + 11] - (windy ? 2 : 12);
        out[o + 12] = windy ? 1 : 0;
        out[o + 13] = windy ? 1.9 : 0;
        out[o + 14] = windy ? 0.022 : 0;
        if (D[o + 14] > 0) {
          const q = D[o + 13] * 12,
            w = D[o + 14];
          out[o] += (bm[q] * x + bm[q + 1] * y + bm[q + 2] * z + bm[q + 9] - out[o]) * w;
          out[o + 1] += (bm[q + 3] * x + bm[q + 4] * y + bm[q + 5] * z + bm[q + 10] - out[o + 1]) * w;
          out[o + 2] += (bm[q + 6] * x + bm[q + 7] * y + bm[q + 8] * z + bm[q + 11] - out[o + 2]) * w;
        }
        const m00 = a * c00 + b * c01 + c * c02,
          m01 = a * c01 + b * c11 + c * c12,
          m02 = a * c02 + b * c12 + c * c22,
          m10 = d * c00 + e * c01 + f * c02,
          m11 = d * c01 + e * c11 + f * c12,
          m12 = d * c02 + e * c12 + f * c22,
          m20 = g * c00 + h * c01 + i * c02,
          m21 = g * c01 + h * c11 + i * c12,
          m22 = g * c02 + h * c12 + i * c22;
        out[o + 4] = m00 * a + m01 * b + m02 * c;
        out[o + 5] = m00 * d + m01 * e + m02 * f;
        out[o + 6] = m00 * g + m01 * h + m02 * i;
        out[o + 8] = m10 * d + m11 * e + m12 * f;
        out[o + 9] = m10 * g + m11 * h + m12 * i;
        out[o + 10] = m20 * g + m21 * h + m22 * i;
      }
      return out;
    }
  };
})(KIT);
