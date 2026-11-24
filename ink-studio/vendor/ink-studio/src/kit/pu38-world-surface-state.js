/* Box surfaces own windows into an atlas which survives pose and shape edits. */
(function (K) {
  const W=K.world, S=K.procedural.surfaceState, {V,M}=K, {check,record,id,vector,own}=W.data;
  const {clamp}=W.fields;
  const faces=['-x','+x','-y','+y','-z','+z'];
  const axes={x:[0,2,1],y:[1,0,2],z:[2,0,1]};
  const compiled=new WeakMap();
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const chartId=(body,face)=>body+'/'+face;
  const stateId=mapping=>mapping.stateChart??mapping.chart;
  function newId(charts,body,face) {
    const stem=chartId(body,face);
    let name=stem, index=1;
    while(own(charts,name))name=stem+'~'+index++;
    return name;
  }
  const validRamp=ramp=>Array.isArray(ramp)&&ramp.length>=1&&ramp.length<=16&&
    ramp.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=255);
  const newChart=(half,face,stamps=[],fresh=false)=>({size:axes[face[1]].slice(1).map(i=>half[i]*2),stamps,fresh});
  function read(chart,definitions) {
    let values=compiled.get(chart);
    if(!values||values.definitions!==definitions) {
      values={definitions,sampler:S.prepare(chart.stamps,{size:chart.size,definitions})};
      compiled.set(chart,values);
    }
    return values.sampler;
  }
  function freshStyle(style) {
    return keys(style,['material','ramp'])&&(style.material===undefined||TargetSelectors.name(style.material))&&
      (style.ramp===undefined||validRamp(style.ramp));
  }
  function init(body,spec,charts,definitions) {
    check(keys(spec,['faces','fresh'])&&record(spec.faces??{})&&
      Object.keys(spec.faces??{}).every(face=>faces.includes(face))&&freshStyle(spec.fresh??{}),'Invalid body surface state');
    const mapping={};
    for(const face of faces){
      const chart=newId(charts,body.id,face);
      charts[chart]=newChart(body.half,face,(spec.faces??{})[face]??[]);
      read(charts[chart],definitions);
      mapping[face]={chart,window:S.full};
    }
    return {...body,surfaceState:{faces:mapping,fresh:spec.fresh??{}}};
  }
  function fragment(parent,child,axis,index,parts,charts) {
    if(!parent.surfaceState)return child;
    const mapping={};
    for(const face of faces){
      const [along,u]=axes[face[1]], previous=parent.surfaceState.faces[face];
      if(along===axis) {
        const outer=face[0]==='-'?index===0:index===parts-1;
        if(outer)mapping[face]=previous;
        else {
          const chart=newId(charts,child.id,face);
          charts[chart]=newChart(child.half,face,[],true);
          mapping[face]={chart,window:S.full};
        }
      }else{
        const rc=u===axis?0:1, lo=[0,0], hi=[1,1];
        lo[rc]=index/parts;hi[rc]=(index+1)/parts;
        mapping[face]={...previous,window:{min:S.into(lo,previous.window),max:S.into(hi,previous.window)}};
      }
    }
    return {...child,surfaceState:{faces:mapping,fresh:parent.surfaceState.fresh}};
  }
  function prune(charts,bodies) {
    const retained=new Set(Object.values(bodies).flatMap(body=>Object.values(body.surfaceState?.faces??{}).map(stateId)));
    for(const name of Object.keys(charts))if(!retained.has(name))delete charts[name];
  }
  function checkStamp(args,definitions) {
    check(keys(args,['body','face','stamp'])&&id(args.body)&&faces.includes(args.face)&&record(args.stamp)&&
      !own(args.stamp,'window'),'A surface stamp needs a body, a face and local UV brush');
    S.prepare([args.stamp],{definitions});
  }
  function apply(state,args,definitions,ctx) {
    const {body:key,face,stamp}=args;
    check(own(state.bodies,key),'Unknown body '+key);
    const charts={...state.surfaceCharts};
    let body=state.bodies[key].surfaceState?state.bodies[key]:init(state.bodies[key],{},charts,definitions);
    const mapping=body.surfaceState.faces[face], source=stateId(mapping), chart=charts[source];
    const shared=Object.values(state.bodies).some(other=>other.id!==key&&
      Object.values(other.surfaceState?.faces??{}).some(row=>stateId(row)===source));
    const edited=shared?newId(charts,body.id,face):source;
    const next={...chart,stamps:[...chart.stamps,{...stamp,window:mapping.window}]};
    read(next,definitions);
    charts[edited]=next;
    if(shared)body={...body,surfaceState:{...body.surfaceState,
      faces:{...body.surfaceState.faces,[face]:{...mapping,stateChart:edited}}}};
    const bodies={...state.bodies,[key]:body};
    ctx.emit('surface-stamped',{body:key,face,chart:mapping.chart,channel:stamp.channel});
    return {...state,bodies,surfaceCharts:charts};
  }
  function validate(state,definitions) {
    const charts=state.surfaceCharts;
    if(charts!==undefined){
      check(record(charts)&&Object.keys(charts).length<=6144,'Invalid saved surface charts');
      for(const [key,chart] of Object.entries(charts)){
        check(TargetSelectors.name(key)&&keys(chart,['size','stamps','fresh'])&&typeof chart.fresh==='boolean','Invalid saved surface chart');
        read(chart,definitions);
      }
    }
    for(const body of Object.values(state.bodies)) {
      const spec=body.surfaceState;
      if(spec===undefined)continue;
      check(keys(spec,['faces','fresh'])&&freshStyle(spec.fresh)&&keys(spec.faces,faces)&&
        faces.every(face=>{
          const row=spec.faces[face];
          return keys(row,['chart','window','stateChart'])&&TargetSelectors.name(row.chart)&&
            (row.stateChart===undefined||TargetSelectors.name(row.stateChart))&&own(charts??{},stateId(row))&&S.window(row.window);
        }),'Invalid saved body surface correspondence');
    }
  }
  function frame(body) {
    const inverse=M.tr(body.rotation??M.id());
    function locate(point,normal,chosen) {
      const position=M.app(inverse,V.sub(point,body.position)), normalInBody=normal&&M.app(inverse,normal);
      const local=W.durability.unbendPoint(body,position), n=W.durability.unbendNormal(body,position,normalInBody);
      let face=chosen;
      if(!face){
        let axis=0, best=-Infinity;
        for(let i=0;i<3;i++){
          const distance=n?Math.abs(n[i]):-Math.abs(Math.abs(local[i])-body.half[i]);
          if(distance>best){axis=i;best=distance;}
        }
        face=((n??local)[axis]<0?'-':'+')+'xyz'[axis];
      }
      return {face,uv:axes[face[1]].slice(1).map(i=>clamp(.5+local[i]/(2*body.half[i]),0,1))};
    }
    return locate;
  }
  function sample(body,charts,definitions,face,uv) {
    const mapping=body.surfaceState?.faces[face];
    if(!mapping)return null;
    const chart=charts[stateId(mapping)], rest=S.into(uv,mapping.window);
    return {face,uv,chart:mapping.chart,rest,fresh:chart.fresh,values:read(chart,definitions).sample(rest)};
  }
  function materialSampler(body,atlas,base,palette) {
    if(!body.surfaceState||!atlas)return null;
    const locate=frame(body), fresh=body.surfaceState.fresh;
    return (x,y,z,nx,ny,nz)=>{
      const at=locate([x,y,z],[nx,ny,nz]), hit=sample(body,atlas.charts,atlas.channels,at.face,at.uv);
      const raw=hit.fresh&&fresh.ramp?fresh.ramp:base.r;
      const selected=raw.map(swatch=>palette[swatch]?swatch:Math.min(1,palette.length-1));
      return S.appearance({...base,r:selected,materialId:hit.fresh?fresh.material??base.materialId:base.materialId},
        hit,palette,[x,y,z]);
    };
  }
  W.surfaceState=Object.freeze({init,fragment,prune,checkStamp,apply,validate,frame,sample,materialSampler,
    isFace:face=>faces.includes(face)});
})(KIT);
