/* Declarative accounts and fixed-rate or fixed-quantity transfer links. */
(function (K) {
  const W = K.world, T = W.transfers;
  const {check,id,record,own} = W.data;

  function store(config) {
    const specs = config.accounts;
    check(record(specs) && Object.keys(specs).length <= 512,'A store needs a bounded account table');
    const accounts = {}, initial = {};
    for (const [key,spec] of Object.entries(specs)) {
      check(id(key) && record(spec),'Invalid store account '+key);
      const {resource,units,type='number',min,max,at} = spec;
      check(['number','integer','vec2','vec3'].includes(type),'Invalid store account type '+type);
      const normalized = T.balanceOf({type,name:key},{balance:spec.initial,min,max}).report;
      initial[key] = normalized.balance;
      accounts[key] = {resource,units,type,...(at!==undefined&&{at}),read:state=>({balance:state[key],min:normalized.min,max:normalized.max}),
        write:(state,balance)=>({...state,[key]:balance})};
    }
    return {accounts,initial:()=>initial};
  }

  function exchange(config, {world}) {
    const specs = config.links;
    check(record(specs) && Object.keys(specs).length <= 512,'An exchange needs a bounded link table');
    const inputs = {}, links = [], rateLinks=new Set();
    for (const [key,spec] of Object.entries(specs)) {
      check(id(key) && record(spec) && own(spec,'amount') !== own(spec,'rate') &&
        (spec.enabled === undefined || typeof spec.enabled === 'boolean'),'Invalid transfer link '+key);
      inputs[key] = {type:'bool',default:spec.enabled ?? true};
      const amount = own(spec,'amount') ? spec.amount : Array.isArray(spec.rate) ?
        spec.rate.map(n=>Number.isFinite(n)?n*world.dt:null) : Number.isFinite(spec.rate)?spec.rate*world.dt:null;
      if(own(spec,'rate'))rateLinks.add(key);
      links.push({id:key,from:spec.from,to:spec.to,amount,mode:spec.mode ?? 'partial'});
    }
    return {inputs,initial:()=>({}),checkTransfers(validate) {
      for (const link of links) validate(link,true);
    },requestTransfers(state,{input,dt,simulationLOD}) {
      const ready=links.filter(link=>input[link.id] && (Array.isArray(link.amount) ? link.amount.some(Boolean) : link.amount !== 0));
      if(!simulationLOD||dt===world.dt)return ready;
      const scale=dt/world.dt;
      return ready.map(link=>rateLinks.has(link.id)?{...link,
        amount:Array.isArray(link.amount)?link.amount.map(value=>value*scale):link.amount*scale}:link);
    }};
  }

  W.runtime.register('store',store);
  W.runtime.register('exchange',exchange);
})(KIT);
