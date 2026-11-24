/* Checked system contracts and a description of the resolved simulation plan. */
(function (K) {
  const {check,record,own,id} = K.world.data, freeze = K.procedural.data.freeze;
  const keys = ['reads','after','emits'];

  function list(value, name, field) {
    check(Array.isArray(value) && value.length <= 10000 && Array.from(value).every(id) &&
      new Set(value).size === value.length, 'Invalid system contract '+field+' for '+name);
    return value;
  }

  function declaration(raw, name) {
    if (raw === undefined) return {};
    check(record(raw) && Object.keys(raw).every(key => keys.includes(key)), 'Invalid system contract for '+name);
    const reads = raw.reads === undefined ? {} : raw.reads;
    check(record(reads) && Object.keys(reads).length <= 10000, 'Invalid system contract reads for '+name);
    return {
      reads: Object.fromEntries(Object.entries(reads).map(([alias,value]) => {
        const source = typeof value === 'string' ? {system:value} : value;
        check(id(alias) && record(source) && Object.keys(source).every(key => key === 'system' || key === 'sample') &&
          id(source.system) && (source.sample === undefined || ['previous','current'].includes(source.sample)),
        'Invalid system state read '+name+'/'+alias);
        return [alias,{system:source.system,sample:source.sample ?? 'previous'}];
      })),
      after: raw.after === undefined ? [] : list(raw.after,name,'after'),
      emits: raw.emits === undefined ? undefined : list(raw.emits,name,'emits')
    };
  }

  function compile(world, systems) {
    const contracts = new Map(), edges = [];
    for (const [name,system] of Object.entries(systems)) {
      const override = world.systems[name].contract;
      if (system.contract === undefined && override === undefined) continue;
      const base = declaration(system.contract,name), local = declaration(override,name);
      const reads = {...base.reads,...local.reads};
      const after = [...new Set([...(base.after ?? []),...(local.after ?? [])])].sort();
      const emits = local.emits ?? base.emits;
      for (const source of after) {
        check(source !== name && own(systems,source), 'Unknown or self system dependency '+source+' for '+name);
        edges.push({kind:'after',from:source,to:name});
      }
      for (const alias of Object.keys(reads).sort()) {
        const {system:source,sample} = reads[alias];
        check(source !== name && own(systems,source), 'Unknown or self state source '+source+' for '+name+'/'+alias);
        if (sample === 'current') edges.push({kind:'state',from:source,to:name,alias});
      }
      contracts.set(name,freeze({reads,after,emits:emits === undefined ? null : [...emits].sort()}));
    }
    return {contracts,edges};
  }

  function describe(plan) {
    const {systems,ports,order,incoming,dependencies,contracts,phaseEdges} = plan;
    const spatial = new Map(dependencies.describe.map(row => [row.id,row]));
    const systemsInfo = Object.fromEntries(order.map(name => {
      const system = systems[name], contract = contracts.get(name), fields = spatial.get(name);
      const descriptors = direction => Object.fromEntries(Object.keys(system[direction] ?? {}).sort()
        .map(key => [key,ports[direction][name+'/'+key]]));
      return [name,{
        reads:{state:contract?.reads ?? {},inputs:descriptors('inputs'),fields:fields?.reads ?? []},
        writes:{state:name,outputs:descriptors('outputs'),fields:fields?.writes ?? []},
        emits:contract?.emits ?? null,
        after:contract?.after ?? []
      }];
    }));
    const connections = [...incoming.values()].sort((a,b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
    return freeze({order:order.slice(),systems:systemsInfo,dependencies:phaseEdges.slice(),connections});
  }

  K.world.systemComposition = Object.freeze({compile,describe});
})(KIT);
