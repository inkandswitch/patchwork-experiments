/* Closed fitted bands on paired world-space rails. */
(function(K) {
  const P=K.procedural||K.authoring,{V}=K;
  const EPS=1e-7;
  const vector=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  function checkProfile(profile){
    if(!Array.isArray(profile)||profile.length<3||profile.length>12||
       !Array.from(profile).every(p=>Array.isArray(p)&&p.length===2&&
         Array.from(p).every(Number.isFinite)&&p[0]>=0&&p[0]<=1))
      throw new Error('Rail profile needs 3 to 12 finite [fraction, depth] points');
    let orientation;
    for(const [i,a] of profile.entries()){
      const b=profile[(i+1)%profile.length];
      for(const [j,p] of profile.entries()){
        if(j===i||j===(i+1)%profile.length)continue;
        const turn=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
        orientation??=Math.sign(turn);
        if(!Number.isFinite(turn)||Math.abs(turn)<=EPS||Math.sign(turn)!==orientation)
          throw new Error('Rail profile must be a strictly convex outline in boundary order');
      }
    }
  }

  function profileLoft([a,b,c,d],axis,profile,meta){
    const rings=[[a,d],[b,c]],n=profile.length;
    const vertices=rings.flatMap(([inner,outer])=>{
      const side=V.sub(outer,inner);
      return profile.map(([u,h])=>V.mad(V.mad(inner,side,u),axis,h));
    });
    const faces=[],seen=new Set();
    function face(i,j,k){
      const origin=vertices[i],edge=V.sub(vertices[j],origin),
        cross=V.cross(edge,V.sub(vertices[k],origin)),length=V.len(cross);
      if(length<=EPS)return;
      const normal=V.mul(cross,1/length),points=[];
      let above=false,below=false;
      for(const [index,p] of vertices.entries()){
        const depth=V.dot(normal,V.sub(p,origin));
        if(depth>EPS)above=true;
        else if(depth< -EPS)below=true;
        else points.push(index);
        if(above&&below)return;
      }
      const key=points.join('/');
      if(seen.has(key))return;
      seen.add(key);
      const center=V.mul(points.reduce((sum,index)=>V.add(sum,vertices[index]),[0,0,0]),1/points.length),
        u=V.norm(edge),v=V.cross(normal,u);
      const angle=index=>{const p=V.sub(vertices[index],center);return Math.atan2(V.dot(p,v),V.dot(p,u));};
      faces.push(points.sort((a,b)=>angle(a)-angle(b)));
    }
    // Each non-cap hull face contains an edge of one end ring and at least
    // one vertex of the other. This covers twisted sides without triangulating
    // a nonplanar quad or adding vertices at the shared rail station.
    for(const [start,other] of [[0,n],[n,0]]){
      face(start,start+1,start+2);
      for(let i=0;i<n;i++)for(let j=0;j<n;j++)face(start+i,start+(i+1)%n,other+j);
    }
    return P.pieces.convex(vertices,faces,meta);
  }

  function fittedRailBand(spec={}) {
    const {inner,outer,pitch,gap=0,closed=false,phase=0,sections,measure,depth,profile,direction,cellStyle,budget=1024}=spec;
    const validDepth=range=>Array.isArray(range)&&range.length===2&&range.every(Number.isFinite)&&range[1]-range[0]>=EPS;
    if(profile===undefined&&!validDepth(depth)||cellStyle!==undefined&&typeof cellStyle!=='function'||
       typeof direction!=='function'||!Array.isArray(inner)||!Array.isArray(outer)||
       !Array.from(inner).every(vector)||!Array.from(outer).every(vector))
      throw new Error('Fitted rail bands need paired 3D rails, a direction sampler and increasing depths or a profile');
    if(profile!==undefined)checkProfile(profile);
    const outline=profile?.map(point=>point.slice());
    const layout=P.fittedRibbon({inner,outer,pitch,gap,closed,phase,sections,measure,budget});
    const triangleFaces=[[0,1,2],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]];
    const quadFaces=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    return Object.freeze({layout,pieces(meta={}) {
      const parts=[];
      for(const cell of layout.cells){
        const treatment=cellStyle?.(cell), range=treatment?.depth??depth, material=treatment?.material;
        const shape=treatment?.profile!==undefined?treatment.profile:treatment?.depth===undefined?outline:undefined;
        if(treatment?.profile!==undefined)checkProfile(shape);
        if(!shape&&!validDepth(range)||material!==undefined&&(typeof material!=='string'||!material))
          throw new Error('Fitted band cell treatment needs valid depths and material');
        const attributes={...meta,...(material!==undefined&&{material}),
          ...(cell.section!==undefined&&{section:cell.section}),cell:cell.key};
        for(const [index,part] of cell.fragments.entries()){
          const q=part.points,center=V.mul(q.reduce((sum,p)=>V.add(sum,p),[0,0,0]),.25);
          const axis=direction(center,part,cell);
          if(!vector(axis)||V.len(axis)<EPS)throw new Error('Fitted band direction must be a finite nonzero vector');
          const n=V.norm(axis);
          const key=`${meta.key??'band'}/${cell.key}/${index}`;
          if(shape){
            if(parts.length===budget)throw new Error('Fitted ribbon exceeds its profile piece budget');
            parts.push(profileLoft(q,n,shape,{...attributes,fragment:index,side:0,key:key+'/0'}));
            continue;
          }
          const [lo,hi]=range;
          const normal=V.cross(V.sub(q[1],q[0]),V.sub(q[2],q[0]));
          const planar=V.len(normal)>EPS&&Math.abs(V.dot(V.norm(normal),V.sub(q[3],q[0])))<EPS;
          const convex=planar&&q.every((p,i)=>{
            const a=q[(i+1)%4],b=q[(i+2)%4];
            return V.dot(V.cross(V.sub(a,p),V.sub(b,a)),V.norm(normal))>EPS;
          });
          const sections=convex?[q]:[[q[0],q[1],q[2]],[q[0],q[2],q[3]]];
          for(const [side,section] of sections.entries()){
            const normal=V.cross(V.sub(section[1],section[0]),V.sub(section[2],section[0]));
            if(Math.abs(V.dot(normal,n))<=EPS)continue;
            const vertices=[lo,hi].flatMap(h=>section.map(p=>V.mad(p,n,h)));
            const faces=convex?quadFaces:triangleFaces;
            parts.push(P.pieces.convex(vertices,faces,{...attributes,fragment:index,side,key:key+'/'+side}));
          }
        }
      }
      return parts;
    }});
  }
  P.fittedRailBand=fittedRailBand;
})(KIT);
