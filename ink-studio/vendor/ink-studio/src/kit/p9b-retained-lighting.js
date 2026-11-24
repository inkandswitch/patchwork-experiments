/* Recolour retained surface samples using bounded shadow rays and local diffuse bounce. */
(function(K){
  const P=K.procedural, {V}=K, {bounds,expand,overlap}=P.spatial;
  const {freeze}=P.data;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const xyz=point=>Array.isArray(point)&&point.length===3&&Array.from(point).every(n=>finite(n,-1e5,1e5));
  const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
  const keys=(o,allowed)=>record(o)&&Object.keys(o).every(key=>allowed.includes(key));
  const swatch=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  const name=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(value)&&
    !['constructor','prototype','__proto__'].includes(value);
  const assert=(condition,message)=>{if(!condition)throw new TypeError(message);};
  let linear,bytes;
  function prepareColors(){
    if(linear)return;
    const color=ColorSpace.prepare('srgb','srgb-linear'), encode=ColorSpace.prepare('srgb-linear','srgb');
    linear=Float32Array.from({length:256},(_,i)=>color([i/255,0,0])[0]);
    bytes=Uint8Array.from({length:4097},(_,i)=>Math.round(encode([i/4096,0,0])[0]*255));
  }
  const output=n=>bytes[Math.min(4096,Math.max(0,Math.round(n*4096)))];
  const scaled=(hex,intensity)=>[linear[hex>>16&255]*intensity,linear[hex>>8&255]*intensity,linear[hex&255]*intensity];
  const lightColor=light=>scaled(parseInt(light.color.slice(1),16),light.intensity);

  function lamp(raw,prior){
    assert(keys(raw,['at','range','color','intensity','enabled']),'Unknown point light setting');
    const {at,range=4,color='#ffffff',intensity=1,enabled=true}={...prior,...raw};
    assert(xyz(at)&&finite(range,.01,128)&&swatch(color)&&finite(intensity,0,16)&&typeof enabled==='boolean',
      'Point light needs XYZ position, range, hex color, intensity and enabled');
    return freeze({at:at.slice(),range,color:color.toLowerCase(),intensity,enabled});
  }
  function lamps(raw){
    assert(record(raw)&&Object.keys(raw).length<=32,'Expected at most 32 named point lights');
    return freeze(Object.fromEntries(Object.keys(raw).sort().map(id=>{
      assert(name(id),'Invalid point light ID '+id);
      return [id,lamp(raw[id])];
    })));
  }
  function settings(raw,cell,area){
    assert(keys(raw,['ambient','sun','sky','lamps','indirect','bias','maxSteps']),'Unknown retained lighting setting');
    const {ambient=.13,bias=Math.min(1,cell*.12),maxSteps=72}=raw;
    assert(finite(ambient,0,4)&&finite(bias,.0001,1)&&Number.isInteger(maxSteps)&&finite(maxSteps,12,192),
      'Invalid ambient light, ray bias or shadow step budget');
    const {distance=Math.max(.025,Math.min(64,cell*12)),strength=.38,rays=3,probeSize=Math.max(.025,cell*2)}=raw.indirect??{};
    assert(keys(raw.indirect??{},['distance','strength','rays','probeSize'])&&finite(distance,.025,64)&&finite(strength,0,4)&&
      Number.isInteger(rays)&&finite(rays,1,6)&&finite(probeSize,.025,32),'Invalid diffuse light probe settings');
    let sun=null, sky=null;
    if(raw.sun!==undefined&&raw.sun!==false){
      assert(keys(raw.sun,['direction','intensity','color','distance']),'Invalid directional light');
      const {direction,intensity=1,color='#fff2d8',distance=V.dist(area.min,area.max)+bias*2}=raw.sun;
      assert(xyz(direction)&&V.len(direction)>1e-5&&swatch(color)&&finite(intensity,0,16)&&finite(distance,.025,1e6),
        'Directional light needs nonzero direction, hex color, intensity and distance');
      if(intensity)sun={direction:V.norm(direction),rgb:lightColor({color,intensity}),distance};
    }
    if(raw.sky!==undefined&&raw.sky!==false){
      assert(keys(raw.sky,['intensity','color']),'Invalid diffuse sky light');
      const {intensity=.35,color='#b7d7ff'}=raw.sky;
      assert(swatch(color)&&finite(intensity,0,16),'Invalid diffuse sky color or intensity');
      if(intensity)sky=lightColor({color,intensity});
    }
    return {ambient,bias,maxSteps,indirect:{distance:strength||sky?distance:0,strength,rays,probeSize},
      sun,sky,initial:lamps(raw.lamps??{})};
  }

  function sphereHits(box,light,pad=0){
    let d=0;
    for(let i=0;i<3;i++){
      const x=light.at[i], delta=Math.max(box.min[i]-x,x-box.max[i],0);
      d+=delta*delta;
    }
    return d<=(light.range+pad)**2;
  }
  const active=lamp=>lamp?.enabled&&lamp.intensity>0;
  const same=(a,b)=>a===b||a&&b&&a.range===b.range&&a.color===b.color&&a.intensity===b.intensity&&
    a.enabled===b.enabled&&a.at.every((n,i)=>n===b.at[i]);
  function sunReaches(box,edit,sun){
    let near=0,far=sun.distance;
    for(let i=0;i<3;i++){
      const lo=edit.min[i]-box.max[i],hi=edit.max[i]-box.min[i],d=sun.direction[i];
      if(Math.abs(d)<1e-9){
        if(lo>0||hi<0)return false;
      }else{
        near=Math.max(near,Math.min(lo/d,hi/d));
        far=Math.min(far,Math.max(lo/d,hi/d));
        if(near>far)return false;
      }
    }
    return true;
  }
  function towards(box,point){
    return {min:box.min.map((v,i)=>Math.min(v,point[i])),max:box.max.map((v,i)=>Math.max(v,point[i]))};
  }
  function needsLight(box,lights,edits,sun,bias){
    if(!edits.length)return false;
    const local=lights.map(light=>towards(box,light.at));
    for(const {bounds,occlusion=true} of edits){
      if(overlap(box,bounds))return true;
      if(occlusion&&(sun&&sunReaches(box,bounds,sun)||
        local.some((sweep,i)=>overlap(sweep,bounds)&&sphereHits(bounds,lights[i],bias*2))))return true;
    }
    return false;
  }

  function makeTracer(field,area,bias,maxSteps,work){
    const epsilon=bias*.14;
    function distance(x,y,z){
      work.fieldSamples++;
      const d=field.distance(x,y,z);
      if(!Number.isFinite(d))throw new RangeError('Lighting clearance must be finite');
      return d;
    }
    function ray(origin,dir,length){
      let t=0,stop=length;
      // Skip empty space outside the finite occluder domain.
      for(let i=0;i<3;i++){
        const a=area.min[i]-origin[i],b=area.max[i]-origin[i],delta=dir[i];
        if(Math.abs(delta)<1e-9){
          if(a>0||b<0)return Infinity;
        }else{
          t=Math.max(t,Math.min(a/delta,b/delta));
          stop=Math.min(stop,Math.max(a/delta,b/delta));
          if(t>stop)return Infinity;
        }
      }
      const [x,y,z]=origin,[dx,dy,dz]=dir;
      for(let i=0;i<maxSteps;i++){
        const d=distance(x+dx*t,y+dy*t,z+dz*t);
        if(d<=epsilon)return t;
        if(t>=stop)return Infinity;
        t=Math.min(stop,t+Math.max(epsilon,d*.88));
      }
      work.rayBudget++;
      return NaN;
    }
    function normal([x,y,z]){
      const d=bias*.32;
      const sample=field.surfaceDistance??distance;
      if(field.surfaceDistance)work.fieldSamples+=6;
      return V.norm([sample(x+d,y,z)-sample(x-d,y,z),sample(x,y+d,z)-sample(x,y-d,z),
        sample(x,y,z+d)-sample(x,y,z-d)],[0,0,0]);
    }
    return {ray,normal};
  }
  function lightTransport(field,area,config,work){
    const {ambient,sun,sky,bias,indirect,maxSteps}=config;
    const trace=makeTracer(field,area,bias,maxSteps,work);
    const directions=Array.from({length:indirect.rays},(_,i)=>{
      const angle=(i+.5)*Math.PI*2/indirect.rays;
      return [.6*Math.cos(angle),.6*Math.sin(angle)];
    });
    function sunlight(origin,normal){
      if(!sun)return 0;
      const cosine=V.dot(normal,sun.direction);
      if(cosine<=0)return 0;
      work.shadowRays++;
      return trace.ray(origin,sun.direction,sun.distance)===Infinity?cosine:0;
    }
    function pointLight(site,light){
      const {point,normal,origin}=site;
      const dx=light.at[0]-point[0],dy=light.at[1]-point[1],dz=light.at[2]-point[2];
      const d2=dx*dx+dy*dy+dz*dz, facing=dx*normal[0]+dy*normal[1]+dz*normal[2];
      if(facing<=0||d2>=light.range*light.range)return 0;
      const distance=Math.sqrt(d2);
      const ax=light.at[0]-origin[0],ay=light.at[1]-origin[1],az=light.at[2]-origin[2];
      const length=Math.sqrt(ax*ax+ay*ay+az*az);
      work.shadowRays++;
      if(length>bias&&trace.ray(origin,[ax/length,ay/length,az/length],length-bias)!==Infinity)return 0;
      return facing/distance*(1-distance/light.range)**2;
    }
    const probeMap=new Map();
    function diffuse({point,normal,origin}){
      if(!indirect.distance)return null;
      const {distance,rays,probeSize,strength}=indirect;
      const axis=Math.abs(normal[0])>=Math.abs(normal[1])&&Math.abs(normal[0])>=Math.abs(normal[2])?0:
        Math.abs(normal[1])>=Math.abs(normal[2])?1:2;
      const key=Math.floor(point[0]/probeSize)+'/'+Math.floor(point[1]/probeSize)+'/'+Math.floor(point[2]/probeSize)+
        '/'+(axis*2+Number(normal[axis]>0));
      if(probeMap.has(key))return probeMap.get(key);
      const value={fixed:[0,0,0],donors:[]}, right=V.perp(normal), across=V.cross(normal,right);
      for(const [x,y] of directions){
        const dir=V.add(V.mul(normal,.8),V.add(V.mul(right,x),V.mul(across,y)));
        work.diffuseRays++;
        const at=trace.ray(origin,dir,distance);
        if(at===Infinity){
          if(sky)for(let c=0;c<3;c++)value.fixed[c]+=sky[c]/rays;
        }else if(strength&&Number.isFinite(at)){
          const hit=V.mad(origin,dir,at), facing=trace.normal(hit);
          if(V.dot(facing,dir)>=0)continue;
          const inside=V.mad(hit,facing,-bias*.85);
          const paint=field.albedo?.(...inside);
          if(!Number.isInteger(paint)||paint<0||paint>0xffffff)continue;
          const site={point:hit,normal:facing,origin:V.mad(hit,facing,bias)};
          const weights=scaled(paint,strength*(1-at/distance)/rays);
          if(sun){
            const gain=sunlight(site.origin,facing);
            for(let c=0;c<3;c++)value.fixed[c]+=gain*sun.rgb[c]*weights[c];
          }
          value.donors.push({...site,weights});
        }
      }
      probeMap.set(key,value);
      return value;
    }
    function gather(part){
      const {data,count,renderMetadata,materialAlbedo}=part, normals=renderMetadata?.normals;
      const sites=[], fixed=new Float32Array(count*3);
      if(normals&&materialAlbedo)for(let i=0;i<count;i++){
        const o=i*16, a=i*3, color=materialAlbedo[i]-1;
        // Hidden samples, glass, emission, liquid and outline-free effects keep their baked appearance.
        if(color<0||data[o+3]<1||data[o+1]<-30||(data[o+11]&(16|32|64|256)))continue;
        const normal=V.norm([normals[a],normals[a+1],normals[a+2]],[0,0,0]);
        if(V.dot(normal,normal)<.9)continue;
        const point=[data[o],data[o+1],data[o+2]], origin=V.mad(point,normal,bias);
        const site={i,point,normal,origin,color}, gain=sunlight(origin,normal);
        const probe=diffuse(site);
        for(let c=0;c<3;c++)fixed[a+c]=ambient+gain*(sun?.rgb[c]??0)+(probe?.fixed[c]??0);
        sites.push({...site,probe});
      }
      work.gatheredSamples+=sites.length;
      return {sites,fixed};
    }
    function contribution(transport,light){
      const {fixed,sites}=transport, value=new Float32Array(fixed.length), cached=new Map();
      for(const site of sites){
        const o=site.i*3, direct=pointLight(site,light), probe=site.probe;
        let reflected;
        if(probe?.donors.length){
          reflected=cached.get(probe);
          if(!reflected){
            reflected=[0,0,0];
            for(const donor of probe.donors){
              const gain=pointLight(donor,light);
              for(let c=0;c<3;c++)reflected[c]+=gain*donor.weights[c];
            }
            cached.set(probe,reflected);
          }
        }
        for(let c=0;c<3;c++)value[o+c]=(direct+(reflected?.[c]??0))*light.rgb[c];
      }
      return value;
    }
    return {gather,contribution};
  }
  function recolor(part,{fixed,sites},lamps,work){
    const {data,count}=part, components=[0,0,0];
    let next;
    for(const {i,color} of sites){
      const a=i*3, o=i*16;
      for(let c=0;c<3;c++){
        let light=fixed[a+c];
        for(const values of lamps)light+=values[a+c];
        components[c]=light;
      }
      const r=output(linear[color>>16&255]*components[0]);
      const g=output(linear[color>>8&255]*components[1]);
      const b=output(linear[color&255]*components[2]);
      const packed=r+g*256+b*65536;
      if(packed!==data[o+7]){
        next??=data.slice(0,count*16);
        next[o+7]=packed;
      }
    }
    work.samples+=sites.length;
    return next?Object.freeze({...part,data:next}):part;
  }

  function create(raw,{bounds:domain,cell}){
    const area=bounds(domain);
    assert(finite(cell,.001,32),'Retained lighting needs a positive surface sample spacing');
    prepareColors();
    const config=settings(raw,cell,area);
    const {bias,indirect,sun}=config, lampCache=new WeakMap();
    function refresh({chunks,field,lamps:current=config.initial,edits=[],previous}){
      assert(field&&typeof field.distance==='function','Retained lighting needs a signed clearance field');
      const rows=Object.keys(current).sort().map(id=>current[id]).filter(active).map(light=>{
        if(!lampCache.has(light))lampCache.set(light,{...light,rgb:lightColor(light)});
        return lampCache.get(light);
      });
      const changes=[];
      if(previous)for(const id of new Set([...Object.keys(current),...Object.keys(previous.lamps)])){
        const a=previous.lamps[id], b=current[id];
        if(same(a,b))continue;
        if(active(a))changes.push(a);
        if(active(b))changes.push(b);
      }
      const entries=new Map(), parts=[];
      const work={relitChunks:[],reusedChunks:0,samples:0,gatheredSamples:0,shadowRays:0,diffuseRays:0,fieldSamples:0,rayBudget:0};
      for(const {id,bounds,part} of chunks){
        const prior=previous?.entries.get(id);
        if(!part.count){
          parts.push(part);
          continue;
        }
        const box=expand(bounds,indirect.distance+bias*3+cell*.05);
        const local=rows.filter(light=>sphereHits(box,light));
        const transportValid=prior?.source===part&&!needsLight(box,local,edits,sun,bias);
        if(transportValid&&!changes.some(light=>sphereHits(box,light))){
          entries.set(id,prior);
          parts.push(prior.part);
          work.reusedChunks++;
        }else{
          const lighting=lightTransport(field,area,config,work);
          const transport=transportValid?prior.transport:lighting.gather(part);
          const lamps=new Map(local.map(light=>[light,transportValid&&prior.lamps.get(light)||lighting.contribution(transport,light)]));
          const lit=recolor(part,transport,[...lamps.values()],work);
          entries.set(id,{source:part,part:lit,transport,lamps});
          parts.push(lit);
          work.relitChunks.push(id);
        }
      }
      return Object.freeze({parts:Object.freeze(parts),work:freeze(work),entries,lamps:current});
    }
    return Object.freeze({initial:config.initial,refresh});
  }
  P.relighting=Object.freeze({create,lamp,lamps});
})(KIT);
