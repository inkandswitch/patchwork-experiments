/* Shared spatial field contracts and bounded sampling for world queries. */
(function (K) {
  const W = K.world, freeze = K.procedural.data.freeze;
  const {check,record,id,own,copy} = W.data;
  const axesByName = {x:[0],y:[1],z:[2],xy:[0,1],xz:[0,2],yz:[1,2],xyz:[0,1,2]};
  function vector(value, size) {
    if (!Array.isArray(value) || value.length !== size) return false;
    for (const n of value) if (!Number.isFinite(n)) return false;
    return true;
  }
  const inside = (point, bounds, halfOpen = false) => !bounds || point.every((n,i) =>
    n >= bounds.min[i] && (halfOpen ? n < bounds.max[i] : n <= bounds.max[i]));

  function checkBounds(bounds, dimensions) {
    check(record(bounds) && vector(bounds.min,dimensions) && vector(bounds.max,dimensions) &&
      bounds.min.every((n,i) => n <= bounds.max[i]), 'Invalid spatial field bounds');
  }

  function matches({type,spatial}, value) {
    switch (type) {
      case 'number': return Number.isFinite(value);
      case 'vec2': return vector(value,2);
      case 'vec3': return vector(value,3);
      case 'category': return spatial.categories.includes(value);
      default: return false;
    }
  }

  function define(spec, read) {
    check(record(spec) && typeof read === 'function','Expected a spatial field definition and sampler');
    const { type, units = null, space = 'world', axes = 'xyz', bounds = null, sampling = 'custom',
      boundary = 'closed', categories, components } = spec;
    check(['number','vec2','vec3','category'].includes(type), 'Invalid spatial field type');
    check(units === null || typeof units === 'string' && units.trim().length > 0, 'Invalid spatial field units');
    check(own(axesByName,axes), 'Spatial field axes need x, y, z, xy, xz, yz or xyz');
    check(components === undefined || type === 'vec2' && ['xy','xz','yz'].includes(components),
      'Only vec2 fields can specify xy, xz or yz components');
    const indices = axesByName[axes];
    check(['custom','regions','nearest','linear','cell'].includes(sampling) &&
      !(type === 'category' && sampling === 'linear'), 'Invalid sampling for spatial field type');
    check(['closed','half-open'].includes(boundary),'Invalid spatial field boundary');
    check(space === 'world' || record(space) && id(space.entity) &&
      (space.socket === undefined || id(space.socket)) && Object.keys(space).every(key => key === 'entity' || key === 'socket'),
    'Spatial field space needs world or an entity and optional socket');
    check(type !== 'vec2' || space === 'world','Use vec3 for vectors in an attached field');
    if (bounds !== null) checkBounds(bounds,indices.length);
    if (type === 'category') check(Array.isArray(categories) && categories.length > 0 && categories.length <= 256 &&
      Array.from(categories).every(value => typeof value === 'string' && value.trim().length > 0) &&
      new Set(categories).size === categories.length, 'A category field needs distinct category names');
    else check(categories === undefined,'Only category fields declare categories');

    const spatial = freeze(copy({axes,space,bounds,boundary,sampling,...(categories && {categories}),
      ...(type === 'vec2' && {components:components??'xz',valueSpace:'world'}),
      ...(type === 'vec3' && {components:'xyz',valueSpace:'world'})}));
    return Object.freeze({type,units,spatial,read(context, resolveFrame) {
      const {target,args,system,field,tick,time} = context, worldPoint = target.point;
      const explain = args.explain === true;
      let point, frame;
      function report(result, source) {
        return explain ? {...result,provenance:{field:system+'/'+field,tick,time,worldPoint:worldPoint??null,
          point:point??null,type,units,...spatial,...(frame && {frame}),source:source??null}} : result;
      }
      if (!worldPoint) return report(W.query.missing('point required'));
      check(vector(worldPoint,3),'Spatial field needs a finite XYZ point');
      let local = worldPoint;
      if (space !== 'world') {
        frame = resolveFrame?.(spatial.space);
        if (!frame) return report(W.query.missing('unknown field entity or socket','missing'));
        local = K.V.sub(worldPoint,frame.point);
        if (frame.rotation) local = K.M.app(K.M.tr(frame.rotation),local);
      }
      point = axes === 'xyz' ? local : indices.map(i => local[i]);
      if (!inside(point,spatial.bounds,boundary === 'half-open'))
        return report(W.query.missing('outside spatial field bounds','outside'));
      context.point = point;
      context.explain = explain;
      const result = read(context);
      check(record(result) && typeof result.status === 'string','Invalid spatial field result at '+system+'/'+field);
      if (result.status === 'ok' || own(result,'value')) {
        check(matches({type,spatial},result.value),'Invalid spatial field value at '+system+'/'+field);
      }
      if (frame?.rotation && type === 'vec3' && own(result,'value')) {
        const value = K.M.app(frame.rotation,result.value);
        check(matches({type,spatial},value),'Invalid world-space vector at '+system+'/'+field);
        const {source,...sample} = result;
        return report({...sample,value},source);
      }
      if (!own(result,'source')) return report(result);
      const {source,...sample} = result;
      return report(sample,source);
    }});
  }

  function grid(descriptor, spec) {
    const {type,spatial:{axes,bounds,sampling}} = descriptor;
    const dimensions = axesByName[axes].length;
    check(record(spec) && Array.isArray(spec.counts) && spec.counts.length === dimensions &&
      Array.from(spec.counts).every(n => Number.isSafeInteger(n) && n > 0), 'Invalid spatial field grid counts');
    const {counts,values} = spec, count = counts.reduce((n,size) => n*size,1);
    check(count <= 100000 && Array.isArray(values) && values.length === count &&
      Array.from(values).every(value => matches(descriptor,value)), 'Invalid spatial field grid values');
    const extent = bounds.max.map((n,i) => n-bounds.min[i]);
    check(extent.every((n,i) => counts[i] === 1 || Number.isFinite(n) && n > 0),
      'A spatial field grid axis with multiple samples needs a finite positive span');
    const stride = counts.map((_,i) => counts.slice(0,i).reduce((n,size) => n*size,1));
    return function sample(point, explain) {
      const coordinates = point.map((n,i) => counts[i] === 1 ? 0 :
        Math.min(counts[i]-1,Math.max(0,(n-bounds.min[i])/extent[i]*(counts[i]-1))));
      if (sampling === 'nearest') {
        const node = coordinates.map(Math.round);
        const index = node.reduce((n,k,i) => n+k*stride[i],0);
        return {status:'ok',value:values[index],...(explain && {source:{kind:'grid',nodes:[{node,weight:1}]}})};
      }
      const base = coordinates.map(Math.floor), fractions = coordinates.map((n,i) => n-base[i]);
      const scalar = type === 'number', components = type === 'vec2' ? 2 : 3;
      let value = scalar ? 0 : Array(components).fill(0);
      const nodes = explain ? [] : null;
      for (let mask = 0; mask < 2**dimensions; mask++) {
        let weight = 1, index = 0;
        for (let i = 0; i < dimensions; i++) {
          const upper = mask >> i & 1;
          weight *= upper ? fractions[i] : 1-fractions[i];
          index += (base[i]+upper)*stride[i];
        }
        if (weight === 0) continue;
        if (scalar) value += values[index]*weight;
        else for (let j = 0; j < components; j++) value[j] += values[index][j]*weight;
        if (nodes) nodes.push({node:base.map((n,i) => n+(mask >> i & 1)),weight});
      }
      return {status:'ok',value,...(nodes && {source:{kind:'grid',nodes}})};
    };
  }

  W.spatialFields = Object.freeze({define,matches,grid,checkBounds,inside});
})(KIT);
