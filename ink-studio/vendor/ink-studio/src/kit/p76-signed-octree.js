/* Balanced adaptive sampling of bounded signed fields. */
(function (K) {
  const P = K.procedural, G = P.geometry, H = G.hermite, V = K.V,
    safe = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max,
    offsets = [-1,0,1].flatMap(x=>[-1,0,1].flatMap(y=>[-1,0,1].map(z=>[x,y,z]))).filter(a=>a.some(Boolean));
  function connected(bits) {
    let reached = bits & -bits;
    for (;;) {
      let next = reached;
      for (const {from,to} of H.edges) {
        const a = 1 << from, b = 1 << to;
        if ((bits & a) && (bits & b) && (reached & (a|b))) next |= a|b;
      }
      if (next === reached) return reached === bits;
      reached = next;
    }
  }

  function octree(field, rawBounds, {
    minDepth = 2, maxDepth = 7, tolerance = 0.027, variation = 0.23, lipschitz = 1,
    iso = 0, normal, surfaceDepth, refine = 1, maxNodes = 190000, maxSamples = 6500000, maxBalance = 4800000
  } = {}) {
    const bounds = P.spatial.bounds(rawBounds), size = bounds.max.map((v,i)=>v-bounds.min[i]);
    if (typeof field !== 'function' || !size.every(v=>finite(v,1e-6,2e6)) ||
      !safe(maxDepth,1,9) || !safe(minDepth,0,maxDepth) || !finite(tolerance,0,1e6) ||
      !finite(variation,0,2) || !finite(lipschitz,0,1e6) || !Number.isFinite(iso) ||
      (normal!==undefined&&typeof normal!=='function') || (surfaceDepth!==undefined&&typeof surfaceDepth!=='function') ||
      !safe(refine,0,8) || !safe(maxNodes,9,520000) || !safe(maxSamples,1,16000000) ||
      !safe(maxBalance,1,20000000))
      throw new Error('Signed octrees need a bounded field, depth and refinement controls');
    const edge = 1 << maxDepth, spacing = size.map(v=>v/edge), quantum = Math.min(...spacing),
      lattice = 2*edge+1, cache = new Map(),
      work = { nodes:0, samples:0, balance:0, splits:0 },
      world = cell=>cell.map((v,i)=>v===edge ? bounds.max[i] : bounds.min[i]+v*spacing[i]),
      key = ([x,y,z])=>Math.round(2*x)+lattice*(Math.round(2*y)+lattice*Math.round(2*z));
    function evaluate(x,y,z) {
      if(work.samples>=maxSamples) throw new Error('Signed octree exceeds its field sample budget');
      work.samples++;
      const value=field(x,y,z)-iso;
      if(!Number.isFinite(value)) throw new Error('Signed octree field must be finite');
      return value;
    }
    function sample(p) {
      const i=key(p);
      if(!cache.has(i)){
        const value=evaluate(...world(p));
        cache.set(i,Math.abs(value)<=1e-12*quantum ? 0 : value);
      }
      return cache.get(i);
    }
    function subdivide(node) {
      const width=node.width/2;
      node.children=H.corners.map((unit,i)=>build(node.origin.map((v,k)=>v+unit[k]*width),width,
        node.depth+1,node.key+'/'+i));
    }
    function build(origin,width,depth,path) {
      if(work.nodes>=maxNodes) throw new Error('Signed octree exceeds its node budget');
      work.nodes++;
      const corners=H.corners.map(unit=>origin.map((v,i)=>v+unit[i]*width)),
        values=corners.map(sample), bits=values.reduce((m,d,i)=>d<0 ? m|(1<<i) : m,0),
        center=origin.map(v=>v+width/2), centerValue=sample(center),
        uniform=bits===0||bits===255, node={origin,width,depth,key:path,values,bits,centerValue};
      if(depth===maxDepth) return node;
      const radius=Math.hypot(...spacing)*width/2;
      if(uniform && lipschitz && Math.abs(centerValue)>lipschitz*radius && (centerValue<0)===(bits===255))
        return node;
      const requested=surfaceDepth ? surfaceDepth(world(center),{depth,width,bits}) : minDepth;
      if(!safe(requested,0,maxDepth)) throw new Error('Octree control must request an integer depth within the domain');
      if(uniform || depth<Math.max(minDepth,requested) || !connected(bits) || !connected(bits^255)){
        subdivide(node);
        return node;
      }
      const hits=H.edges.flatMap(({from,to,axis})=>{
        const a=values[from],b=values[to];
        if((a<0)===(b<0)) return [];
        return [H.crossing(evaluate,world(corners[from]),world(corners[to]),a,b,
          {bounds,epsilon:quantum*0.08,normal,refine,axis})];
      }), box={min:world(corners[0]),max:world(corners[7])}, fit=H.fit(hits,box,'dualContour');
      const turn=hits.some((a,i)=>hits.slice(i+1).some(b=>1-V.dot(a.n,b.n)>variation));
      // A true signed field lets a fitted point estimate subcell surface error in world units.
      if(turn || fit.error>tolerance || Math.abs(evaluate(...fit.point))>tolerance) subdivide(node);
      return node;
    }
    const root=build([0,0,0],edge,0,'root');
    function find(x,y,z) {
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||x<0||y<0||z<0||x>=edge||y>=edge||z>=edge) return null;
      let node=root;
      while(node.children){
        const h=node.width/2,
          i=Number(x>=node.origin[0]+h)+2*Number(y>=node.origin[1]+h)+4*Number(z>=node.origin[2]+h);
        node=node.children[i];
      }
      return node;
    }
    function gather() {
      const leaves=[], pending=[root];
      for(let i=0;i<pending.length;i++){
        const node=pending[i];
        if(node.children) pending.push(...node.children);
        else leaves.push(node);
      }
      return leaves;
    }
    let leaves=gather();
    for(;;){
      const split=new Set();
      for(const leaf of leaves){
        if(leaf.depth<3) continue;
        for(const offset of offsets){
          if(work.balance>=maxBalance) throw new Error('Signed octree exceeds its balancing budget');
          work.balance++;
          const probe=leaf.origin.map((v,i)=>v+(offset[i]<0?-0.25:offset[i]>0?leaf.width+0.25:leaf.width/2)),
            other=find(...probe);
          if(other && leaf.depth>other.depth+1) split.add(other);
        }
      }
      if(!split.size) break;
      for(const coarse of split){
        subdivide(coarse);
        work.splits++;
      }
      leaves=gather();
    }
    const fractional = q=>q.map((v,i)=>(v-bounds.min[i])/spacing[i]),
      lookup=(x,y,z)=>find(...fractional([x,y,z]));
    function at(x,y,z) {
      const p=fractional([x,y,z]), q=p.map(v=>v===edge ? v-1e-9 : v), node=find(...q);
      if(!node) return null;
      const u=q.map((v,i)=>(v-node.origin[i])/node.width);
      return node.values.reduce((sum,v,i)=>sum+v*H.corners[i].reduce((w,side,k)=>w*(side?u[k]:1-u[k]),1),0)+iso;
    }
    return P.data.freeze({bounds,edge,spacing,root,leaves,work,lookup,at,
      grid:{ find, world, zero:quantum*1e-12, field, iso, normal, refine }});
  }
  G.octree=octree;
})(KIT);
