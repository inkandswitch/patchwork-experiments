/* Faction observations over shared spatial, collider and acoustic queries. */
(function(K){
  const W=K.world, Q=W.query, S=W.perceptionSensors, {V}=K, {check,id,record,own}=W.data;
  const {freeze}=K.procedural.data;
  const empty=freeze([]), types=['entity','agent','body','socket'];
  const channels=['sight','proximity','hearing'];
  const keys=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const tick=n=>integer(n,0,10000000);
  const order=(a,b)=>a<b?-1:a>b?1:0;
  const target=at=>W.worksites.target(at)&&(!Array.isArray(at)||S.point(at));
  const entries=(value,max,label)=>{
    check(record(value)&&Object.keys(value).length<=max&&Object.keys(value).every(id),'Invalid perception '+label);
    return Object.keys(value).sort().map(name=>[name,value[name]]);
  };
  const list=(value,max,valid)=>Array.isArray(value)&&value.length>=1&&value.length<=max&&
    value.every(valid)&&new Set(value).size===value.length;
  const token=({kind,system,id,generation})=>kind+'/'+system+'/'+id+(generation===undefined?'':'/'+generation);
  const latest=entry=>Math.max(...channels.map(key=>entry[key]?.tick??-1));
  const EPS=1e-8;

  function perception(config,{world}){
    check(keys(config,['profiles','factions','targets','sounds','sampleEvery','rememberTicks','maxObservers',
      'maxTargets','maxContacts','maxSounds']),'Invalid perception configuration');
    const {profiles,factions={},targets={},sounds={},sampleEvery=1,rememberTicks=600,maxObservers=256,
      maxTargets=64,maxContacts=4096,maxSounds=128}=config;
    check(integer(sampleEvery,1,3600)&&tick(rememberTicks)&&integer(maxObservers,1,1024)&&integer(maxTargets,1,256)&&
      integer(maxContacts,1,16384)&&integer(maxSounds,1,2048),'Invalid perception limits');
    const specs=new Map(entries(profiles,128,'profiles').map(([name,spec])=>[name,S.profile(spec)]));
    check(specs.size>0,'Perception needs a profile');
    check(keys(targets,['kinds','systems','where'])&&
      list(targets.kinds??['agent','entity'],4,kind=>types.includes(kind))&&
      (targets.systems===undefined||list(targets.systems,128,name=>name==='world'||own(world.systems,name))),
      'Invalid perception target filter');
    Q.condition(targets.where,{});
    const kinds=targets.kinds??['agent','entity'];
    const events=new Map(entries(sounds,128,'sound rules').map(([name,spec])=>{
      check(keys(spec,['levelDb','band','duration'])&&S.decibels(spec.levelDb)&&
        (spec.band===undefined||S.bands.includes(spec.band))&&integer(spec.duration??1,1,3600),'Invalid sound rule '+name);
      return [name,{levelDb:spec.levelDb,band:spec.band??'mid',duration:spec.duration??1}];
    }));
    const groups=entries(factions,64,'factions').map(([name,spec])=>{
      check(keys(spec,['observers','rosters']),'Invalid faction '+name);
      const pins=entries(spec.observers??{},128,'observers'), rosters=entries(spec.rosters??{},32,'observer rosters');
      check(pins.length||rosters.length,'A faction needs an observer or roster');
      for(const [key,row] of pins)check(keys(row,['at','profile','facing'])&&target(row.at)&&specs.has(row.profile)&&
        (row.facing===undefined||S.facing(row.facing)),'Invalid perception observer '+key);
      for(const [key,row] of rosters){
        check(keys(row,['system','profile','where'])&&id(row.system)&&own(world.systems,row.system)&&
          specs.has(row.profile),'Invalid perception observer roster '+key);
        Q.condition(row.where,{});
      }
      return {name,pins,rosters};
    });
    const observerCache=new WeakMap();
    const byFaction=new Map(groups.map(group=>[group.name,group]));
    const blank=freeze({sampledAt:null,contacts:{},stats:{observers:0,pairs:0,sounds:0,limited:false}});
    const initial=freeze({factions:Object.fromEntries(groups.map(({name})=>[name,blank])),sounds:empty,soundLimited:false});
    function checkFields(query){
      S.checkFields([...specs.values()],query);
      for(const {rosters} of groups)for(const [,row] of rosters)
        check(query.field(row.system+'/agents')?.type==='record','Observer source needs a live agent roster '+row.system);
    }

    function observers(group,query){
      let cache=observerCache.get(query);
      if(!cache){cache=new Map();observerCache.set(query,cache);}
      if(cache.has(group.name))return cache.get(group.name);
      const sensors=[];
      let count=0;
      function add(key,source,spec,facing){
        if(count++>=maxObservers)return;
        sensors.push({key,spec,observer:S.listener(source,spec,facing)});
      }
      for(const [key,row] of group.pins){
        const source=S.anchor(query,row.at);
        if(source)add(key,source,specs.get(row.profile),row.facing);
      }
      for(const [key,{system,profile,where}] of group.rosters){
        const read=query.probe(system+'/agents');
        if(read.status!=='ok')continue;
        for(const row of Object.values(read.value)){
          if(row.mode==='dormant'||!S.point(row.position)||!Q.condition(where,row))continue;
          add(key+'/'+row.id+'/'+row.generation,{position:row.position,forward:row.direction,exclude:[row.id,row.entity]},
            specs.get(profile));
          if(count>maxObservers)break;
        }
      }
      const result={sensors,limited:count>maxObservers};
      cache.set(group.name,result);
      return result;
    }

    function cueEvents(previous,input,tick){
      if(!events.size)return {rows:previous,limited:false};
      const alive=previous.filter(row=>tick<row.until), added=[];
      for(const row of input){
        const template=events.get(row.kind);
        if(!template||!S.point(row.at))continue;
        const {band,levelDb,duration}=template;
        added.push({subject:{kind:'sound',system:row.system,id:row.id,label:row.kind},position:row.at,
          born:tick,until:tick+duration,band,levelDb:S.decibels(row.soundLevelDb)?row.soundLevelDb:levelDb});
      }
      if(alive.length===previous.length&&!added.length)return {rows:previous,limited:false};
      const combined=alive.concat(added);
      return {rows:combined.slice(-maxSounds),limited:combined.length>maxSounds};
    }

    function scan(group,previous,vis,ctx,overflow){
      const {query,tick}=ctx, {sensors,limited}=observers(group,query), picked=new Map();
      const stats={observers:sensors.length,pairs:0,sounds:0,limited:limited||overflow};
      function pick(subject,channel,read){
        const key=token(subject);
        let row=picked.get(key);
        if(!row){row={subject};picked.set(key,row);}
        const old=row[channel];
        const score=channel==='hearing'?read.levelDb: -read.distance;
        const prior=channel==='hearing'?old?.levelDb: -old?.distance;
        if(!old||score>prior||score===prior&&order(read.observer,old.observer)<0)row[channel]=read;
      }
      const looking=sensors.filter(({spec})=>spec.sight||spec.proximity);
      if(looking.length){
        const queries=looking.map(({spec,observer})=>({op:'nearby',at:observer.position,kinds,
          radius:Math.max((spec.sight?.range??0)+(spec.sight?Math.abs(spec.eyeHeight)+8:0),spec.proximity?.range??0),
          where:targets.where,systems:targets.systems,limit:maxTargets,exclude:observer.exclude}));
        const {results}=query.spatialBatch({queries});
        for(const [i,result] of results.entries()){
          if(result.status!=='ok')continue;
          if(result.matched>result.hits.length)stats.limited=true;
          const {observer,key,spec}=looking[i];
          for(const row of result.hits){
            const {kind,system,id,entity,generation,entityKind,tags,position,height}=row;
            const subject={kind,system,id,...(entity!==undefined&&{entity}),...(generation!==undefined&&{generation}),
              ...(entityKind!==undefined&&{entityKind}),...(tags!==undefined&&{tags})};
            const entityTarget={position,exclude:[id,...(entity!==undefined?[entity]:[])],
              ...(kind==='agent'&&height!==undefined&&{aim:[position[0],position[1]+height*.65,position[2]]})};
            stats.pairs++;
            if(spec.sight){
              const read=S.seen(query,observer,entityTarget,spec.sight);
              if(read.visible)pick(subject,'sight',{tick,observer:key,position,distance:read.distance});
            }
            if(spec.proximity){
              const read=S.nearby(observer,entityTarget,spec.proximity);
              if(read.near)pick(subject,'proximity',{tick,observer:key,position,distance:read.distance});
            }
          }
        }
      }
      if(vis)for(const {observer,key,spec} of sensors){
        if(!spec.hearing)continue;
        const range=spec.hearing.range, eye=observer.eye, nearby=[];
        vis.overlap(eye.map(n=>n-range),eye.map(n=>n+range),cue=>{
          const distance=V.dist(eye,cue.position);
          if(distance<=range)nearby.push({cue,distance});
        });
        nearby.sort((a,b)=>a.distance-b.distance||order(a.cue.subject.id,b.cue.subject.id));
        if(nearby.length>maxTargets)stats.limited=true;
        for(const {cue} of nearby.slice(0,maxTargets)){
          stats.sounds++;
          const read=S.heard(query,observer,cue,spec.hearing);
          if(!read.audible)continue;
          const {levelDb,direction,apparentSource}=read;
          pick(cue.subject,'hearing',{tick,observer:key,levelDb,direction,...(apparentSource&&{apparentSource})});
        }
      }
      const contacts=new Map(Object.entries(previous.contacts));
      for(const [key,entry] of picked)contacts.set(key,{...contacts.get(key),...entry});
      const retained=[...contacts].filter(([,entry])=>tick-latest(entry)<=rememberTicks);
      if(retained.length>maxContacts){
        stats.limited=true;
        retained.sort(([ak,a],[bk,b])=>latest(b)-latest(a)||order(ak,bk));
      }
      const stored=retained.slice(0,maxContacts).sort(([a],[b])=>order(a,b));
      return {sampledAt:tick,contacts:Object.fromEntries(stored),stats};
    }

    function afterStep(state,ctx){
      const cues=cueEvents(state.sounds,ctx.events,ctx.tick);
      const limited=state.soundLimited||cues.limited;
      const sample=ctx.sample&&ctx.tick%sampleEvery===0&&groups.length;
      if(!sample)return cues.rows===state.sounds&&limited===state.soundLimited?state:
        freeze({...state,sounds:cues.rows,soundLimited:limited});
      const soundIndex=cues.rows.length?W.spatial.grid(8):null;
      for(const row of cues.rows)soundIndex.add(row.position,row);
      const factions=Object.fromEntries(groups.map(group=>[
        group.name,scan(group,state.factions[group.name],soundIndex,ctx,limited)
      ]));
      return freeze({factions,sounds:cues.rows,soundLimited:false});
    }
    function batch({query,args,tick}){
      check(keys(args,['queries'])&&Array.isArray(args.queries)&&args.queries.length<=2048,'Invalid perception batch');
      const results=args.queries.map(item=>{
        check(keys(item,['id','profile','from','to','facing','sound'])&&(item.id===undefined||id(item.id))&&specs.has(item.profile)&&
          target(item.from)&&target(item.to)&&(item.facing===undefined||S.facing(item.facing))&&
          (item.sound===undefined||S.validSound(item.sound)),'Invalid sensory probe');
        const who=item.id===undefined?{}:{id:item.id}, spec=specs.get(item.profile),
          from=S.anchor(query,item.from), to=S.anchor(query,item.to);
        if(!from||!to)return {...who,status:'missing',reason:!from?'missing observer':'missing target'};
        const sound=item.sound&&{...item.sound,position:to.position};
        return {...who,status:'ok',...S.test(query,spec,S.listener(from,spec,item.facing),to,sound)};
      });
      return Q.ok({tick,results});
    }

    function describe(key,row,sampledAt,tick){
      const last=latest(row);
      return {key,...row.subject,lastObservedTick:last,ageTicks:tick-last,
        currentlyVisible:row.sight?.tick===sampledAt,currentlyNear:row.proximity?.tick===sampledAt,
        currentlyAudible:row.hearing?.tick===sampledAt,
        ...(row.sight&&{lastSeen:row.sight,seenAgeTicks:tick-row.sight.tick}),
        ...(row.proximity&&{lastNearby:row.proximity}),...(row.hearing&&{lastHeard:row.hearing})};
    }
    function report({state,args,tick}){
      if(!own(state?.factions,args.faction))return Q.missing('unknown perception faction','missing');
      const {sampledAt,contacts,stats}=state.factions[args.faction];
      const rows=Object.entries(contacts).flatMap(([key,row])=>{
        if(tick-latest(row)>rememberTicks)return [];
        const view=describe(key,row,sampledAt,tick);
        return Q.condition(args.where,view)?[view]:[];
      });
      return Q.ok({faction:args.faction,sampledAt,sampleAgeTicks:sampledAt===null?null:tick-sampledAt,contacts:rows,stats});
    }
    function find({state,args,target,tick},visible){
      if(!own(state?.factions,args.faction))return Q.missing('unknown perception faction','missing');
      const {sampledAt,contacts}=state.factions[args.faction];
      const entity=args.entity??target?.entity, point=Array.isArray(target)?target:target?.point;
      const {radius=.001}=args;
      check(args.key===undefined||typeof args.key==='string'&&args.key.length<=400,'Invalid perception contact key');
      check(Number.isFinite(radius)&&radius>=0&&radius<=10000,'Invalid remembered point radius');
      if(args.key===undefined&&!id(entity)&&!S.point(point))
        return Q.missing('a contact needs a key, entity or point','missing');
      const candidates=args.key!==undefined?(own(contacts,args.key)?[[args.key,contacts[args.key]]]:[]):
        Object.entries(contacts).filter(([,row])=>{
          if(entity!==undefined)return row.subject.entity===entity;
          const recent=visible||(row.sight?.tick??-1)>=(row.proximity?.tick??-1)?row.sight:row.proximity;
          return recent?.position&&V.dist(recent.position,point)<=radius;
        });
      const filtered=candidates.filter(([,row])=>tick-latest(row)<=rememberTicks);
      if(visible)return Q.ok(filtered.some(([,row])=>row.sight?.tick===sampledAt));
      filtered.sort(([aKey,a],[bKey,b])=>latest(b)-latest(a)||order(aKey,bKey));
      return filtered.length?Q.ok(describe(...filtered[0],sampledAt,tick)):Q.missing('contact has not been observed','missing');
    }
    function coverage({query,target,args}){
      const group=byFaction.get(args.faction);
      if(!group)return Q.missing('unknown perception faction','missing');
      if(!S.point(target.point))return Q.missing('coverage needs a world point');
      const subject={position:target.point,exclude:target.entity?[target.entity]:[]};
      const {sensors}=observers(group,query);
      return Q.ok(sensors.some(({spec,observer})=>spec.sight&&S.seen(query,observer,subject,spec.sight).visible));
    }
    function validateState(state){
      check(record(state)&&record(state.factions)&&Object.keys(state.factions).length===groups.length&&
        Array.isArray(state.sounds)&&state.sounds.length<=maxSounds&&typeof state.soundLimited==='boolean','Invalid perception checkpoint');
      const unique=new Set();
      function identity(row){
        return record(row)&&[...types,'sound'].includes(row.kind)&&id(row.system)&&typeof row.id==='string'&&row.id.length<=193&&
          row.id.split('/').every(id)&&(row.generation===undefined||integer(row.generation,1,Number.MAX_SAFE_INTEGER));
      }
      for(const row of state.sounds){
        check(record(row)&&identity(row.subject)&&row.subject.kind==='sound'&&events.has(row.subject.label)&&
          !unique.has(token(row.subject))&&tick(row.born)&&integer(row.until,row.born+1,row.born+3600)&&S.point(row.position)&&
          S.decibels(row.levelDb)&&S.bands.includes(row.band),'Invalid saved sound cue');
        unique.add(token(row.subject));
      }
      for(const {name} of groups){
        const row=own(state.factions,name)&&state.factions[name];
        check(record(row)&&(row.sampledAt===null||tick(row.sampledAt))&&record(row.contacts)&&
          Object.keys(row.contacts).length<=maxContacts&&record(row.stats)&&typeof row.stats.limited==='boolean'&&
          integer(row.stats.observers,0,maxObservers)&&integer(row.stats.pairs,0,maxObservers*maxTargets)&&
          integer(row.stats.sounds,0,maxObservers*maxTargets),'Invalid saved faction perception '+name);
        for(const [key,contact] of Object.entries(row.contacts)){
          check(record(contact)&&identity(contact.subject)&&key===token(contact.subject)&&latest(contact)>=0&&
            row.sampledAt!==null,'Invalid saved perception contact '+key);
          for(const channel of channels){
            const item=contact[channel];
            if(item===undefined)continue;
            check(record(item)&&integer(item.tick,0,row.sampledAt)&&typeof item.observer==='string'&&
              (channel==='hearing'?contact.subject.kind==='sound'&&S.decibels(item.levelDb)&&W.data.vector(item.direction)&&
                (item.apparentSource===undefined||S.point(item.apparentSource)):
                contact.subject.kind!=='sound'&&S.point(item.position)&&Number.isFinite(item.distance)&&item.distance>=-EPS),
              'Invalid saved perception observation '+key);
          }
        }
      }
    }
    const descriptor=read=>({type:'record',qualified:true,selector:true,read});
    return {initial:()=>initial,settleInitial:(state,ctx)=>afterStep(state,{...ctx,events:empty,sample:true}),
      shareCheckpoint:true,afterStep,checkFields,validateState,
      fields:{batch:descriptor(batch),faction:descriptor(report),contact:descriptor(ctx=>find(ctx,false)),
        visible:{...descriptor(ctx=>find(ctx,true)),type:'bool'},
        coverage:{type:'bool',qualified:true,read:coverage}}};
  }

  W.runtime.register('perception',perception);
})(KIT);
