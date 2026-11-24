/* Checkpointed pipe networks, surface-water exchanges and hydraulic actuators. */
(function(K){
  const W=K.world, Q=W.query, {check,id,record,vector,portOf,endpoint}=W.data, {clamp}=W.fields;
  const H=W.hydraulicFlow, limit=1e7, origin=[0,0,0], units='world^3';
  const bounded=(n,lo=0,hi=limit)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const point=p=>vector(p)&&p.every(n=>bounded(n,-limit));
  const sum=values=>values.reduce((total,value)=>total+value,0);
  const zeros=rows=>rows.map(()=>0);
  function table(raw,max,kind,parse){
    check(record(raw)&&Object.keys(raw).length<=max,'Invalid '+kind+' table');
    return Object.keys(raw).sort().map(key=>{
      check(id(key)&&key.length<=80&&record(raw[key]),'Invalid '+kind+' '+key);
      return {key,...parse(raw[key],key)};
    });
  }
  function throttle({conductance,opening=1,maxFlow=limit},label){
    check(bounded(conductance)&&bounded(opening,0,1)&&bounded(maxFlow),'Invalid flow parameters for '+label);
    return {conductance,opening,maxFlow};
  }
  function named(rows,type,describe){
    const index=new Map(rows.map(({key},i)=>[key,i]));
    return {type:'record',role:'pipe-network-'+type,selector:true,read(context){
      const {args,target}=context, key=args[type]??target?.entity;
      if(key!==undefined)return index.has(key)?Q.ok(describe(rows[index.get(key)],index.get(key),context)):
        Q.missing('unknown hydraulic '+type);
      return Q.ok(Object.fromEntries(rows.map((row,i)=>[row.key,describe(row,i,context)])));
    }};
  }
  function flowTrace(nodes,indices,pipes,state,from,to){
    if(!indices.has(from)||to!==undefined&&!indices.has(to))return Q.missing('unknown hydraulic trace node');
    const adjacency=nodes.map(()=>[]);
    pipes.forEach((pipe,i)=>{
      const rate=state.pipeFlow[i];
      if(!rate)return;
      const [source,target]=rate>0?[pipe.from,pipe.to]:[pipe.to,pipe.from];
      adjacency[source].push({pipe:pipe.key,target,flow:Math.abs(rate)});
    });
    const start=indices.get(from), end=indices.get(to), queue=[start], previous=new Map([[start,null]]);
    for(let i=0;i<queue.length&&queue[i]!==end;i++){
      const source=queue[i];
      for(const edge of adjacency[source]){
        if(previous.has(edge.target))continue;
        previous.set(edge.target,{source,...edge});
        queue.push(edge.target);
      }
    }
    if(to===undefined)return Q.ok({from,reachable:queue.slice(1).map(i=>nodes[i].key)});
    if(!previous.has(end))return {status:'blocked',reason:'no accepted flow route',
      value:{from,to,reachable:queue.slice(1).map(i=>nodes[i].key)}};
    const path=[];
    for(let edge=previous.get(end);edge;edge=previous.get(edge.source)){
      path.push({pipe:edge.pipe,from:nodes[edge.source].key,to:nodes[edge.target].key,flow:edge.flow});
    }
    return Q.ok({from,to,path:path.reverse()});
  }

  function pipeNetwork(config,{world,id:system}){
    const {specificWeight=9810,resource='water'}=config, every=world.systems[system].schedule?.every??1;
    check(bounded(specificWeight,1e-6)&&id(resource),'Invalid pipe network fluid');
    const nodes=table(config.nodes,128,'hydraulic node',(raw,key)=>{
      const {capacity,initial=0,area=capacity,position=origin,elevation=position?.[1],precharge=0}=raw;
      check(bounded(capacity,1e-6)&&bounded(initial,0,capacity)&&bounded(area,1e-6)&&point(position)&&
        bounded(elevation,-limit)&&bounded(precharge),'Invalid storage or elevation for '+key);
      return {capacity,initial,area,position,elevation,precharge};
    });
    check(nodes.length>0,'A pipe network needs at least one storage node');
    const indices=new Map(nodes.map(({key},i)=>[key,i]));
    function node(key){
      check(indices.has(key),'Unknown hydraulic node '+key);
      return indices.get(key);
    }
    const pipes=table(config.pipes??{},256,'pipe',(raw,key)=>{
      const from=node(raw.from), to=node(raw.to), {boost=0,oneWay=false,piston,guides=[],radius=.045,look}=raw;
      check(from!==to&&bounded(boost,-limit)&&typeof oneWay==='boolean'&&Array.isArray(guides)&&
        guides.length<=24&&guides.every(point)&&bounded(radius,1e-6)&&
        (look===undefined||Array.isArray(look)&&look.length>0&&look.length<=32&&
        look.every(n=>Number.isSafeInteger(n)&&bounded(n,0,255))),'Invalid pipe '+key);
      let cylinder=null;
      if(piston!==undefined){
        check(record(piston),'Invalid hydraulic piston '+key);
        const {area,stroke,position=0,load=0}=piston;
        check(bounded(area,1e-6)&&bounded(stroke,1e-6)&&bounded(position,0,stroke)&&bounded(load),
          'Invalid hydraulic piston '+key);
        cylinder={area,stroke,position,load};
      }
      return {from,to,boost,oneWay,piston:cylinder,points:[nodes[from].position,...guides,nodes[to].position],
        radius,look,...throttle(raw,key)};
    });
    const leaks=table(config.leaks??{},128,'hydraulic leak',(raw,key)=>{
      const index=node(raw.node), {outsideHead=nodes[index].elevation}=raw;
      check(bounded(outsideHead,-limit),'Invalid outside leak head for '+key);
      return {node:index,outsideHead,...throttle(raw,key)};
    });
    const boundaries=table(config.boundaries??{},128,'hydraulic boundary',(raw,key)=>{
      const index=node(raw.node), account=portOf(world,raw.account), local=system+'/'+raw.node;
      const {head,headField,at=nodes[index].position,direction='both'}=raw;
      check(endpoint(account)[0]!==system&&['in','out','both'].includes(direction)&&point(at)&&
        (headField===undefined?bounded(head,-limit):head===undefined&&typeof headField==='string'),
        'Invalid hydraulic boundary '+key);
      return {node:index,account,local,head,headField,at,direction,...throttle(raw,key)};
    });
    const inputs={}, outputs={}, accounts={};
    const initialVolume=sum(nodes.map(row=>row.initial));
    const layout={nodes,pipes,leaks,specificWeight};
    function controls(input={}){
      const value=(pin,row,lo,hi,fallback)=>clamp(input[pin+'.'+row.key]??fallback,lo,hi);
      return {
        valves:pipes.map(row=>value('valve',row,0,1,row.opening)),
        boosts:pipes.map(row=>value('boost',row,-limit,limit,row.boost)),
        loads:pipes.map(row=>value('load',row,0,limit,row.piston?.load??0)),
        leaks:leaks.map(row=>value('leak',row,0,1,row.opening)),
        boundaries:boundaries.map(row=>value('boundary',row,0,1,row.opening))
      };
    }
    const initial={volume:nodes.map(row=>row.initial),position:pipes.map(row=>row.piston?.position??null),
      pipeFlow:zeros(pipes),leakFlow:zeros(leaks),controls:controls(),imported:0,exported:0,leaked:0};
    const addInput=(pin,row,value)=>{inputs[pin+'.'+row.key]={type:'number',default:value};};
    const addOutputs=(row,pins)=>{for(const pin of pins)outputs[pin+'.'+row.key]='number';};
    nodes.forEach((row,i)=>{
      const {key,capacity}=row;
      addOutputs(row,['volume','pressure','head']);
      accounts[key]={resource,units,type:'number',read:state=>({balance:state.volume[i],max:capacity}),
        write(state,balance){
          const volume=state.volume.slice(), diff=balance-volume[i];
          volume[i]=balance;
          return {...state,volume,imported:state.imported+Math.max(0,diff),exported:state.exported+Math.max(0,-diff)};
        }};
    });
    for(const row of pipes){
      addInput('valve',row,row.opening);
      addInput('boost',row,row.boost);
      addOutputs(row,['flow']);
      if(row.piston){
        addInput('load',row,row.piston.load);
        addOutputs(row,['position','speed','force']);
      }
    }
    for(const row of leaks){
      addInput('leak',row,row.opening);
      addOutputs(row,['leak-flow']);
    }
    for(const row of boundaries)addInput('boundary',row,row.opening);

    function mass(state){
      const volume=sum(state.volume), {imported,exported,leaked}=state;
      return {volume,initial:initialVolume,imported,exported,leaked,error:volume+exported+leaked-initialVolume-imported};
    }
    function storage(row,i,state){
      const volume=state.volume[i], head=H.head(row,volume);
      return {id:row.key,position:row.position,elevation:row.elevation,capacity:row.capacity,area:row.area,
        precharge:row.precharge,volume,head,pressure:(row.precharge+volume/row.area)*specificWeight};
    }
    function pipe(row,i,state){
      const {key,from,to,conductance,maxFlow,oneWay,piston,points,radius,look}=row;
      const {valves,boosts,loads}=state.controls, flow=state.pipeFlow[i];
      const headDrop=H.drop(nodes,state.volume,row,boosts[i]);
      return {id:key,entity:key,material:'pipe',points,paths:[points],radius,...(look&&{look}),
        from:nodes[from].key,to:nodes[to].key,conductance,maxFlow,oneWay,opening:valves[i],boost:boosts[i],headDrop,flow,
        ...(piston&&{piston:{area:piston.area,stroke:piston.stroke,position:state.position[i],load:loads[i],
          speed:flow/piston.area,force:headDrop*specificWeight*piston.area}})};
    }
    function boundaryHead(row,query){
      if(row.headField===undefined)return row.head;
      const sample=query.probe(row.headField,{point:row.at});
      return sample.status==='ok'&&Number.isFinite(sample.value)?sample.value:null;
    }
    function order(row,amount=0){
      const [from,to]=amount>=0?[row.account,row.local]:[row.local,row.account];
      return {id:row.key,from,to,amount:Math.abs(amount)};
    }
    function requestTransfers(state,ctx){
      if(!ctx.simulationLOD&&ctx.tick%every)return [];
      const dt=ctx.simulationLOD?ctx.dt:ctx.dt*every, combined=zeros(nodes), active=[];
      for(const row of boundaries){
        const k=row.conductance*clamp(ctx.input['boundary.'+row.key],0,1);
        if(k===0||row.maxFlow===0)continue;
        const outside=boundaryHead(row,ctx.query);
        if(outside===null)continue;
        const drop=outside-H.head(nodes[row.node],state.volume[row.node]);
        if(!drop||drop>0&&row.direction==='out'||drop<0&&row.direction==='in')continue;
        active.push({row,k,drop});
        combined[row.node]+=k;
      }
      return active.flatMap(({row,k,drop})=>{
        const local=nodes[row.node], max=row.maxFlow*dt;
        const amount=clamp(k*dt*drop/(1+dt*combined[row.node]/local.area),
          row.direction==='in'?0:-max,row.direction==='out'?0:max);
        return Math.abs(amount)>1e-12?[order(row,amount)]:[];
      });
    }
    function validateState(state){
      const array=(value,rows,valid)=>Array.isArray(value)&&value.length===rows.length&&value.every(valid);
      const finite=Number.isFinite, opening=n=>bounded(n,0,1), validVolume=(n,i)=>bounded(n,0,nodes[i].capacity);
      check(record(state)&&record(state.controls)&&array(state.volume,nodes,validVolume)&&
        array(state.position,pipes,(p,i)=>pipes[i].piston?bounded(p,0,pipes[i].piston.stroke):p===null)&&
        array(state.pipeFlow,pipes,finite)&&array(state.leakFlow,leaks,n=>finite(n)&&n>=0)&&
        array(state.controls.valves,pipes,opening)&&array(state.controls.boosts,pipes,n=>bounded(n,-limit))&&
        array(state.controls.loads,pipes,n=>bounded(n))&&array(state.controls.leaks,leaks,opening)&&
        array(state.controls.boundaries,boundaries,opening)&&
        [state.imported,state.exported,state.leaked].every(n=>finite(n)&&n>=0),'Invalid hydraulic checkpoint');
      check(Math.abs(mass(state).error)<=1e-7*Math.max(1,initialVolume+state.imported),'Hydraulic checkpoint volume mismatch');
    }

    return {initial:()=>initial,accounts,inputs,outputs,validateState,partitionStep:true,
      ...(boundaries.length>0&&{requestTransfers,checkTransfers(validate){
        for(const row of boundaries)validate(order(row),true);
      },checkFields(query){
        for(const row of boundaries)if(row.headField!==undefined){
          const field=query.field(row.headField);
          check(field?.type==='number'&&field.units==='world','Hydraulic boundary needs a numeric head field in world units: '+row.headField);
        }
      }}),
      step(state,ctx){
        const nextControls=controls(ctx.input), {lost,...next}=H.advance(layout,state,nextControls,ctx.dt);
        leaks.forEach(({key,node},i)=>{
          if(Boolean(next.leakFlow[i])!==Boolean(state.leakFlow[i]))ctx.emit(next.leakFlow[i]?'pipe-leak-start':'pipe-leak-stop',
            {leak:key,node:nodes[node].key,flow:next.leakFlow[i]});
        });
        return {...state,...next,controls:nextControls,leaked:state.leaked+lost};
      },
      output(state){
        const values={};
        nodes.forEach((row,i)=>{
          const {volume,head,pressure}=storage(row,i,state);
          values['volume.'+row.key]=volume;values['head.'+row.key]=head;values['pressure.'+row.key]=pressure;
        });
        pipes.forEach((row,i)=>{
          const flow=state.pipeFlow[i];
          values['flow.'+row.key]=flow;
          if(row.piston){
            values['position.'+row.key]=state.position[i];
            values['speed.'+row.key]=flow/row.piston.area;
            values['force.'+row.key]=H.drop(nodes,state.volume,row,state.controls.boosts[i])*specificWeight*row.piston.area;
          }
        });
        leaks.forEach((row,i)=>{values['leak-flow.'+row.key]=state.leakFlow[i];});
        return values;
      },
      fields:{
        nodes:named(nodes,'node',(row,i,{state})=>storage(row,i,state)),
        pipes:{...named(pipes,'pipe',(row,i,{state})=>pipe(row,i,state)),role:'pipe-network-pipes'},
        leaks:named(leaks,'leak',(row,i,{state})=>({id:row.key,node:nodes[row.node].key,position:nodes[row.node].position,
          outsideHead:row.outsideHead,opening:state.controls.leaks[i],flow:state.leakFlow[i]})),
        boundaries:named(boundaries,'boundary',(row,i,{state,query})=>{
          const receipt=query.probe('world/transfers').value.receipts.find(r=>r.requester===system&&r.requestId===row.key);
          return {id:row.key,node:nodes[row.node].key,account:row.account,direction:row.direction,
            at:row.at,outsideHead:boundaryHead(row,query),opening:state.controls.boundaries[i],
            flow:receipt?receipt.applied*(receipt.to===row.local?1:-1)/(world.dt*(query.simulationClock(system)?.lastStepTicks||every)):0,
            receipt:receipt??null};
        }),
        mass:{type:'record',units,read:({state})=>Q.ok(mass(state))}
      },
      traces:{flow:{selector:true,run:({state,target,args})=>flowTrace(nodes,indices,pipes,state,args.from??target?.entity,args.to)}}
    };
  }

  W.runtime.register('pipe-network',pipeNetwork,{worker:true});
})(KIT);
