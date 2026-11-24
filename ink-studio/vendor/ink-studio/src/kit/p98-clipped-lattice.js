/* Fitted bar families and optional edging on convex chart patches. */
(function(K) {
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-7;
  const finite=(p,n)=>Array.isArray(p)&&p.length===n&&Array.from(p).every(Number.isFinite);
  const dot=(p,q)=>p[0]*q[0]+p[1]*q[1];

  function strip(n,start,end,low,high) {
    const at=(x,y)=>[n[0]*x-n[1]*y,n[1]*x+n[0]*y];
    return [at(start,low),at(end,low),at(end,high),at(start,high)];
  }

  function clippedLattice({panels,runs,edges=[],edgeWidth=0,budget=1024}={}) {
    if(!Array.isArray(panels)||!panels.length||panels.length>128||
       !Array.isArray(runs)||runs.length>8||
       !Array.isArray(edges)||edges.length>128||
       !Number.isFinite(edgeWidth)||edgeWidth<0||
       !Number.isSafeInteger(budget)||budget<1||budget>8192)
      throw Error('Lattice needs bounded panels, runs, edging and budget');

    const keys=new Set();
    for(const panel of panels){
      if(typeof panel?.key!=='string'||!panel.key||keys.has(panel.key)||
         !Array.isArray(panel.polygon)||panel.polygon.length<3||panel.polygon.length>128||
         !Array.from(panel.polygon).every(p=>finite(p,2)))
        throw Error('Lattice panels need unique keys and finite chart polygons');
      keys.add(panel.key);
    }
    const points=panels.flatMap(p=>p.polygon),strips=[],members=new Map();
    const extent=n=>{
      let lo=Infinity,hi=-Infinity;
      for(const point of points){const v=dot(point,n);lo=Math.min(lo,v);hi=Math.max(hi,v);}
      return [lo,hi];
    };
    function add(key,role,polygon){
      if(strips.length>=budget)throw Error('Lattice exceeds its member budget');
      strips.push({key,polygon});
      members.set(key,{key,role,fragments:[]});
    }

    for(const [j,run] of runs.entries()){
      const {axis,pitch,width,phase=0}=run||{},length=finite(axis,2)?Math.hypot(...axis):0;
      if(length<EPS||!Number.isFinite(pitch)||!Number.isFinite(width)||width<=0||pitch<=width||
         !Number.isFinite(phase)||Math.abs(phase)>.5)
        throw Error('Lattice runs need a direction, positive pitch, narrower width and phase within half a pitch');
      const n=axis.map(v=>v/length),[lo,hi]=extent(n),[bottom,top]=extent([-n[1],n[0]]);
      const count=Math.max(1,Math.min(Math.round((hi-lo)/pitch),Math.floor((hi-lo)/width)));
      if(count>budget-strips.length)throw Error('Lattice exceeds its member budget');
      const step=(hi-lo)/count;
      for(let i=0;i<count;i++){
        const center=lo+(i+.5+phase)*step;
        add('run/'+j+'/'+i,'bar',strip(n,center-width/2,center+width/2,bottom,top));
      }
    }
    if(edgeWidth>0)for(const [i,edge] of edges.entries()){
      if(!Array.isArray(edge)||edge.length!==2||!edge.every(p=>finite(p,2)))
        throw Error('Lattice edges need two chart points');
      const [a,b]=edge,d=[b[0]-a[0],b[1]-a[1]],length=Math.hypot(...d);
      if(length<EPS)throw Error('Lattice edging needs nonzero segments');
      const n=[-d[1]/length,d[0]/length],t=[-n[1],n[0]],offset=dot(a,n);
      add('edge/'+i,'frame',strip(n,offset-edgeWidth/2,offset+edgeWidth/2,
        Math.min(dot(a,t),dot(b,t))-edgeWidth/2,Math.max(dot(a,t),dot(b,t))+edgeWidth/2));
    }

    let remaining=budget,checks=0;
    for(const panel of panels){
      checks+=panel.polygon.length*strips.length;
      if(checks>250000)throw Error('Lattice exceeds its clipping work budget');
      const clipped=P.surfaceCells.clip(strips,{boundary:panel.polygon,budget});
      for(const cell of clipped.cells)for(const polygon of cell.fragments){
        if(--remaining<0)throw Error('Lattice exceeds its fragment budget');
        members.get(cell.key).fragments.push({panel:panel.key,polygon});
      }
    }
    const layout=P.data.freeze([...members.values()].filter(part=>part.fragments.length));

    function pieces({map, direction, depth, key='lattice',...meta}={}){
      if(typeof map!=='function'||!finite(depth,2)||depth[1]-depth[0]<EPS)
        throw Error('Lattice solids need a planar chart map and increasing depths');
      const parts=[],axes=new Map();
      for(const member of layout)for(const [index,{panel,polygon}] of member.fragments.entries()){
        if(!axes.has(panel)){
          const axis=typeof direction==='function'?direction(panel):direction;
          if(!finite(axis,3)||V.len(axis)<EPS)throw Error('Lattice extrusion needs a finite nonzero direction');
          axes.set(panel,V.norm(axis));
        }
        const axis=axes.get(panel),base=polygon.map(p=>map(panel,p));
        if(!base.every(p=>finite(p,3)))throw Error('Lattice chart mapping needs finite 3D points');
        // Clipping can leave collinear edges. Remove those before building planar caps.
        const ring=base.filter((p,i)=>{
          const a=base[(i+base.length-1)%base.length],b=base[(i+1)%base.length];
          return V.len(V.cross(V.sub(p,a),V.sub(b,p)))>EPS;
        });
        const n=ring.length;
        if(n<3||Math.abs(V.dot(axis,V.cross(V.sub(ring[1],ring[0]),V.sub(ring[2],ring[0]))))<EPS)continue;
        const vertices=depth.flatMap(d=>ring.map(p=>V.mad(p,axis,d)));
        const faces=[ring.map((_,i)=>i),ring.map((_,i)=>i+n)];
        for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,j,j+n,i+n]);}
        const {frameMaterial,...info}=meta;
        parts.push(P.pieces.convex(vertices,faces,{...info,
          material:member.role==='frame'?frameMaterial??info.material??'default':info.material??'default',
          key:key+'/'+member.key+'/'+index,role:member.role,member:member.key,panel}));
      }
      return parts;
    }
    return Object.freeze({members:layout,pieces});
  }
  P.clippedLattice=clippedLattice;
})(KIT);
