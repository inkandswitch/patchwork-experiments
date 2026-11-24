/* Independent fixed-tick runs retained in a single checkpoint branch session. */
(function (K) {
  const W=K.world, R=W.runtime, {check,id,record,own,equal}=W.data;
  const {freeze}=K.procedural.data;
  const format='ink-studio/simulation-branches', capacity=128;
  const tickOK=tick=>Number.isSafeInteger(tick)&&tick>=0&&tick<=R.maxTick;
  const validLabel=label=>typeof label==='string'&&label.trim()!==''&&label.length<=160;

  function create(source,{runtime={},id:initialId='main',label=initialId,maxStepsPerFrame=12}={}) {
    check(record(runtime)&&Number.isSafeInteger(maxStepsPerFrame)&&maxStepsPerFrame>=1&&maxStepsPerFrame<=120,
      'Invalid branch session runtime or frame budget');
    const branches=new Map(), marks=new Map(), listeners=new Set();
    const restore=checkpoint=>R.create(checkpoint.world,{...runtime,checkpoint});
    const matches=(a,b)=>a.id===b.id&&a.dt===b.dt&&a.seed===b.seed&&equal(a.systems,b.systems);
    let active=initialId, playing=false, remainder=0, currentStatus, sessionWorld;

    function add(branchId,branchLabel,run,parent=null,mark=null) {
      check(id(branchId)&&!branches.has(branchId)&&branches.size<capacity,'Invalid, duplicate or excess branch ID '+branchId);
      check(validLabel(branchLabel),'Invalid label for branch '+branchId);
      const {world,tick}=run.recording().origin;
      check(!sessionWorld||matches(sessionWorld,world),'Branch belongs to a different simulation');
      sessionWorld??=world;
      const row={id:branchId,label:branchLabel,parent,mark,forkTick:tick,run};
      branches.set(branchId,row);
      return row;
    }
    function branch(branchId=active) {
      const row=branches.get(branchId);
      check(row,'Unknown simulation branch '+branchId);
      return row;
    }
    function markId(markId) {
      check(id(markId)&&!marks.has(markId)&&marks.size<capacity,'Invalid, duplicate or excess checkpoint mark '+markId);
    }

    if (source?.format===format) {
      check(source.version===1&&id(source.active)&&Array.isArray(source.branches)&&source.branches.length>=1&&
        source.branches.length<=capacity&&Array.isArray(source.marks)&&source.marks.length<=capacity,'Invalid saved branch session');
      for (const row of source.branches) {
        check(record(row)&&id(row.id)&&validLabel(row.label)&&
          (branches.size ? branches.has(row.parent) : row.parent===null)&&
          (row.mark===null||id(row.mark))&&row.recording?.format===R.runFormat,'Invalid saved simulation branch');
        const run=R.replay(row.recording,runtime);
        const added=add(row.id,row.label,run,row.parent,row.mark);
        if (row.parent!==null) {
          const parent=branch(row.parent);
          check(parent.forkTick<=added.forkTick&&added.forkTick<=parent.run.view().tick,'Branch fork tick is outside its parent');
        }
      }
      for (const row of source.marks) {
        check(record(row)&&id(row.branch)&&row.checkpoint?.format===R.checkpointFormat,'Invalid saved checkpoint mark');
        markId(row.id);
        const parent=branch(row.branch), pinned=restore(row.checkpoint), checkpoint=pinned.checkpoint();
        check(matches(sessionWorld,checkpoint.world)&&parent.forkTick<=checkpoint.tick&&checkpoint.tick<=parent.run.view().tick,
          'Marked checkpoint is outside its branch');
        marks.set(row.id,{id:row.id,branch:row.branch,checkpoint,fork:pinned.fork});
      }
      for (const row of branches.values()) if (row.mark!==null) {
        const source=marks.get(row.mark);
        check(source?.branch===row.parent&&R.checkpointsEqual(row.run.recording().origin,source.checkpoint,runtime),
          'Branch origin differs from its checkpoint mark');
      }
      active=branch(source.active).id;
    } else {
      const run=source?.format===R.runFormat?R.replay(source,runtime):
        source?.format===R.checkpointFormat?restore(source):
        typeof source?.fork==='function'&&typeof source?.checkpoint==='function'?source.fork():R.create(source,runtime);
      add(initialId,label,run);
    }

    function status() {
      return currentStatus??=freeze({active,playing,tick:branch().run.view().tick,time:branch().run.view().time,
        branches:[...branches.values()].map(({id,label,parent,mark,forkTick,run})=>({
          id,label,parent,mark,forkTick,tick:run.view().tick,pending:run.commandCounts().pending
        })),
        marks:[...marks.values()].map(({id,branch,checkpoint})=>({id,branch,tick:checkpoint.tick}))
      });
    }
    function publish() {
      currentStatus=undefined;
      const next=status();
      for (const listener of [...listeners]) listener(next);
      return next;
    }
    function stop() {
      playing=false;
      remainder=0;
    }
    function play() {
      if (playing||branch().run.view().tick===R.maxTick) return status();
      playing=true;
      return publish();
    }
    function pause() {
      if (!playing) return status();
      stop();
      return publish();
    }
    function select(branchId) {
      check(id(branchId),'Expected a simulation branch ID');
      branch(branchId);
      if (!playing&&active===branchId) return status();
      stop();
      active=branchId;
      return publish();
    }
    function mark(markedId,{branch:branchId=active}={}) {
      markId(markedId);
      const pinned=branch(branchId).run.fork(), checkpoint=pinned.checkpoint();
      marks.set(markedId,{id:markedId,branch:branchId,checkpoint,fork:pinned.fork});
      publish();
      return checkpoint;
    }
    function fork(branchId,{from,mark:markedId,label=branchId}={}) {
      check(id(branchId)&&!branches.has(branchId)&&branches.size<capacity,'Invalid, duplicate or excess branch ID '+branchId);
      check(validLabel(label),'Invalid label for branch '+branchId);
      check(from===undefined||markedId===undefined,'Choose a parent branch or a checkpoint mark');
      const pinned=markedId===undefined?null:marks.get(markedId);
      check(markedId===undefined||pinned,'Unknown checkpoint mark '+markedId);
      const parent=branch(pinned?.branch??from);
      const run=pinned?pinned.fork():parent.run.fork();
      add(branchId,label,run,parent.id,markedId??null);
      stop();
      active=branchId;
      return publish();
    }
    function queue({inputs={},edits=[],actions=[]}={}, {branch:branchId=active,tick}={}) {
      check(record(inputs)&&Array.isArray(edits)&&Array.isArray(actions)&&Array.from(actions).every(record),
        'Invalid branch inputs, edits or actions');
      const {run}=branch(branchId);
      const next=tick===undefined?run.view().tick+1:tick;
      const commands=Object.entries(inputs).map(([port,value])=>({tick:next,action:'world/input',args:{port,value}}));
      if (edits.length) commands.push({tick:next,action:'world/patch',args:{edits}});
      for (const action of actions) commands.push({tick:next,...action});
      if (!commands.length) return status();
      run.schedule(commands);
      return publish();
    }
    function move(tick) {
      const {run}=branch();
      try {
        run.advance(tick);
        if (tick===R.maxTick) stop();
      } catch (error) {
        stop();
        throw error;
      } finally {
        publish();
      }
      return run.view();
    }
    function advance(tick) {
      check(tickOK(tick)&&tick>=branch().run.view().tick,'Branch advance needs a valid forward tick');
      stop();
      return move(tick);
    }
    function update(seconds) {
      check(Number.isFinite(seconds)&&seconds>=0,'Playback needs finite nonnegative elapsed time');
      if (!playing) return status();
      const {tick,world}=branch().run.view();
      const available=Math.min(maxStepsPerFrame,remainder+seconds/world.dt);
      const steps=Math.floor(available+Number.EPSILON*Math.max(1,available));
      remainder=Math.max(0,available-steps);
      if (steps) move(Math.min(R.maxTick,tick+steps));
      return status();
    }
    function save() {
      return freeze({format,version:1,active,
        branches:[...branches.values()].map(({id,label,parent,mark,run})=>({id,label,parent,mark,recording:run.recording()})),
        marks:[...marks.values()].map(({id,branch,checkpoint})=>({id,branch,checkpoint}))
      });
    }

    return Object.freeze({status,play,pause,update,advance,step:()=>advance(branch().run.view().tick+1),
      select,mark,fork,queue,save,
      view:branchId=>branch(branchId).run.view(), query:branchId=>branch(branchId).run.query(),
      checkpoint:branchId=>branch(branchId).run.checkpoint(), recording:branchId=>branch(branchId).run.recording(),
      diff:(a,b)=>R.diff(branch(a).run.checkpoint(),branch(b).run.checkpoint()),
      subscribe(listener,{immediate=true}={}){
        check(typeof listener==='function','Branch subscription needs a callback');
        if (immediate) listener(status());
        listeners.add(listener);
        return ()=>listeners.delete(listener);
      }
    });
  }

  W.branches=Object.freeze({create,format});
})(KIT);
