/* Layered surface values in persistent chart coordinates. */
(function (K) {
  const P=K.procedural, {clone,freeze}=P.data;
  const own=(row,key)=>Object.hasOwn(row,key), finite=Number.isFinite, clamp=K.clamp;
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const unit=value=>finite(value)&&value>=0&&value<=1;
  const uv=value=>Array.isArray(value)&&value.length===2&&value.every(unit);
  const name=value=>typeof value==='string'&&value.length>0&&value.length<=200&&
    !['__proto__','constructor','prototype'].includes(value);
  const full=freeze({min:[0,0],max:[1,1]});
  const defaults=freeze({
    paint:{type:'color'}, heat:{type:'number',default:20,min:-273.15,max:1e4,units:'degC'},
    grime:{type:'number',default:0,min:0,max:1}, scar:{type:'number',default:0,min:0,max:1},
    wear:{type:'number',default:0,min:0,max:1}, wetness:{type:'number',default:0,min:0,max:1}
  });
  function check(condition,message) {if(!condition)throw Error(message);}
  const scalar=(schema,value)=>finite(value)&&value>=schema.min&&value<=schema.max;
  const color=value=>ColorCurves.color(value);
  const inside=(p,box)=>p.every((v,i)=>v>=box.min[i]&&v<=box.max[i]);
  const window=box=>keys(box,['min','max'])&&uv(box.min)&&uv(box.max)&&box.max.every((v,i)=>v>box.min[i]);
  const into=(point,box=full)=>point.map((v,i)=>box.min[i]+v*(box.max[i]-box.min[i]));

  function channels(extra={}) {
    check(record(extra)&&Object.keys(extra).length<=16,'Expected a bounded surface channel table');
    const definitions={...defaults};
    for(const [key,spec] of Object.entries(extra)){
      check(name(key)&&(!own(defaults,key)||key==='wetness')&&keys(spec,['type','default','min','max','units'])&&
        ['number','color'].includes(spec.type),'Invalid surface channel '+key);
      if(spec.type==='number'){
        check(finite(spec.min)&&finite(spec.max)&&spec.min<=spec.max&&scalar(spec,spec.default)&&
          (spec.units===undefined||typeof spec.units==='string'&&spec.units.length<=64),'Invalid scalar surface channel '+key);
      }else check(keys(spec,['type']),'A color surface channel starts transparent');
      definitions[key]=clone(spec);
    }
    return freeze(definitions);
  }
  function mask(brush,size) {
    check(record(brush),'A surface stamp needs a brush');
    if(brush.kind==='stroke') {
      check(keys(brush,['kind','points','width','softness']),'Invalid surface stroke');
      const compiled=P.surfaceMasks.compile([{points:brush.points,width:brush.width,softness:brush.softness??0}],{size});
      return ([u,v])=>compiled.weight(u,v);
    }
    const box={min:brush.min,max:brush.max};
    check(window(box), 'A surface brush needs ordered unit UV bounds');
    if(brush.kind==='rect') {
      check(keys(brush,['kind','min','max']),'Invalid surface rectangle');
      return p=>Number(inside(p,box));
    }
    const rows=brush.rows;
    check(brush.kind==='bitmap'&&keys(brush,['kind','min','max','rows'])&&Array.isArray(rows)&&rows.length>=1&&rows.length<=128&&
      rows.every(row=>typeof row==='string'&&row.length===rows[0].length&&/^[.#]{1,256}$/.test(row)),
    'A surface bitmap needs equal-width rows of . and #');
    return p=>{
      if(!inside(p,box))return 0;
      const [x,y]=p.map((v,i)=>(v-box.min[i])/(box.max[i]-box.min[i]));
      const row=rows[Math.min(rows.length-1,Math.floor((1-y)*rows.length))];
      return Number(row[Math.min(row.length-1,Math.floor(x*row.length))]==='#');
    };
  }
  function stamp(spec,size,definitions) {
    check(keys(spec,['channel','value','mode','strength','brush','window'])&&own(definitions,spec.channel),
      'Unknown surface channel or stamp arguments');
    const {channel,mode='set',strength=1,window:chartWindow=full}=spec, type=definitions[channel].type;
    check(window(chartWindow)&&unit(strength)&&['set','add','clear'].includes(mode)&&
      (mode!=='add'||type==='number'),'Invalid surface stamp mode, strength or window');
    let value;
    if(mode!=='clear'){
      if(type==='color') value=color(spec.value);
      else {
        const schema=definitions[channel];
        check(mode==='add'?finite(spec.value)&&Math.abs(spec.value)<=1e9:scalar(schema,spec.value),'Invalid scalar surface stamp value');
        value=spec.value;
      }
    }
    const span=chartWindow.max.map((v,i)=>v-chartWindow.min[i]);
    const weight=mask(spec.brush,size.map((v,i)=>v*span[i]));
    return {channel,mode,strength,value,amount:p=>inside(p,chartWindow)?
      weight(p.map((v,i)=>clamp((v-chartWindow.min[i])/span[i],0,1)))*strength:0};
  }
  function stampList(list,size,definitions) {
    check(Array.isArray(size)&&size.length===2&&size.every(n=>finite(n)&&n>0&&n<=5e5)&&
      Array.isArray(list)&&list.length<=256,'A surface chart needs a bounded size and at most 256 stamps');
    const pointCount=list.reduce((sum,row)=>sum+(row?.brush?.points?.length??0),0);
    check(pointCount<=8192,'Surface chart exceeds its stroke point budget');
    return list.map(row=>stamp(row,size,definitions));
  }
  function prepare(list=[],{size=[1,1],definitions=defaults}={}) {
    const rows=stampList(list,size,definitions);
    return Object.freeze({sample(point) {
      check(uv(point),'Surface sampling needs unit UV coordinates');
      const values=Object.fromEntries(Object.entries(definitions).map(([key,schema])=>[key,schema.type==='color'?null:schema.default]));
      for(const {channel,mode,value,amount} of rows){
        const a=amount(point);
        if(!a)continue;
        const schema=definitions[channel], before=values[channel];
        if(schema.type==='color'){
          const retained=(before?.coverage??0)*(1-a);
          if(mode==='clear') values[channel]=retained?{color:before.color.slice(),coverage:retained}:null;
          else {
            const coverage=a+retained;
            values[channel]={color:value.map((v,i)=>(v*a+(before?.color[i]??0)*retained)/coverage),coverage};
          }
        }else if(mode==='add')values[channel]=clamp(before+value*a,schema.min,schema.max);
        else values[channel]=before*(1-a)+(mode==='clear'?schema.default:value)*a;
      }
      return values;
    }});
  }
  function correspondence(corners,weights) {
    check(Array.isArray(corners)&&corners.length===3&&Array.isArray(weights)&&weights.length===3&&weights.every(unit)&&
      Math.abs(weights.reduce((a,b)=>a+b,0)-1)<=1e-8,'Surface correspondence needs three barycentric weights');
    if(!corners.every(row=>record(row)&&name(row.chart)&&uv(row.uv))||!corners.every(row=>row.chart===corners[0].chart))return null;
    const total=weights.reduce((a,b)=>a+b,0);
    return {chart:corners[0].chart,uv:[0,1].map(i=>clamp(corners.reduce((a,row,j)=>a+row.uv[i]*weights[j]/total,0),0,1))};
  }
  const wetness=values=>finite(values.wetness)?clamp(values.wetness,0,1):0;
  const active=values=>values.paint||(values.heat??20)!==20||values.grime||values.scar||values.wear||wetness(values);
  const mix=(a,b,t)=>a+(b-a)*t;
  const linear=ColorSpace.prepare('srgb','srgb-linear'), display=ColorSpace.prepare('srgb-linear','srgb');
  function shade(rgb,values,light=1) {
    const {paint,heat=20,grime=0,scar=0,wear=0}=values, wet=wetness(values);
    const ink=(paint?.coverage??0)*(1-wear), tint=clamp((heat-20)/350,0,.45);
    return rgb.map((v,k)=>{
      const worn=mix(v,180,wear*.23);
      const marked=mix(worn,(paint?.color[k]??0)*255*light,ink);
      return mix(marked,[255,105,39][k],tint)*(1-.55*grime)*(1-.4*scar)*(1-wet*[.36,.28,.2][k]);
    });
  }
  function ramp(indices,palette,values) {
    if(!active(values))return indices;
    return indices.map((index,i)=>{
      const rgb=palette[index]??palette[1]??palette[0], light=.45+.55*i/Math.max(1,indices.length-1);
      return PixelLook.nearest(shade(rgb,values,light),palette,true);
    });
  }
  function colorFor(input,palette,fallback) {
    if(input===undefined)return palette[fallback];
    if(Number.isSafeInteger(input))return palette[input];
    return color(input).map(v=>v*255);
  }
  function appearance(base,hit,palette,point) {
    const {values,chart}=hit, adjusted={...base,surfaceId:chart};
    if(!active(values))return adjusted;
    const source=base.rf?.(...point)||base.r;
    adjusted.r=ramp(source,palette,values);
    adjusted.rf=undefined;
    const rgb=colorFor(base.albedo,palette,source.at(-1));
    if(rgb)adjusted.albedo=shade(rgb,values).map(v=>v/255);
    const wet=wetness(values);
    if(base.model||wet)adjusted.model=(point,normal)=>{
      const model=typeof base.model==='function'?base.model(point,normal):base.model;
      const modelRGB=model?.color&&display(model.color).map(v=>v*255);
      return {...model,...(modelRGB&&{color:linear(shade(modelRGB,values).map(v=>v/255))}),
        ...(wet&&{roughness:mix(model?.roughness??.8,.25,wet)})};
    };
    return adjusted;
  }
  function bind(material,locate,palette) {
    return {...material,surfaceState:{locate,apply(base,hit,point) {
      return appearance(base,hit,palette,point);
    }}};
  }
  const xyz=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(finite);
  function projection(spec) {
    check(keys(spec,['charts'])&&record(spec.charts)&&Object.keys(spec.charts).length>0&&Object.keys(spec.charts).length<=32,
      'Expected one to 32 named rest surface charts');
    const {V}=K;
    const projectors=Object.entries(clone(spec.charts)).map(([chart,row])=>{
      check(name(chart)&&keys(row,['origin','u','v','depth','twoSided','stamps']),'Invalid rest surface chart '+chart);
      const {origin,u,v,depth=.035,twoSided=false,stamps=[]}=row;
      check([origin,u,v].every(xyz)&&finite(depth)&&depth>0&&depth<=1e4&&typeof twoSided==='boolean',
        'Surface chart needs a finite origin, UV axes and positive depth');
      const cross=V.cross(u,v), uu=V.dot(u,u), vv=V.dot(v,v), uv=V.dot(u,v), det=V.dot(cross,cross);
      check(det>1e-12&&det>uu*vv*1e-10,'Surface chart UV axes must span a plane');
      const n=V.norm(cross), sampler=prepare(stamps,{size:[Math.sqrt(uu),Math.sqrt(vv)]});
      return {chart,sampler,point(point,normal) {
        const delta=V.sub(point,origin), distance=Math.abs(V.dot(delta,n)), facing=V.dot(n,normal);
        if(distance>depth||(twoSided?Math.abs(facing):facing)<.5)return null;
        const a=V.dot(delta,u), b=V.dot(delta,v);
        const p=[(vv*a-uv*b)/det,(uu*b-uv*a)/det];
        if(p.some(value=>value< -1e-6||value>1+1e-6))return null;
        return {distance,uv:p.map(value=>clamp(value,0,1))};
      }};
    });
    return (point,normal)=>{
      let best, distance=Infinity;
      for(const row of projectors){
        const hit=row.point(point,normal);
        if(hit&&hit.distance<distance){best={row,uv:hit.uv};distance=hit.distance;}
      }
      return best?{chart:best.row.chart,uv:best.uv,values:best.row.sampler.sample(best.uv)}:null;
    };
  }
  P.surfaceState=Object.freeze({channels,prepare,correspondence,projection,bind,appearance,ramp,window,into,isUv:uv,full});
})(KIT);
