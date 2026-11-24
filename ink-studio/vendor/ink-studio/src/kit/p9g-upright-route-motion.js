/* Reuse a fitted assembly only if its ordered guide moved as an upright rigid body. */
(function(K){
  const P=K.procedural||K.authoring,{M,V}=K;
  const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

  function uprightMotion(before,after,tolerance=1e-5){
    if(!Array.isArray(before)||!Array.isArray(after)||!before.length||before.length!==after.length||
       !Array.from(before).every(point)||!Array.from(after).every(point)||
       !Number.isFinite(tolerance)||tolerance<=0)throw Error('Upright motion needs paired 3D points and a positive tolerance');
    const a=before[0],b=after[0];
    let far=0,run=0;
    for(let i=1;i<before.length;i++){
      const distance=Math.hypot(before[i][0]-a[0],before[i][2]-a[2]);
      if(distance>run){run=distance;far=i;}
    }
    let cos=1,sin=0;
    if(run>tolerance){
      const ax=(before[far][0]-a[0])/run,az=(before[far][2]-a[2])/run,
        bx=after[far][0]-b[0],bz=after[far][2]-b[2],length=Math.hypot(bx,bz);
      if(length===0||Math.abs(length-run)>tolerance)return null;
      cos=(ax*bx+az*bz)/length;sin=(az*bx-ax*bz)/length;
    }
    const R=[cos,0,sin,0,1,0,-sin,0,cos],t=V.sub(b,M.app(R,a));
    return before.every((p,i)=>V.dist(V.add(M.app(R,p),t),after[i])<=tolerance)?{R,t}:null;
  }
  (P.routes||(P.routes={})).uprightMotion=uprightMotion;
})(KIT);
