/* Checkpointed power buses, battery accounts, typed loads and breaker protection. */
(function(K){
  const W=K.world, Q=W.query, V=K.V, D=W.powerDispatch;
  const {check,record,id,vector}=W.data, {clamp}=W.fields;
  const maxWatts=1e9, maxEnergy=1e12, zero=[0,0,0];
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const watt=n=>finite(n,0,maxWatts);
  const fraction=n=>finite(n,0,1);
  const eta=n=>finite(n,1e-4,1);
  const point=p=>vector(p)&&p.every(n=>finite(n,-1e4,1e4));
  const look=values=>Array.isArray(values)&&values.length>0&&values.length<=32&&
    values.every(n=>Number.isSafeInteger(n)&&finite(n,0,255));
  const scalars=['generated','consumed','loss','imported','exported','curtailed'];

  function table(raw,max,label,parse){
    check(record(raw)&&Object.keys(raw).length<=max,'Invalid '+label+' table');
    return Object.keys(raw).sort().map(key=>{
      check(id(key)&&key.length<=72&&record(raw[key]),'Invalid '+label+' '+key);
      return {key,...parse(raw[key],key)};
    });
  }
  function named(rows,label,describe,role){
    const byKey=new Map(rows.map(({key},i)=>[key,i]));
    return {type:'record',selector:true,...(role&&{role}),read({state,target,args}){
      const key=args[label]??target?.entity;
      if(key!==undefined)return byKey.has(key)?Q.ok(describe(state,byKey.get(key))):Q.missing('unknown '+label);
      return Q.ok(Object.fromEntries(rows.map((row,i)=>[row.key,describe(state,i)])));
    }};
  }

  function powerNetwork(config){
    const buses=table(config.buses,96,'power bus',(raw,key)=>{
      const position=raw.position??zero;
      check(point(position),'Invalid position for power bus '+key);
      return {position};
    });
    check(buses.length>0,'A power network needs at least one bus');
    const busIndex=new Map(buses.map(({key},i)=>[key,i]));
    function bus(key){
      check(busIndex.has(key),'Unknown power bus '+key);
      return busIndex.get(key);
    }
    const lines=table(config.lines??{},256,'power line',(raw,key)=>{
      const from=bus(raw.from), to=bus(raw.to), {closed=true,breaker,guides=[],radius=.04,
        liveLook=[13,14,15,16,17],deadLook=[1,2,3,4],trippedLook=[19,20,21,22,23]}=raw;
      check(from!==to&&typeof closed==='boolean'&&Array.isArray(guides)&&guides.length<=24&&guides.every(point)&&
        finite(radius,.001,5)&&[liveLook,deadLook,trippedLook].every(look),'Invalid power line '+key);
      if(breaker!==undefined)check(record(breaker)&&finite(breaker.watts,.001,maxWatts)&&
        finite(breaker.delay??0,0,3600),'Invalid breaker '+key);
      return {from,to,closed,breaker,radius,liveLook,deadLook,trippedLook,points:[buses[from].position,...guides,buses[to].position]};
    });
    const byLine=new Map(lines.map(({key},i)=>[key,i]));
    const generators=table(config.generators??{},64,'generator',(raw,key)=>{
      const index=bus(raw.bus), {watts,enabled=true,wind}=raw;
      check(watt(watts)&&typeof enabled==='boolean','Invalid generator '+key);
      if(wind===undefined)return {bus:index,watts,enabled};
      check(record(wind)&&typeof wind.field==='string'&&point(wind.at),'Wind source needs a field and XYZ point');
      const {cutIn=1,rated=8,cutOut=30}=wind;
      check(finite(cutIn,0,200)&&finite(rated,.001,200)&&finite(cutOut,.001,200)&&
        cutIn<rated&&rated<=cutOut,'Invalid wind turbine speeds '+key);
      return {bus:index,watts,enabled,wind:{...wind,cutIn,rated,cutOut}};
    });
    const batteries=table(config.batteries??{},64,'battery',(raw,key)=>{
      const index=bus(raw.bus);
      const {capacity,initial=0,chargeWatts=maxWatts,dischargeWatts=maxWatts,chargeEfficiency=1,dischargeEfficiency=1}=raw;
      check(finite(capacity,.001,maxEnergy)&&finite(initial,0,capacity)&&watt(chargeWatts)&&watt(dischargeWatts)&&
        eta(chargeEfficiency)&&eta(dischargeEfficiency),'Invalid battery '+key);
      return {bus:index,capacity,initial,chargeWatts,dischargeWatts,chargeEfficiency,dischargeEfficiency};
    });
    const loads=table(config.loads??{},128,'power load',(raw,key)=>{
      const index=bus(raw.bus), {watts=0,idle=0,efficiency=1,priority=0,enabled=true}=raw;
      check(watt(watts)&&watt(idle)&&eta(efficiency)&&Number.isSafeInteger(priority)&&finite(priority,-10000,10000)&&
        typeof enabled==='boolean','Invalid power load '+key);
      return {bus:index,watts,idle,efficiency,priority,enabled};
    });
    const loadOrder=loads.map((_,i)=>i).sort((a,b)=>loads[b].priority-loads[a].priority||a-b);
    const layout={buses,lines,generators,batteries,loads,loadOrder};
    const inputs={}, outputs={}, accounts={};
    const number=(key,value)=>{inputs[key]={type:'number',default:value};};
    const bool=(key,value)=>{inputs[key]={type:'bool',default:value};};
    for(const row of lines){
      bool('close.'+row.key,row.closed);outputs['flow.'+row.key]='number';outputs['tripped.'+row.key]='bool';
    }
    for(const row of generators){
      bool('enable-generator.'+row.key,row.enabled);number('supply.'+row.key,row.watts);outputs['generated.'+row.key]='number';
      if(row.wind)outputs['wind-speed.'+row.key]='number';
    }
    for(const row of loads){
      bool('enable-load.'+row.key,row.enabled);number('demand.'+row.key,row.watts);
      outputs['delivered.'+row.key]=outputs['allowance.'+row.key]='number';outputs['served.'+row.key]='bool';
    }
    batteries.forEach(({key,capacity},i)=>{
      outputs['energy.'+key]=outputs['charge.'+key]=outputs['discharge.'+key]='number';
      accounts[key]={type:'number',resource:'energy',units:'J',read:state=>({balance:state.energy[i],max:capacity}),
        write(state,balance){
          const energy=state.energy.slice(), delta=balance-energy[i];
          energy[i]=balance;
          return {...state,energy,imported:state.imported+Math.max(0,delta),exported:state.exported+Math.max(0,-delta)};
        }};
    });
    const energy=batteries.map(row=>row.initial), initialEnergy=D.sum(energy);
    const blank=()=>({flows:D.zeros(lines),generated:D.zeros(generators),delivered:D.zeros(loads),
      charge:D.zeros(batteries),discharge:D.zeros(batteries),allocations:[]});

    function commands(ctx){
      const {input,query}=ctx, wind=D.zeros(generators);
      const supply=generators.map((row,i)=>{
        let ratio=1;
        if(row.wind){
          const {field,at,cutIn,rated,cutOut}=row.wind, read=query.probe(field,at);
          const speed=read.status==='ok'?Math.hypot(...read.value):0;
          wind[i]=Math.min(speed,1e6);
          ratio=speed>=cutOut?0:clamp((Math.min(speed,rated)**3-cutIn**3)/(rated**3-cutIn**3),0,1);
        }
        return (input['enable-generator.'+row.key]??row.enabled)?
          ratio*clamp(input['supply.'+row.key]??row.watts,0,row.watts):0;
      });
      const enabled=loads.map(row=>input['enable-load.'+row.key]??row.enabled);
      const demand=loads.map((row,i)=>enabled[i]?Math.min(maxWatts,row.idle+
        clamp(input['demand.'+row.key]??row.watts,0,maxWatts)/row.efficiency):0);
      const closed=lines.map(row=>input['close.'+row.key]??row.closed);
      return {supply,demand,wind,enabled,closed};
    }
    const allowance=(row,delivered)=>Math.max(0,delivered-row.idle)*row.efficiency;
    const satisfied=(demand,delivered)=>demand-delivered<=1e-12*Math.max(1,demand);
    function mass(state){
      const stored=D.sum(state.energy), {generated,consumed,loss,imported,exported,curtailed}=state;
      return {stored,initial:initialEnergy,generated,consumed,loss,imported,exported,curtailed,
        error:stored-initialEnergy-generated+consumed+loss-imported+exported};
    }
    function initial(){
      const timers=D.zeros(lines), tripped=lines.map(()=>null);
      const state={energy,timers,tripped,commands:{supply:D.zeros(generators),demand:D.zeros(loads),
        wind:D.zeros(generators),enabled:loads.map(row=>row.enabled),closed:lines.map(row=>row.closed)},
        frame:blank()};
      for(const key of scalars)state[key]=0;
      return state;
    }
    function endpoint({kind,index}){
      const row=({generator:generators,battery:batteries,load:loads})[kind][index];
      return {kind,id:row.key,bus:buses[row.bus].key};
    }
    function allocation({from,to,watts,path}){
      return {from:endpoint(from),to:endpoint(to),watts,path:path.map(({line,sign})=>({line:lines[line].key,sign}))};
    }
    function describeLoad(state,i){
      const row=loads[i], demand=state.commands.demand[i], delivered=state.frame.delivered[i];
      const enabled=state.commands.enabled[i], full=satisfied(demand,delivered);
      return {id:row.key,bus:buses[row.bus].key,enabled,demand,delivered,allowance:allowance(row,delivered),
        efficiency:row.efficiency,priority:row.priority,served:enabled&&full,
        status:!enabled?'disabled':!demand?'idle':full?'served':delivered>0?'limited':'unpowered'};
    }
    function describeLine(state,i){
      const row=lines[i], tripped=state.tripped[i], closed=state.commands.closed[i]&&!tripped;
      return {id:row.key,entity:row.key,material:'power-line',from:buses[row.from].key,to:buses[row.to].key,closed,
        flow:state.frame.flows[i],breaker:row.breaker??null,tripped,overloadSeconds:state.timers[i],
        look:tripped?row.trippedLook:closed&&Math.abs(state.frame.flows[i])>1e-8?row.liveLook:row.deadLook,
        radius:row.radius,paths:[row.points]};
    }
    function step(state,ctx){
      const cmd=commands(ctx), dt=ctx.dt;
      const closed=cmd.closed.map((value,i)=>value&&!state.tripped[i]), timers=state.timers.slice(), tripped=state.tripped.slice();
      let frame=D.dispatch(layout,state,cmd,closed,dt), changed=false;
      lines.forEach(({key,breaker},i)=>{
        if(!breaker||!closed[i]||Math.abs(frame.flows[i])<=breaker.watts*(1+1e-10)){
          timers[i]=0;
          return;
        }
        timers[i]+=dt;
        if(timers[i]+1e-12<(breaker.delay??0))return;
        const uses=frame.allocations.filter(row=>row.path.some(part=>part.line===i));
        const loadIDs=[...new Set(uses.filter(row=>row.to.kind==='load').map(row=>loads[row.to.index].key))];
        const detail={line:key,tick:ctx.tick,watts:Math.abs(frame.flows[i]),limit:breaker.watts,seconds:timers[i],loads:loadIDs};
        const cause=ctx.causal?.record('breaker-overload',detail,{inputs:loadIDs.map(name=>'demand.'+name),
          outputs:['tripped.'+key,'flow.'+key]});
        ctx.emit('breaker-trip',detail,cause?[cause]:undefined);
        tripped[i]=detail;closed[i]=false;changed=true;
      });
      if(changed)frame=D.dispatch(layout,state,cmd,closed,dt);
      const nextEnergy=batteries.map((row,i)=>clamp(state.energy[i]+dt*(frame.charge[i]*row.chargeEfficiency-
        frame.discharge[i]/row.dischargeEfficiency),0,row.capacity));
      const loss=batteries.reduce((sum,row,i)=>sum+frame.charge[i]*(1-row.chargeEfficiency)+
        frame.discharge[i]*(1/row.dischargeEfficiency-1),0);
      return {...state,energy:nextEnergy,timers,tripped,commands:cmd,frame,
        generated:state.generated+D.sum(frame.generated)*dt,consumed:state.consumed+D.sum(frame.delivered)*dt,
        loss:state.loss+loss*dt,curtailed:state.curtailed+Math.max(0,D.sum(cmd.supply)-D.sum(frame.generated))*dt};
    }

    return {initial,inputs,outputs,accounts,step,settleInitial(state,ctx){return {...state,commands:commands(ctx)};},
      checkFields(query){
        for(const {wind} of generators)if(wind){
          const field=query.field(wind.field);
          check(field?.units==='world/s'&&(field.type==='vec3'||
            field.type==='vec2'&&(field.spatial?.components??'xz')==='xz'),'Generator wind needs a world/s XYZ or XZ vector');
        }
      },
      validateState(state){
        const array=(value,rows,predicate)=>Array.isArray(value)&&value.length===rows.length&&value.every(predicate);
        const positive=n=>Number.isFinite(n)&&n>=0, bool=n=>typeof n==='boolean';
        check(record(state)&&array(state.energy,batteries,(n,i)=>finite(n,0,batteries[i].capacity))&&
          array(state.timers,lines,positive)&&array(state.tripped,lines,(row,i)=>row===null||
            Boolean(lines[i].breaker)&&record(row)&&row.line===lines[i].key&&Number.isSafeInteger(row.tick)&&
            positive(row.watts)&&positive(row.limit)&&positive(row.seconds)&&Array.isArray(row.loads)&&row.loads.every(id))&&
          scalars.every(key=>positive(state[key])),'Invalid power checkpoint');
        const {commands:cmd,frame}=state;
        check(record(cmd)&&array(cmd.supply,generators,watt)&&array(cmd.wind,generators,positive)&&
          array(cmd.demand,loads,watt)&&array(cmd.enabled,loads,bool)&&array(cmd.closed,lines,bool)&&
          record(frame)&&array(frame.flows,lines,Number.isFinite)&&array(frame.generated,generators,positive)&&
          array(frame.delivered,loads,positive)&&array(frame.charge,batteries,positive)&&array(frame.discharge,batteries,positive)&&
          Array.isArray(frame.allocations)&&frame.allocations.length<=640,'Invalid saved power dispatch');
        function validEnd(row,kinds){
          const tables={generator:generators,battery:batteries,load:loads};
          return record(row)&&kinds.includes(row.kind)&&Number.isSafeInteger(row.index)&&row.index>=0&&row.index<tables[row.kind].length;
        }
        check(frame.allocations.every(row=>record(row)&&validEnd(row.from,['generator','battery'])&&
          validEnd(row.to,['load','battery'])&&positive(row.watts)&&Array.isArray(row.path)&&row.path.length<buses.length&&
          row.path.every(part=>record(part)&&Number.isSafeInteger(part.line)&&part.line>=0&&part.line<lines.length&&
            (part.sign===1||part.sign===-1))), 'Invalid saved power allocation');
        check(Math.abs(mass(state).error)<=1e-7*Math.max(1,initialEnergy+state.generated+state.imported),
          'Power checkpoint energy mismatch');
      },
      actions:{reset(state,{line},ctx){
        const i=byLine.get(line);
        const timers=state.timers.slice(), tripped=state.tripped.slice();
        if(tripped[i])ctx.emit('breaker-reset',{line});
        timers[i]=0;tripped[i]=null;
        return {...state,timers,tripped};
      }},
      checkAction(type,{line}){check(byLine.has(line)&&lines[byLine.get(line)].breaker,'Reset needs a named breaker');},
      output(state){
        const out={};
        lines.forEach(({key},i)=>{out['flow.'+key]=state.frame.flows[i];out['tripped.'+key]=Boolean(state.tripped[i]);});
        batteries.forEach(({key},i)=>{
          out['energy.'+key]=state.energy[i];out['charge.'+key]=state.frame.charge[i];out['discharge.'+key]=state.frame.discharge[i];
        });
        loads.forEach(({key},i)=>{
          const {allowance,served,delivered}=describeLoad(state,i);
          out['allowance.'+key]=allowance;out['served.'+key]=served;out['delivered.'+key]=delivered;
        });
        generators.forEach(({key,wind},i)=>{
          out['generated.'+key]=state.frame.generated[i];if(wind)out['wind-speed.'+key]=state.commands.wind[i];
        });
        return out;
      },
      fields:{
        buses:named(buses,'bus',(_,i)=>({id:buses[i].key,position:buses[i].position})),
        lines:named(lines,'line',describeLine,'power-lines'),
        loads:named(loads,'load',describeLoad),
        batteries:named(batteries,'battery',(state,i)=>({id:batteries[i].key,bus:buses[batteries[i].bus].key,
          energy:state.energy[i],capacity:batteries[i].capacity,charge:state.frame.charge[i],discharge:state.frame.discharge[i]})),
        generators:named(generators,'generator',(state,i)=>({id:generators[i].key,bus:buses[generators[i].bus].key,
          available:state.commands.supply[i],generated:state.frame.generated[i],windSpeed:state.commands.wind[i]})),
        energy:{type:'record',units:'J',read:({state})=>Q.ok(mass(state))}
      },
      traces:{power:{selector:true,run({state,target,args}){
        const key=args.load??target?.entity, i=loads.findIndex(row=>row.key===key);
        if(i<0)return Q.missing('unknown power load');
        const deliveries=state.frame.allocations.filter(row=>row.to.kind==='load'&&row.to.index===i).map(allocation);
        const breakers=state.tripped.filter(Boolean).filter(row=>row.loads.includes(key));
        return Q.ok({...describeLoad(state,i),deliveries,breakers});
      }}}
    };
  }
  W.runtime.register('power-network',powerNetwork);
})(KIT);
