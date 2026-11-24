/* Bounded FFT correlation for sampled cellular neighborhoods. */
const CellularConvolution = (() => {
  const wrap = (n, size) => (n % size + size) % size;
  const powerOfTwo = n => 2 ** Math.ceil(Math.log2(n));

  const { axis } = InkFFT;

  function padding(length, radius, periodic) {
    if (periodic && powerOfTwo(length) === length) return { length, halo: 0 };
    return { length: powerOfTwo(length + 2 * radius), halo: periodic ? radius : 0 };
  }

  function create(width, height, neighborhoods, periodic) {
    const radius = [0, 0];
    for (const { taps } of neighborhoods) for (const [dx, dy] of taps) {
      radius[0] = Math.max(radius[0], Math.abs(dx));
      radius[1] = Math.max(radius[1], Math.abs(dy));
    }
    const x = padding(width, radius[0], periodic), y = padding(height, radius[1], periodic);
    const w = x.length, h = y.length, size = w * h;
    const sources = [...new Set(neighborhoods.map(spec => spec.channel))];
    const work = size * (Math.log2(w * h) + 1) * (sources.length + neighborhoods.length);
    if (size > 262144 || work > 24000000) throw new RangeError('Continuous cellular: convolution exceeds the work budget');
    if (!neighborhoods.length) return { work: 0, evaluate: () => ({}) };
    const horizontal = axis(w), vertical = axis(h);
    function transform({ real, imag }, sign) {
      for (let row = 0; row < h; row++) horizontal(real, imag, row * w, 1, sign);
      for (let col = 0; col < w; col++) vertical(real, imag, col, w, sign);
    }
    const complex = () => ({ real: new Float64Array(size), imag: new Float64Array(size) });
    const kernels = new Map();
    const outputs = neighborhoods.map(({ name, channel, taps }) => {
      if (!kernels.has(taps)) {
        const spectrum = complex();
        for (const [dx, dy, weight] of taps) spectrum.real[wrap(-dy, h) * w + wrap(-dx, w)] += weight;
        transform(spectrum, -1);
        kernels.set(taps, spectrum);
      }
      return { name, channel, kernel: kernels.get(taps) };
    });
    const spectra = new Map(sources.map(name => [name, complex()])), product = complex();
    const columns = Array.from({ length: width + 2 * x.halo }, (_, i) => wrap(i - x.halo, w));
    const fromColumns = columns.map((_, i) => wrap(i - x.halo, width));
    const rows = Array.from({ length: height + 2 * y.halo }, (_, i) => wrap(i - y.halo, h) * w);
    const fromRows = rows.map((_, i) => wrap(i - y.halo, height) * width);

    function evaluate(state) {
      for (const [name, spectrum] of spectra) {
        const src = state[name];
        spectrum.real.fill(0); spectrum.imag.fill(0);
        for (let j = 0; j < rows.length; j++) for (let i = 0; i < columns.length; i++)
          spectrum.real[rows[j] + columns[i]] = src[fromRows[j] + fromColumns[i]];
        transform(spectrum, -1);
      }
      const result = Object.create(null);
      for (const { name, channel, kernel } of outputs) {
        const src = spectra.get(channel);
        for (let i = 0; i < size; i++) {
          product.real[i] = src.real[i] * kernel.real[i] - src.imag[i] * kernel.imag[i];
          product.imag[i] = src.real[i] * kernel.imag[i] + src.imag[i] * kernel.real[i];
        }
        transform(product, 1);
        const field = new Float32Array(width * height);
        for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
          field[j * width + i] = product.real[j * w + i] / size;
        }
        result[name] = field;
      }
      return result;
    }
    return { work, evaluate };
  }
  return Object.freeze({ create });
})();
