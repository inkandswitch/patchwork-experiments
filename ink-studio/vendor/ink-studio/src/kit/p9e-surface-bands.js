/* Fit bands to the edges of a chart feature while preserving their mount
   line. A blocked band shortens toward its mount or drops below minimum size. */
(function (K) {
  const P = K.procedural || K.authoring;
  const sides = [['left', 0, -1], ['right', 0, 1], ['bottom', 1, -1], ['top', 1, 1]];
  const point = v => Array.isArray(v) && v.length === 2 && Array.from(v).every(Number.isFinite);
  const box = b => point(b?.min) && point(b?.max) && b.min.every((v, i) => v < b.max[i]);

  function fitSurfaceBands({ domain, panels, opening, edges, obstructions = [], clearance = 0 } = {}) {
    if (
      !box(opening) || !edges || typeof edges !== 'object' || Array.isArray(edges) ||
      Object.keys(edges).some(key => !sides.some(([side]) => side === key)) ||
      !Array.isArray(obstructions) || obstructions.length > 4096 || !Array.from(obstructions).every(box) ||
      !Number.isFinite(clearance) || clearance < 0
    ) throw new Error('Surface bands need finite chart boxes, edge rules and bounded obstructions');

    if (panels === undefined) {
      if (!box(domain)) throw new Error('Surface bands need a finite chart domain');
      panels = [domain];
    } else if (
      domain !== undefined || !Array.isArray(panels) || panels.length > 64 ||
      !Array.from(panels).every(panel => box(panel) && typeof panel.id === 'string' && panel.id.length > 0) ||
      new Set(panels.map(panel => panel.id)).size !== panels.length
    ) throw new Error('Surface bands need up to 64 uniquely named panel domains');

    const bands = [];
    for (const panel of panels) fitPanel(panel, opening, edges, obstructions, clearance, bands, domain === undefined);
    return P.data.freeze(bands);
  }

  function fitPanel(domain, opening, edges, obstructions, clearance, bands, named) {
    for (const [edge, axis, sign] of sides) {
      if (edges[edge] === undefined || edges[edge] === false) continue;
      const cross = 1 - axis;
      const {
        span = opening.max[cross] - opening.min[cross], minSpan = .01,
        reach, minReach = .01, gap = 0
      } = edges[edge] || {};
      if (![span, minSpan, reach, minReach, gap].every(Number.isFinite) ||
          span <= 0 || minSpan <= 0 || reach <= 0 || minReach <= 0 || gap < 0)
        throw new Error('Surface band dimensions must be finite and positive');

      const center = (opening.max[cross] + opening.min[cross]) / 2;
      const lo = Math.max(domain.min[cross], center - span / 2);
      const hi = Math.min(domain.max[cross], center + span / 2);
      const mount = (sign < 0 ? opening.min[axis] : opening.max[axis]) + sign * gap;
      if (mount < domain.min[axis] || mount > domain.max[axis] || hi - lo < minSpan) continue;

      let room = Math.min(reach, sign < 0 ? mount - domain.min[axis] : domain.max[axis] - mount);
      for (const b of obstructions) {
        if (lo >= b.max[cross] + clearance || hi <= b.min[cross] - clearance) continue;
        const near = sign < 0 ? mount - b.max[axis] : b.min[axis] - mount;
        const far = sign < 0 ? mount - b.min[axis] : b.max[axis] - mount;
        if (far > -clearance) room = Math.min(room, near - clearance);
      }
      if (room < minReach - 1e-9) continue;
      const end = mount + sign * room, min = [], max = [], hinge = [];
      min[axis] = Math.min(mount, end);
      max[axis] = Math.max(mount, end);
      min[cross] = lo;
      max[cross] = hi;
      hinge[axis] = mount;
      hinge[cross] = (lo + hi) / 2;
      bands.push({ edge, axis, sign, reach: room, span: hi - lo, bounds: { min, max }, hinge,
        ...(named && { panel: domain.id }) });
    }
  }

  P.fitSurfaceBands = fitSurfaceBands;
})(KIT);
