/* Named render-graph and inspection channels on the existing scene timeline. */
(function (K) {
  const unit = { mode: 'number', validate: n => n >= 0 && n <= 1 };
  const toggle = { mode: 'step', validate: v => typeof v === 'boolean' };
  const label = { mode: 'step', validate: v => typeof v === 'string' && [...v].length <= 80 };
  const positive = { mode: 'positive', validate: n => n > 0 };
  function channel(look, [root, name, field, subfield, ...rest]) {
    if (rest.length) return null;
    if (root === 'renderGraph') {
      const node = look?.renderGraph?.passes?.find(pass => pass.id === name);
      if (!node) return null;
      if (field === 'volume' && node.type === 'mask' && node.volume) {
        if (subfield === 'at') return { size: 3 };
        if (subfield === 'extent') return { size: 3, validate: v => v.every(n => n > 0) };
        if (subfield === 'feather') return unit;
      }
      if (field === 'warp' && node.type === 'feedback') {
        if (['velocity', 'wave'].includes(subfield)) return { size: 2, validate: v => v.every(n => Math.abs(n) <= 1e6) };
        if (subfield === 'center') return { size: 2, validate: v => v.every(n => n >= 0 && n <= 1) };
        if (subfield === 'zoom') return { mode: 'positive', validate: n => n >= .01 && n <= 100 };
        if (subfield === 'period') return { mode: 'positive', validate: n => n >= .01 };
        if (subfield === 'blockSize') return { mode: 'number', validate: n => n >= 0 };
        if (['rotation', 'rate'].includes(subfield)) return { mode: 'number', validate: n => Math.abs(n) <= 1e6 };
        if (subfield === 'phase') return { mode: 'number' };
      }
      if (subfield !== undefined) return null;
      if (field === 'gain' && node.type === 'feedback') return unit;
      if (['bloom','halation'].includes(node.type) && field==='intensity') return {mode:'number',validate:n=>n>=0&&n<=8};
      if (['bloom','halation'].includes(node.type) && field==='radius') return {mode:'positive',validate:n=>n>=.1&&n<=512};
      if (node.type==='blocks' && field==='probability') return unit;
      if (node.type==='blocks' && field==='rate') return {mode:'number',validate:n=>n>=0&&n<=120};
      if (['blocks','chromatic'].includes(node.type) && field==='offset') return {size:2,validate:v=>v.every(n=>Math.abs(n)<=(node.type==='chromatic'?8:512))};
      if (field === 'opacity') return unit;
      if (field === 'enabled') return toggle;
      if (field === 'rect' && node.type === 'mask') return { size: 4, validate: v => v[2] > 0 && v[3] > 0 };
      if (field === 'feather' && node.type === 'mask') return { mode: 'number', validate: n => n >= 0 };
      if (node.type === 'distortion' && ['offset', 'amplitude'].includes(field)) return { size: 2 };
      if (field === 'halfLife' && ['history', 'feedback'].includes(node.type)) return positive;
    }
    if (root === 'inspection') {
      const target = look?.inspection?.targets?.find(row => row.id === name);
      if (!target) return null;
      if (field === 'magnify' && target.magnify) {
        if (subfield === 'enabled') return toggle;
        if (subfield === 'zoom') return { mode: 'number', validate: n => n >= 1 && n <= 32 };
      }
      if (subfield !== undefined) return null;
      if (field === 'coverage') return unit;
      if (field === 'active') return toggle;
      if (field === 'label' || field === 'detail') return label;
    }
    return null;
  }
  function sample(world, time, overrides) {
    const timeline = world.timeline, look = world.look;
    const graph = overrides?.renderGraph === undefined && (look?.renderGraph?.snapshot?.() ?? look?.renderGraph);
    const inspection = overrides?.inspection === undefined && look?.inspection;
    if (!timeline?.targets?.some(([root]) => root === 'renderGraph' && graph?.passes || root === 'inspection' && inspection?.targets)) return;
    const graphs = new Map(), targets = new Map();
    for (const { path: [root, name, field, subfield], value } of timeline.sample(time).edits) {
      const edits = root === 'renderGraph' && graph?.passes ? graphs : root === 'inspection' && inspection?.targets ? targets : null;
      if (!edits) continue;
      const changes = edits.get(name) ?? {};
      if (subfield === undefined) changes[field] = value;
      else (changes[field] ??= {})[subfield] = value;
      edits.set(name, changes);
    }
    function apply(rows, edits) {
      return rows.map(row => {
        const fields = edits.get(row.id);
        if (!fields) return row;
        return { ...row, ...fields,
          ...(fields.warp && { warp: { ...row.warp, ...fields.warp } }),
          ...(fields.volume && { volume: { ...row.volume, ...fields.volume } }),
          ...(fields.magnify && { magnify: { ...row.magnify, ...fields.magnify } }) };
      });
    }
    return {
      ...(graphs.size && { renderGraph: { ...graph, passes: apply(graph.passes, graphs) } }),
      ...(targets.size && { inspection: { ...inspection, targets: apply(inspection.targets, targets) } })
    };
  }
  K.presentationTimeline = Object.freeze({ channel, sample });
})(KIT);
