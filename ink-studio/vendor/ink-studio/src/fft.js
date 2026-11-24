/* Shared radix-two FFT for audio analysis and cellular convolution. */
const InkFFT = (() => {
  function axis(length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > 262144 || (length & (length - 1)))
      throw new RangeError('FFT length must be a power of two within the transform budget');
    const reverse = new Uint32Array(length), cos = new Float64Array(length / 2), sin = cos.slice();
    for (let i = 1; i < length; i++) reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * (length >> 1));
    for (let i = 0; i < cos.length; i++) {
      const angle = 2 * Math.PI * i / length;
      cos[i] = Math.cos(angle);
      sin[i] = Math.sin(angle);
    }
    return (real, imag, offset, stride, sign) => {
      for (let i = 0; i < length; i++) {
        if (i >= reverse[i]) continue;
        const a = offset + i * stride, b = offset + reverse[i] * stride;
        const r = real[a], j = imag[a];
        real[a] = real[b]; imag[a] = imag[b];
        real[b] = r; imag[b] = j;
      }
      for (let span = 2; span <= length; span *= 2) {
        const half = span / 2, spacing = length / span;
        for (let at = 0; at < length; at += span) {
          for (let j = 0; j < half; j++) {
            const a = offset + (at + j) * stride, b = a + half * stride, phase = j * spacing;
            const c = cos[phase], s = sign * sin[phase];
            const r = real[b] * c - imag[b] * s, im = real[b] * s + imag[b] * c;
            real[b] = real[a] - r; imag[b] = imag[a] - im;
            real[a] += r; imag[a] += im;
          }
        }
      }
    };
  }
  return Object.freeze({ axis });
})();
if (typeof module === 'object' && module.exports) module.exports = InkFFT;
