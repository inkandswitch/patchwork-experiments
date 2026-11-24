/* Packed visibility for retained samples, with matching integer texture addressing. */
const SampleVisibility = (() => {
  const width = 16, samplesPerRow = width * 32;
  function create(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid visibility sample count');
    const rows = Math.max(1, Math.ceil(count / samplesPerRow));
    const words = new Uint32Array(width * rows), previous = new Uint32Array(words.length);
    let changedRows = null;
    function set(indices) {
      if (!(indices instanceof Uint32Array)) throw new Error('Visibility indices must be unsigned integers');
      for (let i = 0; i < indices.length; i++)
        if (indices[i] >= count || (i > 0 && indices[i] <= indices[i - 1]))
          throw new Error('Visibility indices must be ordered, unique and in range');
      previous.set(words);
      words.fill(0);
      for (const index of indices) words[index >>> 5] |= 1 << (index & 31);
      let start = -1, end = 0;
      for (let row = 0; row < rows; row++) {
        const offset = row * width;
        for (let column = 0; column < width; column++) {
          const i = offset + column;
          if (words[i] === previous[i]) continue;
          if (start < 0) start = row;
          end = row + 1;
          break;
        }
      }
      changedRows = start < 0 ? null : Object.freeze({ start, end });
      return indices.length > 0;
    }
    return Object.freeze({
      rows, words, set, get changedRows() { return changedRows; },
      hidden: index => (words[index >>> 5] & (1 << (index & 31))) !== 0
    });
  }
  const glsl = `
uniform highp usampler2D u_sampleVisibility;
uniform bool u_sampleVisibilityOn;
bool sampleHidden(int index) {
  uint word = texelFetch(u_sampleVisibility, ivec2((index >> 5) & 15, index >> 9), 0).r;
  return (word & (1u << uint(index & 31))) != 0u;
}
`;
  return Object.freeze({ width, samplesPerRow, create, glsl });
})();
if (typeof module !== 'undefined') module.exports = SampleVisibility;
