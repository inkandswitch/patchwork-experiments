/* Cohort motion over a shared, immutable identity archive. */
(function(K){
  const W=K.world, Q=W.query, V=K.V, {check,own,record,vector}=W.data, freeze=K.procedural.data.freeze;

  function population(roster,species){
    const counts=Object.fromEntries(species.map(key=>[key,0]));
    for(const page of roster.pages)for(const row of page.details)counts[row.species]++;
    return {total:W.agentStorage.count(roster),counts};
  }
  function cohorts(settings,{profiles,fit,bounds,contacts,validateState,occupants,blockedCoarse,formationActive,syncRiders}){
    const S=W.agentStorage, aliases=new WeakMap();
    const {clamp}=W.fields;
    const {model,cell=12,goalCell=cell}=settings;
    check(model==='cohorts'&&Object.keys(settings).every(key=>['model','cell','goalCell'].includes(key))&&
      [cell,goalCell].every(n=>Number.isFinite(n)&&n>=.01&&n<=1e6),'Invalid cohort aggregation cells');
    const species=Object.keys(profiles).sort();
    function reduce(state){
      const {decisions}=state, roster=S.get(state);
      const collections=new Map();
      for(const slot of S.order(roster)){
        const row=S.read(roster,slot);
        const holdsOrder=W.agentOrders.holding(row.orders)||row.travelPlan||row.formationDriven||formationActive?.(state.formations,row);
        const goal=holdsOrder?row.position:row.goal;
        const key=[row.species,holdsOrder?'orders':'motion',...row.position.map(n=>Math.floor(n/cell)),...goal.map(n=>Math.floor(n/goalCell))].join('/');
        if(!collections.has(key))collections.set(key,{species:row.species,members:[],sum:[0,0,0],destination:[0,0,0]});
        const group=collections.get(key);
        group.members.push(row.id);
        for(let i=0;i<3;i++){group.sum[i]+=row.position[i];group.destination[i]+=goal[i];}
      }
      const memberGroup={}, groups=[];
      for(const {species,members,sum,destination} of collections.values()){
        const index=groups.length, origin=V.mul(sum,1/members.length);
        for(const id of members)memberGroup[id]=index;
        groups.push({species,members,origin,position:origin,goal:V.mul(destination,1/members.length),distance:0});
      }
      return freeze({roster,...(decisions&&{decisions}),...(state.routeWork&&{routeWork:state.routeWork}),
        ...(state.crowd&&{crowd:state.crowd}),...(state.formations&&{formations:state.formations}),groups,memberGroup});
    }
    function memberPosition(group,position){
      return group.distance?position.map((n,i)=>clamp(n+group.position[i]-group.origin[i],bounds.min[i],bounds.max[i])):position;
    }
    function individual(state,row){
      const group=state.groups[state.memberGroup[row.id]];
      if(!group.distance)return group.velocity?{...row,velocity:group.velocity}:row;
      const position=memberPosition(group,row.position);
      return {...row,position,direction:V.norm(V.sub(group.position,group.origin),row.direction),
        velocity:group.velocity??S.zero,mode:profiles[row.species].mode,route:[],cursor:0,retry:0,limbs:[],
        ...(row.routing&&{routing:row.routing.request?{...row.routing,status:'waiting'}:W.routeRequests.idle}),
        ...(row.crowd&&{crowd:W.crowd.clear})};
    }
    function expand(state){
      const roster=S.get(state), draft=S.edit(roster);
      for(const slot of S.order(roster)){
        const row=S.read(roster,slot);
        draft.update(slot,row,individual(state,row));
      }
      return freeze({roster:draft.finish(),contacts:[],...(state.decisions&&{decisions:state.decisions}),
        ...(state.routeWork&&{routeWork:state.routeWork}),...(state.crowd&&{crowd:state.crowd}),
        ...(state.formations&&{formations:state.formations})});
    }
    function totals(state,isAggregate){
      if(!isAggregate)return population(S.get(state),species);
      const counts=Object.fromEntries(species.map(key=>[key,0]));
      let total=0;
      for(const row of state.groups){counts[row.species]+=row.members.length;total+=row.members.length;}
      return {total,counts};
    }
    return {
      quantities:{population:{units:'count',exact:true},species:{units:'count by species',exact:true}},
      measure(state,isAggregate){
        const {total,counts}=totals(state,isAggregate);
        return {population:total,species:species.map(key=>counts[key])};
      },
      reduce,expand,
      validate(state){
        check(record(state?.memberGroup)&&Array.isArray(state.groups),'Invalid cohort identity archive');
        validateState({...state,contacts:[]});
        const roster=S.get(state), count=S.count(roster);
        check(Object.keys(state.memberGroup).length===count,'Invalid cohort identity archive');
        const identity=new Map();
        for(const page of roster.pages)for(let i=0;i<page.ids.length;i++)identity.set(page.ids[i],page.details[i].species);
        const seen=new Set();
        check(state.groups.length<=count&&state.groups.every((row,index)=>
          record(row)&&own(profiles,row.species)&&vector(row.origin)&&vector(row.position)&&vector(row.goal)&&
          (row.velocity===undefined||vector(row.velocity))&&
          Number.isFinite(row.distance)&&row.distance>=0&&Array.isArray(row.members)&&row.members.length>0&&
          row.members.every(name=>{
            if(seen.has(name)||state.memberGroup[name]!==index||identity.get(name)!==row.species)return false;
            seen.add(name);
            return true;
          }))&&seen.size===count,'Invalid cohort membership or motion');
      },
      step(state,ctx){
        const roster=S.get(state);
        function stopped(row){
          return row.velocity&&!S.sameVector(row.velocity,S.zero)?{...row,velocity:S.zero}:row;
        }
        const groups=state.groups.map(row=>{
          const direction=V.sub(row.goal,row.position), length=V.len(direction), speed=profiles[row.species].speed??1;
          if(length<=1e-8||!speed)return stopped(row);
          const point=V.mad(row.position,direction,Math.min(1,ctx.dt*speed/length));
          const fitted=fit(ctx,{radius:.15,maxWade:.14,...profiles[row.species],
            entity:S.select(roster,row.members[0]).entity},point);
          if(!fitted||V.dist(row.position,fitted)<=1e-8)return stopped(row);
          const next={...row,position:fitted,velocity:V.mul(V.sub(fitted,row.position),1/ctx.dt),
            distance:row.distance+V.dist(row.position,fitted)};
          if(blockedCoarse&&profiles[row.species].mode==='walk'&&row.members.some(id=>{
            const member=S.select(roster,id);
            return blockedCoarse(memberPosition(row,member.position),memberPosition(next,member.position),member.radius);
          }))return stopped(row);
          return next;
        });
        return groups.some((row,i)=>row!==state.groups[i])?freeze({...state,groups}):state;
      },
      ...(syncRiders&&{afterStep:syncRiders}),
      output:()=>contacts?{contacts:[]}:undefined,
      fields:{population:({state})=>Q.ok(totals(state,true)),
        contacts:()=>Q.ok([]),decisions:({state})=>Q.ok(state.decisions)},
      occupancyRows:state=>occupants(S.get(state),(name,position)=>memberPosition(state.groups[state.memberGroup[name]],position)),
      pose(state,entity){
        const roster=S.get(state);
        let index=aliases.get(roster);
        if(!index){
          index=new Map();
          for(const slot of S.order(roster)){
            const key=roster.pages[slot.p].details[slot.i].entity;
            if(!index.has(key))index.set(key,[]);
            index.get(key).push(slot);
          }
          aliases.set(roster,index);
        }
        for(const slot of index.get(entity)??[]){
          const row=individual(state,S.read(roster,slot));
          if(row.mode!=='dormant')return row;
        }
      },
      *poseEntities(state){for(const page of S.get(state).pages)for(const row of page.details)yield row.entity;},
      describe:state=>({cohorts:state.groups.length,individuals:S.count(S.get(state))})
    };
  }
  W.aggregatePopulation=Object.freeze({population,cohorts});
})(KIT);
