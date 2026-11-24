/* A refittable bounds hierarchy for collision candidates and exact local queries. */
(function (K) {
  const W = K.world;
  const leafSize = 6;

  function overlaps(node, min, max) {
    return node.min[0] <= max[0] && node.max[0] >= min[0] &&
      node.min[1] <= max[1] && node.max[1] >= min[1] &&
      node.min[2] <= max[2] && node.max[2] >= min[2];
  }

  function lowerBound(node, point) {
    const x = Math.max(node.min[0] - point[0], point[0] - node.max[0]);
    const y = Math.max(node.min[1] - point[1], point[1] - node.max[1]);
    const z = Math.max(node.min[2] - point[2], point[2] - node.max[2]);
    const extent = Math.max(x, y, z);
    if (extent <= 0) return extent;
    return Math.hypot(Math.max(0, x), Math.max(0, y), Math.max(0, z));
  }

  function measure(node) {
    const {min, max} = node;
    const x = max[0] - min[0], y = max[1] - min[1], z = max[2] - min[2];
    return x*y + y*z + z*x;
  }

  function refit(node) {
    const rows = node.rows ?? node.children;
    let changed = false;
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity, max = -Infinity;
      for (const row of rows) {
        min = Math.min(min, row.min[axis]);
        max = Math.max(max, row.max[axis]);
      }
      changed ||= node.min[axis] !== min || node.max[axis] !== max;
      node.min[axis] = min;
      node.max[axis] = max;
    }
    return changed;
  }

  function create() {
    const entries = new Map(), pending = new Set();
    let root = null, needsBuild = true, quality = 0, energy = 0;
    const work = {builds:0, updates:0, refits:0};

    function branch(rows, parent) {
      const node = {parent, min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],rows};
      refit(node);
      if (rows.length <= leafSize) {
        for (const row of rows) row.leaf = node;
      } else {
        let axis = 0;
        for (let i=1; i<3; i++)
          if (node.max[i]-node.min[i] > node.max[axis]-node.min[axis]) axis=i;
        rows.sort((a,b) => a.min[axis]+a.max[axis]-(b.min[axis]+b.max[axis]) || a.rank-b.rank);
        const middle = rows.length >>> 1;
        node.children = [branch(rows.slice(0,middle),node),branch(rows.slice(middle),node)];
        node.rows = null;
      }
      node.weight = measure(node);
      energy += node.weight;
      return node;
    }

    function rebuild() {
      energy = 0;
      root = entries.size ? branch(Array.from(entries.values()),null) : null;
      quality = energy;
      needsBuild = false;
      pending.clear();
      work.builds++;
    }

    function set(id, {min,max,value,rank}) {
      const row = entries.get(id);
      if (!row) {
        entries.set(id,{id,min,max,value,rank,leaf:null});
        needsBuild = true;
        return;
      }
      row.value = value;
      row.rank = rank;
      if (row.min.every((n,i) => n===min[i] && row.max[i]===max[i])) return;
      row.min = min;
      row.max = max;
      if (row.leaf) pending.add(row.leaf);
      work.updates++;
    }

    function remove(id) {
      if (entries.delete(id)) needsBuild = true;
    }

    function prepare() {
      if (needsBuild) {
        rebuild();
        return;
      }
      while (pending.size) {
        const batch = [...pending];
        pending.clear();
        for (const node of batch) {
          work.refits++;
          if (refit(node)) {
            const weight = measure(node);
            energy += weight-node.weight;
            node.weight = weight;
            if (node.parent) pending.add(node.parent);
          }
        }
      }
      // Ratios compare the node overlap against the active scene's scale.
      // A crossing mover may degrade the tree without changing any dependencies.
      if (root && energy > quality*3 && entries.size > leafSize*4) rebuild();
    }

    function overlap(min, max, visit, scan = false) {
      if(scan){
        for(const row of entries.values())if(overlaps(row,min,max))visit(row);
        return;
      }
      prepare();
      if (!root) return;
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!overlaps(node,min,max)) continue;
        if (node.rows) {
          for (const row of node.rows) if (overlaps(row,min,max)) visit(row);
        } else {
          stack.push(node.children[1],node.children[0]);
        }
      }
    }

    function nearest(point, exact) {
      prepare();
      if (!root) return null;
      let value = Infinity, best;
      const stack = [[root,lowerBound(root,point)]];
      const rounding = Math.max(1,...point.map(Math.abs))*1e-12;
      const outside = bound => bound > value && bound - value > Math.abs(bound)*1e-8+rounding;
      // The caller supplies conservative bounds; the exact leaf distance is authoritative.
      while (stack.length) {
        const [node, bound] = stack.pop();
        if (outside(bound)) continue;
        if (node.rows) {
          for (const row of node.rows) {
            if (outside(lowerBound(row,point))) continue;
            const candidate = exact(row,point);
            if (candidate < value || best && candidate===value && row.rank<best.rank) {
              best=row;
              value=candidate;
            }
          }
        } else {
          const left=node.children[0], right=node.children[1];
          const a=lowerBound(left,point), b=lowerBound(right,point);
          if (a<=b) stack.push([right,b],[left,a]);
          else stack.push([left,a],[right,b]);
        }
      }
      return best ? {value,id:best.id} : null;
    }
    return Object.freeze({set,remove,overlap,nearest,work:()=>({...work})});
  }

  function grid(cell=4){
    const buckets=new Map(), rows=new Set(), outside=new Set();
    const key=(x,y,z)=>x+','+y+','+z, at=n=>Math.floor(n/cell);
    function cellOf(point){
      const [x,y,z]=point.map(at);
      return [x,y,z].every(Number.isSafeInteger)?key(x,y,z):null;
    }
    function insert(slot){
      if(slot.cell===null){outside.add(slot);return;}
      let members=buckets.get(slot.cell);
      if(!members)buckets.set(slot.cell,members=new Set());
      members.add(slot);
    }
    function detach(slot){
      if(slot.cell===null){outside.delete(slot);return;}
      const members=buckets.get(slot.cell);
      members.delete(slot);
      if(!members.size)buckets.delete(slot.cell);
    }
    function add(point,row){
      const slot={row,cell:cellOf(point)};
      rows.add(slot);
      insert(slot);
      return slot;
    }
    function move(slot,point){
      const cell=cellOf(point);
      if(cell===slot.cell)return;
      detach(slot);
      slot.cell=cell;
      insert(slot);
    }
    function remove(slot){
      if(rows.delete(slot))detach(slot);
    }
    function overlap(min,max,visit){
      const low=min.map(at), high=max.map(at);
      const count=low.reduce((n,v,i)=>n*(high[i]-v+1),1);
      if(!Number.isFinite(count)||count>Math.min(4096,Math.max(32,rows.size))||
        ![...low,...high].every(Number.isSafeInteger)){
        for(const {row} of rows)visit(row);
        return;
      }
      for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)
        for(const {row} of buckets.get(key(x,y,z))??[])visit(row);
      for(const {row} of outside)visit(row);
    }
    return {add,move,remove,overlap};
  }
  W.spatial = Object.freeze({create,grid});
})(KIT);
