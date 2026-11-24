/* Composable bounded samplers, typed control blocks and terrain water. */
(function (K) {
  const W = K.world, P = K.procedural, Q = W.query;
  const {check,record,id,vector,own} = W.data;
  const spatial = W.spatialFields;
  const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
  const zone = (point,bounds) => !bounds || point.every((value,i) => value >= bounds.min[i] && value <= bounds.max[i]);
  function bounds(value, dimensions = 3) {
    check(record(value) && vector(value.min,dimensions) && vector(value.max,dimensions) &&
      value.min.every((n,i) => n <= value.max[i]), 'Invalid world bounds');
    return value;
  }
  function patchList(source,dimensions=3) {
    check(Array.isArray(source) && source.length <= 4096,'Expected a bounded list of field regions');
    for (const row of source) {
      bounds(row.bounds,dimensions);
      check(Number.isFinite(row.value),'A field region needs a finite value');
    }
    return source;
  }
  function regions(source,point,base=0) {
    let value = base;
    for (const entry of source) if (zone(point,entry.bounds)) value = entry.value;
    return value;
  }
  function typedFields(config) {
    const definitions = config.fields ?? {};
    check(record(definitions),'Invalid spatial field definitions');
    const entries = Object.entries(definitions), descriptors = {}, initial = {};
    check(entries.length <= 256,'Too many spatial field definitions');

    function checkRegion(descriptor, region) {
      check(record(region) && (region.id === undefined || id(region.id)) && spatial.matches(descriptor,region.value),
        'Invalid spatial field region value or ID');
      spatial.checkBounds(region.bounds,descriptor.spatial.axes.length);
    }
    function checkRegions(descriptor, values) {
      check(Array.isArray(values) && values.length <= 4096,'Expected a bounded list of field regions');
      for (const row of values) checkRegion(descriptor,row);
    }
    for (const [name,spec] of entries) {
      check(id(name) && record(spec),'Invalid spatial field definition '+name);
      const type = spec.type ?? 'number', hasGrid = own(spec,'grid');
      const sampling = spec.sampling ?? (hasGrid ? type==='category' ? 'nearest' : 'linear' : 'regions');
      check(hasGrid ? ['linear','nearest'].includes(sampling) && spec.bounds && !own(spec,'default') : sampling==='regions',
        'A grid needs bounds and nearest or linear sampling; use default with regions');
      const value = own(spec,'default') && !(spec.type === undefined && spec.default === null) ? spec.default :
        {number:0,vec2:[0,0],vec3:[0,0,0],category:spec.categories?.[0]}[type];
      let grid;
      const descriptor = spatial.define({...spec,type,sampling},({state,point,explain}) => {
        const rows = state?.[name];
        if (!rows) return Q.missing('field state is unavailable');
        for (let i = rows.length-1; i >= 0; i--) {
          const row = rows[i];
          if (spatial.inside(point,row.bounds))
            return {status:'ok',value:row.value,...(explain && {source:{kind:'region',index:i,id:row.id??null,bounds:row.bounds}})};
        }
        if (grid) return grid(point,explain);
        return {status:'ok',value,...(explain && {source:{kind:'default'}})};
      });
      if (hasGrid) grid = spatial.grid(descriptor,spec.grid);
      else check(spatial.matches(descriptor,value),'Invalid default for spatial field '+name);
      initial[name] = spec.regions ?? [];
      checkRegions(descriptor,initial[name]);
      descriptors[name] = descriptor;
    }
    function setCommand({field,region}) {
      check(own(descriptors,field),'Unknown spatial field '+field);
      checkRegion(descriptors[field],region);
    }
    return {initial:() => initial,fields:descriptors,dependencies:{writes:entries.map(([name])=>name)},
      navigationSource(field,state){
        const spatial=descriptors[field]?.spatial, key=state?.[field];
        if(spatial?.space!=='world'||!key)return;
        return {key,changes:old=>W.navigationTiles.appended(old,key,row=>({...row.bounds,axes:spatial.axes}))};
      },

      validateState(state) {
        check(record(state) && Object.keys(state).length === entries.length &&
          entries.every(([name]) => own(state,name)), 'Invalid saved spatial fields');
        for (const [name] of entries) checkRegions(descriptors[name],state[name]);
      },
      checkAction(type,args) {if (type==='set') setCommand(args);},
      actions:{
        set(state,{field,region},ctx) {
          check(state[field].length < 4096,'Spatial field region budget exceeded');
          ctx.emit('field-edit',{field,bounds:region.bounds});
          const {space,axes} = descriptors[field].spatial;
          ctx.spatial?.write(field,space==='world'?{...region.bounds,axes}:null,'field-region-edited');
          return {...state,[field]:[...state[field],region]};
        }
      }};
  }
  function control(config) {
    const kind = config.op ?? 'pass';
    const specs = {
      pass:{inputs:{value:'number'},outputs:{value:'number'}},
      threshold:{inputs:{value:'number'},outputs:{value:'bool'}},
      sum:{inputs:{a:'number',b:'number'},outputs:{value:'number'}},
      scale:{inputs:{value:'number'},outputs:{value:'number'}},
      choose:{inputs:{enabled:'bool',a:'number',b:'number'},outputs:{value:'number'}},
      and:{inputs:{a:'bool',b:'bool'},outputs:{value:'bool'}},
      not:{inputs:{value:'bool'},outputs:{value:'bool'}},
      pulse:{inputs:{value:'bool'},outputs:{value:'event'}},
      latch:{inputs:{set:'event',reset:'event'},outputs:{value:'bool'}},
      timer:{inputs:{enabled:'bool'},outputs:{value:'number',done:'bool'}},
      hysteresis:{inputs:{value:'number'},outputs:{value:'bool'}}
    };
    check(own(specs,kind),'Unknown control operation ' + kind);
    check([config.scale??1,config.offset??0,config.threshold??0,config.low??0,config.high??1].every(Number.isFinite) &&
      (config.low??0) <= (config.high??1) && Number.isSafeInteger(config.ticks??1) && (config.ticks??1)>0,
      'Invalid control parameters');
    const {inputs,outputs} = specs[kind];
    const stateless = !['pulse','latch','timer','hysteresis'].includes(kind);
    function step(state,{input,tick,causal}) {
      let value, done;
      switch (kind) {
        case 'pass': value = input.value; break;
        case 'threshold': {
          const threshold=config.threshold??0;
          value=input.value>=threshold;
          if (value!==state.value) causal?.record(value?'threshold-crossed':'threshold-cleared',
            {reading:input.value,threshold,comparison:'>=',result:value},{inputs:['value'],outputs:['value']});
          break;
        }
        case 'sum': value = input.a+input.b; break;
        case 'scale': value = input.value*(config.scale??1)+(config.offset??0); break;
        case 'choose': {
          const branch=input.enabled?'b':'a';
          value=input[branch];
          if (value!==state.value) causal?.record('branch-selected',
            {enabled:input.enabled,branch,result:value},{inputs:['enabled',branch],outputs:['value']});
          break;
        }
        case 'and': value = input.a && input.b; break;
        case 'not': value = !input.value; break;
        case 'pulse': {
          const rising=input.value&&!state.last;
          if (rising) causal?.record('rising-edge',{previous:!!state.last,reading:input.value},
            {inputs:['value'],outputs:['value']});
          return {value:rising?[{tick}]:[],last:input.value};
        }
        case 'latch': {
          const trigger=input.reset.length?'reset':input.set.length?'set':null;
          value=trigger?trigger==='set':state.value;
          if (value!==state.value) causal?.record('latch-changed',{trigger,result:value},
            {inputs:[trigger],outputs:['value']});
          break;
        }
        case 'timer': {
          const threshold=config.ticks??1;
          value=input.enabled?Math.min(threshold,state.value+1):0;
          done=value>=threshold;
          if (causal && (value!==state.value||done!==state.done)) {
            const previous=causal.previous('value');
            causal.record('timer-updated',{count:value,threshold,enabled:input.enabled,done},
              {inputs:['enabled'],causes:input.enabled&&previous?[previous]:[],
                outputs:['value',...(done!==state.done?['done']:[])]});
          }
          return {value,done};
        }
        case 'hysteresis': {
          const threshold=state.value?config.low??0:config.high??1, comparison=state.value?'>':'>=';
          value=state.value?input.value>threshold:input.value>=threshold;
          if (value!==state.value) causal?.record('hysteresis-changed',
            {reading:input.value,threshold,comparison,result:value},{inputs:['value'],outputs:['value']});
          break;
        }
      }
      return {value};
    }
    const initial = {value:outputs.value==='bool'?false:outputs.value==='event'?[]:0,...(kind==='timer'?{done:false}:{})};
    return {combinational:stateless,initial:() => initial,inputs,outputs,step,output:state =>
      Object.fromEntries(Object.keys(outputs).map(key => [key,state[key]]))};
  }
  function water(config,{id:system,catalog} = {}) {
    const {width,height,cell=1,origin=[0,0]} = config;
    const [dx,dz] = Array.isArray(cell) ? cell : [cell,cell];
    check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width>0 && height>0 && width*height<=65536 &&
      [dx,dz].every(n => Number.isFinite(n)&&n>0) && vector(origin,2),'Water needs a bounded XZ grid');
    const cellArea=dx*dz, maxDepth=2000;
    const index = (x,z) => {
      const ix=Math.floor((x-origin[0])/dx), iz=Math.floor((z-origin[1])/dz);
      return ix>=0 && ix<width && iz>=0 && iz<height ? iz*width+ix : -1;
    };
    const point = i => [origin[0]+(i%width+.5)*dx,origin[1]+(Math.floor(i/width)+.5)*dz];
    const {boundaries:boundaryRules,boundaryFields}=config;
    const boundaryModel=boundaryRules!==undefined||boundaryFields!==undefined?
      W.waterBoundaries.create(boundaryRules===undefined?{}:boundaryRules,boundaryFields===undefined?{}:boundaryFields,
        {width,height,origin,dx,dz,point}):null;
    const boundaryReads=Object.values(boundaryFields??{});
    const sedimentModel=config.sediment===undefined?null:W.sediment.create(config.sediment,{width,height,cellArea,point});
    const thermalModel=config.thermal===undefined?null:W.thermalWater.create(config.thermal,{width,height,dx,dz,point,maxDepth,catalog});
    const bed = patchList(config.bed ?? [],2), seed = patchList(config.initial ?? [],2);
    check([config.base??0,config.rain??0,config.drain??0,config.friction??.13].every(Number.isFinite) &&
      [config.rain??0,config.drain??0,config.friction??.13].every(n=>n>=0) &&
      seed.every(item=>item.value>=0),'Invalid water rates or initial depths');
    const gates=config.gates??{}, pumps=config.pumps??{}, sensors=config.sensors??{};
    check([gates,pumps,sensors].every(group => record(group) && Object.keys(group).length<=128 &&
      Object.keys(group).every(id)), 'Invalid water controls');
    const inputs={}, outputs={volume:'number'}, byFace=new Map(), gateInit={}, pumpInit={}, trackedFaces=new Map();
    if(thermalModel)inputs.ambient={type:'number',default:thermalModel.ambientTemperature};
    for (const [key,spec] of Object.entries(gates)) {
      check(record(spec) && [0,1,undefined].includes(spec.axis), 'Invalid gate axis');
      bounds(spec.bounds,2);
      const value=spec.opening??0;
      check(Number.isFinite(value) && value>=0 && value<=1, 'Invalid gate opening');
      inputs['gate.'+key] = {type:'number',default:value};
      gateInit[key]=value;
      outputs['gate.'+key]='number';
      if(spec.siltClearance!==undefined){
        check(sedimentModel&&Number.isFinite(spec.siltClearance)&&spec.siltClearance>0&&spec.siltClearance<=1e7,
          'Gate silt clearance needs live sediment and a positive height');
      }
      if(spec.iceClearance!==undefined)check(thermalModel&&Number.isFinite(spec.iceClearance)&&
        spec.iceClearance>0&&spec.iceClearance<=maxDepth,'Ice clearance needs thermal water and a positive thickness');
      if(spec.siltClearance!==undefined||spec.iceClearance!==undefined){
        trackedFaces.set(key,[]);outputs['effective-opening.'+key]='number';
      }
    }
    for (const [key,spec] of Object.entries(pumps)) {
      check(record(spec) && vector(spec.from,2) && vector(spec.to,2) && Number.isFinite(spec.rate??0) && (spec.rate??0)>=0,
        'Invalid pump ' + key);
      check(index(...spec.from)>=0 && index(...spec.to)>=0 && index(...spec.from)!==index(...spec.to),'Pump endpoints need distinct cells');
      inputs['pump.'+key] = {type:'number',default:spec.rate??0};
      pumpInit[key]=spec.rate??0;
      outputs['pump.'+key]='number';
    }
    for (const [key,point] of Object.entries(sensors)) {
      check(vector(point,2) && index(...point)>=0,'Sensor is outside water grid: ' + key);
      outputs['depth.'+key]='number';
      outputs['flow.'+key]='number';
    }
    function matchFaces(x,z,axis,left) {
      const cache=left*2+axis;
      if (!byFace.has(cache)) byFace.set(cache,Object.keys(gates).filter(key =>
        (gates[key].axis===undefined||gates[key].axis===axis) && zone([x,z],gates[key].bounds)));
      return byFace.get(cache);
    }
    if(trackedFaces.size)for(let i=0;i<width*height;i++){
      for(const [axis,next,valid] of [[0,i+1,i%width<width-1],[1,i+width,i+width<width*height]]){
        if(!valid)continue;
        const other=point(next), [fx,fz]=point(i).map((n,k)=>(n+other[k])*.5);
        for(const key of matchFaces(fx,fz,axis,i))trackedFaces.get(key)?.push([i,next]);
      }
    }
    const siltRise=(sediment,a,b,y,z)=>Math.max(0,y-sediment.datum[a],z-sediment.datum[b]);
    const iceRise=(thermal,a,b)=>Math.max(thermal.ice[a],thermal.ice[b]);
    const factor=(amount,clearance)=>clearance===undefined?1:Math.max(0,1-amount/clearance);
    const siltKeys=[...trackedFaces.keys()].filter(key=>gates[key].siltClearance!==undefined);
    const iceKeys=[...trackedFaces.keys()].filter(key=>gates[key].iceClearance!==undefined);
    function gateMetrics({sediment,thermal,fluid,gate}){
      return Object.fromEntries([...trackedFaces].map(([key,faces])=>{
        const {siltClearance,iceClearance}=gates[key];
        let silt=0,ice=0,opening=1;
        for(const [a,b] of faces){
          const rise=siltClearance===undefined?0:siltRise(sediment,a,b,fluid.bed[a],fluid.bed[b]);
          const frozen=iceClearance===undefined?0:iceRise(thermal,a,b);
          silt=Math.max(silt,rise);ice=Math.max(ice,frozen);
          opening=Math.min(opening,factor(rise,siltClearance)*factor(frozen,iceClearance));
        }
        return [key,{command:gate[key],effective:gate[key]*opening,faces:faces.length,
          ...(siltClearance!==undefined&&{silt,clearance:siltClearance,clogged:silt>=siltClearance}),
          ...(iceClearance!==undefined&&{ice,iceClearance,jammed:ice>=iceClearance})}];
      }));
    }
    function makeSolver(withTerrain = false) {
      return P.motion.shallowWater({width,height,cell,origin,maxDepth,
        ...(withTerrain?{terrain:(x,z)=>regions(bed,[x,z],config.base??0),initial:(x,z)=>regions(seed,[x,z])}:{})});
    }
    P.motion.gridSpacing({width,height,cell,origin});
    let scratchSolver;
    const getSolver=()=>scratchSolver??=makeSolver();
    function terrainCells(area) {
      const result = [];
      const [a,b] = area.min.map((n,i)=>Math.max(0,Math.floor((n-origin[i])/(i?dz:dx)-.5)));
      const [c,d] = area.max.map((n,i)=>Math.min((i?height:width)-1,Math.ceil((n-origin[i])/(i?dz:dx)-.5)));
      for (let z=b;z<=d;z++) for (let x=a;x<=c;x++) {
        const cell=z*width+x;
        if (zone(point(cell),area)) result.push(cell);
      }
      return result;
    }
    function sample(state,x,z,i=index(x,z)) {
      if (i<0) return null;
      const depth=state.fluid.depth[i], b=state.fluid.bed[i]+(state.thermal?.ice[i]??0);
      const suspended=state.sediment?.suspended[i];
      return {bed:b,depth,surface:b+depth,velocity:depth>1e-6?
        [state.fluid.mx[i]/depth,state.fluid.mz[i]/depth]:[0,0],
        ...(suspended!==undefined&&{suspended,concentration:depth>1e-6?suspended/depth:0})};
    }
    function column({state,target,system}) {
      if (!target.point) return Q.missing('point required');
      const [x,,z]=target.point, hit=sample(state,x,z);
      if (!hit) return Q.missing('outside water grid','outside');
      return hit.depth>1e-6 ? Q.ok({id:system,...hit}) : {status:'dry',value:{id:system,...hit}};
    }
    const domain = {axes:'xz',sampling:'cell',boundary:'half-open',
      bounds:{min:origin,max:[origin[0]+width*dx,origin[1]+height*dz]}};
    function changedCells(changed){
      const regions=[];
      for(let z=0;z<height;z++){
        let start=-1;
        for(let x=0;x<=width;x++){
          if(x<width&&changed(z*width+x)){
            if(start<0)start=x;
          }else if(start>=0){
            regions.push({axes:'xz',min:[origin[0]+start*dx,origin[1]+z*dz],
              max:[origin[0]+x*dx,origin[1]+(z+1)*dz]});
            start=-1;
          }
        }
      }
      return regions;
    }
    function navigationSource(field,state){
      if(!state)return;
      const {fluid}=state;
      if(field==='bed')return {key:fluid.bed,changes:old=>changedCells(i=>old[i]!==fluid.bed[i])};
      if(field==='water'){
        const key={depth:fluid.depth,bed:fluid.bed,ice:state.thermal?.ice};
        const surface=(frame,i)=>(frame.bed[i]+(frame.ice?.[i]??0))+frame.depth[i];
        return {key,changes:old=>changedCells(i=>{
          const wet=key.depth[i]>1e-6, wasWet=old.depth[i]>1e-6;
          return wet!==wasWet||wet&&surface(key,i)!==surface(old,i);
        })};
      }
    }
    function channel(type, units, key) {
      return spatial.define({type,units,...domain},({state,point,explain})=>{
        if (!state) return Q.missing('water state is unavailable');
        const cell = index(...point);
        if (cell < 0) return Q.missing('outside water grid','outside');
        const value=typeof key==='function'?key(state,cell):sample(state,point[0],point[1],cell)[key];
        return {status:'ok',value,...(explain && {source:{kind:'cell',cell:[cell%width,Math.floor(cell/width)]}})};
      });
    }
    const access = config.accounts ?? {}, accounts = {}, usedCells = new Set();
    check(record(access) && Object.keys(access).length <= 512,'Invalid water transfer accounts');
    for (const [name,point] of Object.entries(access)) {
      check(id(name) && vector(point,2) && index(...point) >= 0,'Water account needs an XZ point within its grid');
      const cell = index(...point);
      check(!usedCells.has(cell),'Water transfer accounts must use distinct cells');
      usedCells.add(cell);
      accounts[name] = {resource:'water',units:'world^3',type:'number',at:[point[0],0,point[1]],
        read(state) {return {balance:state.fluid.depth[cell]*cellArea,max:maxDepth*cellArea};},
        write(state,balance) {
          const old = state.fluid.depth[cell], level = Math.min(maxDepth,balance/cellArea);
          const amount = level*cellArea-old*cellArea;
          const depth = state.fluid.depth.slice();
          depth[cell] = level;
          let {mx,mz} = state.fluid;
          if (level < old) {
            mx = mx.slice(); mz = mz.slice();
            mx[cell] *= level/old; mz[cell] *= level/old;
          }
          const {sent,received} = state.exchange;
          return P.data.freeze({...state,fluid:{...state.fluid,depth,mx,mz},
            ...(thermalModel&&{thermal:thermalModel.exchange(state.thermal,state.fluid,cell,level-old)}),
            exchange:{sent:sent+Math.max(0,-amount),received:received+Math.max(0,amount)}});
        }};
    }
    const exchanging = usedCells.size > 0;
    function metric({state}) {
      const {depth,startVolume,added,drained,moved}=state.fluid;
      const volume=depth.reduce((a,b)=>a+b,0)*cellArea;
      const {thermal,exchange}=state;
      const ice=thermal?thermal.ice.reduce((a,b)=>a+b,0)*cellArea:0;
      const vapor=thermal?thermal.vapor.reduce((a,b)=>a+b,0)*cellArea:0;
      const initial=startVolume+(thermal?.initialVapor??0), total=volume+ice+vapor;
      const error = total-initial-added+drained;
      return Q.ok({volume,initial,added,drained,transferred:moved,
        ...(thermal&&{ice,vapor,total}),...(exchange && {received:exchange.received,sent:exchange.sent}),
        error:exchange ? error-exchange.received+exchange.sent : error});
    }
    const terrainQuery=config.obstacle, surface=config.surface;
    check(terrainQuery===undefined || typeof terrainQuery==='string','Invalid obstacle field');
    check(surface===undefined || typeof surface==='string','Invalid water material surface field');
    const legacyErosion=surface!==undefined&&!sedimentModel;
    const dependencyBounds = {axes:'xz',min:origin,max:[origin[0]+width*dx,origin[1]+height*dz]};
    const phaseFields=['temperature','ice','vapor','humidity','phase','phase-state','water','depth','flow','surface-height'];
    const liquidFields=['water','depth','flow','surface-height'];
    return {inputs,outputs,navigationSource,...(exchanging && {accounts}),shareCheckpoint:true,
      partitionStep:terrainQuery===undefined&&surface===undefined&&thermalModel?.ambientField===undefined&&!boundaryReads.length,
      simulationAggregate(settings){
        check(!sedimentModel&&!thermalModel&&!legacyErosion&&!exchanging&&!terrainQuery&&!boundaryModel&&
          !Object.keys(gates).length&&!Object.keys(pumps).length,
        'Water blocks require a closed grid without editable boundaries, gates, pumps, exchanges, sediments, thermal or obstacle coupling');
        return W.aggregateWater(settings,{width,height,dx,dz,origin,index,maxDepth,system,sensors,
          rain:config.rain,drain:config.drain,friction:config.friction});
      },
      checkSimulationLOD(tuning,{every,dt}){
        const {cfl=.42,maxDt=.055}=tuning;
        check(Object.keys(tuning).every(key=>key==='cfl'||key==='maxDt')&&Number.isFinite(cfl)&&cfl>=.05&&cfl<=.49&&
          Number.isFinite(maxDt)&&maxDt>=1e-6&&maxDt<=2&&every*dt<=120,'Invalid water simulation detail tuning or cadence');
      },
      dependencies:{reads:[{field:system+'/bed',bounds:dependencyBounds},
        ...[terrainQuery,surface,thermalModel?.ambientField,...boundaryReads].filter(Boolean).map(field=>({field,bounds:dependencyBounds}))],
        writes:[system+'/bed',...(thermalModel?phaseFields:boundaryModel?liquidFields:[]).map(key=>system+'/'+key)]},
      ...((surface!==undefined||thermalModel||boundaryModel)&&{checkFields(query){
        W.materials.checkSurface(query,surface);thermalModel?.checkFields(query);boundaryModel?.checkFields(query);
      }}),
      initial() {
        const fluid=makeSolver(true).checkpoint({shareBed:true});
        const thermal=thermalModel?.boot(fluid);
        const state={fluid,gate:gateInit,pump:pumpInit,terrain:[],manual:{},...(legacyErosion&&{eroded:0}),
          ...(boundaryModel&&{boundaries:boundaryModel.initial()}),
          ...(sedimentModel&&{sediment:sedimentModel.boot(fluid.bed),silted:Object.fromEntries(siltKeys.map(key=>[key,false]))}),
          ...(thermal&&{thermal}),...(exchanging&&{exchange:{sent:0,received:0}})};
        if(thermal){
          const metrics=gateMetrics(state);
          state.frozen=Object.fromEntries(iceKeys.map(key=>[key,metrics[key].jammed]));
        }
        return P.data.freeze(state);
      },
      validateState(state) {
        getSolver().restore(state.fluid);
        boundaryModel?.validate(state.boundaries);
        for(const [table,schema,limit] of [[state.gate,gates,1],[state.pump,pumps,Infinity]])
          check(record(table)&&Object.keys(table).length===Object.keys(schema).length&&
            Object.keys(schema).every(key=>Number.isFinite(table[key])&&table[key]>=0&&table[key]<=limit),
          'Saved water controls do not match the configured gates and pumps');
        check(record(state.manual)&&Object.entries(state.manual).every(([key,value])=>own(inputs,key)&&
          Number.isFinite(value)&&value>=0&&value<=(key.startsWith('gate.')?1:1e9)),
        'Invalid saved manual water control');
        if (legacyErosion) check(Number.isFinite(state.eroded)&&state.eroded>=0,'Invalid eroded bed volume');
        if(sedimentModel){
          sedimentModel.validate(state.sediment,state.fluid.bed);
          check(record(state.silted)&&Object.keys(state.silted).length===siltKeys.length&&
            siltKeys.every(key=>typeof state.silted[key]==='boolean'),'Invalid saved gate silt state');
        }
        if(thermalModel){
          thermalModel.validate(state.thermal);
          check(record(state.frozen)&&Object.keys(state.frozen).length===iceKeys.length&&
            iceKeys.every(key=>typeof state.frozen[key]==='boolean'),'Invalid saved gate ice state');
          const {initial,added,received,error}=metric({state}).value;
          check(Math.abs(error)<=1e-7*Math.max(1,initial+added+(received??0)),'Saved water phase balance is inconsistent');
        }
        if (exchanging) check(record(state.exchange) &&
          [state.exchange.sent,state.exchange.received].every(value=>Number.isFinite(value) && value>=0),
        'Invalid water transfer balance');
      },
      checkAction(type,args){
        if(type==='bed'){
          patchList([{bounds:args.bounds,value:args.height}],2);
          check(Math.abs(args.height)<=1e7,'Shallow water terrain height exceeds its range');
        }
        if(type==='gate')check(own(gates,args.gate)&&Number.isFinite(args.opening)&&args.opening>=0&&args.opening<=1,'Invalid gate command');
        if(type==='pump')check(own(pumps,args.pump)&&Number.isFinite(args.rate)&&args.rate>=0&&args.rate<=1e9,'Invalid pump command');
        if(type==='boundary')boundaryModel.checkAction(args);
        if(type==='release')check(own(inputs,args.port),'Unknown water control');
        if(type==='heat')check(thermalModel&&bounds(args.bounds,2)&&Number.isFinite(args.energy)&&Math.abs(args.energy)<=1e15,
          'Heat edit needs thermal water, XZ bounds and signed energy');
        if(type==='sediment-feed'){
          bounds(args.bounds,2);
          check(Number.isFinite(args.depth)&&args.depth>0&&args.depth<=1e7,'Sediment feed needs a positive solid-equivalent depth');
        }
      },
      fields:{
        water:{type:'record',units:'world',columnGrid:{bounds:domain.bounds,resolution:[width,height]},read:column},
        depth:channel('number','world','depth'),
        'surface-height':channel('number','world','surface'),
        flow:channel('vec2','world/s','velocity'),
        bed:channel('number','world',(state,i)=>state.fluid.bed[i]),
        ...((legacyErosion||sedimentModel)&&{eroded:{type:'number',units:'world^3',read:({state})=>Q.ok(state.sediment?.totals.eroded??state.eroded)}}),
        ...(sedimentModel&&{
          sediment:{type:'record',units:'world^3',read:({state})=>Q.ok(sedimentModel.report(state.sediment,state.fluid.bed))},
          suspended:channel('number','world','suspended'),
          concentration:channel('number','1','concentration'),
          'bed-change':channel('number','world',(state,i)=>state.fluid.bed[i]-state.sediment.datum[i]),
          'erodible-depth':channel('number','world',(state,i)=>state.fluid.bed[i]-state.sediment.bedrock[i])
        }),
        ...(thermalModel&&{
          temperature:channel('number','degC',(state,i)=>thermalModel.sample(state.thermal,state.fluid,i).temperature),
          ice:channel('number','world',(state,i)=>state.thermal.ice[i]),
          vapor:channel('number','world',(state,i)=>state.thermal.vapor[i]),
          humidity:channel('number','1',(state,i)=>thermalModel.sample(state.thermal,state.fluid,i).humidity),
          phase:spatial.define({type:'category',units:'1',categories:['dry','vapor','liquid','ice','mixed'],...domain},
            ({state,point})=>{
              const i=index(...point);
              return state&&i>=0?Q.ok(thermalModel.sample(state.thermal,state.fluid,i).phase):Q.missing('outside thermal grid','outside');
            }),
          'phase-state':{type:'record',read({state,target}){
            if(!target.point||!state)return Q.missing('state and point required');
            const [x,,z]=target.point, i=index(x,z);
            return i>=0?Q.ok(thermalModel.sample(state.thermal,state.fluid,i)):Q.missing('outside thermal grid','outside');
          }},
          heat:{type:'record',units:'J',read:({state})=>Q.ok(thermalModel.energyReport(state.thermal))}
        }),
        ...(trackedFaces.size&&{gates:{type:'record',read:({state,args})=>{
          const rows=gateMetrics(state);
          return args.gate===undefined?Q.ok(rows):own(rows,args.gate)?Q.ok(rows[args.gate]):Q.missing('Unknown silt-sensitive gate','missing');
        }}}),
        ...(boundaryModel&&{boundaries:{type:'record',read:({state,args})=>{
          const rows=boundaryModel.report(state.boundaries);
          return args.id===undefined?Q.ok(rows):own(rows,args.id)?Q.ok(rows[args.id]):Q.missing('Unknown water boundary');
        }}}),
        mass:{type:'record',units:'world^3',read:metric}
      },
      traces:{flow:{run:({state,target,args})=>{
        if (!target.point) return Q.missing('point required');
        const steps=args.steps??80, stride=args.stride??Math.min(dx,dz)*.45;
        check(Number.isSafeInteger(steps)&&steps>0&&steps<=10000&&Number.isFinite(stride)&&stride>0,'Invalid flow trace budget');
        const points=[], visited=new Set();
        let [x,,z]=target.point;
        for (let i=0;i<steps;i++) {
          const current=sample(state,x,z), magnitude=current?Math.hypot(...current.velocity):0;
          if (!current || current.depth<=1e-6 || magnitude<1e-8)
            return Q.ok({points,status:!current?'outside':current.depth<=1e-6?'dry':'still'});
          points.push([x,current.surface,z]);
          const next=[x+stride*current.velocity[0]/magnitude,z+stride*current.velocity[1]/magnitude];
          const cell=index(...next);
          if (cell!==index(x,z) && visited.has(cell)) return Q.ok({points,status:'loop'});
          visited.add(index(x,z));
          [x,z]=next;
        }
        return Q.ok({points,status:'budget'});
      }}},
      actions:{
        ...(boundaryModel&&{boundary(state,args,ctx){
          return P.data.freeze({...state,boundaries:boundaryModel.set(state.boundaries,args,ctx)});
        }}),
        bed(state,{bounds:area,height:value},ctx) {
          check(state.terrain.length<4096,'Water terrain edit budget exceeded');
          ctx.emit('bed-edit',{bounds:area,height:value});
          const cells = terrainCells(area), previous = state.fluid.bed;
          const changed = cells.filter(index=>previous[index]!==value);
          const scope = {...area,axes:'xz'};
          let fluid = state.fluid, sediment=state.sediment;
          if (changed.length) {
            const bed = previous.slice();
            for (const index of changed) bed[index] = value;
            if(sedimentModel)sediment=sedimentModel.edit(sediment,previous,bed,changed);
            fluid = {...fluid,bed};
            ctx.spatial?.write('bed',scope,'bed-edited');
          }
          ctx.spatial?.rebuilt('water-bed',{sampled:cells.length,changed:changed.length,total:width*height},scope);
          return P.data.freeze({...state,fluid,...(sediment&&{sediment}),terrain:[...state.terrain,{bounds:area,value,applied:true}]});
        },
        gate(state,{gate,opening},ctx) {
          ctx.emit('gate-set',{gate,opening});
          return P.data.freeze({...state,manual:{...state.manual,['gate.'+gate]:opening}});
        },
        pump(state,{pump,rate},ctx) {
          ctx.emit('pump-set',{pump,rate});
          return P.data.freeze({...state,manual:{...state.manual,['pump.'+pump]:rate}});
        },
        ...(sedimentModel&&{'sediment-feed'(state,{bounds:area,depth},ctx){
          const cells=terrainCells(area), sediment=sedimentModel.feed(state.sediment,cells,depth);
          ctx.emit('sediment-fed',{bounds:area,cells:cells.length,volume:sediment.totals.fed-state.sediment.totals.fed});
          return P.data.freeze({...state,sediment});
        }}),
        ...(thermalModel&&{heat(state,{bounds:area,energy},ctx){
          const cells=terrainCells(area);
          if(cells.length&&energy!==0){
            ctx.emit('heat-applied',{bounds:area,energy,cells:cells.length});
            for(const field of ['temperature','humidity','phase-state'])
              ctx.spatial?.write(field,{...area,axes:'xz'},'heat-applied');
          }
          return P.data.freeze({...state,thermal:thermalModel.heat(state.thermal,cells,energy)});
        }}),
        release(state,{port}) {
          const manual={...state.manual};
          delete manual[port];
          return P.data.freeze({...state,manual});
        }
      },
      step(state,ctx) {
        const solver=getSolver();
        solver.restore(state.fluid);
        let sediment=state.sediment;
        if (state.terrain.some(row=>!row.applied)){
          solver.setTerrain((x,z,i,old)=>regions(state.terrain,[x,z],old));
          if(sedimentModel){
            const bed=solver.checkpoint().bed, changed=bed.flatMap((y,i)=>y!==state.fluid.bed[i]?[i]:[]);
            sediment=sedimentModel.edit(sediment,state.fluid.bed,bed,changed);
          }
        }
        const gate={}, pump={};
        for (const key of Object.keys(gates)) gate[key]=clamp(state.manual['gate.'+key]??ctx.input['gate.'+key],0,1);
        for (const key of Object.keys(pumps)) pump[key]=clamp(state.manual['pump.'+key]??ctx.input['pump.'+key],0,1e9);
        const boundary=boundaryModel?.start(state.boundaries,ctx);
        const obstruction=new Map();
        const opening=(x,z,axis,left,right,{bed,terrain=bed,level:levels})=>{
          if(boundary?.wall(left,axis))return 0;
          let value=1;
          for (const key of matchFaces(x,z,axis,left)){
            const {siltClearance,iceClearance}=gates[key];
            const silt=siltClearance===undefined?1:factor(siltRise(sediment,left,right,terrain[0],terrain[1]),siltClearance);
            const ice=iceClearance===undefined?1:factor(iceRise(state.thermal,left,right),iceClearance);
            value=Math.min(value,gate[key]*silt*ice);
          }
          if (terrainQuery) {
            const key=left*2+axis;
            if (!obstruction.has(key)) {
              const floor=Math.max(...bed);
              const surface=Math.max(...levels), depth=surface-floor;
              const at=ctx.query.probe(terrainQuery,[x,Math.max(floor,(floor+surface)/2),z]);
              obstruction.set(key,!(depth>1e-6 && at.status==='ok' && at.value<0));
            }
            if (!obstruction.get(key)) value=0;
          }
          return value;
        };
        const material=surface!==undefined?new Array(width*height):null;
        function atCell(i) {
          if (material[i]===undefined) {
            const [x,z]=point(i);
            material[i]=W.materials.probe(ctx.query,surface,[x,state.fluid.bed[i],z]);
          }
          return material[i];
        }
        const drain=material?(x,z)=>Math.min(1e4,(config.drain??0)+(atCell(index(x,z))?.permeability??0)):config.drain;
        const solidTransport=sedimentModel?.coupling(sediment,material?atCell:null), heatTransport=thermalModel?.transport(state.thermal);
        const transport=solidTransport&&heatTransport?{...heatTransport,...Object.fromEntries(
          ['begin','face','exit','advect','drain','pump','settle'].map(key=>[key,(...args)=>{
            solidTransport[key](...args);heatTransport[key](...args);
          }]))}:solidTransport??heatTransport;
        solver.step(ctx.dt,{rain:config.rain,drain,friction:config.friction,...ctx.simulationLOD?.tuning,
          ...(Object.keys(gates).length||terrainQuery||boundary?.walls?{opening}:{}),
          ...(boundary?.solver&&{boundary:boundary.solver}),
          ...(transport&&{transport}),...(heatTransport&&{bedOffset:state.thermal.ice}),
          transfers:Object.entries(pumps).map(([key,spec])=>({from:index(...spec.from),to:index(...spec.to),rate:pump[key]}))});
        const fluid=solver.checkpoint({shareBed:!legacyErosion});
        let eroded=0, minX=width,minZ=height,maxX=-1,maxZ=-1;
        if (legacyErosion) for (let i=0;i<material.length;i++) {
          if (fluid.depth[i]<=1e-6) continue;
          const erosion=atCell(i)?.erosion;
          if (!erosion || erosion.rate===0) continue;
          const velocity=Math.hypot(fluid.mx[i],fluid.mz[i])/fluid.depth[i];
          const next=Math.max(-1e7,fluid.bed[i]-Math.max(0,velocity-erosion.threshold)*erosion.rate*ctx.dt);
          const removed=fluid.bed[i]-next;
          if (removed<=0) continue;
          fluid.bed[i]=next;
          eroded+=removed*cellArea;
          const x=i%width,z=Math.floor(i/width);
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
        }
        if (eroded>0) ctx.spatial?.write('bed',{axes:'xz',min:[origin[0]+minX*dx,origin[1]+minZ*dz],
          max:[origin[0]+(maxX+1)*dx,origin[1]+(maxZ+1)*dz]},'surface-erosion');
        const next={...state,gate,pump,fluid,terrain:[],...(legacyErosion&&{eroded:state.eroded+eroded})};
        if(boundary)next.boundaries={rules:state.boundaries.rules,flows:boundary.flows};
        if(solidTransport){
          next.sediment=solidTransport.checkpoint();
          const dirty=solidTransport.dirty();
          if(dirty)ctx.spatial?.write('bed',{axes:'xz',min:[origin[0]+dirty.minX*dx,origin[1]+dirty.minZ*dz],
            max:[origin[0]+(dirty.maxX+1)*dx,origin[1]+(dirty.maxZ+1)*dz]},'sediment-transport');
          next.silted={};
        }
        if(heatTransport){
          next.thermal=thermalModel.phase(heatTransport.capture(),fluid,ctx,boundary?.walls?boundary.wall:undefined);
          next.frozen={};
        }
        if(heatTransport||boundary){
          let x0=width,x1=-1,z0=height,z1=-1;
          for(let i=0;i<fluid.depth.length;i++){
            const phaseChanged=heatTransport&&(next.thermal.ice[i]!==state.thermal.ice[i]||
              next.thermal.energy[i]!==state.thermal.energy[i]||next.thermal.vapor[i]!==state.thermal.vapor[i]);
            if(!phaseChanged&&fluid.depth[i]===state.fluid.depth[i]&&
              fluid.mx[i]===state.fluid.mx[i]&&fluid.mz[i]===state.fluid.mz[i])continue;
            const x=i%width,z=Math.floor(i/width);
            x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);
          }
          if(x1>=0)for(const field of heatTransport?phaseFields:liquidFields)ctx.spatial?.write(field,{
            axes:'xz',min:[origin[0]+x0*dx,origin[1]+z0*dz],max:[origin[0]+(x1+1)*dx,origin[1]+(z1+1)*dz]
          },heatTransport?'thermal-water-phase':'water-boundary-flow');
        }
        if(trackedFaces.size){
          for(const [key,result] of Object.entries(gateMetrics(next))){
            if(result.clogged!==undefined){
              next.silted[key]=result.clogged;
              if(result.clogged!==state.silted[key])ctx.emit(result.clogged?'gate-silted':'gate-cleared',{gate:key,...result});
            }
            if(result.jammed!==undefined){
              next.frozen[key]=result.jammed;
              if(result.jammed!==state.frozen[key])ctx.emit(result.jammed?'gate-frozen':'gate-thawed',{gate:key,...result});
            }
          }
        }
        return P.data.freeze(next);
      },
      output(state) {
        const out={volume:metric({state}).value.volume};
        for (const [key,p] of Object.entries(sensors)) {
          const value=sample(state,...p);
          out['depth.'+key]=value.depth;
          out['flow.'+key]=value.depth*Math.hypot(...value.velocity);
        }
        for (const [key,value] of Object.entries(state.gate)) out['gate.'+key]=value;
        for(const [key,row] of Object.entries(gateMetrics(state)))out['effective-opening.'+key]=row.effective;
        for (const [key,value] of Object.entries(state.pump)) out['pump.'+key]=value;
        return out;
      }
    };
  }
  W.runtime.register('control',control);
  W.runtime.register('fields',typedFields);
  W.runtime.register('water',water,{worker:true});
  W.fields = Object.freeze({zone,bounds,regions,patchList,clamp});
})(KIT);
