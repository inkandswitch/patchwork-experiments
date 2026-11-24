/* Optional ground wear and data-driven history built from world events. */
(function (K) {
  const W=K.world, Q=W.query, P=K.procedural, V=K.V;
  const {check,id,record,vector,own}=W.data, {bounds,zone,clamp}=W.fields;
  const historyKey='history';
  function generate(source,rules) {
    check(Array.isArray(rules)&&rules.length<=256,'Expected a bounded history rule list');
    const history=source.history??{};
    const initial=history.past??[];
    const events=[], identifiers=new Set(initial.map(event=>event.id)), changed=[];
    let world=source;
    for(const rule of rules){
      const {count=1,chance=1,start=-100,interval=1}=rule;
      check(record(rule)&&id(rule.id)&&Number.isSafeInteger(count)&&count>=0&&count<=1000&&
        Number.isFinite(chance)&&chance>=0&&chance<=1&&Number.isSafeInteger(start)&&start<0&&
        Number.isSafeInteger(interval)&&interval>=0&&start+Math.max(0,count-1)*interval<0&&
        record(rule.event)&&id(rule.event.kind)&&Array.isArray(rule.edits??[]),'Invalid history generation rule');
      for(let i=0;i<count;i++){
        const index=rule.id+'.'+i, roll=P.data.hash(index,source.seed)/4294967296;
        check(!identifiers.has(index),'Duplicate generated event '+index);
        identifiers.add(index);
        if(roll>=chance||!Q.condition(rule.when,world))continue;
        const bindings={index:i,id:index,tick:start+i*interval};
        function resolve(value,path){
          if(typeof value==='string')return value.replace(/\{(index|id|tick)\}/g,(_,k)=>String(bindings[k]));
          if(Array.isArray(value))return value.map((v,j)=>resolve(v,path+'/'+j));
          if(!record(value))return value;
          if(own(value,'$choose')){
            check(Object.keys(value).length===1&&Array.isArray(value.$choose)&&value.$choose.length>0,'A history choice needs options');
            const j=P.data.hash(index+path,source.seed)%value.$choose.length;
            return resolve(value.$choose[j],path+'/'+j);
          }
          return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,path+'/'+k)]));
        }
        const event={...resolve(rule.event,'event'),id:index,tick:bindings.tick,system:'world'};
        check(events.length<10000,'Generated history budget exceeded');
        const edits=resolve(rule.edits??[],'edits');
        const applied=W.apply(world,edits);
        world=applied.world;
        changed.push(...applied.paths);
        events.push(event);
      }
    }
    const sorted=[...initial,...events].sort((a,b)=>a.tick-b.tick||a.id.localeCompare(b.id));
    const result=W.apply(world,[{op:'set',path:[historyKey],value:{...world.history,past:sorted}}]);
    return {world:result.world,paths:[...changed,...result.paths],events};
  }
  function trail(source, name, trace, args = {}) {
    check(id(name)&&!own(source.entities,name)&&trace?.status==='ok'&&trace.points?.length>=2,
      'A new path needs an ID and a completed trail trace');
    check(Number.isFinite(args.width??.35)&&(args.width??.35)>0,'An editable path needs positive width');
    return W.apply(source,[{op:'set',path:['entities',name],value:{
      kind:'path',position:trace.points[0],points:trace.points,
      material:args.material??'earth',width:args.width??.35
    }}]);
  }
  function wear(config,{id:system}) {
    check(config.contactEvents===undefined || typeof config.contactEvents==='boolean','contactEvents must be boolean');
    const region=bounds(config.bounds), cell=config.cell??.25, recovery=config.recovery??.01, gain=config.gain??.12;
    const sources=config.sources??[], spread=config.spread??.18, maxRut=config.rutDepth??0;
    check(Number.isFinite(cell)&&cell>=.03&&Number.isFinite(recovery)&&recovery>=0&&Number.isFinite(gain)&&gain>=0&&
      Number.isFinite(spread)&&spread>=0&&spread<=1&&Array.isArray(sources)&&sources.length<=64&&sources.every(id)&&
      Number.isFinite(config.threshold??.1)&&(config.threshold??.1)>=0&&(config.threshold??.1)<=1,
      'Invalid wear settings');
    check(Number.isFinite(maxRut)&&maxRut>=0&&maxRut<=10&&Number.isFinite(config.ground??0)&&
      (config.bed===undefined||typeof config.bed==='string'),'Invalid rut bed settings');
    const keyFor=(x,z)=>Math.floor((x-region.min[0])/cell)+','+Math.floor((z-region.min[2])/cell);
    const entered=Object.keys(config.materials??{});
    check(entered.every(key=>Number.isFinite(config.materials[key])&&config.materials[key]>=0),'Invalid material wear');
    function amount(state,point) {
      return state.cells[keyFor(point[0],point[2])]?.value??0;
    }
    function at({state,target}){
      return target.point?Q.ok(amount(state,target.point)):Q.missing('point required');
    }
    function rut(state,point){
      const x=(point[0]-region.min[0])/cell-.5,z=(point[2]-region.min[2])/cell-.5;
      const cx=Math.floor(x),cz=Math.floor(z),fx=x-cx,fz=z-cz;
      const value=(x,z)=>state.cells[x+','+z]?.value??0;
      return maxRut*K.mix(K.mix(value(cx,cz),value(cx+1,cz),fx),K.mix(value(cx,cz+1),value(cx+1,cz+1),fx),fz);
    }
    function contact(state,items,ctx) {
      if(!items.length&&!Object.keys(state.cells).length)return state.cells;
      const cells={};
      const retain=Math.exp(-recovery*ctx.dt);
      let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
      function changed(point){
        x0=Math.min(x0,point[0]);z0=Math.min(z0,point[2]);x1=Math.max(x1,point[0]);z1=Math.max(z1,point[2]);
      }
      for(const [key,row] of Object.entries(state.cells)){
        const value=row.value*retain;
        if(value>.0001)cells[key]={point:row.point,value};
        if(maxRut&&(value!==row.value||!cells[key]))changed(row.point);
      }
      for(const raw of items){
        check(record(raw)&&vector(raw.point)&&Number.isFinite(raw.weight??1)&&(raw.weight??1)>=0,
          'Invalid ground contact');
        if(!zone(raw.point,region)||config.supports&&!config.supports.includes(raw.support))continue;
        const [x,y,z]=raw.point;
        const cx=Math.floor((x-region.min[0])/cell), cz=Math.floor((z-region.min[2])/cell);
        const weight=raw.weight??1, response=own(config.materials,raw.material)?config.materials[raw.material]:1;
        if(!weight||!response)continue;
        const radius=spread?1:0;
        for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
          const point=[region.min[0]+(cx+dx+.5)*cell,y,region.min[2]+(cz+dz+.5)*cell];
          if(!zone(point,region))continue;
          const key=(cx+dx)+','+(cz+dz), old=cells[key];
          const multiplier=dx||dz?spread/(Math.abs(dx)+Math.abs(dz)):1;
          const value=clamp((old?.value??0)+gain*weight*response*multiplier,0,1);
          cells[key]={point:old?.point??point,value};
          if(maxRut&&value!==(old?.value??0))changed(point);
        }
      }
      check(Object.keys(cells).length<=100000,'Wear cell budget exceeded');
      if(maxRut&&x0<=x1){
        const area={axes:'xz',min:[x0-cell,z0-cell],max:[x1+cell,z1+cell]};
        for(const field of ['rutDepth','ruttedBed'])ctx.spatial?.write(field,area,'contact-ruts');
      }
      return cells;
    }
    function trace({state,target,args,query}) {
      const from=target.point??args.from, to=args.to, threshold=args.threshold??config.threshold??.1;
      check(vector(from)&&vector(to)&&Number.isFinite(threshold)&&threshold>0&&threshold<=1,'Trail needs endpoints and a positive threshold');
      const candidates=Object.values(state.cells).filter(row=>row.value>=threshold);
      if(!candidates.length)return Q.ok({status:'no-trail',points:[]});
      function nearest(p){
        return candidates.reduce((best,item)=>V.dist(p,item.point)<V.dist(p,best.point)?item:best).point;
      }
      const a=nearest(from), b=nearest(to);
      if(V.dist(from,a)>cell*2||V.dist(to,b)>cell*2)return Q.ok({status:'off-trail',points:[]});
      if(V.dist(a,b)<1e-8)return Q.ok({status:'short',points:[a]});
      const height=(x,z)=>{
        const read=config.bed&&query.probe(config.bed,[x,0,z]);
        return read?.status==='ok'?read.value:state.cells[keyFor(x,z)]?.point[1]??a[1];
      };
      const result=P.routes.terrain(a,b,{bounds:region,height,cell,
        cost:(x,y,z)=>amount(state,[x,y,z])>=threshold?1-amount(state,[x,y,z]):Infinity,maxSlope:args.maxSlope??1.5,
        sampleStep:cell*.35,minClearance:0});
      return Q.ok({status:result.status,points:result.route?.points??[]});
    }
    const bedFields=maxRut?{
      rutDepth:{type:'number',units:'world',read:({state,target})=>target.point?Q.ok(rut(state,target.point)):Q.missing('point required')},
      ruttedBed:{type:'number',units:'world',role:'rutted-bed',read:({state,target,query})=>{
        if(!target.point)return Q.missing('point required');
        const base=config.bed?query.probe(config.bed,target):Q.ok(config.ground??0);
        return base.status==='ok'?Q.ok(base.value-rut(state,target.point)):base;
      }}
    }:{};
    return {navigationSource(field,state){
      if(!state||!(field==='wear'||field==='rutDepth'&&maxRut||field==='ruttedBed'&&maxRut&&!config.bed))return;
      const key=state.cells, reach=field==='wear'?cell/2:cell;
      return {key,changes:old=>{
        const areas=[];
        for(const name of new Set([...Object.keys(old),...Object.keys(key)])){
          if((old[name]?.value??0)===(key[name]?.value??0))continue;
          const [i,j]=name.split(',').map(Number);
          if(!Number.isSafeInteger(i)||!Number.isSafeInteger(j))continue;
          const x=region.min[0]+(i+.5)*cell,z=region.min[2]+(j+.5)*cell;
          areas.push({axes:'xz',min:[x-reach,z-reach],max:[x+reach,z+reach]});
        }
        return areas;
      }};
    },inputs:{enabled:{type:'bool',default:config.enabled??true},
        ...(config.contactEvents && {contacts:'event'})},initial:()=>({cells:{},pending:[],enabled:config.enabled??true}),
      ...(maxRut&&{dependencies:{writes:['rutDepth','ruttedBed'],reads:config.bed?[config.bed]:[]},
        checkFields(query){
          const base=config.bed&&query.field(config.bed);
          check(!config.bed||base?.type==='number'&&base.units==='world'&&
            base.name!==system+'/rutDepth'&&base.name!==system+'/ruttedBed', 'Rut bed needs a base height field in world units');
        }}),
      validateState(state){
        check(record(state?.cells)&&Array.isArray(state.pending)&&typeof state.enabled==='boolean'&&
          Object.keys(state.cells).length<=100000&&Object.values(state.cells).every(row=>vector(row.point)&&
            Number.isFinite(row.value)&&row.value>=0&&row.value<=1),'Invalid wear checkpoint');
      },
      actions:{contact(state,{contacts}){
        check(Array.isArray(contacts)&&state.pending.length+contacts.length<=10000,'Contact batch exceeds its budget');
        for(const raw of contacts)check(record(raw)&&vector(raw.point)&&Number.isFinite(raw.weight??1)&&(raw.weight??1)>=0,
          'Invalid ground contact');
        return {...state,pending:[...state.pending,...contacts]};
      },clear(state,args,ctx){
        if(maxRut&&Object.keys(state.cells).length){
          const area={axes:'xz',min:[region.min[0]-cell,region.min[2]-cell],max:[region.max[0]+cell,region.max[2]+cell]};
          for(const field of ['rutDepth','ruttedBed'])ctx.spatial?.write(field,area,'clear-contact-ruts');
        }
        return {...state,cells:{},pending:[]};
      }},
      step(state,ctx){
        const enabled=ctx.input.enabled;
        if(!enabled)return {...state,pending:[],enabled};
        const contacts=[...state.pending,...(ctx.input.contacts??[]),...sources.flatMap(name=>ctx.states[name]?.contacts??[])];
        return {cells:contact(state,contacts,ctx),pending:[],enabled};
      },
      fields:{wear:{type:'number',units:'fraction',read:at},
        wornCells:{type:'records',read:({state})=>Q.ok(state.cells)},...bedFields},
      traces:{trail:{run:trace}}
    };
  }
  W.runtime.register('wear',wear);
  W.history=Object.freeze({generate,trail});
})(KIT);
