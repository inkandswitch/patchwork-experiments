/* Shared frame boundaries for sound and input replay. */
(function (P) {
  const int = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const plain = P.graphTypes.validator('record');
  const id = value => typeof value === 'string' && /^[a-z][\w.:-]{0,95}$/i.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value);
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const floor = value => {
    const nearest = Math.round(value);
    return Math.abs(nearest - value) <= 4 * Number.EPSILON * Math.max(1, Math.abs(value)) ? nearest : Math.floor(value);
  };

  function clock(time, { fps = 24, origin = 0, frame } = {}) {
    const { numerator, denominator } = typeof fps === 'number' ? { numerator: fps, denominator: 1 } : fps ?? {};
    if (!range(time, -1e9, 1e9) || !range(origin, -1e9, 1e9) || !range(numerator, .001, 1e9) ||
        !int(denominator, 1, 1e9) || typeof fps !== 'number' && !int(numerator, 1, 1e9) ||
        !range(numerator / denominator, .001, 1000)) throw new RangeError('Invalid media frame rate or clock');
    frame ??= floor((time - origin) * numerator / denominator);
    if (!int(frame, -1e9, 1e9)) throw new RangeError('Invalid media frame index');
    return {
      frame, fps: numerator / denominator, start: origin + frame * denominator / numerator,
      end: origin + (frame + 1) * denominator / numerator
    };
  }

  P.mediaGraph = { clock };
  P.mediaGraphSupport = { int, plain, id, range, floor, clock };
})(KIT.procedural);
