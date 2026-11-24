/* JSON field expressions shared by terrain, placement, materials and SDF operations. */
(function (K) {
  const P = K.procedural,
    F = P.fields,
    TAU = 2 * Math.PI,
    axes = ['x', 'y', 'z', 'time'],
    unit = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value)),
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9,
    asJet = value => [value, 0, 0, 0, 0],
    sourceField = (node, source) => source ?? { type: 'simplex', scale: node.scale, seed: node.seed },
    point3 = p => Array.isArray(p) && p.length === 3 && p.every(finite),
    positive = n => finite(n) && n >= 1e-8;
  const shift = [15.43, -21.17, 9.37];
  function fieldsError(message) {
    throw new Error('Field expression: ' + message);
  }
  function level(n, fallback, name, test = finite) {
    n = n ?? fallback;
    if (!test(n)) fieldsError('invalid ' + name);
    return n;
  }
  function scaleFor(node) {
    const raw = node.scale ?? 1,
      scale = Array.isArray(raw) ? raw : [raw, raw, raw];
    if (scale.length !== 3 || !scale.every(positive)) fieldsError('scale must contain positive lengths');
    return scale.slice();
  }
  function axesFor(list, ordered, length) {
    const names = list ?? ordered;
    if (
      !Array.isArray(names) || (length ? names.length !== length : names.length < 2 || names.length > 3) ||
      names.some(name => !axes.slice(0, 3).includes(name)) || new Set(names).size !== names.length
    ) fieldsError('invalid spatial axes');
    return names.map(name => axes.indexOf(name));
  }
  function transform(value, input, slope) {
    return [value, input[1] * slope, input[2] * slope, input[3] * slope, input[4] * slope];
  }
  const mul = (a, b) => [
    a[0] * b[0], a[0] * b[1] + b[0] * a[1], a[0] * b[2] + b[0] * a[2],
    a[0] * b[3] + b[0] * a[3], a[0] * b[4] + b[0] * a[4]
  ];

  function noise(node, seed) {
    const scale = scaleFor(node),
      order = axesFor(node.axes, node.type === 'loop' ? ['x', 'z'] : ['x', 'y', 'z'], node.type === 'loop' ? 2 : undefined),
      period = node.period;
    if (node.type === 'loop') {
      if (!positive(period)) fieldsError('loop period must be positive');
      const radius = level(node.radius, 1, 'loop radius', positive),
        base = F.simplex({ dimension: 4, seed });
      return {
        cost: 1,
        run(p, jet) {
          const phase = TAU * (((p[3] % period) + period) % period) / period,
            cosine = Math.cos(phase), sine = Math.sin(phase),
            point = [p[order[0]] / scale[order[0]], p[order[1]] / scale[order[1]], radius * cosine, radius * sine];
          if (!jet) return base.value(...point);
          const s = base.sample(...point),
            out = asJet(s.value);
          out[order[0] + 1] = s.gradient[0] / scale[order[0]];
          out[order[1] + 1] = s.gradient[1] / scale[order[1]];
          out[4] = radius * TAU / period * (cosine * s.gradient[3] - sine * s.gradient[2]);
          return out;
        }
      };
    }
    let base;
    if (node.type === 'periodic') {
      if (!Array.isArray(period) || period.length !== 3 || !period.every(n => n === null || positive(n)))
        fieldsError('periodic fields need three axis periods or null');
      const periods = order.map(i => period[i] === null ? null : Math.max(1, Math.round(period[i] / scale[i])));
      for (const [n, i] of order.entries()) if (periods[n]) scale[i] = period[i] / periods[n];
      base = F.periodic({ dimension: order.length, seed, periods });
    } else base = F.simplex({ dimension: order.length, seed });
    return {
      cost: 1,
      run(p, jet) {
        const q = order.map(i => p[i] / scale[i]);
        if (!jet) return base.value(...q);
        const s = base.sample(...q),
          out = asJet(s.value);
        for (const [j, i] of order.entries()) out[i + 1] = s.gradient[j] / scale[i];
        return out;
      }
    };
  }

  function fractal(node, get) {
    const source = get(sourceField(node, node.source)),
      octaves = level(node.octaves, 4, 'octaves', n => Number.isSafeInteger(n) && n >= 1 && n <= 12),
      gain = level(node.gain, 0.5, 'gain', n => finite(n) && n > 0 && n <= 1),
      lacunarity = level(node.lacunarity, 2, 'lacunarity', n => finite(n) && n >= 1 && n <= 8),
      offset = level(node.offset, 1, 'ridge offset', positive),
      feedback = level(node.feedback, 2, 'ridge feedback', n => finite(n) && n >= 0 && n <= 16);
    return {
      cost: source.cost * octaves,
      run(p, jet) {
        const sum = asJet(0);
        let total = 0, weight = 1, amp = 1, frequency = 1, feedJet = asJet(1);
        for (let octave = 0; octave < octaves; octave++) {
          const q = [0, 1, 2].map(i => p[i] * frequency + shift[i] * octave);
          q.push(p[3]);
          const s = source.run(q, jet),
            v = jet ? s[0] : s;
          let signal = v, derivative = 1;
          if (node.type === 'billow') {
            signal = 2 * Math.abs(v) - 1;
            derivative = 2 * Math.sign(v);
          } else if (node.type === 'ridge') {
            const ridge = Math.max(0, offset - Math.abs(v));
            signal = ridge * ridge;
            derivative = -2 * ridge * Math.sign(v);
          }
          if (jet) {
            const raw = [signal, s[1] * frequency * derivative, s[2] * frequency * derivative,
              s[3] * frequency * derivative, s[4] * derivative];
            const contribution = node.type === 'ridge' ? mul(feedJet, raw) : raw;
            for (let i = 0; i < 5; i++) sum[i] += amp * contribution[i];
            if (node.type === 'ridge') {
              const next = signal * feedback;
              feedJet = transform(unit(next), raw, next > 0 && next < 1 ? feedback : 0);
            }
          } else {
            sum[0] += amp * signal * weight;
            if (node.type === 'ridge') weight = unit(signal * feedback);
          }
          total += amp;
          amp *= gain;
          frequency *= lacunarity;
        }
        return jet ? sum.map(v => v / total) : sum[0] / total;
      }
    };
  }

  function warp(node, get, seed) {
    const source = get(node.source),
      vector = node.vector ?? [13, 47, 101].map(salt => ({ type: 'simplex', seed: (seed ^ salt) >>> 0, scale: node.scale })),
      strength = level(node.strength, 0.4, 'warp strength'),
      iterations = level(node.iterations, 2, 'warp iterations', n => Number.isSafeInteger(n) && n >= 1 && n <= 8),
      decay = level(node.decay, 0.5, 'warp decay', n => finite(n) && n >= 0 && n <= 1);
    if (!Array.isArray(vector) || vector.length !== 3) fieldsError('warp needs three vector component fields');
    const components = vector.map(get);
    return {
      cost: source.cost + iterations * components.reduce((sum, field) => sum + field.cost, 0),
      run(p, jet) {
        let q = p, amplitude = strength;
        let jacobian = jet && Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => +(i === j)));
        for (let k = 0; k < iterations; k++) {
          const values = components.map(field => field.run(q, jet));
          q = values.map((value, i) => q[i] + amplitude * (jet ? value[0] : value)).concat(q[3]);
          if (jet) {
            jacobian = jacobian.map((row, i) => i === 3 ? row : row.map((v, column) => {
              let sum = v;
              for (let m = 0; m < 4; m++) sum += amplitude * values[i][m + 1] * jacobian[m][column];
              return sum;
            }));
          }
          amplitude *= decay;
        }
        const result = source.run(q, jet);
        if (!jet) return result;
        const out = asJet(result[0]);
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) out[i + 1] += result[j + 1] * jacobian[j][i];
        return out;
      }
    };
  }

  function distance(node) {
    const flat = node.axes === 'xz',
      radius = level(node.radius, 0, 'distance radius', n => finite(n) && n >= 0);
    if (node.axes !== undefined && !flat) fieldsError('distance axes must be xz when specified');
    const at = node.point;
    if (at !== undefined && !point3(at)) fieldsError('distance point must be XYZ');
    if (at !== undefined && node.paths !== undefined) fieldsError('distance takes a point or paths');
    let index = null;
    const center = at && [at[0], flat ? 0 : at[1], at[2]];
    if (!center) {
      if (!Array.isArray(node.paths)) fieldsError('distance needs a point or path list');
      const paths = node.paths.map(path => {
        if (!Array.isArray(path) || !path.every(point3)) fieldsError('distance paths need XYZ coordinates');
        return flat ? path.map(([x, , z]) => [x, 0, z]) : path;
      });
      index = P.contacts.field(paths);
      if (!index.bounds) fieldsError('distance paths need a nonzero segment');
    }
    return {
      cost: 1,
      run(p, jet) {
        const q = [p[0], flat ? 0 : p[1], p[2]],
          contact = index && index.nearest(q),
          nearest = center || contact.point,
          x = q[0] - nearest[0], y = q[1] - nearest[1], z = q[2] - nearest[2],
          d = contact ? contact.distance : Math.hypot(x, y, z),
          value = d - radius;
        if (!jet) return value;
        return d === 0 ? asJet(value) : [value, x / d, y / d, z / d, 0];
      }
    };
  }

  function combine(node, get) {
    if (!Array.isArray(node.inputs) || node.inputs.length < 2 || node.inputs.length > 32)
      fieldsError(node.type + ' requires two to 32 inputs');
    const inputs = node.inputs.map(get),
      choose = node.type === 'max' ? (a, b) => a > b : (a, b) => a < b;
    function fold(a, b, jet) {
      if (node.type === 'add') return jet ? a.map((v, i) => v + b[i]) : a + b;
      if (node.type === 'multiply') return jet ? mul(a, b) : a * b;
      return choose(jet ? b[0] : b, jet ? a[0] : a) ? b : a;
    }
    return { cost: inputs.reduce((n, child) => n + child.cost, 0), run(p, jet) {
      return inputs.map(field => field.run(p, jet)).reduce((a, b) => fold(a, b, jet));
    } };
  }

  function remap(node, get) {
    const source = get(node.source);
    if (node.type === 'clamp') {
      const min = level(node.min, 0, 'clamp minimum'), max = level(node.max, 1, 'clamp maximum');
      if (min >= max) fieldsError('clamp limits must be ordered');
      return { cost: source.cost, run(p, jet) {
        const s = source.run(p, jet), v = jet ? s[0] : s;
        return jet ? transform(unit(v, min, max), s, v > min && v < max ? 1 : 0) : unit(v, min, max);
      } };
    }
    const step = level(node.step, 0.25, 'terrace step', positive),
      offset = level(node.offset, 0, 'terrace offset'),
      width = level(node.transition, 0.2, 'terrace transition', n => finite(n) && n >= 0 && n <= 1);
    return { cost: source.cost, run(p, jet) {
      const s = source.run(p, jet), value = jet ? s[0] : s,
        shifted = (value - offset) / step,
        band = Math.floor(shifted),
        fraction = shifted - band,
        t = width ? unit((fraction - 0.5) / width + 0.5) : +(fraction >= 0.5),
        result = offset + step * (band + t * t * (3 - 2 * t));
      return jet ? transform(result, s, width ? 6 * t * (1 - t) / width : 0) : result;
    } };
  }

  function snapshot(spec) {
    const seen = new WeakSet();
    let size = 0;
    function check(value, depth) {
      if (depth > 32 || ++size > 300000) fieldsError('serialization exceeds its value budget');
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) fieldsError('expected a noncyclic field expression');
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > 300000) fieldsError('serialization exceeds its value budget');
        for (const child of value) check(child, depth + 1);
      } else {
        for (const child of Object.values(value)) check(child, depth + 1);
      }
      seen.delete(value);
    }
    check(spec, 0);
    return P.data.freeze(P.data.clone(spec));
  }

  function compile(spec, { seed = 0, maxOperations = 8192 } = {}) {
    const validSeed = n => Number.isSafeInteger(n) && Math.abs(n) <= 4294967295;
    if (!validSeed(seed) || !Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > 65536)
      fieldsError('invalid seed or operation budget');
    const definition = snapshot(spec);
    let nodes = 0;
    function build(node, depth) {
      if (typeof node === 'number') node = { type: 'constant', value: node };
      if (depth > 24 || ++nodes > 512) fieldsError('expression exceeds its tree budget');
      if (!node || typeof node !== 'object' || Array.isArray(node))
        fieldsError('expected a scalar or field node');
      const get = child => build(child, depth + 1),
        salt = level(node.seed, seed, 'seed', validSeed);
      let result;
      switch (node.type) {
        case 'constant': {
          const v = level(node.value, 0, 'constant');
          result = { cost: 1, run: (_, jet) => jet ? asJet(v) : v };
          break;
        }
        case 'axis': {
          const i = axes.indexOf(node.axis), scale = level(node.scale, 1, 'axis scale');
          if (i < 0) fieldsError('invalid axis');
          result = { cost: 1, run(p, jet) {
            const value = p[i] * scale;
            if (!jet) return value;
            const out = asJet(value);
            out[i + 1] = scale;
            return out;
          } };
          break;
        }
        case 'namedNoise': {
          const names=Array.isArray(node.stream)?node.stream:[node.stream];
          const stream=Randomness.create(salt).stream(...names);
          result=noise({...node,type:'simplex'},stream.seed32);
          break;
        }
        case 'simplex': case 'periodic': case 'loop':
          result = noise(node, salt);
          break;
        case 'fbm': case 'ridge': case 'billow':
          result = fractal(node, get);
          break;
        case 'warp':
          result = warp(node, get, salt);
          break;
        case 'distance':
          result = distance(node);
          break;
        case 'add': case 'multiply': case 'min': case 'max':
          result = combine(node, get);
          break;
        case 'terrace': case 'clamp':
          result = remap(node, get);
          break;
        case 'coordinateMap': {
          if(Object.keys(node).some(key=>!['type','mapping','source','fallback'].includes(key)))fieldsError('invalid coordinateMap field');
          const mapping=MathFields.mapping(node.mapping), source=get(node.source), fallback=level(node.fallback,0,'coordinate fallback');
          result={cost:mapping.cost+source.cost,run(p,jet){
            const q=mapping.sample(...p);
            if(!q.valid)return jet?asJet(fallback):fallback;
            const value=source.run([...q.point,p[3]],jet);
            if(!jet)return value;
            const J=q.jacobian,T=q.dt,g=value.slice(1,4);
            return [value[0], ...[0,1,2].map(i=>g[0]*J[i]+g[1]*J[3+i]+g[2]*J[6+i]),value[4]+g.reduce((n,v,i)=>n+v*T[i],0)];
          }};
          break;
        }
        case 'mathMask': {
          if(Object.keys(node).some(key=>!['type','mapping','pattern','frequency','phase','rate','threshold','feather','invert'].includes(key)))fieldsError('invalid mathMask field');
          const {type,mapping:definition,...controls}=node;
          const sample=MathFields.mapping(definition).mask(controls);
          result={cost:sample.cost,run(p,jet){
            if(!jet)return sample(...p);
            const s=sample.sample(...p);return [s.value,...s.gradient,s.dt];
          }};
          break;
        }
        default:
          fieldsError('unknown operation ' + node.type);
      }
      if (result.cost > maxOperations) fieldsError('evaluation exceeds its operation budget');
      return result;
    }
    const compiled = build(definition, 0);
    function coordinates(x, y, z, time) {
      if (![x, y, z, time].every(finite)) fieldsError('expected finite world coordinates and time');
      return [x, y, z, time];
    }
    function field(x, y, z, time = 0) {
      return compiled.run(coordinates(x, y, z, time), false);
    }
    field.sample = (x, y, z, time = 0) => {
      const [value, dx, dy, dz, dt] = compiled.run(coordinates(x, y, z, time), true);
      return { value, gradient: [dx, dy, dz], dt };
    };
    field.gradient = (x, y, z, time = 0) => field.sample(x, y, z, time).gradient;
    field.spec = definition;
    field.seed = seed;
    return Object.freeze(field);
  }

  F.compile = compile;
})(KIT);
