/* Scheduled solver boundaries and deterministic signal sampling between rates. */
(function (K) {
  const W = K.world, {check,record,own} = W.data, freeze = K.procedural.data.freeze;
  const maxSubdivision = 64, maxEvents = 10000;
  function gcd(a,b) {
    while(b) [a,b] = [b,a%b];
    return a;
  }
  function schedules(world,systems,chunks) {
    const rates = {};
    let subdivision = 1, active = Boolean(chunks)||world.connections.some(edge=>edge?.sample !== undefined);
    for (const [name,system] of Object.entries(systems)) {
      const spec = world.systems[name].schedule;
      check(spec === undefined || record(spec) && Object.keys(spec).every(key=>key==='every'||key==='substeps'),
        'Invalid schedule for '+name);
      const {every=1,substeps=1} = spec ?? {};
      check(Number.isSafeInteger(every) && every>=1 && every<=3600 && Number.isSafeInteger(substeps) &&
        substeps>=1 && substeps<=maxSubdivision && (every===1 || substeps===1),
        'A schedule needs every 1–3600 ticks or 1–64 substeps for '+name);
      check(every===1 && substeps===1 || system.step || system.afterStep || system.output || chunks?.managed.has(name)&&system.requestTransfers,
        'Scheduled system has no solver or output: '+name);
      rates[name] = {every,substeps};
      for(const timing of chunks?.rates(name)??[rates[name]])
        subdivision = subdivision/gcd(subdivision,timing.substeps)*timing.substeps;
      check(subdivision<=maxSubdivision,'Combined simulation schedules exceed 64 substeps');
      active ||= every>1 || substeps>1;
    }
    return {active,rates,subdivision,chunks};
  }

  function policy(edge,type,active) {
    const sample = edge.sample === undefined ? (active && type==='event'?'events':'hold') : edge.sample;
    const numeric = type==='number' || type==='vec3';
    check(sample==='hold' && (type!=='event' || !active) || sample==='events' && type==='event' ||
      (sample==='average'||sample==='sum') && numeric,'Invalid sampling for '+edge.to);
    return sample;
  }
  const buffered = edge => edge.sample==='events' || edge.sample==='sum';
  const zero = type => type==='number'?0:type==='vec3'?[0,0,0]:[];
  function add(a,b,type) {
    if (type==='event') {
      check(a.length+b.length<=maxEvents,'Simulation event buffer exceeds 10000 entries');
      return b.length?a.concat(b):a;
    }
    const value = type==='number'?a+b:a.map((n,i)=>n+b[i]);
    check(type==='number'?Number.isFinite(value):value.every(Number.isFinite),'Simulation numeric buffer overflow');
    return value;
  }
  const scale = (value,n,type) => type==='number'?value*n:value.map(v=>v*n);

  function bind({rates,subdivision,chunks},systems,ports,incoming,order) {
    const choices=new Map(order.map(name=>[name,chunks?.rates(name)??[rates[name]]]));
    const phases = Array.from({length:subdivision},(_,index)=>{
      const slice=index+1;
      return {slice,names:order.filter(name=>choices.get(name).some(rate=>slice%(subdivision/rate.substeps)===0))};
    }).filter(row=>row.names.length||row.slice===subdivision);
    const receiving = [], averages = [], delayed = [], bySource = new Map(), eventOutputs = [];
    const wakePorts=new Map();
    for (const [port,descriptor] of Object.entries(ports.outputs))
      if (descriptor.type==='event') eventOutputs.push(port);
    for (const [port,descriptor] of Object.entries(ports.inputs)) {
      const edge = incoming.get(port), type = descriptor.type;
      const name=port.slice(0,port.indexOf('/')), managed=chunks?.managed.has(name);
      if (edge?.sample==='average') averages.push({...edge,type,name,managed});
      if (edge && buffered(edge) || !edge && type==='event') {
        const input={port,edge,type};
        receiving.push(input);
        if(managed&&type==='event'){
          if(!wakePorts.has(name))wakePorts.set(name,[]);
          wakePorts.get(name).push(input);
        }
      }
      if (!edge || !buffered(edge)) continue;
      if (edge.delay) delayed.push({...edge,type});
      if (!bySource.has(edge.from)) bySource.set(edge.from,[]);
      bySource.get(edge.from).push({...edge,type});
    }
    const initial = Object.fromEntries([
      ...receiving.map(({port,type})=>[port,zero(type)]),
      ...averages.map(({to,type})=>[to,{value:zero(type),quanta:0}])
    ]);
    function validate(saved,parse,tick,chunkState) {
      check(record(saved) && Object.keys(saved).length===Object.keys(initial).length,'Malformed multi-rate buffers');
      for (const {port,type} of receiving) {
        const value = parse(ports.inputs[port],saved[port],port);
        if (type==='event') check(value.length<=maxEvents,'Invalid saved event backlog');
      }
      for (const {to,name,managed} of averages) {
        const row = saved[to];
        const elapsed=managed?chunkState.clocks[name].pending:tick%rates[name].every;
        check(record(row) && Number.isSafeInteger(row.quanta) && row.quanta>=0 &&
          row.quanta===elapsed*subdivision,'Invalid saved average window');
        parse(ports.inputs[to],row.value,to);
      }
    }

    function* advance(at,committed,previous,manual,delays,signals,saved,visit,causal,chunkStep,parallel) {
      const buffers = {...saved}, delayedSamples = {}, eventValues = {}, observed = {};
      for (const port of Object.keys(ports.inputs))
        observed[port] = ports.inputs[port].type==='event'?[]:signals[port];
      for (const port of eventOutputs) eventValues[port] = [];
      for (const {port,edge,type} of receiving) {
        if (!edge || edge.delay) {
          const value=edge?delays[port][0]:manual[port];
          buffers[port]=add(buffers[port],value,type);
          if (causal && (type==='event'?value.length>0:type==='vec3'?value.some(Boolean):value!==0))
            causal.collect(port,causal.held(port,edge,false));
        }
      }
      for (const {to,type} of delayed) delayedSamples[to] = zero(type);

      function publish(port,value) {
        causal?.publish(port,value);
        if (own(eventValues,port)) eventValues[port] = add(eventValues[port],value,'event');
        for (const {to,delay,type} of bySource.get(port) ?? []) {
          const destination = delay?delayedSamples:buffers;
          destination[to] = add(destination[to],value,type);
        }
      }
      let states=committed, outputs=previous, last=0;
      for (const {slice,names} of phases) {
        if(chunks&&slice!==subdivision&&!names.some(name=>{
          const detail=chunkStep.due.get(name);
          return detail?slice%(subdivision/detail.substeps)===0:!chunks.managed.has(name)&&at%rates[name].every===0;
        }))continue;
        const elapsed=slice-last;
        for (const {to,from,delay,type,name,managed} of averages) {
          if(managed&&!chunkStep.active.has(name))continue;
          const row=buffers[to], held=delay?delays[to][0]:outputs[from];
          buffers[to]={value:add(row.value,scale(held,elapsed,type),type),quanta:row.quanta+elapsed};
          if (causal) causal.collect(to,causal.held(to,{from,delay},false));
        }
        const staged={}, changed={}, live={};
        const snapshotSignals=freeze({...observed,...outputs,...eventValues});
        function timingFor(name) {
          const managed=chunks?.managed.has(name), detail=managed&&chunkStep.due.get(name);
          if(managed&&!detail)return null;
          const {every,substeps}=detail||rates[name];
          if(!managed&&at%every||slice%(subdivision/substeps))return null;
          return {start:last/subdivision,end:slice/subdivision,every,substeps,substep:slice/(subdivision/substeps),
            ...(detail&&{detail})};
        }
        function inputsFor(name,consume,sources){
          const input={};
          for (const key of Object.keys(systems[name].inputs ?? {})) {
            const port=name+'/'+key, edge=incoming.get(port), type=ports.inputs[port].type;
            let value;
            if (edge?.sample==='average') {
              const row=buffers[port];
              value=type==='number'?row.value/row.quanta:row.value.map(n=>n/row.quanta);
              if(consume)buffers[port]={value:zero(type),quanta:0};
            } else if (edge && buffered(edge) || !edge && type==='event') {
              value=buffers[port];
              if(consume)buffers[port]=zero(type);
            } else value=!edge?manual[port]:edge.delay?delays[port][0]:live[edge.from]??outputs[edge.from];
            input[key]=value;
            if (sources) {
              const queued=edge?.sample==='average'||edge&&buffered(edge)||!edge&&type==='event';
              sources[key]={parents:queued?causal.consume(port):causal.held(port,edge,own(live,edge?.from)),
                source:edge?.from,delay:edge?.delay,mode:edge?.sample??(queued?'events':'hold')};
            }
            if(consume)observed[port]=type==='event'?add(observed[port],value,type):value;
          }
          return freeze(input);
        }
        const groups=parallel?parallel.groupsFor(names):[names];
        for(const group of groups){
          if(parallel)yield* parallel.prepare(group,states,name=>inputsFor(name,false),timingFor);
          for(const name of group){
            const timing=timingFor(name);
            if(!timing)continue;
            const sources=causal?{}:undefined;
            changed[name]=visit(name,states,inputsFor(name,true,sources),{...timing,signals:snapshotSignals},
              staged,sources,outputs,changed);
            if(systems[name].combinational)for(const key of Object.keys(systems[name].outputs??{})){
              const port=name+'/'+key;
              live[port]=staged[port];
              publish(port,staged[port]);
            }
          }
        }
        for (const [port,value] of Object.entries(staged)) if (!own(live,port)) publish(port,value);
        causal?.completePhase();
        if (Object.keys(changed).length) states=freeze({...states,...changed});
        if (Object.keys(staged).length) outputs=freeze({...outputs,...staged});
        last=slice;
      }
      return {states,outputs,signals:{...observed,...outputs,...eventValues},buffers:freeze(buffers),delayedSamples};
    }
    function hasEvents(name,saved,manual,delays){
      return wakePorts.get(name)?.some(({port,edge})=>saved[port].length||
        (!edge?manual[port].length:edge.delay&&delays[port][0].length))??false;
    }
    return Object.freeze({rates:freeze(rates),subdivision,initial:freeze(initial),validate,advance,hasEvents});
  }
  W.rates = Object.freeze({schedules,policy,bind,buffered,zero,add});
})(KIT);
