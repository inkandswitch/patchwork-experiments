/* Demographic totals, stable staffing, and shared demand without per-capita agents. */
(function(K){
  const W=K.world, Q=W.query, {own}=W.data, {entries,numbers,order}=W.populationModel;
  const dict=()=>Object.create(null);
  function add(target,key,value){target[key]=(target[key]??0)+value;}
  function addAll(target,source,scale=1){
    for(const [key,value] of Object.entries(source))add(target,key,value*scale);
  }

  function create(model){
    const {groups,districts,workplaces,resources,householdDemand}=model, memo=new WeakMap();
    const jobs=entries(workplaces).sort(([a,x],[b,y])=>(y.priority??0)-(x.priority??0)||order(a,b));
    function census(state,cache=false){
      if(cache&&memo.has(state))return memo.get(state);
      const homes=dict(), areas=dict(), totals={population:0,named:0,anonymous:0,workers:0,households:0,groups:dict()};
      for(const [id,row] of entries(districts))areas[id]={id,at:row.at,capacity:state.housing[id],
        population:0,named:0,anonymous:0,workers:0,households:0,groups:dict(),demand:dict()};
      for(const [id,home] of entries(state.households)){
        const present=home.status==='present';
        homes[id]={id,district:home.district,status:home.status,groups:Object.assign(dict(),home.groups),
          anonymous:numbers(home.groups),named:0,residents:[],population:0,workers:0,present,employed:0,demand:dict()};
      }
      for(const [id,resident] of entries(state.residents)){
        if(resident.status==='deceased')continue;
        const home=homes[resident.household];
        home.named++;
        home.residents.push(id);
        add(home.groups,resident.group,1);
      }
      for(const home of Object.values(homes)){
        home.population=home.anonymous+home.named;
        home.workers=Object.entries(home.groups).reduce((total,[group,n])=>total+(groups[group].work?n:0),0);
        if(!home.present)continue;
        const area=areas[home.district];
        for(const key of ['population','named','anonymous','workers']){
          totals[key]+=home[key];
          area[key]+=home[key];
        }
        totals.households++;
        area.households++;
        addAll(totals.groups,home.groups);
        addAll(area.groups,home.groups);
        if(home.population){
          addAll(home.demand,householdDemand);
          addAll(home.demand,state.households[home.id].demand);
          for(const [group,n] of Object.entries(home.groups))addAll(home.demand,groups[group].demand??{},n);
          addAll(area.demand,home.demand);
        }
      }
      const summary={homes,areas,totals};
      if(cache)memo.set(state,summary);
      return summary;
    }

    function employment(state,people){
      const named=dict(), cohorts=dict(), room=dict(), available=dict(), employed=state.employment;
      const workers=entries(state.residents).filter(([,row])=>row.status==='present'&&groups[row.group].work);
      for(const [job] of jobs)room[job]=state.slots[job];
      for(const home of Object.values(people.homes))if(home.present){
        const counts=dict();
        for(const [group,n] of entries(state.households[home.id].groups))
          if(groups[group].work)counts[group]=n;
        available[home.id]=counts;
      }
      const eligible=(job,house,group)=>Boolean(people.homes[house]?.present&&
        (!job.groups||job.groups.includes(group))&&(job.from??[job.district]).includes(people.homes[house].district));
      function hire(name,resident,job){
        if(!own(workplaces,job)||!room[job]||!eligible(workplaces[job],resident.household,resident.group))return false;
        named[name]=job;
        room[job]--;
        return true;
      }
      function staff(job,house,group,request){
        const counts=available[house];
        if(!room[job]||!counts?.[group]||!eligible(workplaces[job],house,group))return;
        const n=Math.min(room[job],counts[group],request);
        if(!n)return;
        add((cohorts[job]??=dict())[house]??=dict(),group,n);
        counts[group]-=n;
        room[job]-=n;
      }
      for(const [name,resident] of workers)hire(name,resident,employed.named[name]);
      for(const [job] of jobs){
        const prior=own(employed.cohorts,job)?employed.cohorts[job]:{};
        for(const [house,counts] of entries(prior))for(const [group,n] of entries(counts))staff(job,house,group,n);
      }
      for(const [name,resident] of workers){
        if(own(named,name))continue;
        for(const [job] of jobs)if(hire(name,resident,job))break;
      }
      for(const [job] of jobs){
        if(!room[job])continue;
        for(const [house,counts] of Object.entries(available)){
          for(const [group,n] of Object.entries(counts))staff(job,house,group,n);
          if(!room[job])break;
        }
      }
      return {named:{...named},cohorts:Object.fromEntries(entries(cohorts).map(([job,homes])=>
        [job,Object.fromEntries(entries(homes).map(([home,bucket])=>[home,{...bucket}]))]))};
    }

    function inspect(state){
      const stats=census(state,true);
      if(stats.jobs)return stats;
      stats.jobs=dict();
      stats.demand=Object.fromEntries(Object.keys(resources).map(key=>[key,0]));
      stats.totals.employed=0;
      for(const [name,job] of jobs)stats.jobs[name]={id:name,district:job.district,at:job.at??districts[job.district].at,
        capacity:state.slots[name],employed:0,named:[],cohorts:own(state.employment.cohorts,name)?state.employment.cohorts[name]:{}};
      for(const [person,job] of entries(state.employment.named)){
        stats.jobs[job].named.push(person);
        stats.jobs[job].employed++;
        stats.homes[state.residents[person].household].employed++;
      }
      for(const row of Object.values(stats.jobs)){
        for(const [home,bucket] of Object.entries(row.cohorts)){
          const n=numbers(bucket);
          row.employed+=n;
          stats.homes[home].employed+=n;
        }
        row.vacant=row.capacity-row.employed;
        stats.totals.employed+=row.employed;
      }
      stats.totals.unemployed=stats.totals.workers-stats.totals.employed;
      for(const area of Object.values(stats.areas)){
        addAll(stats.demand,area.demand);
        area.employed=0;
        area.vacant=Math.max(0,area.capacity-area.population);
        area.overCapacity=Math.max(0,area.population-area.capacity);
      }
      for(const home of Object.values(stats.homes))if(home.present)stats.areas[home.district].employed+=home.employed;
      return stats;
    }

    function demand(state,query,args){
      const {homes,areas,demand}=inspect(state), units=Object.entries(resources);
      const quantities=bag=>Object.fromEntries(units.map(([key,unit])=>[key,{units:unit,requested:bag[key]??0}]));
      function district(row){
        const values=quantities(row.demand), supply=districts[row.id].supply??{};
        for(const [resource,account] of Object.entries(supply)){
          const read=query.probe('world/account',undefined,{account}).value;
          if(!read)continue;
          const available=Math.max(0,read.balance-(read.min??0));
          values[resource]={...values[resource],account,available,shortfall:Math.max(0,values[resource].requested-available)};
        }
        return {district:row.id,population:row.population,values};
      }
      if(args.household!==undefined){
        const home=homes[args.household];
        return home?Q.ok({household:home.id,population:home.present?home.population:0,values:quantities(home.demand)}):
          Q.missing('Unknown household','missing');
      }
      if(args.district!==undefined){
        const area=areas[args.district];
        return area?Q.ok(district(area)):Q.missing('Unknown population district','missing');
      }
      return Q.ok({values:quantities(demand),districts:Object.fromEntries(Object.values(areas).map(row=>[row.id,district(row)]))});
    }

    return {census,employment,inspect,demand};
  }
  W.populationReport=Object.freeze({create});
})(KIT);
