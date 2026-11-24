/* Shared material fields and deterministic, extensible ecological processes.
   Renderers observe this state; they do not run their own simulation. */
(function(K) {
  const finite=Number.isFinite, clamp=K.clamp, name=s=>typeof s==='string'&&/^[a-zA-Z][\w./-]{0,127}$/.test(s)&&!['constructor','prototype','__proto__'].includes(s);
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(finite);
  function check(ok,message){if(!ok)throw new RangeError(message);}
  function copy(value,budget={left:4000000}) {
    check(--budget.left>=0,'Ecology state exceeds serialization budget');
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'){check(finite(value),'Ecology state must be finite');return value;}
    if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,v=>copy(v,budget));
    check(record(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),'Ecology state must use plain serializable records');
    return Object.fromEntries(Object.entries(value).map(([key,v])=>{check(!['__proto__','constructor','prototype'].includes(key),'Unsafe ecology state key');return [key,copy(v,budget)];}));
  }
  function create(options={}) {
    const {width=32,height=32,cellSize=1,origin:requestedOrigin=[0,0],step=.1,seed=17,maxEvents=1024,maxContacts=256}=options;
    const origin=Array.isArray(requestedOrigin)?requestedOrigin.slice():requestedOrigin;
    check(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0&&width*height<=65536&&
      finite(cellSize)&&cellSize>0&&vector(origin,2)&&finite(step)&&step>=.01&&step<=1&&Number.isSafeInteger(seed)&&
      Number.isSafeInteger(maxEvents)&&maxEvents>0&&maxEvents<=100000&&Number.isSafeInteger(maxContacts)&&maxContacts>0&&maxContacts<=4096,'Invalid ecology domain or budget');
    const N=width*height, definitions={}, specs=options.processes??[], names=new Set();
    check(Array.isArray(specs)&&specs.length<=32,'Invalid ecology process list');
    function schema(key,spec) {
      check(name(key)&&record(spec)&&finite(spec.min??0)&&finite(spec.max??1)&&(spec.min??0)<(spec.max??1)&&
        finite(spec.default??0)&&(spec.default??0)>=(spec.min??0)&&(spec.default??0)<=(spec.max??1),'Invalid ecology channel '+key);
      const next={min:spec.min??0,max:spec.max??1,default:spec.default??0};
      if(definitions[key])check(JSON.stringify(definitions[key])===JSON.stringify(next),'Conflicting ecology channel '+key);
      else definitions[key]=Object.freeze(next);
    }
    for(const spec of specs){
      check(record(spec)&&name(spec.id)&&!names.has(spec.id)&&(typeof spec.step==='function'||typeof spec.create==='function'||typeof spec.contact==='function'),'Invalid or duplicate ecology process');
      names.add(spec.id);for(const [key,s]of Object.entries(spec.channels??{}))schema(key,s);
    }
    for(const [key,s]of Object.entries(options.channels??{}))schema(key,s);
    const channels=Object.keys(definitions);check(channels.length>0&&channels.length<=24,'Ecology needs one to 24 channels');
    const materials=copy(options.materials??{default:{}}), materialNames=Object.keys(materials);
    check(materialNames.length>0&&materialNames.length<=256&&materialNames.every(name),'Invalid ecology materials');
    check(Object.values(materials).every(record)&&record(options.environment??{}),'Invalid ecology material or environment');
    for(const row of Object.values(materials))for(const [field,value]of Object.entries(row))check(definitions[field]&&finite(value)&&value>=definitions[field].min&&value<=definitions[field].max,'Invalid material channel '+field);
    const materialAt=options.materialAt??(()=>materialNames[0]),heightAt=options.heightAt??(()=>0);
    check(typeof materialAt==='function'&&typeof heightAt==='function','Ecology habitat needs material and height samplers');
    const types=[], points=new Float32Array(N*3), initial={}, fields={}, revisions=new Float64Array(N);
    for(const key of channels)initial[key]=new Float32Array(N);
    for(let i=0;i<N;i++){
      const x=origin[0]+(i%width+.5)*cellSize,z=origin[1]+(Math.floor(i/width)+.5)*cellSize;
      const material=materialAt(x,z),y=heightAt(x,z);check(materialNames.includes(material)&&finite(y),'Invalid ecology habitat sample');
      types.push(material);points.set([x,y,z],i*3);
      for(const key of channels)initial[key][i]=materials[material][key]??definitions[key].default;
    }
    check(points.every(finite)&&channels.every(k=>initial[k].every(finite)),'Ecology domain exceeds finite storage');
    for(const key of channels)fields[key]=initial[key].slice();
    let signature=2166136261;
    const hash=s=>{for(let i=0;i<s.length;i++)signature=Math.imul(signature^s.charCodeAt(i),16777619)>>>0;};
    hash(JSON.stringify({width,height,cellSize,origin,definitions,types,processes:specs.map(p=>[p.id,p.version??1])}));
    for(const byte of new Uint8Array(points.buffer))signature=Math.imul(signature^byte,16777619)>>>0;
    for(const key of channels)for(const byte of new Uint8Array(initial[key].buffer))signature=Math.imul(signature^byte,16777619)>>>0;
    const initialEnvironment=copy(options.environment??{});
    let time=0,tick=0,acc=0,version=1,randomState=(seed>>>0)||1,serial=0,environment=copy(initialEnvironment),busy=false;
    const events=[],contacts=[],seen=new Set(),runtimes=[];
    revisions.fill(version);
    const index=(p)=>{
      check(vector(p,3),'Ecology sampling needs a world XYZ point');
      const x=Math.floor((p[0]-origin[0])/cellSize),z=Math.floor((p[2]-origin[1])/cellSize);
      return x<0||z<0||x>=width||z>=height?-1:z*width+x;
    };
    function cell(i){check(Number.isSafeInteger(i)&&i>=0&&i<N,'Invalid ecology cell');return i;}
    function channel(key){check(Object.hasOwn(definitions,key),'Unknown ecology channel '+key);return key;}
    const point=i=>Array.from(points.subarray(cell(i)*3,i*3+3));
    function disc(p,radius){
      check(vector(p,3)&&finite(radius)&&radius>=0,'Invalid ecology contact footprint');
      const cells=[],margin=radius+cellSize*Math.SQRT1_2;
      const x0=Math.max(0,Math.floor((p[0]-margin-origin[0])/cellSize)),x1=Math.min(width-1,Math.floor((p[0]+margin-origin[0])/cellSize));
      const z0=Math.max(0,Math.floor((p[2]-margin-origin[1])/cellSize)),z1=Math.min(height-1,Math.floor((p[2]+margin-origin[1])/cellSize));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*width+x;if(Math.hypot(points[i*3]-p[0],points[i*3+2]-p[2])<=margin)cells.push(i);}
      return cells;
    }
    const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return (randomState>>>0)/4294967296;};
    function eachEdge(fn){for(let i=0;i<N;i++){if(i%width<width-1)fn(i,i+1);if(i+width<N)fn(i,i+width);}}
    function emit(event){if(events.length===maxEvents)events.shift();events.push(copy(event));}
    function idle(){check(!busy,'Ecology mutations cannot reenter a process');}
    function context(work,pending,output,id){
      const read=(key,i)=>work[channel(key)][cell(i)];
      const current=(key,i)=>pending.get(key)?.get(i)??read(key,i);
      function set(key,i,value){channel(key);cell(i);const s=definitions[key];check(finite(value)&&value>=s.min-1e-6&&value<=s.max+1e-6,'Invalid ecology value for '+key);check(finite(Math.fround(value)),'Ecology value exceeds finite storage');if(!pending.has(key))pending.set(key,new Map());pending.get(key).set(i,clamp(value,s.min,s.max));}
      return Object.freeze({count:N,width,height,cellSize,time:time+step,tick:tick+1,dt:step,
        environment:Object.freeze(copy(environment)),point,cell:index,cellsInDisc:disc,eachEdge,random,
        material:i=>types[cell(i)],initial:(key,i)=>initial[channel(key)][cell(i)],read,
        set,add(key,i,amount){check(finite(amount),'Invalid ecology delta');const s=definitions[channel(key)];set(key,i,clamp(current(key,i)+amount,s.min,s.max));},
        transfer(key,from,to,amount){check(finite(amount)&&amount>=0&&from!==to,'Invalid ecology transfer');const s=definitions[channel(key)];
          const value=Math.max(0,Math.min(amount,current(key,from)-s.min,s.max-current(key,to)));set(key,from,current(key,from)-value);set(key,to,current(key,to)+value);return value;},
        emit(kind,data={}){check(name(kind),'Invalid ecology event kind');check(record(data),'Ecology event data must be a record');output.push({...copy(data),kind,process:id,time:time+step,tick:tick+1});}
      });
    }
    function flush(work,pending){for(const[key,rows]of pending)for(const[i,value]of rows)work[key][i]=value;}
    const domain=Object.freeze({width,height,count:N,cellSize,origin:Object.freeze(origin.slice()),point,cell:index,
      read:(key,i)=>fields[channel(key)][cell(i)],initial:(key,i)=>initial[channel(key)][cell(i)]});
    for(const spec of specs){
      const runtime=spec.create?spec.create(domain):{step:spec.step??(()=>{}),contact:spec.contact,save:()=>null,restore(value){check(value===null,'Unexpected stateless process state');},reset(){}};
      check(runtime&&typeof runtime.step==='function'&&typeof runtime.save==='function'&&typeof runtime.restore==='function'&&typeof runtime.reset==='function','Stateful ecology processes need save, restore and reset');
      runtimes.push({id:spec.id,runtime});
    }
    function run(){
      const saved=runtimes.map(p=>p.runtime.save()),rng=randomState,work=Object.fromEntries(channels.map(k=>[k,fields[k].slice()])),output=[];
      const ready=contacts.filter(c=>c.time<=time+step+1e-9).sort((a,b)=>a.time-b.time);
      busy=true;
      try{
        for(const contact of ready){
          const pending=new Map(),ctx=context(work,pending,output,'contact');
          for(const i of disc(contact.p,contact.radius))for(const[key,value]of Object.entries(contact.values??{}))ctx.set(key,i,value);
          flush(work,pending);
          for(const p of runtimes)if(p.runtime.contact){const edits=new Map();p.runtime.contact(context(work,edits,output,p.id),contact);flush(work,edits);}
          output.push({kind:'contact',type:contact.type,id:contact.id,p:contact.p,time:time+step,tick:tick+1});
        }
        for(const p of runtimes){const pending=new Map();p.runtime.step(context(work,pending,output,p.id),step);flush(work,pending);}
      }catch(error){randomState=rng;runtimes.forEach((p,i)=>p.runtime.restore(saved[i]));throw error;}finally{busy=false;}
      const changed=[];
      for(let i=0;i<N;i++)if(channels.some(k=>fields[k][i]!==work[k][i]))changed.push(i);
      if(changed.length){version++;for(const i of changed)revisions[i]=version;}
      for(const key of channels)fields[key].set(work[key]);
      time+=step;tick++;
      for(let i=contacts.length-1;i>=0;i--)if(contacts[i].time<=time+1e-9)contacts.splice(i,1);
      for(const event of output)emit(event);
    }
    function contact(raw){
      idle();check(record(raw)&&name(raw.type)&&vector(raw.p,3)&&finite(raw.radius??0)&&(raw.radius??0)>=0,'Invalid ecology contact');
      const id=raw.id??'contact-'+serial,at=raw.time??time;
      check(typeof id==='string'&&id.length>0&&id.length<=256&&finite(at)&&at>=time-1e-9,'Invalid ecology contact identity or time');
      if(seen.has(id))return false;
      check(contacts.length<maxContacts,'Ecology contact budget exceeded');
      check(record(raw.values??{}),'Ecology contact values must be a record');
      for(const[key,value]of Object.entries(raw.values??{})){const s=definitions[channel(key)];check(finite(value)&&value>=s.min&&value<=s.max,'Invalid ecology contact value');}
      const row=copy({...raw,id,time:at,radius:raw.radius??0});contacts.push(row);seen.add(id);serial++;
      if(seen.size>4096)seen.delete(seen.values().next().value);return true;
    }
    function update(dt){idle();check(finite(dt)&&dt>=0&&dt<=.25,'Ecology update needs a step in [0, 0.25]');acc+=dt;while(acc+1e-10>=step){try{run();}catch(error){acc=step;throw error;}acc=Math.max(0,acc-step);}}
    function reset(){idle();for(const key of channels)fields[key].set(initial[key]);for(const p of runtimes)p.runtime.reset();time=0;tick=0;acc=0;serial=0;environment=copy(initialEnvironment);randomState=(seed>>>0)||1;contacts.length=0;events.length=0;seen.clear();version++;revisions.fill(version);}
    function snapshot(){idle();return copy({format:'ink-ecology/1',signature,time,tick,acc,serial,randomState,environment,
      fields,processes:runtimes.map(p=>({id:p.id,state:p.runtime.save()})),contacts,events,seen:[...seen]});}
    function restore(raw){
      idle();const s=copy(raw);check(s.format==='ink-ecology/1'&&s.signature===signature&&finite(s.time)&&s.time>=0&&Number.isSafeInteger(s.tick)&&s.tick>=0&&
        finite(s.acc)&&s.acc>=0&&s.acc<step+.25&&Number.isSafeInteger(s.serial)&&s.serial>=0&&Number.isSafeInteger(s.randomState)&&s.randomState>=-2147483648&&s.randomState<=4294967295,'Incompatible ecology snapshot');
      check(record(s.fields)&&Object.keys(s.fields).length===channels.length&&channels.every(k=>Array.isArray(s.fields[k])&&s.fields[k].length===N&&s.fields[k].every(v=>finite(v)&&v>=definitions[k].min-1e-6&&v<=definitions[k].max+1e-6)),'Invalid ecology snapshot channels');
      check(Array.isArray(s.processes)&&s.processes.length===runtimes.length&&s.processes.every((p,i)=>p.id===runtimes[i].id)&&Array.isArray(s.contacts)&&s.contacts.length<=maxContacts&&Array.isArray(s.events)&&s.events.length<=maxEvents&&Array.isArray(s.seen)&&s.seen.length<=4096&&record(s.environment),'Invalid ecology snapshot processes or events');
      for(const c of s.contacts){check(name(c.type)&&vector(c.p,3)&&finite(c.time)&&c.time>=s.time&&finite(c.radius)&&c.radius>=0&&typeof c.id==='string'&&record(c.values??{}),'Invalid saved ecology contact');
        for(const [key,v]of Object.entries(c.values??{}))check(definitions[key]&&finite(v)&&v>=definitions[key].min&&v<=definitions[key].max,'Invalid saved ecology contact value');}
      check(s.seen.every(id=>typeof id==='string'&&id.length>0&&id.length<=256)&&s.events.every(record),'Invalid saved ecology event records');
      const old=runtimes.map(p=>p.runtime.save());
      try{runtimes.forEach((p,i)=>p.runtime.restore(s.processes[i].state));}catch(error){runtimes.forEach((p,i)=>p.runtime.restore(old[i]));throw error;}
      for(const key of channels)fields[key].set(s.fields[key]);time=s.time;tick=s.tick;acc=s.acc;serial=s.serial;randomState=s.randomState;environment=s.environment;
      contacts.splice(0,contacts.length,...s.contacts);events.splice(0,events.length,...s.events);seen.clear();for(const id of s.seen)seen.add(id);version++;revisions.fill(version);
    }
    return Object.freeze({width,height,cellSize,origin:Object.freeze(origin.slice()),count:N,step,channels:Object.freeze(channels.slice()),
      definitions:Object.freeze(definitions),processes:Object.freeze(specs.map(p=>p.id)),point,cell:index,cellsInDisc:disc,read:(key,i)=>fields[channel(key)][cell(i)],initial:(key,i)=>initial[channel(key)][cell(i)],
      sample(p){const i=index(p);return i<0?null:{cell:i,point:point(i),material:types[i],values:Object.fromEntries(channels.map(k=>[k,fields[k][i]]))};},
      contact,update,reset,snapshot,restore,drainEvents:()=>events.splice(0),
      changes(since=0){return {version,cells:Array.from({length:N},(_,i)=>i).filter(i=>revisions[i]>since)};},
      setEnvironment(patch){idle();check(record(patch),'Ecology environment must be a record');environment={...environment,...copy(patch)};},
      get stats(){return {time,tick,version,contacts:contacts.length,events:events.length,cells:N,processes:runtimes.length};}
    });
  }
  function diffusion({id,field,rate=.5}={}){
    check(name(id)&&name(field)&&finite(rate)&&rate>=0,'Invalid ecology diffusion');
    return {id,step(ctx,h){const k=(1-Math.exp(-rate*h/(ctx.cellSize*ctx.cellSize)))/4;
      ctx.eachEdge((a,b)=>{const d=ctx.read(field,a)-ctx.read(field,b);if(d>0)ctx.transfer(field,a,b,d*k);else if(d<0)ctx.transfer(field,b,a,-d*k);});}};
  }
  K.ecology={create,processes:{diffusion}};
})(KIT);
