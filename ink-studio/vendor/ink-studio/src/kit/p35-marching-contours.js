/* Marching squares with shared edge crossings and a bilinear saddle decision. */
(function (K) {
  const P = K.procedural || K.authoring,
    point = p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6);

  function march(field, { bounds, cell = 0.1, iso = 0, maxCells = 120000 } = {}) {
    if (
      typeof field !== 'function' || !point(bounds?.min) || !point(bounds?.max) ||
      bounds.min.some((x, i) => x >= bounds.max[i]) ||
      !Number.isFinite(cell) || cell < 1e-6 || !Number.isFinite(iso) ||
      !Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 500000
    ) throw new Error('Contours need an ordered 2D domain, finite level and valid work limits');

    const [x0, y0] = bounds.min,
      [x1, y1] = bounds.max,
      cols = Math.ceil((x1 - x0) / cell),
      rows = Math.ceil((y1 - y0) / cell),
      stride = cols + 1,
      dx = (x1 - x0) / cols,
      dy = (y1 - y0) / rows;
    if (cols * rows > maxCells) throw new Error('Contours exceed their cell budget');
    const values = new Float64Array((rows + 1) * stride),
      xAt = c => c === cols ? x1 : x0 + c * dx,
      yAt = r => r === rows ? y1 : y0 + r * dy;
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) {
        const value = field(xAt(c), yAt(r)),
          relative = value === null ? NaN : value - iso;
        if (value !== null && (!Number.isFinite(value) || !Number.isFinite(relative)))
          throw new Error('Contour field must return a finite value or null');
        values[r * stride + c] = relative;
      }

    const nodes = new Map(),
      links = [];
    function cross(a, b) {
      const fa = values[a], fb = values[b],
        k = fa === 0 ? 'v:' + a : fb === 0 ? 'v:' + b : a + ':' + b;
      let node = nodes.get(k);
      if (!node) {
        const t = fa === 0 ? 0 : fb === 0 ? 1 : 1 / (1 + Math.abs(fb / fa)),
          ax = xAt(a % stride),
          ay = yAt(Math.floor(a / stride)),
          bx = xAt(b % stride),
          by = yAt(Math.floor(b / stride));
        node = { point: [ax + t * (bx - ax), ay + t * (by - ay)], edges: [] };
        nodes.set(k, node);
      }
      return node;
    }
    function connect(a, b) {
      if (a === b || a.edges.some(edge => edge.a === b || edge.b === b)) return;
      const edge = { a, b, used: false };
      a.edges.push(edge);
      b.edges.push(edge);
      links.push(edge);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * stride + c,
          b = a + 1,
          d = a + stride,
          e = d + 1,
          order = [[a, b], [b, e], [d, e], [a, d]];
        if ([a, b, d, e].some(i => Number.isNaN(values[i]))) continue;
        const crossings = order.filter(([i, j]) => (values[i] < 0) !== (values[j] < 0)).map(([i, j]) => cross(i, j));
        if (crossings.length === 2) connect(...crossings);
        if (crossings.length === 4) {
          const factor = Math.max(Math.abs(values[a]), Math.abs(values[b]), Math.abs(values[d]), Math.abs(values[e])),
            diagonal = (values[a] / factor) * (values[e] / factor) - (values[b] / factor) * (values[d] / factor);
          if (diagonal >= 0) {
            connect(crossings[0], crossings[1]);
            connect(crossings[2], crossings[3]);
          } else {
            connect(crossings[0], crossings[3]);
            connect(crossings[1], crossings[2]);
          }
        }
      }
    }

    const paths = [];
    function walk(node, edge) {
      const points = [node.point];
      let current = node;
      while (edge && !edge.used) {
        edge.used = true;
        current = edge.a === current ? edge.b : edge.a;
        points.push(current.point);
        if (current.edges.length !== 2) break;
        edge = current.edges.find(link => !link.used);
      }
      paths.push({ points, closed: current === node });
    }
    for (const node of nodes.values())
      if (node.edges.length !== 2) for (const edge of node.edges) if (!edge.used) walk(node, edge);
    for (const edge of links) if (!edge.used) walk(edge.a, edge);
    return P.data.freeze(paths);
  }

  P.contours = { march };
})(KIT);
