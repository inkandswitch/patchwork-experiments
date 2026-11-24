/* Trace open intervals of a signed field along a bounded parameter range. */
(function(K) {
  const P = K.procedural || K.authoring;

  function traceSignedIntervals(sample, {
    range = [0, 1], maxSlope = Infinity, step = 1 / 128,
    tolerance = step / 128, maxSamples = 16385
  } = {}) {
    if (typeof sample !== 'function' || !Array.isArray(range) || range.length !== 2 ||
        !range.every(Number.isFinite) || !(range[1] > range[0]) || !Number.isFinite(range[1] - range[0]) ||
        !(maxSlope >= 0 && typeof maxSlope === 'number') || !Number.isFinite(step) || step <= 0 ||
        !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > step ||
        !Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 65537)
      throw new Error('Signed interval tracing needs a bounded range, resolution and sample budget');

    const intervals = [];
    let samples = 0, complete = true;
    function read(at) {
      samples++;
      const value = sample(at);
      if (typeof value !== 'number' || Number.isNaN(value))
        throw new Error('Signed interval tracing needs numeric field samples');
      return value;
    }
    function append(low, high) {
      if (low >= high) return;
      const last = intervals.at(-1);
      if (last && last[1] === low) last[1] = high;
      else intervals.push([low, high]);
    }
    function visit(low, a, high, b) {
      const left = a < 0, right = b < 0, width = high - low;
      // Endpoint cones overlap only when the Lipschitz bound excludes a zero.
      if (left === right && (width <= step ||
          maxSlope < Infinity && Math.abs(a) + Math.abs(b) > maxSlope * width)) {
        if (left) append(low, high);
        return;
      }
      const mid = low + width / 2;
      if (width <= tolerance || mid === low || mid === high || samples === maxSamples) {
        if (width > tolerance && samples === maxSamples && mid > low && mid < high) complete = false;
        if (left) append(low, right ? high : mid);
        else if (right) append(mid, high);
        return;
      }
      const value = read(mid);
      visit(low, a, mid, value);
      visit(mid, value, high, b);
    }
    const [low, high] = range;
    visit(low, read(low), high, read(high));
    return Object.freeze({ intervals: Object.freeze(intervals.map(interval => Object.freeze(interval))), samples, complete });
  }

  P.traceSignedIntervals = traceSignedIntervals;
})(KIT);
