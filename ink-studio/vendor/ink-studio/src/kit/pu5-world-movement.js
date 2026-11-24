/* Habitat policies and motion over the same fields exposed to queries. */
(function (K) {
  const W=K.world, P=K.procedural, Q=W.query, V=K.V;
  const {check,record,id,own,vector}=W.data, {bounds,zone}=W.fields;
  const up=[0,1,0], east=[1,0,0];
  function read(ctx,name,point,args) {
    return name?ctx.query.probe(name,point,args):null;
  }
  function heightAt(ctx,config,x,z) {
    const hit=read(ctx,config.bed,[x,0,z]);
    return hit?.status==='ok'&&Number.isFinite(hit.value)?hit.value:config.ground??0;
  }
  function clearance(ctx,config,point,exclude) {
    const hit=read(ctx,config.clearance,point,{exclude});
    return typeof hit?.value==='number'?hit.value:Infinity;
  }
  function wet(ctx,config,point) {
    const hit=read(ctx,config.water,point);
    return hit?.status==='ok'&&hit.value.depth>0?hit.value:null;
  }
  function supports(ctx,config,x,z,low,high,includeMaterial=false) {
    const output=read(ctx,config.support,[x,(low+high)*.5,z],{low,high,...(includeMaterial&&{includeMaterial})});
    if(output?.status==='ok'&&Array.isArray(output.value))return output.value;
    const y=heightAt(ctx,config,x,z);
    if(y<low||y>high)return [];
    const surface=W.materials.probe(ctx.query,config.surface,[x,y,z]);
    return [{y,normal:up,id:'ground',material:surface?.id??'ground',...(includeMaterial&&surface&&{surface})}];
  }
  function groundOptions(ctx,config,{radius=.13,maxWade=.16,maxSlope=.9,exclude}={}) {
    const region=config.bounds;
    const height=(x,z)=>config.support?
      (supports(ctx,config,x,z,region.min[1],region.max[1])[0]?.y??heightAt(ctx,config,x,z)):heightAt(ctx,config,x,z);
    const travel=(x,y,z)=>{
      const water=wet(ctx,config,[x,y,z]);
      if(water&&water.surface-y>maxWade)return Infinity;
      const path=read(ctx,config.wear,[x,y,z]);
      return path?.status==='ok'?(config.wearWeight??.8)*(1-W.fields.clamp(path.value,0,1)):0;
    };
    return {bounds:region,height,clearance:(x,y,z)=>clearance(ctx,config,[x,y+Math.max(.15,radius),z],exclude),
      minClearance:radius,cost:travel,cell:config.cell??.25,maxSlope};
  }
  function groundPlan(ctx,config,from,to,{radius=.13,maxWade=.16,maxSlope=.9,exclude}={}) {
    const options=groundOptions(ctx,config,{radius,maxWade,maxSlope,exclude}), {height,cost:travel}=options;
    if(!zone(from,config.bounds)||!zone(to,config.bounds))return {status:'outside',points:[]};
    const start=[from[0],height(from[0],from[2]),from[2]], end=[to[0],height(to[0],to[2]),to[2]];
    if(Math.hypot(start[0]-end[0],start[2]-end[2])<1e-8)return {status:'ok',points:[start],length:0,cost:0};
    const result=P.routes.terrain(start,end,options);
    const {route,...info}=result;
    if(route)return {...info,points:route.points};
    let blocked=null;
    for(let i=0;i<=48;i++){
      const p=V.lerp(start,end,i/48);
      p[1]=height(p[0],p[2]);
      const solid=read(ctx,config.clearance,V.add(p,[0,radius,0]),{exclude});
      if(solid?.status==='ok'&&solid.value<radius){
        blocked={kind:'clearance',point:p,body:solid.body??null};
        break;
      }
      if(travel(...p)===Infinity){blocked={kind:'water',point:p};break;}
    }
    return {...info,points:[],blocked};
  }
  function spatialPlan(ctx,config,from,to,body) {
    const radius=body.radius, {bounds:region}=config;
    function place(p) {
      if(!zone(p,region))return null;
      let point=p;
      if(body.mode==='swim'){
        const medium=wet(ctx,config,p);
        if(!medium||medium.depth<radius*.6)return null;
        point=[p[0],medium.surface-radius*.35,p[2]];
      }
      return clearance(ctx,config,point,body.entity)>=radius?point:null;
    }
    function link(a,b) {
      const steps=Math.max(1,Math.ceil(V.dist(a,b)/Math.max(.08,radius*.7)));
      if(steps>4096)return false;
      for(let i=1;i<=steps;i++)if(!place(V.lerp(a,b,i/steps)))return false;
      return true;
    }
    const first=place(from), last=place(to);
    if(!first||!last)return {status:'blocked-pin',points:[]};
    if(link(first,last))return {status:'ok',points:[first,last]};
    const {min,max}=region;
    const mid=V.lerp(from,to,.5), offset=Math.max(radius*5,.35), extras=[];
    for(const scale of [1,2,4])for(const direction of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]){
      const p=V.mad(mid,direction,offset*scale).map((n,i)=>W.fields.clamp(n,min[i],max[i]));
      extras.push(p);
    }
    const points=[first,last,...[...(config.waypoints??[]),...extras].map(place).filter(Boolean)];
    const cost=points.map(()=>Infinity), previous=points.map(()=>-1), remaining=new Set(points.keys());
    cost[0]=0;
    while(remaining.size){
      let node=-1, best=Infinity;
      for(const k of remaining)if(cost[k]<best){best=cost[k];node=k;}
      if(node<0||node===1)break;
      remaining.delete(node);
      for(const k of remaining){
        const next=best+V.dist(points[node],points[k]);
        if(next>=cost[k]||!link(points[node],points[k]))continue;
        cost[k]=next;previous[k]=node;
      }
    }
    if(previous[1]<0)return {status:'unreachable',points:[]};
    const route=[];
    for(let i=1;i>=0;i=previous[i])route.unshift(points[i]);
    return {status:'ok',points:route,length:cost[1]};
  }
  function routeDependencies(config) {
    const {min,max} = config.bounds;
    const area = {axes:'xz',min:[min[0],min[2]],max:[max[0],max[2]]};
    return {reads:['bed','support','clearance','water','wear','surface'].flatMap(key=>
      typeof config[key] === 'string' ? [{field:config[key],bounds:area}] : [])};
  }
  function routeArea(points,padding){
    const {min,max}=P.spatial.boxOf(points);
    return {axes:'xz',min:[min[0]-padding,min[2]-padding],max:[max[0]+padding,max[2]+padding]};
  }
  function navigation(config) {
    bounds(config.bounds);
    check(Number.isFinite(config.cell??.25)&&(config.cell??.25)>0&&Number.isFinite(config.wearWeight??.8)&&
      (config.wearWeight??.8)>=0&&Array.isArray(config.waypoints??[])&&(config.waypoints??[]).length<=48&&
      (config.waypoints??[]).every(p=>vector(p))&&Number.isFinite(config.ground??0),'Invalid navigation domain');
    check(config.tiles===undefined||record(config.tiles),'Expected navigation tile settings');
    const tiled=config.tiles&&W.navigationTiles.create(config,(query,profile)=>groundOptions({query},config,profile));
    function route({query,target,args}) {
      check(target.point&&vector(args.to),'Route needs start and end XYZ points');
      const mode=args.mode??'walk', radius=args.radius??.13;
      check(['walk','swim','fly'].includes(mode)&&Number.isFinite(radius)&&radius>0,'Invalid travel mode or body radius');
      check(args.strategy===undefined||Boolean(tiled)&&mode==='walk','Navigation strategies need tiled walking routes');
      return Q.ok(mode==='walk'?(tiled?tiled.bind(query).route(target.point,args.to,args):groundPlan({query},config,target.point,args.to,args)):
        spatialPlan({query},config,target.point,args.to,{mode,radius,entity:args.exclude}));
    }
    return {initial:()=>null,dependencies:routeDependencies(config),
      ...(tiled&&{navigationTiles:tiled}),
      ...((config.surface!==undefined||tiled)&&{checkFields(query){
        W.materials.checkSurface(query,config.surface);
        if(tiled)for(const {field} of routeDependencies(config).reads)
          check(query.field(field),'Unknown tiled navigation field '+field);
      }}),fields:{
      ...(tiled&&{tiles:{type:'record',qualified:true,read:({query})=>Q.ok(tiled.bind(query).report())}}),
      ...(config.tiles?.flowFields!==undefined&&{flow:{type:'record',qualified:true,read({query,target,args}){
        check(target.point&&vector(args.to),'Flow probe needs a start and destination XYZ point');
        return Q.ok(tiled.bind(query).flow(target.point,args.to,args));
      }}}),
      height:{type:'number',units:'world',read:({query,target})=>target.point?
        Q.ok(heightAt({query},config,target.point[0],target.point[2])):Q.missing('point required')}
    },traces:{route:{run:route}}};
  }
  function habitat(config) {
    const species=config.species??{};
    check(record(species)&&Object.keys(species).length<=256,'Invalid species catalog');
    for(const [name,spec] of Object.entries(species)){
      check(id(name)&&record(spec)&&Array.isArray(spec.rules??[])&&(spec.rules??[]).length<=64&&
        Number.isFinite(spec.minimum??1)&&(spec.minimum??1)>=0&&(spec.minimum??1)<=1,'Invalid habitat profile '+name);
      const names=new Set();
      for(const rule of spec.rules??[]){
        check(record(rule)&&id(rule.id)&&!names.has(rule.id)&&(typeof rule.field==='string')!==!!rule.resource&&
          Number.isFinite(rule.weight??1)&&(rule.weight??1)>0,'Invalid habitat rule');
        names.add(rule.id);
        if(rule.resource){
          check(record(rule.resource)&&Number.isFinite(rule.resource.radius)&&rule.resource.radius>=0&&
            (rule.resource.route===undefined||typeof rule.resource.route==='string'),'Invalid habitat resource');
          Q.condition(rule.resource.where,{});
        }
        Q.condition(rule.when,{});
      }
    }
    function suitability({query,target,args}) {
      if(!target.point)return Q.missing('point required');
      const spec=species[args.species];
      if(!own(species,args.species))return Q.missing('unknown species','missing');
      let total=0, passed=0, required=true;
      const reasons=(spec.rules??[]).map(rule=>{
        let read;
        if(rule.resource){
          const {radius,where,route}=rule.resource;
          const candidates=query.spatial({point:target.point,radius,where}).sort((a,b)=>
            V.dist(a.position,target.point)-V.dist(b.position,target.point)).slice(0,32);
          const item=route?candidates.find(candidate=>{
            const result=query.trace(route,target,{to:candidate.position,...rule.resource.args});
            return result.status==='ok'&&result.value.status==='ok';
          }):candidates[0];
          read=item?Q.ok(item):Q.missing('no reachable matching resource','missing');
        }else read=query.probe(rule.field,target,rule.args);
        const weight=rule.weight??1;
        const matches=(read.status==='ok'||read.status===rule.status)&&Q.condition(rule.when,read.value);
        total+=weight;
        if(matches)passed+=weight;
        if(rule.required!==false&&!matches)required=false;
        return {id:rule.id,pass:matches,value:read.value??null,status:read.status};
      });
      const score=total?passed/total:1;
      return Q.ok({species:args.species,score,suitable:required&&score>=(spec.minimum??1),reasons});
    }
    return {initial:()=>null,fields:{suitability:{type:'record',read:suitability}}};
  }
  function agents(config,{catalog,world}) {
    const S=W.agentStorage, freeze=P.data.freeze, emptyList=freeze([]), defaultLook=freeze([4,5,6,24]);
    const navigation=config.navigation;
    if(navigation!==undefined){
      const nav=id(navigation)&&world.systems[navigation];
      check(nav?.kind==='navigation'&&record(nav.config?.tiles),'Agents need a tiled navigation system');
      const shared={}, defaults={cell:.25,ground:0,wearWeight:.8};
      for(const key of ['bounds','cell','ground','bed','support','clearance','water','wear','wearWeight']){
        check(config[key]===undefined||W.data.equal(config[key],nav.config[key]??defaults[key]),'Agent route field must match navigation '+key);
        if(nav.config[key]!==undefined)shared[key]=nav.config[key];
      }
      config={...shared,...config};
    }
    const RQ=W.routeRequests, O=W.agentOrders;
    const navigationReads=navigation&&['bed','support','clearance','water'].map(key=>config[key]).filter(Boolean);
    const orders=config.orders===undefined?null:O.create(config.orders);
    const routeQueue=config.routeQueue===undefined?null:RQ.create(config.routeQueue);
    check(!routeQueue||navigation,'Route queues need a tiled navigation system');
    const travel=config.paths===undefined&&config.rides===undefined?null:W.agentTravel.create(config.paths,config.rides,config.bounds);
    const crowd=config.crowd===undefined&&!travel?.hasRides?null:W.crowd.create(config.crowd===undefined?{}:config.crowd,config.bounds);
    const materialContacts=config.contactEvents==='material';
    check(config.contactEvents===undefined||typeof config.contactEvents==='boolean'||materialContacts,
      'contactEvents must be boolean or material');
    bounds(config.bounds);
    const initial={}, profiles=config.species??{}, source=config.agents??{}, aliases=new WeakMap();
    const maxAgents=config.maxAgents??16384;
    check(Number.isSafeInteger(maxAgents)&&maxAgents>=1&&maxAgents<=65536,'Invalid agent capacity');
    check(record(profiles)&&record(source)&&Object.keys(source).length<=maxAgents,'Invalid creature catalog');
    for(const [key,spec] of Object.entries(profiles)){
      check(id(key)&&record(spec)&&['walk','swim','fly'].includes(spec.mode)&&
        Number.isFinite(spec.speed??1)&&(spec.speed??1)>=0&&Number.isFinite(spec.radius??.15)&&(spec.radius??.15)>=.03&&(spec.radius??.15)<=4&&
        (spec.height===undefined||Number.isFinite(spec.height)&&spec.height>=(spec.radius??.15)*2+.05&&spec.height<=12)&&
        (spec.stepUp===undefined||Number.isFinite(spec.stepUp)&&spec.stepUp>=0&&spec.stepUp<=10)&&
        (spec.drop===undefined||Number.isFinite(spec.drop)&&spec.drop>=0&&spec.drop<=16)&&
        Number.isFinite(spec.seekRange??3)&&(spec.seekRange??3)>0&&
        Number.isFinite(spec.maxWade??.14)&&(spec.maxWade??.14)>=0&&
        Number.isFinite(spec.stride??.38)&&(spec.stride??.38)>0&&
        (spec.contactLoad===undefined||Number.isFinite(spec.contactLoad)&&spec.contactLoad>=0&&spec.contactLoad<=1e12)&&
        Array.isArray(spec.limbs??[])&&(spec.limbs??[]).length<=16&&(spec.limbs??[]).every(p=>vector(p)),
        'Invalid movement profile '+key);
    }
    function checkAgent(key,spec){
      check(id(key)&&record(spec)&&own(profiles,spec.species)&&vector(spec.position)&&
        (spec.goal===undefined||vector(spec.goal))&&(spec.entity===undefined||id(spec.entity))&&
        (spec.task==null||id(spec.task))&&(spec.name===undefined||typeof spec.name==='string'&&spec.name.length<=256)&&
        (!routeQueue||spec.routePriority===undefined||RQ.priority(spec.routePriority))&&
        (spec.metadata===undefined||record(spec.metadata)),'Invalid creature '+key);
    }
    function makeAgent(key,spec){
      return {id:key,entity:spec.entity??key,species:spec.species,position:spec.position,velocity:S.zero,task:spec.task??null,
        ...(routeQueue&&profiles[spec.species].mode==='walk'&&{routePriority:spec.routePriority??0,routing:RQ.idle}),
        ...(crowd&&profiles[spec.species].mode==='walk'&&{crowd:W.crowd.clear}),
        ...(spec.name!==undefined&&{name:spec.name}),...(spec.metadata!==undefined&&{metadata:spec.metadata}),
        goal:spec.goal??spec.position,home:spec.position,direction:east,radius:profiles[spec.species].radius??.15,
        route:emptyList,cursor:0,mode:'idle',retry:0,travel:0,footprints:0,limbs:emptyList,look:profiles[spec.species].look??defaultLook};
    }
    const starting=S.edit(S.empty);
    for(const key of Object.keys(source).sort()){
      checkAgent(key,source[key]);
      initial[key]=makeAgent(key,source[key]);
      starting.add(initial[key]);
    }
    const initialRoster=starting.finish();
    const formations=config.formations===undefined?null:W.formations.create(config.formations,profiles,
      crowd?.spacing??0);
    const initialFormations=formations?.initial(name=>S.select(initialRoster,name));
    const policy = config.decisions === undefined ? null : W.agentDecisions.create(config.decisions, initial);
    const influence=config.influence===undefined?null:W.influenceChoices.configure(config.influence);
    check(!influence||config.orders!==undefined,'Influence responders need agent order tasks');
    const species=Object.keys(profiles).sort();
    const staticFit=!config.bed&&!config.support&&!config.water&&!config.clearance&&!config.habitat;
    const settled=new WeakSet();
    const replan=config.replanTicks??24;
    check(Number.isSafeInteger(replan)&&replan>=1&&replan<=10000,'Invalid movement replanning interval');
    function fit(ctx,profile,p){
      if(!zone(p,config.bounds))return null;
      const water=wet(ctx,config,p);
      if(profile.mode==='swim'){
        if(!water||water.depth<profile.radius*.65)return null;
        p=[p[0],water.surface-profile.radius*.24,p[2]];
      }
      if(profile.mode==='walk'){
        const nearest=supports(ctx,config,p[0],p[2],p[1]-(profile.drop??.5),p[1]+(profile.stepUp??.3))[0];
        if(!nearest||water&&water.surface-nearest.y>profile.maxWade)return null;
        p=[p[0],nearest.y,p[2]];
      }
      return clearance(ctx,config,V.add(p,[0,profile.mode==='walk'?profile.radius*1.1:0,0]),profile.entity)>=profile.radius?p:null;
    }
    function suitable(ctx,agent,point){
      if(!config.habitat)return true;
      const result=ctx.query.probe(config.habitat,point,{species:agent.species});
      return result.status==='ok'&&result.value.suitable;
    }
    function choose(ctx,agent,profile,allowed=()=>true){
      const point=fit(ctx,profile,agent.goal);
      if(point&&allowed(point)&&suitable(ctx,agent,point))return point;
      const max=profile.seekRange??3;
      for(const distance of [max*.2,max*.4,max*.7,max]){
        const angle=ctx.random(agent.id+'/search')*Math.PI*2;
        for(let i=0;i<8;i++){
          const a=angle+i*Math.PI/4;
          const found=fit(ctx,profile,V.add(agent.goal,[Math.cos(a)*distance,0,Math.sin(a)*distance]));
          if(found&&allowed(found)&&suitable(ctx,agent,found))return found;
        }
      }
      return null;
    }
    const profileFor = agent => ({radius:.15,maxWade:.14,entity:agent.entity,...profiles[agent.species]});
    const stepUpFor=profile=>profile.stepUp??Math.min(.3,profile.radius*.8);
    const heightFor=profile=>profile.height??Math.min(12,profile.radius*2+stepUpFor(profile)+.08);
    function* occupants(roster,reconstruct){
      for(const page of roster.pages)for(let i=0;i<page.ids.length;i++){
        const row=page.details[i], id=page.ids[i], profile=profiles[row.species];
        const saved=page.positions.slice(i*3,i*3+3), position=reconstruct?.(id,saved)??saved;
        if(row.mode==='dormant'&&position===saved)continue;
        const radius=profile.radius??.15, walking=profile.mode==='walk';
        const height=walking?heightFor({...profile,radius}):radius*2;
        const [x,y,z]=position, low=walking?y:y-radius;
        yield {id,entity:row.entity,species:row.species,generation:page.generations[i],position,radius,height,
          min:[x-radius,low,z-radius],max:[x+radius,low+height,z+radius],
          ...(row.name!==undefined&&{name:row.name}),...(row.metadata&&{metadata:row.metadata}),
          shape:{x,z,a:low+radius,b:low+height-radius,radius}};
      }
    }
    function* walkers(roster){
      for(const page of roster.pages)for(let i=0;i<page.ids.length;i++){
        const row=page.details[i], profile=profiles[row.species];
        if(profile.mode!=='walk')continue;
        const radius=profile.radius??.15;
        yield {id:page.ids[i],generation:page.generations[i],position:page.positions.slice(i*3,i*3+3),
          radius,height:heightFor({...profile,radius}),goal:row.goal,active:row.mode!=='dormant'&&row.mode!=='ride'};
      }
    }
    function plan(ctx,profile,from,goal){
      if(profile.mode!=='walk')return spatialPlan(ctx,config,from,goal,profile);
      return navigation?ctx.query.navigation(navigation).route(from,goal,profile):groundPlan(ctx,config,from,goal,profile);
    }
    function one(agent,ctx,contacts,dirty,directed=false,routes,group,arrival,speedLimit){
      const profile=profileFor(agent);
      let crowdStatus=W.crowd.clear;
      function finish(row,status,reason){
        if(group&&profile.mode==='walk'&&!W.data.equal(row.crowd,crowdStatus))row={...row,crowd:crowdStatus};
        return routes?routes.finish(row,status,reason):row;
      }
      let position=fit(ctx,profile,agent.position), previous=agent;
      if(!position){
        if(directed)return finish({...agent,mode:'blocked',route:[],cursor:0,limbs:[]},'blocked','origin-unfit');
        position=choose(ctx,{...agent,goal:agent.position},profile,
          group&&profile.mode==='walk'?point=>group.canRelocate(agent,point):undefined);
        if(!position){
          if(agent.mode!=='dormant')ctx.emit('habitat-lost',{entity:agent.entity,at:agent.position});
          return finish({...agent,mode:'dormant',route:[],cursor:0,limbs:[]},'blocked','origin-unfit');
        }
        previous={...agent,route:[],cursor:0,retry:0};
        ctx.emit('habitat-relocate',{entity:agent.entity,at:position});
      }
      let {route,cursor,retry,travel,footprints}=previous;
      const queued=routes?.target&&fit(ctx,profile,routes.target);
      const goal=directed ? fit(ctx,profile,agent.goal) :
        queued&&suitable(ctx,agent,queued)?queued:choose(ctx,agent,profile);
      const resting=!goal||directed===true&&!suitable(ctx,agent,goal)?'waiting':
        V.dist(position,goal)<(arrival??profile.radius*.65)?'rest':null;
      if(resting){
        const row=previous.mode===resting&&S.sameVector(position,previous.position)&&!route.length&&!cursor?
          previous:{...previous,position,mode:resting,route:[],cursor:0};
        return finish(row,resting==='rest'?'idle':'blocked',resting==='waiting'?'goal-unfit':undefined);
      }
      let corridor;
      const tiles=navigation&&profile.mode==='walk'&&ctx.query.navigation(navigation);
      const invalid=tiles&&route[cursor]&&!tiles.valid(position,route,cursor,goal,profile);
      let remainingCost;
      if(tiles&&dirty?.size&&!invalid){
        const area=routeArea([position,goal,...route.slice(cursor)],profile.radius+(config.cell??.25));
        if(ctx.spatial.changes(area).some(row=>dirty.has(row.field))){
          remainingCost=route[cursor]?tiles.remainingCost(position,route,cursor,profile):Infinity;
          // A valid route at the straight-line lower bound cannot be improved.
          if(remainingCost>Math.hypot(goal[0]-position[0],goal[2]-position[2])+1e-8) corridor=area;
        }
      }
      if (invalid||!tiles&&dirty&&route.length) {
        const envelope = P.spatial.boxOf([position,...route.slice(cursor)]);
        envelope.min[1] = Math.min(0,envelope.min[1]-(profile.drop??.5));
        envelope.max[1] = Math.max(0,envelope.max[1]+(profile.height??profile.radius*2));
        const area = P.spatial.expand(envelope,profile.radius);
        if (invalid||ctx.spatial.changes(area).length) corridor=area;
      }
      let status, reason;
      const canRetry=ctx.tick>=retry||routes&&previous.routing.status==='ready';
      if(corridor||routes?.target||(tiles?!route[cursor]&&canRetry:ctx.tick>=retry||!route.length)){
        const result=routes?routes.ask('travel',position,goal):plan(ctx,profile,position,goal);
        if(result.status==='pending'){
          const end=tiles.safeEnd(position,route,cursor,profile);
          if(end<route.length)route=route.slice(0,end);
          status='waiting';
        }else if(tiles&&route[cursor]&&!invalid&&
          (result.status!=='ok'||result.cost+1e-8>=(remainingCost??tiles.remainingCost(position,route,cursor,profile)))){
          if(corridor)ctx.spatial.rebuilt('agent-route',{entity:agent.entity,status:'retained'},corridor);
        }else{
          route=result.points??[];
          cursor=route.length>1?1:0;
          retry=ctx.tick+(route.length?replan:Math.min(6,replan));
          if (corridor) ctx.spatial.rebuilt('agent-route',{entity:agent.entity,status:result.status},corridor);
          status=routes&&result.status==='budget'?'limited':'blocked';
          reason=result.status;
        }
      }
      if(!route[cursor]){
        status??=routes?.active?'waiting':previous.routing?.status==='limited'?'limited':'blocked';
        return finish({...previous,position,mode:status==='waiting'||status==='limited'?'waiting':'blocked',route,cursor,retry},
          status,reason??previous.routing?.reason);
      }
      const travelLimit=Math.min(profile.speed??1,speedLimit??Infinity)*ctx.dt;
      const aim=V.sub(route[cursor],position), distance=V.len(aim), step=Math.min(distance,travelLimit);
      const desired=distance>1e-8?V.mad(position,aim,step/distance):position;
      let moved, lastSupports=[], held=false, steered=false, exited=false;
      if(profile.mode==='walk'){
        const requested=stepUpFor(profile), bodyHeight=heightFor(profile);
        const stepUp=Math.min(requested,bodyHeight-profile.radius*2-.025);
        const body=P.traversal.create({radius:profile.radius,height:bodyHeight,
          stepUp,stepDown:profile.drop??.5,
          supports:(x,z,low,high)=>supports(ctx,config,x,z,low,high,materialContacts).filter(s=>{
            const liquid=wet(ctx,config,[x,s.y,z]);
            return !liquid||liquid.surface-s.y<=profile.maxWade;
          }),
          clearance:point=>clearance(ctx,config,point,profile.entity)});
        const walk=(point,delta)=>body.move(point,delta,{trace:true});
        const result=group?group.move(agent,position,desired,route,cursor,walk,
          Math.min(travelLimit,body.maxDistance*(1-1e-12)),directed==='exit'):
          walk(position,[desired[0]-position[0],desired[2]-position[2]]);
        moved=result.foot;
        lastSupports=result.contacts;
        if(group){crowdStatus=result.crowd;held=result.held;steered=true;exited=result.exited;}
      }else moved=fit(ctx,profile,desired)??position;
      const delta=V.sub(moved,position), movedBy=V.len(delta);
      if(movedBy<1e-8&&step>1e-8&&!held)return finish({...previous,position,mode:routes?.active?'waiting':'blocked',
        route:[],cursor:0,retry:ctx.tick+1},'blocked','segment-blocked');
      if(exited){route=[];cursor=0;retry=ctx.tick+1;}
      else if(steered){
        const waypoint=route[cursor], next=route[cursor+1], gap=V.dist(moved,waypoint);
        const passed=crowdStatus.status==='avoiding'&&next&&gap<=profile.radius*2&&
          V.dot(V.sub(moved,waypoint),V.sub(next,waypoint))>0;
        if(crowdStatus.status!=='queued'&&(passed||gap<=profile.radius*.35))cursor++;
      }else if(distance<=step+profile.radius*.35)cursor++;
      const direction=movedBy>1e-8?V.norm(delta):previous.direction;
      const stride=profile.stride??.38;
      if(profile.mode==='walk'){
        let foot=position;
        for(const sample of lastSupports){
          const stepDistance=Math.hypot(sample.foot[0]-foot[0],sample.foot[2]-foot[2]);
          if(stepDistance>1e-9){
            const accumulated=travel+stepDistance,count=Math.floor(accumulated/stride);
            for(let n=0;n<count;n++){
              const at=V.lerp(foot,sample.foot,W.fields.clamp((stride-travel+n*stride)/stepDistance,0,1));
              const entry=catalog?.getMaterial(sample.material), cue=entry?.material.sounds?.step;
              const row={entity:agent.entity,point:at,support:sample.support,material:sample.material??null,weight:profile.weight??1,
                ...(cue&&{cue})};
              if(materialContacts){
                const surface=sample.surface??(entry&&W.materials.profile(entry));
                contacts.push(W.contactEffects.capture(ctx,row,contacts.length,'step',{speed:movedBy/ctx.dt,
                  load:profile.contactLoad??10,travel:stride,normal:sample.normal,heading:direction,profile:surface}));
              }else contacts.push(row);
              footprints++;
            }
            travel=accumulated-count*stride;
          }
          foot=sample.foot;
        }
      }
      const side=V.norm(V.cross(up,direction),[0,0,1]);
      const limbs=(profile.limbs??[]).map((offset,i)=>{
        const desired=V.add(V.mad(V.mad(moved,direction,offset[0]),side,offset[2]),[0,offset[1],0]);
        const ground=supports(ctx,config,desired[0],desired[2],desired[1]-.65,desired[1]+.26)[0];
        const phase=(travel/stride+i/(profile.limbs.length||1))%1;
        return {point:ground?[desired[0],ground.y+(phase>.57?Math.sin((phase-.57)*Math.PI/.43)*.09:0),desired[2]]:desired,
          planted:!!ground&&phase<=.57,support:ground?.id??null};
      });
      return finish({...previous,position:moved,direction,route,cursor,retry,mode:profile.mode,travel,footprints,limbs},'ready');
    }
    function validateRow(key,agent){
      checkAgent(key,agent);
      check(agent.id===key&&vector(agent.goal)&&vector(agent.direction)&&Array.isArray(agent.route)&&
        agent.route.every(p=>vector(p)),'Invalid agent checkpoint');
      check(orders||!own(agent,'orders'),'Unexpected saved agent orders');
      orders?.validate(agent.orders);
      check(agent.formationDriven===undefined||formations&&agent.formationDriven===true,'Invalid saved formation movement');
      check(agent.formationAfter===undefined||agent.formationDriven&&vector(agent.formationAfter),'Invalid saved exit destination');
      check(!agent.travelPlan||travel&&profiles[agent.species].mode==='walk'&&!O.holding(agent.orders),
        'Invalid walking travel controller');
      travel?.validate(agent);
      if(routeQueue&&profiles[agent.species].mode==='walk')routeQueue.validateAgent(agent);
      if(crowd&&profiles[agent.species].mode==='walk')crowd.validateAgent(agent.crowd);
    }
    function validateState(state){
      check(record(state)&&Array.isArray(state.contacts),'Invalid agent checkpoint');
      let names;
      if(own(state,'roster'))names=S.validate(state.roster,maxAgents,validateRow);
      else{
        check(record(state.agents)&&Object.keys(state.agents).length===Object.keys(source).length,'Invalid agent checkpoint');
        names=new Set(Object.keys(state.agents));
        for(const key of names){
          check(own(source,key),'Invalid agent checkpoint');
          validateRow(key,state.agents[key]);
        }
      }
      policy?.validate(state.decisions,names);
      routeQueue?.validateWork(state.routeWork);
      crowd?.validate(state.crowd);
      if(formations)formations.validate(state.formations,name=>S.select(S.get(state),name));
      travel?.ledger(travelRows(S.get(state)));
    }
    function requireAgent(roster,{agent,generation}){
      const slot=S.find(roster,agent);
      check(slot,'Unknown live agent '+agent);
      const row=S.read(roster,slot);
      check(generation===undefined||generation===row.generation,'Stale agent generation for '+agent);
      return {slot,row};
    }
    function packed(roster,contacts,decisions,routeWork=RQ.initial,crossings=crowd?.initial,formationState=initialFormations){
      return freeze({roster,contacts,...(policy&&{decisions}),...(routeQueue&&{routeWork}),...(crowd&&{crowd:crossings}),...(formations&&{formations:formationState})});
    }
    function* pendingRows(roster){
      for(const [p,page] of roster.pages.entries())for(let i=0;i<page.ids.length;i++){
        const {routing,routePriority}=page.details[i];
        if(routing?.request)yield {id:page.ids[i],generation:page.generations[i],routing,routePriority,slot:{p,i}};
      }
    }
    function* travelRows(roster){
      for(const [p,page] of roster.pages.entries())for(let i=0;i<page.ids.length;i++)
        if(page.details[i].travelPlan)yield S.read(roster,{p,i});
    }
    function syncRiders(state,ctx){
      const roster=S.get(state), frames=new Map();
      let draft;
      for(const [p,page] of roster.pages.entries())for(let i=0;i<page.ids.length;i++){
        if(page.details[i].travelPlan?.phase!=='riding')continue;
        const slot={p,i}, row=S.read(roster,slot), next=travel.carry(row,ctx,frames);
        if(next!==row)(draft??=S.edit(roster)).update(slot,row,next);
      }
      return draft?{...state,roster:draft.finish()}:state;
    }
    function holdTravel(row,position=row.position){
      if(row.mode==='rest'&&S.sameVector(position,row.position)&&S.sameVector(position,row.goal)&&!row.route.length&&
        (!row.routing||row.routing.status==='idle')&&
        (!row.crowd||row.crowd.status==='clear'))return row;
      return {...row,position,goal:position,route:emptyList,cursor:0,retry:0,mode:'rest',
        ...(row.routing&&{routing:RQ.idle}),...(row.crowd&&{crowd:W.crowd.clear})};
    }
    function finishTravel(row,position){
      const {travelPlan,...free}=row;
      return holdTravel(free,position);
    }
    function travelMotion(ctx,contacts,dirty,group,schedule,agent){
      const profile=profileFor(agent), arrival=profile.radius*.65, height=heightFor(profile);
      const ground=point=>fit(ctx,profile,point);
      return {
        fit:ground,hold:holdTravel,release:finishTravel,
        seatClear(point,otherPoint,other){
          const [x,y,z]=V.sub(point,otherPoint);
          return Math.hypot(x,z)>=profile.radius+other.radius+(crowd?.spacing??0)||
            y>=heightFor(profileFor(other))||y<=-height;
        },
        arrived(row,target,next){
          const point=ground(target);
          if(!point||row.crowd?.status==='queued')return false;
          const gap=V.dist(row.position,point);
          return gap<=arrival+1e-7||next&&row.crowd?.status==='avoiding'&&gap<=profile.radius*2&&
            V.dot(V.sub(row.position,point),V.sub(next,target))>0;
        },
        walk(row,target){
          const controlled=S.sameVector(target,row.goal)?row:{...row,goal:target,route:emptyList,cursor:0,retry:0,
            ...(row.routing&&{routing:RQ.idle})};
          return one(controlled,ctx,contacts,dirty,true,controlled.routing&&schedule?.session(controlled),group,arrival);
        },
        transfer(row,from,to,carrier){
          if(group&&!group.canTransfer(row,from,to))return false;
          if(!config.clearance)return true;
          const exclude=carrier?[row.entity,carrier]:row.entity;
          const steps=Math.max(1,Math.ceil(V.dist(from,to)/Math.max(.02,profile.radius*.5)));
          const levels=Math.max(1,Math.ceil((height-2*profile.radius)/profile.radius));
          for(let i=0;i<=steps;i++){
            const point=V.lerp(from,to,i/steps);
            for(let j=0;j<=levels;j++){
              const offset=profile.radius+.001+(height-2*profile.radius)*j/levels;
              if(clearance(ctx,config,V.add(point,[0,offset,0]),exclude)<profile.radius-1e-7)return false;
            }
          }
          return true;
        }
      };
    }
    function replace(state,args,update,decisions=state.decisions){
      const roster=S.get(state), {slot,row}=requireAgent(roster,args), draft=S.edit(roster);
      draft.update(slot,row,update(row));
      return packed(draft.finish(),state.contacts,decisions,state.routeWork,state.crowd,state.formations);
    }
    function changeOrders(row,orders){
      const switched=orders.active!==(row.orders?.active??null);
      const {formationAfter,...controlled}=row;
      return {...(switched?controlled:row),orders,...(switched&&{route:emptyList,cursor:0,retry:0,
        ...(row.routing&&{routing:RQ.idle})})};
    }
    function* pendingTransfers(roster){
      for(const slot of S.order(roster)){
        if(roster.pages[slot.p].details[slot.i].orders?.active?.phase!=='settling')continue;
        const row=S.read(roster,slot);
        yield {slot,row,request:orders.pending(row)};
      }
    }
    const reservationRoster=state=>S.get(W.simulationAggregate.isAggregate(state)?state.data:state);
    const reservationRows=new WeakMap();
    function reservations(state){
      const roster=reservationRoster(state);
      if(reservationRows.has(roster))return reservationRows.get(roster);
      const rows=[];
      for(const page of roster.pages)for(const [i,row] of page.details.entries()){
        if(!row.orders)continue;
        const {active,paused}=row.orders;
        if(active?.reservation)rows.push({agent:page.ids[i],generation:page.generations[i],entry:active,paused:false});
        for(const entry of paused)if(entry.reservation)
          rows.push({agent:page.ids[i],generation:page.generations[i],entry,paused:true});
      }
      reservationRows.set(roster,rows);
      return rows;
    }
    function byEntity(roster,entity){
      let index=aliases.get(roster);
      if(!index){
        index=new Map();
        for(const slot of S.order(roster)){
          const {entity,mode}=roster.pages[slot.p].details[slot.i];
          if(mode!=='dormant'&&!index.has(entity))index.set(entity,slot);
        }
        aliases.set(roster,index);
      }
      const slot=index.get(entity);
      return slot&&S.read(roster,slot);
    }
    function agentField(type,select,units){
      return {type,selector:true,qualified:true,...(units&&{units}),read({state,args,target}){
        const roster=S.get(state), name=args.agent??target?.agent;
        const row=name!==undefined?S.select(roster,name):target?.entity&&byEntity(roster,target.entity);
        return row&&(args.generation===undefined||args.generation===row.generation)?
          Q.ok(select(row)):Q.missing('unknown live agent or generation','missing');
      }};
    }
    function spawnAgent(state,args,ctx){
        const roster=S.get(state), {agent}=args;
        check(!S.find(roster,agent),'Agent already exists '+agent);
        check(S.count(roster)<maxAgents,'Agent capacity exceeded');
        const row=makeAgent(agent,args), draft=S.edit(roster), generation=draft.add(row);
        ctx.emit('agent-spawned',{agent,entity:row.entity,generation,at:row.position});
        const decisions=policy?.managed(agent)?{...state.decisions,[agent]:policy.initial[agent]}:state.decisions;
        return packed(draft.finish(),state.contacts,decisions,state.routeWork,state.crowd,state.formations);
      }
    function checkRecruit(args){
      check(record(args)&&Object.keys(args).every(key=>['prefix','species','at','name','task','metadata'].includes(key))&&
        id(args.prefix)&&args.prefix.length<=80&&W.worksites.target(args.at),'Invalid recruitment effect');
      checkAgent(args.prefix,{...args,position:S.zero});
    }
    function placedSpawn(state,args,ctx){
      const {agent}=args, roster=S.get(state);
      if(S.find(roster,agent))return {reason:'recruit-id-in-use'};
      if(S.count(roster)>=maxAgents)return {reason:'recruit-roster-full'};
      const at=W.worksites.frame(ctx.query,args.at)?.point, profile=profileFor({species:args.species,entity:agent});
      const position=at&&fit(ctx,profile,at);
      if(!position)return {reason:'recruit-site-unfit'};
      const radius=profile.radius;
      const center=profile.mode==='walk'?V.add(position,[0,radius+.001,0]):position;
      const {results:[space]}=ctx.query.spatialBatch({queries:[{op:'occupancy',at:center,radius,kinds:['agent','body'],clearance:[]}]});
      if(space.state!=='free')return {reason:'recruit-site-occupied'};
      return {state:spawnAgent(state,{...args,agent,position},ctx)};
    }
    function recruit(state,args,batch,ctx){
      return placedSpawn(state,{...args,agent:args.prefix+'.'+batch},ctx);
    }
    function despawnAgent(state,args,ctx){
      const roster=S.get(state), {slot,row}=requireAgent(roster,args), draft=S.edit(roster);
      const decisions=policy&&{...state.decisions};
      if(decisions)delete decisions[row.id];
      if(O.runnable(row.orders))orders.cancel(row.orders,undefined,row,ctx,'despawned');
      draft.remove(slot);
      ctx.emit('agent-despawned',{agent:row.id,entity:row.entity,generation:row.generation,at:row.position});
      const formationState=formations?.discard(state.formations,row,ctx);
      return packed(draft.finish(),state.contacts,decisions,state.routeWork,state.crowd,formationState);
    }
    return {initial:()=>packed(initialRoster,[],policy?.initial),
    shareCheckpoint:true,viewState:S.view,legacyCheckpoint:S.legacyState,dependencies:routeDependencies(config),
    ...(navigation&&{navigationReads}),
    populationActor:{
      check(name){check(own(profiles,name),'Unknown population actor species '+name);},
      read(state,name,generation){
        const row=S.select(S.get(state),name);
        return row&&(generation===undefined||row.generation===generation)?row:undefined;
      },
      spawn:placedSpawn,remove:despawnAgent
    },
    ...(influence&&{influenceResponder:{
      config:influence,check:orders.checkIssue,
      rows(state){
        const roster=S.get(state), rows=[];
        for(const {agent,profile,wallet} of influence.members){
          const row=S.select(roster,agent);
          if(!row)continue;
          const decision=state.decisions?.[agent], group=formations?.active(state.formations,row);
          const available=row.mode==='dormant'?'agent-unavailable':O.holding(row.orders)||row.travelPlan||row.formationDriven||group?
            'agent-busy':policy?.committed(decision)?'activity-committed':true;
          rows.push({row,profile,wallet,available,context:{...row,needs:decision?.needs??{},
            activity:decision?.choice?.activity??null,phase:decision?.phase??null}});
        }
        return rows;
      },
      route(row,point,ctx){
        const profile=profileFor(row), from=fit(ctx,profile,row.position), goal=fit(ctx,profile,point);
        if(!from||!goal)return 'unfit';
        const route=plan(ctx,profile,from,goal);
        return route.status==='ok'&&route.points.length?'ok':route.status==='ok'?'empty':route.status;
      },
      issue(state,row,order,ctx){
        const book=orders.issue(row,{order},ctx);
        const decisions=policy?.managed(row.id)?{...state.decisions,[row.id]:
          policy.release(state.decisions[row.id],row,ctx,'order-issued')??policy.initial[row.id]}:state.decisions;
        return {sequence:book.serial,state:replace(state,{agent:row.id,generation:row.generation},
          agent=>changeOrders(agent,book),decisions)};
      },
      status(state,owner){
        const row=S.select(reservationRoster(state),owner.agent);
        if(row?.generation!==owner.generation||!row.orders)return undefined;
        const {active,paused,queue,outcomes}=row.orders;
        if([active,...paused,...queue].some(entry=>entry?.sequence===owner.sequence))return 'active';
        return outcomes.find(entry=>entry.sequence===owner.sequence)?.phase;
      }
    }}),
    ...((crowd||travel?.hasRides)&&{inputs:{...crowd?.inputs,...travel?.inputs}}),
    ...(travel?.hasRides&&{afterStep:syncRiders}),
    workEffects:{recruit:{check:checkRecruit,run:recruit}},
    occupancy:{
      kind:'agent',key:S.get,rows:state=>occupants(S.get(state)),
      distance:({x,z,a,b,radius},point)=>Math.hypot(point[0]-x,
        point[1]-W.fields.clamp(point[1],a,b),point[2]-z)-radius
    },
    simulationAggregate(settings){
      return W.aggregatePopulation.cohorts(settings,
        {profiles,fit,bounds:config.bounds,contacts:config.contactEvents,validateState,occupants,blockedCoarse:crowd?.blockedCoarse,
          formationActive:formations?.active,syncRiders:travel?.hasRides?syncRiders:undefined});
    },
    ...(config.contactEvents&&{outputs:{contacts:'event'},output:state=>({contacts:state.contacts})}),
    ...(orders&&{orderWork:{check:orders.checkWork,*rows(state,ctx){
      const roster=S.get(state);
      for(const slot of S.order(roster)){
        if(roster.pages[slot.p].details[slot.i].orders?.active?.phase!=='working')continue;
        const request=orders.workRequest(ctx,S.read(roster,slot));
        if(request)yield request;
      }
    }},reservationOrders:{
      check:orders.checkReservations,rows:reservations,
      outcome(state,owner){
        const row=S.select(reservationRoster(state),owner.agent);
        if(!row?.orders||row.generation!==owner.generation)return null;
        return row.orders.lastReservedSuccess===owner.sequence?{phase:'succeeded'}:
          row.orders.outcomes.find(entry=>entry.sequence===owner.sequence);
      }
    }}),
    ...(orders?.hasTransfers&&{
      checkTransfers:orders.checkTransfers,
      requestTransfers(state,ctx,budget){
        const requests=[];
        if(budget>0)for(const {row,request} of pendingTransfers(S.get(state))){
          const entry=row.orders.active;
          if(entry.reservation&&orders.claim(ctx,row,entry)?.status!=='held'||orders.transferBlocker(ctx,row,request))continue;
          requests.push(request);
          if(requests.length===budget)break;
        }
        return requests;
      },
      receiveTransfers(state,receipts,ctx){
        const roster=S.get(state), draft=S.edit(roster);
        const pending=new Map(receipts.map(receipt=>[receipt.requestId,receipt]));
        for(const {slot,row,request} of pendingTransfers(roster)){
          const receipt=pending.get(request.id);
          if(!receipt)continue;
          draft.update(slot,row,{...row,orders:orders.receive(row,receipt,ctx)});
          pending.delete(request.id);
          if(!pending.size)break;
        }
        check(!pending.size,'Transfer receipts could not be matched to active orders');
        return packed(draft.finish(),state.contacts,state.decisions,state.routeWork,state.crowd,state.formations);
      }
    }),
    ...(orders?.hasInteractions&&{orderInteractions:{
      check:orders.checkInteractions,
      *rows(state,ctx){
        const roster=S.get(state);
        for(const slot of S.order(roster)){
          if(roster.pages[slot.p].details[slot.i].orders?.active?.phase!=='interacting')continue;
          const request=orders.interactionRequest(ctx,S.read(roster,slot));
          if(request)yield request;
        }
      },
      receive(state,{actor,sequence,step},outcome,ctx){
        const roster=S.get(state), slot=S.find(roster,actor.id), row=slot&&S.read(roster,slot);
        check(row?.generation===actor.generation&&row.orders?.active?.sequence===sequence&&
          row.orders.active.step===step,'Interaction result does not match the active order');
        const draft=S.edit(roster);
        draft.update(slot,row,{...row,orders:orders.receiveInteraction(row,outcome,ctx)});
        return packed(draft.finish(),state.contacts,state.decisions,state.routeWork,state.crowd,state.formations);
      }
    }}),
    ...((config.surface!==undefined||policy||orders)&&{checkFields(query){
      if(config.surface!==undefined)W.materials.checkSurface(query,config.surface);
      policy?.checkFields(query);
      orders?.checkFields(query);
    }}),validateState,checkAction(type,args){
      if(formations&&W.formations.actions.includes(type))return formations.checkAction(type,args);
      if(type==='spawn'){
        checkAgent(args.agent,args);
        check(args.generation===undefined,'Agent generations are assigned at spawn');
        return;
      }
      check(id(args.agent)&&(args.generation===undefined||Number.isSafeInteger(args.generation)&&args.generation>0),
        'Invalid agent selector');
      if(travel&&W.agentTravel.actions.includes(type))travel.checkAction(type,args);
      if(type==='issue-order')orders.checkIssue(args);
      if(type==='cancel-order')orders.checkCancel(args);
      if(type==='set-need')policy.checkNeed(args);
      if(type==='seek'){
        check(vector(args.to),'Invalid creature destination');
        check(args.priority===undefined||routeQueue&&RQ.priority(args.priority),'Invalid route request priority');
        check(!policy?.managed(args.agent),'The activity policy owns this creature destination');
      }
      if(type==='set-task'){
        check(args.task===null||id(args.task),'Invalid agent task');
        check(!policy?.managed(args.agent),'The activity policy owns this creature task');
      }
    },actions:{
      ...(travel&&Object.fromEntries(W.agentTravel.actions.map(type=>[type,(state,args,ctx)=>
        replace(state,args,row=>{
          check(profiles[row.species].mode==='walk'&&!O.holding(row.orders)&&!row.formationDriven&&
            !formations?.active(state.formations,row),'Shared travel needs a walker with control of its movement');
          check(row.mode!=='ride','This walker is riding to its exit dock');
          const travelPlan=travel.start(type,args,row,ctx), free=finishTravel(row,row.position);
          return travelPlan?{...free,travelPlan}:free;
        })]))),
      ...(policy?.hasNeeds&&{'set-need'(state,args,ctx){
        const roster=S.get(state), {row}=requireAgent(roster,args);
        const decisions={...state.decisions,
          [row.id]:policy.setNeed(state.decisions[row.id],row,args,ctx,!O.holding(row.orders)&&!row.formationDriven)};
        return packed(roster,state.contacts,decisions,state.routeWork,state.crowd,state.formations);
      }}),
      ...(formations&&Object.fromEntries(W.formations.actions.map(type=>[type,(state,args,ctx)=>{
        const roster=S.get(state);
        const result=formations.edit(state.formations,type,args,name=>S.select(roster,name),ctx);
        return packed(roster,state.contacts,state.decisions,state.routeWork,state.crowd,result);
      }]))),
      ...(orders&&{
        'issue-order'(state,args,ctx){
          const {row}=requireAgent(S.get(state),args);
          check(!row.travelPlan,'Cancel shared travel before issuing an order');
          let decisions=state.decisions;
          if(policy?.managed(args.agent)){
            decisions={...decisions,[row.id]:policy.release(decisions[row.id],row,ctx,'order-issued')??policy.initial[row.id]};
          }
          return replace(state,args,row=>changeOrders(row,orders.issue(row,args,ctx)),decisions);
        },
        'cancel-order'(state,args,ctx){
          return replace(state,args,row=>{
            const book=row.orders??O.blank, next=orders.cancel(book,args.order,row,ctx);
            return next===book?row:changeOrders(row,next);
          });
        }
      }),
      spawn:spawnAgent,
      despawn:despawnAgent,
      seek(state,args,ctx){
        return replace(state,args,row=>{
          check(!O.holding(row.orders),'Pending orders own this creature destination');
          check(!formations?.active(state.formations,row),'Detach from the active formation before using seek');
          check(row.mode!=='ride','This walker is riding to its exit dock');
          ctx.emit('destination',{entity:row.entity,at:args.to});
          const {formationDriven,formationAfter,travelPlan,...individual}=row;
          const crossing=formationDriven&&Object.values(state.crowd??{}).some(gate=>gate.holders.some(holder=>
            holder.agent===row.id&&holder.generation===row.generation&&holder.entered));
          return {...individual,goal:args.to,route:[],cursor:0,retry:0,
            ...(crossing&&{formationDriven:true,formationAfter:args.to}),
          ...(row.routing&&{routing:RQ.idle,routePriority:args.priority??row.routePriority})};
        });
      },
      'set-task'(state,args){
        return replace(state,args,row=>{
          check(!O.holding(row.orders),'Pending orders own this creature task');
          return {...row,task:args.task};
        });
      }
    },step(state,ctx){
      const roster=S.get(state), draft=S.edit(roster);
      const contacts=[], decisions=policy?{}:null;
      const changes=ctx.spatial?.changes();
      const dirty=changes?.length&&(navigationReads?new Set(navigationReads.map(field=>ctx.query.field(field)?.name)):true);
      const skipRest=staticFit&&settled.has(roster);
      const group=crowd?.begin(state.crowd,walkers(roster),ctx);
      const itinerary=travel?.begin(travelRows(roster),ctx);
      const formation=formations?.begin(state.formations,ctx,{
        read:name=>S.select(roster,name),profile:profileFor,
        fit:(profile,point)=>fit(ctx,profile,point),
        route:(profile,from,goal)=>plan(ctx,profile,from,goal),passage:crowd?.blockedCoarse
      });
      const schedule=routeQueue?.begin(pendingRows(roster),ctx.tick,state.routeWork,({slot},job)=>{
        const agent=S.read(roster,slot);
        const profile=profileFor(agent), from=fit(ctx,profile,agent.position);
        return {from,result:from?plan(ctx,profile,from,job.to):{status:'origin-unfit'}};
      });
      function store(slot,before,next,task=next.task){
        group?.commit(next);
        const velocity=S.sameVector(before.position,next.position)?S.zero:
          next.position.map((n,i)=>(n-before.position[i])/ctx.dt);
        if(before===next&&before.task===task&&S.sameVector(before.velocity,velocity))return;
        draft.update(slot,before,{...next,velocity,task});
      }
      for(const slot of S.order(roster)){
        const key=slot.id, managed=policy?.managed(key);
        const detail=roster.pages[slot.p].details[slot.i], book=orders&&detail.orders;
        const guide=formation?.guides.get(key);
        if(!managed&&!O.holding(book)&&!guide&&!detail.formationDriven&&!detail.travelPlan&&skipRest&&S.atRest(roster,slot))continue;
        const agent=S.read(roster,slot);
        const external=O.holding(book)||guide||agent.formationDriven||agent.travelPlan;
        const decision=managed&&policy.update(state.decisions[key],agent,ctx,!external);
        if(agent.travelPlan){
          store(slot,agent,itinerary.step(agent,travelMotion(ctx,contacts,dirty,group,schedule,agent)));
          if(managed)decisions[key]=policy.release(decision,agent,ctx,'shared-travel')??policy.initial[key];
          continue;
        }
        if(external){
          const profile=profileFor(agent), exit=group?.exitGoal(agent);
          function drive(row,goal,task,priority,direction,arrival,pace){
            const nextPriority=row.routing?(priority??book?.priorPriority??row.routePriority):undefined;
            const changed=!S.sameVector(goal,row.goal)||row.routePriority!==nextPriority;
            const directed=changed?{...row,goal,route:emptyList,cursor:0,retry:0,
              ...(row.routing&&{routing:RQ.idle,routePriority:nextPriority})}:row;
            const next=one(directed,ctx,contacts,dirty,direction,directed.routing&&schedule?.session(directed),group,arrival,pace);
            return next.task===task?next:{...next,task};
          }
          function hold(row,task,priority){
            if(exit)return {clearing:true,agent:drive(row,exit,task,priority,'exit')};
            const idle=!row.routing||row.routing.status==='idle'&&(priority===undefined||row.routePriority===priority);
            if(idle&&row.mode==='rest'&&S.sameVector(row.position,row.goal)&&!row.route.length&&row.task===task)return {agent:row};
            return {agent:{...row,goal:row.position,route:emptyList,cursor:0,retry:0,mode:'rest',task,
              ...(row.routing&&{routing:RQ.idle,routePriority:priority??row.routePriority}),...(row.crowd&&{crowd:W.crowd.clear})}};
          }
          if(!O.holding(book)){
            let moved;
            if(guide?.point){
              const goal=fit(ctx,profile,guide.point);
              const safeExit=exit&&(!goal||V.dot(V.sub(goal,exit),V.sub(exit,agent.position))<0);
              moved=safeExit?drive(agent,exit,agent.task,undefined,'exit'):
                goal?drive(agent,goal,agent.task,undefined,'formation',undefined,guide.pace):hold(agent,agent.task).agent;
            }else if(!guide&&!exit&&agent.formationAfter){
              const {formationDriven,formationAfter,...individual}=agent;
              const directed={...individual,goal:formationAfter,route:emptyList,cursor:0,retry:0,
                ...(agent.routing&&{routing:RQ.idle})};
              moved=one(directed,ctx,contacts,dirty,false,directed.routing&&schedule?.session(directed),group);
            }else moved=hold(agent,agent.task).agent;
            if(guide||exit){
              if(guide&&moved.formationAfter){
                const {formationAfter,...controlled}=moved;
                moved=controlled;
              }
              if(!moved.formationDriven)moved={...moved,formationDriven:true};
            }else{
              const {formationDriven,formationAfter,...individual}=moved;
              moved=individual;
            }
            store(slot,agent,moved);
            if(managed)decisions[key]=policy.release(decision,agent,ctx,'formation-controlled')??policy.initial[key];
            continue;
          }
          const execution=orders.advance(book,agent,ctx,{hold,move(row,point,order,range){
            if(exit)return {phase:'moving',reason:'crossing',agent:drive(row,exit,order.task,order.priority,'exit')};
            const goal=fit(ctx,profile,point);
            if(!goal)return {...hold(row,order.task),phase:'blocked',reason:'target-unfit'};
            const arrival=Math.min(range??Infinity,profile.radius*.65);
            const moved=drive(row,goal,order.task,order.priority,'order',arrival);
            const route=moved.routing?.status;
            if(moved.crowd?.status==='queued')return {agent:moved,phase:'waiting',reason:'crossing'};
            const blocked=['waiting','blocked','dormant'].includes(moved.mode);
            if(!blocked&&V.dist(moved.position,goal)<=arrival+1e-6)
              return {agent:moved,arrived:true};
            if(['waiting','safe-segment','limited'].includes(route))
              return {agent:moved,phase:'waiting',reason:route==='limited'?'route-budget':'route-request'};
            return {agent:moved,phase:blocked?'blocked':'moving',reason:blocked?moved.routing?.reason??'movement-blocked':null};
          }});
          store(slot,agent,{...execution.row,orders:execution.book});
          if(managed)decisions[key]=decision;
          continue;
        }
        const routes=agent.routing&&schedule?.session(agent);
        if(!managed){
          store(slot,agent,one(agent,ctx,contacts,dirty,false,routes,group));
          continue;
        }
        const profile=profileFor(agent);
        let origin;
        const movement={
          fit(point){
            const fitted=fit(ctx,profile,point);
            return fitted&&suitable(ctx,agent,fitted)?fitted:null;
          },
          plan(goal){
            if(origin===undefined)origin=fit(ctx,profile,agent.position);
            return origin?(routes?routes.ask('activity',origin,goal):plan(ctx,profile,origin,goal)):
              {status:'origin-unfit',points:[]};
          }
        };
        const {next,route,pending}=policy.select(decision,agent,ctx,movement);
        if(!next.choice){
          const row={...agent,goal:agent.position,route:[],cursor:0,mode:pending?'waiting':'rest'};
          store(slot,agent,routes?routes.finish(row,'idle'):row,null);
          decisions[key]=next;
          continue;
        }
        if(next.phase==='blocked'&&!pending){
          store(slot,agent,routes?routes.finish(agent,'blocked','activity-blocked'):agent,next.choice.activity);
          decisions[key]=next;
          continue;
        }
        const directed=route?{...agent,goal:next.choice.point,route,cursor:route.length>1?1:0,retry:ctx.tick+replan}:agent;
        const moved=one(directed,ctx,contacts,dirty,true,routes,group);
        decisions[key]=pending||['waiting','safe-segment','limited'].includes(moved.routing?.status)?
          next:policy.observe(next,moved,ctx,movement);
        store(slot,agent,moved,decisions[key].choice?.activity??null);
      }
      const next=draft.finish();
      if(staticFit)settled.add(next);
      return packed(next,contacts,decisions,schedule?.work,group?.finish(),formation?.state);
    },*poseEntities(state){
      if(state)for(const page of S.get(state).pages)for(const row of page.details)yield row.entity;
    },pose(state,entity){
      return state&&byEntity(S.get(state),entity);
    },fields:{
      agents:{type:'record',read:({state})=>Q.ok(S.rows(S.get(state)))},
      agent:agentField('record',row=>row),
      position:agentField('vector',row=>row.position,'world'),
      velocity:agentField('vector',row=>row.velocity,'world/s'),
      task:agentField('categorical',row=>row.task),
      ...(travel&&{'travel-status':agentField('record',row=>row.travelPlan??W.agentTravel.idle)}),
      ...(travel?.hasRides&&{rides:{type:'record',qualified:true,read:ctx=>
        Q.ok(travel.report(travelRows(S.get(ctx.state)),ctx))}}),
      ...(orders&&{
        orders:agentField('record',row=>row.orders??O.blank),
        'order-tasks':{type:'record',qualified:true,read:()=>Q.ok(orders.tasks)}
      }),
      ...(formations&&{formations:{type:'record',qualified:true,selector:true,read({state,args}){
        const roster=S.get(state), report=row=>formations.describe(row,name=>S.select(roster,name));
        if(args.group===undefined)return Q.ok(Object.fromEntries(Object.entries(state.formations).map(([name,row])=>
          [name,report(row)])));
        return own(state.formations,args.group)?Q.ok(report(state.formations[args.group])):Q.missing('unknown formation','missing');
      }}}),
      ...(crowd&&{
        'crowd-status':agentField('record',row=>row.crowd??W.crowd.clear),
        bottlenecks:{type:'record',qualified:true,read:({state,signals,system})=>Q.ok(Object.fromEntries(
          Object.entries(crowd.report(state.crowd)).map(([name,row])=>[name,{...row,open:{
            a:signals[system+'/open.'+name+'.a'],b:signals[system+'/open.'+name+'.b']
          }}])))}
      }),
      ...(routeQueue&&{
        'route-status':agentField('record',row=>row.routing??RQ.idle),
        'route-queue':{type:'record',qualified:true,read:({state})=>Q.ok(routeQueue.report(pendingRows(S.get(state)),state.routeWork))}
      }),
      components:{type:'record',qualified:true,read({state,args}){
        const roster=S.get(state), page=args.page;
        if(page!==undefined&&(!Number.isSafeInteger(page)||page<0||page>=roster.pages.length))
          return Q.missing('unknown component page','missing');
        const batch=page===undefined?roster.pages:[roster.pages[page]];
        return Q.ok({total:S.count(roster),pageCount:roster.pages.length,taskNames:roster.taskNames,
          pages:batch.map(({ids,generations,positions,velocities,tasks},i)=>
            ({index:page??i,ids,generations,positions,velocities,tasks}))});
      }},
      population:{type:'record',read:({state})=>Q.ok(W.aggregatePopulation.population(S.get(state),species))},
      contacts:{type:'records',units:'world',read:({state})=>Q.ok(state.contacts)},
      ...(policy&&{decisions:{type:'record',read:({state})=>Q.ok(state.decisions)}}),
      ...(policy?.hasNeeds&&{needs:{type:'record',qualified:true,selector:true,read:({state,args,target})=>{
        const roster=S.get(state), row=args.agent!==undefined?S.select(roster,args.agent):
          target?.entity&&byEntity(roster,target.entity);
        const decision=row&&state.decisions[row.id];
        return decision&&(args.generation===undefined||args.generation===row.generation)?
          Q.ok({agent:row.id,generation:row.generation,tick:decision.needTick,values:decision.needs}):
          Q.missing('unknown managed agent or generation','missing');
      }}})
    },...(policy&&{traces:{why:{run({state,args,target}){
      const name=args.agent??target.entity;
      const roster=S.get(state);
      const key=own(state.decisions,name) ? name : Object.keys(state.decisions).find(key=>S.select(roster,key)?.entity===name);
      const decision=own(state.decisions,key) ? state.decisions[key] : null;
      return decision ? Q.ok(decision) : Q.missing('unknown managed agent','missing');
    }}}})};
  }
  W.runtime.register('navigation',navigation);
  W.runtime.register('habitat',habitat);
  W.runtime.register('agents',agents);
  W.movement=Object.freeze({groundPlan,spatialPlan});
})(KIT);
