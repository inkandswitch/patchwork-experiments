/* Match nonoverlapping spans in a common parameter domain across an edit. */
(function (K) {
  const P = K.procedural || K.authoring;
  const center = ([a, b]) => a / 2 + b / 2;

  function matchIntervals(previous, next, { maxShift = 0, accept = () => true } = {}) {
    if (!Number.isFinite(maxShift) || maxShift < 0 || typeof accept !== 'function')
      throw new Error('Interval matching needs nonnegative shift and a candidate predicate');
    function entries(list) {
      if (!Array.isArray(list) || list.length > 4096) throw new Error('Expected up to 4096 spans');
      const sorted = Array.from(list, (span, index) => {
        if (!Array.isArray(span) || span.length !== 2 || !Array.from(span).every(Number.isFinite) || span[1] <= span[0])
          throw new Error('Each span needs finite increasing endpoints');
        return { span, index, mid: center(span) };
      }).sort((a, b) => a.span[0] - b.span[0]);
      if (sorted.some((item, i) => i && item.span[0] < sorted[i - 1].span[1]))
        throw new Error('Spans in each list must be disjoint');
      return sorted;
    }

    const old = entries(previous), current = entries(next), candidates = [];
    let low = 0;
    for (const b of current) {
      while (low < old.length && old[low].span[1] <= b.span[0] && old[low].mid < b.mid - maxShift) low++;
      for (let i = low; i < old.length; i++) {
        const a = old[i];
        if (a.span[0] >= b.span[1] && a.mid > b.mid + maxShift) break;
        const overlap = Math.min(a.span[1], b.span[1]) - Math.max(a.span[0], b.span[0]);
        const shift = Math.abs(a.mid - b.mid);
        if ((overlap <= 0 && shift > maxShift) || !accept(a.index, b.index)) continue;
        if (candidates.length >= 131072) throw new Error('Interval matching exceeds its candidate budget');
        candidates.push({ a, b, overlap: Math.max(0, overlap), shift });
      }
    }
    candidates.sort((a, b) => b.overlap - a.overlap || a.shift - b.shift ||
      a.a.span[0] - b.a.span[0] || a.b.span[0] - b.b.span[0]);
    const result = next.map(() => -1), used = new Set();
    for (const { a, b } of candidates) {
      if (used.has(a.index) || result[b.index] !== -1) continue;
      used.add(a.index);
      result[b.index] = a.index;
    }
    return Object.freeze(result);
  }

  P.matchIntervals = matchIntervals;
})(KIT);
