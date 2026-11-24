/* Project a point onto bounded placement features while preserving their identity. */
(function(K){
  const P=K.procedural||K.authoring;
  const coordinate=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);

  function resolve(position,features,{tolerance=.2,axes=[0,1,2]}={}){
    if(!coordinate(position)||!Array.isArray(features)||!Number.isFinite(tolerance)||tolerance<0||
        !Array.isArray(axes)||!axes.length||new Set(axes).size!==axes.length||
        Array.from(axes).some(axis=>axis!==0&&axis!==1&&axis!==2))
      throw Error('Snapping needs a finite position, features, tolerance and distinct axes');

    let best=null;
    const ids=new Set();
    for(const feature of features){
      const {id,from,to,priority=0,tolerance:capture=tolerance}=feature||{};
      if(typeof id!=='string'||!id||ids.has(id)||!coordinate(from)||to!==undefined&&!coordinate(to)||
          !Number.isFinite(priority)||!Number.isFinite(capture)||capture<0)
        throw Error('Snap features need unique IDs, finite geometry and a nonnegative tolerance');
      ids.add(id);
      let projection=0,length2=0;
      if(to)for(const axis of axes){
        const delta=to[axis]-from[axis];
        projection+=(position[axis]-from[axis])*delta;
        length2+=delta*delta;
      }
      if(!Number.isFinite(projection)||!Number.isFinite(length2))
        throw Error('Snap geometry exceeds the coordinate range');
      const t=length2?Math.max(0,Math.min(1,projection/length2)):0,point=position.slice();
      for(const axis of axes)point[axis]=t?from[axis]+(to[axis]-from[axis])*t:from[axis];
      const distance=Math.hypot(...axes.map(axis=>position[axis]-point[axis]));
      if(distance>capture)continue;
      if(!best||priority>best.priority||priority===best.priority&&
          (distance<best.distance||distance===best.distance&&id<best.feature.id)){
        best={point,feature,distance,priority,t};
      }
    }
    return best;
  }

  P.snapping=Object.freeze({resolve});
})(KIT);
