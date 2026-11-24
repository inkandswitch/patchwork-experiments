/* Matched-tick debugging with actual solver inputs and optional saved evidence. */
(function(K){
  const W=K.world, {check,equal,own,record}=W.data, freeze=K.procedural.data.freeze;
  const format='ink-studio/step-trace', tickOK=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000000;
  const ordered=value=>Object.keys(value??{}).sort();
  const boundaryKeys=['states','outputs','manual','delays','signals','history','events','dropped','scenario','transfers',
    'sampling','simulationChunks','spatialSampling','dependencyWrites','weatherTrackState','causality'];

  function frame(checkpoint,actions,steps){
    const boundary=Object.fromEntries(boundaryKeys.filter(key=>own(checkpoint,key)).map(key=>[key,checkpoint[key]]));
    boundary.entities=checkpoint.world.entities;
    boundary.metadata=checkpoint.world.metadata;
    return freeze({tick:checkpoint.tick,time:checkpoint.tick*checkpoint.world.dt,boundary,
      ...(actions&&{actions}),...(steps&&{steps})});
  }

  function capture(retain){
    check(Number.isSafeInteger(retain)&&retain>=0&&retain<=4096,'Step trace retention must be 0–4096 ticks');
    const frames=[];
    let latest, attempt;
    return {
      start(){attempt=undefined;},
      enter(value){attempt=value;},
      leave(){attempt=undefined;},
      publish(checkpoint,actions,steps){
        latest=frame(checkpoint,actions,steps);
        if(retain){
          frames.push(latest);
          if(frames.length>retain)frames.shift();
        }
      },
      latest:()=>latest,
      attempt:()=>attempt,
      recording:()=>retain?freeze({format,version:1,frames:frames.slice()}):undefined
    };
  }

  const owner=port=>port.split('/')[0];
  function actionSystem(action){
    if(!action)return undefined;
    const [system,key]=W.data.endpoint(action.action);
    if(system!=='world')return system;
    if(key==='input')return owner(action.args.port);
    if(key==='transfer')return owner(action.args.from);
    return 'world';
  }
  const portsFor=(values,system)=>Object.fromEntries(ordered(values).filter(port=>owner(port)===system)
    .map(port=>[port,values[port]]));
  const inputsAt=(boundary,system)=>Object.fromEntries(ordered(boundary.manual).filter(port=>owner(port)===system)
    .map(port=>[port.slice(system.length+1),boundary.signals?.[port]??boundary.manual[port]]));
  function systemAt(boundary,system){
    return {state:boundary.states?.[system],outputs:portsFor(boundary.outputs,system),
      inputs:portsFor(boundary.manual,system),signals:portsFor(boundary.signals,system),
      delays:portsFor(boundary.delays,system),sampling:portsFor(boundary.sampling,system),
      events:(boundary.events??[]).filter(row=>row.system===system||row.solver===system),
      invalidations:(boundary.dependencyWrites??[]).filter(row=>row.writer===system),
      ...(own(boundary.simulationChunks?.clocks,system)&&{clock:boundary.simulationChunks.clocks[system]})};
  }
  function firstSystem(left,right){
    const systems=new Set([...ordered(left.states),...ordered(right.states)]);
    return [...systems].sort().find(system=>!equal(systemAt(left,system),systemAt(right,system)))??'world';
  }

  function preview(value){
    if(Array.isArray(value)&&value.length>12)return {type:'array',length:value.length};
    if(record(value)&&Object.keys(value).length>12)return {type:'record',keys:Object.keys(value).length};
    if(value&&typeof value==='object'&&JSON.stringify(value).length>1200)
      return {type:Array.isArray(value)?'array':'record',entries:Object.keys(value).length};
    if(typeof value==='string'&&value.length>400)return {type:'string',length:value.length,prefix:value.slice(0,400)};
    return value;
  }
  function changes(left,right,limit){
    const edits=[];
    function walk(a,b,path){
      if(a===b||edits.length>limit)return;
      if(Array.isArray(a)&&Array.isArray(b)){
        if(a.length!==b.length)walk(a.length,b.length,[...path,'length']);
        for(let i=0;i<Math.max(a.length,b.length)&&edits.length<=limit;i++)walk(a[i],b[i],[...path,i]);
      }else if(record(a)&&record(b)){
        for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
          if(edits.length>limit)break;
          walk(a[key],b[key],[...path,key]);
        }
      }else{
        edits.push({path,...(a!==undefined&&{left:preview(a)}),...(b!==undefined&&{right:preview(b)})});
      }
    }
    walk(left,right,[]);
    return {changes:edits.slice(0,limit),truncated:edits.length>limit};
  }
  function phase(row){
    if(!row)return null;
    const {system,fraction,substep,substeps,dt}=row;
    return {system,fraction,substep,substeps,dt};
  }
  const related=(row,system)=>row?.steps?.find(step=>step.system===system);
  function describe(kind,left,right,system,limit,details={}){
    const a=details.leftStep??related(left,system), b=details.rightStep??related(right,system);
    const wholeWorld=system==='world';
    const leftValue=wholeWorld?left?.boundary:details.leftStep??(left&&systemAt(left.boundary,system));
    const rightValue=wholeWorld?right?.boundary:details.rightStep??(right&&systemAt(right.boundary,system));
    const {leftStep,rightStep,...extra}=details;
    return {kind,tick:left?.tick??right.tick,system,time:{left:left?.time??null,right:right?.time??null},
      inputs:{left:a?.inputs??(left&&inputsAt(left.boundary,system))??null,
        right:b?.inputs??(right&&inputsAt(right.boundary,system))??null},
      phase:{left:phase(a),right:phase(b)},...extra,...changes(leftValue,rightValue,limit)};
  }
  function compareFrame(left,right,limit){
    if(left.actions&&right.actions&&!equal(left.actions,right.actions)){
      let i=0;
      while(i<left.actions.length&&i<right.actions.length&&equal(left.actions[i],right.actions[i]))i++;
      const a=left.actions[i]??null,b=right.actions[i]??null;
      const recipients=[a,b].filter(row=>row?.action==='world/transfer').map(row=>owner(row.args.to));
      const systems=[...new Set([actionSystem(a),actionSystem(b),...recipients].filter(Boolean))];
      return describe('actions',left,right,systems[0]??'world',limit,{actionIndex:i,actions:{left:a,right:b},systems});
    }
    if(left.steps&&right.steps){
      for(let i=0;i<Math.max(left.steps.length,right.steps.length);i++){
        const a=left.steps[i], b=right.steps[i];
        const details={leftStep:a,rightStep:b,stepIndex:i};
        if(!a||!b||a.system!==b.system||a.fraction!==b.fraction||a.substep!==b.substep||
          a.substeps!==b.substeps||a.dt!==b.dt)
          return describe('schedule',left,right,(a&&(!b||a.fraction<=b.fraction)?a:b).system,limit,details);
        if(!equal(a.inputs,b.inputs))return describe('inputs',left,right,a.system,limit,details);
        if(!equal(a.state,b.state))return describe('state',left,right,a.system,limit,details);
        if(!equal(a.outputs,b.outputs))return describe('outputs',left,right,a.system,limit,details);
        if(!equal(a.events,b.events)||!equal(a.invalidations,b.invalidations))
          return describe('effects',left,right,a.system,limit,details);
      }
    }
    if(left.time!==right.time)return {...describe('time',left,right,'world',limit),
      ...changes({time:left.time},{time:right.time},limit)};
    if(!equal(left.boundary,right.boundary)){
      const system=firstSystem(left.boundary,right.boundary);
      return describe('checkpoint',left,right,system,limit);
    }
    return null;
  }

  function timeline(source,options,to,{historical=false,replay=false}={}){
    const R=W.runtime;
    check(record(source),'Expected a world, checkpoint or recording');
    if(source.format===R.checkpointFormat){
      check(source.version===1&&tickOK(source.tick)&&record(source.world),'Invalid comparison checkpoint');
      return {from:source.tick,to:source.tick,origin:source.tick,kind:'checkpoint',read:()=>frame(source)};
    }
    const log=source.format===R.runFormat?source:null;
    if(log)check(log.version===1&&log.origin?.format===R.checkpointFormat&&log.end?.format===R.checkpointFormat&&
      tickOK(log.origin.tick)&&tickOK(log.end.tick)&&log.origin.tick<=log.end.tick&&Array.isArray(log.commands)&&
      record(log.origin.world)&&record(log.end.world),
      'Invalid comparison recording');
    if(log?.trace&&!replay){
      const trace=log.trace, list=trace.frames;
      check(record(trace)&&trace.format===format&&trace.version===1&&Array.isArray(list)&&list.length>0&&list.length<=4096&&
        list.every((item,i)=>record(item)&&tickOK(item.tick)&&item.tick===(list[0].tick+i)&&Number.isFinite(item.time)&&
          record(item.boundary)&&(Array.isArray(item.steps)&&Array.isArray(item.actions)||
            item.tick===log.origin.tick&&item.steps===undefined&&item.actions===undefined))&&
        list[0].tick>=log.origin.tick&&list.at(-1).tick===log.end.tick&&equal(list.at(-1).boundary,frame(log.end).boundary),
      'Invalid recording step trace');
      return {from:list[0].tick,to:log.end.tick,origin:log.origin.tick,kind:'recorded-steps',
        read:tick=>list[tick-list[0].tick]};
    }
    if(historical){
      check(log,'A single first-divergence input must be a recording');
      const points=[...new Set([log.origin.tick,log.end.tick])];
      return {from:log.origin.tick,to:log.end.tick,origin:log.origin.tick,kind:'recorded-checkpoints',points,
        read:tick=>frame(tick===log.origin.tick?log.origin:log.end)};
    }
    const world=log?.origin.world??source;
    const origin=log?.origin.tick??0, end=log?.end.tick??to??world.scenario?.until;
    check(tickOK(end)&&end>=origin,'A world comparison needs a target tick');
    let run;
    return {from:origin,to:end,origin,kind:log?'replayed':'simulated',
      read(tick){
        try {
          if(!run){
            const config={...options,traceSteps:0};
            run=log?R.openRecording(log,config):R.create(world,config);
          }
          run.advance(tick);
        } catch(error) {
          const attempt=run?.stepAttempt();
          return {failure:{tick:run?run.view().tick+1:origin,system:attempt?.system??'world',
            inputs:attempt?.inputs??null,message:error.message}};
        }
        const actual=run.stepFrame();
        if(log&&tick===end){
          const expected=frame(log.end);
          if(!equal(expected.boundary,actual.boundary))return {actual,expected};
        }
        return actual;
      }};
  }
  function firstDivergence(left,right,{from,to,limit=48,leftOptions,rightOptions,leftReplay=false,rightReplay=false}={}){
    check((from===undefined||tickOK(from))&&(to===undefined||tickOK(to))&&
      Number.isSafeInteger(limit)&&limit>0&&limit<=1000,'Invalid first-divergence range or change limit');
    const single=right===undefined;
    check(!single||left?.format===W.runtime.runFormat,'A single first-divergence input must be a recording');
    const horizon=to??left?.end?.tick??right?.end?.tick??left?.tick??right?.tick??
      left?.scenario?.until??right?.scenario?.until;
    const a=timeline(left,leftOptions,horizon,{historical:single,replay:!single&&leftReplay});
    const b=timeline(single?left:right,rightOptions,horizon,{replay:single||rightReplay});
    const begin=Math.max(a.from,b.from,from??0), end=Math.min(a.to,b.to,to??10000000);
    check(begin<=end,'The timelines have no matching ticks');
    const points=a.points?.filter(tick=>tick>=begin&&tick<=end);
    check(!points||points.length>0,'No recorded checkpoints in the selected range');
    const coverage={from:begin,to:end,mode:points||a.kind==='checkpoint'||b.kind==='checkpoint'?'checkpoints':'continuous',
      startsAtCommonOrigin:begin===Math.max(a.origin,b.origin)};
    const sources={left:a.kind,right:b.kind};
    let comparedTicks=0;
    for(let i=0;i<(points?.length??end-begin+1);i++){
      const tick=points?.[i]??begin+i, left=a.read(tick), right=b.read(tick);
      let first;
      if(left.failure||right.failure){
        const failures={left:left.failure??null,right:right.failure??null};
        const failed=left.failure&&(!right.failure||left.failure.tick<=right.failure.tick)?left.failure:right.failure;
        first={kind:'failure',tick:failed.tick,system:failed.system,failures};
        if(equal(left.failure,right.failure))return freeze({status:'failed',sources,coverage,comparedTicks,first});
      }else{
        comparedTicks++;
        first=compareFrame(left.actual??left,right.actual??right,limit);
        if(!first&&(left.expected||right.expected)){
          const mismatch=left.expected?left:right;
          const result=compareFrame(mismatch.expected,mismatch.actual,limit);
          first={...result,kind:'recorded-endpoint',side:left.expected?'left':'right'};
        }
      }
      if(first)return freeze({status:'diverged',sources,coverage,comparedTicks,first});
    }
    return freeze({status:'equal',sources,coverage,comparedTicks});
  }
  W.stepDebug=Object.freeze({capture,firstDivergence,actionSystem});
})(KIT);
