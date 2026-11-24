/* Bounded live solids. One ordered edit history drives collision, water and splats. */
(function (K) {
  const W=K.world, P=K.procedural, Q=W.query, V=K.V;
  const {check,record,vector,own,copy}=W.data, {bounds,clamp}=W.fields;
  const {freeze,hash}=P.data;
  const {contains,expand}=P.spatial;
  const finite=Number.isFinite, integer=Number.isSafeInteger;
  const sun=V.norm([.45,.8,.38]), neutral=[0x403747,0x776879,0xb4a598];
  const overlap=(a,b)=>a.min.every((value,i)=>value<=b.max[i]&&a.max[i]>=b.min[i]);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const rgb=value=>[(value>>16)&255,(value>>8)&255,value&255];

  // Compile scalar brush distances for the shadow march. Volume coordinates are bounded.
  function fastDistance({kind,at,half,round=0,radius,from,to}) {
    if(kind==='box'){
      const [x,y,z]=at,[a,b,c]=half;
      return (px,py,pz)=>{
        const dx=Math.abs(px-x)-a+round,dy=Math.abs(py-y)-b+round,dz=Math.abs(pz-z)-c+round;
        const m=Math.max(dx,dy,dz);
        if(m<=0)return m-round;
        const q=Math.max(0,dx),r=Math.max(0,dy),s=Math.max(0,dz);
        return Math.sqrt(q*q+r*r+s*s)-round;
      };
    }
    const [x,y,z]=at??from;
    const [a,b,c]=kind==='sphere'?[0,0,0]:V.sub(to,from);
    const square=a*a+b*b+c*c;
    return (px,py,pz)=>{
      const dx=px-x,dy=py-y,dz=pz-z;
      const t=square?clamp((dx*a+dy*b+dz*c)/square,0,1):0;
      const u=dx-a*t,v=dy-b*t,w=dz-c*t;
      return Math.sqrt(u*u+v*v+w*w)-radius;
    };
  }

  function brush(raw) {
    check(record(raw)&&['box','sphere','capsule'].includes(raw.kind),'Expected a box, sphere or capsule brush');
    const {kind,at,half,radius,round=0,from,to}=raw;
    if (kind==='box') {
      check(keys(raw,['kind','at','half','round'])&&vector(at)&&vector(half)&&half.every(v=>v>0)&&
        finite(round)&&round>=0&&round<=Math.min(...half),'Invalid box brush');
      return {sd:K.shape.box(at,half,round).sd,min:V.sub(at,half),max:V.add(at,half)};
    }
    check(finite(radius)&&radius>0,'Brush radius must be positive');
    if (kind==='sphere') {
      check(keys(raw,['kind','at','radius'])&&vector(at),'Invalid sphere brush');
      return {sd:K.shape.sphere(at,radius).sd,min:at.map(v=>v-radius),max:at.map(v=>v+radius)};
    }
    check(keys(raw,['kind','from','to','radius'])&&vector(from)&&vector(to),'Invalid capsule brush');
    return {sd:K.shape.capsule(from,to,radius).sd,min:from.map((v,i)=>Math.min(v,to[i])-radius),
      max:from.map((v,i)=>Math.max(v,to[i])+radius)};
  }

  function volumes(config,{id,catalog,world}) {
    const domain=bounds(config.bounds), {cell=.25,chunkCells=12,maxEdits=256}=config;
    check(finite(cell)&&cell>=.025&&cell<=10&&integer(chunkCells)&&chunkCells>=4&&chunkCells<=24&&
      integer(maxEdits)&&maxEdits>=1&&maxEdits<=512&&[...domain.min,...domain.max].every(v=>Math.abs(v)<=1e4),
    'Invalid volume lattice or edit budget');
    const aligned=value=>Math.abs(Math.round(value/cell)*cell-value)<=cell*1e-7;
    check([...domain.min,...domain.max].every(aligned),'Volume bounds must align to the cell lattice');
    const grid={min:domain.min.map(v=>Math.round(v/cell)),max:domain.max.map(v=>Math.round(v/cell))};
    const size=V.sub(grid.max,grid.min);
    check(size.every(v=>v>=2)&&size.reduce((a,b)=>a*b,1)<=300000,'Volume lattice exceeds its cell budget');
    const domainDistance=K.shape.box(V.lerp(domain.min,domain.max,.5),V.mul(V.sub(domain.max,domain.min),.5)).sd;
    const eps=cell*.002, chunks=[], tiles=[], ramps=new Map(), frames=new WeakMap(), compiled=new WeakMap(), samples=new WeakMap();
    const settings=config.materials??{}, known=new Set();
    check(record(settings)&&Object.keys(settings).length<=128,'Invalid inline volume material table');
    for(const [name,colors] of Object.entries(settings)){
      check(W.data.id(name)&&Array.isArray(colors)&&colors.length>=1&&colors.length<=16&&
        colors.every(value=>integer(value)&&value>=0&&value<=0xffffff),'Invalid volume material ramp '+name);
      known.add(name);
      ramps.set(name,colors.map(rgb));
    }
    function material(name) {
      if (known.has(name)) return;
      check(typeof name==='string','Volume fill or layer needs a material ID');
      const entry=W.materials.requireAsset(catalog,name), colors=entry.material.appearance?.dry;
      known.add(name);
      ramps.set(name,colors?.map(value=>rgb(parseInt(value.slice(1),16)))??neutral.map(rgb));
    }
    const lighting=config.lighting===undefined||config.lighting===false?null:
      P.relighting.create(config.lighting,{bounds:domain,cell});
    const litFrames=new WeakMap();
    let lastLit;
    function operation(op,args) {
      check(keys(args,op==='cut'?['shape']:['shape','material']),'Invalid volume '+op+' arguments');
      const shape=brush(args.shape);
      check([...shape.min,...shape.max].every(v=>finite(v)&&Math.abs(v)<=1e5)&&overlap(shape,domain),
        'Volume brush must intersect the editable bounds');
      if(op!=='cut') material(args.material);
      return {op,material:args.material,shape,...(lighting&&op!=='layer'&&{rayDistance:fastDistance(args.shape)})};
    }
    const authored=config.initial??[];
    check(Array.isArray(authored)&&authored.length<=256&&authored.every(row=>record(row)&&
      ['cut','fill','layer'].includes(row.op)),'Invalid initial volume operations');
    const initial=authored.map(({op,...args})=>operation(op,args));
    for(let z=grid.min[2];z<grid.max[2];z+=chunkCells)for(let x=grid.min[0];x<grid.max[0];x+=chunkCells){
      const xmax=Math.min(grid.max[0],x+chunkCells), zmax=Math.min(grid.max[2],z+chunkCells);
      tiles.push({id:x+'/'+z,resolution:[xmax-x,zmax-z],bounds:{
        min:[x*cell,domain.min[1],z*cell],max:[xmax*cell,domain.max[1],zmax*cell]}});
      for(let y=grid.min[1];y<grid.max[1];y+=chunkCells){
        const lo=[x,y,z],hi=[xmax,Math.min(grid.max[1],y+chunkCells),zmax];
        chunks.push({id:lo.join('/'),grid:{min:lo,max:hi},bounds:{min:lo.map(v=>v*cell),max:hi.map(v=>v*cell)}});
      }
    }
    check(chunks.length<=256&&tiles.length<=256,'Volume exceeds its chunk budget');
    const sources=config.sources??[];
    check(Array.isArray(sources)&&sources.length<=64&&new Set(sources.map(row=>row?.id)).size===sources.length&&
      sources.every(row=>keys(row,['id','point','level','current'])&&W.data.id(row.id)&&vector(row.point)&&
        contains(domain,row.point)&&row.point.every((v,i)=>v<domain.max[i])&&finite(row.level)&&
        row.point[1]<Math.fround(row.level)&&Math.abs(row.level)<=1e5&&
        (row.current===undefined||vector(row.current)&&row.current.every(v=>Math.abs(v)<=1e5))),
    'Invalid volume water sources');
    const band=cell*2, chunkIds=new Set(chunks.map(chunk=>chunk.id)), tileById=new Map(tiles.map(tile=>[tile.id,tile]));

    function evaluate(ops) {
      function distance(x,y,z) {
        let value=1e6;
        for(const {op,shape} of ops) {
          if(op==='fill') value=Math.min(value,shape.sd(x,y,z));
          if(op==='cut') value=Math.max(value,-shape.sd(x,y,z));
        }
        return Math.max(value,domainDistance(x,y,z));
      }
      function materialAt(point) {
        if (!contains(domain,point)) return null;
        let value=null;
        for(const {op,shape,material} of ops) {
          if (!contains(shape,point)||shape.sd(...point)>0) continue;
          if (op==='cut') value=null;
          else if (op==='fill') value??=material;
          else if (value!==null) value=material;
        }
        return value;
      }
      return {distance,materialAt};
    }
    function normal(distance,x,y,z) {
      return [distance(x+eps,y,z)-distance(x-eps,y,z),distance(x,y+eps,z)-distance(x,y-eps,z),
        distance(x,y,z+eps)-distance(x,y,z-eps)];
    }
    function bakeChunk(chunk,ops,retained) {
      const reachable=expand(chunk.bounds,band+cell*.4);
      const solid=evaluate(ops.filter(op=>overlap(op.shape,reachable)));
      let surface=samples.get(retained);
      if(!surface) {
        const field=(x,y,z)=>clamp(solid.distance(x,y,z),-band,band);
        const mesh=P.geometry.surfaceNets(field,chunk.bounds,{cell,latticeBounds:chunk.grid,topology:false,refine:1,
          normal:(x,y,z)=>normal(field,x,y,z)});
        surface={points:mesh.points,normals:mesh.normals,keys:mesh.active.map(row=>row.key)};
      }
      const builder=makeBuilder(hash(id+'/'+chunk.id,world.seed),undefined,{initialCapacity:Math.max(1,surface.points.length)});
      const splatIds=[], target={surface:id};
      for(const [i,point] of surface.points.entries()) {
        const n=surface.normals[i], inside=V.mad(point,n,-cell*.07);
        const label=solid.materialAt(inside)??solid.materialAt(V.mad(point,n,-cell*.35));
        const ramp=ramps.get(label);
        if(!ramp) continue;
        const shade=clamp((V.dot(n,sun)+.23)/1.23,0,1), first=builder.count();
        builder.disc(...point,n,cell*.61,cell*.115,ramp[Math.round(shade*(ramp.length-1))],1);
        builder.describeSplats(first,builder.count(),{material:label,target});
        builder.describeAlbedo?.(first,builder.count(),ramp.at(-1).map(v=>v/255));
        const address=surface.keys[i].split('/').map((value,axis)=>Number(value)+chunk.grid.min[axis]);
        splatIds.push(id+'/'+address.join('/'));
      }
      const {data,count,moving,back,renderMetadata,materialAlbedo}=builder.finish();
      const part=Object.freeze({data:data.slice(0,count*16),count,moving,back,renderMetadata,materialAlbedo,splatIds:freeze(splatIds)});
      samples.set(part,surface);
      return part;
    }
    function lightingField(solid,ops) {
      const span=cell*chunkCells, cap=span*.75, geometry=ops.filter(row=>row.op!=='layer');
      const [nx,ny,nz]=size.map(n=>Math.ceil(n/chunkCells)), cells=new Array(nx*ny*nz);
      function distance(x,y,z) {
        if(x<domain.min[0]||x>domain.max[0]||y<domain.min[1]||y>domain.max[1]||z<domain.min[2]||z>domain.max[2])
          return domainDistance(x,y,z);
        const i=Math.min(nx-1,Math.floor((x-domain.min[0])/span));
        const j=Math.min(ny-1,Math.floor((y-domain.min[1])/span));
        const k=Math.min(nz-1,Math.floor((z-domain.min[2])/span));
        const key=(k*ny+j)*nx+i;
        if(!cells[key]){
          const min=[i,j,k].map((v,axis)=>domain.min[axis]+v*span);
          const area=expand({min,max:min.map(v=>v+span)},cap);
          // A brush outside the expanded bin cannot change distances inside the capped band.
          const active=geometry.filter(row=>overlap(row.shape,area));
          cells[key]=(x,y,z)=>{
            let value=cap;
            for(const row of active){
              const d=row.rayDistance(x,y,z);
              value=row.op==='fill'?Math.min(value,d):Math.max(value,-d);
            }
            return value;
          };
        }
        return Math.min(cap,cells[key](x,y,z));
      }
      function albedo(x,y,z) {
        const color=ramps.get(solid.materialAt([x,y,z]))?.at(-1);
        return color&&(color[0]*65536+color[1]*256+color[2]);
      }
      return {distance,albedo,surfaceDistance:solid.distance};
    }
    function prepare(state,previous,edit) {
      if(frames.has(state.edits))return frames.get(state.edits);
      const ops=initial.concat(state.edits.map(row=>{
        if(!compiled.has(row))compiled.set(row,operation(row.op,row.args));
        return compiled.get(row);
      }));
      const solid=evaluate(ops), changed=edit&&edit.op!=='layer'?[edit.shape]:[];
      const area=edit&&expand(edit.shape,band+eps);
      const rebuilt=[], baked=new Map();
      for(const chunk of chunks){
        const prior=previous?.chunks.get(chunk.id);
        const splats=prior&&(!area||!overlap(area,chunk.bounds))?prior:bakeChunk(chunk,ops,edit?.op==='layer'?prior:undefined);
        if(splats!==prior)rebuilt.push(chunk.id);
        baked.set(chunk.id,splats);
      }
      const dry=!sources.length?null:previous&&edit?.op==='layer'?previous.dry:P.verticalSpans.bakeTiles({tiles,solid:solid.distance,
        previous:previous?.dry,dirtyBounds:previous?changed:undefined,step:cell*.5,refine:12});
      const flood=previous&&dry===previous.dry?previous.flood:dry?P.spanFlood.create({tiles:dry.tiles,sources,origin:[0,0],
        previous:previous?.flood}):null;
      const wetTiles=flood?.tiles??[];
      const water=previous&&flood===previous.flood?previous.render.water:flood?P.waterBodies.sceneFromSpans(wetTiles,
        {previous:previous?.render.water,optics:config.optics}):null;
      const render=Object.freeze({bounds:domain,water,parts:Object.freeze([...baked.values()])});
      const tilesAt=new Map(wetTiles.map((tile,i)=>[tiles[i].id,tile]));
      const frame=Object.freeze({...solid,chunks:baked,dry,flood,tilesAt,render,
        ...(lighting&&{lightingField:lightingField(solid,ops)}),
        work:freeze({splatChunks:rebuilt,reusedChunks:chunks.length-rebuilt.length,sampledChunks:edit?.op==='layer'?0:rebuilt.length,
          spanTiles:dry&&dry!==previous?.dry?dry.work.rebuilt:[],
          waterTiles:flood===previous?.flood?[]:flood?.work.changedTiles??[]})});
      frames.set(state.edits,frame);
      return frame;
    }
    function illuminated(state) {
      if(litFrames.has(state))return litFrames.get(state);
      const frame=prepare(state), previous=lastLit;
      let same=0;
      while(previous&&same<state.edits.length&&state.edits[same]===previous.state.edits[same])same++;
      const changes=previous?[...previous.state.edits.slice(same),...state.edits.slice(same)].map(row=>{
        const edit=compiled.get(row);
        return {bounds:edit.shape,occlusion:edit.op!=='layer'};
      }):[];
      const result=lighting.refresh({chunks:chunks.map(chunk=>({...chunk,part:frame.chunks.get(chunk.id)})),
        field:frame.lightingField,lamps:state.lamps,edits:changes,previous:previous?.result});
      const lit=Object.freeze({result,render:Object.freeze({...frame.render,parts:result.parts})});
      litFrames.set(state,lit);
      lastLit={state,result};
      return lit;
    }
    function lightAction(args, prior) {
      check(keys(args,['id','at','range','color','intensity','enabled'])&&W.data.id(args.id)&&
        own(lighting.initial,args.id),'Expected an authored point light ID');
      const {id,...patch}=args;
      check(Object.keys(patch).length,'Point light edit needs at least one setting');
      return P.relighting.lamp(patch,prior?.[id]??lighting.initial[id]);
    }
    function supports(frame,point,args) {
      const [x,y,z]=point, low=args.low??y-4, high=args.high??y+.5;
      check(finite(low)&&finite(high)&&low<=high,'Invalid volume support interval');
      if(x<domain.min[0]||x>domain.max[0]||z<domain.min[2]||z>domain.max[2]||high<domain.min[1]||low>domain.max[1])return [];
      const rows=[], min=Math.max(low,domain.min[1]), max=Math.min(high,domain.max[1]);
      const d=frame.distance;
      let a=Math.min(high+eps,max+eps), va=d(x,a,z);
      while(a>min-eps){
        const b=Math.max(min-eps,a-cell*.35), vb=d(x,b,z);
        if(va>=0&&vb<0){
          let upper=a, lower=b;
          for(let i=0;i<14;i++){
            const middle=(upper+lower)/2;
            if(d(x,middle,z)<0)lower=middle;
            else upper=middle;
          }
          const height=(upper+lower)/2, n=V.norm(normal(d,x,height,z));
          if(n[1]>.25&&height>=low-eps&&height<=high+eps)rows.push({id,y:height,normal:n,
            material:frame.materialAt(V.mad([x,height,z],n,-eps))??'solid'});
        }
        a=b;va=vb;
      }
      return rows;
    }
    function medium(frame,point) {
      if(frame.distance(...point)<0)return {kind:'solid',material:frame.materialAt(point)};
      const [x,y,z]=point;
      const tileStart=(v,i)=>grid.min[i]+Math.floor((v-grid.min[i]*cell)/(cell*chunkCells))*chunkCells;
      const row=frame.tilesAt.get(tileStart(x,0)+'/'+tileStart(z,2))?.at(x,y,z);
      return row?.kind==='water'?{kind:'water',id:row.id,depth:row.max-row.min,depthAtPoint:row.max-y,surface:row.max,
        bed:row.min,velocity:[row.current[0],row.current[2]],current:row.current}:{kind:'air'};
    }
    function navigationSource(field,state){
      if(!state||!['clearance','support','height','water','medium'].includes(field))return;
      const liquid=field==='water'||field==='medium';
      const key={edits:state.edits,wet:liquid?prepare(state).tilesAt:null};
      function area(row){
        if(row.op==='layer')return null;
        const {shape}=compiled.get(row)??operation(row.op,row.args);
        return {axes:'xyz',min:shape.min,max:shape.max};
      }
      return {key,changes:old=>{
        const changes=W.navigationTiles.appended(old.edits,key.edits,area);
        if(liquid)for(const tile of tiles)if(key.wet.get(tile.id)!==old.wet.get(tile.id))
          changes.push({...tile.bounds,axes:'xyz'});
        return changes;
      }};
    }
    const position=({state,target},read)=>state&&target.point?Q.ok(read(prepare(state),target.point)):Q.missing('state and XYZ point required');
    function action(op,state,args,ctx) {
      check(state.edits.length<maxEdits,'Volume edit budget exceeded');
      const edit=operation(op,args), row=freeze({op,args:copy(args)});
      compiled.set(row,edit);
      const previous=prepare(state);
      const next={...state,edits:Object.freeze([...state.edits,row])};
      const frame=prepare(next,previous,edit);
      next.work=frame.work;
      const area={min:edit.shape.min.map((n,i)=>Math.max(n,domain.min[i])),max:edit.shape.max.map((n,i)=>Math.min(n,domain.max[i]))};
      ctx.spatial?.write('material',area,'volume-'+op);
      if(op!=='layer') {
        for(const field of ['clearance','support','height'])ctx.spatial?.write(field,area,'volume-'+op);
        for(const name of frame.work.waterTiles){
          const tile=tileById.get(name);
          if(tile)for(const field of ['medium','water'])ctx.spatial?.write(field,tile.bounds,'volume-water-boundary');
        }
      }
      ctx.spatial?.rebuilt('volume-splats', {rebuilt:frame.work.splatChunks.length,reused:frame.work.reusedChunks,
        sampled:frame.work.sampledChunks},area);
      if(frame.work.spanTiles.length||frame.work.waterTiles.length)
        ctx.spatial?.rebuilt('volume-water',{spanTiles:frame.work.spanTiles.length,waterTiles:frame.work.waterTiles.length},area);
      ctx.emit('volume-'+op,{revision:next.edits.length,bounds:area,...(edit.material!==undefined&&{material:edit.material})});
      return freeze(next);
    }
    const actions=Object.fromEntries(['cut','fill','layer'].map(op=>[op,(state,args,ctx)=>action(op,state,args,ctx)]));
    if(lighting)actions['set-light']=(state,args,ctx)=>{
      const next=lightAction(args,state.lamps);
      ctx.emit('light-edited',{light:args.id,at:next.at});
      return freeze({...state,lamps:{...state.lamps,[args.id]:next}});
    };
    return {
      initial:()=>freeze({edits:[],work:null,...(lighting&&{lamps:lighting.initial})}),actions,
      checkAction(op,args){return op==='set-light'?lightAction(args):operation(op,args);},
      validateState(state) {
        check(record(state)&&Array.isArray(state.edits)&&state.edits.length<=maxEdits,'Invalid saved volume edits');
        for(const row of state.edits){
          check(record(row)&&own(actions,row.op),'Invalid saved volume operation');
          compiled.set(row,operation(row.op,row.args));
        }
        if(lighting){
          const lights=P.relighting.lamps(state.lamps);
          check(Object.keys(lights).length===Object.keys(lighting.initial).length&&
            Object.keys(lights).every(id=>own(lighting.initial,id))&&W.data.equal(lights,state.lamps),
          'Invalid saved volume lights');
        }
        const {work}=state, list=(ids,available)=>Array.isArray(ids)&&ids.length===new Set(ids).size&&ids.every(key=>available.has(key));
        check(state.edits.length===0?work===null:
          keys(work,['splatChunks','reusedChunks','sampledChunks','spanTiles','waterTiles'])&&list(work.splatChunks,chunkIds)&&
          work.sampledChunks===(state.edits.at(-1).op==='layer'?0:work.splatChunks.length)&&
          work.reusedChunks===chunks.length-work.splatChunks.length&&list(work.spanTiles,tileById)&&list(work.waterTiles,tileById),
        'Invalid saved volume work report');
      },
      dependencies:{reads:[id+'/clearance',id+'/material'],writes:['clearance','material','support','height','medium','water'].map(key=>id+'/'+key)},
      navigationSource,
      occupancyField:'clearance',
      volumeFrame:state=>state?(lighting?illuminated(state).render:prepare(state).render):null,
      fields:{
        ...(lighting&&{lighting:{type:'record',read:({state})=>state?
          Q.ok({lamps:state.lamps,...illuminated(state).result.work}):Q.missing('volume state required')}}),
        clearance:W.spatialFields.define({type:'number',units:'world'},({state,point,explain})=>
          state?{status:'ok',value:prepare(state).distance(...point),...(explain&&{source:{kind:'volume',revision:state.edits.length}})}:
            Q.missing('volume state required')),
        material:{type:'category',read:ctx=>position(ctx,(frame,point)=>frame.distance(...point)<=0?frame.materialAt(point):null)},
        support:{type:'records',units:'world',read:ctx=>position(ctx,(frame,point)=>supports(frame,point,ctx.args))},
        height:{type:'number',units:'world',read:ctx=>{
          if(!ctx.state||!ctx.target.point)return Q.missing('state and XYZ point required');
          const hit=supports(prepare(ctx.state),ctx.target.point,{low:domain.min[1],high:domain.max[1]})[0];
          return hit?Q.ok(hit.y):Q.missing('column has no solid support','empty');
        }},
        medium:{type:'record',read:ctx=>position(ctx,medium)},
        water:{type:'record',units:'world',read:ctx=>{
          if(!ctx.state||!ctx.target.point)return Q.missing('state and XYZ point required');
          const site=medium(prepare(ctx.state),ctx.target.point);
          return site.kind==='water'?Q.ok(site):Q.missing('point is not in water','dry');
        }},
        work:{type:'record',read:({state})=>state?Q.ok({revision:state.edits.length,lastEdit:state.work}):Q.missing('volume state required')}
      },
      traces:{segment:{run({state,target,args}) {
        check(state&&target.point&&vector(args.to),'Volume segment needs start and end points');
        const frame=prepare(state), length=V.dist(target.point,args.to), radius=args.radius??0;
        check(finite(radius)&&radius>=0&&finite(length)&&length/cell<=14000,'Invalid volume segment length or radius');
        let traveled=0;
        for(let i=0;i<16384;i++){
          const point=length?V.lerp(target.point,args.to,traveled/length):target.point;
          const clearance=frame.distance(...point);
          if(clearance<=radius+eps)return Q.ok({status:'blocked',point,clearance,material:frame.materialAt(point)});
          if(traveled===length)return Q.ok({status:'clear',point});
          traveled=Math.min(length,traveled+Math.max(eps,(clearance-radius)*.8));
        }
        return Q.ok({status:'budget',distance:traveled});
      }}}
    };
  }
  W.runtime.register('volume',volumes);
})(KIT);
