/* Rectangle hierarchies shared by world scopes and output-pixel layouts. */
(function (P) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const axes = ['u', 'v'];
  function check(ok, message) {
    if (!ok) throw new RangeError('Proportions: ' + message);
  }
  function rectangle(bounds) {
    const pair = values => Array.isArray(values) && values.length === 2 &&
      Array.from(values).every(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 2);
    check(pair(bounds?.min) && pair(bounds?.max) && bounds.min.every((value, i) => value < bounds.max[i]),
      'rectangle needs positive finite UV bounds');
    return { min: bounds.min.slice(), max: bounds.max.slice() };
  }

  function subdivide(bounds, { ratio = phi, depth = 1, axis = 'longest', recurse = 'minor',
    majorAt = 'start', gap = 0, minSpan = 0 } = {}) {
    const root = rectangle(bounds);
    check(Number.isFinite(ratio) && ratio >= 1 && Number.isInteger(depth) && depth >= 0 && depth <= 12 &&
      ['longest', 'alternate', ...axes].includes(axis) && ['minor', 'major', 'both'].includes(recurse) &&
      ['start', 'end', 'turn'].includes(majorAt) && [gap, minSpan].every(n => Number.isFinite(n) && n >= 0),
    'expected a ratio of at least one, depth 0–12 and valid split settings');
    const nodes = [], leaves = [], seams = [];
    const small = 1 / (1 + ratio);

    function visit(bounds, path, remaining) {
      const level = path.length, node = { bounds, path, depth: level };
      nodes.push(node);
      if (remaining === 0) {
        leaves.push(node);
        return;
      }
      const spans = bounds.max.map((value, i) => value - bounds.min[i]);
      const dim = axis === 'longest' ? Number(spans[1] > spans[0])
        : axis === 'alternate' ? level % 2 : axes.indexOf(axis);
      const lo = bounds.min[dim], hi = bounds.max[dim], available = spans[dim] - gap;
      const firstMajor = majorAt === 'start' || (majorAt === 'turn' && level % 4 < 2);
      const firstEnd = lo + available * (firstMajor ? 1 - small : small);
      const nextStart = firstEnd + gap;
      if (!(firstEnd > lo && nextStart < hi && (gap === 0 || nextStart > firstEnd)) ||
        Math.min(firstEnd - lo, hi - nextStart, spans[1 - dim]) < minSpan) {
        leaves.push(node);
        return;
      }
      const bound = (low, high) => {
        const min = bounds.min.slice(), max = bounds.max.slice();
        min[dim] = low;
        max[dim] = high;
        return { min, max };
      };
      const seam = {
        bounds: bound(firstEnd, nextStart), path: [...path, 'seam'], depth: level + 1,
        axis: axes[dim], at: firstEnd + (nextStart - firstEnd) * .5
      };
      seams.push(seam);
      node.split = seam;
      const first = bound(lo, firstEnd), second = bound(nextStart, hi);
      visit(firstMajor ? first : second, [...path, 'major'], recurse === 'minor' ? 0 : remaining - 1);
      visit(firstMajor ? second : first, [...path, 'minor'], recurse === 'major' ? 0 : remaining - 1);
    }
    visit(root, [], depth);
    return P.data.freeze({ nodes, leaves, seams });
  }

  function pixelRect(bounds) {
    const { min, max } = rectangle(bounds);
    const [x, y] = min.map(Math.round);
    return [x, y, Math.round(max[0]) - x, Math.round(max[1]) - y];
  }

  P.proportions = Object.freeze({ phi, subdivide, pixelRect });
})(KIT.procedural);
