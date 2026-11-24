/* Optional material coverage and ordered interpolation of its own shade ramp. */
const MaterialPixelStyle = (() => {
  const modes = ['none', 'bayer', 'checker', 'diagonal'];
  const shapes = ['spot', 'streak', 'rim'];
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  // Baked rows hold edge, key, lower RGB, upper RGB. The key stores mode,
  // shade count, flags, and the ramp blend in half of its fractional part.
  const PATTERN = 1024, PAIR = 2048;
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = (a, b, x) => {
    const n = clamp((x - a) / (b - a));
    return n * n * (3 - 2 * n);
  };

  function record(value, fields, label) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !fields.includes(key)))
      throw new TypeError('Invalid material pixel ' + label);
  }
  function prepare(value) {
    if (value === undefined || value === false) return null;
    record(value, ['edgeHardness', 'dither', 'highlight', 'shadeSteps', 'coverage'], 'style');
    const { edgeHardness, dither = 'none', shadeSteps, highlight, coverage } = value;
    const rules = typeof ContributionRules === 'undefined' ? require('./contribution-rules.js') : ContributionRules;
    const coverageCode = coverage === undefined ? 0 : 1 + rules.coverageMode(coverage);
    if (edgeHardness !== undefined && (!Number.isFinite(edgeHardness) || edgeHardness < 0 || edgeHardness > 1))
      throw new RangeError('Material edgeHardness must be between 0 and 1');
    if (!modes.includes(dither)) throw new TypeError('Material dither must be none, bayer, checker or diagonal');
    if (shadeSteps !== undefined && (!Number.isInteger(shadeSteps) || shadeSteps < 2 || shadeSteps > 64))
      throw new RangeError('Material shadeSteps must be an integer between 2 and 64');
    let glint;
    if (highlight !== undefined && highlight !== false) {
      if (typeof highlight !== 'string') record(highlight, ['shape', 'strength'], 'highlight');
      const { shape, strength = .75 } = typeof highlight === 'string' ? { shape: highlight } : highlight;
      if (!shapes.includes(shape)) throw new TypeError('Material highlight shape must be spot, streak or rim');
      if (!Number.isFinite(strength) || strength < 0 || strength > 1)
        throw new RangeError('Material highlight strength must be between 0 and 1');
      glint = Object.freeze({ shape, strength });
    }
    const edge = edgeHardness === undefined ? 0 : 1 + edgeHardness;
    return Object.freeze({ edge: edge + coverageCode * rules.coverageStride,
      mode: modes.indexOf(dither), steps: shadeSteps ?? 0, highlight: glint });
  }

  function lighting(t, highlight, nx, ny, nz, light, view) {
    if (!highlight?.strength) return t;
    const [lx, ly, lz] = light, [vx, vy, vz] = view;
    const lit = smooth(0, .45, nx * lx + ny * ly + nz * lz);
    let lobe;
    if (highlight.shape === 'rim') {
      lobe = (1 - clamp((nx * vx + ny * vy + nz * vz) / (Math.hypot(vx, vy, vz) || 1))) ** 3;
    } else {
      const hx = lx + vx, hy = ly + vy, hz = lz + vz;
      const aim = (nx * hx + ny * hy + nz * hz) / (Math.hypot(hx, hy, hz) || 1);
      if (highlight.shape === 'spot') lobe = smooth(.90, .985, aim);
      else {
        const horizontal = Math.hypot(hx, hz);
        const cross = horizontal > 1e-5 ? (nx * hz - nz * hx) / horizontal : nx;
        lobe = smooth(.62, .94, aim) * (1 - smooth(.035, .18, Math.abs(cross)));
      }
    }
    return t + (1 - clamp(t)) * highlight.strength * lit * lobe;
  }
  function thresholds(mode, x, y) {
    if (mode === 1) return (bayer[(x & 3) + ((y & 3) << 2)] + .5) / 16;
    if (mode === 2) return (x + y) & 1 ? .75 : .25;
    return (((x + y) & 3) + .5) / 4;
  }
  function rowShade(t, steps) {
    return Math.round(clamp(t) * (steps - 1)) / (steps - 1);
  }
  function pixelShade(t, key, x, y, rampSize) {
    const code = Math.floor(key), mode = code & 7, steps = code >> 3 & 127;
    if (mode) {
      const bands = Math.min(steps || rampSize, rampSize) - 1;
      if (bands < 1) return t;
      const shade = clamp(t) * bands, low = Math.floor(shade);
      return (low + Number(shade - low > thresholds(mode, x, y))) / bands;
    }
    return steps ? rowShade(t, Math.min(steps, Math.max(2, rampSize))) : t;
  }
  function rampPair(t, steps, ramp) {
    const last = ramp.length - 1;
    const bands = Math.min(steps || ramp.length, ramp.length) - 1;
    if (bands < 1) return null;
    const shade = clamp(t) * bands, low = Math.floor(shade);
    return [ramp[Math.round(low / bands * last)],
      ramp[Math.round(Math.min(bands, low + 1) / bands * last)], shade - low];
  }
  return Object.freeze({ PATTERN, PAIR, prepare, lighting, thresholds, pixelShade, rampPair });
})();
if (typeof module !== 'undefined') module.exports = MaterialPixelStyle;
