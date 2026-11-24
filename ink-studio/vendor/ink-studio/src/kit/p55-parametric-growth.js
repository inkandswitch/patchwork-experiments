/* Parametric stochastic L-systems and a 3D turtle for SDF branch construction. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-8,
    integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e6,
    symbol = s => typeof s === 'string' && s.length > 0 && s.length <= 64,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(finite),
    positive = n => finite(n) && n > EPS;

  function parse(input, parent, args, cap, preserve = false) {
    if (typeof input === 'string' && input.length > cap * 2) throw new Error('Growth rules exceed the tape budget');
    const tape = typeof input === 'string' ? [...input] : input;
    if (!Array.isArray(tape)) throw new Error('Growth rules need a token tape');
    if (tape.length > cap) throw new Error('Growth rules exceed the tape budget');
    const used = new Set();
    return tape.map((raw, i) => {
      const t = typeof raw === 'string' ? { symbol: raw } : raw,
        parameters = t?.args ?? [];
      if (!symbol(t?.symbol) || !Array.isArray(parameters) || parameters.length > 16)
        throw new Error('Growth tokens need symbols and numeric arguments');
      const values = parameters.map(value => {
        if (finite(value)) return value;
        const arg = value?.arg, scale = value?.scale ?? 1, offset = value?.offset ?? 0;
        if (!args || !integer(arg, 0, args.length - 1) || !finite(scale) || !finite(offset))
          throw new Error('Invalid source argument in a growth rule');
        const next = args[arg] * scale + offset;
        if (!finite(next)) throw new Error('Growth rule argument exceeds its range');
        return next;
      });
      const id = preserve && typeof t.id === 'string' && t.id ? t.id : parent + '/' + i;
      if (used.has(id)) throw new Error('Growth tape IDs must be unique');
      used.add(id);
      return { symbol: t.symbol, args: values, id };
    });
  }

  function interpret(tokens, {
    origin = [0, 0, 0], forward = [0, 1, 0], up = [0, 0, 1], angle = Math.PI / 6,
    length = 0.25, radius = 0.08, marks = ['L'], maxStack = 512
  } = {}, record = true) {
    if (
      !vector(origin) || !vector(forward) || !vector(up) || !positive(V.len(forward)) ||
      !positive(V.len(V.cross(forward, up))) || !finite(angle) || !positive(length) || !positive(radius) ||
      !Array.isArray(marks) || !marks.every(symbol) || !integer(maxStack, 1, 4096)
    ) throw new Error('Growth turtle needs a nondegenerate frame, distances and a stack budget');
    const initial = V.norm(forward),
      marker = new Set(marks),
      stack = [], limbs = [], points = [], frames = [];
    let state = { p: origin.slice(), forward: initial, up: V.norm(V.mad(up, initial, -V.dot(up, initial))), radius };
    function rotate(p, axis, turn) {
      const c = Math.cos(turn), s = Math.sin(turn);
      return V.add(V.add(V.mul(p, c), V.mul(V.cross(axis, p), s)), V.mul(axis, V.dot(axis, p) * (1 - c)));
    }
    for (const token of tokens) {
      const { symbol, args } = token, { p, forward, up, radius } = state,
        turn = args[0] ?? angle,
        depth = stack.length;
      frames.push({ p: p.slice(), forward: forward.slice(), up: up.slice(), radius, depth });
      if (symbol === '[') {
        if (stack.length >= maxStack) throw new Error('Growth turtle exceeds its stack budget');
        stack.push(state);
        continue;
      }
      if (symbol === ']') {
        if (!stack.length) throw new Error('Growth turtle has an unmatched return');
        state = stack.pop();
        continue;
      }
      if (symbol === 'F' || symbol === 'f') {
        const run = args[0] ?? length, tip = args[1] ?? radius;
        if (!finite(run) || run < 0 || !positive(tip)) throw new Error('Growth branch needs a nonnegative length and positive radius');
        const next = V.mad(p, forward, run);
        if (!vector(next)) throw new Error('Growth turtle exceeds its coordinate budget');
        if (record && symbol === 'F' && run > EPS)
          limbs.push({ id: token.id, pts: [p.slice(), next.slice()], r0: radius, r1: tip, depth });
        state = { ...state, p: next, radius: tip };
        continue;
      }
      if (symbol === '!') {
        if (!positive(args[0])) throw new Error('Growth turtle radius must be positive');
        state = { ...state, radius: args[0] };
        continue;
      }
      if (symbol === '+' || symbol === '-') {
        state = { ...state, forward: rotate(forward, up, symbol === '+' ? turn : -turn) };
      } else if (symbol === '&' || symbol === '^') {
        const right = V.norm(V.cross(forward, up)), amount = symbol === '&' ? turn : -turn;
        state = { ...state, forward: rotate(forward, right, amount), up: rotate(up, right, amount) };
      } else if (symbol === '/' || symbol === '\\') {
        state = { ...state, up: rotate(up, forward, symbol === '/' ? turn : -turn) };
      } else if (record && marker.has(symbol)) {
        points.push({ id: token.id, symbol, p: p.slice(), direction: forward.slice(), up: up.slice(), radius });
      }
    }
    if (stack.length) throw new Error('Growth turtle has unclosed branches');
    return { limbs, marks: points, frames };
  }

  function turtle(input, options = {}) {
    return P.data.freeze(interpret(parse(input, 'tape', null, 300000, true), options));
  }

  function lsystem(axiom, input, {
    generations = 4, seed = 0, environment, frame, maxSymbols = 50000, maxChecks = 3000000
  } = {}) {
    if (
      !Array.isArray(input) || !integer(input.length, 1, 256) || !integer(generations, 0, 48) ||
      !Number.isSafeInteger(seed) || !integer(maxSymbols, 1, 300000) || !integer(maxChecks, 1, 20000000) ||
      (environment !== undefined && typeof environment !== 'function')
    ) throw new Error('L-system needs productions, generations, a seed and bounded work');
    const rules = new Map();
    for (const rule of input) {
      const { from, to, when, weight = 1 } = rule ?? {};
      if (!symbol(from) || (typeof to !== 'function' && typeof to !== 'string' && !Array.isArray(to)) ||
        (when !== undefined && typeof when !== 'function') ||
        (typeof weight !== 'function' && (!Number.isFinite(weight) || weight < 0 || weight > 1e6)))
        throw new Error('Invalid L-system production');
      if (!rules.has(from)) rules.set(from, []);
      rules.get(from).push({ to, when, weight });
    }
    let tokens = P.data.freeze(parse(axiom, 'axiom', null, maxSymbols));
    const counts = [tokens.length], work = { checks: 0, generations: 0 };
    for (let generation = 0; generation < generations; generation++) {
      const frames = frame || environment ? interpret(tokens, frame, false).frames : null,
        next = [];
      for (const [index, token] of tokens.entries()) {
        if (++work.checks > maxChecks) throw new Error('L-system exceeds its production budget');
        const context = { index, generation, frame: frames?.[index], length: tokens.length };
        if (environment && rules.has(token.symbol)) context.environment = environment(token, context);
        const dice = K.grow.dice(P.data.hash(token.id + ':' + generation, seed)),
          options = rules.get(token.symbol) ?? [];
        let winner = null, total = 0;
        for (const rule of options) {
          if (++work.checks > maxChecks) throw new Error('L-system exceeds its production budget');
          if (rule.when && !rule.when(token, context)) continue;
          const weight = typeof rule.weight === 'function' ? rule.weight(token, context) : rule.weight;
          if (!Number.isFinite(weight) || weight < 0 || weight > 1e6) throw new Error('Invalid dynamic L-system weight');
          total += weight;
          if (dice() * total < weight) winner = rule;
        }
        const replacement = winner ? parse(typeof winner.to === 'function' ? winner.to(token, context) : winner.to,
          token.id + ':' + generation, token.args, maxSymbols - next.length) : [token];
        if (next.length + replacement.length > maxSymbols) throw new Error('L-system exceeds its symbol budget');
        for (const item of replacement) next.push(item);
      }
      tokens = P.data.freeze(next);
      counts.push(tokens.length);
      work.generations++;
    }
    return P.data.freeze({ tokens, counts, work });
  }

  P.growth = { lsystem, turtle };
})(KIT);
