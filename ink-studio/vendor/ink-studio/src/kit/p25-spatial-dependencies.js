/* Spatial read/write declarations and causal reports for staged rebuilds. */
(function (K) {
  const P = K.procedural, {clone,freeze} = P.data;
  const axes = ['x','y','z','xy','xz','yz','xyz'];
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 192;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const limit = 32768;

  function bounds(value) {
    if (value == null) return null;
    const {axes:space = 'xyz',min,max} = value;
    if (!axes.includes(space) || ![min,max].every(v => Array.isArray(v) && v.length === space.length &&
        Array.from(v).every(Number.isFinite)) || min.some((n,i) => n > max[i]))
      throw new TypeError('Spatial dependencies need finite ordered bounds and coordinate axes');
    return freeze({axes:space,min:min.slice(),max:max.slice()});
  }
  function overlaps(a,b,padding = 0) {
    return !a || !b || a.min.every((n,index) => {
      const other = b.axes.indexOf(a.axes[index]);
      return other < 0 || n - padding <= b.max[other] && a.max[index] + padding >= b.min[other];
    });
  }
  function contains(a,b) {
    return !a || b && a.min.every((n,index) => {
      const other = b.axes.indexOf(a.axes[index]);
      return other >= 0 && n <= b.min[other] && a.max[index] >= b.max[other];
    });
  }

  function create(definitions = {}, {relays=[]} = {}) {
    if (!record(definitions) || Object.keys(definitions).length > limit)
      throw new TypeError('Expected a bounded spatial dependency registry');
    const declarations = new Map();
    for (const [id,spec] of Object.entries(definitions).sort(([a],[b])=>a<b?-1:a>b?1:0)) {
      if (!name(id) || !record(spec)) throw new TypeError('Invalid spatial dependency declaration');
      const access = direction => {
        const list = spec[direction] ?? [];
        if (!Array.isArray(list) || list.length > 512) throw new TypeError('Expected a bounded list of spatial '+direction);
        return Array.from(list, raw => {
          const {field,bounds:domain,padding=0} = typeof raw === 'string' ? {field:raw} : raw ?? {};
          if (!name(field) || !Number.isFinite(padding) || padding < 0 || direction === 'writes' && padding)
            throw new TypeError('Invalid spatial '+direction+' declaration for '+id);
          return {field,bounds:bounds(domain),...(padding && {padding})};
        });
      };
      declarations.set(id,freeze({id,reads:access('reads'),writes:access('writes')}));
    }
    const describe = freeze([...declarations.values()]);
    const downstream=new Map();
    for (const link of relays) {
      if (!downstream.has(link.from)) downstream.set(link.from,[]);
      downstream.get(link.from).push(link);
    }

    // Validate and snapshot a write before publishing it to consumers.
    function write(writer,field,domain,reason) {
      const area = bounds(domain);
      if (!declarations.get(writer)?.writes.some(row=>row.field === field && contains(row.bounds,area)) ||
          !name(reason)) throw new TypeError('Undeclared spatial write '+writer+' -> '+field);
      return freeze({writer,field,bounds:area,reason});
    }

    function begin(pending = [], {propagate=true} = {}) {
      const changes = [], byField = new Map(), work = [];
      function append(row,because = []) {
        if (changes.length >= limit || !Array.isArray(because) || because.some(n => !Number.isSafeInteger(n) ||
            n < 1 || n > changes.length)) throw new RangeError('Invalid spatial dependency cause or write budget');
        const change = freeze({id:changes.length+1,...row,...(because.length && {because:[...new Set(because)]})});
        changes.push(change);
        if (!byField.has(change.field)) byField.set(change.field,[]);
        byField.get(change.field).push(change);
        return change;
      }
      function publish(row,because) {
        const root=append(row,because);
        if (!propagate||!downstream.has(root.field)) return root;
        const queue=[root];
        for (let i=0;i<queue.length;i++) {
          const change=queue[i];
          for (const {area,writer,to} of downstream.get(change.field)??[]) {
            const bounds=area(change.bounds);
            if (bounds!==undefined) queue.push(append(write(writer,to,bounds,'coupled-field'),[change.id]));
          }
        }
        return root;
      }
      for (const row of pending) publish(write(row.writer,row.field,row.bounds,row.reason));
      function affected(id,area) {
        const local = bounds(area), reasons = new Map();
        for (const read of declarations.get(id)?.reads ?? []) for (const change of byField.get(read.field) ?? []) {
          if ((!change.deliveredTo || change.deliveredTo===id) &&
              overlaps(read.bounds,local) && overlaps(read.bounds,change.bounds,read.padding) &&
              overlaps(local,change.bounds,read.padding))
            reasons.set(change.id,change);
        }
        return [...reasons.values()].sort((a,b)=>a.id-b.id);
      }
      function recordWork(id,kind,detail,area) {
        if (!declarations.has(id) || !name(kind) || !record(detail) || work.length >= limit)
          throw new TypeError('Invalid spatial rebuild record');
        work.push(freeze({system:id,kind,detail:clone(detail),because:affected(id,area).map(row=>row.id)}));
      }
      function report() {
        return freeze({changes:changes.slice(),affected:!changes.length?[]:describe.flatMap(({id})=>{
          const because = affected(id).map(row=>row.id);
          return because.length ? [{system:id,because}] : [];
        }),work:work.slice()});
      }
      function deliver(row,reader) {
        if (!declarations.has(reader)) throw new TypeError('Unknown spatial reader '+reader);
        return append({...write(row.writer,row.field,row.bounds,row.reason),deliveredTo:reader});
      }
      return Object.freeze({change:(id,field,domain,reason,because)=>publish(write(id,field,domain,reason),because),
        affected,recordWork,report,deliver});
    }
    return Object.freeze({describe,write,begin});
  }
  P.spatialDependencies = Object.freeze({create,overlaps,limit});
})(KIT);
