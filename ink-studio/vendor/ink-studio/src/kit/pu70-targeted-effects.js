/* Declarative consequences shared by direct interactions and agent orders. */
(function(K){
  const W=K.world, {check,record,id,own,endpoint,portOf}=W.data;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const finite=Number.isFinite;

  function attributes(raw){
    check(record(raw)&&Object.keys(raw).length<=64,'Invalid interaction attributes');
    for(const [name,row] of Object.entries(raw))
      check(id(name)&&keys(row,['initial','min','max'])&&finite(row.initial)&&
        (row.min===undefined||finite(row.min)&&row.min<=row.initial)&&
        (row.max===undefined||finite(row.max)&&row.max>=row.initial),'Invalid interaction attribute '+name);
    return raw;
  }

  function changes(raw,definitions){
    check(record(raw)&&Object.keys(raw).length<=64,'Invalid interaction changes');
    for(const [name,row] of Object.entries(raw))
      check(own(definitions,name)&&keys(row,['add','set','mode'])&&
        (own(row,'add')?finite(row.add)&&!own(row,'set'):finite(row.set))&&
        (row.mode===undefined||['clamp','exact'].includes(row.mode)),'Invalid interaction change '+name);
    return raw;
  }

  function adjust(values,definitions,changes){
    const next={...values}, applied={};
    for(const [name,rule] of Object.entries(changes)){
      const {min=-Infinity,max=Infinity}=definitions[name], before=values[name];
      const desired=rule.set??before+rule.add;
      const after=Math.min(max,Math.max(min,desired));
      if(!finite(after)||rule.mode==='exact'&&after!==desired)return {reason:'attribute-limit'};
      next[name]=after;
      applied[name]={before,after};
    }
    return {values:next,applied};
  }

  function compile(raw,{systems,world,transfers,ports,incoming,portValue}){
    if(raw===undefined)return null;
    check(keys(raw,['action','args'])&&record(raw.args??{}),'Invalid targeted interaction effect');
    const [system,key]=endpoint(raw.action), args=raw.args??{};
    if(system==='world'&&key==='input'){
      check(keys(args,['port','value']),'Invalid interaction input effect');
      const port=portOf(world,args.port), [destination]=endpoint(port);
      check(!incoming.has(port),'A connected input cannot receive an interaction effect: '+port);
      return {kind:'input',destination,port,value:portValue(ports.inputs[port],args.value,port)};
    }
    if(system==='world'&&key==='transfer'){
      check(args.mode===undefined||args.mode==='exact','Interaction transfers must be exact');
      const request={...args,mode:'exact'}, {from,to}=transfers.validate(request);
      return {kind:'transfer',destinations:[from.system,to.system],request};
    }
    const hooks=own(systems,system)&&systems[system].workEffects;
    const handler=own(hooks,key)&&hooks[key];
    check(handler,'Unsupported targeted interaction effect '+raw.action);
    handler.check(args,1);
    return {kind:'work',destination:system,handler,args};
  }

  W.targetedEffects=Object.freeze({attributes,changes,adjust,compile});
})(KIT);
