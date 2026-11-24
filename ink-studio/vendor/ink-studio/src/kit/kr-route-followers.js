// Arc-length vehicle motion and route events, sampled independently of playback.
// K.anim.route(path, {speed, acceleration, sections, stops, up, bank, mode})
// returns pure frame/state/vehicle queries plus eventsBetween and nextEvent.
// Distances are world units, times seconds, and banking radians. See docs/route-followers.md.
(function(K){
  const {V,M}=K, EPS=1e-8;
  const vector=v=>(Array.isArray(v)||ArrayBuffer.isView(v))&&v.length===3&&Array.from(v).every(Number.isFinite);
  const positive=n=>Number.isFinite(n)&&n>0;
  const finite=(n,name)=>{if(!Number.isFinite(n))throw new RangeError(name+' must be finite');return n;};
  const mod=(n,d)=>((n%d)+d)%d;
  function normalize(v,name){
    if(!vector(v)||V.len(v)<EPS)throw new RangeError(name+' needs a finite nonzero vector');
    return V.norm(v);
  }
  function perpendicular(up,tangent){
    const projected=V.mad(up,tangent,-V.dot(up,tangent));
    return V.len(projected)>EPS?V.norm(projected):V.perp(tangent);
  }
  function transport(up,a,b){
    const axis=V.cross(a,b),s=V.len(axis),c=K.clamp(V.dot(a,b),-1,1);
    if(s>EPS)up=M.app(M.rot(V.mul(axis,1/s),Math.atan2(s,c)),up);
    else if(c<0)up=M.app(M.rot(up,Math.PI),up);
    return perpendicular(up,b);
  }
  function bracket(values,value){
    let lo=0,hi=values.length;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(values[mid]<=value)lo=mid;else hi=mid;}
    return lo;
  }
  function route(path,options={}){
    if(!path||!positive(path.length)||path.length<EPS||typeof path.at!=='function')
      throw new RangeError('A route needs a nonempty arc-length path');
    const length=path.length,closed=options.closed??Boolean(path.closed),mode=options.mode??(closed?'loop':'once');
    const step=options.step??.10,maxSamples=options.maxSamples??30000;
    const orientation=options.orientation??'transport',initialUp=normalize(options.up??[0,1,0],'Route up');
    const acceleration=options.acceleration??Infinity,speed=options.speed??1;
    if(!['loop','once','pingpong'].includes(mode)||!['transport','upright'].includes(orientation)||
      mode==='loop'&&!closed||!positive(step)||!Number.isSafeInteger(maxSamples)||maxSamples<4||maxSamples>200000||
      !(positive(acceleration)||acceleration===Infinity)||!(positive(speed)||typeof speed==='function'))
      throw new RangeError('Invalid route mode, orientation, speed or sampling budget');
    const samples=Math.max(4,Math.ceil(length/step));
    if(samples+1>maxSamples)throw new RangeError('Route exceeds sampling budget');
    const pitch=length/samples,delta=Math.min(pitch*.5,length*.001);
    const position=d=>{
      const f=path.at(closed?mod(d,length):K.clamp(d,0,length));
      if(!vector(f?.p))throw new RangeError('Path must return finite positions');
      return Array.from(f.p);
    };
    function geometry(d){
      const p=position(d),before=position(d-delta),after=position(d+delta);
      const tangent=V.sub(after,before);
      return {p,tan:normalize(V.len(tangent)>EPS?tangent:path.at(d).tan,'Path tangent')};
    }
    const frames=Array.from({length:samples+1},(_,i)=>geometry(i*pitch));
    let up=perpendicular(initialUp,frames[0].tan);
    frames[0].up=up;
    for(let i=1;i<=samples;i++){
      up=transport(up,frames[i-1].tan,frames[i].tan);frames[i].up=up;
    }
    // Distribute closed-loop holonomy rather than jumping the up axis at the seam.
    const last=frames[samples],first=frames[0];
    const twist=closed?Math.atan2(V.dot(first.tan,V.cross(last.up,first.up)),V.dot(last.up,first.up)):0;
    const bank=options.bank??0;
    if(!(Number.isFinite(bank)||typeof bank==='function'||bank&&typeof bank==='object'))
      throw new RangeError('Bank must be radians, a callback or automatic bank controls');
    if(typeof bank==='object'&&(!Number.isFinite(bank.gain??1)||!positive(bank.limit??.5)||!positive(bank.lookAhead??.5)))
      throw new RangeError('Automatic banking needs finite gain and positive limit and lookAhead');
    function frame(distance){
      finite(distance,'Route distance');
      const d=closed?mod(distance,length):K.clamp(distance,0,length),f=geometry(d);
      const q=d/pitch,i=Math.min(samples-1,Math.floor(q)),t=q-i;
      const a=transport(frames[i].up,frames[i].tan,f.tan),b=transport(frames[i+1].up,frames[i+1].tan,f.tan);
      let vertical=perpendicular(V.lerp(a,b,t),f.tan);
      if(closed)vertical=M.app(M.rot(f.tan,twist*d/length),vertical);
      if(orientation==='upright'){
        const upright=V.mad(initialUp,f.tan,-V.dot(initialUp,f.tan));
        const blend=K.clamp(V.len(upright)/.15,0,1);
        vertical=perpendicular(V.lerp(vertical,V.norm(upright,vertical),blend),f.tan);
      }
      let angle=typeof bank==='function'?bank(d,f):bank;
      if(typeof bank==='object'){
        const next=geometry(d+(bank.lookAhead??.5)).tan;
        angle=K.clamp(-V.dot(V.cross(f.tan,next),vertical)*(bank.gain??1),-(bank.limit??.5),bank.limit??.5);
      }
      finite(angle,'Route bank');
      vertical=M.app(M.rot(f.tan,angle),vertical);
      const right=V.norm(V.cross(vertical,f.tan)),normal=V.norm(V.cross(f.tan,right));
      return {...f,right,up:normal,matrix:[right[0],normal[0],f.tan[0],right[1],normal[1],f.tan[1],right[2],normal[2],f.tan[2]]};
    }

    const sections=(options.sections??[]).map(section=>{
      const {from,to,speed:velocity}=section;
      if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>length||from>=to||!positive(velocity))
        throw new RangeError('Speed sections need increasing route distances and a positive speed');
      return {from,to,speed:velocity};
    });
    const stops=new Map();
    for(const stop of options.stops??[]){
      if(!Number.isFinite(stop.at)||stop.at<0||stop.at>length||!Number.isFinite(stop.duration)||stop.duration<0)
        throw new RangeError('Stops need a route distance and nonnegative duration');
      const at=closed&&stop.at===length?0:stop.at;
      if(stops.has(at))throw new RangeError('Route stops must have distinct distances');
      stops.set(at,stop.duration);
    }
    const nodes=new Set(Array.from({length:samples+1},(_,i)=>i*pitch));
    for(const s of sections){nodes.add(s.from);nodes.add(s.to);}
    for(const d of stops.keys())nodes.add(d);
    let distances=Array.from(nodes).sort((a,b)=>a-b);
    const stopped=d=>stops.has(d)||closed&&d===length&&stops.has(0);
    for(let i=1;i<distances.length;i++)if(stopped(distances[i-1])&&stopped(distances[i]))nodes.add((distances[i-1]+distances[i])*.5);
    distances=Array.from(nodes).sort((a,b)=>a-b);
    if(distances.length>maxSamples)throw new RangeError('Route sections and stops exceed sampling budget');
    const speeds=distances.slice(1).map((d,i)=>{
      const middle=(d+distances[i])*.5;
      let value=typeof speed==='function'?speed(middle,geometry(middle)):speed;
      if(!positive(value))throw new RangeError('Route speed sampler must return a positive finite speed');
      for(const s of sections)if(middle>=s.from&&middle<=s.to)value=Math.min(value,s.speed);
      return value;
    });
    const caps=distances.map((d,i)=>stopped(d)?0:Math.min(speeds[Math.max(0,i-1)],speeds[Math.min(speeds.length-1,i)]));
    // A second circuit carries seam constraints through both acceleration envelopes.
    for(let pass=0;pass<(closed?2:1);pass++){
      if(closed)caps[0]=caps[caps.length-1]=Math.min(caps[0],caps.at(-1));
      for(let i=1;i<caps.length;i++)caps[i]=Math.min(caps[i],Math.sqrt(caps[i-1]**2+2*acceleration*(distances[i]-distances[i-1])));
      for(let i=caps.length-2;i>=0;i--)caps[i]=Math.min(caps[i],Math.sqrt(caps[i+1]**2+2*acceleration*(distances[i+1]-distances[i])));
    }
    const intervals=[],arrivals=new Map(),departures=new Map();
    let duration=0;
    function dwell(d){
      arrivals.set(d,duration);
      const wait=stops.get(d)??0;
      if(wait>0){intervals.push({start:duration,end:duration+wait,from:d,to:d,v:0,a:0});duration+=wait;}
      departures.set(d,duration);
    }
    dwell(0);
    for(let i=1;i<distances.length;i++){
      const from=distances[i-1],to=distances[i],v=caps[i-1],endSpeed=caps[i],dt=2*(to-from)/(v+endSpeed);
      if(!positive(dt))throw new RangeError('Route has an unreachable stopped span');
      intervals.push({start:duration,end:duration+dt,from,to,v,a:(endSpeed-v)/dt});duration+=dt;
      if(i<distances.length-1||!closed)dwell(to);
      else {arrivals.set(to,duration);departures.set(to,duration);}
    }
    const startWait=stops.get(0)??0,endWait=stops.get(length)??0;
    const returnTime=duration*2-endWait;
    const starts=intervals.map(q=>q.start),period=mode==='pingpong'?returnTime-startWait:duration;
    const travelIntervals=intervals.filter(q=>q.to>q.from),travelStarts=travelIntervals.map(q=>q.from);
    function timeAtDistance(distance,{departure=false}={}){
      finite(distance,'Event distance');
      if(distance<0||distance>length)throw new RangeError('Event distance lies outside the route');
      const exact=(departure?departures:arrivals).get(distance);
      if(exact!==undefined)return exact;
      const leg=travelIntervals[bracket(travelStarts,distance)],s=distance-leg.from;
      const discriminant=Math.max(0,leg.v*leg.v+2*leg.a*s);
      const elapsed=leg.a===0?s/leg.v:2*s/(leg.v+Math.sqrt(discriminant));
      return leg.start+elapsed;
    }
    function clockAt(time){
      finite(time,'Route time');
      const cycle=mode==='once'?0:Math.floor(time/period),phase=mode==='once'?K.clamp(time,0,duration):mod(time,period);
      const direction=mode==='pingpong'&&phase>=duration?-1:1;
      return {cycle,direction,clock:direction<0?returnTime-phase:phase};
    }
    function state(time){
      const {cycle,direction,clock}=clockAt(time),leg=intervals[bracket(starts,clock)];
      const elapsed=K.clamp(clock-leg.start,0,leg.end-leg.start);
      const distance=K.clamp(leg.from+leg.v*elapsed+.5*leg.a*elapsed*elapsed,leg.from,leg.to);
      const velocity=mode==='once'&&(time<0||time>=duration)?0:Math.max(0,leg.v+leg.a*elapsed);
      const travelled=mode==='pingpong'?cycle*2*length+(direction<0?2*length-distance:distance):cycle*length+distance;
      return {distance,travel:travelled,speed:velocity,direction,lap:cycle,stopped:velocity<EPS,
        finished:mode==='once'&&time>=duration};
    }
    function vehicle(time,{offset=0,wheelbase=0}={}){
      finite(offset,'Vehicle offset');
      if(!Number.isFinite(wheelbase)||wheelbase<0)throw new RangeError('Wheelbase must be nonnegative');
      const motion=state(time),distance=motion.distance-motion.direction*offset,f=frame(distance);
      let tangent=f.tan;
      if(wheelbase>EPS){
        const axis=V.sub(frame(distance+wheelbase*.5).p,frame(distance-wheelbase*.5).p);
        if(V.len(axis)>EPS)tangent=V.norm(axis);
      }
      tangent=V.mul(tangent,motion.direction);
      const normal=perpendicular(f.up,tangent),right=V.norm(V.cross(normal,tangent));
      return {...motion,distance:closed?mod(distance,length):K.clamp(distance,0,length),
        active:closed||distance>=0&&distance<=length,p:f.p,tan:tangent,right,up:normal,
        velocity:V.mul(f.tan,motion.speed*motion.direction),matrix:[right[0],normal[0],tangent[0],right[1],normal[1],tangent[1],right[2],normal[2],tangent[2]]};
    }
    function vehicles(time,{count=1,spacing=1,offset=0,wheelbase=0}={}){
      if(!Number.isSafeInteger(count)||count<1||count>10000||!positive(spacing))throw new RangeError('Vehicles need a bounded count and positive spacing');
      return Array.from({length:count},(_,i)=>vehicle(time,{offset:offset+i*spacing,wheelbase}));
    }
    // Invert the timetable once per site; queries never advance or mutate vehicles.
    function eventPhases(events,offset){
      finite(offset,'Vehicle offset');
      if(!Array.isArray(events)||events.length>10000)throw new RangeError('Events must be a bounded array');
      const ids=new Set(),defs=[];
      for(const event of events){
        if(!event||!Number.isFinite(event.at)||event.at<0||event.at>length||event.id!==undefined&&ids.has(event.id))
          throw new RangeError('Events need route distances and distinct optional IDs');
        if(event.id!==undefined)ids.add(event.id);
        const distance=event.at+offset;
        if(mode==='loop')defs.push({event,phase:timeAtDistance(mod(distance,length))});
        else if(distance>=0&&distance<=length&&!(mode==='pingpong'&&distance===0))defs.push({event,phase:timeAtDistance(distance)});
        if(mode==='pingpong'){
          const reverse=event.at-offset;
          if(reverse>=0&&reverse<=length&&reverse!==length)
            defs.push({event,phase:returnTime-timeAtDistance(reverse,{departure:true}),reverse:true});
        }
      }
      return defs;
    }
    function eventsBetween(from,to,events,{offset=0,lead=0,maxEvents=10000}={}){
      finite(from,'Event start');finite(to,'Event end');finite(offset,'Vehicle offset');
      if(!Number.isFinite(lead)||lead<0||!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>100000)
        throw new RangeError('Events need nonnegative lead and a bounded output budget');
      const defs=eventPhases(events,offset);
      if(to<from)return [];
      const out=[],min=from+lead;
      for(const {event,phase,reverse} of defs){
        const first=mode==='once'?0:Math.floor((min-phase)/period)+1;
        const last=mode==='once'?0:Math.floor((to-phase)/period);
        if(last-first+1>maxEvents)throw new RangeError('Route events exceed output budget');
        for(let cycle=first;cycle<=last;cycle++){
          const time=cycle*period+phase;
          if(time<=min||time>to)continue;
          if(out.length===maxEvents)throw new RangeError('Route events exceed output budget');
          out.push({...event,time,lap:cycle,direction:reverse?-1:1,wait:time-from});
        }
      }
      return out.sort((a,b)=>a.time-b.time);
    }
    function nextEvent(time,events,{offset=0,lead=0}={}){
      finite(time,'Event time');
      if(!Number.isFinite(lead)||lead<0)throw new RangeError('Event lead must be nonnegative');
      let next=null;
      for(const {event,phase,reverse} of eventPhases(events,offset)){
        const cycle=mode==='once'?0:Math.floor((time+lead-phase)/period)+1;
        const hit=cycle*period+phase;
        if(hit<=time+lead||next&&hit>=next.time)continue;
        next={...event,time:hit,lap:cycle,direction:reverse?-1:1,wait:hit-time};
      }
      return next;
    }
    return {path,length,closed,mode,duration,period,frame,state,vehicle,vehicles,timeAtDistance,
      distanceAt:time=>state(time).distance,speedAt:time=>{const s=state(time);return s.speed*s.direction;},eventsBetween,nextEvent};
  }
  K.anim.route=route;
})(KIT);
