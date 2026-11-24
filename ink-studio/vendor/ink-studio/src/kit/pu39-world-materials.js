/* Shared material lookup and stateful surfaces for headless worlds. */
(function (K) {
  const W=K.world, Q=W.query, spatial=W.spatialFields, P=K.authoring.physicalMaterials;
  const {check,record,vector,own}=W.data, {bounds,clamp}=W.fields;
  const cached=new WeakMap();
  function catalog(world) {
    const packs=world.assetPacks;
    if (!packs?.length) return undefined;
    if (!cached.has(packs)) cached.set(packs,K.authoring.assetPacks.create({packs}));
    return cached.get(packs);
  }
  function requireAsset(catalog,id) {
    const entry=catalog?.getMaterial(id);
    check(entry,'Unknown physical material '+id);
    return entry;
  }
  function forBody(catalog,world,body) {
    const entity=own(world.entities,body.entity)?world.entities[body.entity]:null;
    const id=body.materialAsset??entity?.materialAsset;
    if (id===undefined) return null;
    const wetness=body.materialWetness??(id===entity?.materialAsset?entity.materialWetness:0)??0;
    return P.profile(requireAsset(catalog,id),wetness);
  }
  function validateEntity(catalog,entity) {
    if (entity.materialAsset!==undefined) requireAsset(catalog,entity.materialAsset);
    if (entity.materialWetness!==undefined) {
      check(entity.materialAsset!==undefined&&finite(entity.materialWetness,0,1),
        'Entity material wetness needs a material asset and a fraction from 0 to 1');
    }
  }
  function probe(query,field,point) {
    const read=field&&query?.probe(field,point);
    return read?.status==='ok'?read.value:null;
  }
  function checkSurface(query,field) {
    check(field===undefined||query.field(field)?.materialProfile===true,'Expected a physical surface field '+field);
  }
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const readRange=({min,max},coordinate,cell,size)=>[
    Math.max(0,Math.ceil((min-coordinate)/cell-.5)),Math.min(size-1,Math.floor((max-coordinate)/cell-.5))
  ];

  function surfaces(config,{id,catalog}) {
    const {width,height,cell=1,origin=[0,0]}=config.grid??{};
    const {water,ambientField,airTemperature=20,wettingRate=3}=config;
    check(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>=1&&height>=1&&width*height<=65536&&
      finite(cell,1e-4,1e4)&&vector(origin,2)&&origin.every(value=>Math.abs(value)<1e10),
    'Material surfaces need a bounded XZ grid');
    check(finite(airTemperature,-273.15,1e4)&&finite(wettingRate,0,100)&&
      [water,ambientField].every(field=>field===undefined||typeof field==='string'),
    'Invalid material surface climate');
    const region={min:origin,max:[origin[0]+width*cell,origin[1]+height*cell]};
    const domain={axes:'xz',sampling:'cell',boundary:'half-open',bounds:region};
    const worldBounds={...region,axes:'xz'};
    const count=width*height, specs=new Array(count), wetness=new Array(count), temperature=new Array(count);
    const initialWetness=config.wetness??0, initialTemperature=config.temperature??airTemperature;
    const defaultAsset=requireAsset(catalog,config.material);
    const entries=new Map([[config.material,defaultAsset]]);
    check(finite(initialWetness,0,1)&&finite(initialTemperature,-273.15,1e4),'Invalid initial material surface state');
    specs.fill(defaultAsset); wetness.fill(initialWetness); temperature.fill(initialTemperature);
    const zones=config.regions??[];
    check(Array.isArray(zones)&&zones.length<=256,'Too many material regions');
    for (const zone of zones) {
      check(record(zone)&&Object.keys(zone).every(key=>['bounds','material','wetness','temperature'].includes(key)),
        'Invalid material region');
      const entry=requireAsset(catalog,zone.material), area=bounds(zone.bounds,2);
      check(finite(zone.wetness??initialWetness,0,1)&&finite(zone.temperature??initialTemperature,-273.15,1e4),
        'Invalid initial material region state');
      entries.set(zone.material,entry);
      const [x0,x1]=readRange({min:area.min[0],max:area.max[0]},origin[0],cell,width);
      const [z0,z1]=readRange({min:area.min[1],max:area.max[1]},origin[1],cell,height);
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const i=z*width+x;
        specs[i]=entry;
        wetness[i]=zone.wetness??initialWetness;
        temperature[i]=zone.temperature??initialTemperature;
      }
    }
    const category=[...entries.keys()];
    check(category.length<=256,'Too many physical materials in the surface grid');
    const index=(x,z)=>{
      const col=Math.floor((x-origin[0])/cell), row=Math.floor((z-origin[1])/cell);
      return col>=0&&col<width&&row>=0&&row<height?row*width+col:-1;
    };
    const point=i=>[origin[0]+(i%width+.5)*cell,0,origin[1]+(Math.floor(i/width)+.5)*cell];
    const lookup=new WeakMap();
    function response(state,i) {
      let rows=lookup.get(state);
      if (!rows) {rows=new Array(count);lookup.set(state,rows);}
      return rows[i]??={...P.profile(specs[i],state.wetness[i]),temperature:state.temperature[i]};
    }
    function channel(type,units,value,extra) {
      return spatial.define({type,units,...domain,...extra},({state,point,explain})=>{
        if (!state) return Q.missing('surface state is unavailable');
        const i=index(...point);
        if(i<0)return Q.missing('outside material grid','outside');
        return {status:'ok',value:value(state,i),...(explain&&{source:{kind:'material-cell',
          cell:[i%width,Math.floor(i/width)],asset:specs[i].material.id,revision:specs[i].revision}})};
      });
    }
    function update(state,ctx) {
      const nextWet=state.wetness.slice(), nextTemp=state.temperature.slice();
      let lowX=width,highX=-1,lowZ=height,highZ=-1, wetChanged=false,tempChanged=false;
      for(let i=0;i<count;i++){
        const current=response(state,i), at=point(i);
        const measured=probe(ctx.query,ambientField,at);
        const ambient=finite(measured,-273.15,1e4)?measured:airTemperature;
        const heat=current.thermal;
        if(heat?.conductance>0&&current.temperature!==ambient)
          nextTemp[i]=clamp(ambient+(current.temperature-ambient)*Math.exp(-heat.conductance/heat.heatCapacity*ctx.dt),-273.15,1e4);
        const submerged=probe(ctx.query,water,at)?.depth>1e-6;
        if (submerged) {
          if (wettingRate>0) nextWet[i]=1-(1-current.wetness)*Math.exp(-wettingRate*ctx.dt);
        } else nextWet[i]=current.wetness*Math.exp(-(current.dryingRate??0)*clamp(1+(nextTemp[i]-20)/40,0,3)*ctx.dt);
        const wet=nextWet[i]!==current.wetness, temp=nextTemp[i]!==current.temperature;
        if (!wet&&!temp) continue;
        const x=i%width,z=Math.floor(i/width);
        lowX=Math.min(lowX,x);highX=Math.max(highX,x);lowZ=Math.min(lowZ,z);highZ=Math.max(highZ,z);
        wetChanged ||= wet;
        tempChanged ||= temp;
      }
      if (!wetChanged&&!tempChanged) return state;
      const area={axes:'xz',min:[origin[0]+lowX*cell,origin[1]+lowZ*cell],
        max:[origin[0]+(highX+1)*cell,origin[1]+(highZ+1)*cell]};
      if (wetChanged) ctx.spatial?.write('wetness',area,'material-moisture');
      if (tempChanged) ctx.spatial?.write('temperature',area,'material-heat');
      ctx.spatial?.write('surface',area,'material-response');
      return {wetness:nextWet,temperature:nextTemp};
    }
    return {
      initial:()=>({wetness,temperature}),step:update,
      validateState(state) {
        check(record(state)&&Array.isArray(state.wetness)&&state.wetness.length===count&&state.wetness.every(v=>finite(v,0,1))&&
          Array.isArray(state.temperature)&&state.temperature.length===count&&state.temperature.every(v=>finite(v,-273.15,1e4)),
        'Invalid material surface checkpoint');
      },
      dependencies:{writes:[id+'/surface',id+'/wetness',id+'/temperature'],
        reads:[water,ambientField].filter(Boolean).map(field=>({field,bounds:worldBounds}))},
      checkFields(query) {
        if (water) check(query.field(water)?.type==='record','Material wetting needs a water column field '+water);
        if (ambientField) {
          const ambient=query.field(ambientField);
          check(ambient?.type==='number'&&ambient.units==='degC','Material climate needs a numeric degC field '+ambientField);
        }
      },
      fields:{
        material:channel('category','1',(_,i)=>specs[i].material.id,{categories:category}),
        wetness:channel('number','1',(state,i)=>state.wetness[i]),
        temperature:channel('number','degC',(state,i)=>state.temperature[i]),
        surface:{type:'record',materialProfile:true,read({state,target,args}) {
          if (!state||!target.point) return Q.missing('surface state and point required');
          const [x,,z]=target.point, i=index(x,z);
          if (i<0) return Q.missing('outside material grid','outside');
          const value=response(state,i);
          return {...Q.ok(value),...(args.explain&&{source:{kind:'material-cell',cell:[i%width,Math.floor(i/width)],
            asset:value.id,pack:value.pack,revision:value.revision}})};
        }}
      }
    };
  }
  W.materials=Object.freeze({catalog,requireAsset,forBody,validateEntity,profile:P.profile,probe,checkSurface});
  W.runtime.register('materials',surfaces);
})(KIT);
