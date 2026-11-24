/* Shared walking paths and capacity-limited dock transfers for agents. */
(function(K){
  const W=K.world, {V,M}=K, {check,id,record,vector,own}=W.data;
  const eps=1e-7, idle=Object.freeze({phase:'idle'});
  const order=(a,b)=>a<b?-1:a>b?1:0;
  const boundedPoint=p=>vector(p)&&p.every(n=>Math.abs(n)<=1e6);
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const entries=rows=>Object.entries(rows).sort(([a],[b])=>order(a,b));
  const actions=['follow-path','board-ride','cancel-travel'];

  function create(paths={},rides={},bounds){
    check(record(paths)&&Object.keys(paths).length<=128&&record(rides)&&Object.keys(rides).length<=128,
      'Expected bounded walking paths and rides');
    const inside=p=>boundedPoint(p)&&W.fields.zone(p,bounds);
    const lines=new Map(), carriers=new Map(), inputs={};
    for(const [name,raw] of entries(paths)){
      check(id(name)&&record(raw)&&Object.keys(raw).every(key=>['points','closed'].includes(key))&&
        typeof (raw.closed??false)==='boolean'&&Array.isArray(raw.points)&&integer(raw.points.length,2,4096)&&
        raw.points.every((p,i)=>boundedPoint(p)&&(!i||V.dist(p,raw.points[i-1])>eps))&&
        (!raw.closed||V.dist(raw.points[0],raw.points.at(-1))>eps),'Invalid authored path '+name);
      lines.set(name,{points:raw.points,closed:raw.closed??false});
    }
    const port=(ride,dock)=>'dock.'+ride+'.'+dock;
    for(const [name,raw] of entries(rides)){
      check(id(name)&&name.length<=60&&record(raw)&&
        Object.keys(raw).every(key=>['entity','socket','path','motion','phase','seats','docks'].includes(key))&&
        (raw.path!==undefined?lines.has(raw.path)&&raw.entity===undefined&&raw.socket===undefined&&
          (raw.motion===undefined||record(raw.motion))&&Number.isFinite(raw.phase??0)&&Math.abs(raw.phase??0)<=1e9:
          id(raw.entity)&&(raw.socket===undefined||id(raw.socket))&&raw.motion===undefined&&raw.phase===undefined),
      'Invalid ride carrier '+name);
      const {seats=[[0,0,0]],docks}=raw;
      check(Array.isArray(seats)&&integer(seats.length,1,64)&&seats.every((p,i)=>boundedPoint(p)&&
        !seats.slice(0,i).some(other=>V.dist(other,p)<=eps))&&record(docks)&&integer(Object.keys(docks).length,2,64),
      'Invalid ride seats or docks '+name);
      const stops=new Map();
      for(const [key,dock] of entries(docks)){
        check(id(key)&&key.length<=60&&record(dock)&&Object.keys(dock).every(k=>['at','reach','queue','open'].includes(k))&&
          inside(dock.at)&&Number.isFinite(dock.reach??1)&&((dock.reach??1)>=.05&&(dock.reach??1)<=8)&&
          Array.isArray(dock.queue??[])&&(dock.queue??[]).length<=64&&(dock.queue??[]).every(inside)&&
          typeof (dock.open??true)==='boolean','Invalid ride dock '+name+'/'+key);
        check(!own(inputs,port(name,key)),'Duplicate ride dock input');
        stops.set(key,{at:dock.at,reach:dock.reach??1,queue:dock.queue??[]});
        inputs[port(name,key)]={type:'bool',default:dock.open??true};
      }
      const line=lines.get(raw.path), route=line&&K.anim.route(K.anim.path(line.points,{closed:line.closed}),raw.motion);
      carriers.set(name,{seats,stops,entity:raw.entity,socket:raw.socket,route,phase:raw.phase??0});
    }

    function frame(ride,query,time){
      if(ride.route){
        const sample=ride.route.vehicle(time+ride.phase);
        return {point:sample.p,rotation:sample.matrix};
      }
      return query.frame({entity:ride.entity,socket:ride.socket});
    }
    function seatPoint(ride,pose,seat){
      const offset=ride.seats[seat];
      return V.add(pose.point,pose.rotation?M.app(pose.rotation,offset):offset);
    }
    function checkAction(type,args){
      if(type==='follow-path')check(lines.get(args.path)?.points.every(inside)&&
        (args.reverse===undefined||typeof args.reverse==='boolean'),
        'Unknown walking path or direction');
      if(type==='board-ride'){
        const ride=carriers.get(args.ride);
        check(ride?.stops.has(args.from)&&ride.stops.has(args.to)&&args.from!==args.to,'Ride needs distinct boarding and exit docks');
      }
    }
    function start(type,args,row,ctx){
      if(type==='follow-path'){
        const line=lines.get(args.path), direction=args.reverse?-1:1;
        const plan={phase:'following',path:args.path,index:direction<0?line.points.length-1:0,direction};
        ctx.emit('path-started',{agent:row.id,path:plan.path});
        return plan;
      }
      if(type==='board-ride'){
        const ride=carriers.get(args.ride);
        check(ride.entity!==row.entity,'An agent cannot board itself');
        const plan={phase:'queueing',ride:args.ride,from:args.from,to:args.to,since:ctx.tick,
          approach:V.dist(row.position,ride.stops.get(args.from).at)};
        ctx.emit('ride-requested',{agent:row.id,ride:plan.ride,from:plan.from,to:plan.to});
        return plan;
      }
      if(row.travelPlan)ctx.emit('travel-cancelled',{agent:row.id});
    }
    function validate(row){
      const plan=row.travelPlan;
      if(!plan){
        check(row.mode!=='ride','A riding agent needs a travel plan');
        return;
      }
      let valid=false;
      if(plan.phase==='following'){
        const line=lines.get(plan.path);
        valid=line&&integer(plan.index,0,line.points.length-1)&&[-1,1].includes(plan.direction);
      }else{
        const ride=carriers.get(plan.ride);
        valid=ride?.stops.has(plan.from)&&ride.stops.has(plan.to)&&plan.from!==plan.to&&ride.entity!==row.entity&&
          integer(plan.since,0,10000000)&&Number.isFinite(plan.approach)&&plan.approach>=0&&
          (plan.phase==='queueing'||plan.phase==='riding'&&integer(plan.seat,0,ride.seats.length-1));
      }
      check(record(plan)&&valid&&(row.mode==='ride')===(plan.phase==='riding'),'Invalid saved agent travel');
    }
    function ledger(rows){
      const queues=new Map(), aboard=new Map();
      for(const row of rows){
        const plan=row.travelPlan;
        if(plan.phase==='riding'){
          if(!aboard.has(plan.ride))aboard.set(plan.ride,new Map());
          const seats=aboard.get(plan.ride);
          check(!seats.has(plan.seat),'Duplicate occupied ride seat');
          seats.set(plan.seat,row);
        }else if(plan.phase==='queueing'){
          const stop=port(plan.ride,plan.from);
          if(!queues.has(stop))queues.set(stop,[]);
          queues.get(stop).push(row);
        }
      }
      for(const rows of queues.values())rows.sort((a,b)=>a.travelPlan.since-b.travelPlan.since||
        a.travelPlan.approach-b.travelPlan.approach||order(a.id,b.id));
      return {queues,aboard};
    }
    function begin(rows,ctx){
      const {queues,aboard}=ledger(rows), ranks=new Map(), frames=new Map();
      for(const queue of queues.values())queue.forEach((row,i)=>ranks.set(row.id,i));
      function poseOf(name,ride){
        if(!frames.has(name))frames.set(name,frame(ride,ctx.query,ctx.time));
        return frames.get(name);
      }
      function step(row,move){
        const plan=row.travelPlan;
        if(plan.phase==='following'){
          const line=lines.get(plan.path);
          const moved=move.walk(row,line.points[plan.index]);
          const index=plan.index+plan.direction;
          const next=line.closed?(index+line.points.length)%line.points.length:index;
          if(!move.arrived(moved,line.points[plan.index],line.points[next]))return moved;
          if(!line.points[next]){
            ctx.emit('path-finished',{agent:row.id,path:plan.path,at:moved.position});
            return move.release(moved,moved.position);
          }
          return {...moved,travelPlan:{...plan,index:next}};
        }
        const ride=carriers.get(plan.ride), pose=poseOf(plan.ride,ride);
        if(!aboard.has(plan.ride))aboard.set(plan.ride,new Map());
        const used=aboard.get(plan.ride);
        if(plan.phase==='riding'){
          if(!pose){
            used.delete(plan.seat);
            ctx.emit('ride-lost',{agent:row.id,ride:plan.ride,at:row.position});
            return move.release(row,row.position);
          }
          const stop=ride.stops.get(plan.to), point=seatPoint(ride,pose,plan.seat), landing=move.fit(stop.at);
          if(ctx.input[port(plan.ride,plan.to)]&&landing&&V.dist(point,landing)<=stop.reach&&
            move.transfer(row,point,landing,ride.entity)){
            used.delete(plan.seat);
            ctx.emit('ride-exited',{agent:row.id,ride:plan.ride,dock:plan.to,at:landing});
            return move.release(row,landing);
          }
          return row;
        }
        const rank=ranks.get(row.id), stop=ride.stops.get(plan.from);
        const target=rank===0?stop.at:stop.queue[rank-1];
        const moved=target?move.walk(row,target):move.hold(row);
        if(rank!==0||!pose||!ctx.input[port(plan.ride,plan.from)]||!move.arrived(moved,stop.at))return moved;
        const seat=ride.seats.findIndex((_,i)=>{
          if(used.has(i))return false;
          const point=seatPoint(ride,pose,i);
          return V.dist(point,moved.position)<=stop.reach&&
            [...used].every(([occupied,other])=>move.seatClear(ride.seats[i],ride.seats[occupied],other))&&
            move.transfer(moved,moved.position,point,ride.entity);
        });
        if(seat<0)return moved;
        const point=seatPoint(ride,pose,seat);
        const rider={...move.hold(moved,point),limbs:[],mode:'ride',travelPlan:{...plan,phase:'riding',seat}};
        used.set(seat,rider);
        ctx.emit('ride-boarded',{agent:row.id,ride:plan.ride,dock:plan.from,seat,at:point});
        return rider;
      }
      return {step};
    }
    function carry(row,ctx,frames){
      const {ride:name,seat}=row.travelPlan, ride=carriers.get(name);
      if(!frames.has(name))frames.set(name,frame(ride,ctx.query,ctx.time));
      const pose=frames.get(name);
      if(!pose)return row;
      const position=seatPoint(ride,pose,seat);
      const velocity=V.mul(V.sub(position,row.position),1/ctx.dt);
      const direction=pose.rotation?V.norm(M.app(pose.rotation,[0,0,1]),row.direction):row.direction;
      return W.agentStorage.sameVector(position,row.position)&&W.agentStorage.sameVector(velocity,row.velocity)&&
        W.agentStorage.sameVector(direction,row.direction)?row:{...row,position,goal:position,velocity,direction};
    }
    function report(rows,ctx){
      const {queues,aboard}=ledger(rows);
      return Object.fromEntries([...carriers].map(([name,ride])=>[name,{
        frame:frame(ride,ctx.query,ctx.time),capacity:ride.seats.length,
        seats:ride.seats.map((_,i)=>aboard.get(name)?.get(i)?.id??null),
        docks:Object.fromEntries([...ride.stops].map(([dock,{at}])=>[dock,{at,
          open:ctx.signals[ctx.system+'/'+port(name,dock)],
          queue:(queues.get(port(name,dock))??[]).map(row=>row.id)}]))
      }]));
    }
    return {inputs,hasRides:carriers.size>0,checkAction,start,validate,ledger,begin,carry,report};
  }
  W.agentTravel=Object.freeze({create,actions,idle});
})(KIT);
