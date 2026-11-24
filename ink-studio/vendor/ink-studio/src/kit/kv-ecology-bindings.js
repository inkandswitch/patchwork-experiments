/* Bind ecological state to splats, atlas texels and bounded local lights. */
(function(K){
  const E=K.ecology,atlasOwners=new WeakSet(),splatOwners=new WeakMap();
  const finite=Number.isFinite,clamp=K.clamp;
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(finite);
  function check(ok,message){if(!ok)throw new RangeError(message);}
  function styles(sim,list=[]){
    check(Array.isArray(list)&&list.length<=32,'Invalid ecology style list');
    return list.map(raw=>{
      const {field,range=[0,1],weight=1,color,opacity=1}=raw;
      check(sim.channels.includes(field)&&vector(range,2)&&range[1]>range[0]&&finite(weight)&&weight>=0&&weight<=1&&finite(opacity)&&opacity>=0&&opacity<=1&&
        (color===undefined||vector(color,3)&&color.every(v=>v>=0&&v<=1)),'Invalid ecology style');
      return {field,range:range.slice(),weight,color:color?.slice(),opacity};
    });
  }
  function lightSettings(sim,raw){
    if(!raw)return null;
    const {field='heat',threshold=.6,max=8,radius=3,intensity=.6,color=[1,.35,.08],height=.5}=raw===true?{}:raw;
    check(sim.channels.includes(field)&&finite(threshold)&&Number.isSafeInteger(max)&&max>=0&&max<=64&&finite(radius)&&radius>0&&finite(intensity)&&intensity>=0&&vector(color,3)&&color.every(v=>v>=0&&v<=1)&&finite(height),'Invalid ecology lighting');
    return {field,threshold,max,radius,intensity,color:color.slice(),height};
  }
  function lights(sim,options=true){
    const cfg=lightSettings(sim,options);if(!cfg)return [];
    const candidates=[];
    for(let i=0;i<sim.count;i++){const value=sim.read(cfg.field,i);if(value>cfg.threshold)candidates.push({id:i,value});}
    candidates.sort((a,b)=>b.value-a.value||a.id-b.id);
    return candidates.slice(0,cfg.max).map(row=>{const p=sim.point(row.id);p[1]+=cfg.height;return {id:'ecology-'+row.id,p,radius:cfg.radius,intensity:row.value*cfg.intensity,color:cfg.color.slice()};});
  }
  const identity=Object.freeze([1,0,0,0,1]);
  function coefficients(sim,i,rules){
    if(i<0)return identity;
    let gain=1,r=0,g=0,b=0,alpha=1;
    for(const rule of rules){
      const amount=clamp((sim.read(rule.field,i)-rule.range[0])/(rule.range[1]-rule.range[0]),0,1)*rule.weight;
      if(rule.color){gain*=1-amount;r=r*(1-amount)+rule.color[0]*amount;g=g*(1-amount)+rule.color[1]*amount;b=b*(1-amount)+rule.color[2]*amount;}
      alpha*=1+(rule.opacity-1)*amount;
    }
    return [gain,r,g,b,alpha];
  }
  function shade(x,y,z,r,g,b,alpha,c,lamps,out){
    r=r*c[0]+c[1];g=g*c[0]+c[2];b=b*c[0]+c[3];
    for(const light of lamps){
      const dx=x-light.p[0],dy=y-light.p[1],dz=z-light.p[2],distance=Math.hypot(dx,dy,dz);
      if(distance>=light.radius)continue;
      const amount=(1-distance/light.radius)**2*light.intensity;
      r+=amount*light.color[0]*(.25+.5*r);g+=amount*light.color[1]*(.25+.5*g);b+=amount*light.color[2]*(.25+.5*b);
    }
    out[0]=clamp(r,0,1);out[1]=clamp(g,0,1);out[2]=clamp(b,0,1);out[3]=alpha*c[4];return out;
  }
  function atlasPoints(atlas,{point,maxTexels=262144,maxVisits=4000000}={}){
    check(Number.isSafeInteger(maxTexels)&&maxTexels>0&&maxTexels<=4194304&&Number.isSafeInteger(maxVisits)&&maxVisits>0&&maxVisits<=16000000,'Invalid ecology atlas budget');
    check(atlas&&Number.isSafeInteger(atlas.width)&&Number.isSafeInteger(atlas.height)&&atlas.width>0&&atlas.height>0&&atlas.width*atlas.height<=maxTexels&&
      atlas.pixels instanceof Uint8Array&&atlas.pixels.length===atlas.width*atlas.height*4,'Invalid ecology texture atlas or texel budget');
    const N=atlas.width*atlas.height,positions=new Float32Array(N*3),mapped=new Uint8Array(N);
    if(point){
      check(typeof point==='function','Texture point mapping must be a function');
      for(let i=0;i<N;i++){const x=i%atlas.width,y=Math.floor(i/atlas.width),p=point((x+.5)/atlas.width,(y+.5)/atlas.height,x,y);
        if(p===null)continue;check(vector(p,3),'Texture mapping needs world XYZ points');positions.set(p,i*3);mapped[i]=1;}
    }else{
      const v=atlas.vertices;check(v instanceof Float32Array&&v.length%15===0&&v.every(finite),'Texture binding needs atlas triangles or a point sampler');
      let visits=0;
      for(let t=0;t<v.length;t+=15){
        const a=Array.from(v.subarray(t,t+5)),b=Array.from(v.subarray(t+5,t+10)),c=Array.from(v.subarray(t+10,t+15));
        const den=(b[4]-c[4])*(a[3]-c[3])+(c[3]-b[3])*(a[4]-c[4]);if(Math.abs(den)<1e-12)continue;
        const x0=Math.max(0,Math.ceil(Math.min(a[3],b[3],c[3])-.5-1e-6)),x1=Math.min(atlas.width-1,Math.floor(Math.max(a[3],b[3],c[3])-.5+1e-6));
        const y0=Math.max(0,Math.ceil(Math.min(a[4],b[4],c[4])-.5-1e-6)),y1=Math.min(atlas.height-1,Math.floor(Math.max(a[4],b[4],c[4])-.5+1e-6));
        visits+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);check(visits<=maxVisits,'Ecology atlas mapping exceeds triangle visit budget');
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const u=((b[4]-c[4])*(x+.5-c[3])+(c[3]-b[3])*(y+.5-c[4]))/den;
          const w=((c[4]-a[4])*(x+.5-c[3])+(a[3]-c[3])*(y+.5-c[4]))/den,z=1-u-w;
          if(Math.min(u,w,z)<-1e-5)continue;
          const i=y*atlas.width+x,p=[0,1,2].map(k=>a[k]*u+b[k]*w+c[k]*z);
          if(mapped[i])check(Math.hypot(...p.map((value,k)=>value-positions[i*3+k]))<.001,'Ecology needs unique world positions per atlas texel; fork reused tiles');
          positions.set(p,i*3);mapped[i]=1;
        }
      }
    }
    check(positions.every(finite),'Texture mapping exceeds finite storage');return {positions,mapped};
  }
  function bind(stage,sim,options={}){
    check(stage?.D instanceof Float32Array&&stage.base instanceof Float32Array&&typeof stage.repaint==='function','Ecology binding needs a splat stage');
    check(sim&&typeof sim.changes==='function','Ecology binding needs a shared simulation');
    const occupied=splatOwners.get(stage)??new Set(),rows=new Map(),byCell=Array.from({length:sim.count},()=>[]),textures=[];
    const caches=new Map();
    function prepareRules(list){const rules=styles(sim,list),key=JSON.stringify(rules);if(!caches.has(key))caches.set(key,{rules,cells:new Map()});return caches.get(key);}
    function cached(cache,i){if(!cache.cells.has(i))cache.cells.set(i,coefficients(sim,i,cache.rules));return cache.cells.get(i);}
    const defaults=options.style??[],lightConfig=lightSettings(sim,options.lights),metadata=TargetSelectors.index(stage.W);
    for(const raw of options.splats??[]){
      check((raw.ids===undefined)!==(raw.selector===undefined),'Choose ecology splat IDs or a selector');
      let ids=raw.ids;
      if(raw.selector){const selector=TargetSelectors.prepare(raw.selector);ids=[];for(let i=0;i<stage.N;i++)if(TargetSelectors.matches(selector,metadata.row(i)))ids.push(i);}
      check((Array.isArray(ids)||ArrayBuffer.isView(ids))&&ids.length>0,'Empty ecology splat binding');
      const rules=prepareRules(raw.style??defaults);
      for(const id of ids){
        check(Number.isSafeInteger(id)&&id>=0&&id<stage.N&&!rows.has(id)&&!occupied.has(id),'Ecology splat ownership must be distinct');
        const p=Array.from(stage.D.subarray(id*16,id*16+3)),cell=sim.cell(p),row={id,cell,rules,dynamic:Boolean(raw.dynamic)};
        rows.set(id,row);if(cell>=0)byCell[cell].push(id);
      }
    }
    for(const raw of options.textures??[]){
      const atlas=raw.atlas;check(!atlasOwners.has(atlas)&&!textures.some(t=>t.atlas===atlas),'Texture atlas already has an ecology binding');
      const mapping=atlasPoints(atlas,raw),base=atlas.pixels.slice(),buckets=Array.from({length:sim.count},()=>[]);
      for(let i=0;i<mapping.mapped.length;i++)if(mapping.mapped[i]&&base[i*4+3]){const p=Array.from(mapping.positions.subarray(i*3,i*3+3)),cell=sim.cell(p);if(cell>=0)buckets[cell].push(i);}
      textures.push({atlas,base,...mapping,buckets,rules:prepareRules(raw.style??defaults)});
    }
    for(const id of rows.keys())occupied.add(id);splatOwners.set(stage,occupied);for(const t of textures)atlasOwners.add(t.atlas);
    let version=-1,currentLights=[],disposed=false;
    function paint(id,rgba){
      const row=rows.get(id);if(!row||disposed)return;
      const q=id*16,D=stage.D,x=D[q],y=D[q+1],z=D[q+2],i=row.dynamic?sim.cell([x,y,z]):row.cell;
      shade(x,y,z,rgba[0],rgba[1],rgba[2],rgba[3],cached(row.rules,i),currentLights,rgba);
    }
    function update(){
      if(disposed)return;
      const revision=sim.stats.version;
      const dynamic=[...rows.values()].filter(r=>r.dynamic);
      if(version===revision){for(const row of dynamic)stage.repaint(row.id);return;}
      const changes=sim.changes(Math.max(0,version)),affected=new Set(changes.cells);
      const nextLights=lightConfig?lights(sim,lightConfig):[];
      for(const lamp of [...currentLights,...nextLights])for(const i of sim.cellsInDisc(lamp.p,lamp.radius))affected.add(i);
      currentLights=nextLights;for(const cache of caches.values())cache.cells.clear();
      for(const i of affected)for(const id of byCell[i])stage.repaint(id);for(const row of dynamic)stage.repaint(row.id);
      for(const texture of textures){
        let x0=texture.atlas.width,y0=texture.atlas.height,x1=-1,y1=-1;
        const rgba=[0,0,0,0];
        for(const cell of affected){const c=cached(texture.rules,cell);for(const i of texture.buckets[cell]){
          const p=i*3,q=i*4,positions=texture.positions,base=texture.base,pixels=texture.atlas.pixels;
          shade(positions[p],positions[p+1],positions[p+2],base[q]/255,base[q+1]/255,base[q+2]/255,base[q+3]/255,c,currentLights,rgba);
          const r=Math.round(rgba[0]*255),g=Math.round(rgba[1]*255),b=Math.round(rgba[2]*255),alpha=Math.round(rgba[3]*255);
          if(r===pixels[q]&&g===pixels[q+1]&&b===pixels[q+2]&&alpha===pixels[q+3])continue;
          pixels[q]=r;pixels[q+1]=g;pixels[q+2]=b;pixels[q+3]=alpha;
          const x=i%texture.atlas.width,y=Math.floor(i/texture.atlas.width);
          x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
        }}
        if(x1>=0)SpriteSurface.markDirty(texture.atlas,{x:x0,y:y0,width:x1-x0+1,height:y1-y0+1});
      }
      version=changes.version;
    }
    const api={paint,update,get lights(){return currentLights.map(l=>({...l,p:l.p.slice(),color:l.color.slice()}));},
      dispose(){if(disposed)return;disposed=true;for(const id of rows.keys()){occupied.delete(id);stage.repaint(id);}
        for(const t of textures){t.atlas.pixels.set(t.base);SpriteSurface.markDirty(t.atlas);atlasOwners.delete(t.atlas);}
        for(const list of [stage.systems,stage.painters]){const i=list.indexOf(api);if(i>=0)list.splice(i,1);}}
    };
    return api;
  }
  E.bind=bind;E.lights=lights;E.atlasPoints=atlasPoints;E.atlasUpdates=SpriteSurface.updatesSince;
  E.appearance=(sim,point,rgb,{alpha=1,style=[],lights:lamps=[]}={})=>{const out=shade(...point,...rgb,alpha,coefficients(sim,sim.cell(point),styles(sim,style)),lamps,[]);return {rgb:out.slice(0,3),alpha:out[3]};};
})(KIT);
(function(K){
  K.ecology.contacts=(sim,{read,map=event=>event,max=1024}={})=>{
    if(typeof read!=='function'||typeof map!=='function'||!Number.isSafeInteger(max)||max<1||max>4096)throw new RangeError('Invalid ecology contact binding');
    return {update(){const rows=read();if(!Array.isArray(rows)||rows.length>max)throw new RangeError('Ecology contact source exceeds budget');
      for(const row of rows){const contact=map(row);if(contact!==null&&contact!==undefined)sim.contact(contact);}}};
  };
})(KIT);
