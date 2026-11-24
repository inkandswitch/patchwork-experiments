/* Distance-based poses for cameras and moving assemblies on sampled routes. */
(function (K) {
  const P=K.procedural||K.authoring, {V}=K;
  const finitePoint=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  const unit=p=>finitePoint(p)&&Number.isFinite(V.len(p))&&V.len(p)>1e-8;

  function follower(route,{loop=false,lookAhead=.8,up=[0,1,0]}={}){
    const length=route?.length;
    if(!Number.isFinite(length)||length<=1e-7||typeof route.sample!=='function'||
      typeof loop!=='boolean'||!Number.isFinite(lookAhead)||lookAhead<=0||!unit(up))
      throw Error('A route follower needs a sampled route, positive look ahead and a nonzero up direction');
    const canonicalUp=V.norm(up);
    function at(t){
      const frame=route.sample(t);
      if(!finitePoint(frame?.point))throw Error('Route samples need finite points');
      return frame;
    }
    const first=at(0),last=at(1);
    if(loop&&V.dist(first.point,last.point)>1e-5)
      throw Error('A repeating route needs coincident endpoints');

    const along=d=>loop?(d%length+length)%length:Math.max(0,Math.min(length,d));
    const look=Math.min(lookAhead,length*.24);
    function sample(distance,direction=1){
      if(!Number.isFinite(distance)||(direction!==1&&direction!==-1))
        throw Error('Route poses need a finite distance and direction of 1 or -1');
      const d=along(distance),t=d/length,center=at(t);
      const ahead=at(along(d+look*.74*direction)/length).point;
      const behind=at(along(d-look*.26*direction)/length).point;
      let heading=V.sub(ahead,behind);
      if(!unit(heading)){
        if(!unit(center.tangent))throw Error('Route sample needs a direction at this distance');
        heading=V.mul(center.tangent,direction);
      }
      const forward=V.norm(heading);
      let side=V.cross(canonicalUp,forward);
      if(V.len(side)<1e-8)side=V.cross(Math.abs(forward[0])<.8?[1,0,0]:[0,0,1],forward);
      side=V.norm(side);
      return {distance:d,t,lap:loop?Math.floor(distance/length):0,point:center.point.slice(),
        forward,side,up:V.cross(forward,side),ended:!loop&&(direction===1?distance>=length:distance<=0)};
    }
    return Object.freeze({length,loop,sample});
  }

  P.routes.follower=follower;
})(KIT);
