/* Live construction layouts publish fitted parts only after all hard checks pass. */
(function(K) {
  const W=K.world, P=K.procedural, Q=W.query, {V,M}=K;
  const {check,record,vector,id,own,equal}=W.data, {freeze}=P.data;
  const {orientedBox,boxContact}=P.contacts;
  const epsilon=1e-7, up=[0,1,0];
  const xyz=value=>vector(value)&&value.every(n=>Math.abs(n)<=1e6);
  const size=value=>Number.isFinite(value)&&value>=1e-5&&value<=1e4;
  const ramp=value=>Array.isArray(value)&&value.length>=1&&value.length<=16&&
    value.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=255);
  const layoutFrame=(tangent,normal,side)=>tangent.flatMap((x,i)=>[x,normal[i],side[i]]);
  const zeroes=values=>values.map(n=>n===0?0:n);

  function construction(config,{id:system,catalog}) {
    check(config.initiallyBuilt===undefined||typeof config.initiallyBuilt==='boolean','Invalid construction activation setting');
    const planned=config.initiallyBuilt===false, empty=freeze({});
    const bodiesOf=state=>state?.built===false?empty:state?.layout.bodies??empty;
    const solver=P.construct.constraints.compile(config.points??{},config.constraints??[]);
    const blocks=config.blocks??[], spans=config.spans??[];
    check(Array.isArray(blocks)&&Array.isArray(spans)&&blocks.length+spans.length<=256,'Construction needs bounded part lists');
    const names=new Set(), published=new Set();
    function part(row,fields) {
      check(record(row)&&id(row.id)&&id(system+'.'+row.id)&&!names.has(row.id)&&
        Object.keys(row).every(key=>fields.includes(key)||['id','material','look','materialAsset','materialWetness','entity'].includes(key))&&
        (row.material===undefined||TargetSelectors.name(row.material))&&(row.look===undefined||ramp(row.look)),
      'Invalid or duplicate construction part '+row?.id);
      const entity=row.entity??system+'.'+row.id;
      check(id(entity)&&!published.has(entity),'Invalid or duplicate construction entity '+entity);
      W.materials.validateEntity(catalog,row);
      names.add(row.id);
      published.add(entity);
    }
    for(const row of blocks){
      part(row,['at','offset','half','yaw']);
      check(solver.has(row.at)&&xyz(row.offset??[0,0,0])&&vector(row.half)&&row.half.every(size)&&
        Number.isFinite(row.yaw??0),'Invalid construction block '+row.id);
    }
    for(const row of spans){
      part(row,['a','b','width','depth','rise','lateral']);
      check(solver.has(row.a)&&solver.has(row.b)&&row.a!==row.b&&size(row.width)&&size(row.depth)&&
        [row.rise??0,row.lateral??0].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e4),'Invalid construction span '+row.id);
    }

    function fit(pins) {
      const solution=solver.solve(pins);
      if(solution.status!=='ok')return solution;
      const {sockets,points}=solution, bodies={}, collider=new Map(), members=[];
      function add(spec,position,half,rotation) {
        const body={id:spec.id,entity:spec.entity??system+'.'+spec.id,position:zeroes(position),half,rotation:zeroes(rotation),
          material:spec.material??'construction',look:spec.look??[1,2,3,4,5],
          ...(spec.materialAsset!==undefined&&{materialAsset:spec.materialAsset}),
          ...(spec.materialWetness!==undefined&&{materialWetness:spec.materialWetness})};
        bodies[spec.id]=body;
        collider.set(body.id,orientedBox(position,half,rotation));
      }
      for(const row of blocks)add(row,V.add(sockets[row.at],row.offset??[0,0,0]),row.half,M.rot(up,row.yaw??0));
      const issues=[];
      for(const row of spans){
        const a=sockets[row.a], b=sockets[row.b], length=V.dist(a,b);
        if(length<=epsilon){
          issues.push({part:row.id,reason:'collapsed-span',endpoints:[row.a,row.b]});
          continue;
        }
        const middle=P.routes.polyline([a,b]).sample(.5), side=V.mul(middle.side,-1);
        const position=V.mad(V.mad(middle.point,middle.normal,row.rise??0),side,row.lateral??0);
        add(row,position,[length*.5,row.depth*.5,row.width*.5],layoutFrame(middle.tangent,middle.normal,side));
        members.push({id:row.id,from:row.a,to:row.b,length});
      }
      const openings=[];
      for(const passage of solver.passages){
        const {constraint,width,height}=passage, a=sockets[passage.a], b=sockets[passage.b];
        const length=Math.hypot(b[0]-a[0],b[2]-a[2]);
        const measurement={constraint,from:a,to:b,width,height};
        if(length<=epsilon*2||Math.abs(a[1]-b[1])>epsilon){
          issues.push({...measurement,reason:length<=epsilon*2?'collapsed-passage':'passage-not-level'});
          continue;
        }
        const tangent=V.norm([b[0]-a[0],0,b[2]-a[2]]), mid=V.mad(V.lerp(a,b,.5),up,height*.5);
        const corridor=orientedBox(mid,[length*.5-epsilon,height*.5-epsilon,width*.5-epsilon],
          layoutFrame(tangent,up,V.cross(tangent,up)));
        const blockers=[...collider].filter(([,box])=>boxContact(corridor,box)).map(([id])=>id);
        if(blockers.length)issues.push({...measurement,reason:'opening-obstructed',blockers});
        openings.push({...measurement,clear:!blockers.length,blockers});
      }
      if(issues.length)return freeze({status:'blocked',issues,points,sockets,members,openings});
      const bounds=P.spatial.boxOf([...Object.values(points),...[...collider.values()].flatMap(box=>[box.bounds.min,box.bounds.max])]);
      return freeze({status:'ok',points,sockets,members,openings,bodies,bounds});
    }
    const initial=fit({});
    check(initial.status==='ok','Initial construction '+system+' cannot fit '+JSON.stringify(initial.status==='conflict'?initial.conflicts:initial.issues));

    function pinsOf(args) {
      check(record(args)&&Object.keys(args).every(key=>key==='pins'),'A construction refit accepts a pins table');
      const pins=args.pins===undefined?{}:args.pins;
      solver.checkPins(pins);
      return pins;
    }
    function refit(state,args,ctx) {
      const pins={...state.pins,...pinsOf(args)}, proposed=fit(pins);
      if(proposed.status!=='ok'){
        ctx.emit('construction-rejected',{status:proposed.status,pins,
          ...(proposed.conflicts?{conflicts:proposed.conflicts}:{issues:proposed.issues})});
        return freeze({...state,rejected:{pins,result:proposed}});
      }
      if(!equal(state.layout,proposed)){
        const area=P.spatial.boxOf([state.layout.bounds.min,state.layout.bounds.max,proposed.bounds.min,proposed.bounds.max]);
        ctx.spatial?.write('layout',area,'construction-refit');
        if(state.built!==false&&!equal(state.layout.bodies,proposed.bodies)){
          for(const key of ['bodies','support','clearance'])ctx.spatial?.write(key,area,'construction-refit');
          ctx.spatial?.rebuilt('construction-parts',{parts:Object.keys(proposed.bodies).length},area);
        }
      }
      ctx.emit('construction-refit',{members:proposed.members,openings:proposed.openings});
      return freeze({...state,pins,layout:proposed,rejected:null});
    }
    function build(state,args,batch,ctx){
      if(state.built)return {reason:'already-built'};
      const bodies=Object.values(state.layout.bodies);
      const identity=M.rot(up,0);
      const occupied=bodies.some(body=>ctx.query.anyAgent(body.position,V.len(body.half)+12,({position,height,radius})=>{
        const low=height>radius*2+epsilon?0:-radius;
        const collider={kind:'capsule',a:[0,low+radius,0],b:[0,low+height-radius,0],radius};
        const hit=W.colliders.contact(body,{position,rotation:identity,collider});
        return hit&&hit.gap<-epsilon;
      }));
      if(occupied)return {reason:'footprint-occupied'};
      for(const field of ['layout','bodies','support','clearance'])
        ctx.spatial?.write(field,state.layout.bounds,'construction-built');
      ctx.emit('construction-built',{bounds:state.layout.bounds,parts:bodies.length});
      return {state:{...state,built:true}};
    }
    function support({state,target,args}) {
      if(!state||!target.point)return Q.missing('construction state and point required');
      const [x,y,z]=target.point, high=args.high??y+.5, low=args.low??y-4;
      check(Number.isFinite(low)&&Number.isFinite(high)&&low<=high,'Invalid construction support interval');
      return Q.ok(Object.values(bodiesOf(state)).flatMap(body=>{
        const hit=W.mechanics.column(body,x,z,low,high);
        return hit&&hit.normal[1]>.25?[hit]:[];
      }).sort((a,b)=>b.y-a.y||a.id.localeCompare(b.id)));
    }
    return {
      navigationSource(field,state){
        if(state&&['clearance','support'].includes(field)){
          const key=bodiesOf(state);
          return {key,changes:old=>W.mechanics.changedBounds(old,key)};
        }
      },
      initial:()=>freeze({pins:{},layout:initial,rejected:null,...(planned&&{built:false})}),
      ...(planned&&{workEffects:{build:{
        check(args){check(record(args)&&!Object.keys(args).length,'A build effect accepts no arguments');},run:build
      }}}),
      actions:{refit},checkAction(type,args){if(type==='refit')pinsOf(args);},
      validateState(state){
        check(record(state)&&record(state.layout)&&own(state,'rejected')&&
          (planned?typeof state.built==='boolean':state.built===undefined),'Invalid saved construction state');
        solver.checkPins(state.pins);
        check(state.layout.status==='ok'&&equal(state.layout,fit(state.pins)),'Invalid saved construction layout');
        if(state.rejected!==null){
          const entry=state.rejected;
          check(record(entry)&&record(entry.result)&&['conflict','blocked'].includes(entry.result.status),
            'Invalid saved construction attempt');
          solver.checkPins(entry.pins);
          check(equal(entry.result,fit(entry.pins)),'Invalid saved construction conflict');
        }
      },
      dependencies:{reads:[system+'/layout'],writes:['layout','bodies','support','clearance'].map(key=>system+'/'+key)},
      *poseEntities(state){for(const body of Object.values(bodiesOf(state)))yield body.entity;},
      pose(state,entity){return Object.values(bodiesOf(state)).find(body=>body.entity===entity)??null;},
      traces:{ray:{role:'occlusion-ray',qualified:true,run:({state,target,args})=>
        W.mechanics.raycast(bodiesOf(state),target,args)}},
      fields:{
        layout:{type:'record',read:({state})=>state?Q.ok(state.layout):Q.missing('construction state required')},
        fit:{type:'record',read:({state,args})=>{
          if(!state)return Q.missing('construction state required');
          if(args.pins===undefined)return Q.ok(state.rejected?{...state.rejected.result,pins:state.rejected.pins}:
            {...state.layout,pins:state.pins});
          const pins={...state.pins,...pinsOf(args)};
          return Q.ok({...fit(pins),pins});
        }},
        ...(planned&&{built:{type:'boolean',qualified:true,read:({state})=>Q.ok(state.built)}}),
        bodies:{type:'record',read:({state})=>state?Q.ok(bodiesOf(state)):Q.missing('construction state required')},
        support:{type:'records',units:'world',read:support},
        clearance:{type:'number',units:'world',read({state,target,args}) {
          if(!state||!target.point)return Q.missing('construction state and point required');
          let nearest=Infinity, owner;
          for(const body of Object.values(bodiesOf(state))){
            if([body.id,body.entity].includes(args.exclude))continue;
            const d=W.mechanics.distance(body,target.point);
            if(d<nearest){nearest=d;owner=body.id;}
          }
          return owner?{status:'ok',value:nearest,body:owner}:Q.missing('no construction parts','empty');
        }}
      }
    };
  }
  W.runtime.register('construction',construction);
})(KIT);
