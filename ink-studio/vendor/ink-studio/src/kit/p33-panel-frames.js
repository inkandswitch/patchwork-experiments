/* Structural layouts in a 2D chart. Rails, posts and bay braces may be
   realized as timber, sheet profiles, grilles or any caller-chosen material. */
(function (K) {
  const P = K.procedural || K.authoring;
  const choices = new Set(['none', 'ascending', 'descending', 'alternating', 'cross']);
  const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  function panelFrames({ width, height, unit, beam, braceWidth = beam, braces = 'none', periodic = false, budget = 4096 } = {}) {
    if (!Number.isFinite(beam) || beam <= 0 || !Number.isFinite(braceWidth) || braceWidth <= 0 ||
        typeof braces !== 'function' && !choices.has(braces) ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 32768)
      throw new Error('Panel frames need finite member widths, a brace policy and a bounded budget');
    const layout = P.fittedCourses({ width, height, unit, periodic, budget });
    const [du, dv] = layout.unit;
    if (beam >= Math.min(du, dv) * .8 || braceWidth >= Math.min(du, dv) * .8)
      throw new Error('Panel frame members must leave room in each bay');
    const cols = layout.rows[0].cells.length, rows = layout.rows.length;
    const parts = [], bracesByBay = new Map();
    const half = beam / 2;
    function add(key, role, polygon) {
      if (parts.length >= budget) throw new Error('Panel frames exceed their member budget');
      const part = { key, role, polygon };
      parts.push(part);
      return part;
    }
    for (let row = 0; row <= rows; row++) {
      const y = row * dv;
      add('rail/' + row, 'rail', rectangle(0, Math.max(0, y - half), width, Math.min(height, y + half)));
    }
    for (let column = 0; column <= cols; column++) {
      const x = column * du;
      add('post/' + (periodic ? column % cols : column), 'post',
        rectangle(Math.max(0, x - half), 0, Math.min(width, x + half), height));
    }
    for (const cell of layout.cells) {
      let policy = typeof braces === 'function' ? braces(cell) : braces;
      if (!choices.has(policy)) throw new Error('Unknown panel frame brace policy');
      if (policy === 'alternating') policy = (cell.row + cell.column) % 2 ? 'ascending' : 'descending';
      if (policy === 'none') continue;
      const min = cell.bounds.min.map(v => v + half), max = cell.bounds.max.map(v => v - half);
      const domain = rectangle(min[0], min[1], max[0], max[1]);
      const members = [];
      for (const side of policy === 'cross' ? ['ascending', 'descending'] : [policy]) {
        const a = [min[0], side === 'ascending' ? min[1] : max[1]];
        const b = [max[0], side === 'ascending' ? max[1] : min[1]];
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
        const x = dx / length * braceWidth / 2, y = dy / length * braceWidth / 2;
        const polygon = [
          [a[0] - x + y, a[1] - y - x], [b[0] + x + y, b[1] + y - x],
          [b[0] + x - y, b[1] + y + x], [a[0] - x - y, a[1] - y + x]
        ];
        const key = 'brace/' + cell.id + '/' + side;
        const footprint = P.surfaceCells.clip([{ key, polygon }], { boundary: domain, budget: 1 });
        if (footprint.cells.length) members.push(add(key, 'brace', footprint.cells[0].fragments[0]));
      }
      bracesByBay.set(cell.id, members);
    }
    function braceDistance(part, u, v) {
      let distance = -Infinity;
      const points = part.polygon;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        distance = Math.max(distance, ((u - a[0]) * dy - (v - a[1]) * dx) / Math.hypot(dx, dy));
      }
      return distance;
    }
    function distance(u, v) {
      const cell = layout.at(u, v);
      if (!cell) return Infinity;
      if (periodic) u = ((u % width) + width) % width;
      let d = Math.min(Math.abs(u - Math.round(u / du) * du), Math.abs(v - Math.round(v / dv) * dv)) - half;
      for (const part of bracesByBay.get(cell.id) || []) d = Math.min(d, braceDistance(part, u, v));
      const boundary = Math.max(periodic ? -Infinity : Math.max(-u, u - width), -v, v - height);
      return Math.max(boundary, d);
    }
    return P.data.freeze({ layout, parts, distance, postCount: periodic ? cols : cols + 1, railCount: rows + 1 });
  }

  P.panelFrames = panelFrames;
})(KIT);
