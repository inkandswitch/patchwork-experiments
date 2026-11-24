/* Headless splat view of a world revision. */
(function (K) {
  const W = K.world, V = K.V, M = K.M;
  const palette = [
    0x141b28,0x292e3a,0x424657,0x626575,0x8a8994,0xb2a9a8,0xd9c9b4,
    0x263e3f,0x355953,0x4d7360,0x6a8a68,0x98a678,0xc4bb8a,
    0x173047,0x1c475b,0x226a78,0x329393,0x64b8aa,0xa9ded2,
    0x4e302a,0x815032,0xab6e3b,0xd29f55,0xf0cb7b,0xf8edd0
  ];
  function visualParameters(world, input) {
    const dataInputs = world.dataInputs === undefined ? undefined : K.dataInputs.prepare(world.dataInputs);
    if (world.visual?.parameterBindings === undefined) return { world, dataInputs };
    const { parameterBindings, ...visual } = world.visual;
    const program = K.parameters.prepare(parameterBindings);
    for (const { path } of program.targets) {
      if (!(path[0] === 'visual' && path.length >= 2 && path[1] !== 'parameterBindings' ||
          path[0] === 'entities' && path[2] === 'visual' && path.length >= 3))
        throw new RangeError('Unsupported world visual parameter path: ' + path.join('/'));
    }
    const { document, values } = program.apply({ visual, entities: world.entities }, { ...input, dataInputs });
    return { world: { ...world, ...document }, values, dataInputs };
  }
  function visualEnvironment(world, catalog = W.materials.catalog(world)) {
    const config = world.visual ?? {};
    return K.authoring.environments.apply(config,config.environmentPreset,catalog,config.palette ?? palette);
  }
  const timelines = new WeakMap(), cameraRigs = new WeakMap();
  function sceneCameraRig(world) {
    const definition = world.visual?.cameraRig;
    if (definition === undefined) return;
    const cached = cameraRigs.get(definition);
    if (cached) return cached;
    const rig = K.cameraRig.compile(definition, { parts: new Set() });
    if (K.procedural.data.isImmutable(world)) cameraRigs.set(definition, rig);
    return rig;
  }
  function sceneTimeline(world) {
    if (world.timeline === undefined) return;
    const cached = timelines.get(world);
    if (cached) return cached;
    const { read } = W.data, rig = sceneCameraRig(world);
    let look;
    const timeline = K.timeline.compile(world.timeline, { channel(path) {
      const [root, field] = path;
      if (root === 'camera' && path.length === 2) return K.cameraRig.channel(field, rig?.shots);
      if (root === 'renderGraph' || root === 'inspection') {
        look ??= visualLooks(world, W.materials.catalog(world)).look;
        return K.presentationTimeline.channel(look, path);
      }
      if (root !== 'visual' || path.length < 2 || ['camera', 'cameraRig', 'dataMarks', 'parameterBindings'].includes(field)) return null;
      const value = read(world, path);
      if (Number.isFinite(value)) return { validate: Number.isFinite };
      if (typeof value === 'boolean' || typeof value === 'string')
        return { mode: 'step', validate: next => typeof next === typeof value };
      if (Array.isArray(value) && value.length && value.every(Number.isFinite)) return { size: value.length };
      return null;
    } });
    if (K.procedural.data.isImmutable(world)) timelines.set(world, timeline);
    return timeline;
  }
  function visualLooks(world, catalog, config = visualEnvironment(world,catalog)) {
    const entities = world.entities;
    const assets = K.authoring.looks, paletteOptions = { palette: config.palette ?? palette,
      roles: config.paletteRoles, blueNoise: K.procedural.materials.blueNoise,
      context: config.surfaceEffects && K.splatEffects.context(config.surfaceEffects), validateOnly: true };
    const look = assets.scene(config.look, catalog), inherited = new Map(), surfaces = new Map();
    function surface(binding) {
      if (!surfaces.has(binding)) {
        const { surface: settings } = assets.material({}, binding, catalog);
        surfaces.set(binding, settings);
      }
      return surfaces.get(binding);
    }
    function material(base, binding) {
      const settings = surface(binding);
      return settings ? SurfaceLook.material(base, settings) : base;
    }
    function forEntity(id) {
      if (id == null || !Object.hasOwn(entities, id)) return undefined;
      const explicit = entities[id].visual?.lookAsset;
      if (explicit !== undefined) return explicit;
      let current = id, binding;
      const path = [];
      while (current != null && Object.hasOwn(entities, current) && !inherited.has(current)) {
        const entity = entities[current];
        path.push(current);
        if (entity.lookAsset !== undefined) {
          binding = entity.lookAsset;
          break;
        }
        current = entity.anchor?.entity ?? entity.parent;
      }
      if (inherited.has(current)) binding = inherited.get(current);
      for (const key of path) inherited.set(key, binding);
      return binding;
    }
    function validate() {
      W.data.check(look?.coverageAware === undefined || typeof look.coverageAware === 'boolean', 'coverageAware must be a boolean');
      HorizonBands.compile(look?.horizonBands);
      FrameComposite.settings(look?.composite);
      Cutaway.prepare(look?.cutaway);
      RenderGraph.prepare(look?.renderGraph);
      RenderStages.prepare(look?.renderStages, paletteOptions);
      RenderStages.optics(look?.optics, paletteOptions);
      if (look?.paletteConstraints || Object.hasOwn(config.look ?? {}, 'asset') || Object.hasOwn(config.look ?? {}, 'targets')) {
        PixelLook.prepareColorStack(look.colorStack, paletteOptions.palette, paletteOptions.roles);
        PixelLook.preparePaletteConstraints(look.paletteConstraints, paletteOptions);
      }
      const checked = new Set();
      function check(binding) {
        if (binding === undefined || checked.has(binding)) return;
        const settings = surface(binding);
        if (settings) SurfaceLook.prepare(settings, paletteOptions.palette, undefined, paletteOptions.context,
          { paletteRoles: paletteOptions.roles, blueNoise: paletteOptions.blueNoise, validateOnly: true });
        checked.add(binding);
      }
      check(config.terrainLookAsset);
      for (const entity of Object.values(entities)) {
        check(entity.lookAsset);
        check(entity.visual?.lookAsset);
      }
    }
    return { look, material, forEntity, validate };
  }

  function visual({makeBuilder,makeSculpt},view,query,{ controls } = {}) {
    const time = view.time ?? view.tick * view.world.dt;
    const timeline = sceneTimeline(view.world), frame = timeline?.sample(time);
    const { world: bound, values, dataInputs } = visualParameters(view.world, { time, query, controls });
    const edits = frame?.edits.filter(edit => edit.path[0] === 'visual');
    const world = edits?.length ? W.apply(bound, edits, { validate: false }).world : bound;
    if (world !== view.world) view = { ...view, world };
    const catalog = W.materials.catalog(world), config = visualEnvironment(world,catalog);
    const volume=config.volume&&query.renderVolume(config.volume);
    const enclosed=config.enclosedWater&&query.renderWater(config.enclosedWater);
    const region=W.fields.bounds(config.bounds ?? volume?.bounds ?? enclosed?.bounds ?? {min:[-5,-1,-5],max:[5,5,5]});
    const {min,max}=region, span=Math.max(max[0]-min[0],max[2]-min[2],1), resolution=config.resolution??Math.max(.08,span/100);
    W.data.check(Number.isFinite(resolution)&&resolution>=.02&&resolution<=10&&span/resolution<=256,'Render grid exceeds its sample budget');
    const B=makeBuilder(view.world.seed,config.palette??palette), S=K.sculpt(makeSculpt(B));
    const looks = visualLooks(view.world,catalog,config);
    const entities = view.world.entities, targets = new Map();
    function targetFor(id) {
      if (targets.has(id)) return targets.get(id);
      const entity = entities[id], prefabs = [];
      for (let current = id; current != null && Object.hasOwn(entities, current);) {
        const row = entities[current];
        if (row.kind === 'assembly' && row.prefab) prefabs.push(current);
        current = row.anchor?.entity ?? row.parent;
      }
      const target = { ...(id != null && { entity: id }), ...(entity?.visual?.surfaceId && { surface: entity.visual.surfaceId }),
        ...(entity?.tags?.length && { tags: entity.tags }), ...(prefabs.length && { prefabs }) };
      targets.set(id, target);
      return target;
    }
    if(looks.look?.pixel)S.pixel=true;
    S.captureAlbedo = Array.isArray(looks.look?.renderStages) &&
      looks.look.renderStages.some(rule => rule.stage === 'material');
    const mid=min.map((n,i)=>(n+max[i])/2);
    const fields=config.fields??{}, terrain=fields.bed, water=fields.water, wear=fields.wear, sediment=fields.sediment;
    const showRuts=wear&&terrain&&query.field(terrain)?.role==='rutted-bed';
    const ramps=new Map();
    function finishFor(base,profile) {
      if (!profile) return base;
      const {id,appearance}=profile;
      if (!appearance) return {...base,materialId:id};
      const dry=appearance.dry, wet=appearance.wet??dry, weight=wet===dry?0:Math.round(profile.wetness*32);
      const key=id+'/'+weight;
      if (!ramps.has(key)) {
        const rgb=swatch=>{
          const packed=parseInt(swatch.slice(1),16);
          return [(packed>>16)&255,(packed>>8)&255,packed&255];
        };
        ramps.set(key,dry.map((color,i)=>PixelLook.nearest(V.lerp(rgb(color),rgb(wet[i]),weight/32),B.P,true)));
      }
      return {...base,materialId:id,r:ramps.get(key)};
    }
    const earth=looks.material({r:[7,8,9,10,11],materialId:'terrain',surface:config.terrainSurface,rf(x,y,z,ny) {
      if (ny<.4) return [19,20,21,22];
      const changed=sediment&&query.probe(sediment,[x,y,z]);
      if(changed?.status==='ok'){
        if(changed.value>.025)return [20,21,22,23,24];
        if(changed.value<-.01)return [7,8,9];
      }
      const result=wear&&query.probe(wear,[x,y,z]);
      return result?.status==='ok'&&result.value>.18?[19,20,21,22,23]:null;
    }}, config.terrainLookAsset);
    if (fields.surface!==undefined) {
      const materialViews=new Map();
      earth.materialAt=(x,y,z)=>{
        const profile=W.materials.probe(query,fields.surface,[x,y,z]);
        if (!profile) return null;
        const key=profile.id+'/'+Math.round(profile.wetness*32);
        if (!materialViews.has(key)) {
          const sampled=finishFor(earth,profile);
          if (profile.appearance) {
            const worn=showRuts&&[1,2].map(shift=>sampled.r.map((_,i)=>sampled.r[Math.max(0,i-shift)]));
            sampled.rf=worn?(x,y,z)=>{
              const value=query.probe(wear,[x,y,z]).value;
              return value>=.42?worn[1]:value>=.15?worn[0]:null;
            }:undefined;
          }
          materialViews.set(key,sampled);
        }
        return materialViews.get(key);
      };
    }
    let hasSurface=Boolean(earth.surface);
    const heights=terrain&&new Map();
    const height=(x,z)=>{
      if(!heights)return config.ground??0;
      let column=heights.get(x);
      if(!column)heights.set(x,column=new Map());
      if(column.has(z))return column.get(z);
      const result=query.probe(terrain,[x,0,z]);
      const y=result.status==='ok'?result.value:config.ground??0;
      column.set(z,y);
      return y;
    };
    function groundDistance(x,y,z) {
      return Math.max(y-height(x,z), min[1]-y, min[0]-x, x-max[0], min[2]-z, z-max[2]);
    }
    if(!volume)S.implicitForm({bounds:{min,max},sd:groundDistance},earth,{res:resolution,target:{surface:'terrain'}});
    function drawBody(entry,surfaceAtlas) {
      if (!entry.half || !entry.position) return;
      const ramp=entry.look??[1,2,3,4,5,6];
      const rotation=entry.rotation??M.id();
      const axis=[0,1,2].map(i=>[rotation[i],rotation[i+3],rotation[i+6]]);
      const entityId=entry.entity??entry.id, visual=entities[entityId]?.visual;
      const physical=W.materials.forBody(catalog,view.world,entry);
      let finish=looks.material(finishFor({r:ramp,materialId:visual?.materialId??visual?.material??entry.material??'body'},physical),
        looks.forEntity(entityId));
      const sample=W.surfaceState.materialSampler(entry,surfaceAtlas,finish,B.P);
      const target=targetFor(entityId);
      if(sample)finish={...finish,materialAt:sample};
      hasSurface ||= Boolean(finish.surface);
      if(entry.collider||entry.bend){
        const {min,max}=W.colliders.geometry(entry);
        const bounds=W.fields.bounds({min:min.map(v=>v-resolution),max:max.map(v=>v+resolution)});
        S.implicitForm({bounds,sd:(x,y,z)=>W.colliders.distance(entry,[x,y,z],true)},finish,
          {res:resolution*.72,tag:entry.id,target:sample?{...target,surface:undefined}:target});
        return;
      }
      S.box(entry.position,entry.half,finish,{ax:axis,res:resolution*.72,
        rd:Math.min(.055,...entry.half)*.4,tag:entry.id,target:sample?{...target,surface:undefined}:target});
    }
    const bodyFields=Array.isArray(fields.bodies)?fields.bodies:fields.bodies?[fields.bodies]:[];
    for(const source of bodyFields) {
      const reading=query.probe(source);
      if(reading.status!=='ok')continue;
      const bodies=Object.values(reading.value);
      let surfaceAtlas;
      if(bodies.some(body=>body.surfaceState)){
        const field=query.field(source)?.name;
        if(field)surfaceAtlas=query.probe(field.slice(0,field.lastIndexOf('/'))+'/surface-charts').value;
      }
      for(const body of bodies)drawBody(body,surfaceAtlas);
    }
    const managed=view[W.entityLifecycle?.projection]?.entities;
    for (const [id,entity] of Object.entries(view.world.entities)) {
      if (!entity.visual?.half) continue;
      const pose=query.target({entity:id}), point=pose?.point;
      if (!point) continue;
      const {half,ramp,surface}=entity.visual;
      const physical=W.materials.forBody(catalog,view.world,{entity:id});
      const finish=looks.material(finishFor({r:ramp??[19,20,21,22,23],surface,albedo:entity.visual.albedo,
        materialId:entity.visual.materialId??entity.visual.material??'entity'},physical),looks.forEntity(id));
      hasSurface ||= Boolean(finish.surface);
      const rotation=managed&&Object.hasOwn(managed,id)?query.frame({entity:id})?.rotation:null;
      S.box(point,half,finish,{res:resolution*.72,tag:id,target:targetFor(id),
        ...(rotation&&{ax:[0,1,2].map(i=>[rotation[i],rotation[i+3],rotation[i+6]])})});
    }
    const agentFields=[fields.agents,fields.characters].filter(Boolean).flat();
    for (const field of agentFields) {
      const reading=query.probe(field);
      if (reading.status!=='ok') continue;
      for (const [id,agent] of Object.entries(reading.value)) {
        if (!agent.position || agent.mode==='dormant') continue;
        const r=agent.radius??.16, axis=agent.up??[0,1,0], face=agent.direction??[1,0,0];
        const p=agent.bodyCenter?V.mad(agent.position,axis,-agent.height*.5):agent.position;
        const binding=looks.forEntity(agent.entity??id);
        const body=looks.material({r:agent.look??[4,5,6,24],materialId:'agent'},binding);
        const head=looks.material({r:[19,20,23],materialId:'agent'},binding);
        hasSurface ||= Boolean(body.surface);
        const target=targetFor(agent.entity??id);
        if(agent.bodyCenter){
          const turn=W.gravity.basis(axis,face), ax=[0,1,2].map(i=>[turn[i],turn[i+3],turn[i+6]]);
          S.ball(V.mad(p,axis,agent.height*.40),[r*.85,agent.height*.34,r*.76],body,{ax,objectId:id,target,res:resolution*.64});
          S.ball(V.mad(V.mad(p,axis,agent.height-r*.56),face,r*.16),r*.66,head,{objectId:id,target,res:resolution*.64});
        }else{
          S.ball(V.add(p,[0,r*.7,0]),[r*1.27,r*.78,r*.76],body,{objectId:id,target,res:resolution*.64});
          S.ball(V.mad(V.add(p,[0,r,0]),face,r),r*.48,head,{objectId:id,target,res:resolution*.64});
        }
        const toes=looks.material({r:[19,20,21,22],materialId:'agent'},binding);
        for(const limb of agent.limbs??[]){
          const top=V.add(limb.point,[0,r*.42,0]);
          S.tube([limb.point,top],r*.18,r*.18,toes,{objectId:id,target,res:resolution*.6});
        }
      }
    }
    S.bake();
    const fabricFields=Array.isArray(fields.deformables)?fields.deformables:fields.deformables?[fields.deformables]:[];
    const sun=V.norm([-.55,.8,.45]);
    const linkFields=[fields.routedLinks,fields.pipes,fields.powerLines].filter(Boolean).flat();
    for(const field of linkFields){
      const read=query.probe(field);
      if(read.status!=='ok')continue;
      for(const {id,entity,material,radius,paths,look} of Object.values(read.value)){
        const first=B.count(), target=targetFor(entity), ramp=look??[19,20,21,22,23];
        for(const points of paths)for(let i=1;i<points.length;i++){
          const a=points[i-1], b=points[i], d=V.sub(b,a), length=V.len(d);
          if(length<1e-6)continue;
          const axis=V.mul(d,1/length), light=1-.65*Math.abs(V.dot(axis,sun));
          const color=B.P[ramp[Math.min(ramp.length-1,Math.floor(light*ramp.length))]]??B.P[1];
          const count=Math.min(256,Math.max(1,Math.ceil(length/Math.max(.18,radius*4))));
          for(let j=0;j<count;j++)B.stick(...V.lerp(a,b,(j+.5)/count),axis,length/count*.61,radius,color,2.7);
        }
        B.describeSplats?.(first,B.count(),{object:id,material,target});
      }
    }
    for(const field of fabricFields){
      const read=query.probe(field);
      if(read.status!=='ok')continue;
      for(const shape of Object.values(read.value)){
        const {id,entity,kind,points,strands,faces,style,radius,material,water:wet,surfaceState:coating}=shape;
        const first=B.count(), target=coating?{...targetFor(entity),surface:coating.chart}:targetFor(entity);
        const physical=W.materials.forBody(catalog,view.world,{entity});
        const finish=looks.material(finishFor({r:shape.look??[19,20,21,22],materialId:material},physical),looks.forEntity(entity));
        const ramp=finish.r;
        const state=K.procedural.surfaceState;
        const sampler=coating&&state.prepare(coating.stamps,coating);
        function shade(ramp,light) {
          return B.P[ramp[Math.min(ramp.length-1,Math.floor(light*ramp.length))]]??B.P[1];
        }
        function coated(uv,light,water=0) {
          const values=sampler.sample(uv);
          if(water>0)values.wetness=Math.max(Number(values.wetness)||0,K.clamp(water,0,1));
          return shade(state.ramp(ramp,B.P,values),light);
        }
        if(kind==='rope'||style==='net')for(const [,[a,b]] of strands){
          const p=points[a], q=points[b], d=V.sub(q,p), length=V.len(d);
          if(length<1e-6)continue;
          const axis=V.mul(d,1/length), light=1-.7*Math.abs(V.dot(axis,sun));
          const color=sampler?coated(coating.uvs[a].map((n,i)=>(n+coating.uvs[b][i])*.5),light):shade(ramp,light);
          B.stick(...V.lerp(p,q,.5),axis,length*.45,radius,color,2.5);
        }else faces.forEach((indices,index)=>{
          if(!indices)return;
          const [a,b,c]=indices.map(i=>points[i]), u=V.sub(b,a), v=V.sub(c,a), cross=V.cross(u,v), area=V.len(cross)*.5;
          if(area<1e-8)return;
          const n=V.norm(cross), cuts=Math.min(60,Math.max(1,Math.ceil(Math.sqrt(2*area)/resolution)));
          const light=.29+.69*Math.abs(V.dot(n,sun));
          const water=wet[index]/(.004*area);
          const color=sampler?null:shade(wet[index]>.004*area?[13,14,15,16,17]:ramp,light);
          const step=Math.sqrt(2*area)/cuts, thin=Math.min(radius,step*.3);
          const [uvA,uvB,uvC]=sampler?indices.map(i=>coating.uvs[i]):[];
          function dab(s,t) {
            const p=V.mad(V.mad(a,u,s),v,t);
            const mark=sampler?coated(uvA.map((n,i)=>K.clamp(n+s*(uvB[i]-n)+t*(uvC[i]-n),0,1)),light,water):color;
            B.disc(...p,n,step*.7,thin,mark,2.5);
          }
          for(let i=0;i<cuts;i++)for(let j=0;j<cuts-i;j++){
            dab((i+.33)/cuts,(j+.33)/cuts);
            if(i+j+1<cuts)dab((i+.67)/cuts,(j+.67)/cuts);
          }
        });
        B.describeSplats?.(first,B.count(),{object:id,material:finish.materialId,target});
      }
    }
    const waterTarget = TargetSelectors.medium(water, 'water');
    const nativeWater = water && (config.waterOptics || looks.look?.optics?.some(rule => TargetSelectors.matches(rule.select, waterTarget)));
    const waterBodies = K.procedural.waterBodies;
    const waterBounds={min:[min[0],min[2]],max:[max[0],max[2]]};
    const grid=nativeWater&&!volume?.water&&query.field(water)?.columnGrid;
    // Preserve solver shores when the viewport covers its full, GPU-sized grid.
    const aligned=grid&&grid.resolution.every(n=>n<=64)&&['min','max'].every(side=>
      grid.bounds[side].every((n,i)=>Math.abs(n-waterBounds[side][i])<1e-7));
    const surfaceWater = volume?.water ?? (nativeWater ? waterBodies.scene([waterBodies.create({
      id:water, bounds:aligned?grid.bounds:waterBounds, optics:config.waterOptics,
      resolution:aligned?grid.resolution:[0,2].map(axis=>Math.min(64,Math.ceil((max[axis]-min[axis])/resolution))),
      sample(x, z) {
        const read = query.probe(water, [x, 0, z]);
        if (read.status !== 'ok' || !(read.value?.depth > 0)) return null;
        const { surface, depth, velocity } = read.value;
        return { bed: surface - depth, surface, current: velocity };
      }
    })]) : undefined);
    const waterScene=waterBodies.combine(surfaceWater,enclosed?.water);
    if (water && !nativeWater && !volume?.water) {
      const first=B.count();
      const wobble=(x,z)=>((Math.sin(x*9.1+z*13.7)*43758.58)%1+1)%1;
      for (let z=min[2]+resolution/2; z<max[2]; z+=resolution) for (let x=min[0]+resolution/2; x<max[0]; x+=resolution) {
        const read=query.probe(water,[x,0,z]);
        if (read.status!=='ok' || !read.value || read.value.depth < .018) continue;
        const {surface,depth,velocity,concentration=0}=read.value, speed=Math.hypot(...velocity);
        const glow=wobble(x,z), tint=concentration>.14?21:concentration>.075?20:depth>.58?14:depth>.23?15:16;
        const color=tint+(glow<.28?1:0);
        B.disc(x,surface+.013,z,[0,1,0],resolution*.66,resolution*.16,B.P[color],1);
        if (speed>.12 && glow<.063) B.disc(x,surface+.032,z,[0,1,0],resolution*.4,resolution*.14,B.P[18],1);
      }
      B.describeSplats?.(first,B.count(),{material:'water',target:{medium:water,mediumKind:'water',surface:'water'}});
    }
    if(fields.ice){
      const first=B.count();
      for(let z=min[2]+resolution/2;z<max[2];z+=resolution)for(let x=min[0]+resolution/2;x<max[0];x+=resolution){
        const at=[x,0,z], ice=query.probe(fields.ice,at);
        if(ice.status!=='ok'||ice.value<.008)continue;
        const waterColumn=water&&query.probe(water,at).value;
        const top=fields.bed?height(x,z)+ice.value:waterColumn?.bed??height(x,z)+ice.value;
        const color=ice.value>.08?[167,219,232]:[112,174,193];
        B.disc(x,top+.01,z,[0,1,0],resolution*.7,resolution*.18,color,2);
      }
      B.describeSplats?.(first,B.count(),{material:'ice',target:{surface:'ice'}});
    }
    const surfaceEffects = (hasSurface || config.surfaceEffects || looks.look?.paletteConstraints || looks.look?.renderStages) &&
      { ...config.surfaceEffects, query };
    const airborne=config.air&&W.ventilation.render(query,config.air);
    const defaultCam={target:[mid[0],.05,mid[2]],dist:span*1.48,yaw:.62,pitch:.8};
    const rig = sceneCameraRig(world);
    const camera = !rig && frame?.edits.filter(edit => edit.path[0] === 'camera');
    const cam = camera?.length ? CameraLens.view({...defaultCam,...config.camera},
      Object.fromEntries(camera.map(({ path, value }) => [path[1], value]))) : config.camera ?? defaultCam;
    const contacts=fields.contactEffects&&query.probe(fields.contactEffects,cam.target).value;
    if(contacts?.particles.length){
      const colors=new Map();
      for(const row of contacts.particles){
        if(!colors.has(row.color)){
          const packed=parseInt(row.color.slice(1),16), rgb=[packed>>16,(packed>>8)&255,packed&255];
          colors.set(row.color,B.P[PixelLook.nearest(rgb,B.P,true)]);
        }
        const start=B.count();
        B.iso(...row.point,row.radius,colors.get(row.color),row.alpha,{nd:true});
        B.describeSplats?.(start,B.count(),{object:row.entity,material:'contact-spray',target:{surface:'contact-spray'}});
      }
    }
    const marks = K.dataMarks.prepare(config.dataMarks, { dataInputs })?.sample(time, { query });
    if (marks) K.dataMarks.stamp(B, marks);
    const fieldViews = config.fieldViews === undefined ? null :
      K.fieldViews.stampQuery(B,query,config.fieldViews,{bounds:region});
    const baked=B.finish({lookSnapshot: { time, tick: view.tick, query }, cam,
      ...(timeline && { timeline }),
      ...(values && { parameterValues: values }),
      ...(dataInputs && { dataInputs }),
      ...(fieldViews?.length && { fieldViews }),
      ...(contacts?.kick.some(Boolean)&&{anim:{kick:contacts.kick}}),
      radius:span,detail:30,dither:.22,look:looks.look,paletteRoles:config.paletteRoles,
      ...K.authoring.environments.rendererSettings(config),
      ...(config.environmentSource && {environmentSource:config.environmentSource}),
      ...(view.weatherTrackState && {weatherTrackState:view.weatherTrackState}),
      ...(waterScene && { water: waterScene }),
      ...(airborne?.length && {shapedAtmosphere:[...(config.shapedAtmosphere || []),...airborne]}),
      ...(config.reflections && { reflections: config.reflections }), ...(surfaceEffects&&{surfaceEffects})});
    const result=volume?SplatProvenance.join([...volume.parts,baked],baked):baked;
    if (marks) K.dataMarks.bind(result, marks);
    return rig ? K.cameraRig.bind(result, rig, { query }) : result;
  }
  W.visual = visual;
  W.sceneTimeline = sceneTimeline;
  W.visualEnvironment = visualEnvironment;
  W.validateLooks = (world, catalog) => {
    const { world: presentation, dataInputs } = visualParameters(world);
    visualLooks(presentation, catalog).validate();
    sceneCameraRig(presentation);
    K.dataMarks.prepare(presentation.visual?.dataMarks, { dataInputs });
    K.fieldViews.prepare(presentation.visual?.fieldViews);
    return presentation.visual;
  };
})(KIT);
