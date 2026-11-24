/* Socket-born atmospheric density puffs and droplets, sampled on the shared particle clock. */
(function (K) {
  const { V } = K, P = K.procedural;
  const brand = Symbol.for('ink-studio.atmosphere-emitters');
  const up = [0, 1, 0], zero = [0, 0, 0];
  const presets = {
    smoke: { representation: 'volume', rate: 11, lifetime: [1.5, 2.8], speed: .85, spread: .31,
      wind: .65, size: .25, growth: 2.9, density: 1.45, color: '#84929f', breakup: .65 },
    steam: { representation: 'volume', rate: 17, lifetime: [.55, 1.3], speed: 1.8, spread: .5,
      wind: .4, size: .19, growth: 3, density: 1.9, color: '#c5d6d9', breakup: .4 },
    spray: { representation: 'splat', rate: 94, lifetime: [.36, .96], speed: 2.4, spread: 1.2,
      wind: .14, gravity: [0, -7.5, 0], size: .029, growth: .61, stretch: 2.1, opacity: .74, color: '#c1e6ef' },
    fog: { representation: 'volume', rate: 8, lifetime: [1.8, 3.6], speed: .24, spread: .27,
      wind: .58, size: .5, growth: 2.7, density: .51, color: '#a7bcc6', breakup: .29 }
  };
  const names = Object.freeze(Object.keys(presets));
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const ease = x => {
    const w = clamp(x);
    return w*w*(3-2*w);
  };
  function object(value, name) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError(name + ' needs an object');
    return value;
  }
  function name(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' needs a name');
    return value;
  }
  function number(value, lo, hi, label) {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(label + ' is out of range');
    return value;
  }
  function vector(value, bound, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError(label + ' needs XYZ coordinates');
    return Array.from(value, n => number(n, -bound, bound, label));
  }
  function unit(value) {
    const v = vector(value, 1e6, 'Atmosphere socket direction');
    if (V.len(v) < 1e-8) throw new RangeError('Atmosphere socket direction must be nonzero');
    return V.norm(v);
  }
  function pose(value) {
    if (value == null) return null;
    return { p: vector(value.p, 1e8, 'Atmosphere socket position'), dir: unit(value.dir ?? up) };
  }
  function target(value) {
    if (typeof value === 'string') return Object.freeze({ socket: name(value, 'Atmosphere socket') });
    const { entity, socket, dir = up } = object(value, 'Atmosphere emitter socket');
    return Object.freeze({ entity: name(entity, 'Atmosphere entity'), socket: name(socket, 'Atmosphere socket'),
      dir: Object.freeze(unit(dir)) });
  }
  const keyOf = target => JSON.stringify([target.entity, target.socket, target.dir]);
  function interpolate(a, b, weight) {
    if (!a || !b) return a;
    const dir = V.lerp(a.dir, b.dir, weight);
    return { p: V.lerp(a.p, b.p, weight), dir: V.len(dir) < 1e-8 ? a.dir : V.norm(dir) };
  }
  function floor(entries, time) {
    let lo = 0, hi = entries.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].time > time) hi = mid;
      else lo = mid;
    }
    return lo;
  }
  function socketTrack(value) {
    if (typeof value === 'function') return time => pose(value(time));
    object(value, 'Atmosphere socket');
    if (value.keys === undefined) {
      const fixed = pose(value);
      return () => fixed;
    }
    const { keys } = value;
    if (!Array.isArray(keys) || !keys.length || keys.length > 2048)
      throw new TypeError('Atmosphere socket needs 1 to 2048 keys');
    const frames = Array.from(keys, (key, i) => {
      object(key, 'Atmosphere socket key');
      const time = number(key.at, -1e9, 1e9, 'Atmosphere socket key time');
      if (i && time <= keys[i - 1].at) throw new RangeError('Atmosphere socket key times must increase');
      return { time, pose: pose(key) };
    });
    return time => {
      if (time <= frames[0].time) return frames[0].pose;
      if (time >= frames.at(-1).time) return frames.at(-1).pose;
      const i = floor(frames, time), a = frames[i], b = frames[i+1];
      return interpolate(a.pose, b.pose, (time - a.time) / (b.time - a.time));
    };
  }

  function emitter(raw, sockets) {
    const { id, preset, representation, socket, motion = {}, life = {}, style = {} } = object(raw, 'Atmosphere emitter');
    name(id, 'Atmosphere emitter ID');
    if (!Object.hasOwn(presets, preset)) throw new TypeError('Atmosphere preset needs smoke, steam, spray or fog');
    const base = presets[preset], kind = representation ?? base.representation;
    if (kind !== 'volume' && kind !== 'splat') throw new TypeError('Atmosphere representation needs volume or splat');
    const attachment = target(socket), socketAt = attachment.entity === undefined && sockets.get(attachment.socket);
    object(life, 'Atmosphere emitter life');
    const { start = 0, end = Infinity, fadeIn = .1, fadeOut = .52 } = life, lifetime = life.lifetime ?? base.lifetime;
    number(start, -1e9, 1e9, 'Atmosphere start');
    if (end !== Infinity) number(end, start, 1e9, 'Atmosphere end');
    if (!(end > start)) throw new RangeError('Atmosphere end must follow start');
    number(fadeIn, 0, 1, 'Atmosphere fade in');
    number(fadeOut, 0, 1, 'Atmosphere fade out');
    if (!Array.isArray(lifetime) || lifetime.length !== 2) throw new TypeError('Atmosphere lifetime needs a min and a max');
    const short = number(lifetime[0], .005, 24, 'Atmosphere lifetime');
    const long = number(lifetime[1], short, 24, 'Atmosphere lifetime');
    const rate = number(life.rate ?? base.rate, .1, 4096, 'Atmosphere particle rate');
    const count = Math.ceil(rate * long) + 1;
    if (count > (kind === 'volume' ? 128 : 4096)) throw new RangeError('Atmosphere emitter exceeds its live particle budget');
    const seed = raw.seed ?? P.data.hash('atmosphere:' + id);
    if (!Number.isSafeInteger(seed)) throw new TypeError('Atmosphere seed needs an integer');
    const clock = { start, end, rate, lifetime: [short, long], seed };
    object(motion, 'Atmosphere emitter motion');
    const speed = number(motion.speed ?? base.speed, -1000, 1000, 'Atmosphere launch speed');
    const spread = number(motion.spread ?? base.spread, 0, 1000, 'Atmosphere velocity spread');
    const sourceRadius = number(motion.sourceRadius ?? 0, 0, 100, 'Atmosphere source radius');
    const wind = number(motion.wind ?? base.wind, 0, 8, 'Atmosphere wind influence');
    const gravity = vector(motion.gravity ?? base.gravity ?? zero, 1000, 'Atmosphere gravity');
    const drift = vector(motion.drift ?? zero, 1000, 'Atmosphere drift');
    object(style, 'Atmosphere emitter style');
    const size = number(style.size ?? base.size, .0001, 100, 'Atmosphere size');
    const growth = number(style.growth ?? base.growth, .01, 32, 'Atmosphere growth');
    const breakup = number(style.breakup ?? base.breakup ?? 0, 0, 1, 'Atmosphere breakup');
    const stretch = number(style.stretch ?? base.stretch ?? 1, 1, 24, 'Atmosphere stretch');
    const density = number(style.density ?? base.density ?? 1, 0, 64, 'Atmosphere density');
    const opacity = number(style.opacity ?? base.opacity ?? .55, 0, .99, 'Atmosphere opacity');
    const color = style.color ?? base.color;
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new TypeError('Atmosphere color needs #rrggbb');
    const packed = parseInt(color.slice(5),16)*65536 + parseInt(color.slice(3,5),16)*256 + parseInt(color.slice(1,3),16);
    const lit = style.lit ?? true, emissive = style.emissive ?? false;
    if (typeof lit !== 'boolean' || typeof emissive !== 'boolean') throw new TypeError('Atmosphere lighting flags need true or false');
    const anisotropy = number(style.anisotropy ?? .18, -.85, .85, 'Atmosphere anisotropy');
    const step = number(style.step ?? Math.max(.012, Math.min(size, size*growth)*.44), .001, 100, 'Atmosphere step');

    function sample(time, context) {
      const particles = [];
      const amount = kind === 'volume' ? density : opacity;
      if (!amount) return particles;
      for (const { birth, serial, phase, age, random } of K.splatEffects.births(clock, time)) {
        const alpha = (fadeIn ? ease(phase/fadeIn) : 1) * (fadeOut ? ease((1-phase)/fadeOut) : 1);
        if (!alpha) continue;
        const source = socketAt ? socketAt(birth) : pose(context.socket?.(attachment, birth));
        if (!source) continue;
        const origin = source.p.slice();
        if (sourceRadius) {
          const u = V.norm(V.cross(source.dir, Math.abs(source.dir[1]) > .9 ? [1,0,0] : up));
          const v = V.cross(source.dir, u), angle = random()*Math.PI*2, r = Math.sqrt(random())*sourceRadius;
          for (let i=0;i<3;i++) origin[i] += r*(u[i]*Math.cos(angle)+v[i]*Math.sin(angle));
        }
        const velocity = source.dir.map((axis,i) => axis*speed + drift[i] + spread*(random()*2-1));
        const p = origin.map((n,i) => n+velocity[i]*age+.5*gravity[i]*age*age);
        if (wind && context.travel) {
          const [dx,dz] = context.travel(origin,birth,time);
          p[0] += wind*dx;
          p[2] += wind*dz;
        }
        particles.push({ p, radius: size*(.73+.54*random())*K.mix(1,growth,phase), alpha,
          direction: V.mad(velocity, gravity, age), serial, noise: random()*Math.PI*2 });
      }
      return particles;
    }
    function volume(puffs) {
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
      for (const {p,radius} of puffs) for (let i=0;i<3;i++) {
        min[i] = Math.min(min[i],p[i]-radius);
        max[i] = Math.max(max[i],p[i]+radius);
      }
      const field = VolumeField.bounded({ bounds: { min, max }, sample(x,y,z) {
        let sum = 0;
        for (const {p,radius,alpha,noise} of puffs) {
          const u = (x-p[0])/radius, v = (y-p[1])/radius, w = (z-p[2])/radius;
          const q = u*u + v*v + w*w;
          if (q >= 1) continue;
          const detail = breakup ? 1-breakup*.52*(.5+.5*Math.sin(8*u+5*w+noise)*Math.cos(9*v-4*w+noise)) : 1;
          sum += alpha*(1-q)**2*detail;
        }
        return sum;
      } });
      return SceneOptics.field({ id, mediumKind: preset, field, density, step, lit, color, anisotropy,
        ...(emissive && { emissive: color, emissiveGain: .5 }) });
    }
    function write(particles, out, first, birthIds) {
      for (const {p,radius,alpha,direction,serial} of particles) {
        const [x,y,z] = V.len(direction) > 1e-8 ? V.norm(direction) : up;
        const variance = radius**2, along = variance*(stretch**2-1);
        const row = first + serial%count;
        if (birthIds) birthIds[row] = serial;
        out.set([p[0],p[1],p[2],alpha*opacity,variance+along*x*x,along*x*y,along*x*z,packed,
          variance+along*y*y,along*y*z,variance+along*z*z,emissive ? 48 : 16], row*16);
      }
    }
    return { kind, count, lifetime: long, attachment: socketAt ? null : attachment, sample, volume, write };
  }

  function compile(source) {
    if (source?.[brand]) return source;
    const { sockets = {}, emitters } = object(source, 'Atmosphere emitters');
    const fixed = new Map(Object.entries(object(sockets, 'Atmosphere sockets')).map(([id,value]) => [id,socketTrack(value)]));
    if (!Array.isArray(emitters) || emitters.length > 48) throw new TypeError('Atmosphere emitters need an array of at most 48');
    const entries = Array.from(emitters, entry => emitter(entry, fixed));
    if (new Set(emitters.map(entry => entry.id)).size !== entries.length) throw new TypeError('Atmosphere emitter IDs must be unique');
    const splats = entries.filter(entry => entry.kind === 'splat');
    const media = entries.filter(entry => entry.kind === 'volume');
    const count = splats.reduce((n, entry) => n + entry.count, 0);
    if (count > 8192 || media.reduce((n, entry) => n+entry.count,0) > 768)
      throw new RangeError('Atmosphere emitters exceed the scene particle budget');
    const targets = [...new Map(entries.filter(entry=>entry.attachment).map(entry=>[keyOf(entry.attachment),entry.attachment])).values()];
    const lifetime = Math.max(0, ...entries.map(entry => entry.lifetime));
    function frame(time, { volumes = true, ...context } = {}) {
      number(time, -1e9, 1e9, 'Atmosphere frame time');
      const fields = [];
      if (volumes) for (const entry of media) {
        const particles = entry.sample(time, context);
        if (particles.length) fields.push(entry.volume(particles));
      }
      const droplets = splats.map(entry => entry.sample(time, context));
      return {
        volumes: fields, count,
        write(out, first = 0, birthIds) {
          if (!(out instanceof Float32Array) || !Number.isSafeInteger(first) || first < 0 || out.length < (first+count)*16)
            throw new RangeError('Atmosphere splat buffer is too small');
          out.fill(0, first*16, (first+count)*16);
          if (birthIds) birthIds.fill(NaN, first, first+count);
          splats.forEach((entry,i) => {
            entry.write(droplets[i], out, first, birthIds);
            first += entry.count;
          });
          return out;
        }
      };
    }
    return Object.freeze({ [brand]: true, targets: Object.freeze(targets), lifetime, frame });
  }
  function settings(authored, override) {
    const source = override === true ? authored : override ?? authored;
    return source == null || source === false ? null : compile(source);
  }

  function history(targets, lifetime) {
    const indexed = new Map(targets.map((target,i) => [keyOf(target),i])), frames = [];
    return {
      has: target => indexed.has(keyOf(target)),
      capture(time, read) {
        if (frames.length && time < frames.at(-1).time) frames.length = 0;
        if (time === frames.at(-1)?.time) frames.pop();
        frames.push({ time, poses: targets.map(target => pose(read(target))) });
        while (frames.length > 4096 || frames.length > 1 && frames[1].time < time-lifetime) frames.shift();
      },
      at(target, time) {
        const index = indexed.get(keyOf(target));
        if (index === undefined || !frames.length || time < frames[0].time) return null;
        if (time >= frames.at(-1).time) return frames.at(-1).poses[index];
        const i = floor(frames, time), a = frames[i], b = frames[i+1];
        return interpolate(a.poses[index], b.poses[index], (time-a.time)/(b.time-a.time));
      }
    };
  }
  function entityPose(query, target) {
    const frame = query?.frame(target);
    return frame && { p:frame.point, dir:frame.rotation ? K.M.app(frame.rotation,target.dir) : target.dir };
  }
  K.atmosphere.emitters = Object.freeze({ presets:names, compile, settings, history, entityPose });
})(KIT);
