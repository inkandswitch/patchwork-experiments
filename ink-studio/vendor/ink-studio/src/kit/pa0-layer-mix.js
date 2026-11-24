/* Gain curves and time-domain crossfades without a playback dependency. */
(function (K) {
  const P = K.procedural || K.authoring;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const name = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);

  function curve(points) {
    if (!Array.isArray(points) || points.length < 1 || points.length > 32 ||
        Array.from(points).some((point, i) => !Array.isArray(point) || point.length !== 2 ||
          !unit(point[0]) || !unit(point[1]) || (i && point[0] <= points[i-1][0])))
      throw Error('Gain curves need increasing input stops with values in [0, 1]');
    const stops = points.map(point => point.slice());
    return value => {
      if (value <= stops[0][0]) return stops[0][1];
      const index = stops.findIndex(point => point[0] >= value);
      if (index < 0) return stops.at(-1)[1];
      const [x0,g0] = stops[index-1], [x1,g1] = stops[index];
      return g0 + (g1-g0)*(value-x0)/(x1-x0);
    };
  }

  function create(specs, { budget = 1 } = {}) {
    if (!Array.isArray(specs) || !specs.length || specs.length > 64 || !unit(budget))
      throw Error('A mix needs 1..64 layers and a gain budget in [0, 1]');
    const keys = new Set(), controls = new Set();
    const layers = Array.from(specs, spec => {
      const { id, gain = 1, curves = {}, fadeIn = 0, fadeOut = fadeIn } = spec ?? {};
      if (!name(id) || keys.has(id) || !unit(gain) || ![fadeIn,fadeOut].every(s=>Number.isFinite(s)&&s>=0&&s<=60) ||
          !curves || typeof curves !== 'object' || Array.isArray(curves))
        throw Error('Invalid mix layer');
      keys.add(id);
      const entries = Object.entries(curves);
      if (entries.length > 8 || entries.some(([key]) => !name(key))) throw Error('Invalid gain controls');
      for (const [key] of entries) controls.add(key);
      return { id, gain, fadeIn, fadeOut, curves:entries.map(([key,points])=>[key,curve(points)]) };
    });

    function limit(gains) {
      const sum = gains.reduce((a,b) => a+b,0);
      return sum > budget ? gains.map(value => value*budget/sum) : gains;
    }
    function targets(inputs) {
      for (const key of controls) if (!inputs || !Object.hasOwn(inputs,key) || !unit(inputs[key]))
        throw Error('Missing or invalid gain control: '+key);
      return limit(layers.map(layer=>layer.curves.reduce((gain,[key,evaluate])=>gain*evaluate(inputs[key]),layer.gain)));
    }
    const label = gains => Object.freeze(Object.fromEntries(layers.map((layer,i)=>[layer.id,gains[i]])));
    function state(inputs) {
      let current = targets(inputs);
      return Object.freeze({
        gains: () => label(limit(current)),
        advance(values, seconds) {
          if (!Number.isFinite(seconds) || seconds < 0) throw Error('Mix elapsed time must be finite and nonnegative');
          const target = targets(values);
          current = current.map((value,i) => {
            const layer=layers[i], next=target[i], duration=next>value?layer.fadeIn:layer.fadeOut;
            return duration ? value+(next-value)*-Math.expm1(-seconds/duration) : next;
          });
          return label(limit(current));
        }
      });
    }
    return Object.freeze({ sample:inputs=>label(targets(inputs)), state });
  }

  P.layerMix = Object.freeze({ create });
})(KIT);
