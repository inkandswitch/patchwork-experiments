/* Deterministic translation in impact order, with iterative overlap cleanup. */
(function(K) {
  const W=K.world, C=W.colliders, {V}=K, eps=1e-8, zero=[0,0,0], down=[0,-1,0];
  function prepare(bodies,roots,masses,{ground,onGround,fabric,onFabric,onContact}={}) {
    const keys=Object.keys(bodies).sort(), groups=new Map();
    for(const key of keys){
      const root=roots[key];
      if(!root||bodies[root].fixed)continue;
      if(!groups.has(root))groups.set(root,[]);
      groups.get(root).push(key);
    }
    function shift(root,delta) {
      if(!groups.has(root))return;
      for(const key of groups.get(root)){
        const body=bodies[key];
        bodies[key]={...body,position:V.add(body.position,delta)};
      }
    }
    const velocity=root=>groups.has(root)?bodies[root].velocity:zero;
    function adjust(a,b,{normal,parts,surface},depth=0) {
      const ra=roots[a], rb=b===null?null:roots[b], wa=groups.has(ra)?1/masses[ra]:0, wb=groups.has(rb)?1/masses[rb]:0;
      const denom=wa+wb, speed=V.dot(V.sub(velocity(ra),velocity(rb)),normal);
      if(speed>eps){
        onContact?.(a,b,normal,parts,speed/denom);
        if(wa)bodies[ra]={...bodies[ra],velocity:V.mad(bodies[ra].velocity,normal,-speed*wa/denom)};
        if(wb)bodies[rb]={...bodies[rb],velocity:V.mad(bodies[rb].velocity,normal,speed*wb/denom)};
        if(surface)onFabric?.(surface,a,speed*masses[ra]);
        else if(b===null)onGround?.(a,ra,speed);
      }
      if(depth>0){
        shift(ra,V.mul(normal,-depth*wa/denom));
        shift(rb,V.mul(normal,depth*wb/denom));
      }
      return speed;
    }
    function floorHits(duration,visit) {
      if(ground===undefined)return;
      for(const key of keys){
        const root=roots[key];
        if(!groups.has(root))continue;
        const shape=C.geometry(bodies[key]), gap=shape.min[1]-ground, delta=velocity(root)[1]*duration;
        if(duration===0?gap>eps:delta>=-eps||gap+delta>eps)continue;
        const part=shape.parts.find(part=>part.min[1]===shape.min[1]).part;
        visit(key,{normal:down,gap,time:duration?Math.max(0,Math.min(1,gap/-delta)):0,parts:[part,-1]});
      }
    }
    function fabricHits(duration,visit) {
      if(!fabric?.length)return;
      for(const key of keys){
        const root=roots[key];
        if(!groups.has(root))continue;
        const {min,max,parts}=C.geometry(bodies[key]);
        const point=[(min[0]+max[0])*.5,min[1],(min[2]+max[2])*.5];
        const delta=V.mul(velocity(root),duration), skin=duration?0:Math.min(.12,(max[1]-min[1])*.5);
        for(const {system,surfaces} of fabric){
          const seat=W.fabricContact.sweep(surfaces,point,delta,skin);
          if(seat)visit(key,{...seat,parts:[parts.find(part=>part.min[1]===min[1]).part,-1],
            surface:{...seat,system}});
        }
      }
    }
    function candidates(duration,visit) {
      const sorted=keys.map(key=>{
        const at=C.geometry(bodies[key]), motion=V.mul(velocity(roots[key]),duration);
        return {key,motion,min:at.min.map((v,i)=>v+Math.min(0,motion[i])),
          max:at.max.map((v,i)=>v+Math.max(0,motion[i]))};
      }).sort((a,b)=>a.min[0]-b.min[0]||(a.key<b.key?-1:1));
      for(let i=0;i<sorted.length-1;i++)for(let j=i+1;j<sorted.length;j++){
        const a=sorted[i], b=sorted[j];
        if(b.min[0]>a.max[0]+eps)break;
        if(roots[a.key]===roots[b.key]||!groups.has(roots[a.key])&&!groups.has(roots[b.key]))continue;
        if([1,2].some(k=>b.min[k]>a.max[k]+eps||a.min[k]>b.max[k]+eps))continue;
        if(a.key<b.key)visit(a,b);
        else visit(b,a);
      }
    }
    function settle(iterations) {
      for(let i=0;i<iterations;i++){
        let moved=false;
        function solve(a,b,hit) {
          const depth=hit.gap<-eps?-hit.gap:0;
          const speed=adjust(a,b,hit,depth);
          moved ||= depth>0||speed>eps;
        }
        floorHits(0,(a,hit)=>solve(a,null,hit));
        fabricHits(0,(a,hit)=>solve(a,null,hit));
        candidates(0,(a,b)=>{
          const hit=C.contact(bodies[a.key],bodies[b.key]);
          if(hit)solve(a.key,b.key,hit);
        });
        if(!moved)break;
      }
    }
    function move(duration) {
      if(duration<=0)return;
      for(const root of groups.keys())shift(root,V.mul(velocity(root),duration));
    }
    function sweep(dt,iterations) {
      let remaining=dt;
      const impacts=[];
      for(let round=0;round<64&&remaining>eps;round++){
        let first;
        function choose(a,b,contact) {
          if(!contact)return;
          if(!first||contact.time<first.contact.time||
            contact.time===first.contact.time&&(a<first.a||a===first.a&&(b??'')<(first.b??'')))
            first={a,b,contact};
        }
        floorHits(remaining,(a,hit)=>choose(a,null,hit));
        fabricHits(remaining,(a,hit)=>choose(a,null,hit));
        candidates(remaining,(a,b)=>choose(a.key,b.key,C.sweep(bodies[a.key],bodies[b.key],V.sub(a.motion,b.motion))));
        if(!first){move(remaining);return {impacts,limited:false};}
        const {a,b,contact}=first, travel=contact.time*remaining;
        move(travel);
        remaining-=travel;
        const speed=adjust(a,b,contact);
        const {system,shape,face}=contact.surface??{};
        impacts.push({a,b,parts:contact.parts,normal:contact.normal,at:1-remaining/dt,speed,
          ...(system&&{surface:{system,shape,face}})});
        if(contact.limited)return {impacts,limited:true};
        settle(iterations);
      }
      return {impacts,limited:remaining>eps};
    }
    return {settle,move,sweep};
  }
  W.contactMotion=Object.freeze({prepare});
})(KIT);
