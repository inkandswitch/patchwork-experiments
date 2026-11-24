/* Fit repeated pieces along paired profile edges. Sampling both rails at the
   same edge fractions keeps corners and wrapped seams continuous. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { freeze } = P.data;
  const EPS = 1e-9;
  const mix = (a, b, t) => {
    if (t <= 0) return a;
    if (t >= 1) return b;
    return a.map((v, i) => v + (b[i] - v) * t);
  };

  function fittedRibbon({ inner, outer, pitch, gap = 0, closed = false, phase = 0, sections, measure, budget = 8192 } = {}) {
    const dimension = inner?.[0]?.length;
    if (
      ![2, 3].includes(dimension) ||
      !Array.isArray(inner) ||
      !Array.isArray(outer) ||
      inner.length !== outer.length ||
      inner.length < (closed ? 3 : 2) ||
      inner.length > 4096 ||
      ![inner, outer].every(rail =>
        Array.from(rail).every(
          point => Array.isArray(point) && point.length === dimension && Array.from(point).every(Number.isFinite)
        )
      ) ||
      (measure !== undefined && (!Array.isArray(measure) || measure.length !== inner.length ||
        !Array.from(measure).every(
          point => Array.isArray(point) && point.length === dimension && Array.from(point).every(Number.isFinite)
        ))) ||
      !Number.isFinite(pitch) ||
      pitch <= 0 ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      typeof closed !== 'boolean' ||
      !Number.isFinite(phase) ||
      phase < 0 ||
      phase >= 1 ||
      (!closed && phase !== 0) ||
      (sections !== undefined && phase !== 0) ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 65536
    )
      throw new Error('Fitted ribbons need matching finite rails, positive pitch and a bounded budget');
    const a = inner.map(point => point.slice());
    const b = outer.map(point => point.slice());
    const metric = measure ?? a;
    const edges = [];
    let length = 0;
    for (let edge = 0; edge < a.length - (closed ? 0 : 1); edge++) {
      const next = (edge + 1) % a.length;
      const size = Math.hypot(...metric[edge].map((v, axis) => metric[next][axis] - v));
      if (size <= EPS || !Number.isFinite(length + size) || length + size === length)
        throw new Error('Fitted ribbons need distinct consecutive measuring vertices');
      edges.push({ edge, next, start: length, size });
      length += size;
    }
    function fragment(edge, next, start, size, from, to) {
      const t0 = from === start ? 0 : (from - start) / size;
      const t1 = to === start + size ? 1 : (to - start) / size;
      return { edge, from, to, points: [
        mix(a[edge], a[next], t0), mix(a[edge], a[next], t1),
        mix(b[edge], b[next], t1), mix(b[edge], b[next], t0)
      ] };
    }
    if (sections !== undefined) {
      const cells = sectionCells(sections, length, pitch, gap, closed, budget);
      let first = 0, fragments = 0;
      for (const { edge, next, start, size } of edges) {
        const end = start + size;
        while (first < cells.length && cells[first].to <= start + EPS) first++;
        for (let j = first; j < cells.length && cells[j].from < end - EPS; j++) {
          const cell = cells[j], from = Math.max(start, cell.from), to = Math.min(end, cell.to);
          if (to - from <= EPS) continue;
          if (++fragments > budget) throw new Error('Fitted ribbon exceeds its fragment budget');
          cell.fragments.push(fragment(edge, next, start, size, from, to));
        }
      }
      return freeze({ length, unit: length / cells.length, cells, fragmentCount: fragments });
    }
    const count = Math.max(1, Math.round(length / pitch));
    const unit = length / count;
    if (count > budget || gap >= unit || unit <= EPS)
      throw new Error('Fitted ribbon exceeds its piece budget or joint width');
    const cells = Array.from({ length: count }, (_, index) => ({ key: String(index), index, fragments: [] }));
    const shift = phase * unit;
    let fragments = 0;
    for (const { edge, next, start, size } of edges) {
      const end = start + size;
      for (let i = Math.floor((start + shift) / unit); i * unit - shift < end - EPS; i++) {
        if (!closed && i >= count) break;
        const from = Math.max(start, i * unit - shift + (closed || i > 0 ? gap / 2 : 0));
        const to = Math.min(end, (i + 1) * unit - shift - (closed || i < count - 1 ? gap / 2 : 0));
        if (to - from <= EPS) continue;
        if (++fragments > budget) throw new Error('Fitted ribbon exceeds its fragment budget');
        cells[i % count].fragments.push(fragment(edge, next, start, size, from, to));
      }
    }
    return freeze({ length, unit, cells, fragmentCount: fragments });
  }

  function sectionCells(sections, length, pitch, gap, closed, budget) {
    if (!Array.isArray(sections) || !sections.length || sections.length > budget || sections.at(-1)?.end !== 1)
      throw new Error('Fitted ribbon sections must cover the full rail');
    const names = new Set(), cells = [];
    let start = 0;
    for (const section of sections) {
      const { id, end, count, pitch: nominal = pitch, gap: joint = gap } = section || {};
      const finish = end * length, span = finish - start;
      if (typeof id !== 'string' || !id || names.has(id) || !Number.isFinite(end) || end > 1 ||
          span <= EPS || !Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(joint) || joint < 0 ||
          count !== undefined && (!Number.isSafeInteger(count) || count < 1))
        throw new Error('Fitted ribbon sections need unique IDs and increasing end stations');
      names.add(id);
      const n = count ?? Math.max(1, Math.round(span / nominal)), unit = span / n;
      if (cells.length + n > budget || joint >= unit || unit <= EPS)
        throw new Error('Fitted ribbon exceeds its piece budget or joint width');
      const key = encodeURIComponent(id), half = joint / 2;
      for (let index = 0; index < n; index++) {
        const first = !closed && !cells.length;
        const last = !closed && end === 1 && index === n - 1;
        const from = first ? 0 : start + index * unit + half;
        const to = last ? length : start + (index + 1) * unit - half;
        cells.push({ key: key + '/' + index, index: cells.length, section: id, unit, from, to, fragments: [] });
      }
      start = finish;
    }
    return cells;
  }

  P.fittedRibbon = fittedRibbon;
})(KIT);
