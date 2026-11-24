/* Dense, editable deposition fields and synchronous trail-following agents. */
(function (K) {
  const P=K.procedural, internals=new WeakMap(), finite=Number.isFinite, TAU=2*Math.PI;
  const limit=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const number=(n,a,b)=>finite(n)&&n>=a&&n<=b;
  const pair=p=>Array.isArray(p)&&p.length===2&&Array.from(p).every(finite);
  const record=v=>v!=null&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  const check=(ok,message)=>{if(!ok)throw new RangeError('Trail fields: '+message);};
  const MAX=1e6, MAX_TICK=1e9;
  const angle=t=>((t%TAU)+TAU)%TAU;

  function grid(options={}) {
    const {channels:settings,maxWork=40000000}=options;
    check(record(settings)&&limit(Object.keys(settings).length,1,8)&&limit(maxWork,1,120000000),'expected named channels and a bounded work budget');
    const domain=P.motion.gridDomain(options),{width,height,size,dx,dz,bounds,open:base,center}=domain;
    const names=Object.freeze(Object.keys(settings)), indices=new Map(names.map((name,i)=>[name,i]));
    check(size*names.length<=650000,'grid exceeds its channel budget');
    const ratios=[dz*dz,dx*dx], divisor=2*(ratios[0]+ratios[1]);
    const coefficients=names.map(name=>{
      const spec=settings[name];
      check(/^[\w-]+$/.test(name)&&record(spec)&&Object.keys(spec).every(k=>['diffusion','decay'].includes(k)),'invalid channel '+name);
      const {diffusion=0,decay=0}=spec;
      check(number(diffusion,0,1)&&number(decay,0,1),'diffusion and decay must be fractions per tick');
      return [diffusion*ratios[0]/divisor,diffusion*ratios[1]/divisor,1-decay];
    });
    const signature=P.data.hash(JSON.stringify([bounds,width,height,Array.from(base),names,coefficients]));
    let open=base.slice(), blocked=size-open.reduce((a,b)=>a+b,0), tick=0, revision=0, retained, editing=false;
    let buffers=names.map(()=>new Float32Array(size)), written=names.map(()=>new Float32Array(size));
    const ox=bounds.min[0],oz=bounds.min[1];
    const invalidate=()=>{revision++;retained=undefined;};
    const available=()=>check(!editing,'cannot mutate the field while selecting an edit');
    const cell=(x,z)=>x>=0&&z>=0&&x<=width&&z<=height?
      Math.min(height-1,Math.floor(z))*width+Math.min(width-1,Math.floor(x)):-1;
    const along=x=>finite(x)&&x>=ox&&x<=bounds.max[0]?Math.min(width,(x-ox)/dx):NaN;
    const across=z=>finite(z)&&z>=oz&&z<=bounds.max[1]?Math.min(height,(z-oz)/dz):NaN;
    const contains=(x,z)=>open[cell(along(x),across(z))]===1;
    const weights=(values,lo,hi,empty=false)=>{
      check(record(values)&&(empty||Object.keys(values).length),'expected named channel weights');
      return Object.entries(values).map(([name,v])=>{
        check(indices.has(name)&&number(v,lo,hi),'unknown channel or invalid value '+name);
        return [indices.get(name),v];
      });
    };

    function interpolate(data,mask,x,z,anchor) {
      const col=anchor%width,row=Math.floor(anchor/width);
      const fromX=Math.floor(x-.5),fromZ=Math.floor(z-.5),fx=x-.5-fromX,fz=z-.5-fromZ;
      let weight=0,value=0;
      for(let v=0;v<2;v++)for(let u=0;u<2;u++){
        const c=Math.max(0,Math.min(width-1,fromX+u)),r=Math.max(0,Math.min(height-1,fromZ+v)),i=r*width+c;
        if(!mask[i]||c!==col&&r!==row&&!mask[row*width+c]&&!mask[r*width+col])continue;
        const w=(u?fx:1-fx)*(v?fz:1-fz);
        value+=w*data[i]; weight+=w;
      }
      return value/weight;
    }

    // Grid traversal prevents moving or sensing through a masked wall, including sealed corners.
    function path(x,z,qx,qz) {
      const start=cell(x,z),end=cell(qx,qz);
      if(!open[start]||!open[end])return -1;
      if(!blocked||start===end)return end;
      const sx=Math.sign(qx-x),sz=Math.sign(qz-z),ax=Math.abs(qx-x),az=Math.abs(qz-z);
      let c=start%width,r=Math.floor(start/width);
      const cx=end%width,rz=Math.floor(end/width);
      let tx=ax?(c+Number(sx>0)-x)/(qx-x):Infinity, tz=az?(r+Number(sz>0)-z)/(qz-z):Infinity;
      while(c!==cx||r!==rz){
        if(c===cx){r+=sz;tz+=1/az;}
        else if(r===rz){c+=sx;tx+=1/ax;}
        else if(Math.abs(tx-tz)<1e-12){
          if(!open[r*width+c+sx]&&!open[(r+sz)*width+c])return -1;
          c+=sx;r+=sz;tx+=1/ax;tz+=1/az;
        }else if(tx<tz){c+=sx;tx+=1/ax;}
        else {r+=sz;tz+=1/az;}
        if(!open[r*width+c])return -1;
      }
      return end;
    }

    function edit({bounds:box=bounds,select,blocked:close,values,mode='set'}={}) {
      available();
      check(pair(box?.min)&&pair(box?.max)&&box.min.every((v,i)=>v<=box.max[i])&&
        (select===undefined||typeof select==='function')&&(close===undefined||typeof close==='boolean')&&
        (close!==undefined||values!==undefined)&&['set','add'].includes(mode),'invalid edit region or operation');
      const paint=typeof values==='function'?values:undefined;
      const uniform=values===undefined||paint?[]:weights(values,0,MAX), picked=[];
      editing=true;
      try{
        for(let i=0;i<size;i++){
          if(!base[i]||close===undefined&&!open[i])continue;
          const [x,z]=center(i);
          if(x<box.min[0]||x>box.max[0]||z<box.min[1]||z>box.max[1]||select&&!select(x,z,i))continue;
          const local=close===true?null:paint?.(x,z,i);
          picked.push([i,local==null?uniform:weights(local,0,MAX)]);
        }
      }finally{editing=false;}
      for(const [i,change] of picked){
        if(close!==undefined){
          blocked+=open[i]-Number(!close);
          open[i]=Number(!close);
        }
        if(!open[i])for(const data of buffers)data[i]=0;
        else for(const [c,v] of change)buffers[c][i]=mode==='set'?v:Math.min(MAX,buffers[c][i]+v);
      }
      if(picked.length)invalidate();
      return picked.length;
    }

    function prepareBrush({at,radius,values}={}) {
      check(pair(at)&&number(radius,1e-7,1e7),'brush needs a point and positive radius');
      const change=weights(values,0,MAX),touch=[];
      const left=Math.max(0,Math.ceil((at[0]-radius-ox)/dx-.5)),right=Math.min(width-1,Math.floor((at[0]+radius-ox)/dx-.5));
      const low=Math.max(0,Math.ceil((at[1]-radius-oz)/dz-.5)),high=Math.min(height-1,Math.floor((at[1]+radius-oz)/dz-.5));
      for(let r=low;r<=high;r++)for(let c=left;c<=right;c++){
        const i=r*width+c;
        if(!base[i])continue;
        const [x,z]=center(i),d=Math.hypot(x-at[0],z-at[1])/radius;
        if(d<1)touch.push([i,(1-d*d)**2]);
      }
      return {touch,change};
    }

    function brush(data,{touch,change},mode) {
      let count=0;
      for(const [i,f] of touch){
        if(!open[i])continue;
        for(const [c,a] of change)data[c][i]=Math.min(MAX,(mode==='set'?0:data[c][i])+a*f);
        count++;
      }
      return count;
    }
    function stamp({mode='add',...options}={}) {
      available();
      check(['add','set'].includes(mode),'stamp mode must be add or set');
      const affected=brush(buffers,prepareBrush(options),mode);
      if(affected)invalidate();
      return affected;
    }

    function advance(count,networkCost=0) {
      available();
      check(limit(count,1,10000)&&tick+count<=MAX_TICK&&
        count*(size*names.length+networkCost)<=maxWork,'step exceeds the simulation work budget');
    }
    function integrate(stain) {
      for(let c=0;c<buffers.length;c++)written[c].set(buffers[c]);
      stain?.(written);
      for(let c=0;c<buffers.length;c++){
        const [wx,wz,keep]=coefficients[c],from=written[c],to=buffers[c];
        if(!wx&&!wz&&keep===1){to.set(from);continue;}
        for(let i=0;i<size;i++){
          if(!open[i]){to[i]=0;continue;}
          const v=from[i],col=i%width;
          let x=0,z=0;
          if(wx){
            if(col>0&&open[i-1])x+=from[i-1]-v;
            if(col<width-1&&open[i+1])x+=from[i+1]-v;
          }
          if(wz){
            if(i>=width&&open[i-width])z+=from[i-width]-v;
            if(i+width<size&&open[i+width])z+=from[i+width]-v;
          }
          to[i]=Math.max(0,(v+wx*x+wz*z)*keep);
        }
      }
      tick++;
    }
    function step(count=1) {
      advance(count);
      for(let i=0;i<count;i++)integrate();
      invalidate();
      return tick;
    }
    function frame() {
      if(retained)return retained;
      const values=buffers.map(row=>row.slice()), mask=open.slice(), captured=tick;
      const sample=(channel,x,z)=>{
        const index=indices.get(channel),u=along(x),v=across(z),anchor=cell(u,v);
        return index===undefined||!mask[anchor]?0:interpolate(values[index],mask,u,v,anchor);
      };
      function source(channel,{bounds:box,project,units=null}={}) {
        check(indices.has(channel)&&(project===undefined||typeof project==='function'&&box),'invalid world projection or channel');
        const world=box??{min:[ox,0,oz],max:[bounds.max[0],0,bounds.max[1]]};
        return K.fieldViews.source({type:'number',bounds:world,units,sample(x,y,z){
          const p=project?project([x,y,z]):[x,z];
          return pair(p)&&mask[cell(along(p[0]),across(p[1]))]?sample(channel,...p):null;
        }});
      }
      retained=Object.freeze({tick:captured,time:captured,width,height,bounds,channels:names,sample,source,
        data:channel=>values[indices.get(channel)]?.slice(),mask:()=>mask.slice()});
      return retained;
    }
    function checkpoint(){
      return {format:'ink-studio/trail-field',signature,tick,open:Array.from(open),data:buffers.map(row=>Array.from(row))};
    }
    function validate(saved){
      check(saved?.format==='ink-studio/trail-field'&&saved.signature===signature&&limit(saved.tick,0,MAX_TICK)&&
        Array.isArray(saved.open)&&saved.open.length===size&&Array.from(saved.open).every((n,i)=>n===0||n===1&&base[i])&&
        Array.isArray(saved.data)&&saved.data.length===names.length&&Array.from(saved.data).every(row=>Array.isArray(row)&&
          row.length===size&&Array.from(row).every((n,i)=>number(n,0,MAX)&&(saved.open[i]||n===0))),'checkpoint has a different grid or invalid state');
    }
    function restore(saved){
      available();
      validate(saved);
      open=Uint8Array.from(saved.open);blocked=size-open.reduce((a,b)=>a+b,0);
      buffers=saved.data.map(row=>Float32Array.from(row));
      tick=saved.tick;invalidate();
    }
    const field=Object.freeze({width,height,dimensions:2,bounds,channels:names,edit,stamp,step,frame,checkpoint,restore,contains,
      get tick(){return tick;},get revision(){return revision;},reset(){
        available();open=base.slice();blocked=size-open.reduce((a,b)=>a+b,0);
        buffers.forEach(row=>row.fill(0));tick=0;invalidate();
      }});
    internals.set(field,{dx,dz,ox,oz,size,along,across,cell,path,weights,prepareBrush,brush,advance,integrate,invalidate,
      open:i=>open[i]===1,sense:(weights,x,z,i)=>{
        let value=0;
        for(const [k,w] of weights)value+=w*interpolate(buffers[k],open,x,z,i);
        return value;
      }});
    return field;
  }

  function trailAgents({field,agents,groups={default:{}},emitters=[],seed=0,capacity=0}={}) {
    const F=internals.get(field);
    check(F&&Array.isArray(agents)&&limit(agents.length,1,50000)&&record(groups)&&limit(Object.keys(groups).length,1,12)&&
      Array.isArray(emitters)&&emitters.length<=128&&limit(seed,-0xffffffff,0xffffffff)&&limit(capacity,0,50000),
    'expected a dense trail field, agents and bounded options');
    const {dx,dz,ox,oz}=F, names=new Map(), cost=[];
    for(const [name,config] of Object.entries(groups)){
      check(record(config),'agent groups require a record');
      const {speed=Math.min(dx,dz),sensorDistance=4*Math.min(dx,dz),sensorAngle=.58,turnAngle=.53,jitter=.13,
        sense={[field.channels[0]]:1},deposit={[field.channels[0]]:1}}=config;
      check(number(speed,1e-7,32*Math.min(dx,dz))&&number(sensorDistance,0,64*Math.min(dx,dz))&&
        number(sensorAngle,0,Math.PI)&&number(turnAngle,0,Math.PI)&&number(jitter,0,Math.PI),'invalid motion and sensor ranges');
      names.set(name,{mx:speed/dx,mz:speed/dz,sx:sensorDistance/dx,sz:sensorDistance/dz,
        sensorAngle,turnAngle,jitter,sense:F.weights(sense,-100,100,true),deposit:F.weights(deposit,0,MAX,true)});
      cost.push(8+Math.ceil((3*sensorDistance+speed)/Math.min(dx,dz))*2);
    }
    const count=agents.length, types=new Array(count), ids=new Set(), rows=new Array(count), initial=new Float64Array(count*3);
    const random=K.grow.dice(seed);
    for(let i=0;i<count;i++){
      const {at,heading=random()*TAU,group='default',id=i}=agents[i]??{};
      check((typeof id==='string'&&id.length>0&&id.length<=128||limit(id,0,Number.MAX_SAFE_INTEGER))&&!ids.has(id)&&
        pair(at)&&field.contains(...at)&&finite(heading)&&names.has(group),'invalid, blocked or duplicate agent');
      ids.add(id);types[i]=names.get(group);rows[i]=Object.freeze({id,group});
      initial[3*i]=F.along(at[0]);initial[3*i+1]=F.across(at[1]);initial[3*i+2]=angle(heading);
    }
    let touched=0;
    const brushes=Array.from(emitters,emitter=>{
      const brush=F.prepareBrush(emitter);
      touched+=brush.touch.length;
      check(touched<=F.size*8,'emitter brush budget exceeded');
      return brush;
    });
    const original=field.checkpoint();
    const signature=P.data.hash(JSON.stringify([seed,capacity,rows,Array.from(initial),Array.from(names),brushes,original.signature]));
    const occupancy=capacity?new Int32Array(F.size):null;
    const networkCost=count*Math.max(...cost)+brushes.reduce((n,b)=>n+b.touch.length*b.change.length,0);
    let poses=initial.slice(), seenRevision=-1,cached;
    function noise(t,i){
      let h=Math.imul(t^seed,0x9e3779b1)^Math.imul(i+1,0x85ebca6b);
      h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);
      return ((h^(h>>>16))>>>0)/4294967296;
    }
    function advance(data) {
      const tick=field.tick, offset=tick%count;
      if(occupancy){
        occupancy.fill(0);
        for(let i=0;i<count;i++){
          const j=F.cell(poses[3*i],poses[3*i+1]);
          if(F.open(j))occupancy[j]++;
        }
      }
      for(let k=0;k<count;k++){
        const i=(k+offset)%count,p=3*i,x=poses[p],z=poses[p+1],from=F.cell(x,z),t=poses[p+2],g=types[i];
        if(!F.open(from))continue;
        const read=heading=>{
          const qx=x+g.sx*Math.cos(heading),qz=z+g.sz*Math.sin(heading),cell=F.path(x,z,qx,qz);
          return cell<0?-Infinity:F.sense(g.sense,qx,qz,cell);
        };
        const left=read(t+g.sensorAngle),mid=read(t),right=read(t-g.sensorAngle),die=noise(tick,i);
        let turn=0;
        if(mid<Math.max(left,right))turn=left===right?(die<.5?-1:1):Math.sign(left-right);
        const heading=t+turn*g.turnAngle+(2*die-1)*g.jitter;
        const qx=x+g.mx*Math.cos(heading),qz=z+g.mz*Math.sin(heading),dest=F.path(x,z,qx,qz);
        if(dest<0||occupancy&&dest!==from&&occupancy[dest]>=capacity){
          poses[p+2]=angle(heading+Math.PI*(.5+die));
          continue;
        }
        if(occupancy&&dest!==from){occupancy[from]--;occupancy[dest]++;}
        poses[p]=qx;poses[p+1]=qz;poses[p+2]=angle(heading);
        for(const [c,v] of g.deposit)data[c][dest]=Math.min(MAX,data[c][dest]+v);
      }
      for(const b of brushes)F.brush(data,b,'add');
    }
    function step(ticks=1){
      F.advance(ticks,networkCost);
      for(let i=0;i<ticks;i++)F.integrate(advance);
      F.invalidate();
      return field.tick;
    }
    function frame(){
      if(cached&&seenRevision===field.revision)return cached;
      const read=field.frame();
      const population=Object.freeze(rows.map(({id,group},i)=>Object.freeze({id,group,
        at:Object.freeze([ox+poses[3*i]*dx,oz+poses[3*i+1]*dz]),heading:poses[3*i+2],
        active:F.open(F.cell(poses[3*i],poses[3*i+1]))})));
      seenRevision=field.revision;
      cached=Object.freeze({...read,agents:population});
      return cached;
    }
    return Object.freeze({field,frame,step,get tick(){return field.tick;},get revision(){return field.revision;},
      checkpoint(){return {format:'ink-studio/trail-agents',signature,poses:Array.from(poses),field:field.checkpoint()};},
      restore(saved){
        check(saved?.format==='ink-studio/trail-agents'&&saved.signature===signature&&Array.isArray(saved.poses)&&
          saved.poses.length===poses.length&&Array.from(saved.poses).every((n,i)=>
            i%3===2?number(n,0,TAU):number(n,0,i%3===0?field.width:field.height)),'checkpoint has invalid agent poses');
        field.restore(saved.field);
        poses=Float64Array.from(saved.poses);
      },
      reset(){field.restore(original);poses=initial.slice();}
    });
  }
  K.deposition=Object.freeze({...K.deposition,grid});
  P.motion.trailAgents=trailAgents;
})(KIT);
