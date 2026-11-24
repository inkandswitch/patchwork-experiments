/* Built-in neighborhood rules and invertible binary block permutations. */
const CellularRules = (() => {
  const metadata = new WeakMap(),
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

  function local(rule, settings) {
    metadata.set(rule, settings);
    return Object.freeze(rule);
  }

  function elementary(number) {
    if (!integer(number, 0, 255)) throw new RangeError('Elementary rule number must be 0–255');
    return local(({ state, neighbors: [left, right] }) => (number >> (4 * left + 2 * state + right)) & 1,
      { states: 2, line: true });
  }

  function cyclic({ states = 8, threshold = 1 } = {}) {
    if (!integer(states, 2, 256) || !integer(threshold, 1, 32))
      throw new RangeError('Cyclic rules need 2–256 states and a threshold of 1–32');
    return local(({ state, neighbors }) => {
      const successor = (state + 1) % states;
      let count = 0;
      for (const neighbor of neighbors) if (neighbor === successor && ++count === threshold) return successor;
      return state;
    }, { states });
  }

  function briansBrain({ birth = 2 } = {}) {
    if (!integer(birth, 1, 32)) throw new RangeError('Brian’s Brain birth count must be 1–32');
    return local(({ state, neighbors }) => {
      if (state === 1) return 2;
      if (state === 2) return 0;
      return Number(neighbors.reduce((count, n) => count + Number(n === 1), 0) === birth);
    }, { states: 3 });
  }

  function excitable({ threshold = 1, gain = 1, leak = 1, refractory = 8, recovery = 0 } = {}) {
    if (![threshold, gain].every(n => integer(n, 1, 254)) || ![leak, refractory, recovery].every(n => integer(n, 0, 254)) ||
        threshold + refractory + recovery >= 256) throw new RangeError('Excitable rules need bounded integer charge and cooldown stages');
    const states = threshold + refractory + recovery + 1;
    const firing = threshold, recovered = firing + refractory + 1;
    const weight = ({ neighbors, inputs }) => inputs === undefined
      ? neighbors.reduce((sum, state) => sum + Number(state === firing), 0)
      : inputs.reduce((sum, input) => sum + (input.state === firing ? input.edge.weight : 0), 0);
    function required(state) {
      return threshold + Math.ceil(threshold * (states - state) / (recovery + 1));
    }
    const rule = context => {
      const { state } = context;
      const next = (state + 1) % states;
      if (state >= firing && state < recovered) return next;
      const drive = Math.floor(gain * weight(context));
      if (state < firing) return drive ? Math.min(firing, state + drive) : Math.max(0, state - leak);
      return drive >= required(state) ? firing : next;
    };
    return local(Object.assign(rule, { firing, states, describe(state) {
      if (!integer(state, 0, states - 1)) throw new RangeError('State is outside the excitable alphabet');
      if (state < firing) return { phase: state ? 'charging' : 'rest', charge: state, required: threshold, remaining: 0 };
      if (state === firing) return { phase: 'firing', charge: 0, required: null, remaining: 1 };
      if (state < recovered) return { phase: 'refractory', charge: 0, required: null, remaining: recovered - state };
      return { phase: 'recovering', charge: 0, required: required(state), remaining: states - state };
    } }), { states });
  }

  function margolus(table) {
    if (!(Array.isArray(table) || ArrayBuffer.isView(table)) || table.length !== 16 ||
        !Array.from(table).every(n => integer(n, 0, 15)) || new Set(table).size !== 16)
      throw new RangeError('A reversible block rule needs a permutation of the 16 binary block states');
    const forward = Object.freeze(Array.from(table)), backward = new Array(16);
    forward.forEach((n, i) => { backward[n] = i; });
    Object.freeze(backward);
    const rule = Object.freeze({ type: 'margolus', table: forward, inverse: backward });
    metadata.set(rule, { states: 2, block: true, forward, backward });
    return rule;
  }

  function blockRotate(turns = 1) {
    if (!integer(turns, 1, 3)) throw new RangeError('Block rotation needs 1–3 clockwise quarter turns');
    return margolus(Array.from({ length: 16 }, (_, n) => ((n << turns) | (n >> (4 - turns))) & 15));
  }

  function blockGas() {
    return margolus(Array.from({ length: 16 }, (_, n) => {
      if (n === 5 || n === 10) return n ^ 15;
      const bits = (n & 1) + (n >> 1 & 1) + (n >> 2 & 1) + (n >> 3 & 1);
      return bits % 2 ? ((n << 2) | (n >> 2)) & 15 : n;
    }));
  }

  const rules = { elementary, rule30: () => elementary(30), rule90: () => elementary(90),
    rule110: () => elementary(110), cyclic, briansBrain, excitable, margolus, blockRotate, blockGas };
  return Object.freeze({ rules: Object.freeze(rules), info: rule => metadata.get(rule) });
})();
