/* Differential rest-length growth with bounded, element-aware separation. */
(function (K) {
  const P=K.procedural,V=K.V,{freeze,hash}=P.data, EPS=1e-10, MAX=1e6;
  const number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const point=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(n=>number(n,-MAX,MAX));
  const check=(ok,message)=>{if(!ok)throw new RangeError('Differential growth: '+message);};
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const key=(a,b)=>a<b?a+':'+b:b+':'+a;
  const square=p=>V.dot(p,p);

  function segmentPair(p,q,r,s) {
    const a=V.sub(q,p),b=V.sub(s,r),d=V.sub(p,r),aa=square(a),bb=square(b);
    const ab=V.dot(a,b),ad=V.dot(a,d),bd=V.dot(b,d),det=square(V.cross(a,b));
    let u=det>1e-14*aa*bb?clamp((ab*bd-bb*ad)/det):0;
    const v=bb?clamp((ab*u+bd)/bb):0;
    u=aa?clamp((ab*v-ad)/aa):0;
    return {u,v,delta:V.sub(V.mad(p,a,u),V.mad(r,b,v)),tangent:a,across:b};
  }

  function facePoint(p,a,b,c) {
    const ab=V.sub(b,a),ac=V.sub(c,a),d=V.sub(p,a),normal=V.cross(ab,ac);
    const aa=square(ab),cc=square(ac),cross=V.dot(ab,ac),det=square(normal);
    if(det>1e-14*aa*cc){
      const x=V.dot(d,ab),y=V.dot(d,ac);
      const u=(cc*x-cross*y)/det,v=(aa*y-cross*x)/det;
      if(u>=0&&v>=0&&u+v<=1)return {weights:[1-u-v,u,v],delta:V.sub(V.mad(d,ab,-u),V.mul(ac,v)),normal};
    }
    const vertices=[a,b,c];
    let nearest=Infinity,result;
    for(let i=0;i<3;i++){
      const j=(i+1)%3,h=V.sub(vertices[j],vertices[i]),length=square(h);
      const t=length?clamp(V.dot(V.sub(p,vertices[i]),h)/length):0;
      const delta=V.sub(p,V.mad(vertices[i],h,t)),dist=square(delta);
      if(dist>=nearest)continue;
      const weights=[0,0,0];weights[i]=1-t;weights[j]=t;
      result={weights,delta,normal};nearest=dist;
    }
    return result;
  }

  function topology(kind,n,closed,faces) {
    const edges=[],neighbors=Array.from({length:n},()=>new Set()),seen=new Map();
    function add(a,b){
      const k=key(a,b);
      if(seen.has(k))return;
      seen.set(k,edges.length);edges.push([a,b]);
      neighbors[a].add(b);neighbors[b].add(a);
    }
    if(kind==='curve')for(let i=0;i<n-Number(!closed);i++)add(i,(i+1)%n);
    else for(const [a,b,c] of faces){add(a,b);add(b,c);add(c,a);}
    return {edges,neighbors};
  }

  function create(kind,{points,triangles,closed=false,pins=[],plane,bounds,rate=.018,
    tether=0,smooth=.04,stiffness=.81,clearance=.10,iterations=4,splitLength,
    perturbation=0,seed=0,maxVertices=8192,maxWork=24000000}={}) {
    const curve=kind==='curve', names={xy:2,xz:1,yz:0};
    const locked=plane===undefined?-1:Object.hasOwn(names,plane)?names[plane]:-2;
    const validRate=r=>typeof r==='function'||number(r,0,.5);
    check(Array.isArray(points)&&integer(points.length,curve&&!closed?2:3,8192)&&Array.from(points).every(point)&&
      integer(maxVertices,points.length,24000)&&integer(maxWork,1,120000000)&&integer(iterations,1,24)&&
      typeof closed==='boolean'&&locked>=-1&&validRate(rate)&&number(clearance,0,1e4)&&
      [tether,smooth,stiffness].every(n=>number(n,0,1))&&number(perturbation,0,100)&&
      integer(seed,-0xffffffff,0xffffffff),'invalid geometry, rates, or relaxation controls');
    check(curve?triangles===undefined:!closed&&splitLength===undefined&&Array.isArray(triangles)&&
      integer(triangles.length,1,16000)&&Array.from(triangles).every(face=>Array.isArray(face)&&face.length===3&&
        Array.from(face).every(i=>integer(i,0,points.length-1))&&new Set(face).size===3),'invalid curve or shell topology');
    check(Array.isArray(pins)&&Array.from(pins).every(i=>integer(i,0,points.length-1))&&new Set(pins).size===pins.length&&
      (splitLength===undefined||number(splitLength,1e-5,1e4)),'invalid pins or split length');
    check(bounds===undefined||point(bounds?.min)&&point(bounds?.max)&&bounds.min.every((n,i)=>n<=bounds.max[i])&&
      points.every(p=>p.every((n,i)=>n>=bounds.min[i]&&n<=bounds.max[i])),'geometry must start within finite bounds');
    const axes=[0,1,2].filter(i=>i!==locked),planeAt=points[0][locked];
    check(locked<0||points.every(p=>p[locked]===planeAt),'planar points must share a fixed coordinate');
    const faces=freeze(curve?[]:triangles.map(f=>f.slice())), pinned=new Set(pins);
    if(!curve){
      const uses=new Map(),seen=new Set();
      for(const [a,b,c] of faces){
        const id=[a,b,c].sort((u,v)=>u-v).join(':');
        check(!seen.has(id)&&V.len(V.cross(V.sub(points[b],points[a]),V.sub(points[c],points[a])))>EPS,
          'shell triangles must be unique and nondegenerate');
        seen.add(id);
        for(const [u,v] of [[a,b],[b,c],[c,a]]){
          const label=key(u,v),prev=uses.get(label);
          check(prev===undefined||prev===v,'shell edges need at most two consistently wound faces');
          uses.set(label,prev===undefined?u:-1);
        }
      }
    }
    const box=bounds&&freeze({min:bounds.min.slice(),max:bounds.max.slice()});
    const anchors=points.map(p=>p.slice()),originalTopology=topology(kind,points.length,closed,faces);
    const lengths=originalTopology.edges.map(([a,b])=>V.dist(points[a],points[b]));
    check(lengths.every(n=>n>EPS),'rest edges must have positive length');
    const typical=lengths.slice().sort((a,b)=>a-b)[Math.floor(lengths.length/2)];
    const maxMove=Math.min(typical*.31,clearance?clearance*.29:Infinity),binSize=Math.max(1e-6,typical*1.45,clearance*1.25);
    const seedRandom=K.grow.dice(seed);
    const start={
      tick:0,nextId:points.length,ids:points.map((_,i)=>i),anchors,lengths,
      points:points.map((p,i)=>p.map((n,k)=>{
        const offset=perturbation&&!pinned.has(i)&&k!==locked?(2*seedRandom()-1)*perturbation:0;
        return box?clamp(n+offset,box.min[k],box.max[k]):n+offset;
      }))
    };
    check(start.points.every(point),'initial perturbation exceeds the coordinate range');
    const signature=hash(JSON.stringify([kind,closed,faces,pins,plane,box,points,seed,perturbation,clearance,tether,
      smooth,stiffness,iterations,splitLength,maxVertices,typeof rate==='number'?rate:null]));
    let state=start,busy=false,cached;

    function workBudget(){
      let checks=0;
      return count=>{checks+=count;check(checks<=maxWork,'step exceeds the geometry work budget');};
    }
    function bins(min,max,visit,spend) {
      const lo=min.map(n=>Math.floor(n/binSize)),hi=max.map(n=>Math.floor(n/binSize));
      spend((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1));
      for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)visit(x+':'+y+':'+z);
    }
    function extent(vertices,pad) {
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(const p of vertices)for(let k=0;k<3;k++){
        lo[k]=Math.min(lo[k],p[k]-pad);
        hi[k]=Math.max(hi[k],p[k]+pad);
      }
      return [lo,hi];
    }
    function constrain(p,k,move) {
      if(k===locked)return planeAt;
      const n=p[k]+move;
      const value=box?clamp(n,box.min[k],box.max[k]):n;
      check(number(value,-MAX,MAX),'geometry exceeded its coordinate range');
      return value;
    }

    function relax(next,graph,spend) {
      const points=next.points,{edges,neighbors}=graph,move=points.map(()=>[0,0,0]);
      const lockedVertex=next.ids.map(id=>pinned.has(id));
      const add=(i,v,g)=>{
        if(!lockedVertex[i])for(const k of axes)move[i][k]+=v[k]*g;
      };
      function apply(){
        for(let i=0;i<points.length;i++){
          if(lockedVertex[i])continue;
          const d=move[i],amount=Math.min(1,maxMove/Math.max(EPS,V.len(d)));
          for(const k of axes)points[i][k]=constrain(points[i],k,d[k]*amount);
          d.fill(0);
        }
      }
      function separate(){
        const edgeBins=new Map(),seen=new Set(),contacts=new Uint32Array(points.length);
        function push(ids,weights,delta,fallback){
          const distance=V.len(delta);
          if(distance>=clearance)return;
          const v=distance>EPS?delta:fallback;
          const axis=v.map((n,k)=>k===locked?0:n),len=V.len(axis);
          if(len<=EPS)return;
          let divisor=0;
          for(let i=0;i<ids.length;i++)if(!lockedVertex[ids[i]])divisor+=weights[i]**2;
          if(!divisor)return;
          const gain=.91*(clearance-distance)/(divisor*len);
          for(let i=0;i<ids.length;i++){
            if(!weights[i]||lockedVertex[ids[i]])continue;
            add(ids[i],axis,gain*weights[i]);contacts[ids[i]]++;
          }
        }
        for(let i=0;i<edges.length;i++){
          const [a,b]=edges[i],p=points[a],q=points[b];
          bins(...extent([p,q],clearance*.5),bucket=>{
            const entries=edgeBins.get(bucket);
            if(!entries){edgeBins.set(bucket,[i]);return;}
            spend(entries.length);
            for(const j of entries){
              const tag=i*edges.length+j;
              if(seen.has(tag))continue;
              seen.add(tag);
              const [c,d]=edges[j];
              if(a===c||a===d||b===c||b===d||neighbors[a].has(c)||neighbors[a].has(d)||
                neighbors[b].has(c)||neighbors[b].has(d))continue;
              const pair=segmentPair(p,q,points[c],points[d]);
              const distance=square(pair.delta);
              if(distance>=clearance*clearance)continue;
              let fallback;
              if(distance<EPS*EPS){
                fallback=V.cross(pair.tangent,pair.across);
                if(locked>=0||V.len(fallback)<EPS){
                  const guide=locked<0?V.perp(pair.tangent):[0,0,0];
                  if(locked>=0)guide[locked]=1;
                  fallback=locked<0?guide:V.cross(guide,pair.tangent);
                }
              }
              push([a,b,c,d],[1-pair.u,pair.u,pair.v-1,-pair.v],pair.delta,fallback);
            }
            entries.push(i);
          },spend);
        }
        if(!curve){
          const vertexBins=new Map();
          points.forEach((p,i)=>bins(p,p,k=>{
            const entries=vertexBins.get(k);
            if(entries)entries.push(i);
            else vertexBins.set(k,[i]);
          },spend));
          for(const [a,b,c] of faces){
            bins(...extent([points[a],points[b],points[c]],clearance),k=>{
              const entries=vertexBins.get(k);
              if(!entries)return;
              spend(entries.length);
              for(const i of entries){
                if(i===a||i===b||i===c||neighbors[i].has(a)||neighbors[i].has(b)||neighbors[i].has(c))continue;
                const c0=facePoint(points[i],points[a],points[b],points[c]);
                push([i,a,b,c],[1,...c0.weights.map(w=>-w)],c0.delta,c0.normal);
              }
            },spend);
          }
        }
        for(let i=0;i<points.length;i++)if(contacts[i]>1)for(const k of axes)move[i][k]/=contacts[i];
        apply();
      }
      spend((points.length+edges.length)*iterations);
      for(let step=0;step<iterations;step++){
        for(let i=0;i<edges.length;i++){
          const [a,b]=edges[i],delta=V.sub(points[b],points[a]),length=V.len(delta);
          if(length<EPS)continue;
          const gain=stiffness*(length-next.lengths[i])/length;
          add(a,delta,gain/(lockedVertex[b]?neighbors[a].size:neighbors[a].size+1));
          add(b,delta,-gain/(lockedVertex[a]?neighbors[b].size:neighbors[b].size+1));
        }
        for(let i=0;i<points.length;i++){
          if(lockedVertex[i])continue;
          if(tether)add(i,V.sub(next.anchors[i],points[i]),tether);
          if(smooth&&neighbors[i].size){
            const center=[0,0,0];
            for(const j of neighbors[i])for(const k of axes)center[k]+=points[j][k]/neighbors[i].size;
            add(i,V.sub(center,points[i]),smooth);
          }
        }
        apply();
        if(clearance)separate();
      }
    }

    function split(next){
      if(!splitLength||next.ids.length>=maxVertices)return;
      const {points,anchors,lengths,ids}=next,added={points:[],anchors:[],lengths:[],ids:[]};
      let room=maxVertices-ids.length;
      for(let i=0;i<points.length;i++){
        added.points.push(points[i]);added.anchors.push(anchors[i]);added.ids.push(ids[i]);
        if(i>=lengths.length)continue;
        const j=(i+1)%points.length;
        if(room&&V.dist(points[i],points[j])>splitLength){
          added.points.push(V.lerp(points[i],points[j],.5));
          added.anchors.push(V.lerp(anchors[i],anchors[j],.5));
          added.ids.push(next.nextId++);added.lengths.push(lengths[i]/2,lengths[i]/2);room--;
        }else added.lengths.push(lengths[i]);
      }
      Object.assign(next,added);
    }

    function step(count=1,{rate:rule=rate}={}) {
      check(!busy&&integer(count,1,2048)&&integer(state.tick+count,1,1e6)&&validRate(rule),
        'invalid step or reentrant solve');
      const next={...state,points:state.points.map(p=>p.slice()),lengths:state.lengths.slice()};
      const spend=workBudget();busy=true;
      try{
        for(let j=0;j<count;j++){
          const graph=topology(kind,next.points.length,closed,faces);
          spend(graph.edges.length);
          for(let i=0;i<graph.edges.length;i++){
            const [a,b]=graph.edges[i];
            const n=typeof rule==='function'?rule(Object.freeze({tick:next.tick,edge:Object.freeze([next.ids[a],next.ids[b]]),
              at:Object.freeze(V.lerp(next.points[a],next.points[b],.5)),rest:Object.freeze(V.lerp(next.anchors[a],next.anchors[b],.5)),
              length:next.lengths[i]})):rule;
            check(number(n,0,.5),'growth rate must be between zero and .5 per tick');
            const length=next.lengths[i]*(1+n);
            check(number(length,EPS,MAX),'grown rest length exceeds range');
            next.lengths[i]=length;
          }
          relax(next,graph,spend);
          if(curve)split(next);
          next.tick++;
        }
      }finally{busy=false;}
      state=next;cached=undefined;return state.tick;
    }
    function frame(){
      if(cached)return cached;
      const points=freeze(state.points.map(p=>p.slice())),ids=freeze(state.ids.slice());
      const {edges}=topology(kind,ids.length,closed,faces);
      cached=Object.freeze({kind,tick:state.tick,closed,points,ids,edges:freeze(edges),triangles:faces,
        restLengths:freeze(state.lengths.slice()),anchors:freeze(state.anchors.map(p=>p.slice())),
        mesh(){
          check(!curve,'only a shell has a triangle mesh');
          return K.mesh.make(points.flat(),faces.flat());
        }});
      return cached;
    }
    function checkpoint(){
      return {format:'ink-studio/differential-growth',signature,tick:state.tick,nextId:state.nextId,ids:state.ids.slice(),
        points:state.points.map(p=>p.slice()),anchors:state.anchors.map(p=>p.slice()),lengths:state.lengths.slice()};
    }
    function restore(saved){
      const n=saved?.ids?.length;
      check(!busy&&saved?.format==='ink-studio/differential-growth'&&saved.signature===signature&&
        integer(saved.tick,0,1e6)&&integer(n,start.ids.length,maxVertices)&&
        saved.nextId===n&&Array.isArray(saved.ids)&&new Set(saved.ids).size===n&&
        Array.from(saved.ids).every(id=>integer(id,0,n-1))&&
        saved.ids.filter(id=>id<start.ids.length).every((id,i)=>id===i)&&
        (curve&&splitLength||n===start.ids.length)&&[saved.points,saved.anchors].every(rows=>Array.isArray(rows)&&rows.length===n&&
          Array.from(rows).every(p=>point(p)&&(locked<0||p[locked]===planeAt)&&
            (!box||p.every((v,k)=>v>=box.min[k]&&v<=box.max[k]))))&&Array.isArray(saved.lengths)&&
          saved.lengths.length===(curve?n-Number(!closed):originalTopology.edges.length)&&
          Array.from(saved.lengths).every(n=>number(n,EPS,MAX))&&[...pinned].every(id=>{
            const i=saved.ids.indexOf(id);return saved.points[i].every((v,k)=>v===start.points[id][k]);
          }), 'incompatible or invalid checkpoint');
      state={tick:saved.tick,nextId:saved.nextId,ids:saved.ids.slice(),points:saved.points.map(p=>p.slice()),
        anchors:saved.anchors.map(p=>p.slice()),lengths:saved.lengths.slice()};
      cached=undefined;
    }
    return Object.freeze({step,frame,checkpoint,restore,get tick(){return state.tick;},reset(){
      check(!busy,'cannot reset during a growth step');state=start;cached=undefined;
    }});
  }
  P.growth.differential=Object.freeze({curve:options=>create('curve',options),shell:options=>create('shell',options)});
})(KIT);
