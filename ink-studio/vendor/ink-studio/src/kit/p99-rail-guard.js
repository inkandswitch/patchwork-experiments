/* Reusable solid rails and upright posts on a piecewise-linear run. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-6;
  const vector=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);

  function railGuard({path,up=[0,1,0],height=.64,thickness=.072,postWidth=.085,postSpacing=.42,
    levels=[.38,1],maxPieces=2048}={},meta={}){
    if(!Array.isArray(path)||path.length<2||!Array.from(path).every(vector)||
        !vector(up)||V.len(up)<EPS||![height,thickness,postWidth,postSpacing].every(n=>Number.isFinite(n)&&n>EPS)||
        !Array.isArray(levels)||!levels.length||levels.length>8||
        !Array.from(levels).every((n,i)=>Number.isFinite(n)&&n>0&&n<=1&&(!i||n>levels[i-1]))||
        !Number.isSafeInteger(maxPieces)||maxPieces<1||maxPieces>8192)
      throw Error('A rail guard needs a path, positive dimensions and ordered rail levels');
    const points=[];
    for(const point of path){
      const last=points.at(-1);
      if(last&&V.dist(last,point)<EPS)continue;
      const prior=points.at(-2);
      if(prior&&V.dot(V.norm(V.sub(last,prior)),V.norm(V.sub(point,last)))>1-EPS)points.pop();
      points.push(point);
    }
    if(points.length<2)throw Error('A rail guard needs a nonzero run');
    const segments=points.slice(1).map((b,i)=>{
      const a=points[i],length=V.dist(a,b);
      return {a,b,count:Math.ceil(length/postSpacing)};
    });
    const open=V.dist(points[0],points.at(-1))>=EPS;
    const count=segments.reduce((sum,segment)=>sum+levels.length+segment.count,Number(open));
    if(count>maxPieces)throw Error('Rail guard exceeds its piece budget');
    const axis=V.norm(up),pieces=[],base=meta.key||'guard';
    const lift=(point,h)=>V.mad(point,axis,h);
    const beam=(a,b,width,key)=>P.pieces.beam(a,b,width,width,{...meta,key:base+'/'+key});
    for(const [i,{a,b,count}] of segments.entries()){
      for(const [j,level] of levels.entries())
        pieces.push(beam(lift(a,height*level),lift(b,height*level),thickness,'bar/'+i+'/'+j));
      for(let j=0;j<count;j++){
        const base=V.mad(a,V.sub(b,a),j/count);
        pieces.push(beam(base,lift(base,height+thickness/2),postWidth,'post/'+i+'/'+j));
      }
    }
    if(open){
      const end=points.at(-1);
      pieces.push(beam(end,lift(end,height+thickness/2),postWidth,'post/end'));
    }
    return pieces;
  }

  P.railGuard=railGuard;
})(KIT);
