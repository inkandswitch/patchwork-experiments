/* Fit one horizontally contiguous profile around another at each height. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-9;
  const xAt = ([a,b], y) => a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
  const add = (side, p) => {
    const last = side.at(-1);
    if (last && Math.hypot(last[0]-p[0],last[1]-p[1]) <= EPS) return;
    if (side.length > 1) {
      const a=side.at(-2), dx=last[0]-a[0], dy=last[1]-a[1], x=p[0]-last[0], y=p[1]-last[1];
      if (Math.abs(dx*y-dy*x)<=EPS*Math.hypot(dx,dy) && dx*x+dy*y>=0) side.pop();
    }
    side.push(p);
  };
  function compile(points) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 128 ||
      !Array.from(points).every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
      throw Error('A monotone outline needs 3 to 128 finite planar points');
    const levels = [...new Set(points.map(p => p[1]))].sort((a,b) => a - b),
      edges = points.map((a,i) => [a, points[(i+1)%points.length]]);
    if (levels.length < 2 || edges.some(([a,b]) => a[0] === b[0] && a[1] === b[1]))
      throw Error('A monotone outline needs distinct edges and nonzero height');
    const rows = levels.slice(1).map((high, i) => {
      const low = levels[i], mid = (low + high) / 2, pair = edges
        .filter(([a,b]) => (a[1] > mid) !== (b[1] > mid))
        .sort((a,b) => xAt(a,mid) - xAt(b,mid));
      if (pair.length !== 2 || xAt(pair[0],mid) >= xAt(pair[1],mid) - EPS ||
        [low,high].some(y => xAt(pair[0],y) > xAt(pair[1],y) + EPS))
        throw Error('Outline must be horizontally monotone with a single open interval at each height');
      return { pair, low, high };
    });
    for (let i=1;i<rows.length;i++) {
      const a=rows[i-1].pair,b=rows[i].pair,y=rows[i].low;
      if (Math.max(xAt(a[0],y),xAt(b[0],y)) >= Math.min(xAt(a[1],y),xAt(b[1],y)) - EPS)
        throw Error('A monotone outline cannot touch itself at a ledge');
    }
    return { levels, rows };
  }

  function fitMonotoneOutline({ outline, required = null }) {
    const authored = compile(outline), protectedBand = required && compile(required);
    if (protectedBand && (protectedBand.levels[0] < authored.levels[0] ||
      protectedBand.levels.at(-1) > authored.levels.at(-1)))
      throw Error('The required band must fit within the outline height');
    const levels = [...new Set([...authored.levels, ...(protectedBand?.levels || [])])].sort((a,b) => a - b);
    const left = [], right = [];
    const active = (bands, y) => bands?.rows.find(r => y > r.low && y < r.high)?.pair;
    function append(side, index, base, guard, low, high, choose) {
      if (!guard) {
        for (const y of [low, high]) add(side, [xAt(base[index], y), y]);
        return;
      }
      const diff = y => xAt(base[index], y) - xAt(guard[index], y),
        first = diff(low), last = diff(high);
      const ys = first * last < 0 ? [low,low + (high-low)*first/(first-last),high] : [low,high];
      for (const y of ys) add(side, [choose(xAt(base[index],y),xAt(guard[index],y)),y]);
    }
    for (let i=1;i<levels.length;i++) {
      const low=levels[i-1],high=levels[i],mid=(low+high)/2,
        base=active(authored,mid),guard=active(protectedBand,mid);
      append(left,0,base,guard,low,high,Math.min);
      append(right,1,base,guard,low,high,Math.max);
    }
    const ring = [];
    for (const p of [...right, ...left.reverse()]) add(ring,p);
    if (Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1]) <= EPS) ring.pop();
    return P.data.freeze(ring);
  }
  P.geometry.fitMonotoneOutline = fitMonotoneOutline;
})(KIT);
