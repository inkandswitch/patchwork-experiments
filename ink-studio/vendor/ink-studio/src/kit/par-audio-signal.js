/* Native frame-locked waveform and FFT analysis for interleaved audio. */
(function (P) {
  const A = P.mediaGraph;
  const { int, range, plain, id, floor, clock } = P.mediaGraphSupport;
  const valid = P.graphTypes.validator('audio');
  const axes = new Map();

  function audio(source) {
    if (!valid(source) || !int(source.sampleRate, 1, 768000) || !int(source.channels, 1, 64) ||
        source.samples.length > 32000000) throw new RangeError('Expected bounded interleaved normalized audio');
    return { sampleRate: source.sampleRate, channels: source.channels, samples: source.samples };
  }

  function layout(source, selection) {
    if (selection === 'all') return Array.from({ length: source.channels }, (_, i) => i);
    if (selection === 'mix' || int(selection, 0, source.channels - 1)) return [selection];
    throw new RangeError('Choose all channels, a mix, or a zero-based channel index');
  }

  function sampler({ samples, channels }) {
    const count = samples.length / channels;
    return (i, channel) => {
      if (i < 0 || i >= count) return 0;
      const offset = i * channels;
      if (channel !== 'mix') return samples[offset + channel];
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += samples[offset + c];
      return sum / channels;
    };
  }

  function span(source, time, options) {
    const { origin = 0, offset = 0 } = options;
    if (!range(offset, -1e9, 1e9)) throw new RangeError('Audio offset must be finite seconds');
    const frame = clock(time, options), fps = options.fps ?? 24;
    const factor = typeof fps === 'number' ? 1 : fps.denominator;
    const numerator = typeof fps === 'number' ? fps : fps.numerator;
    function sample(n) {
      const originSample = (origin - offset) * source.sampleRate;
      const product = n * factor * source.sampleRate;
      let result;
      if (Number.isSafeInteger(originSample) && Number.isSafeInteger(numerator)) {
        if (Number.isSafeInteger(product)) result = originSample + Math.floor(product / numerator);
        else {
          const units = BigInt(n) * BigInt(factor) * BigInt(source.sampleRate), divisor = BigInt(numerator);
          const divided = units / divisor - BigInt(units < 0 && units % divisor !== 0n);
          result = Number(BigInt(originSample) + divided);
        }
      } else result = floor(originSample + product / numerator);
      if (!Number.isSafeInteger(result)) throw new RangeError('Audio clip is outside the sample coordinate range');
      return result;
    }
    const first = sample(frame.frame), end = sample(frame.frame + 1), total = source.samples.length / source.channels;
    const available = Math.max(0, Math.min(end, total) - Math.max(first, 0));
    return { ...frame, firstSample: first, endSample: end, sampleCount: end - first, available, sampleRate: source.sampleRate };
  }

  function audioWindow(input, options = {}) {
    const source = audio(input), take = layout(source, options.channel ?? 'all');
    const info = span(source, options.time ?? 0, options);
    const { padding = 'zero' } = options;
    if (!['zero', 'trim'].includes(padding)) throw new RangeError('Audio padding needs zero or trim');
    const first = padding === 'trim' ? Math.max(0, info.firstSample) : info.firstSample;
    const count = padding === 'trim' ? info.available : info.sampleCount;
    if (count * take.length > 2400000) throw new RangeError('Audio window exceeds the sample budget');
    const samples = new Float64Array(count * take.length), sample = sampler(source);
    for (let i = 0, at = 0; i < count; i++) for (const c of take) samples[at++] = sample(first + i, c);
    return { value: { sampleRate: source.sampleRate, channels: take.length, samples }, report: info };
  }

  function features(source, info, take) {
    const sample = sampler(source), n = info.sampleCount;
    const first = Math.max(0, info.firstSample), end = Math.min(source.samples.length / source.channels, info.endSample);
    let power = 0, peak = 0;
    const channels = take.map(channel => {
      let sum = 0, squared = 0, max = 0;
      for (let i = first; i < end; i++) {
        const value = sample(i, channel);
        squared += value * value;
        sum += value;
        max = Math.max(max, Math.abs(value));
      }
      power += squared;
      peak = Math.max(peak, max);
      return { channel, rms: Math.sqrt(squared / (n || 1)), peak: max, mean: sum / (n || 1) };
    });
    return { value: { ...info, channels }, rms: Math.sqrt(power / (n * take.length || 1)), peak };
  }

  function analyze(input, options = {}) {
    const source = audio(input);
    return features(source, span(source, options.time ?? 0, options), layout(source, options.channel ?? 'all'));
  }

  const windows = {
    rect: () => 1,
    hann: theta => .5 - .5 * Math.cos(theta),
    hamming: theta => .54 - .46 * Math.cos(theta),
    blackman: theta => .42 - .5 * Math.cos(theta) + .08 * Math.cos(2 * theta)
  };

  function fftSetup(source, { size, window = 'hann', bands = {} }, count, channels) {
    const n = size ?? Math.min(65536, 2 ** Math.ceil(Math.log2(Math.max(32, count))));
    if (!int(n, 16, 65536) || (n & (n - 1)) || !Object.hasOwn(windows, window) || n * channels > 1048576 ||
        !plain(bands) || Object.keys(bands).length > 64) throw new RangeError('Invalid FFT size, window or band count');
    const bandRows = Object.entries(bands).map(([name, spec]) => {
      if (!id(name) || !Array.isArray(spec) || spec.length !== 2 || !range(spec[0], 0, 384000) ||
          !range(spec[1], 0, 768000) || spec[1] <= spec[0]) throw new RangeError('FFT bands need increasing frequency ranges');
      const [low, high] = spec, binHz = source.sampleRate / n;
      return { name, lo: Math.ceil(low / binHz), hi: high >= source.sampleRate / 2 ? n / 2 + 1 : Math.ceil(high / binHz) };
    });
    let transform = axes.get(n);
    if (!transform) {
      transform = InkFFT.axis(n);
      axes.set(n, transform);
      if (axes.size > 8) axes.delete(axes.keys().next().value);
    }
    const weights = Float64Array.from({ length: n }, (_, i) => windows[window](i * (2 * Math.PI) / n));
    return { n, window, transform, weights, total: weights.reduce((sum, v) => sum + v, 0), bandRows };
  }

  function measure(source, info, channels, plan) {
    const { n, transform, weights, total, bandRows, window } = plan, count = n / 2 + 1;
    const sample = sampler(source), data = new Float64Array(count * channels.length);
    const begin = info.firstSample + Math.floor((info.sampleCount - n) / 2), binHz = source.sampleRate / n;
    let channelIndex = 0;
    const perChannel = channels.map(channel => {
      const real = new Float64Array(n), imag = new Float64Array(n);
      for (let i = 0; i < n; i++) real[i] = sample(begin + i, channel) * weights[i];
      transform(real, imag, 0, 1, -1);
      const spectrum = data.subarray(channelIndex * count, ++channelIndex * count);
      let strongest = 0;
      for (let k = 0; k < count; k++) {
        spectrum[k] = Math.hypot(real[k], imag[k]) * (k > 0 && k < count - 1 ? 2 : 1) / total;
        if (k && spectrum[k] > spectrum[strongest]) strongest = k;
      }
      const bands = Object.fromEntries(bandRows.map(({ name, lo, hi }) => {
        let peak = 0;
        for (let i = lo; i < hi; i++) peak = Math.max(peak, spectrum[i]);
        return [name, peak];
      }));
      return { channel, dominantHz: strongest * binHz, bands };
    });
    const bands = Object.fromEntries(bandRows.map(({ name }) => [name, Math.max(...perChannel.map(row => row.bands[name]))]));
    return { value: { ...info, fftSize: n, windowFirstSample: begin, binHz, window, channels: perChannel },
      spectrum: { width: count, height: channels.length, channels: 1, data }, bands };
  }

  function fft(input, options = {}) {
    const source = audio(input), info = span(source, options.time ?? 0, options);
    const channels = layout(source, options.channel ?? 'all');
    return measure(source, info, channels, fftSetup(source, options, info.sampleCount, channels.length));
  }

  function series(input, { first = 0, count, fft: spectral, ...options } = {}) {
    const source = audio(input), { fps } = clock(0, options), channels = layout(source, options.channel ?? 'all');
    const duration = source.samples.length / (source.channels * source.sampleRate);
    count ??= Math.max(0, Math.ceil((duration + (options.offset ?? 0) - (options.origin ?? 0)) * fps) - first);
    if (!int(first, -1e8, 1e8) || !int(count, 0, 14400) || spectral !== undefined && !plain(spectral))
      throw new RangeError('Invalid audio analysis range');
    const sampleCount = Math.ceil(source.sampleRate / fps);
    const plan = spectral && fftSetup(source, spectral, sampleCount, channels.length);
    const work = count * channels.length * (sampleCount + (plan ? plan.n * Math.log2(plan.n) : 0));
    if (work > 120e6) throw new RangeError('Audio series exceeds the transform budget');
    return Array.from({ length: count }, (_, i) => {
      const info = span(source, 0, { ...options, frame: first + i });
      const { value, rms, peak } = features(source, info, channels);
      const scan = plan && measure(source, info, channels, plan);
      return { ...value, rms, peak, ...(scan && { bands: scan.bands, spectral: scan.value.channels }) };
    });
  }

  Object.assign(A, { audio, audioWindow, analyze, fft, series });
})(KIT.procedural);
