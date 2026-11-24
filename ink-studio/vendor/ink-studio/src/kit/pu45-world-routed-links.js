/* Checkpointed flexible routes and their typed carriers. */
(function(K){
  const W=K.world, Q=W.query, {V,M}=K, {record,own,id,check,vector,portOf}=W.data;
  const G=W.linkGeometry, zero=[0,0,0], down=[0,-1,0], epsilon=1e-8;
  const positive=n=>Number.isFinite(n)&&n>0&&n<=1e7;
  const nonnegative=n=>n===0||positive(n);
  const point=p=>vector(p)&&p.every(n=>Math.abs(n)<=1e7);
  const keys=(obj,list)=>record(obj)&&Object.keys(obj).every(key=>list.includes(key));
  const signals={bool:false,number:0,vec3:zero,record:{},event:[]};

  function checkAnchor(anchor){
    check(point(anchor)||keys(anchor,['entity','socket','offset'])&&id(anchor.entity)&&
      (anchor.socket===undefined||id(anchor.socket))&&(anchor.offset===undefined||point(anchor.offset)),
    'A routed link needs a point or entity socket');
  }
  function guideList(guides){
    check(Array.isArray(guides)&&guides.length<=24,'A routed link accepts up to 24 guides per side');
    guides.forEach(checkAnchor);
  }
  function binding({from,to,guides=[],returnGuides}){
    checkAnchor(from);checkAnchor(to);guideList(guides);
    if(returnGuides!==undefined){
      guideList(returnGuides);
      check(returnGuides.length>0,'A closed route needs at least one return guide');
    }
    return {from,to,guides,...(returnGuides&&{returnGuides})};
  }
  function anchors({from,to,guides,returnGuides}){
    return [from,...guides,to,...(returnGuides?[...returnGuides,from]:[])];
  }
  function checkSockets(route,world){
    for(const anchor of anchors(route))if(anchor.socket!==undefined)
      check(own(world.entities[anchor.entity]?.sockets,anchor.socket),'Unknown routed socket '+anchor.entity+'/'+anchor.socket);
  }
  function resolve(query,anchor){
    if(point(anchor))return anchor;
    const frame=query.frame(anchor);
    return frame?V.add(frame.point,frame.rotation?M.app(frame.rotation,anchor.offset??zero):anchor.offset??zero):null;
  }
  function carrier(raw,world){
    if(raw===undefined)return {kind:'none'};
    check(record(raw),'Invalid routed carrier');
    if(raw.kind==='signal'){
      check(keys(raw,['kind','type','idle'])&&own(signals,raw.type),'Invalid routed signal type');
      const idle=raw.idle??signals[raw.type];
      check(raw.type!=='event'||Array.isArray(idle)&&idle.length===0,'A routed event signal needs an empty idle value');
      return {...raw,idle};
    }
    if(raw.kind==='drive'){
      check(keys(raw,['kind','ratio','capacity','engageTension'])&&positive(Math.abs(raw.ratio??1))&&
        (raw.capacity===undefined||positive(raw.capacity))&&nonnegative(raw.engageTension??0),'Invalid routed drive');
      return {kind:'drive',ratio:raw.ratio??1,capacity:raw.capacity??null,engageTension:raw.engageTension??0};
    }
    check(raw.kind==='transfer'&&keys(raw,['kind','from','to','rate','amount','mode'])&&
      own(raw,'rate')!==own(raw,'amount')&&(raw.rate===undefined||Number.isFinite(raw.rate)||
      vector(raw.rate,2)||vector(raw.rate,3)),'A routed transfer needs a numeric rate or amount');
    return {...raw,from:portOf(world,raw.from),to:portOf(world,raw.to)};
  }
  function request(carry,key,dt){
    const {from,to,rate,amount,mode='partial'}=carry;
    return {from,to,mode,id:key,amount:rate===undefined?amount:Array.isArray(rate)?rate.map(n=>n*dt):rate*dt};
  }

  function routedLinks(config,{world,id:system}){
    const {links,gravity=down}=config;
    const every=world.systems[system].schedule?.every??1;
    check(record(links)&&Object.keys(links).length>0&&Object.keys(links).length<=128&&
      point(gravity)&&V.len(gravity)>epsilon,'Invalid routed link table or sag direction');
    const specs={}, inputs={}, outputs={}, initial={}, transfers=[];
    for(const key of Object.keys(links).sort()){
      const raw=links[key];
      check(id(key)&&key.length<=80&&keys(raw,['from','to','guides','returnGuides','length','slack','stiffness','breakTension',
        'breakStrain','enabled','carry','radius','look','material','entity'])&&id(raw.entity??key)&&
        id(raw.material??'cable')&&(raw.length===undefined||positive(raw.length))&&
        (raw.slack===undefined||raw.length===undefined&&nonnegative(raw.slack))&&
        nonnegative(raw.stiffness??100)&&(raw.breakTension===undefined||positive(raw.breakTension))&&
        (raw.breakStrain===undefined||positive(raw.breakStrain))&&
        (raw.enabled===undefined||typeof raw.enabled==='boolean')&&positive(raw.radius??.035)&&
        (raw.look===undefined||Array.isArray(raw.look)&&raw.look.length>0&&raw.look.length<=32&&
          raw.look.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=255)),'Invalid routed link '+key);
      const route=binding(raw), carry=carrier(raw.carry,world);
      checkSockets(route,world);
      const enabled=raw.enabled??true;
      specs[key]={...raw,carry,entity:raw.entity??key,radius:raw.radius??.035,material:raw.material??'cable'};
      initial[key]={route,length:raw.length??null,enabled,broken:null,status:null};
      inputs['enable.'+key]={type:'bool',default:enabled};
      outputs['active.'+key]='bool';
      outputs['tension.'+key]='number';
      if(carry.kind==='signal'){
        inputs['in.'+key]={type:carry.type,default:carry.idle};
        outputs['out.'+key]=inputs['in.'+key];
      }
      if(carry.kind==='drive'){
        inputs['speed.'+key]=inputs['load.'+key]='number';
        outputs['speed-out.'+key]=outputs['load-out.'+key]='number';
        outputs['slipping.'+key]='bool';
      }
      if(carry.kind==='transfer')transfers.push(key);
    }

    function assess(query,state,spec,enabled){
      const pins=anchors(state.route), points=pins.map(anchor=>resolve(query,anchor));
      const missing=points.findIndex(p=>!p);
      if(missing>=0)return {pins,points,missing,active:false,status:state.broken?'broken':'unresolved',tension:0,
        length:state.length,distance:null,slack:null,strain:null};
      const {spans,distance}=G.measure(points), length=state.length??(distance+(spec.slack??0)),
        extension=Math.max(0,distance-length), strain=length>epsilon?extension/length:0,
        tension=state.broken?0:extension*(spec.stiffness??100);
      const reason=!state.broken&&(strain>(spec.breakStrain??Infinity)?'strain':
        tension>(spec.breakTension??Infinity)?'tension':null);
      const active=!state.broken&&!reason&&enabled;
      const status=state.broken?'broken':reason?'over-limit':!enabled?'disabled':extension>epsilon?'taut':'slack';
      return {pins,points,spans,distance,length,slack:Math.max(0,length-distance),strain,tension,reason,active,status};
    }
    function breakAt(sample,reason,ctx,{segment,fraction=.5}={}){
      const {spans}=sample;
      if(segment===undefined)segment=spans.indexOf(Math.max(...spans));
      check(segment<spans.length&&spans[segment]>epsilon,'A cut needs a nonzero routed segment');
      return {reason,tick:ctx.tick,segment,fraction,point:G.sampleSpan(sample,gravity,segment,fraction)};
    }
    function emitBreak(ctx,key,spec,sample,broken){
      const limit=broken.reason==='tension'?spec.breakTension:broken.reason==='strain'?spec.breakStrain:undefined;
      ctx.emit('routed-link-break',{link:key,entity:spec.entity,...broken,tension:sample.tension,strain:sample.strain,
        distance:sample.distance,length:sample.length,...(limit!==undefined&&{limit})});
    }
    function transport(key,spec,sample,input){
      const out={'active':sample.active,'tension':sample.tension}, {carry}=spec;
      if(carry.kind==='signal')out.out=sample.active?(input['in.'+key]??carry.idle):carry.idle;
      if(carry.kind==='drive'){
        const load=Math.max(0,input['load.'+key]??0), speed=input['speed.'+key]??0;
        const grip=sample.active&&sample.tension>=carry.engageTension;
        const fits=load<=(carry.capacity??Infinity);
        out.slipping=sample.active&&(!grip||!fits);
        out['speed-out']=grip&&fits?speed*carry.ratio:0;
        out['load-out']=grip?Math.min(load,carry.capacity??Infinity)*Math.abs(carry.ratio):0;
      }
      return out;
    }
    function step(state,ctx){
      const next={};
      for(const [key,spec] of Object.entries(specs)){
        const previous=state[key], enabled=ctx.input['enable.'+key];
        const sample=assess(ctx.query,previous,spec,enabled);
        let broken=previous.broken, status=sample.status;
        if(sample.reason){
          broken=breakAt(sample,sample.reason,ctx);
          emitBreak(ctx,key,spec,sample,broken);
          status='broken';
        }else if(status==='unresolved'&&previous.status!=='unresolved'){
          ctx.emit('routed-link-lost',{link:key,entity:spec.entity,anchor:sample.missing});
        }else if(previous.status==='unresolved'&&status!=='unresolved'&&!broken){
          ctx.emit('routed-link-restored',{link:key,entity:spec.entity});
        }
        const sent=transport(key,spec,broken?{...sample,tension:0}:sample,ctx.input);
        next[key]={...previous,length:sample.length===0?null:sample.length,enabled,broken,status,sent};
      }
      return next;
    }
    function output(state,ctx){
      const ports={};
      for(const [key,spec] of Object.entries(specs)){
        const saved=state[key], sent=saved.sent??transport(key,spec,assess(ctx.query,saved,spec,saved.enabled),{});
        for(const [pin,value] of Object.entries(sent))ports[pin+'.'+key]=value;
      }
      return ports;
    }

    function readLink(query,state,key,receipt){
      const spec=specs[key], saved=state[key], sample=assess(query,saved,spec,saved.enabled);
      const {points,spans,distance,length,slack,strain,tension,status,active,reason,missing}=sample;
      const paths=spans?G.paths(points,spans,distance,length,gravity,saved.broken,spec.radius):[];
      return {id:key,entity:spec.entity,material:spec.material,radius:spec.radius,...(spec.look&&{look:spec.look}),
        route:saved.route,status,active,length,distance,slack,strain,tension,points,paths,broken:saved.broken,
        ...(spans?{spanLengths:spans}:{missing}),...(reason&&{reason}),
        carry:spec.carry,...(saved.sent&&{lastPublished:saved.sent}),...(receipt&&{transfer:receipt})};
    }
    function linkKey(target,args){return args.link??target?.entity;}
    function read({query,state,target,args}){
      const transfer=query.probe('world/transfers').value.receipts, receipts=new Map();
      for(const row of transfer)if(row.requester===system&&row.requestId)receipts.set(row.requestId,row);
      const key=linkKey(target,args);
      if(key!==undefined)return own(specs,key)?Q.ok(readLink(query,state,key,receipts.get(key))):Q.missing('unknown routed link','missing');
      return Q.ok(Object.fromEntries(Object.keys(specs).map(key=>[key,readLink(query,state,key,receipts.get(key))])));
    }
    function reactions({query,state}){
      const loads=[];
      for(const [key,spec] of Object.entries(specs)){
        const saved=state[key], sample=assess(query,saved,spec,true);
        if(!sample.active||sample.tension<=epsilon)continue;
        const {pins,points,spans,tension}=sample, closed=saved.route.returnGuides!==undefined;
        const directions=spans.map((length,i)=>length>epsilon?V.mul(V.sub(points[i+1],points[i]),1/length):zero);
        for(let i=0;i<pins.length-Number(closed);i++){
          const {entity}=pins[i];
          if(!entity)continue;
          const before=directions[i-1]??(closed?directions.at(-1):zero), after=directions[i]??zero;
          const force=V.mul(V.sub(after,before),tension);
          if(V.len(force)>epsilon)loads.push({link:key,entity,point:points[i],force});
        }
      }
      return Q.ok(loads);
    }
    function checkAction(kind,args){
      check(own(specs,args.link),'Unknown routed link '+args.link);
      if(kind==='cut'){
        check(keys(args,['link','segment','fraction'])&&
          (args.segment===undefined||Number.isSafeInteger(args.segment)&&args.segment>=0&&args.segment<=49)&&
          Number.isFinite(args.fraction??.5)&&(args.fraction??.5)>=0&&(args.fraction??.5)<=1,'Invalid routed cut');
      }else if(kind==='repair'||kind==='pay-out'){
        check(keys(args,['link','length'])&&(kind==='repair'&&args.length===undefined||positive(args.length)),
          'Invalid installed routed length');
      }else{
        check(keys(args,['link','from','to','guides','returnGuides'])&&Object.keys(args).length>1,'Invalid routed edit');
        for(const anchor of [args.from,args.to])if(anchor!==undefined)checkAnchor(anchor);
        if(args.guides!==undefined)guideList(args.guides);
        if(args.returnGuides!==undefined&&args.returnGuides!==null){
          guideList(args.returnGuides);
          check(args.returnGuides.length>0,'A closed route needs at least one return guide');
        }
      }
    }
    const edit=(state,key,changes)=>({...state,[key]:{...state[key],...changes}});
    return {initial:()=>initial,settleInitial(state,{query}){
      return Object.fromEntries(Object.entries(state).map(([key,row])=>{
        const sample=assess(query,row,specs[key],row.enabled);
        return [key,{...row,length:sample.length||null}];
      }));
    },inputs,outputs,output,step,checkAction,validateState(state){
      check(record(state)&&Object.keys(state).length===Object.keys(specs).length,'Invalid routed checkpoint');
      for(const key of Object.keys(specs)){
        const row=state[key];
        check(record(row)&&(row.length===null||Number.isFinite(row.length)&&row.length>=0)&&typeof row.enabled==='boolean'&&
          [null,'broken','unresolved','disabled','taut','slack'].includes(row.status),'Invalid routed state for '+key);
        const route=binding(row.route);
        if(row.broken!==null)check(record(row.broken)&&['cut','strain','tension'].includes(row.broken.reason)&&
          Number.isSafeInteger(row.broken.tick)&&row.broken.tick>=0&&Number.isSafeInteger(row.broken.segment)&&
          row.broken.segment>=0&&row.broken.segment<anchors(route).length-1&&vector(row.broken.point)&&
          Number.isFinite(row.broken.fraction)&&row.broken.fraction>=0&&row.broken.fraction<=1,'Invalid routed break');
      }
    },...(transfers.length>0&&{
      checkTransfers(validate){for(const key of transfers)validate(request(specs[key].carry,key,world.dt*every),true);},
      requestTransfers(state,ctx){
        if(!ctx.simulationLOD&&ctx.tick%every)return [];
        return transfers.flatMap(key=>{
          if(!assess(ctx.query,state[key],specs[key],ctx.input['enable.'+key]).active)return [];
          const order=request(specs[key].carry,key,ctx.simulationLOD?ctx.dt:ctx.dt*every);
          return (Array.isArray(order.amount)?order.amount.some(Boolean):order.amount!==0)?[order]:[];
        });
      }
    }),actions:{
      cut(state,{link:key,...args},ctx){
        const spec=specs[key], previous=state[key], sample=assess(ctx.query,previous,spec,previous.enabled);
        check(!previous.broken&&sample.spans,'A cut needs a connected, unbroken route');
        const broken=breakAt(sample,'cut',ctx,args);
        emitBreak(ctx,key,spec,sample,broken);
        return edit(state,key,{broken,length:sample.length,status:'broken'});
      },repair(state,{link:key,length},ctx){
        check(state[key].broken,'Repair needs a broken routed link');
        ctx.emit('routed-link-repair',{link:key,entity:specs[key].entity});
        return edit(state,key,{broken:null,length:length??state[key].length,status:null});
      },'pay-out'(state,{link:key,length},ctx){
        ctx.emit('routed-link-length',{link:key,entity:specs[key].entity,length});
        return edit(state,key,{length});
      },reroute(state,{link:key,...args},ctx){
        check(!state[key].broken,'Repair a broken link before rerouting it');
        const changes={...state[key].route,...args};
        if(changes.returnGuides===null)delete changes.returnGuides;
        const route=binding(changes);
        checkSockets(route,ctx.world);
        ctx.emit('routed-link-reroute',{link:key,entity:specs[key].entity});
        return edit(state,key,{route});
      }
    },fields:{
      links:{type:'record',role:'routed-links',selector:true,read},
      reactions:{type:'records',role:'routed-reactions',read:reactions}
    },traces:{route:{selector:true,run(context){
      return linkKey(context.target,context.args)===undefined?Q.missing('routed link required'):read(context);
    }}}};
  }
  W.runtime.register('routed-links',routedLinks);
})(KIT);
