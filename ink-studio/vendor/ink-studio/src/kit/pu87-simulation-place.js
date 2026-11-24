/* A portal place backed by the fixed-tick world runtime and its regional stream. */
(function (K) {
  const W=K.world, R=W.runtime, {check,record,id}=W.data, {freeze}=K.procedural.data;
  const format='ink-studio/simulation-place';
  const tickOK=tick=>Number.isSafeInteger(tick)&&tick>=0&&tick<=R.maxTick;
  const timeOK=time=>Number.isFinite(time)&&time>=0;
  const realize=(view,query)=>W.visual({makeBuilder,makeSculpt},view,query);

  function simulationPlace({id:name,source,anchors={},tickPolicy='pause',runtime={},
    regionRevisions=runtime?.regionRevisions,visual=realize,canArrive}={}) {
    check(id(name)&&(record(source)||typeof source==='function')&&record(anchors)&&
      ['pause','continue'].includes(tickPolicy)&&record(runtime)&&
      (regionRevisions===undefined||record(regionRevisions))&&
      (visual===false||typeof visual==='function')&&(canArrive===undefined||typeof canArrive==='function'),
    'Invalid simulation place definition');
    const resident=new WeakMap();
    async function prepare(context) {
      const {id:place,state,previous,time=0,signal,lifecycle}=context;
      if(signal?.aborted)return null;
      check(id(place)&&timeOK(time),'Invalid simulation place identity or clock');
      if(previous&&resident.get(previous)===place)return previous;

      const savedPlace=state?.format===format?state:null;
      if(savedPlace){
        check(savedPlace.version===1&&savedPlace.place===place&&record(savedPlace.clock)&&
          timeOK(savedPlace.clock.time)&&savedPlace.clock.time<=time&&tickOK(savedPlace.clock.tick)&&
          savedPlace.checkpoint?.format===R.checkpointFormat&&savedPlace.clock.tick<=savedPlace.checkpoint.tick,
        'Invalid saved state for simulation place '+place);
      }else if(state!==undefined)check(state?.format===R.checkpointFormat,'Invalid saved state for simulation place '+place);
      const input=savedPlace?.checkpoint??state??(typeof source==='function'?await source(context):source);
      if(signal?.aborted)return null;
      const checkpoint=input?.format===R.runFormat?input.end:input?.format===R.checkpointFormat?input:undefined;
      check(input?.format!==R.runFormat||input.version===1&&checkpoint?.format===R.checkpointFormat,
        'Invalid recording for simulation place '+place);
      const stream=regionRevisions===undefined?undefined:{...regionRevisions,stream:regionRevisions.stream??place};
      const run=R.create(checkpoint?.world??input,{...runtime,checkpoint,regionRevisions:stream,
        ...(lifecycle&&{validateEntities:rows=>{
          runtime.validateEntities?.(rows);
          lifecycle.assert(rows);
        }})});
      const initial=run.view(), {dt}=initial.world;
      const clock=freeze({time:savedPlace?.clock.time??time,tick:savedPlace?.clock.tick??initial.tick});
      let rendered, renderedQuery, saved, baseQuery, layers, frame;
      function scene(){
        const base=run.query(), overlay=lifecycle.scene();
        if(baseQuery!==base||layers!==overlay){
          frame=run.projectEntities(overlay);
          baseQuery=base;
          layers=overlay;
        }
        return frame;
      }
      const queryAt=lifecycle?()=>scene().query:run.query;
      const viewAt=lifecycle?()=>scene().view:run.view;
      const payload=Object.freeze({
        get world(){
          if(visual===false)return undefined;
          const query=queryAt();
          if(query!==renderedQuery){
            const next=visual(viewAt(),query);
            if(typeof next?.then==='function'){
              Promise.resolve(next).catch(()=>{});
              throw Error('Simulation place visual callbacks must be synchronous');
            }
            rendered=next;
            renderedQuery=query;
          }
          return rendered;
        },
        view:viewAt,query:queryAt,schedule:run.schedule,
        ...(lifecycle&&{authoredEntities:()=>run.view().world.entities}),
        ...(canArrive&&{canArrive:(actor,link)=>canArrive(actor,link,queryAt())}),
        ...(run.regions&&{regions:run.regions}),
        step({time}){
          check(timeOK(time)&&time>=clock.time,'Invalid elapsed simulation place time');
          const ticks=(time-clock.time)/dt, rounded=Math.round(ticks);
          const elapsed=Math.abs(ticks-rounded)<=Number.EPSILON*Math.max(1,ticks)*8?rounded:Math.floor(ticks);
          const target=clock.tick+elapsed;
          check(tickOK(target),'Simulation place clock exceeds the tick budget');
          if(target>run.view().tick)run.advance(target);
        },
        checkpoint(){
          const checkpoint=run.checkpoint();
          if(saved?.checkpoint!==checkpoint)saved=freeze({format,version:1,place,clock,checkpoint});
          return saved;
        }
      });
      resident.set(payload,place);
      return payload;
    }
    return Object.freeze({id:name,anchors,tickPolicy,prepare});
  }
  W.simulationPlace=simulationPlace;
})(KIT);
