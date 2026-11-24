/* Household transactions and low-cadence demographic rules. */
(function(K){
  const W=K.world,Q=W.query,{check,record,id,own,equal}=W.data;
  const {freeze}=K.procedural.data;
  const M=W.populationModel,{keys,entries,numbers,tick,count,integer,at,actor,actorKey}=M;
  const get=(table,key)=>own(table,key)?table[key]:undefined;
  const statistics=['births','deaths','arrivals','departures','moved'];
  const commands=['immigrate','emigrate','move-household','birth','death','set-group','set-capacity','bind','materialize','dematerialize'];
  const events=['population-birth','population-death','population-arrival','population-departure','household-moved',
    'population-stage','population-capacity','population-rejected','population-representation','population-rule','employment-changed'];
  const dict=()=>Object.create(null);

  function population(config){
    const spec=M.definitions(config), report=W.populationReport.create(spec);
    const {districts,groups,workplaces,maxHouseholds,maxNamed,rosters,interval}=spec;
    let checkActor;
    const housing=Object.fromEntries(entries(districts).map(([key,row])=>[key,row.capacity]));
    const slots=Object.fromEntries(entries(workplaces).map(([key,row])=>[key,row.capacity]));
    const totals=Object.fromEntries(statistics.map(key=>[key,0]));
    const knownGroup=name=>id(name)&&own(groups,name);
    const knownDistrict=name=>id(name)&&own(districts,name);
    const member=(household,{group,name,age=0,stageAge=0,actor},tick)=>({household,group,status:'present',
      born:tick-age,groupSince:tick-stageAge,...(name!==undefined&&{name}),...(actor&&{actor})});
    function household(key,row,residents,tick){
      for(const [name,person] of entries(row.residents??{}))residents[name]=member(key,person,tick);
      return {district:row.district,status:'present',groups:spec.cohorts(row.groups??{}),demand:row.demand??{}};
    }
    const residents=dict(), homes=Object.fromEntries(entries(spec.households).map(([key,row])=>{
      for(const name of Object.keys(row.residents??{}))check(!own(residents,name),'Duplicate named resident '+name);
      return [key,household(key,row,residents,0)];
    }));
    const initial={lastPulse:0,households:homes,residents,housing,slots,totals,remainder:{},requests:[],
      employment:{named:{},cohorts:{}}};
    const base=report.census(initial);
    check(Object.keys(residents).length<=maxNamed&&Object.values(base.areas).every(row=>row.population<=row.capacity),
      'Initial population exceeds housing or identity capacity');

    function checkAction(command,args){
      if(command==='set-capacity'){
        check(keys(args,['district','workplace','capacity'])&&own(args,'district')!==own(args,'workplace')&&count(args.capacity)&&
          (own(args,'district')?knownDistrict(args.district):id(args.workplace)&&own(workplaces,args.workplace)),
          'Invalid population capacity action');
        return;
      }
      if(['bind','materialize','dematerialize','set-group'].includes(command)){
        check(id(args.resident),'Invalid named resident ID');
        if(command==='bind')check(keys(args,['resident','actor'])&&actor(args.actor)&&rosters.includes(args.actor.system),
          'Invalid population actor binding');
        if(command==='materialize')check(keys(args,['resident','system','species','agent','at'])&&rosters.includes(args.system)&&
          id(args.species)&&(args.agent===undefined||id(args.agent))&&(args.at===undefined||at(args.at)),
          'Invalid population materialization');
        if(command==='materialize')checkActor?.(args.system,args.species);
        if(command==='dematerialize')check(keys(args,['resident']),'Invalid population dematerialization');
        if(command==='set-group')check(keys(args,['resident','group'])&&knownGroup(args.group),'Invalid resident group');
        return;
      }
      if(command==='death'&&own(args,'resident')){
        check(keys(args,['resident'])&&id(args.resident),'Invalid named resident death');
        return;
      }
      check(id(args.household),'Invalid population household ID');
      if(command==='immigrate'){
        const {household,...row}=args;
        spec.household(row);
      }else if(command==='move-household')
        check(keys(args,['household','district'])&&knownDistrict(args.district),'Invalid household move');
      else if(command==='emigrate')check(keys(args,['household']),'Invalid household emigration');
      else if(command==='birth'&&own(args,'resident'))
        check(keys(args,['household','group','resident','name'])&&knownGroup(args.group)&&id(args.resident)&&
          (args.name===undefined||typeof args.name==='string'&&args.name.length<=256),'Invalid named resident birth');
      else check(keys(args,['household','group','count'])&&knownGroup(args.group)&&count(args.count)&&args.count>0,
        'Invalid anonymous population change');
    }

    function settleInitial(state,{query}){
      const seen=new Set(), named=Object.fromEntries(entries(state.residents).map(([key,row])=>{
        if(!row.actor)return [key,row];
        const {system,agent,generation}=row.actor, live=query.probe(system+'/agent',undefined,{agent,generation}).value;
        check(live,'Unknown initial population actor '+system+'/'+agent);
        const actor={system,agent,generation:live.generation}, token=actorKey(actor);
        check(!seen.has(token),'Population actor belongs to more than one resident '+token);
        seen.add(token);
        return [key,{...row,actor}];
      }));
      const next={...state,residents:named};
      return freeze({...next,employment:report.employment(next,report.census(next))});
    }

    function update(previous,ctx){
      const {tick,query,emit}=ctx, pulse=tick%interval===0;
      if(!pulse&&!previous.requests.length)return previous;
      const state={...previous,households:{...previous.households},residents:{...previous.residents},
        housing:{...previous.housing},slots:{...previous.slots},totals:{...previous.totals},
        remainder:{...previous.remainder},requests:[]};
      const stats=report.census(state), use=Object.fromEntries(Object.values(stats.areas).map(row=>[row.id,row.population]));
      const people=stats.homes, bindings=new Map(entries(state.residents).flatMap(([name,row])=>
        row.actor?[[actorKey(row.actor),name]]:[]));
      let householdCount=Object.keys(state.households).length, namedCount=Object.keys(state.residents).length;
      let staffing=false;
      const free=district=>Math.max(0,state.housing[district]-use[district]);
      const house=name=>get(state.households,name);
      const person=name=>get(state.residents,name);
      function account(key,n){
        const amount=state.totals[key]+n;
        check(Number.isSafeInteger(amount),'Population counter exhausted '+key);
        state.totals[key]=amount;
      }
      function tally(key,group,n){
        const head=people[key];
        const total=(head.groups[group]??0)+n;
        if(total)head.groups[group]=total;else delete head.groups[group];
        head.population+=n;
        if(head.present)use[head.district]+=n;
        staffing=true;
      }
      function change(key,group,n){
        const row=house(key), buckets={...row.groups}, value=(get(buckets,group)??0)+n;
        if(value)buckets[group]=value;else delete buckets[group];
        state.households[key]={...row,groups:buckets};
        tally(key,group,n);
      }
      function release(row){
        if(!row.actor)return row;
        ctx.remove(row.actor);
        bindings.delete(actorKey(row.actor));
        const {actor,...rest}=row;
        return rest;
      }
      function kill(name,row){
        const old=release(row);
        state.residents[name]={...old,status:'deceased',closed:tick};
        const ids=people[row.household].residents;
        ids.splice(ids.indexOf(name),1);
        tally(row.household,row.group,-1);
        account('deaths',1);
        emit('population-death',{resident:name,household:row.household,group:row.group,count:1,
          ...(row.actor&&{actor:row.actor})});
      }
      function stage(name,row,group){
        if(row.group===group)return;
        state.residents[name]={...row,group,groupSince:tick};
        tally(row.household,row.group,-1);
        tally(row.household,group,1);
        emit('population-stage',{resident:name,household:row.household,from:row.group,group});
      }
      function addHouse(key,row){
        const old=house(key), head=people[key];
        if(old?.status==='present')return 'household-present';
        if(old){
          if(['groups','residents','demand'].some(field=>own(row,field)))return 'return-keeps-members';
          if(head.population>free(row.district))return 'housing-capacity';
          state.households[key]={...old,district:row.district,status:'present'};
          use[row.district]+=head.population;
          head.district=row.district;
          head.present=true;
          for(const name of head.residents)state.residents[name]={...person(name),status:'present'};
        }else{
          if(householdCount>=maxHouseholds)return 'household-capacity';
          const names=Object.keys(row.residents??{});
          if(namedCount+names.length>maxNamed)return 'identity-capacity';
          if(names.some(name=>person(name)))return 'identity-in-use';
          const size=numbers(row.groups??{})+names.length;
          if(size>free(row.district))return 'housing-capacity';
          state.households[key]=household(key,row,state.residents,tick);
          people[key]={district:row.district,present:true,groups:Object.assign(dict(),state.households[key].groups),
            population:size,residents:names.sort()};
          for(const name of names){
            const group=person(name).group;
            people[key].groups[group]=(people[key].groups[group]??0)+1;
          }
          use[row.district]+=size;
          namedCount+=names.length;
          householdCount++;
        }
        const size=people[key].population;
        staffing=true;
        account('arrivals',size);
        return null;
      }
      function move(key,district){
        const row=house(key), head=people[key];
        if(row.district===district)return 'same-district';
        if(head.population>free(district))return 'housing-capacity';
        use[row.district]-=head.population;
        use[district]+=head.population;
        head.district=district;
        state.households[key]={...row,district};
        account('moved',head.population);
        staffing=true;
        return null;
      }
      function leave(key){
        const row=house(key), head=people[key];
        use[row.district]-=head.population;
        head.present=false;
        state.households[key]={...row,status:'away'};
        for(const name of head.residents)state.residents[name]={...release(person(name)),status:'away'};
        account('departures',head.population);
        staffing=true;
      }

      function perform(command,args){
        const key=args.household, row=house(key), name=args.resident, resident=person(name);
        if(command==='immigrate'){
          const {household,...entry}=args, reason=addHouse(key,entry);
          if(!reason)emit('population-arrival',{household:key,district:args.district,count:people[key].population});
          return reason;
        }
        if(command==='set-capacity'){
          if(args.district!==undefined)state.housing[args.district]=args.capacity;
          else state.slots[args.workplace]=args.capacity;
          staffing=true;
          emit('population-capacity',args);
          return null;
        }
        if(['bind','materialize','dematerialize','set-group'].includes(command)||command==='death'&&name!==undefined){
          if(resident?.status!=='present')return 'resident-unavailable';
          if(command==='death'){kill(name,resident);return null;}
          if(command==='set-group'){stage(name,resident,args.group);return null;}
          if(command==='dematerialize'){
            if(!resident.actor)return 'actor-unbound';
            state.residents[name]=release(resident);
            emit('population-representation',{resident:name,mode:'detached',actor:resident.actor});
            return null;
          }
          if(resident.actor&&ctx.read(resident.actor))return 'actor-bound';
          let result;
          if(command==='bind'){
            const live=ctx.read(args.actor);
            if(!live)return 'actor-unavailable';
            result={actor:{...args.actor,generation:live.generation}};
          }else{
            const home=house(resident.household);
            result=ctx.spawn({system:args.system,species:args.species,agent:args.agent??name,
              at:args.at??districts[home.district].at,...(resident.name!==undefined&&{name:resident.name})});
            if(result.reason)return result.reason;
          }
          const token=actorKey(result.actor);
          if(bindings.has(token))return 'actor-in-use';
          if(resident.actor)bindings.delete(actorKey(resident.actor));
          bindings.set(token,name);
          state.residents[name]={...resident,actor:result.actor};
          emit('population-representation',{resident:name,mode:'attached',actor:result.actor});
          return null;
        }
        if(row?.status!=='present')return 'household-unavailable';
        const head=people[key];
        if(command==='move-household'){
          const reason=move(key,args.district);
          if(!reason)emit('household-moved',{household:key,from:row.district,district:args.district,count:head.population});
          return reason;
        }
        if(command==='emigrate'){
          leave(key);
          emit('population-departure',{household:key,district:row.district,count:head.population});
          return null;
        }
        const {group,count:n=1}=args;
        if(command==='death'){
          if((get(row.groups,group)??0)<n)return 'cohort-capacity';
          change(key,group,-n);
          account('deaths',n);
        }else{
          if(n>free(row.district))return 'housing-capacity';
          if(name!==undefined){
            if(namedCount>=maxNamed)return 'identity-capacity';
            if(resident)return 'identity-in-use';
            state.residents[name]=member(key,args,tick);
            namedCount++;
            head.residents.push(name);
            tally(key,group,1);
          }else change(key,group,n);
          account('births',n);
        }
        emit('population-'+command,{household:key,group,count:n,...(name!==undefined&&{resident:name})});
        return null;
      }
      for(const {command,args} of previous.requests){
        const reason=perform(command,args);
        if(reason)emit('population-rejected',{command,reason,args});
      }

      if(pulse){
        state.lastPulse=tick;
        for(const [name,row] of entries(state.residents)){
          if(row.status!=='present')continue;
          const {after,next}=groups[row.group];
          if(after===undefined||tick-row.groupSince<after)continue;
          if(next===undefined)kill(name,row);else stage(name,row,next);
        }
        for(const [name,rule] of entries(spec.rules)){
          const {kind,district,from,group}=rule, conditions=new Map();
          function allowed(area){
            if(!conditions.has(area))conditions.set(area,(rule.when??[]).every(row=>{
              const result=query().probe(row.field,row.at??districts[area].at,row.args);
              return result.status==='ok'&&Q.condition(row.when,result.value);
            }));
            return conditions.get(area);
          }
          let changed=0, affected=0;
          if(kind==='immigrate'){
            const n=Math.min(rule.count,free(district));
            if(n&&allowed(district)&&Q.condition(rule.where,{district,population:use[district],available:free(district)})&&
              !addHouse((rule.prefix??name)+'.'+tick,{district,groups:{[group]:n}})){changed=n;affected=1;}
          }else for(const [key,head] of entries(people)){
            if(!head.present||district!==undefined&&district!==head.district||!allowed(head.district)||
              !Q.condition(rule.where,{id:key,district:head.district,population:head.population,groups:head.groups}))continue;
            if(kind==='move'||kind==='emigrate'){
              if(affected>=rule.count)break;
              const from=head.district;
              if(kind==='move'&&move(key,rule.to))continue;
              if(kind==='emigrate')leave(key);
              if(head.residents.length)emit(kind==='move'?'household-moved':'population-departure',{
                household:key,district:head.district,count:head.population,rule:name,...(kind==='move'&&{from})
              });
              changed+=head.population;
            }else{
              const anonymous=get(house(key).groups,from)??0;
              const base=kind==='birth'?head.groups[from]??0:anonymous, token=name+'/'+key;
              if(!base)continue;
              const exact=base*rule.rate+(state.remainder[token]??0), whole=Math.floor(exact+1e-9);
              if(exact-whole>1e-9)state.remainder[token]=exact-whole;else delete state.remainder[token];
              const n=Math.min(whole,kind==='birth'?free(head.district):anonymous);
              if(!n)continue;
              if(kind!=='birth')change(key,from,-n);
              if(kind!=='death')change(key,group,n);
              if(kind==='birth')account('births',n);
              if(kind==='death')account('deaths',n);
              changed+=n;
            }
            affected++;
          }
          if(affected)emit('population-rule',{rule:name,operation:kind,count:changed,households:affected});
        }
      }
      if(staffing){
        state.employment=report.employment(state,report.census(state));
        const names=new Set([...Object.keys(previous.employment.named),...Object.keys(state.employment.named)]);
        for(const name of [...names].sort()){
          const from=get(previous.employment.named,name)??null,to=get(state.employment.named,name)??null;
          if(from!==to)emit('employment-changed',{resident:name,from,to,...(person(name)&&{household:person(name).household})});
        }
      }
      return freeze(state);
    }

    function validateState(state){
      check(record(state)&&tick(state.lastPulse)&&state.lastPulse%interval===0&&record(state.households)&&
        Object.keys(state.households).length<=maxHouseholds&&record(state.residents)&&Object.keys(state.residents).length<=maxNamed&&
        Array.isArray(state.requests)&&state.requests.length===0&&record(state.remainder)&&record(state.totals)&&
        statistics.every(key=>integer(state.totals[key],0,Number.MAX_SAFE_INTEGER))&&
        record(state.housing)&&Object.keys(state.housing).length===Object.keys(housing).length&&
        Object.keys(housing).every(key=>own(state.housing,key)&&count(state.housing[key]))&&
        record(state.slots)&&Object.keys(state.slots).length===Object.keys(slots).length&&
        Object.keys(slots).every(key=>own(state.slots,key)&&count(state.slots[key])),
        'Invalid saved population');
      for(const [name,row] of entries(state.households)){
        check(id(name)&&keys(row,['district','groups','status','demand'])&&knownDistrict(row.district)&&
          ['present','away'].includes(row.status),'Invalid saved household '+name);
        spec.cohorts(row.groups);spec.demand(row.demand);
      }
      const bindings=new Set();
      for(const [name,row] of entries(state.residents)){
        check(id(name)&&record(row)&&id(row.household)&&own(state.households,row.household)&&knownGroup(row.group)&&
          integer(row.born,-10000000,10000000)&&integer(row.groupSince,row.born,10000000)&&
          (row.status==='deceased'?tick(row.closed)&&row.closed>=row.groupSince:row.status===state.households[row.household].status)&&
          (row.name===undefined||typeof row.name==='string'&&row.name.length<=256)&&
          (row.actor===undefined||row.status==='present'&&actor(row.actor)&&row.actor.generation!==undefined&&
            rosters.includes(row.actor.system)&&!bindings.has(actorKey(row.actor))), 'Invalid saved named resident '+name);
        if(row.actor)bindings.add(actorKey(row.actor));
      }
      for(const [key,value] of Object.entries(state.remainder)){
        const [rule,home,...rest]=key.split('/');
        check(!rest.length&&own(spec.rules,rule)&&own(state.households,home)&&Number.isFinite(value)&&value>0&&value<1,
          'Invalid population rate remainder');
      }
      const census=report.census(state), {births,deaths,arrivals,departures}=state.totals;
      check(BigInt(base.totals.population)+BigInt(births)-BigInt(deaths)+BigInt(arrivals)-BigInt(departures)===
        BigInt(census.totals.population),
        'Saved population does not match its demographic totals');
      check(record(state.employment?.named)&&record(state.employment.cohorts)&&
        Object.values(state.employment.cohorts).every(table=>record(table)&&Object.values(table).every(bucket=>
          record(bucket)&&Object.values(bucket).every(n=>count(n)&&n>0)))&&
        equal(report.employment(state,census),state.employment),'Invalid saved employment assignments');
    }

    const field=read=>({type:'record',qualified:true,selector:true,read});
    function table(name,rows,describe=row=>row){
      return field(({state,args,query,tick})=>{
        const source=rows(state), key=args[name];
        if(key!==undefined)return own(source,key)?Q.ok(describe(source[key],key,state,query,tick)):
          Q.missing('Unknown population '+name,'missing');
        return Q.ok(Object.fromEntries(entries(source).map(([key,row])=>[key,describe(row,key,state,query,tick)])
          .filter(([,row])=>Q.condition(args.where,row))));
      });
    }
    const located=(row,key,state,query)=>{
      const position=query.target(row.at)?.point;
      return {...row,...(position&&{position})};
    };
    return {initial:()=>initial,settleInitial,shareCheckpoint:true,validateState,checkAction,contract:{emits:events},
      actions:Object.fromEntries(commands.map(command=>[command,(state,args)=>{
        check(state.requests.length<256,'Population command budget exceeded');
        return {...state,requests:[...state.requests,{command,args}]};
      }])),
      checkFields(query){for(const name of spec.fields)check(query.field(name),'Unknown population condition field '+name);},
      outputs:{population:'number',employed:'number',demand:'record'},
      output(state){
        const {totals,demand}=report.inspect(state);
        return {population:totals.population,employed:totals.employed,demand};
      },
      fields:{
        totals:field(({state})=>Q.ok({...report.inspect(state).totals,...state.totals,lastPulse:state.lastPulse})),
        households:table('household',state=>report.inspect(state).homes),
        districts:table('district',state=>report.inspect(state).areas,located),
        workplaces:table('workplace',state=>report.inspect(state).jobs,located),
        residents:table('resident',state=>state.residents,(row,id,state,query,tick)=>
          ({id,...row,ageTicks:(row.closed??tick)-row.born,employment:get(state.employment.named,id)??null})),
        demand:field(({state,args,query})=>report.demand(state,query,args))
      },
      populationBoard:{spec,update,checkActor(validate){checkActor=validate;}}
    };
  }
  W.runtime.register('population',population);
})(KIT);
