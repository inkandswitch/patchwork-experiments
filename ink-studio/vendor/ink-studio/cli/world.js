const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const CheckpointStore = require('../src/simulation-checkpoint-store.js');

const read = file => JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const parse = input => JSON.parse(String(input));
const numbers = value => String(value).split(',').map(Number);
function ensure(condition,message) {
  if (!condition) throw Error(message);
}
function write(file,value) {
  ensure(typeof file === 'string' && file.length > 0,'Expected an output file');
  const destination = path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const temporary = destination+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    fs.renameSync(temporary,destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function readCheckpointFile(file) {
  const value = read(file);
  if (value?.format !== CheckpointStore.format) return { value };
  ensure(typeof value.store === 'string' && value.store.length > 0, 'Checkpoint reference needs a store path');
  const store = path.resolve(path.dirname(path.resolve(file)), value.store);
  return { value: CheckpointStore.openCheckpointStore(store).load(value), store };
}
function target(opt) {
  if (opt.select !== undefined) {
    ensure(opt.at === undefined && opt.entity === undefined && opt.socket === undefined, 'Use --select by itself');
    return parse(opt.select);
  }
  if (opt.at !== undefined) return {point:numbers(opt.at)};
  if (opt.entity !== undefined) return {entity:opt.entity,...(opt.socket?{socket:opt.socket}:{})};
  return {};
}

module.exports = function createCLI({kit,build,pose,dataScene,opt,renderOptions,sequenceHistory,inkOption,atmosphereEmittersOption,depthBandsOption,effectPalettesOption,stabilityOption,artDirectionOption,silhouetteOption,horizonOption,skyTransitionsOption,weatherTracksOption,skyOptions,cameraOptions,compositeOption,shot,shotReplay,shotRender}) {
  const W = kit.KIT.world, R = W.runtime;
  let workerPool;
  const args = () => opt.args ? parse(opt.args) : {};
  function sampleArgs() {
    if (opt.explain === undefined) return args();
    ensure(opt.explain === true,'Use --explain without a value');
    return {...args(),explain:true};
  }
  function fieldMetadata(query,name) {
    const descriptor = query.field?.(name);
    return descriptor?.spatial ? {type:descriptor.type,units:descriptor.units,spatial:descriptor.spatial} : {};
  }
  const respond = value => {
    if (opt.out) write(opt.out,value);
    else process.stdout.write(JSON.stringify(value,null,opt.json?0:2)+'\n');
  };
  function document(world, file) {
    if (file !== undefined && world.dataInputs !== undefined) world = { ...world,
      dataInputs: require('./data-inputs.js').embed(kit.KIT.dataInputs, world.dataInputs, file, shot?.dependency) };
    if (opt['asset-pack'] === undefined) return {world};
    const packs = require('./asset-pack.js').install(kit.KIT.authoring.assetPacks, world.assetPacks, opt['asset-pack']);
    return {world:{...world,assetPacks:packs}};
  }
  function load(file, { lookPreview = false } = {}) {
    ensure(typeof file === 'string','Expected a scene or run file');
    if (/\.(js|cjs)$/i.test(file)) {
      const factory = require(path.resolve(file)), value = typeof factory === 'function' ? factory(kit) : factory;
      return value.format===W.format ? document(value,file) : value.simulation ? document(value.simulation,file) : {legacy:file};
    }
    if (/\.json$/i.test(file)) {
      const { value,store } = readCheckpointFile(file);
      if (value.format === W.format) return document(value,file);
      if (!lookPreview && [R.checkpointFormat,R.runFormat].includes(value.format))
        ensure(opt['asset-pack']===undefined,'Recorded runs and checkpoints keep their original asset packs');
      if (value.format === R.checkpointFormat) return {world:value.world,checkpoint:value,store};
      if (value.format === R.runFormat) return {world:value.end.world,checkpoint:value.end,log:value,store};
      const bundles = kit.KIT.authoring.projectBundles;
      if (bundles && value.format === bundles.format) return { legacy: file, document: bundles.open(value).scene() };
      return {legacy:file,document:value};
    }
    return {legacy:file};
  }
  function sourceWorld(input) {
    ensure(input.world,'The scene must expose an Ink Studio world manifest');
    if (input.checkpoint) ensure(opt.seed===undefined && opt.dt===undefined,'A resumed run uses its checkpoint seed and timestep');
    return !input.checkpoint && (opt.seed !== undefined || opt.dt !== undefined)
      ? {...input.world,...(opt.seed===undefined?{}:{seed:Number(opt.seed)}),...(opt.dt===undefined?{}:{dt:Number(opt.dt)})}
      : input.world;
  }
  function runtime(input, profile = false, regionRevisions, recordRun) {
    return R.create(sourceWorld(input),{checkpoint:input.checkpoint,profile,workerPool,regionRevisions,traceSteps:traceRetention(),recordRun});
  }
  function recordingRun(input, options) {
    sourceWorld(input);
    return R.openRecording(input.log,{workerPool,traceSteps:traceRetention(),...options});
  }
  function recordOptions() {
    ensure(opt.observations===undefined||typeof opt.observations==='string'&&typeof opt.record==='string',
      '--observations needs a plan file and --record FILE');
    if(opt.observations===undefined)return opt.record?true:undefined;
    const plan=read(opt.observations);
    ensure(W.data.record(plan?.observations),'The observation plan needs named observations');
    return plan;
  }
  function traceRetention(){
    const value=opt['trace-steps'];
    if(value===undefined)return undefined;
    if(value===true)return 256;
    const count=Number(value);
    ensure(/^\d+$/.test(value)&&Number.isInteger(count)&&count>=1&&count<=4096,
      '--trace-steps needs a retention count from 1 to 4096');
    return count;
  }
  function to(run) {
    const {tick,world} = run.view(), modes = [opt.ticks,opt.steps,opt.t].filter(v => v !== undefined);
    ensure(modes.length<=1 && modes.every(v => v!==true && Number.isFinite(Number(v))),'Specify one finite time using --ticks, --steps or --t');
    return opt.ticks !== undefined ? Number(opt.ticks) :
      opt.steps !== undefined ? tick + Number(opt.steps) :
      opt.t !== undefined ? Math.floor(Number(opt.t)/world.dt+1e-10) :
      world.scenario?.until !== undefined ? Math.max(tick,world.scenario.until) : tick;
  }
  function schedule(run) {
    if (opt.actions) run.schedule(read(opt.actions));
  }
  function snapshotRun(input, run, tick) {
    if (input.log && tick < run.view().tick) {
      const { origin } = input.log;
      ensure(tick >= origin.tick, 'Tick precedes the start of the recording');
      run = recordingRun(input);
    }
    schedule(run);
    return run;
  }
  function advanceVisual(run, tick) {
    const emitters = kit.KIT.atmosphere.emitters;
    const { world, tick: start } = run.view();
    const program = emitters.settings(W.visualEnvironment(world).atmosphereEmitters, atmosphereEmittersOption?.());
    const targets = program?.targets.filter(target => target.entity !== undefined);
    if (!targets?.length || tick < start) {
      run.advance(tick);
      return;
    }
    const history = emitters.history(targets, program.lifetime);
    function observe(view, query) {
      history.capture(view.time, target => emitters.entityPose(query, target));
    }
    run.advance(Math.max(start, tick-Math.ceil(program.lifetime/world.dt)-1));
    observe(run.view(), run.query());
    run.advance(tick, {onTick:observe});
    return history.at;
  }
  function visualSnapshot(input, at) {
    const initial = runtime(input);
    const tick = at !== undefined ? Math.floor(at/initial.view().world.dt+1e-10) :
      opt.steps === undefined && opt.ticks === undefined && opt.t === undefined ? initial.view().tick : to(initial);
    const run = snapshotRun(input, initial, tick);
    const atmospherePose = advanceVisual(run,tick);
    const view = run.view(), Preview = require('./look-preview.js');
    const world = Preview.withAlbedo(() => W.visual(kit, view, run.query()));
    return { ...world, ...(atmospherePose && {atmospherePose}), id: view.world.id, assetPacks: view.world.assetPacks,
      ...(!input.checkpoint && { lookPreviewPacks: view.world.assetPacks }) };
  }
  function environmentSnapshot(file) {
    const input=load(file);
    return input.world ? visualSnapshot(input) : null;
  }
  function visualSweep(file, plan, directory, overrides = {}, anchor, loaded) {
    const input = loaded ?? load(file);
    ensure(input.world, 'A simulation sweep needs a world, checkpoint or recording');
    const current = sourceWorld(input);
    const world = input.checkpoint ?? { ...current, ...overrides };
    let previous, history;
    const render = require('./render.js');
    return require('./visual-sweep.js').runSimulation({
      kit: kit.KIT, source: file, plan, directory, input: world, workerPool, runtime: overrides, anchor,
      renderFrame(snapshot, query, { width: w, height: h, pixelSize: px, times }, id, tick, t) {
        if (previous !== id) {
          previous = id;
          history = times.length ? sequenceHistory() : undefined;
        }
        const world = W.visual(kit, snapshot, query);
        const temporal = times.includes(tick) ? history : undefined;
        return render.upscale(render.render(world, { ...temporal, w, h, px, t, transparent: false }), px);
      }
    });
  }
  function lookSnapshot(file) {
    const input = load(file, { lookPreview: true });
    return input.world ? visualSnapshot(input) : null;
  }
  function view(file) {
    const input = load(file);
    if (input.world) {
      let run = runtime(input);
      if (opt.actions || opt.ticks !== undefined || opt.steps !== undefined || opt.t !== undefined) {
        const tick = to(run);
        run = snapshotRun(input, run, tick);
        run.advance(tick);
      }
      return run.query();
    }
    const world = build(input.legacy);
    const t = Number(opt.t ?? 0);
    ensure(Number.isFinite(t) && t>=0,'Invalid probe time');
    pose(world,t);
    return W.query.fromScene(world,t);
  }
  function inspectLook(file) {
    return view(file).inspectLook({renderer:opt.renderer});
  }
  function inspectTimeline(file) {
    const input = load(file);
    const timeline = input.world ? W.sceneTimeline(input.world) :
      input.document?.format === W.scrub.takeFormat ? W.scrub.openTake(input.document) : build(input.legacy).timeline;
    ensure(timeline, 'This scene has no unified timeline');
    const at = Number(opt.at ?? 0), from = Number(opt.from ?? -1), to = Number(opt.to ?? timeline.duration);
    ensure(![opt.at, opt.from, opt.to].includes(true), 'Timeline times need numeric values');
    respond({ duration: timeline.duration, targets: timeline.targets, frame: timeline.sample(at), cues: timeline.between(from, to) });
  }
  function inspectCameraRig(file) {
    ensure(file && opt.at !== true, 'Use camera-rig <scene or world> [--at seconds] [--camera-shot ID]');
    const at = opt.at === undefined ? undefined : Number(opt.at);
    ensure(at === undefined || Number.isFinite(at) && at >= 0, 'Camera rig time must be nonnegative and finite');
    const input = load(file);
    const world = input.world ? visualSnapshot(input, at) : build(input.legacy);
    const t = at ?? world.lookSnapshot?.time ?? 0;
    if (!input.world) pose(world, t);
    const rig = world.cameraRig;
    ensure(rig, 'This scene has no authored camera rig');
    const { cameraShot } = cameraOptions();
    respond({ duration: rig.duration, shots: rig.shots, ...rig.sample(t, { shot: cameraShot }) });
  }
  function assert(run,rules) {
    ensure(Array.isArray(rules) && rules.length<=10000,'Expected an assertion list');
    const out=[], temporal=[];
    const log=run.recording(), tick=run.view().tick;
    function evaluate(rule,query,at) {
      const sample=query.probe(rule.field,rule.at,rule.args);
      return {id:rule.id,tick:at,pass:sample.status===(rule.status??'ok')&&W.query.condition(rule.when,sample.value),result:sample};
    }
    for(const [i,raw] of rules.entries()){
      ensure(raw&&typeof raw==='object','Expected assertion '+(i+1));
      const rule={id:i+1,...raw};
      if(rule.profile!==undefined){
        const metric=rule.metric??'ms', data=run.profile()[rule.profile]?.[metric];
        ensure(['ms','maxMs','calls'].includes(metric)&&Number.isFinite(rule.max)&&rule.max>=0,'Invalid profile assertion');
        out[i]={id:rule.id,pass:Number.isFinite(data)&&data<=rule.max,result:{metric,value:data??null,max:rule.max}};
        continue;
      }
      ensure(typeof rule.field==='string','Assertion '+rule.id+' needs a field');
      if(rule.tick===undefined&&rule.byTick===undefined){out[i]=evaluate(rule,run.query(),tick);continue;}
      const at=rule.tick??rule.byTick;
      ensure((rule.tick===undefined||rule.byTick===undefined)&&Number.isSafeInteger(at)&&at>=log.origin.tick&&at<=tick,
        'Assertion tick lies outside the run');
      temporal.push({i,rule,at});
    }
    if(temporal.length){
      const replay=R.openRecording(log,{workerPool});
      const exact=new Map(), deadlines=[];
      for(const item of temporal){
        if(item.rule.tick===undefined)deadlines.push(item);
        else {
          const group=exact.get(item.at)??[];
          group.push(item);
          exact.set(item.at,group);
        }
      }
      function sample(frame,query){
        for(const {i,rule} of exact.get(frame.tick)??[])out[i]=evaluate(rule,query,frame.tick);
        for(const {i,rule,at} of deadlines){
          if(out[i])continue;
          const result=evaluate(rule,query,frame.tick);
          if(result.pass||frame.tick===at)out[i]=result;
        }
      }
      sample(replay.view(),replay.query());
      replay.advance(Math.max(...temporal.map(item=>item.at)),{onTick:sample});
    }
    return out;
  }
  function summary(run, checks) {
    const checkpoint = run.checkpoint(), {world,tick} = checkpoint;
    const rates = run.rates?.();
    const chunkLevels=checkpoint.simulationChunks&&Object.fromEntries(Object.values(checkpoint.simulationChunks.entries)
      .map(({id,level})=>[id,level]));
    return {id:world.id,seed:world.seed,dt:world.dt,tick,time:tick*world.dt,...(rates && {rates}),
      ...(chunkLevels&&{chunkLevels}),
      ...(workerPool&&{partitions:run.partitions()}),
      systems:Object.keys(checkpoint.states),commands:run.commandCounts(),events:checkpoint.history.length,historyDropped:checkpoint.dropped,
      scenario:run.scenario,...(checks?{checks}:{}),...(opt.profile?{profile:run.profile()}:{})};
  }
  function saveCheckpoints(sourceStore) {
    const directory=opt['checkpoint-store']==='off'?undefined:opt['checkpoint-store']??sourceStore;
    const store=directory&&CheckpointStore.openCheckpointStore(directory), storage={};
    return { storage, save(key,file,value) {
      if(!store){write(file,value);return;}
      ensure(typeof file==='string'&&file.length>0,'Expected an output file');
      const {reference,...stats}=store.save(value);
      const location=path.relative(path.dirname(path.resolve(file)),store.directory)||'.';
      write(file,{...reference,store:location});
      storage[key]={root:reference.root,...stats};
    } };
  }
  function finish(run, sourceStore) {
    const checks = opt.assert ? assert(run,read(opt.assert)) : null;
    const { storage, save } = saveCheckpoints(sourceStore);
    if (opt.checkpoint) save('checkpoint',opt.checkpoint,run.checkpoint());
    if (opt.record) save('record',opt.record,run.recording());
    respond({...summary(run,checks),...(Object.keys(storage).length&&{storage})});
    if (checks?.some(row => !row.pass) || opt.scenario && ['fail','timeout'].includes(run.scenario.status))
      process.exitCode = 2;
  }
  function getCheckpoint(file) {
    const input = load(file);
    ensure(input.checkpoint,'Expected a checkpoint or recording');
    if (opt.ticks === undefined || Number(opt.ticks)===input.checkpoint.tick) return input.checkpoint;
    ensure(input.log,'Earlier ticks require a recording');
    const at=Number(opt.ticks);
    ensure(Number.isSafeInteger(at)&&at>=input.log.origin.tick&&at<=input.log.end.tick,'Tick lies outside the recording');
    const session = W.scrub.create(input.log, { checkpointCache: 0, runtime: { workerPool } });
    session.seek(at);
    return session.checkpoint();
  }
  function scrubSession(input) {
    const world = sourceWorld(input);
    const number = key => opt[key] === undefined ? undefined :
      typeof opt[key] === 'string' && /^\d+$/.test(opt[key]) ? Number(opt[key]) : NaN;
    return W.scrub.create(input.log ?? input.checkpoint ?? world, {
      checkpointEvery: number('checkpoint-every'), checkpointCache: number('checkpoint-cache'),
      commands: opt.actions === undefined ? [] : read(opt.actions), runtime: { workerPool }
    });
  }
  function scrubSimulation(file) {
    const input = load(file), session = scrubSession(input);
    const value = opt.ticks ?? opt.t;
    ensure(!(opt.ticks !== undefined && opt.t !== undefined) && typeof value === 'string' &&
      value.split(',').every(item => item.trim()), 'Give an ordered seek list using --ticks N,N or --t seconds,seconds');
    const times = numbers(value);
    ensure(times.length <= 1000, 'Scrub supports up to 1000 seeks per report');
    const frames = times.map(at => {
      const view = opt.ticks === undefined ? session.seekTime(at) : session.seek(at);
      const { checkpointTick, replayedTicks } = session.status(), query = session.query();
      return { tick: view.tick, time: view.time, ...(opt.ticks === undefined && { requestedTime: at }),
        checkpointTick, replayedTicks, events: session.events(),
        ...(opt.field ? { sample: query.probe(opt.field, target(opt), args()) } :
          opt.entity ? { pose: query.frame(target(opt)) ?? null } : {}) };
    });
    let stored = {};
    if (opt.checkpoint !== undefined) {
      ensure(typeof opt.checkpoint === 'string' && (!opt.out || path.resolve(opt.checkpoint) !== path.resolve(opt.out)),
        'Use separate paths for the scrub report and checkpoint');
      const { storage, save } = saveCheckpoints(input.store);
      save('checkpoint', opt.checkpoint, session.checkpoint());
      if (storage.checkpoint) stored = { storage };
    }
    respond({ id: session.view().world.id, ...session.status(), frames, ...stored });
  }
  function captureTake(file) {
    const input = load(file), session = scrubSession(input);
    const tick = (key, fallback) => {
      const value = opt[key];
      if (value === undefined) return fallback;
      ensure(typeof value === 'string' && /^\d+$/.test(value), '--' + key + ' needs a tick number');
      return Number(value);
    };
    ensure(opt.t === undefined && opt.steps === undefined, 'Use --from and --ticks to set the take range');
    ensure(opt.tracks === undefined || typeof opt.tracks === 'string' && opt.entity === undefined && opt.part === undefined,
      'Use --tracks FILE or --entity ID with an optional --part ID');
    const tracks = opt.tracks ? read(opt.tracks) : W.scrub.motionTracks(opt.entity, opt.part);
    respond(session.recordTake({ tracks, from: tick('from', session.status().fromTick),
      to: tick('ticks', input.log?.end.tick), every: tick('every', 1) }));
  }
  function dependencyReport(file) {
    ensure(typeof file==='string','Supply a world, recording or retained dependency driver');
    if (/\.(js|cjs)$/i.test(file)) {
      const source = require(path.resolve(file));
      if (typeof source.dependencies === 'function') {
        ensure(['ticks','steps','t','actions'].every(key=>opt[key]===undefined),
          'Retained dependency drivers supply their own edits');
        return Promise.resolve(source.dependencies(kit)).then(respond);
      }
    }
    const input = load(file);
    const run = input.log ? recordingRun(input) : runtime(input);
    schedule(run);
    const start = run.view().tick;
    const end = input.log && opt.ticks===undefined && opt.steps===undefined && opt.t===undefined ? input.log.end.tick : to(run);
    const ticks = [];
    run.advance(end,{onTick(view) {
      const {changes,affected,work,pending} = run.dependencies();
      if (changes.length || work.length || pending.length) {
        ensure(ticks.length<10000,'Spatial dependency report exceeds its tick budget');
        ticks.push({tick:view.tick,changes,affected,work,...(pending.length && {pending})});
      }
    }});
    return respond({format:'ink-studio/spatial-dependencies',version:1,id:run.view().world.id,
      fromTick:start,toTick:end,declarations:run.dependencies().declarations,ticks,
      ...(workerPool&&{partitions:run.partitions()})});
  }
  function sim(args) {
    ensure(opt['checkpoint-store']===undefined||typeof opt['checkpoint-store']==='string'&&
      opt['checkpoint-store'].length>0,'--checkpoint-store needs a directory or off');
    if(opt.workers!==undefined){
      ensure(typeof opt.workers==='string'&&/^\d+$/.test(opt.workers),'--workers needs a count from 1 to 32');
      workerPool=require('../index.js').createSimulationWorkers(Number(opt.workers));
    }
    try {
      return runSimulation(args);
    } finally {
      workerPool?.close();
      workerPool=undefined;
    }
  }
  function regionUpdate(file){
    const input=load(file);
    ensure(typeof opt.stream==='string','Region revisions need --stream ID');
    ensure(opt.global===undefined||opt.global===true,'Use --global without a value');
    ensure(opt.regions===undefined||typeof opt.regions==='string','Use --regions ID,ID for an explicit selection');
    ensure(opt.near===undefined||typeof opt.near==='string','Use --near X,Y,Z for a nearby selection');
    ensure(opt.since===undefined||typeof opt.since==='string','Use --since FILE for an applied cursor');
    const regionRevisions={stream:opt.stream,...(opt.retain!==undefined&&{retain:opt.retain===true?NaN:Number(opt.retain)})};
    const run=input.log?recordingRun(input,{regionRevisions}):runtime(input,false,regionRevisions);
    schedule(run);
    const tick=input.log&&opt.ticks===undefined&&opt.steps===undefined&&opt.t===undefined?input.log.end.tick:to(run);
    run.advance(tick);
    if(input.log&&!opt.actions&&tick===input.log.end.tick)
      ensure(W.data.equal(run.checkpoint(),input.log.end),'Replay diverged at tick '+tick);
    const selected={
      ...(opt.regions!==undefined&&{regions:opt.regions===''?[]:opt.regions.split(',')}),
      ...(opt.near!==undefined&&{at:numbers(opt.near)}),...(opt.place!==undefined&&{place:opt.place}),
      ...(opt.radius!==undefined&&{radius:opt.radius===true?NaN:Number(opt.radius)}),...(opt.global&&{includeGlobal:true})
    };
    const last=opt.since&&read(opt.since);
    return respond(run.regions.pull(selected,{since:last?.cursor??last??undefined}));
  }
  function applyRegionUpdate(file,other){
    const mirror=W.regionRevisions.receiver();
    ensure(mirror.apply(read(file)).status==='applied','Expected a region snapshot as the baseline');
    const applied=mirror.apply(read(other));
    ensure(['applied','duplicate'].includes(applied.status),'Region update '+applied.status);
    return respond(mirror.snapshot());
  }
  function firstDivergence(file,other){
    ensure(opt.first===true,'Use --first without a value');
    ensure(opt.field===undefined&&opt.spec===undefined&&opt.t===undefined&&opt.steps===undefined,
      'Use --from and --ticks for a first-divergence comparison');
    const source=file=>{
      const input=load(file);
      ensure(input.world,'First-divergence comparison needs a world, checkpoint or recording');
      return input.log??input.checkpoint??input.world;
    };
    const count=(value,name)=>{
      if(value===undefined)return undefined;
      ensure(typeof value==='string'&&/^\d+$/.test(value),'--'+name+' needs a nonnegative integer');
      return Number(value);
    };
    const pools=[];
    function side(key){
      const workers=count(opt[key],key);
      if(workers===undefined)return workerPool;
      if(workers===0)return undefined;
      const pool=require('../index.js').createSimulationWorkers(workers);
      pools.push(pool);
      return pool;
    }
    try {
      return respond(R.firstDivergence(source(file),other===undefined?undefined:source(other),{
        from:count(opt.from,'from'),to:count(opt.ticks,'ticks'),limit:count(opt.limit,'limit'),
        leftOptions:{workerPool:side('left-workers')},rightOptions:{workerPool:side('right-workers')},
        leftReplay:opt['left-workers']!==undefined||opt.workers!==undefined,
        rightReplay:opt['right-workers']!==undefined||opt.workers!==undefined
      }));
    } finally {
      for(const pool of pools)pool.close();
    }
  }
  function runSimulation([mode,file,other]) {
    switch (mode) {
      case 'run':
      case 'resume':
      case 'fork': {
        const input = load(file);
        ensure(mode==='run' || input.checkpoint,'Expected a checkpoint or recording to resume or fork');
        const run = runtime(input,!!(opt.profile||opt.assert),undefined,recordOptions());
        schedule(run);
        run.advance(to(run),{stopOnOutcome:!!opt.scenario});
        finish(run,input.store);
        break;
      }
      case 'plan': return respond(runtime(load(file)).composition());
      case 'dependencies': return dependencyReport(file);
      case 'scrub': return scrubSimulation(file);
      case 'take': return captureTake(file);
      case 'regions': return regionUpdate(file);
      case 'regions-apply': return applyRegionUpdate(file,other);
      case 'reset': {
        const input=load(file);
        const recordRun=recordOptions();
        finish(input.log?R.create(input.log.origin.world,{checkpoint:input.log.origin,workerPool,recordRun}):
          runtime(input,false,undefined,recordRun),input.store);
        break;
      }
      case 'replay': {
        const input=load(file);
        ensure(input.log,'Expected a run recording');
        ensure(opt.observations===undefined,'The replay uses the observation plan saved with the run');
        finish(R.replay(input.log,{profile:!!(opt.profile||opt.assert),workerPool,traceSteps:traceRetention(),
          recordRun:recordOptions()}),input.store);
        break;
      }
      case 'verify': {
        const {log}=load(file);
        ensure(log,'Expected a run recording');
        const report=R.verify(log,{workerPool});
        respond(report);
        if(report.status==='diverged')process.exitCode=2;
        break;
      }
      case 'diff': {
        if(opt.first!==undefined)return firstDivergence(file,other);
        const a=getCheckpoint(file), b=getCheckpoint(other);
        if(!opt.field){respond(R.diff(a,b));break;}
        ensure(a.tick===b.tick,'Simulation diff needs matched ticks');
        const queries=[a,b].map(checkpoint=>R.create(checkpoint.world,{checkpoint}).query());
        const spec=opt.spec?read(opt.spec):null;
        const readings=queries.map(query=>spec?query.export(opt.field,spec,args()):query.probe(opt.field,target(opt),args()));
        respond({tick:a.tick,field:opt.field,edits:W.query.keyedChanges(...readings),...(spec?{grid:readings[0].grid}:{})});
        break;
      }
      case 'sweep': {
        const spec=read(other);
        if (W.data.record(spec) && spec.visual !== undefined) {
          const sweeps = require('./visual-sweep.js');
          const directory = sweeps.outputPath(opt, ['workers', 'seed', 'dt', 'actions']);
          const source = path.resolve(file), input = load(source);
          const actions = opt.actions === undefined ? [] : read(opt.actions);
          ensure(Array.isArray(actions) && Array.isArray(spec.actions ?? []), 'Sweep actions need a command list');
          const recipe = { ...spec, actions: [...actions, ...(spec.actions ?? [])] };
          const overrides = {
            ...(opt.dt !== undefined && { dt: Number(opt.dt) }),
            ...(opt.seed !== undefined && { seed: Number(opt.seed) })
          };
          const result = visualSweep(source, recipe, directory, overrides, undefined, input);
          console.log('wrote', result.report, '(' + result.cases + ' cases)');
          return;
        }
        if (W.data.record(spec)) {
          ensure(opt.ticks===undefined&&opt.steps===undefined&&opt.t===undefined,
            'The observation plan sets the sweep sample ticks');
          const input=load(file), world=sourceWorld(input);
          return respond(W.observations.run(input.checkpoint??world,spec,{
            runtime:{workerPool},actions:opt.actions===undefined?[]:read(opt.actions)
          }));
        }
        ensure(Array.isArray(spec) && spec.length>0 && spec.length<=2000,'Expected a bounded sweep list');
        const lookPreview = spec.some(row => row && Object.hasOwn(row, 'look'));
        const input=load(file,{lookPreview});
        ensure(input.world,'Sweep needs a simulation world');
        if (lookPreview) {
          const { report } = require('./look-compare.js').compare(visualSnapshot(input), spec, kit,
            renderOptions({ w: Number(opt.w ?? 720), h: Number(opt.h ?? 475) }), { opt, file: other });
          const { results, ...summary } = report;
          respond({ ...summary, runs: results });
          break;
        }
        const runs=spec.map((row,i)=>{
          let source=input.world;
          if (row.edits || row.seed!==undefined) {
            ensure(!input.checkpoint,'Use scheduled actions to vary a checkpoint branch');
            if (row.edits) source=W.apply(W.manifest(source),row.edits).world;
            if (row.seed!==undefined) source={...source,seed:row.seed};
          }
          const run=runtime({...input,world:source},!!(opt.profile||row.assert));
          run.schedule(row.actions??[]);
          run.advance(row.ticks??to(run),{stopOnOutcome:!!opt.scenario});
          const measurements=(row.probes??[]).map(spec=>({field:spec.field,...run.query().probe(spec.field,spec.at,spec.args)}));
          return {id:row.id??i, ...summary(run,row.assert?assert(run,row.assert):null),measurements};
        });
        respond({runs});
        if (runs.some(row => row.checks?.some(check => !check.pass))) process.exitCode=2;
        break;
      }
      case 'render': {
        const recording=shotReplay?.runtime;
        const input=recording ? null : load(file);
        const initial=recording ? R.openRecording(recording,{workerPool,recordRun:recording.evidence?.plan}) : runtime(input);
        const tick=recording?.end.tick ?? to(initial);
        const run=recording ? initial : snapshotRun(input,initial,tick);
        ensure(typeof opt.out==='string','Simulation render needs --out image.png');
        const output=path.resolve(opt.out), diagnostics=require('./look-preview.js').preview(opt);
        const suffixes=diagnostics?.suffixes ?? [];
        shot?.destination(output,suffixes);
        const atmospherePose=advanceVisual(run,tick);
        if (recording) ensure(W.data.equal(run.checkpoint(),recording.end),
          'Shot simulation checkpoint diverged at tick '+recording.end.tick);
        if (shot) {
          shot.seed(run.view().world.seed);
          shot.runtime(run.recording());
        }
        const world=W.visual(kit,run.view(),run.query(),{controls:opt.params===undefined?undefined:parse(opt.params)});
        if (atmospherePose) world.atmospherePose=atmospherePose;
        const studio=require('../index.js');
        const image=studio.render(world,{w:Number(opt.w??720),h:Number(opt.h??475),colored:!!opt.colored,
          ink:inkOption?.(),
          colorCurves:opt['color-curves']==='off'?false:undefined,
          colorLut:require('./lut.js').override(opt.lut),
          paletteConstraints:require('./palette-constraints.js').override(opt['palette-constraints']),
          water:opt.water==='off'?false:undefined, effectPalettes:effectPalettesOption?.(), stable:stabilityOption?.(), artDirection:artDirectionOption?.(), silhouetteProtection:silhouetteOption?.(),
          horizonBands:horizonOption?.(), skyTransitions:skyTransitionsOption?.(), weatherTracks:weatherTracksOption?.(),
          ...skyOptions?.(), ...cameraOptions?.(), composite:compositeOption?.(),
          atmosphere:opt.atmosphere==='off'?false:undefined, atmosphereEmitters:atmosphereEmittersOption?.(),
          atmosphereDepthBands:depthBandsOption?.(),
          coverageAware:opt['coverage-aware']===undefined?undefined:opt['coverage-aware']!=='off',
          lookMasks:opt['look-masks']==='off'?false:undefined,
          colorStack:require('./color-stack.js').override(opt['color-stack']),t:run.view().time,
          ...diagnostics?.settings,...shotRender});
        fs.mkdirSync(path.dirname(output),{recursive:true});
        require('./png.js').write(output,image.w,image.h,image.rgb);
        diagnostics?.capture(image,1);
        diagnostics?.write(output,{times:[run.view().time]});
        shot?.finish(output,{suffixes});
        break;
      }
      default: throw Error('Use sim run|resume|fork|reset|replay|verify|scrub|take|diff|sweep|render|plan|dependencies|regions|regions-apply');
    }
  }
  function applyEdits(input, edits, { dryRun = false } = {}) {
    const isWorld = Boolean(input.world), retained = input.document?.format === 'ink-studio/authoring';
    const spec = isWorld || retained ? input.world ?? input.document : document(input.document).world;
    const validate = isWorld ? R.validate : retained ? kit.KIT.authoring.data.documentView :
      value => dataScene(input.legacy,value,{installedPacks:true});
    const before = validate(spec);
    const source = isWorld ? before : kit.KIT.procedural.data.freeze(W.data.copy(spec));
    let after;
    const result = W.apply(source,edits,{validate:value=>{after=validate(value);}});
    const looks = require('./look-edits.js');
    if (retained || !looks.touches(source,result.world,result.paths,W.data)) return result;
    function inspect(value) {
      const query = isWorld ? R.create(value,{validated:true}).query() : W.query.fromScene(value.build(value.seed));
      return query.inspectLook({renderer:opt.renderer,definitions:dryRun});
    }
    const report = require('./look.js').assertValid(inspect(after));
    return dryRun ? {...result,lookBindings:looks.impact(inspect(before),report,W.data.equal)} : result;
  }
  function syncPrefab(releaseFile, files) {
    ensure(files.length && (opt['dry-run'] || typeof opt.out === 'string'),
      'Use scene sync-prefab RELEASE SCENE ... with --dry-run or --out NEW_DIRECTORY');
    const source = files.map(file => load(file));
    ensure(source.every(input => input.world), 'Prefab synchronization needs world or checkpoint files');
    const result = W.syncPrefab(source, read(releaseFile));
    if (opt['dry-run'] || !result.report.ok) {
      process.stdout.write(JSON.stringify(result.report, null, opt.json ? 0 : 2) + '\n');
      if (!result.report.ok) process.exitCode = 2;
      return;
    }
    const names = files.map(file => path.basename(file).replace(/\.(js|cjs|json)$/i, '') + '.json');
    ensure(new Set(names).size === names.length, 'Scene basenames must be distinct for batch output');
    const destination = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const staged = fs.mkdtempSync(path.join(path.dirname(destination), '.ink-prefabs-'));
    let reserved = false;
    try {
      result.scenes.forEach(({world, checkpoint}, i) => write(path.join(staged, names[i]), checkpoint ?? world));
      fs.mkdirSync(destination);
      reserved = true;
      fs.renameSync(staged, destination);
      reserved = false;
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
      if (reserved) {
        try { fs.rmdirSync(destination); } catch (error) {
          if (error.code !== 'ENOTEMPTY') throw error;
        }
      }
    }
    process.stdout.write(JSON.stringify(result.report, null, opt.json ? 0 : 2) + '\n');
  }
  function scene([mode,file,reference,...additional]) {
    if (mode === 'sync-prefab') return syncPrefab(file, reference === undefined ? [] : [reference, ...additional]);
    const input=load(file);
    if(mode==='upgrade'){
      ensure(input.world&&typeof opt.to==='string','Prefab upgrades need a world or checkpoint and --to PREFAB');
      ensure(opt.migration===undefined||typeof opt.migration==='string','Use --migration FILE for the mappings');
      const dryRun=Boolean(opt['dry-run']);
      if(dryRun&&typeof opt.out==='string')
        ensure(![file,opt.migration].some(source=>typeof source==='string'&&path.resolve(source)===path.resolve(opt.out)),
          'The dry-run report needs a separate output path');
      const result=W.upgradePrefab(input.world,reference,opt.to,{
        checkpoint:input.checkpoint,migration:opt.migration===undefined?{}:read(opt.migration)
      });
      if(dryRun)respond(result.report);
      else if(result.report.ok)respond(result.checkpoint??result.world);
      else process.stdout.write(JSON.stringify(result.report,null,opt.json?0:2)+'\n');
      if(!result.report.ok)process.exitCode=2;
      return;
    }
    if (mode==='apply'){
      ensure(input.document || input.world && !input.checkpoint,'Expected a world manifest or JSON scene');
      const dryRun = Boolean(opt['dry-run']);
      if (dryRun && typeof opt.out === 'string')
        ensure(![file,reference].some(input=>typeof input==='string'&&path.resolve(input)===path.resolve(opt.out)),
          'The dry-run report needs a separate output path');
      const { world, paths, lookBindings } = applyEdits(input,read(reference),{dryRun});
      respond(dryRun?{changed:paths,...(lookBindings&&{lookBindings})}:world);
      return;
    }
    if(mode==='promote'){
      ensure(input.checkpoint&&typeof reference==='string','Promote needs a run or checkpoint and a trace name');
      const options=args(), trace=runtime(input).query().trace(reference,target(opt),options);
      ensure(trace.status==='ok',trace.reason??'Trace failed');
      const result=W.history.trail(input.world,opt.as,trace.value,options);
      R.validate(result.world);
      respond(opt['dry-run']?{changed:result.paths}:result.world);
      return;
    }
    ensure(input.world && !input.checkpoint,'Expected a world manifest');
    const world=R.validate(input.world);
    let result;
    if (mode==='capture') result=W.capture(world,reference,opt.as);
    else if (mode==='stamp') result=W.stamp(world,reference,opt.as,opt.args?args():{});
    else if (mode==='remix') result=W.remix(world,reference,opt.as,opt.edits?read(opt.edits):[]);
    else if (mode==='history') result=W.history.generate(world,read(reference));
    else throw Error('Use scene apply|stamp|remix|capture|upgrade|sync-prefab|history|promote');
    R.validate(result.world);
    respond(opt['dry-run']?{changed:result.paths,...(result.events?{events:result.events}:{})}:result.world);
  }
  function inspectData(file, name) {
    const input = load(file);
    const api = kit.KIT.dataInputs;
    const data = input.world ? api.prepare(input.world.dataInputs) : input.document
      ? api.prepare(require('./data-inputs.js').embed(api, input.document.dataInputs, file))
      : build(input.legacy).dataInputs;
    ensure(data?.describe().length, 'This file has no typed data inputs');
    ensure(name || opt.sample === undefined && !opt.rows, 'Select a dataset before requesting rows or a sample');
    if (name === undefined) return respond({ datasets: data.describe() });
    const dataset = data.get(name), time = Number(opt.t ?? 0);
    ensure(opt.t !== true && Number.isFinite(time), 'Data sample time must be finite seconds');
    return respond({ ...dataset.description,
      ...(opt.rows && { rows: dataset.rows, ...(dataset.features && { features: dataset.features }) }),
      ...(opt.sample !== undefined && { sample: dataset.sample(parse(opt.sample), time) }) });
  }
  function execute(command,pos) {
    const [file,name] = pos;
    switch (command) {
      case 'inspect': {
        const query=view(file), where=opt.where?parse(opt.where):undefined;
        if (opt.select !== undefined || opt.targets) {
          ensure(opt.near===undefined && opt.where===undefined,'Use --select by itself');
          respond({targets:query.select(opt.select===undefined?undefined:target(opt))});
          break;
        }
        respond(opt.near?query.spatial({point:numbers(opt.near),radius:Number(opt.radius),where}):query.inspect({where}));
        break;
      }
      case 'probe': {
        ensure(typeof opt.field==='string'||opt.select!==undefined||opt.at!==undefined||opt.entity!==undefined,
          'Use --field to select a query');
        const field=opt.field??(opt.at!==undefined||opt.entity!==undefined?'look/sample':'look/output');
        if(opt.spec!==undefined){
          ensure(field==='world/spatial-batch'&&typeof opt.spec==='string'&&opt.args===undefined&&
            opt.at===undefined&&opt.entity===undefined&&opt.select===undefined&&opt.socket===undefined,
          'Use --field world/spatial-batch --spec file.json with origins in the spec');
          respond(view(file).probe(field,{},read(opt.spec)));
          break;
        }
        if (field === 'look/sample') {
          ensure(opt.socket===undefined && !(opt.select!==undefined && opt.entity!==undefined),
            'Use one render selector with --select or --entity');
          ensure(opt.at===undefined||typeof opt.at==='string'&&opt.at.split(',').every(value=>value.trim()),
            '--at needs three finite comma-separated coordinates');
          const selector=opt.select!==undefined?parse(opt.select):opt.entity!==undefined?{entity:opt.entity}:undefined;
          const options={...args(),...(opt.at!==undefined&&{at:numbers(opt.at)}),
            ...(opt.radius!==undefined&&{radius:opt.radius===true?NaN:Number(opt.radius)})};
          respond(view(file).probe(field,selector,options));
          break;
        }
        const site=['look/output','look/provenance'].includes(field)&&opt.select===undefined&&opt.at===undefined&&opt.entity===undefined?undefined:target(opt);
        respond(view(file).probe(field,site,sampleArgs()));
        break;
      }
      case 'trace':
        ensure(typeof name==='string','Supply a named trace');
        respond(view(file).trace(name,target(opt),args()));
        break;
      case 'field': {
        ensure(typeof name==='string'&&typeof opt.spec==='string','Provide a field and --spec file.json');
        const spec=read(opt.spec), sample=sampleArgs();
        if (spec.ticks) {
          const run=runtime(load(file));
          schedule(run);
          ensure(Array.isArray(spec.ticks)&&spec.ticks.length<=10000,'Invalid sample ticks');
          const ticks=spec.ticks.slice().sort((a,b)=>a-b), metadata=fieldMetadata(run.query(),name);
          if (spec.spatial) {
            const samples=[], limit=100000;
            let count=0;
            for(const tick of ticks){
              run.advance(tick);
              const frame=run.query().export(name,spec.spatial,sample);
              count+=frame.samples.length;
              ensure(count<=limit,'Time-series spatial sample budget exceeded');
              samples.push(frame);
            }
            respond({field:name,...metadata,series:samples});
          } else respond({field:name,...metadata,series:ticks.map(tick=>{
            run.advance(tick);
            return {tick,time:run.view().time,...run.query().probe(name,spec.at??target(opt),sample)};
          })});
        } else respond(view(file).export(name,spec,sample));
        break;
      }
      case 'data-inputs': return inspectData(file,name);
      case 'scene': scene(pos); break;
      case 'sim': return sim(pos);
      default: throw Error('Unknown world command');
    }
  }
  function validate(file) {
    if (opt.select !== undefined) {
      const query=view(file), selector=target(opt), targets=query.select(selector);
      ensure(targets.length>0,'No render target matches '+JSON.stringify(selector));
      require('./look.js').assertValid(query.inspectLook({renderer:opt.renderer}));
      respond({valid:true,selector,targets});
      return true;
    }
    if(opt.world){
      const input=load(opt.world);
      ensure(input.world||input.document,'Provide a scene, world or checkpoint with --world');
      const edits=read(file);
      if(opt.kind==='edits') applyEdits(input,edits);
      else if(opt.kind==='actions') runtime(input).schedule(edits);
      else throw Error('Validation with --world needs --kind edits or actions');
      respond({valid:true,kind:opt.kind});
      return true;
    }
    if (!/\.json$/i.test(file??'')) return false;
    const { value:raw }=readCheckpointFile(file);
    if (raw.format==='ink-studio/authoring') {
      kit.KIT.authoring.data.documentView(raw);
      respond({valid:true,format:raw.format});
      return true;
    }
    if (raw.format!==W.format && raw.format!==R.checkpointFormat && raw.format!==R.runFormat) return false;
    const run = raw.format===R.runFormat ? R.replay(raw) :
      raw.format===R.checkpointFormat ? R.create(raw.world,{checkpoint:raw}) : undefined;
    const world = run?.view().world ?? R.validate(document(raw,file).world);
    const visual = world.visual;
    if (opt.renderer || visual?.look || visual?.terrainSurface || visual?.terrainLookAsset ||
        Object.values(world.entities).some(entity=>entity.lookAsset || entity.visual?.lookAsset || entity.visual?.surface)) {
      const query = opt.actions || opt.ticks !== undefined || opt.steps !== undefined || opt.t !== undefined ?
        view(file) : (run ?? R.create(world,{validated:true})).query();
      const report = require('./look.js').assertValid(query.inspectLook({renderer:opt.renderer}));
      if (opt.json) { respond({format:raw.format,...report}); return true; }
    }
    respond({valid:true,format:raw.format});
    return true;
  }
  return {execute,validate,inspectLook,lookSnapshot,environmentSnapshot,inspectTimeline,inspectCameraRig,visualSweep};
};
