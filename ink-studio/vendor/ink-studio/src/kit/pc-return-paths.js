/* Route a finite-width return around a reserved approach with pinned ends. */
(function(K){
  const P=K.procedural||K.authoring,EPS=1e-8;
  const vector=p=>Array.isArray(p)&&p.length===2&&Array.from(p).every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6);
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const lift=([x,z])=>[x,0,z],plan=([x,,z])=>[x,z];
  const rectangle=(lo,hi)=>[lo,[hi[0],lo[1]],hi,[lo[0],hi[1]]];
  const validApproach=guide=>Array.isArray(guide)&&guide.length>=2&&guide.length<=256&&
    Array.from(guide).every(vector);

  function approachFrame(guide){
    if(guide.some((p,i)=>i&&distance(p,guide[i-1])<=EPS))
      throw new Error('A return approach needs nonzero spans');
    const head=guide[0],first=sub(guide[1],head),length=Math.hypot(...first),
      along=first.map(v=>v/length),side=[-along[1],along[0]];
    return {
      project(p){
        const delta=sub(p,head);
        return [dot(delta,along),dot(delta,side)];
      },
      unproject:([s,v])=>head.map((x,i)=>x+s*along[i]+v*side[i])
    };
  }

  function reserve(guide,halfWidth,toeExtension,reach){
    const last=guide.at(-1),toe=sub(last,guide.at(-2)),ratio=toeExtension/Math.hypot(...toe);
    guide[guide.length-1]=last.map((v,i)=>v+toe[i]*ratio);
    const occupied=guide.slice(1).map((p,i)=>P.routes.stripFootprint(guide[i],p,halfWidth));
    const corners=occupied.flat(),lo=[0,1].map(i=>Math.min(...corners.map(p=>p[i]))),
      hi=[0,1].map(i=>Math.max(...corners.map(p=>p[i])));
    const outerLo=lo.map(v=>v-reach),outerHi=hi.map(v=>v+reach);
    return {occupied,lo,hi,outerLo,outerHi,entry:[outerLo[0],0],outer:rectangle(outerLo,outerHi)};
  }

  function freeExits(pin,clearance,reach,{lo,hi,outerLo,outerHi,outer}){
    const ends=[];
    for(const i of [0,1]){
      for(const [side,bound,expanded] of [[-1,lo,outerLo],[1,hi,outerHi]]){
        if(side*(pin[i]-bound[i])<clearance-EPS)continue;
        const point=pin.slice();
        if(side*(pin[i]-expanded[i])>=-EPS){ends.push({point,barriers:[outer]});continue;}
        point[i]+=side*reach;
        // Continue along the side to the last cross section, so the inner
        // rail has enough length before a lead that turns toward the pin.
        const lower=outerLo.slice(),upper=outerHi.slice();
        (side<0?lower:upper)[i]=point[i];
        ends.push({point,barriers:[rectangle(lower,upper)]});
      }
    }
    return ends;
  }

  function fitReturn(approach,destination,{
    occupiedHalfWidth,halfWidth,toeExtension=0,clearance=.025,maxLength=300,obstacles=[],endApproach
  }={}){
    if(!validApproach(approach)||!vector(destination)||
      ![occupiedHalfWidth,halfWidth,clearance,toeExtension,maxLength].every(Number.isFinite)||
      occupiedHalfWidth<=0||halfWidth<=0||clearance<0||toeExtension<0||maxLength<=0||
      !Array.isArray(obstacles)||!obstacles.every(ring=>Array.isArray(ring)&&ring.length>=3&&
        ring.length<=256&&Array.from(ring).every(vector)))
      throw new Error('Return paths need bounded planar geometry, positive widths and ordered clearances');
    if(endApproach!==undefined&&(!validApproach(endApproach)||distance(destination,endApproach[0])>EPS))
      throw new Error('An end approach must start at the destination and have bounded planar geometry');
    const {project,unproject}=approachFrame(approach),head=approach[0],reach=halfWidth+clearance;
    if(distance(head,destination)<=EPS)return Object.freeze({status:'blocked-pin'});
    if(obstacles.length>32)return Object.freeze({status:'budget'});
    const start=reserve(approach.map(project),occupiedHalfWidth,toeExtension,reach),
      {entry,occupied}=start,pin=project(destination);
    let ends;
    if(endApproach){
      const incoming=[pin,...endApproach.slice(1).map(project)],frame=approachFrame(incoming);
      const end=reserve(incoming.map(frame.project),occupiedHalfWidth,toeExtension,reach);
      occupied.push(...end.occupied.map(ring=>ring.map(frame.unproject)));
      ends=[{point:frame.unproject(end.entry),barriers:[start.outer,end.outer.map(frame.unproject)]}];
    }else{
      ends=freeExits(pin,clearance,reach,start);
    }
    if(!ends.length)return Object.freeze({status:'blocked-pin'});
    const blockers=obstacles.map(ring=>RouteVisibility.convexFootprint(ring.map(project),{margin:reach,maxSides:12})),
      masks=blockers.map(ring=>P.edgeClearance.footprint(ring)),
      blocked=(a,b)=>P.edgeClearance.ranges(lift(a),lift(b),masks).removed.length>0;
    function overlapsApproach(a,b){
      const polygon=P.routes.stripFootprint(a,b,halfWidth);
      return polygon.length&&occupied.some(boundary=>
        P.surfaceCells.clip([{key:'lead',polygon}],{boundary}).fragmentCount>0);
    }
    if(overlapsApproach([0,0],entry)||blocked([0,0],entry))
      return Object.freeze({status:'blocked-pin'});
    const budget={maxVertices:420,maxTests:200000};
    if(blockers.reduce((sum,ring)=>sum+ring.length,(endApproach?8:4)+2)>budget.maxVertices)
      return Object.freeze({status:'budget'});
    let best=null,exhausted=false,pinClear=false;
    for(const {point:exit,barriers} of ends){
      if(blocked(exit,pin)||endApproach&&overlapsApproach(exit,pin))continue;
      pinClear=true;
      const middle=distance(entry,exit)<=EPS?{status:'ok',points:[lift(entry)]}:
        RouteVisibility.find(lift(entry),lift(exit),[...barriers,...blockers],budget);
      if(middle.status!=='ok'){
        exhausted||=middle.status==='budget';
        continue;
      }
      const path=[[0,0],...middle.points.map(plan),pin],points=[];
      for(const point of path)if(!points.length||distance(point,points.at(-1))>EPS)points.push(point);
      const length=points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
      if(length<=maxLength&&(!best||length<best.length-EPS))
        best={status:'ok',length,points:[head.slice(),...points.slice(1,-1).map(unproject),destination.slice()]};
    }
    return P.data.freeze(best||{status:exhausted?'budget':pinClear?'unreachable':'blocked-pin'});
  }

  P.routes.fitReturn=fitReturn;
})(KIT);
