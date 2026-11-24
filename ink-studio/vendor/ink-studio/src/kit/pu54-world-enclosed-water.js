/* Live water and trapped air in bounded chambers, with optional geometry-controlled openings. */
(function(K){
  const W=K.world, P=K.procedural, Q=W.query, F=W.enclosedFlow;
  const {check,id,record,vector,portOf,endpoint}=W.data, {bounds,clamp}=W.fields;
  const finite=Number.isFinite, limit=1e6, units='world^3';
  const bounded=(n,lo=0,hi=limit)=>finite(n)&&n>=lo&&n<=hi;
  const point=p=>vector(p)&&p.every(n=>bounded(n,-1e4,1e4));
  const inside=(p,box)=>p.every((n,i)=>n>=box.min[i]&&n<box.max[i]);
  const closedInside=(p,box)=>p.every((n,i)=>n>=box.min[i]&&n<=box.max[i]);
  const overlaps=(a,b)=>a.min.every((n,i)=>n<b.max[i]&&a.max[i]>b.min[i]);

  function table(raw,max,label,parse){
    check(record(raw)&&Object.keys(raw).length<=max,'Invalid '+label+' table');
    return Object.keys(raw).sort().map(key=>{
      check(id(key)&&key.length<=80&&record(raw[key]),'Invalid '+label+' '+key);
      return {key,...parse(raw[key],key)};
    });
  }
  function port(room,sill=room.floor,crown=room.ceiling){
    check(bounded(sill,room.floor,room.ceiling)&&bounded(crown,room.floor,room.ceiling)&&sill<crown,
      'Aperture sill and crown must lie inside chamber '+room.key);
    return {sill,crown};
  }
  function aperture(raw,key){
    const {conductance:k,opening=1,maxFlow=limit,gate}=raw;
    check(bounded(k)&&bounded(opening,0,1)&&bounded(maxFlow),'Invalid aperture rates for '+key);
    if(gate!==undefined)check(record(gate)&&typeof gate.field==='string'&&Array.isArray(gate.points)&&
      gate.points.length>=1&&gate.points.length<=8&&gate.points.every(point)&&bounded(gate.radius??0),
    'Invalid clearance gate for '+key);
    return {k,opening,maxFlow,gate};
  }

  function enclosedWater(config,{world,id:system}){
    const {ambientPressure:ambient=101325,specificWeight=9810}=config, every=world.systems[system].schedule?.every??1;
    check(bounded(ambient,1)&&bounded(specificWeight,1),'Invalid enclosed water pressure constants');
    const {optics}=config;
    P.waterBodies.optics(optics);
    const rooms=table(config.chambers,96,'water chamber',(raw,key)=>{
      const box=bounds(raw.bounds), {initial=0,airPressure=ambient}=raw;
      check(point(box.min)&&point(box.max)&&box.max.every((n,i)=>n-box.min[i]>=.001&&
        Math.fround(n)>Math.fround(box.min[i])),'Chamber needs positive XYZ dimensions: '+key);
      const [width,height,length]=box.max.map((n,i)=>n-box.min[i]);
      const area=width*length, capacity=height*area, floor=box.min[1], ceiling=box.max[1];
      check(capacity<=limit&&bounded(initial,0,capacity)&&bounded(airPressure,1),'Invalid chamber storage '+key);
      return {bounds:box,area,capacity,floor,ceiling,initial,gas:(capacity-initial)*airPressure/ambient};
    });
    check(rooms.length>0,'Enclosed water needs at least one chamber');
    rooms.forEach((a,i)=>{
      for(let j=0;j<i;j++)check(!overlaps(a.bounds,rooms[j].bounds),'Water chambers overlap: '+a.key+' and '+rooms[j].key);
    });
    const index=new Map(rooms.map(({key},i)=>[key,i]));
    function room(key){
      check(index.has(key),'Unknown water chamber '+key);
      return index.get(key);
    }
    const doors=table(config.openings??{},256,'water opening',(raw,key)=>{
      const from=room(raw.from), to=room(raw.to);
      check(from!==to,'Water opening needs distinct chambers: '+key);
      check(raw.at===undefined||point(raw.at),'Invalid water opening location '+key);
      return {from,to,inlet:port(rooms[from],raw.fromSill??raw.sill,raw.fromCrown??raw.crown),
        outlet:port(rooms[to],raw.toSill??raw.sill,raw.toCrown??raw.crown),...aperture(raw,key),at:raw.at};
    });
    const vents=table(config.vents??{},96,'air vent',(raw,key)=>{
      const i=room(raw.chamber), {height=rooms[i].ceiling,open=true}=raw;
      check(bounded(height,rooms[i].floor,rooms[i].ceiling)&&typeof open==='boolean','Invalid air vent '+key);
      return {room:i,height,open};
    });
    const boundaries=table(config.boundaries??{},96,'water boundary',(raw,key)=>{
      const i=room(raw.chamber), account=portOf(world,raw.account), local=system+'/'+raw.chamber;
      const {head,headField,at,direction='both'}=raw;
      check(endpoint(account)[0]!==system&&['in','out','both'].includes(direction)&&
        (headField===undefined?bounded(head,-1e4,1e4):head===undefined&&typeof headField==='string'&&point(at)),
      'Boundary needs a constant head or head field and point: '+key);
      return {room:i,port:port(rooms[i],raw.sill,raw.crown),local,account,head,headField,at,direction,...aperture(raw,key)};
    });
    const layout={rooms,doors,vents,ambient,specificWeight}, inputs={}, outputs={}, accounts={};
    function input(key,value){inputs[key]={type:typeof value==='boolean'?'bool':'number',default:value};}
    for(const row of doors){
      input('opening.'+row.key,row.opening);
      outputs['flow.'+row.key]='number';
      outputs['effective-opening.'+row.key]='number';
    }
    for(const row of vents)input('vent.'+row.key,row.open);
    for(const row of boundaries)input('boundary.'+row.key,row.opening);
    rooms.forEach(({key,capacity,bounds},i)=>{
      outputs['level.'+key]=outputs['pressure.'+key]=outputs['volume.'+key]='number';
      outputs['vented.'+key]='bool';
      accounts[key]={type:'number',resource:'water',units,at:bounds.min.map((value,axis)=>(value+bounds.max[axis])/2),
        read:state=>({balance:state.water[i],max:capacity}),
        write(state,balance){
          const water=state.water.slice(), waterBefore=state.waterBefore.slice(), delta=balance-water[i];
          waterBefore[i]??=water[i];
          water[i]=balance;
          return {...state,water,waterBefore,imported:state.imported+Math.max(0,delta),exported:state.exported+Math.max(0,-delta)};
        }};
    });
    const initial={water:rooms.map(row=>row.initial),gas:rooms.map(row=>row.gas),opening:doors.map(row=>row.opening),
      waterBefore:rooms.map(()=>null),
      vent:vents.map(row=>row.open),vented:rooms.map(()=>false),flow:doors.map(()=>0),airExchange:0,imported:0,exported:0};
    const initialWater=F.total(initial.water), initialAir=F.total(initial.gas);
    const allBounds={min:[0,1,2].map(i=>Math.min(...rooms.map(row=>row.bounds.min[i]))),
      max:[0,1,2].map(i=>Math.max(...rooms.map(row=>row.bounds.max[i])))};
    const cachedRender=new WeakMap();

    function effective(row,value,query){
      const opening=clamp(value??row.opening,0,1);
      if(opening===0||!row.gate)return opening;
      return row.gate.points.every(at=>{
        const hit=query.probe(row.gate.field,at);
        return hit.status==='ok'&&hit.value>(row.gate.radius??0);
      })?opening:0;
    }
    function controls({input,query}){
      return {opening:doors.map(row=>effective(row,input['opening.'+row.key],query)),
        vent:vents.map(row=>input['vent.'+row.key]??row.open)};
    }
    const pressure=(state,i)=>state.vented[i]?ambient:ambient*state.gas[i]/F.airSpace(rooms[i],state.water[i]);
    const level=(state,i)=>F.level(rooms[i],state.water[i]);
    const show=(state,i)=>({id:rooms[i].key,bounds:rooms[i].bounds,capacity:rooms[i].capacity,
      water:state.water[i],level:level(state,i),airSpace:F.empty(rooms[i],state.water[i]),
      airAmount:state.gas[i],airPressure:pressure(state,i),vented:state.vented[i]});
    function mass(state){
      const volume=F.total(state.water), air=F.total(state.gas), {imported,exported,airExchange}=state;
      return {volume,initial:initialWater,imported,exported,error:volume+exported-initialWater-imported,
        air,initialAir,airExchange,airError:air-initialAir-airExchange};
    }
    function atRoom(target){
      return target.point?rooms.findIndex(row=>inside(target.point,row.bounds)):-1;
    }
    function pointReads({state,target},read){
      if(!target.point)return Q.missing('XYZ point required');
      const i=atRoom(target);
      return i<0?Q.missing('outside water chambers','outside'):read(state,i,target.point);
    }
    function medium(state,i,at){
      const {floor:bed}=rooms[i], surface=level(state,i), depth=surface-bed, water=depth>0&&at[1]<surface;
      const local=pressure(state,i)+(water?(surface-at[1])*specificWeight:0);
      return {kind:water?'water':'air',id:system+'/'+rooms[i].key,chamber:rooms[i].key,pressure:local,
        ...(water&&{bed,surface,depth,depthAtPoint:surface-at[1],velocity:[0,0]})};
    }
    function spatialField(type,units,value,extra={}){
      return W.spatialFields.define({type,units,bounds:allBounds,boundary:'half-open',sampling:'cell',...extra},ctx=>
        pointReads(ctx,(state,i,at)=>({status:'ok',value:value(state,i,at),
          ...(ctx.explain&&{source:{kind:'chamber',chamber:rooms[i].key}})})));
    }
    function names(rows,label,describe){
      return {type:'record',selector:true,read({state,target,args,query}){
        const position=Array.isArray(target)?target:target?.point;
        let key=args[label]??target?.entity;
        if(key===undefined&&label==='chamber'&&position)key=rooms[atRoom({point:position})]?.key;
        if(key===undefined&&!position)return Q.ok(Object.fromEntries(rows.map((row,i)=>[row.key,describe(state,row,i,query)])));
        const i=rows.findIndex(row=>row.key===key);
        return i<0?Q.missing('unknown '+label,key===undefined?'outside':'missing'):Q.ok(describe(state,rows[i],i,query));
      }};
    }
    function outsideHead(row,query){
      if(row.headField===undefined)return row.head;
      const hit=query.probe(row.headField,row.at);
      return hit.status==='ok'&&finite(hit.value)?hit.value:null;
    }
    function order(row,amount=0){
      const [from,to]=amount>=0?[row.account,row.local]:[row.local,row.account];
      return {from,to,id:row.key,amount:Math.abs(amount)};
    }
    function requestTransfers(state,ctx){
      if(!ctx.simulationLOD&&ctx.tick%every)return [];
      const dt=ctx.simulationLOD?ctx.dt:ctx.dt*every, control=controls(ctx);
      const mixed=F.air(layout,state.water,state.gas,control.opening,control.vent);
      const outgoing=new Map(), active=[], combined=rooms.map(()=>0);
      for(const row of boundaries){
        const opening=effective(row,ctx.input['boundary.'+row.key],ctx.query);
        if(opening===0||row.k===0||row.maxFlow===0)continue;
        const outside=outsideHead(row,ctx.query);
        if(outside===null)continue;
        const chamber=F.hydraulic(layout,row.room,state.water,mixed.ratios,mixed.vented,row.port);
        const drop=Math.max(outside,row.port.sill)-chamber.head;
        const fraction=drop>0?clamp((outside-row.port.sill)/(row.port.crown-row.port.sill),0,1):chamber.fraction;
        if(!drop||fraction===0||drop>0&&row.direction==='out'||drop<0&&row.direction==='in')continue;
        const k=row.k*opening*fraction;
        combined[row.room]+=k;
        active.push({row,k,drop,chamber});
      }
      const requests=[];
      for(const {row,k,drop,chamber} of active){
        const amount=clamp(k*dt*drop/(1+dt*combined[row.room]*chamber.slope),
          -Math.min(chamber.stock,row.maxFlow*dt),row.maxFlow*dt);
        if(Math.abs(amount)<=1e-12)continue;
        const item={row,amount,stock:chamber.stock};
        requests.push(item);
        if(amount<0){
          if(!outgoing.has(row.room))outgoing.set(row.room,[]);
          outgoing.get(row.room).push(item);
        }
      }
      for(const group of outgoing.values()){
        group.sort((a,b)=>a.stock-b.stock);
        let used=0;
        for(const item of group){
          item.amount=-Math.min(-item.amount,Math.max(0,item.stock-used));
          used-=item.amount;
        }
      }
      return requests.filter(({amount})=>amount!==0).map(({row,amount})=>order(row,amount));
    }
    function checkFields(query){
      function numeric(field,description){
        const descriptor=query.field(field);
        check(descriptor?.type==='number'&&descriptor.units==='world'&&!descriptor.name.startsWith(system+'/'),
          description+' must be a numeric field in world units from another system: '+field);
      }
      for(const row of [...doors,...boundaries])if(row.gate)numeric(row.gate.field,'Clearance gate');
      for(const row of boundaries)if(row.headField!==undefined)numeric(row.headField,'Boundary head');
    }
    function validateState(state){
      const array=(value,rows,valid)=>Array.isArray(value)&&value.length===rows.length&&value.every(valid);
      const bool=value=>typeof value==='boolean';
      check(record(state)&&array(state.water,rooms,(n,i)=>bounded(n,0,rooms[i].capacity))&&
        array(state.waterBefore,rooms,(n,i)=>n===null||bounded(n,0,rooms[i].capacity))&&
        array(state.gas,rooms,n=>finite(n)&&n>=0)&&array(state.flow,doors,finite)&&array(state.opening,doors,n=>bounded(n,0,1))&&
        array(state.vent,vents,bool)&&array(state.vented,rooms,bool)&&finite(state.airExchange)&&
        [state.imported,state.exported].every(n=>finite(n)&&n>=0),'Invalid enclosed water checkpoint');
      const {error,airError}=mass(state);
      check(Math.abs(error)<=1e-7*Math.max(1,initialWater+state.imported)&&
        Math.abs(airError)<=1e-7*Math.max(1,initialAir+Math.abs(state.airExchange)),'Enclosed water checkpoint balance mismatch');
    }
    function publish(previous,next,ctx){
      rooms.forEach((row,i)=>{
        if(previous.vented[i]!==next.vented[i])ctx.emit(next.vented[i]?'chamber-vented':'chamber-air-trapped',
          {chamber:row.key,airPressure:pressure(next,i)});
        const before=previous.waterBefore[i]??previous.water[i];
        if(before!==next.water[i]){
          for(const field of ['medium','water','depth','phase','head','pressure'])
            ctx.spatial?.write(field,row.bounds,'enclosed-water-level');
          if(Boolean(before)!==Boolean(next.water[i]))
            ctx.emit(next.water[i]?'chamber-wet':'chamber-dry',{chamber:row.key,level:level(next,i)});
        }else if(pressure(previous,i)!==pressure(next,i)){
          for(const field of ['medium','water','head','pressure'])ctx.spatial?.write(field,row.bounds,'chamber-air-pressure');
        }
      });
    }
    function waterFrame(state){
      if(!state)return null;
      if(cachedRender.has(state))return cachedRender.get(state);
      const bodies=rooms.flatMap((row,i)=>{
        const y=Math.fround(level(state,i)), floor=Math.fround(row.floor);
        if(y<=floor)return [];
        const id=system+'/'+row.key;
        const grid=P.verticalSpans.create({bounds:row.bounds,sample:()=>[{min:floor,max:y,kind:'water',id}]});
        return [P.waterBodies.fromSpans(grid,{id,optics})];
      });
      const frame={water:P.waterBodies.scene(bodies),bounds:allBounds};
      cachedRender.set(state,frame);
      return frame;
    }
    let acousticGeometry;
    function acoustics({state}){
      acousticGeometry??={rooms:rooms.map(({key,bounds})=>({id:key,bounds})),exterior:[],openings:doors.map(row=>{
        const at=row.at??row.gate?.points[0];
        return {id:row.key,from:rooms[row.from].key,to:rooms[row.to].key,fromPort:row.inlet,toPort:row.outlet,...(at&&{at})};
      })};
      return Q.ok({geometry:acousticGeometry,fractions:state.opening,levels:rooms.map((_,i)=>level(state,i))});
    }
    return {initial:()=>initial,checkFields,validateState,inputs,outputs,accounts,waterFrame,
      navigationSource(field,state){
        if(!state||field!=='water')return;
        const key=state.water;
        return {key,changes:old=>rooms.flatMap((row,i)=>old[i]===key[i]?[]:[{...row.bounds,axes:'xyz'}])};
      },
      partitionStep:doors.every(row=>!row.gate),
      ...(boundaries.length>0&&{requestTransfers,checkTransfers(validate){for(const row of boundaries)validate(order(row),true);}}),
      dependencies:{writes:['medium','water','depth','phase','head','pressure'],
        reads:[...new Set([...doors,...boundaries].flatMap(row=>[row.gate?.field,row.headField]).filter(Boolean))]},
      settleInitial(state,ctx){
        const {opening,vent}=controls(ctx), mixed=F.air(layout,state.water,state.gas,opening,vent);
        return {...state,opening,vent,vented:mixed.vented,gas:mixed.gas,airExchange:mixed.exchanged};
      },
      step(state,ctx){
        const {opening,vent}=controls(ctx);
        const next={...state,...F.exchange(layout,state,opening,vent,ctx.dt),opening,vent,waterBefore:initial.waterBefore};
        publish(state,next,ctx);
        return next;
      },
      output(state){
        const values={};
        rooms.forEach(({key},i)=>{
          values['level.'+key]=level(state,i);values['pressure.'+key]=pressure(state,i);
          values['volume.'+key]=state.water[i];values['vented.'+key]=state.vented[i];
        });
        doors.forEach(({key},i)=>{
          values['flow.'+key]=state.flow[i];values['effective-opening.'+key]=state.opening[i];
        });
        return values;
      },
      fields:{
        'acoustic-layout':{type:'record',role:'acoustic-layout',medium:'water',openingIds:doors.map(row=>row.key),read:acoustics},
        chambers:names(rooms,'chamber',(state,row,i)=>show(state,i)),
        openings:names(doors,'opening',(state,row,i)=>({id:row.key,from:rooms[row.from].key,to:rooms[row.to].key,
          fromPort:row.inlet,toPort:row.outlet,opening:state.opening[i],flow:state.flow[i],
          airConnected:state.opening[i]>0&&level(state,row.from)<row.inlet.crown&&level(state,row.to)<row.outlet.crown})),
        vents:names(vents,'vent',(state,row,i)=>{
          const dry=F.dryVent(rooms[row.room],row.height,level(state,row.room));
          return {id:row.key,chamber:rooms[row.room].key,height:row.height,open:state.vent[i],
            submerged:!dry,active:state.vent[i]&&dry};
        }),
        boundaries:names(boundaries,'boundary',(state,row,i,query)=>{
          const receipt=query.probe('world/transfers').value.receipts.find(r=>r.requester===system&&r.requestId===row.key);
          return {id:row.key,chamber:rooms[row.room].key,account:row.account,head:outsideHead(row,query),receipt:receipt??null,
            flow:receipt?receipt.applied*(receipt.to===row.local?1:-1)/(world.dt*(query.simulationClock(system)?.lastStepTicks||every)):0};
        }),
        mass:{type:'record',units,read:({state})=>Q.ok(mass(state))},
        medium:{type:'record',read:ctx=>pointReads(ctx,(state,i,at)=>Q.ok(medium(state,i,at)))},
        water:{type:'record',units:'world',read:ctx=>pointReads(ctx,(state,i,at)=>{
          const sample=medium(state,i,at);
          return sample.kind==='water'?Q.ok(sample):Q.missing('point is dry','dry');
        })},
        phase:spatialField('category','1',(state,i,at)=>medium(state,i,at).kind,{categories:['air','water']}),
        depth:spatialField('number','world',(state,i,at)=>Math.max(0,level(state,i)-at[1])),
        pressure:spatialField('number','Pa',(state,i,at)=>medium(state,i,at).pressure),
        head:spatialField('number','world',(state,i)=>level(state,i)+(pressure(state,i)-ambient)/specificWeight)
      }
    };
  }
  W.runtime.register('enclosed-water',enclosedWater,{worker:true});
})(KIT);
