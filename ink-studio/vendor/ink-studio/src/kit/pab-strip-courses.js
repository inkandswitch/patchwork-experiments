/* Fit staggered stock to a strip with piecewise-linear upper and lower edges. */
(function (K) {
  const EPS = 1e-8;
  const mod = (n, m) => ((n % m) + m) % m;

  function clip(points, side) {
    const result = [];
    let previous = points.at(-1), a = side(previous);
    for (const point of points) {
      const b = side(point);
      if (a < 0 && b > 0 || a > 0 && b < 0) {
        const t = a / (a - b);
        result.push(previous.map((v, i) => v + (point[i] - v) * t));
      }
      if (b >= 0) result.push(point);
      previous = point;
      a = b;
    }
    return result;
  }

  function stripCourses({ sections, unit, joint = 0, stagger = .5, datum = 0,
    closed = false, offset = 0, columnPeriod = 0, budget = 4096 } = {}) {
    const fullHeight = unit?.[1] === null;
    if (!Array.isArray(sections) || sections.length < 2 || sections.length > 8192 ||
      sections[0]?.s !== 0 || sections.some((section, i) => !section ||
        ![section.s, section.lower, section.upper].every(Number.isFinite) ||
        section.upper < section.lower || i && section.s - sections[i - 1].s <= EPS) ||
      !Array.isArray(unit) || unit.length !== 2 || !Number.isFinite(unit[0]) || unit[0] <= EPS ||
      !fullHeight && (!Number.isFinite(unit[1]) || unit[1] <= EPS) ||
      !Number.isFinite(datum) || !Number.isFinite(offset) ||
      !Number.isSafeInteger(columnPeriod) || columnPeriod < 0 ||
      !Number.isFinite(joint) || joint < 0 ||
      !Number.isFinite(stagger) || stagger < 0 || stagger >= 1 || typeof closed !== 'boolean' ||
      !Number.isSafeInteger(budget) || budget < 1 || budget > 65536)
      throw Error('Strip courses need ordered sections, finite dimensions and a bounded budget');

    const length = sections.at(-1).s;
    const count = closed ? Math.max(1, Math.round(length / unit[0])) : 0;
    const dx = closed ? length / count : unit[0], dy = unit[1], gap = joint / 2;
    if (!Number.isSafeInteger(count) || dx <= EPS || joint >= (fullHeight ? dx : Math.min(dx, dy)))
      throw Error('Strip course joints must be smaller than both fitted dimensions');

    const period = count || columnPeriod, pieces = [];
    const overflow = () => { throw new RangeError('Strip courses exceed their piece budget'); };
    let work = budget * 8 + sections.length;
    for (let segment = 0; segment < sections.length - 1; segment++) {
      const a = sections[segment], b = sections[segment + 1];
      const firstRow = fullHeight ? 0 : Math.floor((Math.min(a.lower, b.lower) - datum) / dy);
      const lastRow = fullHeight ? 0 : Math.ceil((Math.max(a.upper, b.upper) - datum) / dy) - 1;
      if (![firstRow, lastRow].every(Number.isSafeInteger) || lastRow - firstRow >= work) overflow();
      const slope = edge => (b[edge] - a[edge]) / (b.s - a.s);
      const lower = slope('lower'), upper = slope('upper');
      for (let row = firstRow; row <= lastRow; row++) {
        const phase = mod(row, 2) * stagger;
        const low = datum + row * dy + gap, high = datum + (row + 1) * dy - gap;
        const firstColumn = Math.floor((a.s + offset) / dx - phase);
        const lastColumn = Math.ceil((b.s + offset) / dx - phase) - 1;
        if (![firstColumn, lastColumn].every(Number.isSafeInteger) || lastColumn - firstColumn + 1 > work) overflow();
        work -= lastColumn - firstColumn + 1;
        for (let column = firstColumn; column <= lastColumn; column++) {
          const lo = Math.max(a.s, (column + phase) * dx - offset + gap);
          const hi = Math.min(b.s, (column + phase + 1) * dx - offset - gap);
          if (hi - lo <= EPS) continue;
          let polygon;
          if (fullHeight) {
            const edge = (s, base, slope) => [s, base + (s - a.s) * slope];
            polygon = [edge(lo, a.lower, lower), edge(hi, a.lower, lower),
              edge(hi, a.upper, upper), edge(lo, a.upper, upper)];
          } else {
            polygon = clip([[lo, low], [hi, low], [hi, high], [lo, high]],
              ([s, y]) => y - a.lower - (s - a.s) * lower);
            if (!polygon.length) continue;
            polygon = clip(polygon, ([s, y]) => a.upper + (s - a.s) * upper - y);
          }
          if (polygon.length < 3) continue;
          const [x0, y0] = polygon[0];
          const area = polygon.slice(1, -1).reduce((sum, [x, y], i) => {
            const [u, v] = polygon[i + 2];
            return sum + (x - x0) * (v - y0) - (u - x0) * (y - y0);
          }, 0);
          if (area <= EPS * EPS) continue;
          // Keep a single logical cell when a joint-free portion wraps the seam.
          const logical = period ? mod(column, period) : column;
          if (pieces.length === budget) overflow();
          pieces.push({ id: row + '/' + logical, row, column: logical, stockColumn: column, segment, polygon });
        }
      }
    }
    // Resolve against the nominal cells so a retained position on a joint still
    // identifies a logical piece. The caller can check whether it emitted stock.
    const bands=sections.map(({s,lower,upper})=>({s,lower,upper}));
    function bandAt(s) {
      if(!Number.isFinite(s)||s<0||s>length)return null;
      let low=0,high=bands.length-1;
      while(high-low>1){
        const mid=(low+high)>>1;
        if(bands[mid].s<=s)low=mid;
        else high=mid;
      }
      const a=bands[low],b=bands[high],t=(s-a.s)/(b.s-a.s);
      return {lower:a.lower+(b.lower-a.lower)*t,upper:a.upper+(b.upper-a.upper)*t};
    }
    function keyAt(s,y) {
      const band=bandAt(s);
      if(!band||!Number.isFinite(y)||y<band.lower||y>=band.upper)return null;
      const row=fullHeight?0:Math.floor((y-datum)/dy);
      const position=(s+offset)/dx-mod(row,2)*stagger;
      const column=s===length?Math.ceil(position)-1:Math.floor(position);
      return row+'/'+(period?mod(column,period):column);
    }
    return { unit: [dx, dy], length, columnPeriod: period, pieces, bandAt, keyAt };
  }

  K.stripCourses = stripCourses;
})(KIT);
