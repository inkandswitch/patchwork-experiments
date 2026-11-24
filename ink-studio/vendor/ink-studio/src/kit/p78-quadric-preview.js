/* Quadric-error edge collapse for indexed preview geometry. */
(function (K) {
  const P=K.procedural,G=P.geometry,V=K.V,
    EPS=1e-12,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    vector=p=>Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6),
    pair=(a,b)=>Math.min(a,b)+'/'+Math.max(a,b),
    triplet=ids=>ids.slice().sort((a,b)=>a-b).join('/');

  function plane(n,d) {
    const [x,y,z]=n;
    return [x*x,x*y,x*z,x*d,y*y,y*z,y*d,z*z,z*d,d*d];
  }
  function quadratic(q,[x,y,z]){
    return q[0]*x*x+q[4]*y*y+q[7]*z*z+q[9]+2*(q[1]*x*y+q[2]*x*z+q[5]*y*z+q[3]*x+q[6]*y+q[8]*z);
  }
  function stationary([a,b,c,u,d,e,v,f,w]){
    const A=d*f-e*e,B=c*e-b*f,C=b*e-c*d,D=a*f-c*c,E=b*c-a*e,F=a*d-b*b,
      det=a*A+b*B+c*C, scale=Math.max(a,d,f);
    if(Math.abs(det)<=1e-10*scale**3)return null;
    return [-(A*u+B*v+C*w)/det,-(B*u+D*v+E*w)/det,-(C*u+E*v+F*w)/det];
  }
  const normal=(points,a,b,c)=>V.cross(V.sub(points[b].p,points[a].p),V.sub(points[c].p,points[a].p));

  function simplifyQEM(source,{
    target, ratio=0.5, groups=source?.groupsByFace, locked=[], preserveBoundary=true, preserveSeams=true,
    maxError=Infinity, minNormal=0.08, maxPairs=1700000
  }={}){
    const verts=source?.points,tris=source?.triangles;
    if(!Array.isArray(verts)||verts.length>260000||!Array.from(verts).every(vector)||
      !Array.isArray(tris)||tris.length>500000||
      (groups!==undefined&&(!Array.isArray(groups)||groups.length!==tris.length))||
      !Array.isArray(locked)||locked.length>verts.length||!locked.every(i=>integer(i,0,verts.length-1))||
      typeof preserveBoundary!=='boolean'||typeof preserveSeams!=='boolean'||
      !Number.isFinite(ratio)||ratio<0||ratio>1||
      (target!==undefined&&!integer(target,0,tris.length))||
      (typeof maxError!=='number'||!(maxError>=0))||!Number.isFinite(minNormal)||minNormal<0||minNormal>=1||
      !integer(maxPairs,1,8000000)) throw new Error('QEM needs indexed triangles and bounded collapse controls');
    const goal=target??Math.floor(tris.length*ratio), center=verts.length ?
      V.mul(verts.reduce((p,q)=>V.add(p,q),[0,0,0]),1/verts.length) : [0,0,0],
      nodes=verts.map((p,id)=>({id,p:V.sub(p,center),q:new Float64Array(10),mass:0,faces:new Set(),version:0,parent:-1,locked:false})),
      faces=[], edges=new Map(), names=new Map(), originals=new Set(), work={pairs:0,collapsed:0,rejected:0,maxError:0};
    function group(raw) {
      const value=typeof raw==='string'?{material:raw}:P.data.clone(raw??{}),
        key=JSON.stringify([value.owner??'',value.surface??'',value.material??'default']);
      return {value,key};
    }
    for(const [id,ids] of tris.entries()){
      if(!Array.isArray(ids)||ids.length!==3||new Set(ids).size!==3||!ids.every(i=>integer(i,0,verts.length-1)))
        throw new Error('QEM triangles need distinct valid vertex indices');
      const tag=triplet(ids);
      if(originals.has(tag))throw new Error('QEM input triangles cannot be duplicates');
      originals.add(tag);
      const cross=normal(nodes,...ids), area=V.len(cross), data=group(groups?.[id]);
      if(area<EPS)throw new Error('QEM input triangles need nonzero area');
      const n=V.mul(cross,1/area), support=plane(n,-V.dot(n,nodes[ids[0]].p)),
        face={id,ids:ids.slice(),n,metadata:data.value,group:data.key,alive:true};
      faces.push(face);
      names.set(tag,id);
      for(const [j,vert] of ids.entries()){
        const node=nodes[vert], next=ids[(j+1)%3], key=pair(vert,next);
        node.faces.add(id);
        node.mass+=area;
        for(let k=0;k<10;k++)node.q[k]+=support[k]*area;
        if(!edges.has(key))edges.set(key,{a:vert,b:next,count:0});
        edges.get(key).count++;
      }
    }
    for(const i of locked)nodes[i].locked=true;
    if(preserveSeams)for(const node of nodes){
      if(new Set([...node.faces].map(id=>faces[id].group)).size>1)node.locked=true;
    }
    for(const {a,b,count} of edges.values())if(count>2||(count===1&&preserveBoundary)) {
      nodes[a].locked=true;
      nodes[b].locked=true;
    }
    const heap=new ProceduralHeap((a,b)=>a.error<b.error||
      (a.error===b.error&&(a.a<b.a||(a.a===b.a&&a.b<b.b))));
    let capped=false, active=faces.length;
    function addPair(a,b){
      if(a>b)[a,b]=[b,a];
      const A=nodes[a],B=nodes[b];
      if(A.parent>=0||B.parent>=0||A.locked||B.locked)return;
      if(work.pairs>=maxPairs){capped=true;return;}
      work.pairs++;
      const q=A.q.map((v,i)=>v+B.q[i]), mass=A.mass+B.mass,
        mid=V.mul(V.add(A.p,B.p),0.5), rest=stationary(q),
        range=Math.max(1e-9,V.dist(A.p,B.p)*2),
        candidates=rest&&rest.every(Number.isFinite)&&V.dist(rest,mid)<=range?[A.p,B.p,mid,rest]:[A.p,B.p,mid];
      let point,error=Infinity;
      for(const p of candidates){
        const e=Math.max(0,quadratic(q,p))/mass;
        if(e<error){error=e;point=p;}
      }
      if(error<=maxError*maxError)heap.push({a,b,av:A.version,bv:B.version,error,point,q,mass});
    }
    function neighbors(node){
      const output=new Set();
      for(const id of node.faces)for(const v of faces[id].ids)if(v!==node.id)output.add(v);
      return output;
    }
    function collapse(item){
      const a=nodes[item.a],b=nodes[item.b], aroundA=neighbors(a),aroundB=neighbors(b),
        incident=new Set([...a.faces,...b.faces]), removed=new Set([...a.faces].filter(id=>b.faces.has(id))),
        common=[...aroundA].filter(i=>aroundB.has(i)),
        link=new Set([...removed].flatMap(id=>faces[id].ids.filter(i=>i!==a.id&&i!==b.id)));
      if(!removed.size||removed.size>2||common.length!==link.size||common.some(i=>!link.has(i)))return false;
      const next=[], keys=new Set();
      for(const id of incident){
        if(removed.has(id))continue;
        const f=faces[id], ids=f.ids.map(i=>i===b.id?a.id:i), key=triplet(ids),
          old=names.get(key), [x,y,z]=ids.map(i=>i===a.id?item.point:nodes[i].p),
          cross=V.cross(V.sub(y,x),V.sub(z,x)), len=V.len(cross);
        if(keys.has(key)||(old!==undefined&&!incident.has(old))||len<EPS||V.dot(f.n,cross)<minNormal*len)return false;
        next.push({f,ids,n:V.mul(cross,1/len),key});
        keys.add(key);
      }
      for(const id of incident){
        const f=faces[id];
        for(const i of f.ids)nodes[i].faces.delete(id);
        names.delete(triplet(f.ids));
        if(removed.has(id))f.alive=false;
      }
      for(const {f,ids,n,key} of next){
        f.ids=ids;
        f.n=n;
        names.set(key,f.id);
        for(const i of ids)nodes[i].faces.add(f.id);
      }
      a.p=item.point;
      a.q=item.q;
      a.mass=item.mass;
      b.parent=a.id;
      active-=removed.size;
      work.collapsed++;
      work.maxError=Math.max(work.maxError,Math.sqrt(item.error));
      if(active<=goal)return true;
      const touched=new Set([a.id,...aroundA,...aroundB]), unique=new Set();
      for(const i of touched)nodes[i].version++;
      for(const i of touched){
        if(nodes[i].parent>=0)continue;
        for(const j of neighbors(nodes[i])){
          const key=pair(i,j);
          if(unique.has(key))continue;
          unique.add(key);
          addPair(i,j);
        }
      }
      return true;
    }
    if(active>goal)for(const {a,b} of edges.values())addPair(a,b);
    while(active>goal&&heap.size){
      const item=heap.pop(), a=nodes[item.a], b=nodes[item.b];
      if(a.parent>=0||b.parent>=0||a.version!==item.av||b.version!==item.bv)continue;
      if(!collapse(item))work.rejected++;
    }
    const points=[],normals=[],triangles=[],groupsByFace=[], ids=new Map();
    for(const n of nodes){
      if(n.parent>=0)continue;
      ids.set(n.id,points.length);
      points.push(V.add(n.p,center));
      const sum=[...n.faces].reduce((p,i)=>V.add(p,faces[i].n),[0,0,0]);
      normals.push(V.len(sum)>EPS?V.norm(sum):[0,1,0]);
    }
    for(const face of faces)if(face.alive){
      triangles.push(face.ids.map(i=>ids.get(i)));
      groupsByFace.push(face.metadata);
    }
    const pointMap=nodes.map(n=>{
      let id=n.id;
      while(nodes[id].parent>=0)id=nodes[id].parent;
      return ids.get(id);
    });
    const status=active<=goal?'ok':capped?'budget':'constrained';
    return P.data.freeze({status,points,normals,triangles,groupsByFace,pointMap,work,
      mesh(metadata){
        const builder=G.builder();
        for(const [i,face] of triangles.entries())builder.triangle(...face.map(j=>points[j]),
          {...groupsByFace[i],...metadata},undefined,face.map(j=>normals[j]));
        return builder.finish();
      }
    });
  }
  G.simplifyQEM=simplifyQEM;
})(KIT);
