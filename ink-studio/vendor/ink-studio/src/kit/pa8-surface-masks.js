/* Paint retained in unit chart coordinates and measured in the current chart metric. */
(function (K) {
  const P = K.procedural || K.authoring;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

  function liftedRuns(points, topology, size) {
    const runs = [];
    let previous = topology.canonical(points[0]).uv, run = [previous];
    for (const at of points.slice(1)) {
      const next = topology.liftNear(at, previous, size), canonical = topology.canonical(next).uv;
      run.push(next);
      // Keep each run in the base chart and at most one step into an adjacent copy.
      if (next[0] !== canonical[0] || next[1] !== canonical[1]) {
        runs.push(run);
        run = [canonical];
      }
      previous = canonical;
    }
    if (run.length > 1 || !runs.length) runs.push(run);
    return runs;
  }

  function chartCopies({bounds}, topology, width, height) {
    const copies = [], shifts = [-3,-2,-1,0,1,2,3];
    const u0=bounds.min[0]/width,u1=bounds.max[0]/width,v0=bounds.min[2]/height,v1=bounds.max[2]/height;
    for (const x of topology.periodicU ? shifts : [0]) {
      const lo = Math.max(0, u0-x), hi = Math.min(1, u1-x);
      if (lo > hi) continue;
      const sign = topology.orientationAt(x);
      for (const y of topology.periodicV ? shifts : [sign === -1 ? 1 : 0]) {
        const a = sign*(v0-y), b = sign*(v1-y);
        const bottom = Math.max(0, Math.min(a,b)), top = Math.min(1, Math.max(a,b));
        if (bottom <= top) copies.push({ x,y,sign,min:[lo,bottom],max:[hi,top] });
      }
    }
    return copies;
  }

  function prepare(strokes, { size, periodic = false, topology } = {}) {
    if (!Array.isArray(size) || size.length !== 2 ||
        !size.every(length => Number.isFinite(length) && length > 0 && length <= 5e5) ||
        typeof periodic !== 'boolean')
      throw Error('Surface masks need a finite chart size');
    if (topology !== undefined && (periodic || !SurfaceChartTopologies.has(topology)))
      throw Error('Surface masks need a chart join descriptor without legacy periodic wrapping');
    if (!Array.isArray(strokes) || strokes.length > 256)
      throw Error('Surface masks need at most 256 strokes');

    const [width, height] = size;
    const { wrap, delta } = P.periodicCoordinates;
    const sweep = P.masks?.stroke || (spec => P.brushFields.stroke({ id: spec.id, parameters: spec }));
    let pointCount = 0;
    const masks = strokes.map((spec, id) => {
      const { points, width: brushWidth, softness = 0, operation = 'add' } = spec || {};
      if (!['add', 'erase'].includes(operation) || !Array.isArray(points) || !points.length ||
          !points.every(point => Array.isArray(point) && point.length === 2 && point.every(unit)))
        throw Error('Surface strokes need unit chart points and an add or erase operation');
      pointCount += points.length;
      if (pointCount > 8192) throw Error('Surface masks exceed their point budget');

      const runs = [];
      const measure = (u, v) => [u * width, v * height];
      if (topology) runs.push(...liftedRuns(points, topology, size).map(run => run.map(([u,v]) => measure(u,v))));
      else if (!periodic) runs.push(points.map(([u, v]) => measure(u, v)));
      else {
        // Join across the seam by the shortest step. Rebase at each chart turn so
        // queries only need the central copy and its two immediate neighbors.
        let [previous, heightAt] = points[0];
        let run = [measure(previous, heightAt)];
        for (const [u, v] of points.slice(1)) {
          const step = delta(u, previous);
          const current = previous + step;
          run.push(measure(current, v));
          previous = wrap(current);
          if (current < 0 || current >= 1) {
            runs.push(run);
            run = [measure(previous, v)];
          }
        }
        if (run.length > 1 || !runs.length) runs.push(run);
      }
      const compiled = runs.map(points => sweep({ id: String(id), points, width: brushWidth, softness }));
      return {
        erase: operation === 'erase',
        runs: compiled,
        ...(topology && { copies: compiled.map(run => chartCopies(run, topology, width, height)) })
      };
    });

    return {width,height,periodic,topology,wrap,masks};
  }

  function compile(strokes, options) {
    const {width,height,periodic,topology,wrap,masks}=prepare(strokes,options);
    function weight(u, v, initial = 0) {
      if (!Number.isFinite(u) || !Number.isFinite(v) || !unit(initial))
        throw Error('Surface mask queries need finite chart coordinates and unit initial coverage');
      if (topology) {
        if (!topology.contains([u,v])) return initial;
        const {uv:[s,t]} = topology.canonical([u,v]);
        let amount = initial;
        for (const mask of masks) amount = applyTopology(mask,s,t,width,height,amount);
        return amount;
      }
      if (v < 0 || v > 1 || (!periodic && (u < 0 || u > 1))) return initial;
      const x = (periodic ? wrap(u) : u) * width;
      const y = v * height;
      let amount = initial;
      for (const mask of masks) amount=apply(mask,x,y,width,periodic,amount);
      return amount;
    }
    return Object.freeze({ weight });
  }

  function apply({erase,runs},x,y,width,periodic,amount) {
    let coverage=0;
    const copies=periodic?1:0;
    for(const run of runs){
      const {min,max}=run.bounds;
      if(y<min[2]||y>max[2])continue;
      for(let shift=-copies;shift<=copies;shift++){
        const at=x+shift*width;
        if(at>=min[0]&&at<=max[0])coverage=Math.max(coverage,run.weight([at,y]));
      }
      if(coverage===1)break;
    }
    return erase?amount*(1-coverage):amount+(1-amount)*coverage;
  }

  function applyTopology({erase,runs,copies},u,v,width,height,amount) {
    let coverage=0;
    for (let i=0;i<runs.length && coverage<1;i++) for (const copy of copies[i]) {
      const {x,y,sign,min,max}=copy;
      if(u<min[0]||u>max[0]||v<min[1]||v>max[1])continue;
      coverage=Math.max(coverage,runs[i].weight([(u+x)*width,(v*sign+y)*height]));
    }
    return erase?amount*(1-coverage):amount+(1-amount)*coverage;
  }

  function changed(before,after){
    if (!Array.isArray(before)||!Array.isArray(after)||before.length>256||after.length>256)
      throw Error('Surface masks need at most 256 strokes');
    let prefix=0;
    while(prefix<before.length&&prefix<after.length&&
      (before[prefix]===after[prefix]||JSON.stringify(before[prefix])===JSON.stringify(after[prefix])))prefix++;
    return [before.slice(prefix),after.slice(prefix)];
  }

  function rectangles(masks,width,height,periodic){
    const result=[];
    for(const {runs} of masks)for(const {bounds:{min,max}} of runs){
      for(const shift of periodic?[-1,0,1]:[0]){
        const left=Math.max(0,min[0]/width+shift),right=Math.min(1,max[0]/width+shift);
        if(left>right)continue;
        result.push({min:[left,Math.max(0,min[2]/height)],max:[right,Math.min(1,max[2]/height)]});
      }
    }
    return result;
  }

  function dirtyBounds(before, after, options) {
    return changed(before,after).flatMap(strokes=>{
      const {masks,width,height,periodic,topology}=prepare(strokes,options);
      if (topology) return masks.flatMap(mask=>mask.copies.flat().map(({min,max})=>({min,max})));
      return rectangles(masks,width,height,periodic);
    });
  }

  function prepareLoop(strokes, {charts,height}){
    const loop=P.periodicCoordinates.loop(charts),widths=new Map(charts.map(({key,length})=>[key,length]));
    const size=[loop.length,height];
    prepare([], {size});
    if(!Array.isArray(strokes)||strokes.length>256)throw Error('Surface masks need at most 256 strokes');
    let count=0;
    const masks=strokes.map(stroke=>{
      const {chart,points}=stroke||{};
      const local=chart!==undefined, width=local?widths.get(chart):loop.length;
      if(!width||!Array.isArray(points)||!points.length)throw Error('Loop strokes need points on known charts');
      count+=points.length;
      if(count>8192)throw Error('Surface masks exceed their point budget');
      const measured=local?points:points.map(point=>{
        const {chart,uv}=point||{};
        if(!widths.has(chart)||!Array.isArray(uv)||uv.length!==2||!uv.every(unit))
          throw Error('Loop stroke points need a chart and unit UV coordinates');
        return [loop.station(chart,uv[0])/loop.length,uv[1]];
      });
      const {masks:[mask]}=prepare([{...stroke,points:measured}],{size:[width,height],periodic:!local});
      return {...mask,chart,width};
    });
    return {loop,widths,masks,height};
  }

  function compileLoop(strokes,options){
    const {loop,widths,masks,height}=prepareLoop(strokes,options),byChart=new Map();
    for(const chart of widths.keys())byChart.set(chart,masks.filter(mask=>mask.chart===undefined||mask.chart===chart));
    function weight(chart,u,v,initial=0){
      if(!widths.has(chart)||!Number.isFinite(u)||!Number.isFinite(v)||!unit(initial))
        throw Error('Loop mask queries need a known chart, finite UV and unit initial coverage');
      if(!unit(u)||!unit(v))return initial;
      const x=u*widths.get(chart),station=P.periodicCoordinates.wrap(loop.station(chart,u),loop.length),y=v*height;
      let amount=initial;
      for(const mask of byChart.get(chart)){
        const periodic=mask.chart===undefined;
        amount=apply(mask,periodic?station:x,y,mask.width,periodic,amount);
      }
      return amount;
    }
    return Object.freeze({weight});
  }

  function loopDirtyBounds(before,after,options){
    return changed(before,after).flatMap(strokes=>{
      const {loop,widths,masks,height}=prepareLoop(strokes,options);
      return masks.flatMap(mask=>{
        const local=mask.chart!==undefined,bounds=rectangles([mask],mask.width,height,!local);
        if(local)return bounds.map(rect=>({chart:mask.chart,...rect}));
        return bounds.flatMap(({min,max})=>[...widths].flatMap(([chart,width])=>{
          const start=loop.station(chart,0),lo=Math.max(0,(min[0]*loop.length-start)/width),
            hi=Math.min(1,(max[0]*loop.length-start)/width);
          return lo<=hi?[{chart,min:[lo,min[1]],max:[hi,max[1]]}]:[];
        }));
      });
    });
  }
  P.surfaceMasks = Object.freeze({compile,dirtyBounds,compileLoop,loopDirtyBounds});
})(KIT);
