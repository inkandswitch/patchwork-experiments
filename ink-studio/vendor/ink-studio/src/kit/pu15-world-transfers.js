/* Ordered, capacity-limited transfers between simulation-owned accounts. */
(function (K) {
  const W = K.world, {check,record,id,copy,own,endpoint} = W.data;
  const sizes = {number:1,integer:1,vec2:2,vec3:3};
  const plans = new WeakMap(), limit = 4096;
  const near = (a,b) => Number.isFinite(a) && (a === b || Math.abs(a-b) <= 1e-8 * Math.max(Math.abs(a),Math.abs(b)));

  function components(value, type, bound = false) {
    const size = sizes[type], values = size === 1 ? [value] : value;
    check(Array.isArray(values) && values.length === size && Array.from(values).every(n =>
      bound && n === null || (type === 'integer' ? Number.isSafeInteger(n) : Number.isFinite(n))),
    'Invalid '+type+' transfer quantity');
    return values;
  }
  const shape = (type, values) => sizes[type] === 1 ? values[0] : values;

  function balanceOf({type,name}, result) {
    check(record(result),'Missing balance for '+name);
    const balance = components(result.balance,type);
    const vector = sizes[type] > 1;
    const min = result.min === undefined ? balance.map(() => vector ? null : 0) :
      result.min === null ? balance.map(() => null) : components(result.min,type,true);
    const max = result.max === undefined || result.max === null ?
      balance.map(() => null) : components(result.max,type,true);
    const low = min.map(n => n ?? (type === 'integer' ? Number.MIN_SAFE_INTEGER : -Infinity));
    const high = max.map(n => n ?? (type === 'integer' ? Number.MAX_SAFE_INTEGER : Infinity));
    check(balance.every((n,i) => low[i] <= n && n <= high[i]),'Balance outside limits for '+name);
    return {balance,low,high,report:{balance:shape(type,balance),min:shape(type,min),max:shape(type,max)}};
  }

  const quote = (account,state) => balanceOf(account,account.read(state));

  function bind(systems) {
    if (plans.has(systems)) return plans.get(systems);
    const accounts = new Map(), producers = [], queued = [];
    for (const system of Object.keys(systems).sort()) {
      const provider = systems[system];
      if (provider.requestTransfers !== undefined) {
        check(typeof provider.requestTransfers === 'function','Invalid transfer producer '+system);
        (provider.receiveTransfers?queued:producers).push(system);
      }
      const definitions = provider.accounts ?? {};
      check(record(definitions),'Invalid transfer account table for '+system);
      const entries = Object.entries(definitions);
      check(entries.length <= 512 && accounts.size+entries.length <= 10000,'Transfer account budget exceeded');
      for (const [key,spec] of entries) {
        const name = system+'/'+key;
        check(id(key) && record(spec) && id(spec.resource) && typeof spec.units === 'string' &&
          spec.units.trim().length > 0 && own(sizes,spec.type) &&
          (spec.ownerOnly===undefined||typeof spec.ownerOnly==='boolean')&&
          typeof spec.read === 'function' && typeof spec.write === 'function','Invalid transfer account '+name);
        const {resource,units,type,read,write,at,ownerOnly} = spec;
        check(at===undefined||W.worksites.target(at),'Invalid transfer endpoint '+name);
        accounts.set(name,{system,name,type,resource,units,read,write,...(at!==undefined&&{at}),...(ownerOnly&&{ownerOnly})});
      }
    }
    const summary = ({name,type,resource,units,at,ownerOnly}) => ({name,type,resource,units,...(at!==undefined&&{at}),
      ...(ownerOnly&&{ownerOnly})});

    function validate(raw, allowZero = false) {
      check(record(raw) && Object.keys(raw).every(key=>['from','to','amount','mode','id'].includes(key)) &&
        (raw.mode === undefined || raw.mode === 'partial' || raw.mode === 'exact') &&
        (raw.id === undefined || id(raw.id)),'Invalid transfer request');
      endpoint(raw.from);
      endpoint(raw.to);
      const from = accounts.get(raw.from), to = accounts.get(raw.to);
      check(from && to && from !== to,'Transfer needs two distinct exposed accounts');
      check(from.resource === to.resource && from.units === to.units && from.type === to.type,
        'Incompatible transfer accounts '+raw.from+' -> '+raw.to);
      const requested = components(raw.amount,from.type);
      check((sizes[from.type] > 1 || requested[0] >= 0) && (allowZero || requested.some(n => n !== 0)),
        'A transfer needs a nonzero quantity and scalar transfers must be positive');
      return {from,to,requested};
    }

    function inspect(states, name) {
      const account = accounts.get(name);
      if (!account || !own(states,account.system)) return null;
      return {...summary(account),...quote(account,states[account.system]).report};
    }

    function settle(states, raw, tick, requester, rooted) {
      const {from,to,requested} = validate(raw);
      const {resource,units,type} = from, mode = raw.mode ?? 'partial';
      const zeros = requested.map(()=>0);
      const receipt = (applied, status, limitedBy) => ({
        tick,requester,...(raw.id && {requestId:raw.id}),from:from.name,to:to.name,resource,units,type,mode,
        requested:shape(type,requested),applied:shape(type,applied),status,limitedBy
      });
      if([from,to].some(account=>account.ownerOnly&&requester!==account.system))
        return receipt(zeros,'blocked',['access']);
      const a = quote(from,states[from.system]), b = quote(to,states[to.system]);
      const available = requested.map((n,i)=>n<0 ? a.high[i]-a.balance[i] : a.balance[i]-a.low[i]);
      const room = requested.map((n,i)=>n<0 ? b.balance[i]-b.low[i] : b.high[i]-b.balance[i]);
      const ratio = limits => limits.reduce((cap,n,i)=>requested[i] ? Math.min(cap,n/Math.abs(requested[i])) : cap,1);
      const aRatio = ratio(available), bRatio = ratio(room), factor = Math.min(aRatio,bRatio);
      const limitedBy = [...(aRatio === factor && factor < 1 ? ['source'] : []),
        ...(bRatio === factor && factor < 1 ? ['destination'] : [])];
      if (!factor || mode === 'exact' && factor < 1) return receipt(zeros,'blocked',limitedBy);
      const applied = requested.length === 1 ? [Math.min(requested[0],available[0],room[0])] :
        requested.map(n=>n*factor);
      const next = (q,sign) => q.balance.map((n,i)=>Math.min(q.high[i],Math.max(q.low[i],n+sign*applied[i])));
      const debit = next(a,-1), credit = next(b,1);
      const validChange = (before,after,sign) => after.every((n,i)=>Number.isFinite(n) &&
        (type === 'integer' ? n-before[i] === sign*applied[i] : near(n-before[i],sign*applied[i])) &&
        (requested[i] === 0 || n !== before[i]));
      if (!validChange(a.balance,debit,-1) || !validChange(b.balance,credit,1))
        return receipt(zeros,'blocked',[...limitedBy,'precision']);

      const entry = receipt(applied,factor < 1 ? 'partial' : 'full',limitedBy);
      const source = rooted(from.write(states[from.system],shape(type,debit)));
      const destination = rooted(to.write(to.system === from.system ? source : states[to.system],shape(type,credit)));
      const afterSource = quote(from,to.system === from.system ? destination : source).balance;
      const afterDestination = quote(to,destination).balance;
      check(validChange(a.balance,afterSource,-1) && validChange(b.balance,afterDestination,1),
        'Transfer endpoint did not post the agreed balance '+from.name+' -> '+to.name);
      if (from.system !== to.system) states[from.system] = source;
      states[to.system] = destination;
      return entry;
    }

    function validateReceipts(receipts, tick) {
      check(Array.isArray(receipts) && receipts.length <= limit,'Invalid saved transfer receipts');
      for (const value of receipts) {
        check(record(value) && value.tick === tick && id(value.requester) &&
          ['full','partial','blocked'].includes(value.status) && Array.isArray(value.limitedBy) &&
          value.limitedBy.every(n=>['source','destination','precision','access'].includes(n)), 'Invalid saved transfer receipt');
        const {from,requested} = validate({from:value.from,to:value.to,amount:value.requested,mode:value.mode,id:value.requestId});
        check(value.resource === from.resource && value.units === from.units && value.type === from.type,
          'Invalid saved transfer commodity');
        const applied = components(value.applied,from.type);
        check(applied.every((n,i)=>value.status === 'blocked' ? n === 0 :
          value.status === 'full' ? n === requested[i] :
          n === 0 && requested[i] === 0 || Math.sign(n) === Math.sign(requested[i]) && Math.abs(n) <= Math.abs(requested[i])),
        'Invalid saved transfer amount');
      }
    }

    const plan = Object.freeze({size:accounts.size,producers:Object.freeze([...producers,...queued]),validate,inspect,settle,validateReceipts,
      validateBalances(states) {
        for (const account of accounts.values()) quote(account,states[account.system]);
      },
      describe:()=>Array.from(accounts.values(),summary)});
    plans.set(systems,plan);
    return plan;
  }

  W.transfers = Object.freeze({bind,limit,components,shape,balanceOf});
})(KIT);
