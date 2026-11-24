/* Headless ventilation fields, controls, tracers and checkpointed budgets. */
(function(K){
  const W=K.world, Q=W.query, A=W.airTransport, V=K.V;
  const {record,check,id,vector}=W.data, {bounds,clamp}=W.fields;
  const zero=[0,0,0], maxRate=1e4, counters=['emitted','imported','exported','removed'];
  const ranges=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const point=p=>vector(p)&&p.every(n=>ranges(n,-1e4,1e4));
  const temp=n=>ranges(n,-273.15,1e4), absolute=t=>t+273.15;
  const inside=(p,box)=>p.every((n,i)=>n>=box.min[i]&&n<box.max[i]);
  const overlap=(a,b)=>a.min.every((n,i)=>n<b.max[i]&&a.max[i]>b.min[i]);

  function table(raw,max,kind,compile){
    check(record(raw)&&Object.keys(raw).length<=max,'Invalid '+kind+' table');
    return Object.keys(raw).sort().map(key=>{
      check(id(key)&&key.length<=60&&record(raw[key]),'Invalid '+kind+' '+key);
      return {key,...compile(raw[key],key)};
    });
  }
  function trace(openings,lookup,names,flow,args){
    const {from,to}=args;
    if(!lookup.has(from)||to!==undefined&&!lookup.has(to))return Q.missing('unknown airflow endpoint');
    const start=lookup.get(from), end=lookup.get(to), queue=[start], seen=new Map([[start,null]]);
    const outgoing=names.map(()=>[]);
    openings.forEach((edge,i)=>{
      const q=flow[i];
      if(q>0)outgoing[edge.from].push({target:edge.to,key:edge.key,flow:q});
      if(q<0)outgoing[edge.to].push({target:edge.from,key:edge.key,flow:-q});
    });
    for(let i=0;i<queue.length&&queue[i]!==end;i++){
      const source=queue[i];
      for(const edge of outgoing[source]){
        if(seen.has(edge.target))continue;
        seen.set(edge.target,{source,...edge});queue.push(edge.target);
      }
    }
    if(to===undefined)return Q.ok({from,reachable:queue.slice(1).map(i=>names[i])});
    if(!seen.has(end))return {status:'blocked',reason:'no directed airflow path'};
    const path=[];
    for(let edge=seen.get(end);edge;edge=seen.get(edge.source))
      path.push({opening:edge.key,from:names[edge.source],to:names[edge.target],flow:edge.flow});
    return Q.ok({from,to,path:path.reverse()});
  }

  function ventilation(config,{id:system}){
    const {wind=zero,windField,heatCapacity=1200}=config;
    check(point(wind)&&(windField===undefined||typeof windField==='string')&&ranges(heatCapacity,1e-4,1e8),
      'Invalid ventilation wind or heat capacity');
    const defined=config.tracers??{};
    check(record(defined),'Invalid ventilation tracers');
    const reserved=['heat','temperature','air-quality','room','rooms','openings','budget'];
    const species=table({smoke:{},humidity:{units:'kg'},...defined},24,'air tracer',(row,key)=>{
      const {units=key,decay=0}=row;
      check(!reserved.includes(key)&&typeof units==='string'&&units.length>0&&units.length<=60&&ranges(decay,0,maxRate),
        'Invalid airborne tracer '+key);
      return {units,decay};
    });
    const tracers=[{key:'heat',units:'J',decay:0},...species];
    function climate(row,where){
      const {temperature=20,concentrations={}}=row;
      check(temp(temperature)&&record(concentrations)&&Object.keys(concentrations).every(key=>
        species.some(item=>item.key===key)&&ranges(concentrations[key],0,1e8)),'Invalid air composition at '+where);
      return [absolute(temperature),...species.map(({key})=>concentrations[key]??(key==='humidity'?.008:0))];
    }
    const rooms=table(config.rooms,64,'air room',(raw,key)=>{
      const box=bounds(raw.bounds), volume=box.max.reduce((n,v,i)=>n*(v-box.min[i]),1);
      check(point(box.min)&&point(box.max)&&box.max.every((n,i)=>n-box.min[i]>=.01)&&ranges(volume,.001,1e8),
        'Air room needs positive XYZ volume: '+key);
      return {bounds:box,volume,initial:climate(raw,key)};
    });
    check(rooms.length>0,'Ventilation needs at least one interior room');
    rooms.forEach((row,i)=>{
      for(let j=0;j<i;j++)check(!overlap(row.bounds,rooms[j].bounds),'Air rooms overlap: '+row.key+' and '+rooms[j].key);
    });
    check(config.exterior===undefined||record(config.exterior),'Invalid exterior air reservoirs');
    const outside=table({outside:{},...config.exterior},32,'exterior reservoir',(raw,key)=>({values:climate(raw,key)}));
    const names=[...rooms,...outside].map(row=>row.key), lookup=new Map(names.map((key,i)=>[key,i])), size=rooms.length;
    check(lookup.size===names.length,'Air room and exterior names must be distinct');
    function endpoint(key){
      check(lookup.has(key),'Unknown air endpoint '+key);
      return lookup.get(key);
    }
    const openings=table(config.openings??{},256,'air opening',(raw,key)=>{
      const from=endpoint(raw.from), to=endpoint(raw.to);
      const {conductance=1,opening=1,mixing=.1,fan=0,wind,gate,at}=raw;
      check(from!==to&&(from<size||to<size)&&ranges(conductance,.001,maxRate)&&ranges(opening,0,1)&&
        ranges(mixing,0,maxRate)&&ranges(fan,-maxRate,maxRate),'Invalid air opening '+key);
      if(wind!==undefined)check(record(wind)&&point(wind.at)&&point(wind.direction)&&V.len(wind.direction)>1e-6&&
        ranges(wind.area??1,0,maxRate),'A wind opening needs a point, direction and nonnegative area');
      if(gate!==undefined)check(record(gate)&&typeof gate.field==='string'&&Array.isArray(gate.points)&&
        gate.points.length>0&&gate.points.length<=8&&gate.points.every(point)&&ranges(gate.radius??0,0,maxRate),
      'Invalid air opening clearance gate '+key);
      check(at===undefined||point(at),'Invalid air opening location '+key);
      return {from,to,conductance,opening,mixing,fan,wind,normal:wind?V.norm(wind.direction):null,gate,at};
    });
    const sources=table(config.sources??{},128,'air source',(raw,key)=>{
      const room=endpoint(raw.room), {rates,enabled=1}=raw;
      check(room<size&&record(rates)&&Object.keys(rates).length>0&&Object.keys(rates).every(name=>
        tracers.some(item=>item.key===name)&&ranges(rates[name],0,1e8))&&ranges(enabled,0,1),'Invalid air source '+key);
      return {room,enabled,rates:tracers.map(({key})=>(rates[key]??0)/(key==='heat'?heatCapacity:1))};
    });
    const quality=config.quality??{smoke:1};
    check(record(quality)&&Object.keys(quality).every(key=>species.some(item=>item.key===key)&&ranges(quality[key],0,1e6)),
      'Air-quality weights need known tracers');
    const weights=species.map(({key})=>quality[key]??0), air=outside.map(row=>row.values);
    const inputs={wind:{type:'vec3',default:wind}}, outputs={};
    const input=(key,value)=>{inputs[key]={type:'number',default:value};};
    for(const row of openings){
      input('opening.'+row.key,row.opening);input('fan.'+row.key,row.fan);
      outputs['flow.'+row.key]=outputs['effective-opening.'+row.key]='number';
    }
    for(const row of sources)input('source.'+row.key,row.enabled);
    for(const row of rooms)for(const prefix of ['quality','temperature','humidity','smoke','pressure'])outputs[prefix+'.'+row.key]='number';
    const stock=tracers.map((_,j)=>rooms.map(room=>room.initial[j]*room.volume));
    const initialStock=stock.map(A.total), humidityIndex=tracers.findIndex(row=>row.key==='humidity'),
      smokeIndex=tracers.findIndex(row=>row.key==='smoke');

    function control({input,query}){
      return openings.map(row=>{
        let open=clamp(input['opening.'+row.key]??row.opening,0,1);
        if(open<1e-6)open=0;
        if(open&&row.gate&&!row.gate.points.every(at=>{
          const hit=query.probe(row.gate.field,at);
          return hit.status==='ok'&&hit.value>(row.gate.radius??0);
        }))open=0;
        const fan=clamp(input['fan.'+row.key]??row.fan,-maxRate,maxRate);
        let local=zero, windDrive=0;
        if(row.wind){
          const hit=windField&&query.probe(windField,row.wind.at);
          const value=hit?.status==='ok'?hit.value:input.wind??wind;
          local=(value.length===2?[value[0],0,value[1]]:value).map(n=>clamp(n,-1e4,1e4));
          windDrive=clamp(V.dot(row.normal,local)*(row.wind.area??1),-maxRate,maxRate);
        }
        return {open,fan,wind:local,windDrive,drive:open*(fan+windDrive)};
      });
    }
    const concentration=(state,i,j)=>state.stock[j][i]/rooms[i].volume;
    const score=(state,i)=>1/(1+weights.reduce((load,weight,j)=>load+weight*concentration(state,i,j+1),0));
    function describe(state,i){
      const {key,bounds,volume}=rooms[i];
      return {id:key,bounds,volume,temperature:concentration(state,i,0)-273.15,pressure:state.pressure[i],
        airQuality:score(state,i),concentrations:Object.fromEntries(species.map(({key},j)=>[key,concentration(state,i,j+1)]))};
    }
    function budget(state){
      return Object.fromEntries(tracers.map(({key,units},i)=>{
        const scale=i===0?heatCapacity:1, initial=initialStock[i]*scale, current=A.total(state.stock[i])*scale;
        const {emitted,imported,exported,removed}=state.ledger[i];
        const error=current-initial-(emitted+imported-exported-removed)*scale;
        return [key,{units,amount:current,initial,emitted:emitted*scale,imported:imported*scale,
          exported:exported*scale,removed:removed*scale,error}];
      }));
    }
    function indexed(rows,label,callback,role){
      const index=new Map(rows.map(({key},i)=>[key,i]));
      return {type:'record',selector:true,...(role&&{role}),read({state,target,args}){
        const at=Array.isArray(target)?target:target?.point;
        const key=args[label]??target?.entity;
        if(key!==undefined)return index.has(key)?Q.ok(callback(state,index.get(key))):Q.missing('unknown '+label);
        if(at&&label==='room'){
          const i=rooms.findIndex(row=>inside(at,row.bounds));
          return i<0?Q.missing('outside air rooms','outside'):Q.ok(callback(state,i));
        }
        return Q.ok(Object.fromEntries(rows.map((row,i)=>[row.key,callback(state,i)])));
      }};
    }
    function spatial(type,units,value,extra={}){
      return W.spatialFields.define({type,units,sampling:'cell',...extra},({state,point,explain})=>{
        const i=rooms.findIndex(row=>inside(point,row.bounds));
        return i<0?Q.missing('outside air rooms','outside'):state?{status:'ok',value:value(state,i),
          ...(explain&&{source:{kind:'air-room',room:rooms[i].key}})}:Q.missing('air state unavailable');
      });
    }
    const roomFields=['air-quality','temperature',...species.map(row=>row.key)];
    let acousticGeometry;
    function acoustics({state}){
      if(!state?.settings)return Q.missing('air openings are unavailable');
      acousticGeometry??={rooms:rooms.map(({key,bounds})=>({id:key,bounds})),exterior:outside.map(row=>row.key),
        openings:openings.map(row=>{
          const at=row.at??row.wind?.at??row.gate?.points[0];
          return {id:row.key,from:names[row.from],to:names[row.to],...(at&&{at})};
        })};
      return Q.ok({geometry:acousticGeometry,fractions:state.settings.map(row=>row.open)});
    }
    return {inputs,outputs,initial:()=>({stock,ledger:tracers.map(()=>Object.fromEntries(counters.map(key=>[key,0])))}),
      partitionStep:openings.every(row=>!row.gate&&(!row.wind||windField===undefined)),
      settleInitial(state,ctx){
        const settings=control(ctx);
        return {...state,settings,...A.airflow(size,openings,settings)};
      },
      checkFields(query){
        if(windField!==undefined){
          const field=query.field(windField);
          check(field?.units==='world/s'&&(field.type==='vec3'||
            field.type==='vec2'&&(field.spatial?.components??'xz')==='xz'),'Ventilation wind needs a world/s XYZ or XZ vector field');
        }
        for(const row of openings)if(row.gate){
          const field=query.field(row.gate.field);
          check(field?.type==='number'&&field.units==='world','Air opening gate needs a numeric clearance field');
        }
      },
      dependencies:{writes:roomFields,reads:[...new Set([windField,...openings.map(row=>row.gate?.field)].filter(Boolean))]},
      validateState(state){
        const array=(values,n,valid)=>Array.isArray(values)&&values.length===n&&values.every(valid);
        const nonnegative=n=>Number.isFinite(n)&&n>=0;
        check(record(state)&&array(state.stock,tracers.length,row=>array(row,size,nonnegative))&&
          array(state.ledger,tracers.length,row=>record(row)&&counters.every(key=>nonnegative(row[key])))&&
          array(state.pressure,size,Number.isFinite)&&array(state.flow,openings.length,Number.isFinite)&&
          array(state.settings,openings.length,row=>record(row)&&ranges(row.open,0,1)&&point(row.wind)&&
            [row.drive,row.fan,row.windDrive].every(Number.isFinite)),'Invalid ventilation checkpoint');
        for(const row of Object.values(budget(state)))check(Math.abs(row.error)<=1e-7*Math.max(1,row.initial+row.emitted+row.imported),
          'Ventilation checkpoint budget mismatch');
      },
      step(state,ctx){
        const settings=control(ctx), solved=A.airflow(size,openings,settings);
        const emissions=tracers.map(()=>rooms.map(()=>0));
        for(const row of sources){
          const scale=clamp(ctx.input['source.'+row.key]??row.enabled,0,1)*ctx.dt;
          row.rates.forEach((rate,j)=>{emissions[j][row.room]+=rate*scale;});
        }
        const moved=A.transport(rooms,air,openings,settings,solved.flow,tracers,state.stock,emissions,ctx.dt);
        const stock=moved.map(row=>row.stock), ledger=moved.map((row,i)=>Object.fromEntries(
          counters.map(key=>[key,state.ledger[i][key]+row[key]])));
        rooms.forEach((room,i)=>{
          for(let j=0;j<tracers.length;j++)if(state.stock[j][i]!==stock[j][i]){
            const field=j===0?'temperature':tracers[j].key;
            ctx.spatial?.write(field,room.bounds,'ventilation');
          }
          if(weights.some((weight,j)=>weight&&state.stock[j+1][i]!==stock[j+1][i]))
            ctx.spatial?.write('air-quality',room.bounds,'ventilation');
        });
        openings.forEach((edge,i)=>{
          if(Boolean(settings[i].open)!==Boolean(state.settings[i].open))
            ctx.emit(settings[i].open?'air-opening-opened':'air-opening-closed',{opening:edge.key,flow:solved.flow[i]});
        });
        return {stock,ledger,settings,...solved};
      },
      output(state){
        const result={};
        rooms.forEach(({key},i)=>{
          result['quality.'+key]=score(state,i);
          result['temperature.'+key]=concentration(state,i,0)-273.15;
          result['humidity.'+key]=concentration(state,i,humidityIndex);
          result['smoke.'+key]=concentration(state,i,smokeIndex);
          result['pressure.'+key]=state.pressure[i];
        });
        openings.forEach(({key},i)=>{
          result['flow.'+key]=state.flow[i];
          result['effective-opening.'+key]=state.settings[i].open;
        });
        return result;
      },
      fields:{
        'acoustic-layout':{type:'record',role:'acoustic-layout',openingIds:openings.map(row=>row.key),read:acoustics},
        rooms:{...indexed(rooms,'room',describe,'ventilation-rooms'),tracers:species.map(row=>row.key)},
        openings:indexed(openings,'opening',(state,i)=>{
          const row=openings[i], {open,fan,wind,windDrive}=state.settings[i];
          return {id:row.key,from:names[row.from],to:names[row.to],opening:open,fan,wind,windDrive,
            mixing:row.mixing*open,flow:state.flow[i]};
        }),
        budget:{type:'record',read:({state})=>Q.ok(budget(state))},
        room:spatial('category','1',(_,i)=>rooms[i].key,{categories:rooms.map(row=>row.key)}),
        temperature:spatial('number','degC',(state,i)=>concentration(state,i,0)-273.15),
        'air-quality':spatial('number','1',score),
        ...Object.fromEntries(species.map(({key,units},j)=>[key,spatial('number',units+'/world^3',(state,i)=>concentration(state,i,j+1))]))
      },
      traces:{airflow:{selector:true,run({state,args,target}){
        return trace(openings,lookup,names,state.flow,{...args,from:args.from??target?.entity});
      }}}
    };
  }
  function checkVisual(query,spec){
    const {rooms,tracer='smoke',scale=1,color='#9d9990',step=.2}=spec??{};
    const field=typeof rooms==='string'&&query.field(rooms);
    check(record(spec)&&field?.role==='ventilation-rooms'&&id(tracer)&&
      field.tracers.includes(tracer)&&ranges(scale,0,1000)&&
      typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)&&ranges(step,.01,20),'Invalid visual airborne tracer');
  }
  function render(query,{rooms,tracer='smoke',scale=1,color='#9d9990',step=.2}){
    const read=query.probe(rooms);
    if(read.status!=='ok'||!scale)return [];
    const active=Object.values(read.value).filter(room=>room.concentrations[tracer]>1e-7);
    if(!active.length)return [];
    const extent=K.procedural.spatial.boxOf(active.flatMap(row=>[row.bounds.min,row.bounds.max]));
    const field=K.procedural.density.bounded({bounds:extent,sample(x,y,z,t){
      const point=[x,y,z], room=active.find(row=>inside(point,row.bounds));
      if(!room)return 0;
      const {min,max}=room.bounds;
      const edge=Math.min(...point.map((v,i)=>Math.min(v-min[i],max[i]-v)));
      const texture=.78+.18*Math.sin(x*3.7+y*4.4+t*.7)*Math.cos(z*4.8-y*2.1);
      return Math.min(16,scale*room.concentrations[tracer])*clamp(edge/.17,0,1)*texture;
    }});
    return [K.atmosphere.field({id:rooms+'/'+tracer,mediumKind:'airborne',field,color,density:1,step,lit:false})];
  }
  W.ventilation=Object.freeze({checkVisual,render});
  W.runtime.register('ventilation',ventilation,{worker:true});
})(KIT);
