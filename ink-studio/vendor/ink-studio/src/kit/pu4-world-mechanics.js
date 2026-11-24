/* Rigid assemblies, authored joints and shared obstacle queries. */
(function (K) {
  const W=K.world, Q=W.query, V=K.V, M=K.M;
  const {check,record,own,id,vector}=W.data, {clamp}=W.fields;
  const zero=[0,0,0], up=[0,1,0];
  const prepared = new WeakMap();
  const indexThreshold = 32;
  const spin=(rotation,omega,dt) => V.len(omega)>1e-9 ? M.mul(M.rot(V.norm(omega),V.len(omega)*dt),rotation) : rotation;
  function distance(body,point) {
    if(body.collider||body.bend)return W.colliders.distance(body,point);
    const local=M.app(geometry(body).inverse,V.sub(point,body.position));
    const q=local.map((n,i)=>Math.abs(n)-body.half[i]);
    return Math.hypot(...q.map(n=>Math.max(n,0)))+Math.min(Math.max(...q),0);
  }
  function column(body,x,z,low,high) {
    if(body.collider||body.bend)return W.colliders.columns(body,x,z,low,high)[0]??null;
    const inv=geometry(body).inverse, from=M.app(inv,V.sub([x,high,z],body.position)), dir=M.app(inv,[0,-1,0]);
    let start=0, end=high-low, face=-1, sign=1;
    for(let k=0;k<3;k++){
      if(Math.abs(dir[k])<1e-10){
        if(Math.abs(from[k])>body.half[k]) return null;
        continue;
      }
      const a=(-body.half[k]-from[k])/dir[k], b=(body.half[k]-from[k])/dir[k], near=Math.min(a,b);
      if(near>=start){ start=near;face=k;sign=dir[k]>0?-1:1; }
      end=Math.min(end,Math.max(a,b));
      if(end<start) return null;
    }
    if(face<0) return null;
    const normal=zero.slice();
    normal[face]=sign;
    return {y:high-start,normal:M.app(body.rotation,normal),id:body.id,material:body.material};
  }
  function geometry(body) {
    let shape=prepared.get(body);
    if(shape)return shape;
    const {rotation,half}=body;
    const extent=[0,1,2].map(i=>half.reduce((sum,n,j)=>sum+Math.abs(rotation[i*3+j])*n,0));
    shape={extent,inverse:M.tr(rotation),bounds:null};
    prepared.set(body,shape);
    return shape;
  }
  function boundsOf(body) {
    if(body.collider||body.bend){
      const {min,max}=W.colliders.geometry(body);
      return {min,max,bounded:min.every(Number.isFinite)&&max.every(Number.isFinite)};
    }
    const shape=geometry(body);
    if(shape.bounds)return shape.bounds;
    const {position,rotation}=body, {extent,inverse}=shape, product=M.mul(rotation,inverse);
    const error=Math.max(...product.map((n,i)=>Math.abs(n-(i%4===0?1:0))));
    const scale=Math.max(1,...position.map(Math.abs),...extent), padding=scale*(1e-12+8*error);
    const min=position.map((n,i)=>n-extent[i]-padding), max=position.map((n,i)=>n+extent[i]+padding);
    const bounded=error<=1e-9&&[...min,...max].every(Number.isFinite);
    return shape.bounds={min,max,bounded};
  }
  function extents(body) { return geometry(body).extent; }
  function changedBounds(before,after) {
    const areas=[], geometry=['id','entity','position','rotation','half','bend','collider'];
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
      const a=own(before,key)?before[key]:null, b=own(after,key)?after[key]:null;
      if(a===b||a&&b&&geometry.every(key=>W.data.equal(a[key],b[key])))continue;
      for(const body of [a,b])if(body){
        const {min,max,bounded}=boundsOf(body);
        if(!bounded)return null;
        areas.push({axes:'xyz',min,max});
      }
    }
    return areas;
  }
  function raycast(bodies,target,args,broad){
    const {direction,distance:limit=100}=args;
    check(target.point&&vector(direction)&&V.len(direction)>1e-8&&Number.isFinite(limit)&&limit>=0&&limit<=1e5,
      'Mechanical ray needs a start, direction and bounded distance');
    const axis=V.norm(direction), exclusions=new Set(args.exclude===undefined?[]:Array.isArray(args.exclude)?args.exclude:[args.exclude]);
    let best=null, rank=Infinity;
    function visit(body,index){
      if(exclusions.has(body.id)||exclusions.has(body.entity))return;
      const hit=W.colliders.ray(body,target.point,axis,best?.distance??limit)[0];
      if(hit&&(!best||hit.distance<best.distance||hit.distance===best.distance&&index<rank)){
        best=hit;rank=index;
      }
    }
    if(broad){
      const end=V.mad(target.point,axis,limit);
      const padding=Math.max(1,...target.point.map(Math.abs),limit)*1e-12;
      broad.overlap(target.point.map((n,i)=>Math.min(n,end[i])-padding),
        target.point.map((n,i)=>Math.max(n,end[i])+padding),row=>visit(row.value,row.rank));
    }else Object.values(bodies).forEach(visit);
    return best?Q.ok(best):Q.missing('no surface along ray','empty');
  }
  function mechanics(config,{catalog,world}) {
    const materialContacts=config.contactEvents==='material';
    check(config.contactEvents===undefined || typeof config.contactEvents==='boolean'||materialContacts,
      'contactEvents must be boolean or material');
    const start=config.bodies??{}, jointSpecs=config.joints??{}, forceSpecs=config.forces??{};
    const impactEvents=config.impactEvents??false, fractureOn=config.fractureOn??{};
    check(typeof impactEvents==='boolean'&&record(fractureOn)&&Object.entries(fractureOn).every(([key,rule])=>
      own(start,key)&&!start[key]?.collider&&record(rule)&&[0,1,2].includes(rule.axis??0)&&
      (rule.parts===undefined||Number.isSafeInteger(rule.parts)&&rule.parts>=2&&rule.parts<=32)&&
      (rule.omit===undefined||rule.parts!==undefined&&Array.isArray(rule.omit)&&
        rule.omit.every(i=>Number.isSafeInteger(i)&&i>=0&&i<rule.parts))&&
      vector(rule.impulse??zero)&&Number.isFinite(rule.minSpeed??0)&&(rule.minSpeed??0)>=0&&
      Number.isFinite(rule.impactMass??1)&&(rule.impactMass??1)>0),'Invalid mechanical impact ports');
    const fractureTargets=new Map(Object.keys(fractureOn).map(key=>[key,key]));
    for(const key of Object.keys(fractureOn)){
      const entity=start[key].entity??key;
      check(!fractureTargets.has(entity)||fractureTargets.get(entity)===key,'Ambiguous fracture receiver '+entity);
      fractureTargets.set(entity,key);
    }
    const canFracture=fractureTargets.size>0;
    const fabricFields=config.deformables??[];
    const routeFields=config.routedLoads??[];
    check(Array.isArray(fabricFields)&&fabricFields.length<=16&&fabricFields.every(field=>typeof field==='string')&&
      new Set(fabricFields).size===fabricFields.length,'Invalid deformable surface fields');
    check(Array.isArray(routeFields)&&routeFields.length<=16&&routeFields.every(field=>typeof field==='string')&&
      new Set(routeFields).size===routeFields.length,'Invalid routed load fields');
    check([start,jointSpecs,forceSpecs].every(group=>record(group)&&Object.keys(group).length<=512&&Object.keys(group).every(id)),
      'Mechanics needs bounded body, joint and force tables');
    const richer=fabricFields.length>0||Object.values(start).some(item=>item?.collider!==undefined||item?.structure!==undefined);
    const local=config.gravityField!==undefined;
    check(!local||typeof config.gravityField==='string','Invalid mechanics gravity field');
    const continuous=config.continuous??(richer||local||impactEvents), advanced=richer||continuous||local, baseIterations=config.contactIterations??10;
    const validIterations=n=>Number.isSafeInteger(n)&&n>=1&&n<=32;
    check((config.continuous===undefined||typeof config.continuous==='boolean')&&validIterations(baseIterations)&&
      (!impactEvents||continuous),
      'Invalid mechanical contact controls');
    const initialBodies={}, initials={}, inputs={}, outputs={}, claimed=new Map(), driveOrder=[], mountOrder=[];
    const surface=W.surfaceState, surfaceChannels=K.procedural.surfaceState.channels(config.surfaceChannels);
    const durability=W.durability, structures={}, wearSpecs={};
    const initialCharts={};
    if (config.contactEvents) outputs.contacts='event';
    if(impactEvents)outputs.impacts='event';
    if(canFracture)inputs['fracture-contacts']='event';
    if(fabricFields.length)outputs['deformable-loads']='event';
    const index = W.spatial.create(), indexed = new Map(), poseCache = new WeakMap();
    let indexedBodies = null, unbounded = 0, enoughBodies = false;
    const entityNames = new Set(Object.entries(start).map(([key,row])=>row.entity??key));
    function updateCollider(body,rank) {
      const prior=indexed.get(body.id);
      if(prior?.body===body&&prior.rank===rank)return;
      if(prior&&!prior.bounded)unbounded--;
      const {min,max,bounded}=boundsOf(body);
      if(!bounded)unbounded++;
      indexed.set(body.id,{body,rank,bounded});
      if(bounded)index.set(body.id,{min,max,rank,value:body});
      else index.remove(body.id);
    }
    function colliderIndex(bodies) {
      if(indexedBodies!==bodies){
        const rows=Object.values(bodies);
        indexedBodies=bodies;
        enoughBodies=rows.length>=indexThreshold;
        if(!enoughBodies)return null;
        for(const [key,prior] of indexed)if(!own(bodies,key)){
          if(!prior.bounded)unbounded--;
          indexed.delete(key);
          index.remove(key);
        }
        for(let rank=0;rank<rows.length;rank++)updateCollider(rows[rank],rank);
      }
      return enoughBodies&&!unbounded?index:null;
    }
    for (const [key,item] of Object.entries(start)) {
      check(record(item)&&vector(item.position??zero)&&
        vector(item.velocity??zero)&&vector(item.angular??zero)&&Number.isFinite(item.mass??1)&&(item.mass??1)>0,
        'Invalid body ' + key);
      check(item.gravityAlign===undefined||local&&Number.isFinite(item.gravityAlign)&&item.gravityAlign>=0&&item.gravityAlign<=1000,
        'Invalid body gravity alignment '+key);
      let half=item.half;
      if(item.collider!==undefined){
        check(half===undefined&&item.surfaceState===undefined,'A shaped collider defines its own dimensions and surface');
        half=W.colliders.local(item.collider).half;
      }else check(vector(half)&&half.every(n=>n>=.01),'Invalid box half extents for '+key);
      check(item.entity===undefined||id(item.entity),'Invalid body entity reference');
      W.materials.validateEntity(catalog,item);
      const rotation=item.turn===undefined?M.id():M.rot(up,item.turn);
      check(rotation.every(Number.isFinite),'Invalid body rotation');
      initialBodies[key]={id:key,entity:item.entity??key,half,position:item.position??zero,
        velocity:item.velocity??zero,angular:item.angular??zero,rotation,mass:item.mass??1,fixed:!!item.fixed,
        material:item.material??'stone',look:item.look??[1,2,3,4,5,6],origin:key,
        ...(item.collider!==undefined&&{collider:item.collider}),
        ...(item.materialAsset!==undefined&&{materialAsset:item.materialAsset}),
        ...(item.materialWetness!==undefined&&{materialWetness:item.materialWetness})};
      if(item.surfaceState!==undefined)initialBodies[key]=surface.init(initialBodies[key],item.surfaceState,initialCharts,surfaceChannels);
      if(item.structure!==undefined){
        check(!item.collider&&half.every(n=>n<=1e3),'A beam structure needs bounded box dimensions');
        const spec=durability.checkStructure(item.structure), profile=W.materials.forBody(catalog,world,initialBodies[key]);
        check(spec.fatigue||spec.plastic||profile?.fatigue||profile?.plastic,'A beam structure needs a fatigue or plastic material law');
        structures[key]=spec;
      }
    }
    for (const [key,spec] of Object.entries(jointSpecs)) {
      check(record(spec)&&['fixed','hinge','slider','shaft'].includes(spec.kind)&&own(start,spec.child)&&
        (spec.parent===null||spec.parent===undefined||own(start,spec.parent))&&spec.parent!==spec.child&&!claimed.has(spec.child),
        'Invalid or duplicate mount ' + key);
      const {axis=up,anchor=zero,offset=zero,range=[-1000000,1000000]}=spec;
      check(vector(axis)&&V.len(axis)>1e-8&&vector(anchor)&&vector(offset)&&vector(range,2)&&range[0]<=range[1]&&
        [spec.ratio??1,spec.speed??0,spec.capacity??1e9,spec.load??0,spec.at??0].every(Number.isFinite)&&
        (spec.capacity??1)>=0&&(spec.load??0)>=0&&(spec.ratio??1)!==0&&
        (!spec.drive||own(jointSpecs,spec.drive))&&['speed','position'].includes(spec.mode??'speed')&&
        (spec.externalLoad===undefined||typeof spec.externalLoad==='boolean'),
        'Invalid joint settings for ' + key);
      check((spec.powerLimited===undefined||typeof spec.powerLimited==='boolean')&&
        (!spec.powerLimited||spec.kind!=='fixed'&&!spec.drive&&Number.isFinite(spec.idlePower??1)&&(spec.idlePower??1)>0)&&
        (spec.idlePower===undefined||spec.powerLimited)&&
        (spec.gravityLoad===undefined||spec.powerLimited&&spec.kind==='slider'&&typeof spec.gravityLoad==='boolean'),
      'Invalid motor power or gravity load for '+key);
      claimed.set(spec.child,key);
      initials[key]={active:true,value:clamp(spec.at??0,...range),speed:0,load:0,stalled:false};
      if(spec.wear!==undefined){
        check(spec.kind!=='fixed','Joint play needs a hinge, shaft or slider');
        const wear=durability.checkWear(spec.wear), profile=W.materials.forBody(catalog,world,initialBodies[spec.child]);
        check(wear.fatigue||profile?.fatigue||wear.travelRate>0,'Joint wear needs a fatigue law or travel rate');
        wearSpecs[key]=wear;
        initials[key].durability=durability.jointInitial(initials[key].value);
      }
      inputs['drive.'+key]={type:'number',default:spec.mode==='position'?spec.at??0:spec.speed??0};
      outputs['speed.'+key]='number';
      outputs['stalled.'+key]='bool';
      if(spec.powerLimited){
        inputs['power.'+key]='number';
        outputs['power-demand.'+key]=outputs['power-draw.'+key]='number';
        outputs['power-limited.'+key]='bool';
        initials[key].power={demand:0,draw:0,grant:0,limited:false,gravity:0};
      }
      if(spec.externalLoad){
        inputs['external-load.'+key]='number';
        outputs['load.'+key]='number';
      }
    }
    function orderedJoints(order,dependency) {
      const done=new Set(), visiting=new Set();
      function visit(key) {
        if(done.has(key)) return;
        check(!visiting.has(key),'Mechanical connection cycle at '+key);
        visiting.add(key);
        const prior=dependency(jointSpecs[key]);
        if(prior) visit(prior);
        visiting.delete(key);
        done.add(key);
        order.push(key);
      }
      for(const key of Object.keys(jointSpecs).sort()) visit(key);
    }
    orderedJoints(driveOrder,spec=>spec.drive);
    orderedJoints(mountOrder,spec=>claimed.get(spec.parent));
    for (const [key,spec] of Object.entries(forceSpecs)) {
      check(record(spec)&&['thrust','buoyancy','wheel','sail'].includes(spec.kind)&&own(start,spec.body)&&
        vector(spec.axis??up)&&V.len(spec.axis??up)>1e-8&&vector(spec.at??zero)&&
        Number.isFinite(spec.magnitude??1)&&(spec.magnitude??1)>=0&&
        Number.isFinite(spec.radius??.3)&&(spec.radius??.3)>0&&
        (spec.kind!=='buoyancy'||typeof spec.field==='string'&&
          (spec.displacement===undefined||Number.isFinite(spec.displacement)&&spec.displacement>0)&&
          (spec.density===undefined||Number.isFinite(spec.density)&&spec.density>=0))&&
        (spec.kind!=='sail'||typeof spec.field==='string'&&spec.field.length>0),'Invalid force module '+key);
      inputs['force.'+key]={type:'number',default:spec.input??(spec.kind==='sail'?1:0)};
    }
    check(vector(config.gravity??[0,-9.81,0])&&Number.isFinite(config.ground??0)&&
      [config.terrain,config.surface].every(field=>field===undefined||typeof field==='string')&&
      Number.isFinite(config.drag??.08)&&(config.drag??.08)>=0,'Invalid mechanical world');
    const forces=Object.entries(forceSpecs), wheels=forces.filter(([,spec])=>spec.kind==='wheel');
    const sails = Object.values(forceSpecs).filter(spec => spec.kind==='sail');
    const windSampler = (query,spec) => query.sampler(spec.field,{type:'vec3',units:spec.units??'world/s'});
    const gravity=config.gravity??[0,-9.81,0];
    const gravityAt=(ctx,point)=>local?W.gravity.sample(ctx.query,config.gravityField,point,gravity):
      {up,acceleration:gravity,buoyancy:1,angularVelocity:zero};
    function ground(context,point) {
      const sampled=config.terrain&&context.query.probe(config.terrain,point);
      return sampled?.status==='ok'&&Number.isFinite(sampled.value)?sampled.value:config.ground??0;
    }
    const groundMaterial=(ctx,point)=>W.materials.probe(ctx.query,config.surface,point);
    const bodyMaterial=(ctx,body)=>W.materials.forBody(catalog,ctx.world,body);
    function friction(a,b) {
      return a!==undefined&&b!==undefined?Math.sqrt(a*b):a??b;
    }
    function placeMounted(bodies,joints,dt,previous=bodies,order=mountOrder) {
      for (const key of order) {
        const spec=jointSpecs[key], joint=joints[key], child=bodies[spec.child], parent=bodies[spec.parent];
        if (!joint.active||!child||spec.parent&&!parent) continue;
        const axis=V.norm(spec.axis??up), parentRotation=parent?.rotation??M.id();
        const coordinate=joint.durability?.actual??joint.value;
        const turn=['hinge','shaft'].includes(spec.kind)?M.rot(axis,coordinate):M.id();
        const offset=M.app(turn,spec.offset??zero);
        let local=V.add(spec.anchor??zero,spec.kind==='slider'?V.mad(offset,axis,coordinate):offset);
        if(parent?.bend)local=durability.bendPoint(parent,local);
        const position=V.add(parent?.position??zero,M.app(parentRotation,local));
        const velocity=dt?V.mul(V.sub(position,previous[spec.child]?.position??child.position),1/dt):parent?.velocity??zero;
        bodies[spec.child]={...child,position,velocity,rotation:M.mul(M.mul(parentRotation,turn),initialBodies[spec.child].rotation),
          angular:V.mad(parent?.angular??zero,M.app(parentRotation,axis),['hinge','shaft'].includes(spec.kind)?joint.speed:0)};
      }
    }
    const usesGravityLoad=Object.values(jointSpecs).some(row=>row.gravityLoad);
    function liftMasses(state){
      const mass=Object.fromEntries(Object.entries(state.bodies).map(([key,row])=>[key,row.mass]));
      for(let i=mountOrder.length-1;i>=0;i--){
        const key=mountOrder[i], {child,parent}=jointSpecs[key];
        if(state.joints[key].active&&own(mass,child)&&own(mass,parent))mass[parent]+=mass[child];
      }
      return mass;
    }
    function commandSpeed(spec,joint,ctx,key){
      const drive=ctx.input['drive.'+key];
      if(spec.mode!=='position')return drive;
      const limit=Math.abs(spec.speed??1);
      return clamp((drive-joint.value)/ctx.dt,-limit,limit);
    }
    function advanceJoints(state,ctx) {
      const next={}, ratios={}, roots={}, demand={}, loading=ctx.causal?{}:null, transitions=ctx.causal?{}:null;
      const liftMass=usesGravityLoad?liftMasses(state):null;
      for(const key of driveOrder){
        const spec=jointSpecs[key], s=state.joints[key];
        const coupled=s.active&&spec.drive&&next[spec.drive]?.active;
        const root=coupled?roots[spec.drive]:key, ratio=coupled?ratios[spec.drive]*(spec.ratio??1):1;
        check(Number.isFinite(ratio)&&Math.abs(ratio)<=1e6,'Transmission ratio exceeds its budget');
        roots[key]=root;ratios[key]=ratio;
        const staticLoad=spec.load??0, linked=spec.loadField?ctx.query.probe(spec.loadField,{entity:state.bodies[spec.child]?.entity}):null;
        const externalLoad=spec.externalLoad?Math.max(0,ctx.input['external-load.'+key]):0;
        const load=staticLoad+externalLoad+(linked?.status==='ok'&&Number.isFinite(linked.value)?Math.max(0,linked.value):0);
        demand[root]=(demand[root]??0)+(s.active?load*Math.abs(ratio):0);
        if (loading && s.active) {
          (loading[root]??=[]).push({joint:key,ratio,load,staticLoad,...(spec.externalLoad&&{externalLoad}),...(spec.loadField && {field:spec.loadField,
            status:linked?.status??'unavailable',reading:Number.isFinite(linked?.value)?linked.value:null})});
        }
        next[key]={...s,load};
      }
      for(const key of driveOrder){
        const spec=jointSpecs[key], s=next[key], root=roots[key], motor=jointSpecs[root], [min,max]=spec.range??[-1e6,1e6];
        let requested=0, gravity=0;
        if(spec.powerLimited&&s.active){
          const raw=commandSpeed(spec,s,ctx,key);
          requested=(clamp(s.value+raw*ctx.dt,min,max)-s.value)/ctx.dt;
          if(spec.gravityLoad&&requested){
            const axis=M.app(state.bodies[spec.parent]?.rotation??M.id(),V.norm(spec.axis??up));
            const acceleration=gravityAt(ctx,state.bodies[spec.child]?.position??zero).acceleration;
            gravity=Math.max(0,-Math.sign(requested)*V.dot(acceleration,axis))*(liftMass[spec.child]??0);
            demand[root]+=gravity;
            if(loading&&gravity)loading[root].push({joint:key,load:gravity,gravity:true,axis});
          }
        }
        const stalled=s.active&&demand[root]>(motor.capacity??1e9);
        let power;
        let speed=0;
        const idle=spec.idlePower??1, grant=spec.powerLimited?Math.max(0,ctx.input['power.'+key]):0;
        const effort=demand[root];
        if(s.active&&!stalled&&spec.kind!=='fixed'){
          if(root!==key) speed=next[spec.drive].speed*(spec.ratio??1);
          else if(spec.powerLimited){
            if(grant>=idle)speed=effort>0?Math.sign(requested)*Math.min(Math.abs(requested),(grant-idle)/effort):requested;
          }else speed=commandSpeed(spec,s,ctx,key);
        }
        const proposed=s.value+speed*ctx.dt, value=clamp(proposed,min,max);
        let measuredSpeed=(value-s.value)/ctx.dt, wear=s.durability, active=s.active;
        if(spec.powerLimited){
          const demand=s.active&&!stalled&&requested?Math.abs(requested)*effort+idle:0;
          const draw=measuredSpeed?Math.min(grant,Math.abs(measuredSpeed)*effort+idle):0;
          power={demand,draw,grant,gravity,limited:demand-grant>1e-9*Math.max(1,demand)};
          if(power.limited&&!s.power.limited){
            const detail={joint:key,demand,grant,effort,gravity};
            const cause=ctx.causal?.record('motor-power-budget',detail,{inputs:['power.'+key,'drive.'+key],
              outputs:['speed.'+key,'power-limited.'+key]});
            ctx.emit('motor-power-limited',detail,cause?[cause]:undefined);
          }
        }
        if(wear&&active){
          const settings=wearSpecs[key], child=state.bodies[spec.child], material=child&&bodyMaterial(ctx,child);
          const nextWear=durability.joint(wear,settings,material,{before:s.value,value,load:root===key?demand[root]:s.load});
          measuredSpeed=(nextWear.actual-wear.actual)/ctx.dt;
          if(nextWear.failed&&!wear.failed){
            active=settings.failure!=='detach';
            ctx.emit('material-failure',{joint:key,entity:state.bodies[spec.child]?.entity??spec.child,
              damage:nextWear.track.damage,stress:nextWear.stress,play:nextWear.play,detached:!active});
            if(!active)measuredSpeed=0;
          }
          wear=nextWear;
        }
        if(stalled&&!s.stalled) {
          const capacity=motor.capacity??1e9;
          let cause;
          if(ctx.causal) {
            cause=ctx.causal.record('load-exceeded',{entity:state.bodies[spec.child]?.entity??spec.child,
              joint:key,load:demand[root],capacity,comparison:'>',contributors:loading[root]},
            {outputs:['speed.'+key,'stalled.'+key]});
            transitions[key]=cause;
          }
          ctx.emit('machine-stall',{joint:key,load:demand[root],capacity},cause?[cause]:undefined);
        } else if(ctx.causal && s.active && !stalled && s.speed!==0 && measuredSpeed===0) {
          const port='drive.'+root, drive=ctx.input[port], entity=state.bodies[spec.child]?.entity??spec.child;
          const driver=root!==key?spec.drive:null;
          const upstream=driver&&next[driver].speed===0;
          const reason=upstream?'upstream-stopped':motor.mode!=='position'&&drive===0?'drive-zero':
            root===key&&motor.mode==='position'&&drive===s.value?'target-reached':
            value!==proposed?'travel-limit':'no-motion';
          const detail={entity,joint:key,previousSpeed:s.speed,speed:0,drive,reason,
            position:value,requestedSpeed:speed,range:[min,max],...(driver && {driver,driverSpeed:next[driver].speed})};
          const parent=upstream&&own(transitions,driver)?transitions[driver]:null;
          const cause=ctx.causal.record('shaft-stopped',detail,{inputs:parent?[]:[port],
            causes:parent?[parent]:[],outputs:['speed.'+key]});
          transitions[key]=cause;
          ctx.emit('machine-stop',detail,[cause]);
        }
        next[key]={...s,active,value,speed:measuredSpeed,stalled:active&&stalled,networkLoad:demand[root],
          ...(wear&&{durability:wear}),...(power&&{power})};
      }
      return next;
    }
    function rootsOf(bodies,joints) {
      const roots=Object.fromEntries(Object.keys(bodies).map(key=>[key,key]));
      for(const key of mountOrder){
        const joint=jointSpecs[key];
        if(joints[key].active&&own(bodies,joint.child))
          roots[joint.child]=joint.parent&&own(bodies,joint.parent)?roots[joint.parent]:null;
      }
      return roots;
    }
    const follows=Object.keys(start).filter(key=>start[key].fixed&&(start[key].follow===true||
      start[key].position===undefined&&start[key].entity!==undefined)&&!claimed.has(key));
    function follow(bodies,scene) {
      if(!follows.length)return;
      const query=Q.create({world:scene});
      for(const key of follows){
        const old=bodies[key];
        if(!old)continue;
        const pose=query.target({entity:old.entity});
        if(pose)bodies[key]={...old,position:pose.point};
        else delete bodies[key];
      }
    }
    function step(state,ctx) {
      const strikes=ctx.input['fracture-contacts']??[];
      check(strikes.length<=1024,'Mechanical fracture contacts exceed their budget');
      for(const row of strikes){
        check(record(row)&&id(row.target)&&Number.isFinite(row.speed??0)&&(row.speed??0)>=0&&
          (row.energy===undefined||Number.isFinite(row.energy)&&row.energy>=0),'Invalid mechanical fracture contact');
        const key=fractureTargets.get(row.target), body=state.bodies[key];
        if(!key||!body)continue;
        const rule=fractureOn[key], speed=row.speed??0;
        if(speed<(rule.minSpeed??0))continue;
        const energy=row.energy??.5*(rule.impactMass??1)*speed*speed;
        check(Number.isFinite(energy),'Fracture energy exceeds its numeric range');
        const updated=fracture(state,{...rule,body:key,energy},ctx);
        if(updated!==state&&ctx.spatial){
          const {min,max,bounded}=boundsOf(body);
          if(bounded)for(const field of ['bodies','support','clearance'])
            ctx.spatial.write(field,{min,max},'fracture-contact');
        }
        state=updated;
      }
      const iterations=ctx.simulationLOD?.tuning.contactIterations??baseIterations;
      const fabric=fabricFields.flatMap(field=>{
        const read=ctx.query.probe(field);
        return read.status==='ok'?[{system:ctx.query.field(field).name.split('/')[0],surfaces:read.value}]:[];
      });
      const fabricLoads=new Map();
      const joints=advanceJoints(state,ctx), bodies={...state.bodies};
      const observations=new Map();
      function observe(key,point,force){
        if(!own(structures,key)||V.len(force)<=1e-8)return;
        if(!observations.has(key))observations.set(key,[]);
        observations.get(key).push({point,force});
      }
      follow(bodies,ctx.world);
      for(const key of mountOrder){
        const joint=jointSpecs[key];
        if(joint.parent&&!bodies[joint.parent]&&joints[key].active){
          joints[key]={...joints[key],active:false,speed:0};
          ctx.emit('support-lost',{joint:key,body:joint.child});
        }
      }
      const roots=rootsOf(bodies,joints), masses={}, force={}, torque={}, members=new Map(), mounts=new Map();
      let rolling;
      placeMounted(bodies,joints,ctx.dt,state.bodies);
      for(const [key,body] of Object.entries(bodies)){
        const root=roots[key];
        if(!root)continue;
        masses[root]=(masses[root]??0)+body.mass;
        if(!members.has(root))members.set(root,[]);
        members.get(root).push(key);
      }
      for(const key of mountOrder){
        const root=roots[jointSpecs[key].child];
        if(!root||!joints[key].active)continue;
        if(!mounts.has(root))mounts.set(root,[]);
        mounts.get(root).push(key);
      }
      if(routeFields.length){
        const byEntity=new Map();
        for(const body of Object.values(state.bodies))if(!byEntity.has(body.entity))byEntity.set(body.entity,body.id);
        for(const field of routeFields){
          const read=ctx.query.probe(field);
          if(read.status!=='ok')continue;
          for(const load of read.value){
            const child=byEntity.get(load.entity), root=child&&roots[child];
            observe(child,load.point,load.force);
            if(!root||bodies[root].fixed)continue;
            force[root]=V.add(force[root]??zero,load.force);
            const arm=V.sub(load.point,state.bodies[root].position);
            torque[root]=V.add(torque[root]??zero,V.cross(arm,load.force));
          }
        }
      }
      function wheelSupport(point,radius,root,axis) {
        if(local){
          const from=V.mad(point,axis,.045), down=V.mul(axis,-1);
          let best=null;
          for(const body of Object.values(bodies)){
            if(roots[body.id]===root)continue;
            for(const hit of W.colliders.ray(body,from,down,radius+.125)){
              if(V.dot(hit.normal,axis)>.4&&(!best||hit.distance-.045<best.gap))
                best={gap:hit.distance-.045,at:hit.point,support:body,normal:hit.normal};
            }
          }
          return best;
        }
        let y=ground(ctx,point), support=null, normal=up;
        if(advanced){
          const [x,,z]=point, low=point[1]-radius-.09, high=point[1]+.04;
          for(const other of Object.values(bodies)){
            if(roots[other.id]===root)continue;
            const {min,max}=boundsOf(other);
            if(x<min[0]||x>max[0]||z<min[2]||z>max[2]||min[1]>high||max[1]<low)continue;
            for(const hit of W.colliders.columns(other,x,z,low,high)){
              if(hit.normal[1]>.4&&hit.y>y){y=hit.y;support=other;normal=hit.normal;}
            }
          }
          for(const {surfaces} of fabric){
            const seat=W.fabricContact.columns(surfaces,x,z,low,high).find(seat=>seat.normal[1]>.4);
            if(seat&&seat.y>y){y=seat.y;support=surfaces[seat.shape];normal=seat.normal;}
          }
        }
        const at=[point[0],y,point[2]];
        return {y,gap:point[1]-y,at,support,normal};
      }
      for(const [key,spec] of forces){
        const body=bodies[spec.body], root=roots[spec.body];
        const dynamic=root&&!bodies[root].fixed;
        if(!body||!dynamic&&!own(structures,spec.body))continue;
        const point=V.add(body.position,M.app(body.rotation,durability.bendPoint(body,spec.at??zero)));
        let wheel;
        const frame=gravityAt(ctx,point);
        let direction=M.app(body.rotation,V.norm(spec.axis??up)), input=clamp(ctx.input['force.'+key],-1,1);
        if(spec.kind==='wheel'){
          const radius=spec.radius??.3;
          wheel=wheelSupport(point,radius,root,frame.up);
          if(!wheel||wheel.gap>radius+.08)continue;
          direction=V.norm(W.gravity.tangent(direction,frame.up),local?V.perp(frame.up):[1,0,0]);
        }
        let capacity=spec.magnitude??1;
        if(spec.kind==='buoyancy'){
          const read=ctx.query.probe(spec.field,point);
          if(read.status!=='ok')continue;
          direction=frame.up;
          const value=read.value, depth=typeof value==='number'?value:value?.depthAtPoint??(value?.surface-point[1]);
          if(!Number.isFinite(depth))continue;
          input=clamp(depth/(spec.radius??.3),0,1);
          if(spec.displacement!==undefined){
            const density=spec.density??value?.density??1;
            if(!Number.isFinite(density)||density<0)continue;
            capacity=density*spec.displacement*Math.max(0,-V.dot(frame.acceleration,frame.up));
          }
          capacity*=frame.buoyancy;
        }
        if(spec.kind==='sail'){
          const wind=windSampler(ctx.query,spec)(...point);
          if(!wind)continue;
          const arm=V.sub(point,body.position);
          const apparent=V.sub(wind,V.add(body.velocity,V.cross(body.angular,arm)));
          const speed=V.dot(direction,apparent);
          input=Math.max(0,input)*speed*Math.abs(speed);
        }
        let magnitude=capacity*input;
        if(spec.kind==='wheel'){
          const fit=wheel.support?bodyMaterial(ctx,wheel.support):groundMaterial(ctx,advanced?wheel.at:point);
          const coefficient=friction(bodyMaterial(ctx,body)?.friction,fit?.friction);
          if(coefficient!==undefined) {
            if(dynamic)(rolling??=new Set()).add(root);
            const limit=coefficient*body.mass*Math.max(0,-V.dot(frame.acceleration,frame.up));
            magnitude=clamp(magnitude,-limit,limit);
          }
        }
        const load=V.mul(direction,magnitude);
        observe(spec.body,point,load);
        if(!dynamic)continue;
        force[root]=V.add(force[root]??zero,load);
        const moment=V.cross(V.sub(point,bodies[root].position),load);
        torque[root]=V.add(torque[root]??zero,spec.kind==='wheel'?V.mul(frame.up,V.dot(moment,frame.up)):moment);
      }
      const drag=Math.exp(-(config.drag??.08)*ctx.dt), rootKeys=Object.keys(masses).sort();
      for(const key of rootKeys){
        const body=bodies[key];
        if(body.fixed)continue;
        const mass=masses[key], applied=V.mul(force[key]??zero,1/mass);
        const inertia=mass*(body.half.reduce((sum,n)=>sum+n*n,0))*.3;
        const velocity=V.mul(local?W.gravity.advance(gravityAt(ctx,body.position),body.velocity,ctx.dt,applied):
          V.mad(body.velocity,V.mad(gravity,force[key]??zero,1/mass),ctx.dt),drag);
        const angular=V.mul(V.mad(body.angular,torque[key]??zero,ctx.dt/Math.max(inertia,.01)),drag);
        bodies[key]=advanced?{...body,velocity,angular}:
          {...body,velocity,angular,position:V.mad(body.position,velocity,ctx.dt),rotation:spin(body.rotation,angular,ctx.dt)};
      }
      let motion, swept;
      if(advanced){
        const plane=!local&&!config.terrain?config.ground??0:undefined, sounded=new Set();
        const onContact=state.beams?(a,b,normal,parts,impulse)=>{
          if(!own(structures,a)&&!own(structures,b))return;
          const left=W.colliders.geometry(bodies[a]).parts[parts[0]];
          const right=b===null?null:W.colliders.geometry(bodies[b]).parts[parts[1]];
          const point=right?left.min.map((n,i)=>(Math.max(n,right.min[i])+Math.min(left.max[i],right.max[i]))*.5):
            [(left.min[0]+left.max[0])*.5,left.min[1],(left.min[2]+left.max[2])*.5];
          const force=V.mul(normal,impulse/ctx.dt);
          observe(a,point,V.mul(force,-1));
          if(b!==null)observe(b,point,force);
        }:undefined;
        motion=W.contactMotion.prepare(bodies,roots,masses,{ground:plane,fabric,onContact,onFabric(seat,key,magnitude){
          const {system,shape,face,nodes,weights,point,normal}=seat, body=bodies[key],
            token=JSON.stringify([key,system,shape,face]), previous=fabricLoads.get(token);
          const impulse=V.mad(previous?.impulse??zero,normal,magnitude);
          const ratio=magnitude/V.len(impulse);
          fabricLoads.set(token,{system,shape,face,nodes,weights:previous?V.lerp(previous.weights,weights,ratio):weights,
            point:previous?V.lerp(previous.point,point,ratio):point,impulse,body:key,entity:body.entity});
        },onGround(child,root,approach) {
          const body=bodies[root], at=[bodies[child].position[0],plane,bodies[child].position[2]];
          const floor=groundMaterial(ctx,at), surface=bodyMaterial(ctx,bodies[child]);
          const coefficient=friction(surface?.friction,floor?.friction), speed=Math.hypot(body.velocity[0],body.velocity[2]);
          if(coefficient!==undefined&&speed>0&&!rolling?.has(root)){
            const keep=Math.max(0,1-coefficient*approach/speed);
            bodies[root]={...body,velocity:[body.velocity[0]*keep,body.velocity[1],body.velocity[2]*keep]};
          }
          const cue=floor?.sounds?.impact??surface?.sounds?.impact;
          if(cue&&approach>=.5&&!sounded.has(root)){
            sounded.add(root);
            ctx.emit('material-sound',{cue,interaction:'impact',entity:body.entity,
              material:floor?.sounds?.impact?floor.id:surface.id,at,speed:approach});
          }
        }});
        motion.settle(iterations);
        if(continuous)swept=motion.sweep(ctx.dt,iterations);
        else motion.move(ctx.dt);
        for(const key of rootKeys){
          const body=bodies[key];
          if(body.fixed)continue;
          let rotation=spin(body.rotation,body.angular,ctx.dt);
          const align=start[body.origin]?.gravityAlign;
          if(align){
            const axis=gravityAt(ctx,body.position).up, localUp=M.app(rotation,up);
            rotation=M.mul(W.gravity.turn(localUp,axis,-Math.expm1(-align*ctx.dt)),rotation);
          }
          bodies[key]={...body,rotation};
        }
      }
      placeMounted(bodies,joints,ctx.dt,state.bodies);
      function translateRoot(key,axis,amount,collision) {
        const body=bodies[key];
        const position=body.position.slice(), velocity=body.velocity.slice();
        position[axis]+=amount;
        if(velocity[axis]*amount<0) velocity[axis]*=collision;
        bodies[key]={...body,position,velocity};
      }
      if(!local)for(const key of rootKeys){
        if(bodies[key].fixed)continue;
        let lift=0, contact, supportBody;
        for(const child of members.get(key)){
          const body=bodies[child];
          const bounds=body.collider||body.bend?W.colliders.geometry(body):null;
          const half=bounds?bounds.max.map((v,i)=>(v-bounds.min[i])*.5):extents(body);
          const center=bounds?V.lerp(bounds.min,bounds.max,.5):body.position;
          const bottom=bounds?.min[1]??body.position[1]-half[1];
          for(const x of [-1,0,1])for(const z of [-1,0,1]){
            const point=[center[0]+x*half[0],bottom,center[2]+z*half[2]];
            const floor=ground(ctx,point), overlap=floor-bottom;
            if(overlap<=lift)continue;
            lift=overlap;
            contact=[point[0],floor,point[2]];
            supportBody=body;
          }
        }
        if(lift>(advanced?1e-8:0)){
          const floor=groundMaterial(ctx,contact), surface=bodyMaterial(ctx,supportBody);
          const coefficient=friction(surface?.friction,floor?.friction);
          const approach=Math.max(0,-bodies[key].velocity[1]);
          if(own(structures,supportBody.id))observe(supportBody.id,contact,[0,1.12*approach*masses[key]/ctx.dt,0]);
          translateRoot(key,1,lift,-.12);
          const body=bodies[key];
          let velocity=body.velocity;
          if(coefficient!==undefined&&!rolling?.has(key)){
            const speed=Math.hypot(velocity[0],velocity[2]);
            const keep=speed>0?Math.max(0,1-coefficient*1.12*approach/speed):0;
            velocity=[velocity[0]*keep,velocity[1],velocity[2]*keep];
          }
          const cue=floor?.sounds?.impact??surface?.sounds?.impact;
          if(cue&&approach>=.5)ctx.emit('material-sound',{cue,interaction:'impact',entity:body.entity,
            material:floor?.sounds?.impact?floor.id:surface.id,at:contact,speed:approach});
          bodies[key]={...body,velocity,angular:V.mul(body.angular,.86)};
        }
      }
      placeMounted(bodies,joints,ctx.dt,state.bodies);
      const keys=Object.keys(bodies).sort();
      const weights=Object.fromEntries(keys.map(key=>{
        const root=roots[key];
        return [key,root&&!bodies[root].fixed?1/masses[root]:0];
      }));
      if(advanced){
        motion.settle(iterations);
        placeMounted(bodies,joints,ctx.dt,state.bodies);
      }
      else if(Object.values(weights).some(Boolean)){
        const broad=keys.length>=indexThreshold&&colliderIndex(bodies);
        const order=broad&&new Map(keys.map((key,i)=>[key,i]));
        const dirty=new Set();
        function refit(root) {
          for(const member of members.get(root))updateCollider(bodies[member],indexed.get(member).rank);
        }
        function move(root,axis,delta,defer) {
          translateRoot(root,axis,delta,-.15);
          placeMounted(bodies,joints,ctx.dt,state.bodies,mounts.get(root)??[]);
          if(!broad)return;
          if(defer)dirty.add(root);
          else refit(root);
        }
        function correct(i,j,defer=false) {
          const a=bodies[keys[i]], b=bodies[keys[j]], ra=roots[a.id], rb=roots[b.id];
          if(ra===rb)return false;
          const wa=weights[a.id], wb=weights[b.id];
          if(!wa&&!wb)return false;
          const ea=extents(a),eb=extents(b),delta=V.sub(b.position,a.position),
            overlap=delta.map((d,k)=>ea[k]+eb[k]-Math.abs(d));
          if(overlap.some(n=>n<=1e-6))return false;
          const axis=overlap.indexOf(Math.min(...overlap)), separation=Math.sign(delta[axis]||1)*overlap[axis]/(wa+wb);
          if(wa)move(ra,axis,-separation*wa,defer);
          if(wb)move(rb,axis,separation*wb,defer);
          return true;
        }
        function scanRow(i,from) {
          for(let j=from;j<keys.length;j++)correct(i,j,true);
          for(const root of dirty)refit(root);
          dirty.clear();
        }
        for(let i=0;i<keys.length-1;i++){
          if(!broad||unbounded){
            scanRow(i,i+1);
            continue;
          }
          let from=i+1;
          while(from<keys.length){
            const {min,max}=boundsOf(bodies[keys[i]]), hits=[];
            broad.overlap(min,max,row=>{
              const j=order.get(row.id);
              if(j>=from && roots[row.id]!==roots[keys[i]] && (weights[row.id]||weights[keys[i]]))hits.push(j);
            });
            // A dense row is cheaper to visit in order and refit once at the end.
            if(hits.length>=8&&hits.length>=(keys.length-from)/4){scanRow(i,from);break;}
            hits.sort((a,b)=>a-b);
            let collision=false;
            for(const j of hits)if(correct(i,j)){from=j+1;collision=true;break;}
            if(!collision)break;
            // A correction can create contacts with later pairs in this row.
            // Query the new bounds before discarding any of those pairs.
            if(unbounded){scanRow(i,from);break;}
          }
        }
      }
      const contacts=[], grounded=materialContacts&&wheels.length?new Map():null, track=grounded?[]:null;
      for(const [key,spec] of wheels){
        const body=bodies[spec.body], old=state.bodies[spec.body];
        if(!body||!old)continue;
        const at=spec.at??zero, point=V.add(body.position,M.app(body.rotation,at));
        const frame=gravityAt(ctx,point), prev=V.add(old.position,M.app(old.rotation,at)), root=roots[body.id];
        const motion=W.gravity.tangent(V.sub(point,prev),frame.up), traveled=V.len(motion);
        if(!grounded&&traveled<=1e-5)continue;
        const seat=wheelSupport(point,spec.radius??.3,root,frame.up);
        if(!seat||seat.gap>(spec.radius??.3)+.09)continue;
        if(grounded)grounded.set(root,(grounded.get(root)??0)+1);
        if(traveled<=1e-5)continue;
        const profile=seat.support?bodyMaterial(ctx,seat.support):groundMaterial(ctx,seat.at);
        const cue=profile?.sounds?.roll;
        const row={entity:body.entity,point:seat.at,support:seat.support?.id??'ground',
          material:profile?.id??seat.support?.material??'ground',weight:traveled,wheel:key,...(cue&&{cue})};
        if(track)track.push({row,root,frame,seat,motion,profile});
        else contacts.push(row);
      }
      if(track)for(const {row,root,frame,seat,motion,profile} of track){
        const travel=row.weight, normal=seat.normal??frame.up;
        const load=(masses[root]??0)*Math.max(0,-V.dot(frame.acceleration,normal))/grounded.get(root);
        contacts.push(W.contactEffects.capture(ctx,row,contacts.length,'roll',{
          speed:travel/ctx.dt,load,travel,normal,heading:V.mul(motion,1/travel),profile}));
      }
      let beams;
      if(state.beams){
        beams={...state.beams};
        const changed=[];
        for(const [key,spec] of Object.entries(structures)){
          const body=bodies[key], previous=state.beams[key];
          if(!body)continue;
          const material=bodyMaterial(ctx,body), {next,bend,hot}=durability.beam(previous,body,spec,material,observations.get(key)??[],ctx.dt);
          beams[key]=next;
          if(bend!==body.bend){
            bodies[key]={...body,bend};
            changed.push(boundsOf(body),boundsOf(bodies[key]));
          }
          if(next.yielded&&!previous.yielded||next.failed&&!previous.failed){
            const cell=next.cells[hot], at=durability.physicalAt(bodies[key],spec.axis,hot/spec.sections);
            const detail={body:key,entity:body.entity,material:material?.id??body.material,section:hot,at,
              stress:V.len(cell.stress),damage:durability.damage(cell)};
            if(next.yielded&&!previous.yielded)ctx.emit('material-yield',detail);
            if(next.failed&&!previous.failed)ctx.emit('material-failure',detail);
          }
        }
        if(changed.length){
          placeMounted(bodies,joints,ctx.dt,state.bodies);
          if(ctx.spatial){
            const min=zero.map((_,axis)=>Math.min(...changed.map(row=>row.min[axis])));
            const max=zero.map((_,axis)=>Math.max(...changed.map(row=>row.max[axis])));
            for(const field of ['bodies','support','clearance'])ctx.spatial.write(field,{min,max},'permanent-deformation');
          }
        }
      }
      return {...state,bodies,joints,contacts,...(continuous&&{impacts:swept.impacts,impactLimited:swept.limited}),
        ...(fabricFields.length&&{fabricLoads:[...fabricLoads.values()]}),...(beams&&{beams})};
    }
    function detach(state,key,ctx) {
      check(own(state.joints,key)&&state.joints[key].active,'Unknown or detached joint ' + key);
      ctx.emit('detached',{joint:key,body:jointSpecs[key].child});
      return {...state,joints:{...state.joints,[key]:{...state.joints[key],active:false,speed:0}}};
    }
    function fracture(state,{body:key,axis=0,parts:requested,omit=[],impulse=zero,energy},ctx) {
      const body=state.bodies[key];
      check(own(state.bodies,key),'Unknown body '+key);
      check(!body.collider,'Slice fracture needs a box body');
      const profile=bodyMaterial(ctx,body), response=profile?.fracture, parts=requested??response?.parts??3;
      const cue=profile?.sounds?.fracture, material=profile?.id??body.material;
      if(energy!==undefined&&response&&energy<response.energy) {
        ctx.emit('fracture-resisted',{body:key,material,energy,threshold:response.energy});
        return state;
      }
      check([0,1,2].includes(axis)&&Number.isSafeInteger(parts)&&parts>=2&&parts<=32&&
        body.half[axis]/parts>=.005&&Array.isArray(omit)&&omit.every(i=>Number.isSafeInteger(i)&&i>=0&&i<parts)&&
        vector(impulse)&&Object.keys(state.bodies).length+parts<=1024,'Invalid fracture command');
      const bodies={...state.bodies}, joints={...state.joints}, fragments=[];
      const surfaceCharts=body.surfaceState?{...state.surfaceCharts}:state.surfaceCharts;
      delete bodies[key];
      for(const [id,spec] of Object.entries(jointSpecs))if(spec.parent===key||spec.child===key)
        joints[id]={...joints[id],active:false,speed:0};
      const half=body.half.slice();
      half[axis]/=parts;
      for(let i=0;i<parts;i++){
        if(omit.includes(i))continue;
        const name=key+'.'+i, local=zero.slice();
        check(!own(bodies,name),'Fragment already exists: '+name);
        local[axis]=(2*i+1-parts)*half[axis];
        const offset=M.app(body.rotation,local);
        const child={...body,id:name,entity:name,fixed:false,half,position:V.add(body.position,offset),
          ...(profile&&{materialAsset:profile.id,materialWetness:profile.wetness}),
          velocity:V.add(V.add(body.velocity,V.cross(body.angular,offset)),impulse),mass:body.mass/parts};
        bodies[name]=surface.fragment(body,durability.fragment(body,child,axis,local),axis,i,parts,surfaceCharts);
        fragments.push(name);
      }
      if(body.surfaceState)surface.prune(surfaceCharts,bodies);
      ctx.emit('fracture',{body:key,at:body.position,material,fragments,...(cue&&{cue}),
        ...(energy!==undefined&&{energy,...(response&&{threshold:response.energy})})});
      return {...state,bodies,joints,...(surfaceCharts&&{surfaceCharts})};
    }
    function reshape(state,{body:key,half},ctx) {
      check(own(state.bodies,key),'Unknown body '+key);
      const body=state.bodies[key];
      check(!body.collider,'Reshape needs a box body');
      ctx.emit('body-reshaped',{body:key,before:body.half,half});
      const bend=body.bend&&{...body.bend,offsets:body.bend.offsets.map(offset=>
        V.mul(offset,half[body.bend.axis]/body.half[body.bend.axis]))};
      return {...state,bodies:{...state.bodies,[key]:{...body,half,...(bend&&{bend})}}};
    }
    function readSurface({state,target,args}) {
      const key=args.body??target.entity;
      const body=state&&(args.body===undefined?Object.values(state.bodies).find(row=>row.entity===key):
        own(state.bodies,key)?state.bodies[key]:null);
      if(!body?.surfaceState)return Q.missing('body has no surface atlas','missing');
      check(args.face===undefined||surface.isFace(args.face),'Unknown body surface face');
      let {face,uv}=args;
      if(uv===undefined&&target.point)({face,uv}=surface.frame(body)(target.point,undefined,face));
      if(face===undefined||uv===undefined)return Q.missing('surface sample needs a face and UV or a world point');
      check(K.procedural.surfaceState.isUv(uv),'Surface sample needs unit UV coordinates');
      return Q.ok({body:body.id,...surface.sample(body,state.surfaceCharts,surfaceChannels,face,uv)});
    }
    function readFatigue({state,target,args,...ctx}) {
      const beams=state.beams??{}, point=vector(target)?target:target?.point;
      function describeBeam(key){
        const row=beams[key], body=state.bodies[key], spec=structures[key], material=body&&bodyMaterial(ctx,body);
        const sections=row.cells.map((cell,index)=>({section:index,along:index/spec.sections,
          at:body?durability.physicalAt(body,row.axis,index/spec.sections):null,
          stress:cell.stress,stressMagnitude:V.len(cell.stress),peakStress:cell.peakStress,curvature:cell.curvature,damage:durability.damage(cell),
          cycles:Math.max(...cell.channels.map(track=>track.cycles))}));
        const hotspot=sections.reduce((best,row)=>row.damage>best.damage||
          row.damage===best.damage&&row.peakStress>best.peakStress?row:best);
        return {body:key,entity:body?.entity??key,present:!!body,axis:row.axis,bearings:spec.bearings,loads:row.loads,
          failed:row.failed,yielded:row.yielded,material:material?.id??body?.material??null,
          fatigue:spec.fatigue??material?.fatigue??null,plastic:spec.plastic??material?.plastic??null,
          hotspot,sections};
      }
      function describeJoint(key){
        const {value,speed,active,durability:row}=state.joints[key], body=state.bodies[jointSpecs[key].child];
        return {joint:key,entity:body?.entity??jointSpecs[key].child,at:body?.position??null,active,
          command:value,actual:row.actual,speed,stress:row.stress,damage:row.track.damage,cycles:row.track.cycles,
          wear:row.wear,play:row.play,failed:row.failed};
      }
      if(args.joint!==undefined)return own(wearSpecs,args.joint)?Q.ok(describeJoint(args.joint)):
        Q.missing('Joint wear is unavailable','missing');
      const key=args.body??(own(beams,target?.entity)?target.entity:Object.keys(beams).find(id=>
        target?.entity!==undefined&&state.bodies[id]?.entity===target.entity));
      if(key!==undefined){
        if(!own(beams,key))return Q.missing('Beam fatigue is unavailable','missing');
        const beam=describeBeam(key);
        if(args.section!==undefined){
          check(Number.isSafeInteger(args.section)&&args.section>=0&&args.section<beam.sections.length,'Unknown beam section');
          return Q.ok({body:key,...beam.sections[args.section]});
        }
        return Q.ok(beam);
      }
      if(point){
        check(vector(point),'A fatigue probe needs a finite XYZ point');
        let closest, distance=Infinity;
        for(const id of Object.keys(beams))for(const row of describeBeam(id).sections){
          if(!row.at)continue;
          const gap=V.dist(row.at,point);
          if(gap<distance){distance=gap;closest={body:id,...row};}
        }
        return closest?Q.ok({...closest,distance}):Q.missing('No live beam sections','empty');
      }
      if(target?.entity!==undefined){
        const joint=Object.keys(wearSpecs).find(key=>state.bodies[jointSpecs[key].child]?.entity===target.entity);
        return joint?Q.ok(describeJoint(joint)):Q.missing('Material fatigue is unavailable','missing');
      }
      return Q.ok({bodies:Object.fromEntries(Object.keys(beams).map(key=>[key,describeBeam(key)])),
        joints:Object.fromEntries(Object.keys(wearSpecs).map(key=>[key,describeJoint(key)]))});
    }
    function support(context) {
      const {state,target,args}=context;
      if(!target.point) return Q.missing('point required');
      const [x,y,z]=target.point, high=args.high??y+.5, low=args.low??y-4;
      check(Number.isFinite(low)&&Number.isFinite(high)&&low<=high,'Invalid support interval');
      const rows=[];
      const visit=body=>{
        const hits=body.collider||body.bend?W.colliders.columns(body,x,z,low,high):[column(body,x,z,low,high)];
        for(const row of hits)if(row&&row.normal[1]>.25){
          const profile=bodyMaterial(context,body);
          rows.push(profile?{...row,material:profile.id,...(profile.sounds?.step&&{cue:profile.sounds.step}),
            ...(args.includeMaterial&&{surface:profile})}:row);
        }
      };
      const broad=colliderIndex(state.bodies);
      // The column test treats near-parallel local axes as parallel.
      const pad=(high-low)*2e-10+Math.max(1,Math.abs(x),Math.abs(z),Math.abs(low),Math.abs(high))*1e-12;
      if(broad)broad.overlap([x-pad,low-pad,z-pad],[x+pad,high+pad,z+pad],row=>visit(row.value));
      else for(const body of Object.values(state.bodies))visit(body);
      const floor=ground(context,target.point);
      if(!local&&floor>=low&&floor<=high){
        const surface=groundMaterial(context,[x,floor,z]);
        rows.push({y:floor,normal:up,id:'ground',material:surface?.id??'ground',
          ...(surface?.sounds?.step&&{cue:surface.sounds.step}),...(args.includeMaterial&&surface&&{surface})});
      }
      return Q.ok(rows.sort((a,b)=>b.y-a.y||a.id.localeCompare(b.id)));
    }
    function obstruction({state,target},excluded) {
      if(!target.point)return Q.missing('point required');
      const broad=colliderIndex(state.bodies);
      const exclusions=new Set(Array.isArray(excluded)?excluded:excluded===undefined?[]:[excluded]);
      const eligible=body=>!exclusions.has(body.id)&&!exclusions.has(body.entity);
      if(broad){
        const hit=broad.nearest(target.point,(row,point)=>eligible(row.value)?distance(row.value,point):Infinity);
        if(hit)return {status:'ok',value:hit.value,body:hit.id};
      }
      let nearest, value=Infinity, count=0;
      for(const body of Object.values(state.bodies)){
        if(!eligible(body))continue;
        count++;
        const d=distance(body,target.point);
        if(d<value){value=d;nearest=body.id;}
      }
      return count?{status:'ok',value,body:nearest}:Q.missing('no bodies','empty');
    }
    const structural=Object.keys(structures).length>0, serviceable=structural||Object.keys(wearSpecs).length>0;
    function checkRepair(args){
      check(record(args)&&Object.keys(args).length===1&&(own(structures,args.body)||own(wearSpecs,args.joint)),
        'A repair effect needs a structural body or wear-tracked joint');
    }
    function repair(state,{body,joint},batch,ctx){
      if(joint!==undefined){
        const prior=state.joints[joint];
        if(!prior.active)return {reason:'joint-detached'};
        const next={...prior,durability:durability.jointInitial(prior.value)};
        ctx.emit('joint-repaired',{joint,body:jointSpecs[joint].child});
        return {state:{...state,joints:{...state.joints,[joint]:next}}};
      }
      const prior=state.bodies[body];
      if(!prior)return {reason:'repair-body-missing'};
      const {bend,...straight}=prior;
      const bodies=bend?{...state.bodies,[body]:straight}:state.bodies;
      if(bend){
        const {min,max}=K.procedural.spatial.boxOf([boundsOf(prior).min,boundsOf(prior).max,
          boundsOf(straight).min,boundsOf(straight).max]);
        for(const field of ['bodies','support','clearance'])ctx.spatial?.write(field,{min,max},'material-repaired');
      }
      ctx.emit('body-repaired',{body,entity:prior.entity,at:prior.position});
      return {state:{...state,bodies,beams:{...state.beams,[body]:durability.beamInitial(structures[body])}}};
    }
    return {...(serviceable&&{workEffects:{repair:{check:checkRepair,run:repair}}}),navigationSource(field,state,query){
      if(!state||!['clearance','support','ground-clearance'].includes(field))return;
      if(field==='clearance'||field==='support'&&!config.terrain){
        const key=state.bodies;
        return {key,changes:old=>changedBounds(old,key)};
      }
      if(!config.terrain)return {key:config};
      const terrain=query.navigationSource(config.terrain);
      if(field==='ground-clearance')return terrain;
      const key={bodies:state.bodies,terrain:terrain.key};
      return {key,changes:old=>{
        const floor=old.terrain===key.terrain?[]:terrain.changes?.(old.terrain);
        const bodies=old.bodies===key.bodies?[]:changedBounds(old.bodies,key.bodies);
        return floor&&bodies?[...floor,...bodies]:null;
      }};
    },checkSimulationLOD(tuning){
      check(Object.keys(tuning).every(key=>key==='contactIterations')&&
        (tuning.contactIterations===undefined||validIterations(tuning.contactIterations)),
        'Invalid mechanics simulation detail tuning');
    },...((config.surface!==undefined||fabricFields.length||routeFields.length||structural||local||canFracture)&&
      {dependencies:{reads:[config.surface,config.gravityField,...fabricFields,...routeFields].filter(Boolean),
        ...((structural||canFracture)&&{writes:['bodies','support','clearance']})}}),
    ...((sails.length||config.surface!==undefined||fabricFields.length||routeFields.length||local) && {checkFields(query) {
      for (const sail of sails) windSampler(query,sail);
      if(local)W.gravity.checkField(query,config.gravityField);
      W.materials.checkSurface(query,config.surface);
      const names=fabricFields.map(field=>{
        const descriptor=query.field(field);
        check(descriptor?.role==='deformable-surfaces','Expected a deformable surface field '+field);
        return descriptor.name;
      });
      check(new Set(names).size===names.length,'Duplicate deformable surface field');
      const routes=routeFields.map(field=>{
        const descriptor=query.field(field);
        check(descriptor?.role==='routed-reactions','Expected a routed reaction field '+field);
        return descriptor.name;
      });
      check(new Set(routes).size===routes.length,'Duplicate routed reaction field');
    }}),inputs,outputs,initial(ctx) {
      const bodies={...initialBodies}, joints={...initials};
      follow(bodies,ctx.world);
      placeMounted(bodies,joints,0);
      return {bodies,joints,contacts:[],...(Object.keys(initialCharts).length&&{surfaceCharts:initialCharts}),
        ...(fabricFields.length&&{fabricLoads:[]}),
        ...(Object.keys(structures).length&&{beams:Object.fromEntries(Object.entries(structures).map(([key,spec])=>
          [key,durability.beamInitial(spec)]))}),
        ...(continuous&&{impacts:[],impactLimited:false})};
    },step,validateState(state){
      check(record(state?.bodies)&&record(state.joints)&&Object.keys(state.bodies).length<=1024&&
        Object.keys(state.joints).sort().join(',')===Object.keys(jointSpecs).sort().join(',')&&
        Object.entries(state.bodies).every(([key,body])=>id(key)&&body.id===key&&vector(body.half)&&body.half.every(n=>n>0)&&
          vector(body.position)&&vector(body.velocity)&&vector(body.angular)&&vector(body.rotation,9)&&
          Number.isFinite(body.mass)&&body.mass>0)&&Object.values(state.joints).every(joint=>typeof joint.active==='boolean'&&
          Number.isFinite(joint.value)&&Number.isFinite(joint.speed)),'Invalid mechanical checkpoint');
      for(const body of Object.values(state.bodies)){
        W.materials.validateEntity(catalog,body);
        if(body.collider!==undefined)check(advanced&&!body.surfaceState&&
          W.data.equal(body.half,W.colliders.local(body.collider).half),'Invalid saved collider dimensions');
        if(body.bend!==undefined){
          check(advanced&&!body.collider&&own(structures,body.origin),'Invalid body permanent bend');
          durability.validateBend(body.bend);
        }
      }
      if(Object.keys(structures).length){
        check(record(state.beams)&&Object.keys(state.beams).length===Object.keys(structures).length,'Invalid saved beam table');
        for(const [key,spec] of Object.entries(structures))durability.beamValidate(state.beams[key],spec);
      }
      for(const key of Object.keys(wearSpecs))durability.jointValidate(state.joints[key].durability);
      for(const [key,spec] of Object.entries(jointSpecs))if(spec.powerLimited){
        const power=state.joints[key].power;
        check(record(power)&&[power.demand,power.draw,power.grant,power.gravity].every(n=>Number.isFinite(n)&&n>=0)&&
          power.draw<=power.grant&&typeof power.limited==='boolean','Invalid saved motor power '+key);
      }
      if(fabricFields.length)check(Array.isArray(state.fabricLoads)&&state.fabricLoads.every(load=>record(load)&&
        id(load.system)&&id(load.shape)&&id(load.body)&&vector(load.point)&&vector(load.impulse)),
      'Invalid saved deformable reactions');
      if(continuous)check(Array.isArray(state.impacts)&&state.impacts.length<=64&&typeof state.impactLimited==='boolean'&&
        state.impacts.every(hit=>record(hit)&&own(state.bodies,hit.a)&&(hit.b===null||own(state.bodies,hit.b))&&vector(hit.normal)&&
          vector(hit.parts,2)&&Number.isFinite(hit.speed)&&Number.isFinite(hit.at)&&hit.at>=0&&hit.at<=1),
      'Invalid saved continuous contacts');
      surface.validate(state,surfaceChannels);
    },checkAction(type,args){
      if(type==='detach')check(own(jointSpecs,args.joint),'Unknown joint '+args.joint);
      if(type==='impulse')check(id(args.body)&&vector(args.linear??zero)&&vector(args.angular??zero),'Invalid body impulse');
      if(type==='surface-stamp'){
        check(!start[args.body]?.collider,'Surface stamps need a box body');
        surface.checkStamp(args,surfaceChannels);
      }
      if(type==='reshape')check(id(args.body)&&vector(args.half)&&args.half.every(n=>n>=.005&&n<=1e4)&&
        !start[args.body]?.collider&&Object.keys(args).every(key=>['body','half'].includes(key)),'A reshape needs a box body and bounded half sizes');
      if(type==='fracture'){
        const parts=args.parts??(catalog?.materials.length?32:3), omit=args.omit??[];
        check(id(args.body)&&!start[args.body]?.collider&&[0,1,2].includes(args.axis??0)&&Number.isSafeInteger(parts)&&parts>=2&&parts<=32&&
          Array.isArray(omit)&&omit.every(i=>Number.isSafeInteger(i)&&i>=0&&i<parts)&&vector(args.impulse??zero)&&
          (args.energy===undefined||Number.isFinite(args.energy)&&args.energy>=0),
          'Invalid fracture command');
      }
    },...(!local&&{occupancyField:'ground-clearance'}),occupancy:{
      kind:'body',key:state=>state.bodies,distance,
      *rows(state){
        for(const body of Object.values(state.bodies)){
          const {min,max,bounded}=boundsOf(body);
          yield {id:body.id,entity:body.entity,position:body.position,min:bounded?min:null,max:bounded?max:null,
            shape:body,...(body.material!==undefined&&{material:body.material})};
        }
      }
    },*poseEntities(state) {
      for(const body of Object.values(state?.bodies??{}))yield body.entity;
    },pose(state,entity) {
      if(!state)return null;
      const named=state.bodies[entity];
      if(named?.entity===entity)return named;
      let poses=poseCache.get(state.bodies);
      if(!poses){
        poses=new Map();
        for(const body of Object.values(state.bodies))if(!poses.has(body.entity))poses.set(body.entity,body);
        poseCache.set(state.bodies,poses);
      }
      return poses.get(entity)??(entityNames.has(entity)?false:null);
    },output(state){
      const out={};
      for(const [key,joint] of Object.entries(state.joints)){
        out['speed.'+key]=joint.speed;
        out['stalled.'+key]=joint.stalled;
        if(jointSpecs[key].externalLoad)out['load.'+key]=joint.networkLoad??((jointSpecs[key].load??0)+(joint.load??0));
        if(jointSpecs[key].powerLimited){
          out['power-demand.'+key]=joint.power.demand;
          out['power-draw.'+key]=joint.power.draw;
          out['power-limited.'+key]=joint.power.limited;
        }
      }
      if (config.contactEvents) out.contacts=state.contacts;
      if(impactEvents)out.impacts=(state.impacts??[]).flatMap(hit=>{
        const source=state.bodies[hit.a]?.entity, target=hit.b===null?'ground':state.bodies[hit.b]?.entity;
        if(!source||!target||source===target)return [];
        const row={kind:'impact',source,target,at:hit.at,speed:Math.max(0,hit.speed),normal:hit.normal};
        return hit.b===null?[row]:[row,{...row,source:target,target:source,normal:V.mul(hit.normal,-1)}];
      });
      if(fabricFields.length)out['deformable-loads']=state.fabricLoads;
      return out;
    },
    fields:{
      bodies:{type:'record',read:({state})=>Q.ok(state.bodies)},
      joints:{type:'record',read:({state})=>Q.ok(state.joints)},
      contacts:{type:'records',read:({state})=>Q.ok(state.contacts??[])},
      impacts:{type:'record',read:({state})=>Q.ok({impacts:state.impacts??[],limited:state.impactLimited??false})},
      fatigue:{type:'record',selector:true,read:readFatigue},
      ...(fabricFields.length&&{'deformable-loads':{type:'records',read:({state})=>Q.ok(state.fabricLoads)}}),
      'surface-state':{type:'record',read:readSurface},
      'surface-charts':{type:'record',read:({state})=>state?.surfaceCharts?
        Q.ok({charts:state.surfaceCharts,channels:surfaceChannels}):Q.missing('surface atlas is unavailable')},
      clearance:{type:'number',units:'world',read:context=>obstruction(context,context.args.exclude)},
      ...(!local&&{'ground-clearance':{type:'number',units:'world',qualified:true,
        read:context=>context.target.point?Q.ok(context.target.point[1]-ground(context,context.target.point)):
          Q.missing('point required')}}),
      support:{type:'records',units:'world',read:support}
    },
    traces:{ray:{role:'occlusion-ray',run:({state,target,args})=>raycast(state.bodies,target,args,colliderIndex(state.bodies))
    },support:{run(context){
      const first=support(context);
      if(first.status!=='ok'||!first.value.length)return first;
      let body=first.value[0].id;
      const points=[first.value[0]];
      for(let i=0;i<mountOrder.length;i++){
        const joint=claimed.get(body);
        if(!joint||!context.state.joints[joint].active)break;
        const parent=jointSpecs[joint].parent;
        points.push({joint,id:parent??'world'});
        if(!parent)break;
        body=parent;
      }
      return Q.ok({status:'ok',points});
    }}},
    actions:{detach(state,{joint},ctx){return detach(state,joint,ctx);},fracture,reshape,
      'surface-stamp':(state,args,ctx)=>{
        check(!state.bodies[args.body]?.collider,'Surface stamps need a box body');
        return surface.apply(state,args,surfaceChannels,ctx);
      },
      impulse(state,{body,linear=zero,angular=zero},ctx){
        const target=state.bodies[body];
        check(own(state.bodies,body)&&!target.fixed&&vector(linear)&&vector(angular),'Invalid body impulse');
        ctx.emit('impulse',{body});
        return {...state,bodies:{...state.bodies,[body]:{...target,velocity:V.mad(target.velocity,linear,1/target.mass),
          angular:V.mad(target.angular,angular,1/target.mass)}}};
      }
    }};
  }
  W.runtime.register('mechanics',mechanics);
  W.mechanics=Object.freeze({distance,column,changedBounds,raycast});
})(KIT);
