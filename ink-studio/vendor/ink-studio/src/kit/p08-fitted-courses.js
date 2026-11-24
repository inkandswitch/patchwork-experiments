/* Bounded rectangular panel/course partition. Nominal dimensions are fitted to
   the domain; periodic rows share the same logical cell across their seam. */
(function (K) {
  const A = K.procedural,
    { freeze } = A.data;
  A.fittedCourses = spec => {
    const { width, height } = spec || {},
      unit = spec?.unit,
      joint = spec?.joint ?? 0,
      stagger = spec?.stagger ?? 0,
      periodic = spec?.periodic ?? false,
      budget = spec?.budget ?? 8192;
    if (
      ![width, height].every(v => Number.isFinite(v) && v > 0 && v <= 1e6) ||
      !Array.isArray(unit) ||
      unit.length !== 2 ||
      !unit.every(v => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(joint) ||
      joint < 0 ||
      !Number.isFinite(stagger) ||
      stagger < 0 ||
      stagger >= 1 ||
      typeof periodic !== 'boolean' ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 65536
    )
      throw Error('Fitted courses need finite positive spans, units and a bounded budget');
    const nx = Math.max(1, Math.round(width / unit[0])),
      ny = Math.max(1, Math.round(height / unit[1])),
      dx = width / nx,
      dy = height / ny;
    if (
      nx * ny + (stagger ? Math.floor(ny / 2) : 0) > budget ||
      joint >= Math.min(dx, dy) / 2 ||
      (stagger && ny > 1 && joint / 2 >= Math.min(stagger, 1 - stagger) * dx)
    )
      throw Error('Fitted courses exceed their cell budget or joint width');
    const rows = [],
      cells = [];
    function rectangle(row, column, lo, hi, phase) {
      const left = periodic || lo > 0,
        right = periodic || hi < width,
        low = row > 0,
        high = row < ny - 1,
        id = row + '/' + (periodic ? ((column % nx) + nx) % nx : column),
        bounds = { min: [lo, row * dy], max: [hi, (row + 1) * dy] },
        inset = {
          min: [lo + (left ? joint / 2 : 0), row * dy + (low ? joint / 2 : 0)],
          max: [hi - (right ? joint / 2 : 0), (row + 1) * dy - (high ? joint / 2 : 0)]
        };
      // A periodic seam bisects a cell rather than introducing another joint.
      if (periodic && phase) {
        if (lo === 0) inset.min[0] = 0;
        if (hi === width) inset.max[0] = width;
      }
      return freeze({ id, row, column: periodic ? ((column % nx) + nx) % nx : column, bounds, inset });
    }
    for (let r = 0; r < ny; r++) {
      const phase = r % 2 ? stagger : 0,
        row = [];
      for (let j = phase ? -1 : 0; j < nx; j++) {
        const lo = Math.max(0, (j + phase) * dx),
          hi = Math.min(width, (j + 1 + phase) * dx);
        if (hi <= lo) continue;
        const cell = rectangle(r, j, lo, hi, phase);
        row.push(cell);
        cells.push(cell);
      }
      rows.push(freeze({ index: r, min: r * dy, max: (r + 1) * dy, cells: row }));
    }
    function at(u, v) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw Error('Course lookup needs finite coordinates');
      if (v < 0 || v > height || (!periodic && (u < 0 || u > width))) return null;
      u = periodic ? ((u % width) + width) % width : Math.min(width, u);
      const r = Math.min(ny - 1, Math.floor(v / dy)),
        phase = r % 2 ? stagger : 0,
        j = Math.floor(u / dx - phase),
        index = Math.max(0, Math.min(rows[r].cells.length - 1, j + (phase ? 1 : 0)));
      return rows[r].cells[index];
    }
    function distance(u, v, ignoreBoundary = false) {
      if (ignoreBoundary && !joint) return -Infinity;
      const cell = at(u, v);
      if (!cell) return Infinity;
      let x = u;
      if (periodic) x = ((u % width) + width) % width;
      const r = cell.row,
        phase = r % 2 ? stagger : 0;
      let lo = cell.inset.min[0],
        hi = cell.inset.max[0];
      if (periodic && phase) {
        if (cell.bounds.min[0] === 0) lo = (phase - 1) * dx + joint / 2;
        if (cell.bounds.max[0] === width) hi = (nx + phase) * dx - joint / 2;
      }
      const a = ignoreBoundary
          ? Math.max(lo > 0 || periodic ? lo - x : -Infinity, hi < width || periodic ? x - hi : -Infinity)
          : Math.abs(x - (lo + hi) / 2) - (hi - lo) / 2,
        b = ignoreBoundary
          ? Math.max(
              cell.inset.min[1] > 0 ? cell.inset.min[1] - v : -Infinity,
              cell.inset.max[1] < height ? v - cell.inset.max[1] : -Infinity
            )
          : Math.abs(v - (cell.inset.min[1] + cell.inset.max[1]) / 2) - (cell.inset.max[1] - cell.inset.min[1]) / 2;
      return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
    }
    return freeze({
      width,
      height,
      unit: [dx, dy],
      joint,
      stagger,
      periodic,
      rows,
      cells,
      at,
      distance,
      jointDistance: (u, v) => distance(u, v, true)
    });
  };
})(KIT);
