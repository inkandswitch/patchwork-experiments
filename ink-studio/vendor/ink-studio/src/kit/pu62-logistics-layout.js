/* Scene schema for stocks, reusable recipes, and independently routed logistics. */
(function(K){
  const W=K.world, {check,record,id,vector,own}=W.data;
  const name=key=>id(key)&&key.length<=40;
  const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const point=p=>vector(p)&&p.every(n=>range(n,-1e6,1e6));
  const quantity=(n,type,min=0)=>range(n,min,1e12)&&(type!=='integer'||Number.isSafeInteger(n));
  const entries=(raw,label,max=128)=>{
    check(record(raw)&&Object.keys(raw).length<=max,'Invalid logistics '+label+' table');
    return Object.keys(raw).sort().map(key=>{
      check(name(key),'Invalid logistics '+label+' ID '+key);
      return [key,raw[key]];
    });
  };
  const index=rows=>new Map(rows.map(({key},i)=>[key,i]));
  const ordered=rows=>Array.from(rows.keys()).sort((a,b)=>rows[b].priority-rows[a].priority||a-b);
  function compile(config){
    const resources=entries(config.resources,'resources').map(([key,row])=>{
      check(record(row),'Invalid logistics resource '+key);
      const {type='number',units,look=[7,8,9,10]}=row;
      check(['integer','number'].includes(type)&&typeof units==='string'&&units.trim().length&&units.length<=48&&
        Array.isArray(look)&&look.length>0&&look.length<=32&&look.every(n=>Number.isInteger(n)&&range(n,0,255)),'Invalid logistics resource '+key);
      return {key,type,units,look};
    });
    const resourceIndex=index(resources), accounts=[], accountIndex=new Map();
    check(resources.length,'Logistics needs at least one resource');
    const containers=entries(config.containers,'containers').map(([key,row])=>{
      check(record(row)&&(row.position===undefined||point(row.position))&&
        (row.at===undefined||row.position===undefined&&W.worksites.target(row.at)),'Invalid logistics container '+key);
      const specs=entries(row.stocks,'stocks');
      check(specs.length,'Logistics container has no stocks: '+key);
      const stocks=specs.map(([resource,spec])=>{
        const commodity=resources[resourceIndex.get(resource)], pin=key+'.'+resource;
        check(commodity&&record(spec)&&!accountIndex.has(pin),'Unknown or ambiguous logistics stock '+pin);
        const {initial=0,max=null,display}=spec;
        check(quantity(initial,commodity.type)&&(max===null||quantity(max,commodity.type,initial)),
          'Invalid initial stock or capacity for '+pin);
        if(display!==undefined)check(record(display)&&(point(display.at)&&display.offset===undefined||
          display.at===undefined&&point(display.offset)&&(row.at!==undefined||row.position!==undefined))&&point(display.half)&&
          display.half.every(n=>n>=.01&&n<=100)&&max>0,'Stock display needs an XYZ origin, positive half sizes and capacity for '+pin);
        const account=accounts.length;
        accountIndex.set(pin,account);
        accounts.push({key:pin,container:key,resource:resourceIndex.get(resource),type:commodity.type,initial,max,display});
        return account;
      });
      return {key,position:row.position,at:row.at??row.position,stocks};
    });
    check(accounts.length>0&&accounts.length<=512,'Logistics needs between 1 and 512 stock accounts');
    const containerIndex=index(containers);
    function account(container,resource,label){
      const found=typeof container==='string'?accountIndex.get(container+'.'+resource):undefined;
      check(found!==undefined&&accounts[found].container===container&&resources[accounts[found].resource].key===resource,
        'Unknown logistics stock for '+label+': '+container+'.'+resource);
      return found;
    }
    function parts(raw,label){
      return entries(raw,label,32).map(([key,amount])=>{
        const resource=resources[resourceIndex.get(key)];
        check(resource&&quantity(amount,resource.type,1e-8),'Invalid recipe quantity '+label+'.'+key);
        return {key,amount};
      });
    }
    const recipes=entries(config.recipes??{},'recipes').map(([key,row])=>{
      check(record(row)&&range(row.duration,1e-5,1e9),'Invalid recipe duration '+key);
      const inputs=parts(row.inputs??{},key+' inputs'), outputs=parts(row.outputs??{},key+' outputs');
      check(inputs.length||outputs.length,'Recipe needs inputs or outputs: '+key);
      return {key,duration:row.duration,inputs,outputs};
    });
    const recipeIndex=index(recipes);
    function enabled(row,label){
      const {enabled=true,priority=0}=row;
      check(typeof enabled==='boolean'&&Number.isSafeInteger(priority)&&range(priority,-10000,10000),
        'Invalid logistics controls for '+label);
      return {enabled,priority};
    }
    function bindings(parts,raw,label){
      check(record(raw)&&Object.keys(raw).length===parts.length,'Recipe stock bindings must match '+label);
      return parts.map(({key,amount})=>{
        check(own(raw,key),'Missing '+label+' stock binding for '+key);
        return {account:account(raw[key],key,label),amount};
      });
    }
    const processes=entries(config.processes??{},'processes').map(([key,row])=>{
      const recipe=record(row)&&recipes[recipeIndex.get(row.recipe)];
      check(recipe&&range(row.speed??1,0,64),'Invalid process recipe or speed for '+key);
      const inputs=bindings(recipe.inputs,row.inputs??{},key+' inputs'), outputs=bindings(recipe.outputs,row.outputs??{},key+' outputs');
      return {key,recipe:recipe.key,duration:recipe.duration,speed:row.speed??1,inputs,outputs,...enabled(row,key),
        ...(row.work!==undefined&&{work:W.worksites.configure(row.work)})};
    });
    const routes=entries(config.links??{},'links').map(([key,row])=>{
      check(record(row)&&typeof row.resource==='string'&&resourceIndex.has(row.resource),'Invalid logistics link resource for '+key);
      const from=account(row.from,row.resource,key), to=account(row.to,row.resource,key);
      const {amount=null,rate=null,travel=0,slots=8,mode='partial',route=null,guides=[]}=row;
      check(from!==to&&(rate===null&&quantity(amount,accounts[from].type,1e-8)||
        amount===null&&range(rate,1e-8,1e12))&&range(travel,0,1e9)&&Number.isInteger(slots)&&range(slots,1,64)&&
        ['partial','exact'].includes(mode)&&Array.isArray(guides)&&guides.length<=32&&guides.every(point),
        'Invalid quantity, transit time, slots or guides for logistics link '+key);
      const first=containers[containerIndex.get(row.from)].position, last=containers[containerIndex.get(row.to)].position;
      let checkRoute=null;
      if(route!==null){
        check(record(route)&&typeof route.trace==='string'&&route.trace.length>0&&route.trace.length<=193&&
          point(route.at??first)&&point(route.to??last)&&record(route.args??{}),'Invalid logistics route trace for '+key);
        checkRoute={trace:route.trace,at:route.at??first,to:route.to??last,args:route.args??{}};
      }
      return {key,from,to,amount,rate,travel,slots,exact:mode==='exact',checkRoute,
        path:first&&last?[first,...guides,last]:[],...enabled(row,key)};
    });
    const maxBatches=config.maxBatches??32;
    check(Number.isInteger(maxBatches)&&range(maxBatches,1,128),'Invalid logistics batch budget');
    return {resources,accounts,accountIndex,containers,recipes,processes,processIndex:index(processes),
      routes,routeIndex:index(routes),maxBatches,processOrder:ordered(processes),routeOrder:ordered(routes)};
  }
  W.logisticsLayout=Object.freeze({compile,point});
})(KIT);
