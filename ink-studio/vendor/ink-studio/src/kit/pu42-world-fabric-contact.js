/* Indexed upper surfaces shared by traversal, traffic and rigid-body support. */
(function(K) {
  const W=K.world, {V}=K, {clamp}=W.fields;
  const epsilon=1e-7, zero=[0,0,0], prepared=new WeakMap();

  function geometry(surfaces) {
    if(prepared.has(surfaces))return prepared.get(surfaces);
    const triangles=W.spatial.create(), strands=W.spatial.create();
    for(const shape of Object.values(surfaces)){
      if(!shape.support)continue;
      shape.faces.forEach((nodes,face)=>{
        if(!nodes)return;
        const vertices=nodes.map(i=>shape.points[i]), [a,b,c]=vertices;
        const u=V.sub(b,a), v=V.sub(c,a), cross=V.cross(u,v);
        if(Math.abs(cross[1])<=epsilon)return;
        const normal=V.norm(cross[1]>0?cross:V.mul(cross,-1));
        if(normal[1]<.25)return;
        const lift=shape.radius/normal[1], min=a.map((_,i)=>Math.min(a[i],b[i],c[i])), max=a.map((_,i)=>Math.max(a[i],b[i],c[i]));
        min[1]+=lift;max[1]+=lift;
        triangles.set(shape.id+'/'+face,{min,max,rank:face,value:{shape,face,nodes,a,u,v,cross,normal,lift}});
      });
      if(shape.kind==='rope')for(const [link,nodes] of shape.strands){
        const [a,b]=nodes.map(i=>shape.points[i]), {radius}=shape;
        const min=a.map((n,i)=>Math.min(n,b[i])-radius), max=a.map((n,i)=>Math.max(n,b[i])+radius);
        strands.set(shape.id+'/'+link,{min,max,rank:link,value:{shape,link,nodes,a,b,radius}});
      }
    }
    const result={triangles,strands};
    prepared.set(surfaces,result);
    return result;
  }
  function weights(row,point) {
    const {a,u,v,cross}=row, x=point[0]-a[0], z=point[2]-a[2];
    const b=(v[0]*z-v[2]*x)/cross[1], c=(u[2]*x-u[0]*z)/cross[1], d=1-b-c;
    if(Math.min(b,c,d)<-epsilon)return null;
    const positive=[d,b,c].map(n=>Math.max(0,n)), total=positive.reduce((sum,n)=>sum+n,0);
    return positive.map(n=>n/total);
  }
  const seat=(row,point,weights)=>({shape:row.shape.id,entity:row.shape.entity,material:row.shape.material,
    ...(row.face!==undefined?{face:row.face}:{link:row.link}),nodes:row.nodes,weights,point});

  function columns(surfaces,x,z,low,high,exclude) {
    const result=[], {triangles,strands}=geometry(surfaces);
    const min=[x-epsilon,low-epsilon,z-epsilon], max=[x+epsilon,high+epsilon,z+epsilon];
    triangles.overlap(min,max,({value:row})=>{
      if(row.shape.id===exclude||row.shape.entity===exclude)return;
      const blend=weights(row,[x,0,z]);
      if(!blend)return;
      const y=row.a[1]+row.u[1]*blend[1]+row.v[1]*blend[2]+row.lift;
      if(y>=low&&y<=high)result.push({...seat(row,[x,y,z],blend),id:row.shape.id,y,normal:row.normal});
    });
    strands.overlap(min,max,({value:row})=>{
      if(row.shape.id===exclude||row.shape.entity===exclude)return;
      const {a,b,radius}=row, origin=[x,high,z];
      const hit=W.colliders.capsuleColumn(a,b,radius,origin,low);
      if(!hit||hit.normal[1]<.25)return;
      const direction=V.sub(b,a), length=V.dot(direction,direction);
      const t=length?clamp(V.dot(V.sub(hit.point,a),direction)/length,0,1):0;
      result.push({...seat(row,hit.point,[1-t,t]),id:row.shape.id,y:hit.point[1],normal:hit.normal});
    });
    return result.sort((a,b)=>b.y-a.y||a.id.localeCompare(b.id)||(a.face??a.link)-(b.face??b.link));
  }

  function sweep(surfaces,start,delta=zero,skin=0) {
    const end=V.add(start,delta), moving=skin===0;
    const min=start.map((n,i)=>Math.min(n,end[i])-epsilon), max=start.map((n,i)=>Math.max(n,end[i])+epsilon);
    max[1]+=skin;
    let best;
    geometry(surfaces).triangles.overlap(min,max,({value:row})=>{
      const gap=V.dot(row.normal,V.sub(start,row.a))-row.shape.radius, approach=-V.dot(row.normal,delta);
      if(moving?(approach<=epsilon||gap<-epsilon||gap>approach+epsilon):(gap>epsilon||gap<-skin*row.normal[1]))return;
      const time=moving?clamp(gap/approach,0,1):0, point=V.mad(start,delta,time), blend=weights(row,point);
      if(!blend)return;
      if(best&&(time>best.time||time===best.time&&(gap>best.gap||gap===best.gap&&
        (row.shape.id>best.shape||row.shape.id===best.shape&&row.face>best.face))))return;
      point[1]=row.a[1]+row.u[1]*blend[1]+row.v[1]*blend[2]+row.lift;
      best={...seat(row,point,blend),time,gap,normal:V.mul(row.normal,-1)};
    });
    return best;
  }

  W.fabricContact=Object.freeze({columns,sweep});
})(KIT);
