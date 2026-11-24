/* Portable solver representations with checked conversions and lazy detail reads. */
(function(K){
  const W=K.world, P=K.procedural, {check,id,record,own,copy}=W.data, freeze=P.data.freeze;
  const format='ink-studio/aggregate-state', rawStates=Symbol('aggregate simulation state');
  const marked=value=>value?.format===format;
  const rooted=value=>P.data.isImmutable(value)?value:freeze(copy(value));

  function define(provider,spec,label){
    check(record(spec)&&id(spec.model)&&typeof provider.step==='function'&&
      typeof provider.simulationAggregate==='function'&&(!provider.requestTransfers||provider.receiveTransfers),
      'Unsupported aggregate simulation model for '+label);
    const {preserve,...settings}=spec, adapter=provider.simulationAggregate(settings);
    check(record(adapter)&&['reduce','expand','step','measure','validate'].every(key=>typeof adapter[key]==='function')&&
      record(adapter.quantities)&&Object.keys(adapter.quantities).length>0&&Object.keys(adapter.quantities).length<=128&&
      (!Object.keys(provider.outputs??{}).length||typeof adapter.output==='function'),
    'Incomplete aggregate simulation model for '+label);
    for(const [name,row] of Object.entries(adapter.quantities))
      check(id(name)&&record(row)&&typeof row.units==='string'&&row.units.length>0&&
        (row.exact===undefined||typeof row.exact==='boolean')&&
        (row.tolerance===undefined||Number.isFinite(row.tolerance)&&row.tolerance>=0&&row.tolerance<=.01),
      'Invalid aggregate quantity '+name);
    const list=preserve??Object.keys(adapter.quantities);
    check(Array.isArray(list)&&list.length>0&&new Set(list).size===list.length&&
      list.every(name=>own(adapter.quantities,name)),'Unknown or empty preserved quantities for '+label);
    return {...adapter,model:spec.model,preserve:list,spec};
  }
  function advance(adapter,state,ctx){
    const data=adapter.step(state.data,ctx);
    return state.data===data?state:freeze({...state,data:rooted(data)});
  }
  function audit(adapter,detail,aggregate,system){
    const before=adapter.measure(detail,false), after=adapter.measure(aggregate,true);
    check(record(before)&&record(after),'Invalid aggregate quantity measurements for '+system);
    for(const key of adapter.preserve){
      const spec=adapter.quantities[key], a=before[key], b=after[key];
      const left=Array.isArray(a)?a:[a], right=Array.isArray(b)?b:[b];
      check(Array.isArray(a)===Array.isArray(b)&&left.length===right.length&&left.length<=512&&left.every((value,i)=>{
        const next=right[i];
        return Number.isFinite(value)&&Number.isFinite(next)&&(spec.exact?value===next:
          Math.abs(value-next)<=(spec.tolerance??1e-9)*Math.max(1,Math.abs(value),Math.abs(next)));
      }),'Simulation representation changed '+key+' for '+system);
    }
  }

  function bind(systems,chunks){
    const members=[];
    if(chunks)for(const [name,entry] of chunks.managed){
      if(!entry.models.size)continue;
      const {models,chunk}=entry, provider=systems[name], cache=new WeakMap();
      const first=models.values().next().value;
      function using(state){
        if(!marked(state))return null;
        const adapter=models.get(state.level);
        check(state.version===1&&adapter&&state.model===adapter.model&&own(state,'data'),
          'Invalid saved aggregate state for '+name);
        return adapter;
      }
      function fine(state){
        const adapter=using(state);
        if(!adapter)return state;
        let result=cache.get(state);
        if(!result){
          result=rooted(adapter.expand(state.data));
          audit(adapter,result,state.data,name);
          cache.set(state,result);
        }
        return result;
      }
      function wrapped(state,data){
        if(state.data===data)return state;
        return freeze({format,version:1,level:state.level,model:state.model,data:rooted(data)});
      }
      function dispatch(ctx,key,hook,read){
        const adapter=using(ctx.state);
        if(!adapter)return read(ctx);
        const override=own(adapter[hook],key)&&adapter[hook][key];
        return override?override({...ctx,state:ctx.state.data}):read({...ctx,state:fine(ctx.state)});
      }
      const descriptors=(rows,hook,verb)=>Object.fromEntries(Object.entries(rows).map(([key,row])=>
        [key,{...row,[verb]:ctx=>dispatch(ctx,key,hook,row[verb])}]));
      systems[name]={...provider,
        ...(provider.receiveTransfers&&{requestTransfers(state,ctx,limit){
          return using(state)||models.has(ctx.simulationLOD?.level)?[]:provider.requestTransfers(state,ctx,limit);
        }}),
        ...(provider.fields&&{fields:descriptors(provider.fields,'fields','read')}),
        ...(provider.traces&&{traces:descriptors(provider.traces,'traces','run')}),
        ...(provider.actions&&{actions:Object.fromEntries(Object.entries(provider.actions).map(([key,action])=>
          [key,(state,args,ctx)=>action(fine(state),args,ctx)]))}),
        ...(provider.accounts&&{accounts:Object.fromEntries(Object.entries(provider.accounts).map(([key,account])=>
          [key,{...account,
            read(state){
              const adapter=using(state), custom=adapter?.accounts?.[key];
              return custom?custom.read(state.data):account.read(fine(state));
            },
            write(state,value){
              const adapter=using(state), custom=adapter?.accounts?.[key];
              return custom?wrapped(state,custom.write(state.data,value)):account.write(fine(state),value);
            }}]))}),
        ...(provider.pose&&{pose(state,...args){
          const adapter=using(state);
          return adapter?.pose?adapter.pose(state.data,...args):provider.pose(fine(state),...args);
        }}),
        ...(provider.poseEntities&&{poseEntities(state){
          const adapter=using(state);
          return adapter?.poseEntities?adapter.poseEntities(state.data):provider.poseEntities(fine(state));
        }}),
        ...(provider.occupancy&&{occupancy:{...provider.occupancy,key(state){
          const adapter=using(state);
          return adapter?state.data:provider.occupancy.key?.(state)??state;
        },rows(state){
          const adapter=using(state);
          return adapter?.occupancyRows?adapter.occupancyRows(state.data):provider.occupancy.rows(fine(state));
        }}}),
        ...(provider.waterFrame&&{waterFrame:state=>provider.waterFrame(fine(state))}),
        ...(provider.volumeFrame&&{volumeFrame:state=>provider.volumeFrame(fine(state))}),
        ...(provider.navigationSource&&{navigationSource:(field,state,query)=>provider.navigationSource(field,fine(state),query)}),
        ...(provider.afterStep&&{afterStep(state,ctx){
          const adapter=using(state);
          if(!adapter)return provider.afterStep(state,ctx);
          return adapter.afterStep?wrapped(state,adapter.afterStep(state.data,ctx)):state;
        }}),
        step(state,ctx){
          const adapter=using(state);
          return adapter?advance(adapter,state,ctx):provider.step(state,ctx);
        },
        output(state,ctx){
          const adapter=using(state);
          return adapter?adapter.output?.(state.data,ctx):provider.output?.(state,ctx);
        },
        validateState(state){
          const adapter=using(state);
          if(adapter)adapter.validate(state.data);
          else provider.validateState?.(state);
        },
        simulationRepresentation(state){
          const adapter=using(state), spec=adapter??first, values=spec.measure(adapter?state.data:state,Boolean(adapter));
          return {system:name,chunk,representation:adapter?'aggregate':'detail',
            ...(adapter&&{level:state.level,model:state.model,work:adapter.describe?.(state.data)??{}}),
            quantities:Object.fromEntries(spec.preserve.map(key=>[key,{units:spec.quantities[key].units,value:values[key]}]))};
        }
      };
      members.push({name,chunk,models,using,fine,provider});
    }
    if(!members.length)return null;
    const snapshots=new WeakMap();
    function view(states){
      if(!members.some(row=>marked(states[row.name])))return states;
      if(snapshots.has(states))return snapshots.get(states);
      const values={...states};
      for(const {name,fine} of members)if(marked(states[name]))
        Object.defineProperty(values,name,{enumerable:true,get:()=>fine(states[name])});
      Object.freeze(values);
      if(Object.isFrozen(states))snapshots.set(states,values);
      return values;
    }
    function transition(states,chunkState,emit){
      let changed=false;
      for(const row of members){
        const {name,chunk,models,using,fine}=row, entry=chunkState.entries[chunk];
        if(entry.sleeping)continue;
        const state=states[name], before=using(state), after=models.get(entry.level)??null;
        if(before===after){
          if(after&&state.level!==entry.level){
            states[name]=freeze({...state,level:entry.level});
            changed=true;
          }
          continue;
        }
        const detail=fine(state);
        if(after){
          const data=rooted(after.reduce(detail));
          after.validate(data);
          audit(after,detail,data,name);
          states[name]=freeze({format,version:1,level:entry.level,model:after.model,data});
        }else{
          row.provider.validateState?.(detail);
          states[name]=detail;
        }
        changed=true;
        emit?.('simulation-representation',{solver:name,chunk,from:before?.model??'detail',
          to:after?.model??'detail',level:entry.level,preserved:(after??before).preserve});
      }
      return changed;
    }
    function validate(states,chunkState){
      for(const {name,chunk,models,using} of members){
        const entry=chunkState.entries[chunk], adapter=using(states[name]);
        check(entry.sleeping||(models.get(entry.level)===(adapter??undefined)&&(!adapter||states[name].level===entry.level)),
          'Saved representation does not match the active simulation level for '+name);
      }
    }
    function readState(name,state){
      const member=marked(state)&&members.find(row=>row.name===name);
      return member?member.fine(state):state;
    }
    function retainDetail(name,previous,detail){
      if(!marked(previous))return detail;
      const member=members.find(row=>row.name===name), adapter=member.using(previous), data=rooted(adapter.reduce(detail));
      adapter.validate(data);
      audit(adapter,detail,data,name);
      return freeze({...previous,data});
    }
    return {view,readState,retainDetail,transition,validate};
  }

  const modelSpec=(state,models)=>marked(state)?models?.get(state.level)?.spec:undefined;
  W.simulationAggregate=Object.freeze({define,bind,advance,modelSpec,rawStates,isAggregate:marked});
})(KIT);
