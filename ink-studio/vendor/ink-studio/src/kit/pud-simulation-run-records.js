/* Portable evidence for actual simulation execution and deterministic replay. */
(function(K){
  const W=K.world, R=W.runtime, {check,record,copy,equal}=W.data, {freeze,hash,isImmutable}=K.procedural.data;
  const tickOK=tick=>Number.isSafeInteger(tick)&&tick>=0&&tick<=R.maxTick;
  const hex=value=>value.toString(16).padStart(8,'0');
  const fingerprint=text=>hex(hash(text))+hex(hash(text,0x9e3779b9));
  const fingerprints=new WeakMap(), playbacks=new WeakMap();
  function revision(world){
    if(!fingerprints.has(world))fingerprints.set(world,fingerprint(JSON.stringify(world)));
    return fingerprints.get(world);
  }

  function capture(option,origin,rates,originQuery){
    const spec=option===true?{}:option;
    check(record(spec)&&Object.keys(spec).every(key=>key==='ticks'||key==='observations')&&
      (spec.ticks===undefined||spec.observations!==undefined),'Invalid run observation plan');
    const plan=freeze(copy(spec)), measure=plan.observations===undefined?null:W.observations.measurements(plan);
    const slots=measure?.slots??[], read=measure?.reader(originQuery());
    const revisions=[], submissions=[], actions=[], observations=[], steps=new Map();
    let cursor=slots.findIndex(slot=>slot.tick>=origin.tick), lastWorld, timing=2166136261;
    if(cursor===-1)cursor=slots.length;
    const {world:{id,seed,dt}}=origin;
    const schedules=rates?.rates??Object.fromEntries(Object.keys(origin.world.systems).sort()
      .map(name=>[name,{every:1,substeps:1}]));

    function prepare(view,query,tickActions=[],phases=[]){
      const {tick,world}=view, time=tick*dt;
      const changed=lastWorld!==world?revision(world):undefined;
      const samples=[];
      if(slots[cursor]?.tick===tick){
        const at=query();
        for(let i=cursor;slots[i]?.tick===tick;i++)samples.push(freeze(copy(read(at,slots[i],dt))));
      }
      return {tick,time,world,changed,samples,
        action:tickActions.length?{tick,time,commands:tickActions.slice()}:null,
        phaseHash:phases.length?hash(JSON.stringify([tick,phases]),timing):timing,phases};
    }
    function publish({tick,time,world,changed,samples,action,phaseHash,phases}){
      lastWorld=world;
      if(changed!==undefined&&changed!==revisions.at(-1)?.revision)revisions.push({tick,time,revision:changed});
      if(action)actions.push(action);
      for(const row of samples)observations.push(row);
      cursor+=samples.length;
      timing=phaseHash;
      for(const [system,seconds] of phases){
        const entry=steps.get(system)??{calls:0,seconds:0};
        entry.calls++;
        entry.seconds+=seconds;
        steps.set(system,entry);
      }
    }
    publish(prepare(origin,originQuery));
    return {
      plan,prepare,publish,
      submit(tick,count){
        if(!count)return;
        const last=submissions.at(-1);
        if(last?.tick===tick)submissions[submissions.length-1]={tick,count:last.count+count};
        else submissions.push({tick,count});
      },
      document(end){
        return freeze({version:1,plan,scene:{id,seed,revisions:revisions.slice()},submissions:submissions.slice(),
          actions:actions.slice(),observations:observations.slice(),
          timing:{dt,fromTick:origin.tick,toTick:end.tick,fromTime:origin.tick*dt,toTime:end.tick*dt,
            subdivision:rates?.subdivision??1,schedules,
            steps:Object.fromEntries([...steps].map(([name,entry])=>[name,{...entry}])),fingerprint:hex(timing)}});
      }
    };
  }

  function playback(log){
    check(record(log)&&log.format===R.runFormat&&log.version===1&&Array.isArray(log.commands)&&
      [log.origin,log.end].every(row=>row?.format===R.checkpointFormat&&row.version===1&&tickOK(row.tick)&&record(row.world))&&
      log.origin.tick<=log.end.tick,'Invalid world recording');
    if(playbacks.has(log))return playbacks.get(log);
    const commands=isImmutable(log.commands)?log.commands:freeze(copy(log.commands));
    if(log.evidence===undefined)return new Map([[log.origin.tick,commands]]);
    const {evidence}=log;
    check(record(evidence)&&evidence.version===1&&record(evidence.plan)&&record(evidence.scene)&&
      record(evidence.timing)&&['submissions','actions','observations'].every(key=>Array.isArray(evidence[key]))&&
      Array.isArray(evidence.scene.revisions),'Invalid run evidence');
    const timed=row=>record(row)&&tickOK(row.tick)&&row.tick>=log.origin.tick&&row.tick<=log.end.tick&&Number.isFinite(row.time);
    check(evidence.actions.every(row=>timed(row)&&Array.isArray(row.commands))&&
      evidence.observations.every(row=>timed(row)&&typeof row.status==='string'&&typeof row.observation==='string')&&
      evidence.scene.revisions.every(row=>timed(row)&&typeof row.revision==='string'),'Invalid timed run evidence');
    const result=new Map();
    let offset=0, previous=log.origin.tick-1;
    for(const row of evidence.submissions){
      check(record(row)&&tickOK(row.tick)&&row.tick>previous&&row.tick<=log.end.tick&&Number.isSafeInteger(row.count)&&
        row.count>0&&offset+row.count<=log.commands.length,'Invalid recorded action submission');
      const batch=commands.slice(offset,offset+row.count);
      check(batch.every(command=>record(command)&&tickOK(command.tick)&&command.tick>row.tick),
        'Recorded action must target a tick after its submission');
      result.set(row.tick,batch);
      offset+=row.count;
      previous=row.tick;
    }
    check(offset===log.commands.length,'Recorded submissions do not cover the command list');
    if(isImmutable(log))playbacks.set(log,result);
    return result;
  }

  function difference(expected,actual){
    if(!expected)return null;
    const rows=(kind,a,b)=>{
      for(let index=0;index<Math.max(a.length,b.length);index++){
        const left=a[index],right=b[index];
        if(!equal(left,right))return {
          kind,index,tick:Math.min(left?.tick??actual.timing.toTick,right?.tick??actual.timing.toTick),
          expected:left??null,actual:right??null
        };
      }
    };
    const {scene:a,timing:ta}=expected,{scene:b,timing:tb}=actual;
    const scene=a.id!==b.id||a.seed!==b.seed?{kind:'scene',tick:tb.fromTick,
      expected:{id:a.id??null,seed:a.seed??null},actual:{id:b.id,seed:b.seed}}:
      rows('scene-revision',a.revisions,b.revisions);
    return [scene,rows('actions',expected.actions,actual.actions),rows('observation',expected.observations,actual.observations),
      !equal(ta,tb)&&{kind:'timing',tick:tb.toTick,expected:ta,actual:tb}]
      .filter(Boolean).sort((a,b)=>a.tick-b.tick)[0]??null;
  }

  function mismatch(detail){
    const description=detail.kind==='checkpoint'?'': ' ('+detail.kind+
      (detail.kind==='observation'?' '+(detail.expected?.observation??detail.actual?.observation):'')+')';
    throw Object.assign(Error('Replay diverged at tick '+detail.tick+description),{runMismatch:freeze(detail)});
  }

  W.runRecords=Object.freeze({capture,playback,difference,mismatch});
})(KIT);
