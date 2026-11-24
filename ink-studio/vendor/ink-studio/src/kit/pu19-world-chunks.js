/* Deterministic residency and local solver clocks for authored simulation chunks. */
(function(K){
  const W=K.world, P=K.procedural, {check,id,record,vector,own,equal}=W.data, freeze=P.data.freeze;
  const order=value=>Object.keys(value).sort();
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const bounded=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const keys=(object,allowed)=>record(object)&&Object.keys(object).every(key=>allowed.includes(key));
  const target=value=>vector(value)||keys(value,['entity','socket'])&&id(value.entity)&&
    (value.socket===undefined||id(value.socket));
  const actions=['chunk-focus','chunk-level'];

  function cadence(raw,base){
    check((raw.every===undefined||integer(raw.every,1,3600))&&(raw.substeps===undefined||integer(raw.substeps,1,64)),
      'Invalid chunk solver cadence');
    const changed=raw.every!==undefined||raw.substeps!==undefined;
    const every=raw.every??(changed?1:base.every??1);
    const substeps=raw.substeps??(changed?1:base.substeps??1);
    check(integer(every,1,3600)&&integer(substeps,1,64)&&(every===1||substeps===1),
      'Chunk cadence needs every 1–3600 ticks or 1–64 substeps');
    return {every,substeps};
  }

  function compile(world,systems){
    const source=world.simulationChunks;
    if(source===undefined)return null;
    check(keys(source,['grid','levels','chunks','focus','hysteresis']),'Invalid simulation chunk configuration');
    const {grid:definition={},levels,focus={},hysteresis=0}=source;
    check(keys(definition,['dimensions','origin','size'])&&bounded(hysteresis,0,1e6),'Invalid simulation chunk grid or hysteresis');
    const dimensions=definition.dimensions??2;
    const grid=P.chunks.grid({...definition,dimensions});
    check(Array.isArray(levels)&&levels.length>=2&&levels.length<=16,'Expected 2–16 simulation detail levels');
    check(record(source.chunks)&&Object.keys(source.chunks).length>=1&&Object.keys(source.chunks).length<=512,
      'Expected a bounded simulation chunk table');
    const byLevel=new Map(), byChunk=new Map(), owner=new Map(), places=new Set();
    const kindNames=new Set(Object.values(world.systems).map(spec=>spec.kind));
    let radius=-1;
    const detail=levels.map((raw,index)=>{
      const asleep=index===levels.length-1;
      check(keys(raw,['id','within','sleep','every','substeps','systems','instances'])&&id(raw.id)&&!byLevel.has(raw.id)&&
        (asleep?raw.sleep===true&&Object.keys(raw).length===2:raw.sleep===undefined&&
          bounded(raw.within,0,1e9)&&raw.within>radius),'Expected increasing active radii followed by a sleeping level');
      const overrides=raw.systems??{}, instances=raw.instances??{};
      const validOption=option=>keys(option,['every','substeps','tuning','aggregate'])&&
        (option.tuning===undefined||record(option.tuning))&&
        (option.aggregate===undefined||option.aggregate===false||record(option.aggregate));
      check(record(overrides)&&Object.keys(overrides).every(key=>kindNames.has(key)&&validOption(overrides[key]))&&
        record(instances)&&Object.keys(instances).every(key=>own(systems,key)&&validOption(instances[key])),
        'Invalid simulation detail solver overrides');
      if(!asleep){cadence(raw,{});radius=raw.within;}
      const row={...raw,index,asleep,overrides,instances};
      byLevel.set(raw.id,row);
      return row;
    });
    const sleep=detail.at(-1), addresses=new Set();
    for(const name of order(source.chunks)){
      const raw=source.chunks[name];
      check(id(name)&&keys(raw,['index','place','systems','wake'])&&Array.isArray(raw.systems)&&
        raw.systems.length>=1&&raw.systems.length<=128,'Invalid simulation chunk '+name);
      const {place=world.id,wake={}}=raw;
      check(id(place)&&keys(wake,['commands','events','spatial','holdTicks','level']),'Invalid chunk wake policy '+name);
      const {commands=true,events=true,spatial=false,holdTicks=1,level=detail[0].id}=wake;
      const wakeLevel=byLevel.get(level);
      check([commands,events,spatial].every(v=>typeof v==='boolean')&&integer(holdTicks,1,3600)&&wakeLevel&&!wakeLevel.asleep,
        'Invalid chunk wake policy '+name);
      const address=grid.key(place,raw.index), bounds=grid.bounds(raw.index);
      check(!addresses.has(address),'Duplicate simulation chunk address '+address);
      addresses.add(address); places.add(place);
      const row={name,place,address,bounds,systems:raw.systems.slice().sort(),wake:{commands,events,spatial,holdTicks,level:wakeLevel}};
      byChunk.set(name,row);
      for(const system of row.systems){
        check(id(system)&&own(systems,system)&&!owner.has(system),'Chunk system must exist in exactly one chunk: '+system);
        const {kind,schedule}=world.systems[system], provider=systems[system], models=new Map();
        const profiles=[];
        const rates=detail.slice(0,-1).map(tier=>{
          const option=own(tier.instances,system)?{...tier.overrides[kind],...tier.instances[system]}:tier.overrides[kind];
          const defined=cadence(tier,schedule??{});
          const clock=cadence(option??{},defined), tuning=option?.tuning??{};
          check(!provider.requestTransfers||provider.receiveTransfers||clock.substeps===1,
            'Transfer producers need one substep inside a simulation chunk');
          check(!Object.keys(tuning).length||typeof provider.checkSimulationLOD==='function',
            'Solver does not support simulation detail tuning: '+system);
          provider.checkSimulationLOD?.(tuning,{...clock,dt:world.dt});
          if(option?.aggregate){
            const spec=option.aggregate;
            let profile=profiles.find(row=>equal(row.spec,spec));
            if(!profile){
              profile={spec,adapter:W.simulationAggregate.define(provider,spec,system+'/'+tier.id)};
              profiles.push(profile);
            }
            models.set(tier.id,profile.adapter);
          }
          return freeze({...clock,tuning});
        });
        owner.set(system,{rates,models,chunk:name,maxEvery:Math.max(...rates.map(clock=>clock.every)),
          schedules:Boolean(provider.step||provider.afterStep||provider.requestTransfers||provider.output)});
      }
    }
    function validFocus(row){
      return keys(row,['at','place'])&&target(row.at)&&places.has(row.place??world.id);
    }
    check(record(focus)&&Object.keys(focus).length<=64&&Object.entries(focus).every(([name,row])=>id(name)&&validFocus(row)),
      'Invalid simulation chunk focus');
    const blank=()=>({focus,overrides:{},entries:{},clocks:Object.fromEntries([...owner.keys()].map(name=>
      [name,{pending:0,activeTicks:0,calls:0,lastTick:0,lastStepTicks:0}]))});
    function checkAction(key,args){
      if(key==='chunk-focus'){
        check(keys(args,['id','at','place'])&&id(args.id)&&(args.at===null&&args.place===undefined||
          validFocus({at:args.at,...(args.place!==undefined&&{place:args.place})})),'Invalid chunk focus command');
      }else{
        check(keys(args,['chunk','level','ticks'])&&byChunk.has(args.chunk)&&
          (args.level===null&&args.ticks===undefined||byLevel.has(args.level)&&(args.ticks===undefined||integer(args.ticks,1,3600))),
        'Invalid chunk detail override');
      }
    }
    function action(state,key,args,tick){
      if(key==='chunk-focus'){
        const next={...state.focus};
        if(args.at===null)delete next[args.id];
        else next[args.id]={at:args.at,...(args.place!==undefined&&{place:args.place})};
        check(Object.keys(next).length<=64,'Simulation chunk focus budget exceeded');
        return {...state,focus:next};
      }
      const overrides={...state.overrides};
      if(args.level===null)delete overrides[args.chunk];
      else overrides[args.chunk]={level:args.level,until:args.ticks===undefined?null:tick+args.ticks-1};
      return {...state,overrides};
    }

    function select(state,resolve,tick,{commanded,hasEvents,affected,emit}={}){
      const observers=new Map();
      for(const {at,place=world.id} of Object.values(state.focus)){
        const p=vector(at)?at:resolve(at)?.point;
        if(!p)continue;
        if(!observers.has(place))observers.set(place,[]);
        observers.get(place).push(dimensions===2?[p[0],p[2]]:p);
      }
      let changed=false, expired=false;
      const entries={}, clocks={}, overrides={}, active=new Set(), due=new Map();
      for(const row of byChunk.values()){
        const {name,place,bounds,wake}=row, prior=own(state.entries,name)?state.entries[name]:undefined;
        const override=own(state.overrides,name)?state.overrides[name]:undefined;
        const forced=override&&(override.until===null||override.until>=tick)?byLevel.get(override.level):undefined;
        if(forced)overrides[name]=override;
        else expired ||= Boolean(override);
        let distance=Infinity;
        for(const p of observers.get(place)??[]){
          let squared=0;
          for(let axis=0;axis<dimensions;axis++){
            const d=Math.max(0,bounds.min[axis]-p[axis],p[axis]-bounds.max[axis]);
            squared+=d*d;
          }
          distance=Math.min(distance,Math.sqrt(squared));
        }
        let nearest=detail.find(level=>distance<=level.within)??sleep;
        const last=byLevel.get(prior?.distanceLevel);
        if(last&&!last.asleep&&last.index<nearest.index&&distance<=last.within+hysteresis)nearest=last;
        let wakeUntil=prior?.wakeUntil??0, wakeReason=prior?.wakeReason??null;
        if(tick>wakeUntil){wakeUntil=0;wakeReason=null;}
        const cause=(!forced&&tick&&(
          wake.commands&&commanded&&row.systems.some(name=>commanded.has(name))?'command':
          wake.events&&hasEvents&&row.systems.some(hasEvents)?'event':
          wake.spatial&&affected&&row.systems.some(name=>affected(name,row.systems))?'spatial':null));
        if(cause){wakeUntil=tick+wake.holdTicks-1;wakeReason=cause;}
        const woken=tick>0&&wakeUntil>=tick&&nearest.index>wake.level.index;
        const level=forced??(woken?wake.level:nearest);
        const reason=forced?'override':woken?wakeReason:Number.isFinite(distance)?'distance':'no-focus';
        const same=prior&&prior.level===level.id&&prior.distanceLevel===nearest.id&&prior.wakeUntil===wakeUntil&&
          prior.wakeReason===wakeReason&&prior.reason===reason;
        const entry=same?prior:{id:name,address:row.address,place,bounds,systems:row.systems,level:level.id,
          sleeping:level.asleep,distanceLevel:nearest.id,wakeUntil,wakeReason,reason,
          changedTick:prior?.level===level.id?prior.changedTick:tick};
        entries[name]=entry;
        changed ||= !same;
        if(prior&&prior.level!==level.id)emit?.('simulation-chunk-level',{chunk:name,from:prior.level,to:level.id,reason});
        for(const system of row.systems){
          const prev=state.clocks[system];
          clocks[system]=prev;
          const member=owner.get(system);
          if(level.asleep||!tick||!member.schedules)continue;
          active.add(system);
          const clock=member.rates[level.index], elapsed=prev.pending+1, activeTicks=prev.activeTicks+1;
          if(elapsed>=clock.every){
            const {substeps,every,tuning}=clock;
            due.set(system,{every,substeps,elapsed,chunk:name,level:level.id,tuning,activeTicks});
            clocks[system]={pending:0,activeTicks,calls:prev.calls+substeps,lastTick:tick,lastStepTicks:elapsed};
          }else clocks[system]={...prev,pending:elapsed,activeTicks};
          changed=true;
        }
      }
      const next=changed||expired?freeze({focus:state.focus,overrides,entries,clocks}):
        (P.data.isImmutable(state)?state:freeze(state));
      return {state:next,active,due};
    }
    function validate(state,tick){
      const reasons=['distance','no-focus','override','command','event','spatial'];
      check(keys(state,['focus','overrides','entries','clocks'])&&record(state.focus)&&Object.keys(state.focus).length<=64&&
        Object.entries(state.focus).every(([name,row])=>id(name)&&validFocus(row))&&record(state.overrides)&&
        Object.entries(state.overrides).every(([name,row])=>byChunk.has(name)&&keys(row,['level','until'])&&
          byLevel.has(row.level)&&(row.until===null||integer(row.until,tick,tick+3599)))&&
        record(state.entries)&&Object.keys(state.entries).length===byChunk.size&&
        record(state.clocks)&&Object.keys(state.clocks).length===owner.size,'Invalid simulation chunk checkpoint');
      for(const [name,chunk] of byChunk){
        const row=state.entries[name];
        check(record(row)&&row.id===name&&row.address===chunk.address&&row.place===chunk.place&&
          equal(row.bounds,chunk.bounds)&&equal(row.systems,chunk.systems)&&byLevel.has(row.level)&&
          row.sleeping===byLevel.get(row.level).asleep&&byLevel.has(row.distanceLevel)&&reasons.includes(row.reason)&&
          (row.wakeReason===null&&row.wakeUntil===0||['command','event','spatial'].includes(row.wakeReason)&&
            integer(row.wakeUntil,tick,tick+3599))&&integer(row.changedTick,0,tick),'Invalid saved simulation chunk '+name);
      }
      for(const [name,{maxEvery}] of owner){
        const row=state.clocks[name];
        check(keys(row,['pending','activeTicks','calls','lastTick','lastStepTicks'])&&integer(row.activeTicks,0,tick)&&
          integer(row.pending,0,Math.min(maxEvery-1,row.activeTicks))&&integer(row.calls,0,64*row.activeTicks)&&
          integer(row.lastTick,0,tick)&&integer(row.lastStepTicks,0,Math.min(maxEvery,row.activeTicks))&&
          (row.calls>0?row.lastTick>0&&row.lastStepTicks>0:row.lastTick===0&&row.lastStepTicks===0),
          'Invalid saved simulation clock '+name);
      }
    }
    return {managed:owner,actions,checkAction,action,blank,select,validate,
      rates:name=>owner.get(name)?.rates};
  }

  function mergeWrites(previous,changes){
    const merged=new Map(previous.map(row=>[row.writer+'/'+row.field,row]));
    for(const {writer,field,bounds,reason} of changes){
      const key=writer+'/'+field, old=merged.get(key);
      if(!old){merged.set(key,{writer,field,bounds,reason});continue;}
      if(equal(old.bounds,bounds))continue;
      const a=old.bounds, b=bounds;
      const union=a&&b&&a.axes===b.axes?{axes:a.axes,min:a.min.map((n,i)=>Math.min(n,b.min[i])),
        max:a.max.map((n,i)=>Math.max(n,b.max[i]))}:null;
      merged.set(key,{writer,field,bounds:union,reason:'chunk-pending-changes'});
    }
    check(merged.size<=P.spatialDependencies.limit,'Spatial sampling buffer exceeds its budget');
    return [...merged.values()];
  }

  W.simulationChunks=Object.freeze({compile,actions,mergeWrites});
})(KIT);
