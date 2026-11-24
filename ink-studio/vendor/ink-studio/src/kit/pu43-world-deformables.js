/* Checkpointed cloth and rope using the stage's XPBD solver. */
(function(K) {
  const W=K.world, Q=W.query, {V,M}=K, {check,record,id,own,vector}=W.data, {clamp}=W.fields;
  const S=K.procedural.surfaceState;
  const zero=[0,0,0], gravityDefault=[0,-9.81,0], freeze=K.procedural.data.freeze;
  const finite=(n,min=0,max=1e6)=>Number.isFinite(n)&&n>=min&&n<=max;
  const xyz=p=>vector(p)&&p.every(n=>Math.abs(n)<=1e7);
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const vec=(p,i)=>p.slice(i*3,i*3+3);
  const mean=points=>V.mul(points.reduce(V.add),1/points.length);
  const intact=(indices,broken)=>indices.every(i=>!broken[i]);
  function writeBounds(ctx,points,padding,reason,fields=['support','surfaces']) {
    if(!ctx.spatial)return;
    const area={min:zero.map((_,axis)=>Math.min(...points.map(p=>p[axis]))-padding),
      max:zero.map((_,axis)=>Math.max(...points.map(p=>p[axis]))+padding)};
    for(const field of fields)ctx.spatial.write(field,area,reason);
  }
  function segmentDistance(point,a,b) {
    const d=V.sub(b,a), length=V.dot(d,d);
    return V.dist(point,length?V.mad(a,d,clamp(V.dot(V.sub(point,a),d)/length,0,1)):a);
  }

  function topology(spec) {
    const {kind,tear=0,bend=kind==='cloth'?2e-3:0}=spec;
    check(['cloth','rope'].includes(kind)&&(tear===0||finite(tear,1.0001,100))&&finite(bend)&&
      finite(spec.stretch??1e-6)&&finite(spec.shear??1e-5),'Invalid deformable kind or constraint');
    if(kind==='rope'){
      const {points}=spec;
      check(Array.isArray(points)&&integer(points.length,2,96)&&points.every(xyz)&&
        points.slice(1).every((p,i)=>V.dist(p,points[i])>=.001),'A rope needs bounded, distinct consecutive points');
      return {points,links:K.xpbd.ropeLinks(points.length,spec.stretch??0,tear,bend,true),faces:[]};
    }
    const {at,u,v,nu=13,nv=9}=spec;
    check([at,u,v].every(xyz)&&V.len(V.cross(u,v))>=.001&&integer(nu,2,25)&&integer(nv,2,25),
      'A cloth needs nonparallel edges and a bounded grid');
    const grid=K.xpbd.clothGrid({...spec,nu,nv,tear,bend}), {points,links,faces,horizontal:h,vertical:vLinks}=grid;
    for(const link of links){
      const {a,b}=link;
      if(link.kind==='bend')link.guards=b-a===2?[h[a],h[a+1]]:[vLinks[a],vLinks[a+nu]];
      if(link.kind==='shear'){
        const corner=b-a===nu+1?a:a-1;
        link.guards=[h[corner],vLinks[corner],h[corner+nu],vLinks[corner+1]];
      }
    }
    return {points,links,faces:faces.map(({nodes,diagonal})=>({nodes,guards:[...links[diagonal].guards,diagonal]})),
      uvs:points.map((_,i)=>[i%nu/(nu-1),Math.floor(i/nu)/(nv-1)]), size:[V.len(u),V.len(v)]};
  }

  function attachment(raw,shape) {
    check(record(raw)&&integer(raw.node,0,shape.points.length-1)&&Object.keys(raw).every(key=>
      ['node','point','entity','socket','offset'].includes(key)), 'Invalid deformable attachment');
    check(raw.point!==undefined ? xyz(raw.point)&&raw.entity===undefined&&raw.socket===undefined&&raw.offset===undefined :
      id(raw.entity)&&(raw.socket===undefined||id(raw.socket))&&(raw.offset===undefined||xyz(raw.offset)),
    'An attachment needs a fixed point or an entity socket');
    return raw;
  }
  function worldPoint(query,anchor) {
    if(anchor.point)return anchor.point;
    const target={entity:anchor.entity,...(anchor.socket&&{socket:anchor.socket})};
    const pose=query.frame(target);
    return pose&&V.add(pose.point,pose.rotation?M.app(pose.rotation,anchor.offset??zero):anchor.offset??zero);
  }
  function sample(query,field,point) {
    if(!field)return undefined;
    const read=query.probe(field,point);
    return read.status==='ok'?read.value:undefined;
  }
  function projector(ctx,config,touch) {
    const {bed,clearance,ground=0,friction=.2}=config;
    const read=point=>clearance&&ctx.query.probe(clearance,point);
    function contact(read){return read?.status==='ok'&&Number.isFinite(read.value)?read.value:Infinity;}
    return (point,previous,radius)=>{
      const floor=sample(ctx.query,bed,point)??ground;
      if(point[1]<floor+radius){
        point=[point[0]+(previous[0]-point[0])*friction,floor+radius,point[2]+(previous[2]-point[2])*friction];
        touch('ground',[point[0],floor,point[2]]);
      }
      if(!clearance)return point;
      let hit=read(point), depth=radius-contact(hit);
      if(depth<=0){
        const change=V.sub(point,previous), distance=V.len(change);
        let travelled=0;
        for(let step=0;step<18&&travelled<distance;step++){
          const along=V.mad(previous,change,travelled/distance), probe=read(along), gap=contact(probe)-radius;
          if(gap<=0){
            if(travelled===0)break;
            point=along;hit=probe;depth=-gap;break;
          }
          travelled+=Math.max(1e-5,gap*.8);
        }
      }
      if(depth<0)return point;
      const shift=point.map((_,axis)=>{
        const a=point.slice(),b=point.slice();
        a[axis]+=.005;b[axis]-=.005;
        const positive=contact(read(a)),negative=contact(read(b));
        return Number.isFinite(positive-negative)?positive-negative:0;
      });
      const normal=V.norm(shift,V.norm(V.sub(previous,point),[0,1,0])), motion=V.sub(point,previous);
      const tangent=V.mad(motion,normal,-V.dot(motion,normal));
      touch(hit?.body??clearance,V.mad(point,normal,-radius));
      return V.mad(V.mad(point,normal,depth),tangent,-friction);
    };
  }

  function deformables(config,{id:system}) {
    const {shapes,ground=0,gravity=gravityDefault,damping=.9,friction=.2,substeps=8,trafficDuration=.15}=config;
    const sources=config.supports??[], specs={};
    const definitions=S.channels(config.surfaceChannels);
    check(record(shapes)&&integer(Object.keys(shapes).length,1,24)&&finite(ground,-1e7,1e7)&&xyz(gravity)&&
      finite(damping,0,100)&&finite(friction,0,1)&&integer(substeps,1,64)&&finite(trafficDuration,0,10)&&
      ['bed','clearance','wind','rain'].every(key=>config[key]===undefined||typeof config[key]==='string')&&
      Array.isArray(sources)&&sources.length<=16&&sources.every(field=>typeof field==='string'),
    'Invalid deformable world settings');
    let count=0;
    for(const [key,raw] of Object.entries(shapes)){
      check(id(key)&&record(raw)&&id(raw.entity??key)&&id(raw.material??raw.kind)&&
        finite(raw.mass??1,.001,1e6)&&finite(raw.radius??.04,.001,10)&&finite(raw.air??1,0,100)&&
        (raw.support===undefined||typeof raw.support==='boolean')&&
        (raw.style===undefined||raw.kind==='cloth'&&['sheet','net'].includes(raw.style))&&
        (raw.look===undefined||Array.isArray(raw.look)&&integer(raw.look.length,1,32)&&raw.look.every(i=>integer(i,0,255))),
      'Invalid deformable '+key);
      const mesh=topology(raw), anchors=raw.attachments??{}, water=raw.water;
      const coating=raw.surfaceState;
      if(coating!==undefined){
        check(raw.kind==='cloth'&&record(coating)&&Object.keys(coating).every(key=>['chart','stamps'].includes(key))&&
          (coating.chart===undefined||TargetSelectors.name(coating.chart)),'Invalid cloth surface state on '+key);
        S.prepare(coating.stamps,{size:mesh.size,definitions});
      }
      count+=mesh.points.length;
      check(record(anchors)&&Object.keys(anchors).every(id)&&Object.keys(anchors).length<=mesh.points.length&&
        new Set(Object.values(anchors).map(row=>attachment(row,mesh).node)).size===Object.keys(anchors).length,
      'Duplicate or invalid attachments on '+key);
      check(water===undefined||raw.kind==='cloth'&&record(water)&&raw.style!=='net'&&
        finite(water.capacity,.001,1e4)&&finite(water.rain??0)&&finite(water.drain??0,0,100)&&finite(water.density??1000,.001),
      'Invalid rain collector for '+key);
      specs[key]={...raw,...mesh,attachments:anchors,id:key,entity:raw.entity??key,material:raw.material??raw.kind,
        ...(raw.kind==='cloth'&&{chart:coating?.chart??system+'/'+key+'/sheet'}),
        support:raw.support!==false,radius:raw.radius??.04,mass:(raw.mass??1)/mesh.points.length};
    }
    check(count<=2048,'Deformable point budget exceeded');

    const surfaceCache=new WeakMap(), stampsCache=new WeakMap(), empty=freeze([]);
    function stampSampler(spec,stamps) {
      let samplers=stampsCache.get(stamps);
      if(!samplers)stampsCache.set(stamps,samplers=new Map());
      if(!samplers.has(spec.id))samplers.set(spec.id,S.prepare(stamps,{size:spec.size,definitions}));
      return samplers.get(spec.id);
    }
    function surfaces(state) {
      if(surfaceCache.has(state))return surfaceCache.get(state);
      const result=Object.fromEntries(Object.entries(specs).map(([key,spec])=>{
        const {positions,broken,water,surfaceStamps}=state.shapes[key], {id,entity,material,kind,support,radius,look,style}=spec;
        const points=spec.points.map((_,i)=>vec(positions,i));
        const faces=spec.faces.map(face=>intact(face.guards,broken)?face.nodes:null);
        const strands=spec.links.flatMap(({kind,a,b},i)=>kind==='stretch'&&!broken[i]?[[i,[a,b]]]:[]);
        const surfaceState=(spec.surfaceState||surfaceStamps)&&{
          chart:spec.chart,uvs:spec.uvs,size:spec.size,stamps:surfaceStamps??spec.surfaceState?.stamps??empty,definitions};
        return [key,{id,entity,material,kind,support,radius,points,faces,strands,water,
          ...(look&&{look}),...(style&&{style}),...(surfaceState&&{surfaceState})}];
      }));
      freeze(result);
      surfaceCache.set(state,result);
      return result;
    }
    function supports({query,state,target,args}) {
      if(!target.point)return Q.missing('point required');
      const [x,y,z]=target.point, low=args.low??y-4, high=args.high??y+.5;
      check(Number.isFinite(low)&&Number.isFinite(high)&&low<=high,'Invalid deformable support interval');
      const hits=W.fabricContact.columns(surfaces(state),x,z,low,high,args.exclude);
      if(sources.length){
        for(const field of sources){
          const read=query.probe(field,target,args);
          if(read.status==='ok')hits.push(...read.value);
        }
      }else{
        const y=sample(query,config.bed,target.point)??ground;
        if(y>=low&&y<=high)hits.push({id:'ground',material:'ground',y,normal:[0,1,0]});
      }
      return Q.ok(hits.sort((a,b)=>b.y-a.y||a.id.localeCompare(b.id)));
    }

    function step(state,ctx) {
      const shapes={}, oldSurfaces=surfaces(state), loads=Object.fromEntries(Object.keys(specs).map(key=>[key,[]]));
      for(const load of ctx.input.loads){
        if(load?.system!==undefined&&load.system!==system)continue;
        check(record(load)&&own(specs,load.shape)&&xyz(load.impulse),'Invalid deformable load event');
        const spec=specs[load.shape];
        if(load.node!==undefined){
          check(integer(load.node,0,spec.points.length-1),'Unknown deformable load point');
          loads[load.shape].push({...load,nodes:[load.node],weights:[1]});
        }else{
          const face=integer(load.face,0,spec.faces.length-1)&&spec.faces[load.face];
          check(face&&vector(load.weights)&&load.weights.every(n=>finite(n,0,1))&&
            Math.abs(load.weights.reduce((sum,n)=>sum+n,0)-1)<1e-6,'Invalid deformable surface load');
          if(oldSurfaces[load.shape].faces[load.face])loads[load.shape].push({...load,nodes:face.nodes});
        }
      }
      for(const event of ctx.input.traffic){
        if(!record(event)||!own(specs,event.support))continue;
        check(xyz(event.point)&&finite(event.weight,0),'Invalid deformable traffic load');
        const [x,y,z]=event.point;
        const seat=W.fabricContact.columns(oldSurfaces,x,z,y-.35,y+.35).filter(hit=>hit.id===event.support)
          .sort((a,b)=>Math.abs(a.y-y)-Math.abs(b.y-y))[0];
        if(seat)loads[seat.shape].push({...seat,impulse:V.mul(gravity,event.weight*trafficDuration),traffic:true});
      }
      for(const [key,spec] of Object.entries(specs)){
        const old=state.shapes[key], surface=oldSurfaces[key], wet=spec.water, water=old.water.slice(),
          balance={...old.balance}, masses=spec.points.map(()=>spec.mass), impulses=spec.points.map(()=>zero),
          contacts=new Map(), anchors={...old.attachments}, runoff=[];
        const touch=(source,point)=>{
          if(!contacts.has(source))contacts.set(source,{source,point});
        };
        for(const load of [...old.pending.map(load=>({...load,nodes:[load.node],weights:[1]})),...loads[key]]){
          load.nodes.forEach((node,i)=>{impulses[node]=V.mad(impulses[node],load.impulse,load.weights[i]);});
          if(load.body&&xyz(load.point))touch(load.body,load.point);
        }
        function discharge(face,amount,kind,points) {
          if(amount<=0)return;
          balance[kind==='drain'?'drained':'spilled']+=amount;
          runoff.push({face,kind,volume:amount,point:mean(spec.faces[face].nodes.map(i=>points[i]))});
        }
        if(wet)spec.faces.forEach(({nodes},face)=>{
          if(!surface.faces[face]){
            discharge(face,water[face],'tear',surface.points);water[face]=0;return;
          }
          const [a,b,c]=nodes.map(i=>surface.points[i]);
          const area=Math.abs(V.cross(V.sub(b,a),V.sub(c,a))[1])*.5, center=mean([a,b,c]);
          const rate=wet.rain??0, field=sample(ctx.query,config.rain,center);
          const incoming=area*(rate+(Number.isFinite(field)?Math.max(0,field):0))*ctx.dt;
          const total=water[face]+incoming, kept=Math.min(total,area*wet.capacity);
          const drained=kept*(1-Math.exp(-(wet.drain??0)*ctx.dt));
          check(Number.isFinite(total),'Rain collection overflow');
          balance.captured+=incoming;
          discharge(face,total-kept,'overflow',surface.points);
          discharge(face,drained,'drain',surface.points);
          water[face]=kept-drained;
          for(const node of nodes)masses[node]+=water[face]*(wet.density??1000)/3;
        });
        const acceleration=impulses.map((impulse,i)=>impulse===zero?null:V.mul(impulse,1/(masses[i]*ctx.dt)));
        const project=projector(ctx,config,touch);
        const sim=K.xpbd.sim({gravity,damp:damping,substeps:Math.min(128,Math.max(substeps,Math.ceil(ctx.dt*120))),
          fixedStep:true,substepPins:true,acceleration:i=>acceleration[i],
          ...(config.wind&&{wind:(...p)=>sample(ctx.query,config.wind,p.slice(0,3))??zero}),
          project:(_i,point,previous,radius)=>project(point,previous,radius),
          onTear(link,ratio){ctx.emit('deformable-tear',{shape:key,entity:spec.entity,link,ratio});}});
        for(let i=0;i<spec.points.length;i++)sim.point(spec.points[i],1/masses[i],spec.radius);
        for(const {a,b,compliance,ratio,guards} of spec.links)sim.link(a,b,compliance,ratio,guards);
        for(const {nodes,guards} of spec.faces)sim.face(...nodes,spec.air??1,guards);
        sim.restoreMotion(old);
        for(const [name,anchor] of Object.entries(anchors)){
          const point=worldPoint(ctx.query,anchor);
          if(!point){
            delete anchors[name];
            ctx.emit('deformable-detach',{shape:key,entity:spec.entity,attachment:name,node:anchor.node,point:surface.points[anchor.node],reason:'target-lost'});
            continue;
          }
          const start=surface.points[anchor.node];
          sim.pin(anchor.node,time=>V.lerp(start,point,clamp(1+(time-ctx.time)/ctx.dt,0,1)));
        }
        sim.step(ctx.dt,ctx.time);
        const motion=sim.motion();
        let points;
        const positions=()=>points??=spec.points.map((_,i)=>vec(motion.positions,i));
        if(wet)spec.faces.forEach(({guards},face)=>{
          if(water[face]&& !intact(guards,motion.broken)){
            discharge(face,water[face],'tear',positions());water[face]=0;
          }
        });
        if(ctx.spatial&&(motion.broken.some((cut,i)=>cut!==old.broken[i])||
          motion.positions.some((value,i)=>Math.abs(value-old.positions[i])>.05))){
          writeBounds(ctx,surface.points.concat(positions()),spec.radius,'deformable-motion');
        }
        for(const {source,point} of contacts.values())if(!old.contacts.some(row=>row.source===source))
          ctx.emit('deformable-contact',{shape:key,entity:spec.entity,contact:source,point});
        const impulse=impulses.reduce(V.add,zero);
        shapes[key]={...old,...motion,attachments:anchors,pending:[],water,balance,runoff,
          contacts:[...contacts.values()],load:{impulse,traffic:loads[key].filter(load=>load.traffic).length}};
      }
      return {shapes};
    }

    function checkAction(type,args) {
      check(own(specs,args.shape),'Unknown deformable '+args.shape);
      const spec=specs[args.shape];
      if(type==='attach'){
        const {shape,attachment:name,...anchor}=args;
        check(id(name),'Invalid attachment name');attachment(anchor,spec);
      }else if(type==='detach')check(id(args.attachment),'Invalid attachment name');
      else if(type==='load')check(integer(args.node,0,spec.points.length-1)&&xyz(args.impulse),'Invalid deformable impulse');
      else if(type==='surface-stamp'){
        check(spec.kind==='cloth'&&record(args.stamp)&&!own(args.stamp,'window'),'Cloth stamps need a shape and a rest UV brush');
        S.prepare([args.stamp],{size:spec.size,definitions});
      }
      else check(xyz(args.point)&&finite(args.radius,.001,1e4),'A cut needs a point and radius');
    }
    function update(state,key,changes){return {shapes:{...state.shapes,[key]:{...state.shapes[key],...changes}}};}
    const fieldList=[config.bed,config.clearance,config.wind,config.rain,...sources].filter(Boolean);
    return {inputs:{loads:'event',traffic:'event'},dependencies:{reads:fieldList,writes:['support','surfaces']},checkFields(query){
      for(const [key,type] of [['bed','number'],['clearance','number'],['wind','vec3'],['rain','number']])if(config[key])
        check(query.field(config[key])?.type===type,'Invalid deformable '+key+' field '+config[key]);
      for(const field of sources)check(query.field(field)?.type==='records'&&query.field(field).name!==system+'/support',
        'Invalid accompanying support field '+field);
    },initial({query}){
      return {shapes:Object.fromEntries(Object.entries(specs).map(([key,spec])=>{
        const positions=spec.points.map(p=>p.slice());
        for(const anchor of Object.values(spec.attachments))positions[anchor.node]=worldPoint(query,anchor)??positions[anchor.node];
        return [key,{positions:Array.from(Float32Array.from(positions.flat())),velocities:Array(spec.points.length*3).fill(0),
          broken:spec.links.map(()=>false),water:spec.faces.map(()=>0),balance:{captured:0,drained:0,spilled:0},
          attachments:spec.attachments,pending:[],contacts:[],runoff:[],load:{impulse:zero,traffic:0}}];
      }))};
    },step,checkAction,validateState(state){
      check(record(state?.shapes)&&Object.keys(state.shapes).length===Object.keys(specs).length,'Invalid deformable checkpoint');
      for(const [key,spec] of Object.entries(specs)){
        const row=state.shapes[key];
        check(record(row)&&vector(row.positions,spec.points.length*3)&&vector(row.velocities,spec.points.length*3)&&
          Array.isArray(row.broken)&&row.broken.length===spec.links.length&&row.broken.every(flag=>typeof flag==='boolean')&&
          vector(row.water,spec.faces.length)&&row.water.every(n=>n>=0)&&record(row.balance)&&
          ['captured','drained','spilled'].every(name=>finite(row.balance[name],0,Number.MAX_VALUE))&&
          record(row.attachments)&&Object.keys(row.attachments).every(id)&&new Set(Object.values(row.attachments)
            .map(anchor=>attachment(anchor,spec).node)).size===Object.keys(row.attachments).length&&
          Array.isArray(row.pending)&&row.pending.length<=1024&&row.pending.every(load=>record(load)&&
            integer(load.node,0,spec.points.length-1)&&xyz(load.impulse))&&Array.isArray(row.contacts)&&
          row.contacts.every(row=>record(row)&&typeof row.source==='string'&&vector(row.point))&&
          Array.isArray(row.runoff)&&record(row.load)&&vector(row.load.impulse)&&integer(row.load.traffic,0,10000),
        'Invalid deformable checkpoint for '+key);
        if(row.surfaceStamps!==undefined){
          check(spec.kind==='cloth'&&Array.isArray(row.surfaceStamps),'Invalid saved cloth surface state');
          stampSampler(spec,row.surfaceStamps);
        }
      }
    },actions:{
      attach(state,{shape:key,attachment:name,...anchor},ctx){
        const spec=specs[key], anchors=state.shapes[key].attachments;
        check(worldPoint(ctx.query,anchor)&&!own(anchors,name)&&!Object.values(anchors).some(a=>a.node===anchor.node),
          'Attachment target is missing or the node or name is already attached');
        ctx.emit('deformable-attach',{shape:key,entity:spec.entity,attachment:name,node:anchor.node});
        return update(state,key,{attachments:{...anchors,[name]:anchor}});
      },detach(state,{shape:key,attachment:name},ctx){
        const shape=state.shapes[key], anchors={...shape.attachments}, anchor=anchors[name];
        check(own(anchors,name),'Unknown deformable attachment '+name);
        delete anchors[name];
        ctx.emit('deformable-detach',{shape:key,entity:specs[key].entity,attachment:name,node:anchor.node,point:vec(shape.positions,anchor.node),reason:'command'});
        return update(state,key,{attachments:anchors});
      },load(state,{shape:key,node,impulse}){
        const pending=state.shapes[key].pending;
        check(pending.length<1024,'Deformable pending load budget exceeded');
        return update(state,key,{pending:[...pending,{node,impulse}]});
      },'surface-stamp'(state,{shape:key,stamp},ctx){
        const spec=specs[key], before=state.shapes[key].surfaceStamps??spec.surfaceState?.stamps??empty;
        const surfaceStamps=[...before,stamp];
        stampSampler(spec,surfaceStamps);
        if(ctx.spatial)writeBounds(ctx,spec.points.map((_,i)=>vec(state.shapes[key].positions,i)),
          spec.radius,'deformable-surface-stamp',['surfaces']);
        ctx.emit('surface-stamped',{shape:key,chart:spec.chart,channel:stamp.channel});
        return update(state,key,{surfaceStamps});
      },cut(state,{shape:key,point,radius},ctx){
        const spec=specs[key], {positions,broken}=state.shapes[key];
        const next=broken.map((cut,i)=>{
          const {kind,a,b}=spec.links[i];
          if(cut||kind!=='stretch'||segmentDistance(point,vec(positions,a),vec(positions,b))>radius)return cut;
          ctx.emit('deformable-tear',{shape:key,entity:spec.entity,link:i,reason:'cut'});
          return true;
        });
        if(next.some((cut,i)=>cut!==broken[i]))
          writeBounds(ctx,spec.points.map((_,i)=>vec(positions,i)),spec.radius,'deformable-cut');
        return update(state,key,{broken:next});
      }
    },fields:{
      surfaces:{type:'record',role:'deformable-surfaces',read:({state})=>Q.ok(surfaces(state))},
      'surface-state':{type:'record',read:({state,args})=>{
        const shape=own(specs,args.shape)&&specs[args.shape];
        if(!shape||shape.kind!=='cloth')return Q.missing('unknown cloth shape','missing');
        let uv=args.uv;
        if(args.face!==undefined){
          const face=surfaces(state)[shape.id].faces[args.face];
          if(!face)return Q.missing('removed or unknown cloth face','missing');
          uv=S.correspondence(face.map(node=>({chart:shape.chart,uv:shape.uvs[node]})),args.weights).uv;
        }
        check(S.isUv(uv),'Cloth surface-state needs rest UV or a live face and barycentric weights');
        const stamps=state.shapes[shape.id].surfaceStamps??shape.surfaceState?.stamps??empty;
        return Q.ok({chart:shape.chart,uv,values:stampSampler(shape,stamps).sample(uv)});
      }},
      support:{type:'records',units:'world',read:supports},
      motion:{type:'record',read:({state,args})=>args.shape===undefined?Q.ok(state.shapes):own(state.shapes,args.shape)?
        Q.ok(state.shapes[args.shape]):Q.missing('unknown deformable','missing')},
      water:{type:'record',read:({state})=>Q.ok(Object.fromEntries(Object.entries(specs).filter(([,spec])=>spec.water)
        .map(([key])=>{
          const {water,balance,runoff}=state.shapes[key], retained=water.reduce((sum,n)=>sum+n,0);
          return [key,{retained,...balance,error:balance.captured-balance.drained-balance.spilled-retained,runoff}];
        }))) }
    }};
  }
  W.runtime.register('deformables',deformables);
})(KIT);
