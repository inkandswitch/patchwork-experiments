/* Coordinates along a closed carrier, independent of how its seam is placed. */
(function (K) {
  const P = K.procedural || K.authoring;

  function wrap(value, period = 1) {
    const remainder = value % period;
    return remainder < 0 ? (remainder + period) % period : remainder === 0 ? 0 : remainder;
  }

  function delta(value, origin, period = 1) {
    let distance = value - origin;
    if (Math.abs(distance) >= period) distance = wrap(value, period) - wrap(origin, period);
    if (distance >= period / 2) return distance - period;
    if (distance < -period / 2) return distance + period;
    return distance;
  }

  function unwrap(values, period = 1) {
    const positions = Array.from(values, value => wrap(value, period));
    if (positions.length < 2) return positions;
    const sorted = positions.slice().sort((a, b) => a - b);
    let start = sorted[0], largest = period - sorted.at(-1) + start;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap > largest) {
        largest = gap;
        start = sorted[i];
      }
    }
    return positions.map(position => position < start ? position + period : position);
  }

  function loop(spans) {
    if (!Array.isArray(spans) || !spans.length)
      throw new Error('A periodic loop needs ordered keyed spans');
    let length = 0;
    const keys = new Map(), bands = [];
    for (const span of spans) {
      const {key, length: width} = span || {};
      if (typeof key !== 'string' || !key || keys.has(key) || !Number.isFinite(width) ||
          width <= 0 || !Number.isFinite(length + width) || length + width === length)
        throw new Error('Loop spans need unique keys and positive finite lengths');
      const band = {key, start: length, length: width};
      keys.set(key, band);
      bands.push(band);
      length += width;
    }
    function locate(station) {
      if (!Number.isFinite(station)) throw new Error('Loop station must be finite');
      const at = wrap(station, length);
      let lo = 0, hi = bands.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (bands[mid].start <= at) lo = mid;
        else hi = mid;
      }
      const {key, start, length: width} = bands[lo];
      return {key, fraction: (at - start) / width};
    }
    function station(key, fraction) {
      const band = keys.get(key), at = band && band.start + band.length * fraction;
      if (!Number.isFinite(at) || !Number.isFinite(fraction))
        throw new Error('Loop station needs a known span and a finite fraction');
      return at;
    }
    return Object.freeze({length, locate, station});
  }

  P.periodicCoordinates = { wrap, delta, unwrap, loop };
})(KIT);
