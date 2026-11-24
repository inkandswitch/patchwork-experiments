/* Immutable world records, checked edits and reusable assemblies. */
(function (K) {
  const data = K.procedural.data;
  const format = 'ink-studio/world';
  const own = (obj, key) => obj != null && Object.hasOwn(obj, key);
  const record = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj);
  const safeKey = key => typeof key === 'string' && key.length > 0 &&
    !['__proto__', 'prototype', 'constructor'].includes(key);
  const id = key => safeKey(key) && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(key);
  const vector = (value, size = 3) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
  function check(condition, message) {
    if (!condition) throw Error(message);
  }
  function copy(value) {
    if (value === undefined) throw Error('A world value must be JSON data');
    return data.clone(value);
  }
  function equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
      return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
  }
  function manifest(input) {
    check(record(input) && (input.format ?? format) === format && (input.version ?? 1) === 1, 'Expected an Ink Studio world manifest');
    const result = {id:'world', seed:1, dt:1/60, systems:{}, entities:{}, connections:[], prefabs:{},
      commands:[], metadata:{}, assetPacks:[], ...(data.isImmutable(input)?input:copy(input)), format, version:1};
    check(id(result.id) && Number.isSafeInteger(result.seed) && Number.isFinite(result.dt) && result.dt > 0 && result.dt <= 1,
      'World needs an ID, integer seed and tick duration in (0, 1]');
    for (const section of ['systems','entities','prefabs']) {
      check(record(result[section]) && Object.keys(result[section]).length <= 10000, 'Invalid world section ' + section);
      for (const [key, item] of Object.entries(result[section]))
        check(id(key) && record(item), 'Invalid record ' + section + '/' + key);
    }
    check(record(result.metadata) && Array.isArray(result.assetPacks) && result.assetPacks.length <= 128,
      'Invalid metadata or asset packs');
    for (const [key, item] of Object.entries(result.entities)) {
      if (item.position !== undefined) check(vector(item.position), 'Invalid position for ' + key);
      if (item.tags !== undefined) check(Array.isArray(item.tags) && item.tags.every(TargetSelectors.name), 'Invalid tags for ' + key);
      for (const label of ['surfaceId','material','materialId']) if (item.visual?.[label] !== undefined)
        check(TargetSelectors.name(item.visual[label]), 'Invalid visual ' + label + ' for ' + key);
      if (item.materialAsset!==undefined||item.materialWetness!==undefined)
        K.world.materials.validateEntity(K.world.materials.catalog(result),item);
      if (item.parent !== undefined && item.parent !== null) check(own(result.entities, item.parent), 'Missing parent for ' + key);
      if (item.anchor !== undefined) check(record(item.anchor) && own(result.entities, item.anchor.entity) &&
        (item.anchor.socket === undefined || own(result.entities[item.anchor.entity].sockets, item.anchor.socket)),
        'Unresolved anchor on ' + key);
      if (item.sockets !== undefined) check(record(item.sockets) && Object.entries(item.sockets).every(([name, p]) => id(name) && vector(p)),
        'Invalid sockets for ' + key);
    }
    K.atmosphere.emitters.settings(result.visual?.atmosphereEmitters);
    const checked = new Set();
    for (const key of Object.keys(result.entities)) {
      let current = key;
      const seen = new Set();
      while (current && !checked.has(current)) {
        check(!seen.has(current), 'Entity attachment cycle at ' + current);
        seen.add(current);
        const item = result.entities[current];
        current = item.anchor?.entity ?? item.parent;
      }
      for (const visited of seen) checked.add(visited);
    }
    check(Array.isArray(result.connections) && result.connections.length <= 50000 && Array.isArray(result.commands),
      'World connections and commands must be arrays');
    for (const [key, prefab] of Object.entries(result.prefabs)) {
      check(Object.keys(prefab).every(name => ['entities','systems','connections','ports','params','revision','source','packs','lookAsset','sockets'].includes(name)),
        'Unknown prefab property in ' + key);
      check(Number.isSafeInteger(prefab.revision ?? 1) && (prefab.revision ?? 1) > 0, 'Invalid prefab revision for ' + key);
      check(record(prefab.entities ?? {}) && record(prefab.systems ?? {}) && Array.isArray(prefab.connections ?? []) &&
        record(prefab.ports ?? {}) && record(prefab.params ?? {}) && record(prefab.sockets ?? {}) && Array.isArray(prefab.packs ?? []),
        'Invalid prefab ' + key);
    }
    return data.freeze(result);
  }
  function selector(path) {
    if (typeof path === 'string') {
      check(path.startsWith('/') && !/~(?![01])/u.test(path), 'Expected a JSON Pointer or path array');
      path = path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    check(Array.isArray(path) && path.length > 0 && path.length <= 64 &&
      path.every(p => safeKey(p) || Number.isSafeInteger(p) && p >= 0), 'Invalid edit path');
    return path;
  }
  function read(root, path) {
    for (const key of path) {
      if (!own(root, key)) return undefined;
      root = root[key];
    }
    return root;
  }
  function bindLook(source, edit) {
    check(Object.keys(edit).every(key => ['op','select','binding'].includes(key)) && own(edit,'binding'),
      'A bind-look edit needs select and binding');
    const select = TargetSelectors.prepare(edit.select), binding = edit.binding;
    check(binding === null || typeof binding === 'string' || record(binding) && typeof binding.asset === 'string',
      'A look binding needs an asset ID, binding object or null');
    const section = source.format === format ? 'visual' : Array.isArray(source.solids) ? 'finish' : null;
    check(section, 'A bind-look edit needs a world or JSON diorama');
    const settings = source[section], ownLook = settings?.look;
    const look = ownLook ?? (section === 'finish' ? K.diorama.sceneLook(source) : undefined), targets = look?.targets;
    check((settings === undefined || record(settings)) && (look === undefined || look === false || record(look)) &&
      (targets === undefined || Array.isArray(targets)), 'Expected a scene look with a target list');
    const matches = (targets ?? []).flatMap((rule, index) => equal(rule?.select,select) ? [index] : []);
    check(matches.length <= 1, 'Multiple look bindings match the same selector; edit the specific rule by path');
    const path = [section,'look','targets'], index = matches[0];
    if (binding === null && index === undefined) return null;
    const rule = {select,asset:binding};
    if (record(ownLook) && targets !== undefined)
      return binding === null ? {op:'remove',path:[...path,index]} : {op:'set',path:[...path,index ?? targets.length],value:rule};
    if (record(ownLook)) return {op:'set',path,value:[rule]};
    const list = (targets ?? []).slice();
    if (binding === null) list.splice(index,1);
    else list[index ?? list.length] = rule;
    const value = {...look,targets:list};
    if (settings !== undefined) return {op:'set',path:path.slice(0,2),value};
    return {op:'set',path:[section],value:{look:value}};
  }
  function apply(source, operations, {validate = manifest} = {}) {
    check(Array.isArray(operations) && operations.length <= 10000, 'Expected a bounded array of world edits');
    let next = source, changed = false;
    const paths = [], owned = new WeakSet();
    function mutable(node) {
      if(owned.has(node))return node;
      const draft=Array.isArray(node)?node.slice():{...node};
      owned.add(draft);
      return draft;
    }
    function write(root,path,value,remove,index=0) {
      check(record(root)||Array.isArray(root),'Edit parent is not a collection at '+path.slice(0,index).join('/'));
      const key=path[index];
      if(Array.isArray(root))
        check(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<=root.length,'Invalid array index '+key);
      if(index+1===path.length){
        if(remove)check(own(root,key),'Cannot remove missing path '+path.join('/'));
        if(!remove&&equal(root[key],value))return root;
        const draft=mutable(root);
        if(!remove)draft[key]=value;
        else if(Array.isArray(draft))draft.splice(Number(key),1);
        else delete draft[key];
        changed=true;
        return draft;
      }
      const child=write(root[key],path,value,remove,index+1);
      if(child===root[key])return root;
      const draft=mutable(root);
      draft[key]=child;
      return draft;
    }
    for (const [index, original] of operations.entries()) {
      try {
        check(record(original), 'Expected an edit record');
        const edit = original.op === 'bind-look' ? bindLook(next,original) : original;
        if (!edit) continue;
        const path = selector(edit.path), before = read(next,path);
        if (edit.op === 'test') {
          check(own(edit,'value') && equal(before, edit.value), 'Test failed at ' + path.join('/'));
          continue;
        }
        check(['set','remove','merge'].includes(edit.op), 'Unknown edit operation ' + edit.op);
        if (edit.op === 'merge') check(record(before) && record(edit.value), 'Merge needs two records');
        const value = edit.op === 'remove' ? undefined : edit.op === 'merge' ? {...before,...copy(edit.value)} : copy(edit.value);
        changed=false;
        next=write(next,path,value,edit.op==='remove');
        if(changed)paths.push(path);
      } catch (error) {
        throw Error('Edit ' + (index + 1) + ': ' + error.message);
      }
    }
    if (next !== source && validate) validate(data.freeze(next));
    return data.freeze({world:next, paths});
  }
  function endpoint(value) {
    const parts = typeof value === 'string' ? value.split('/') : [];
    check(parts.length === 2 && parts.every(id), 'Expected system/port, got ' + value);
    return parts;
  }
  function portOf(source,value) {
    const [key,pin] = endpoint(value);
    const ports=source.entities[key]?.ports;
    return own(ports,pin)?ports[pin]:value;
  }
  function prefabParts(source, name, as, {params = {}, position = [0,0,0], overrides = [], lookAsset} = {},
    definition = source.prefabs[name]) {
    check(record(definition) && id(name) && id(as) && vector(position) && record(params), 'Unknown or invalid prefab instance ' + name);
    for (const key of Object.keys(params)) check(own(definition.params,key), 'Unknown prefab parameter ' + key);
    const values = {...definition.params,...params};
    const dependencies=definition.packs??[];
    let catalog;
    const assets = () => catalog ??= K.authoring.assetPacks.create({packs:source.assetPacks});
    for(const item of dependencies){
      const name=typeof item==='string'?item:item.id, revision=typeof item==='string'?undefined:item.revision;
      check(assets().packs.some(pack=>pack.id===name&&(revision===undefined||pack.revision===revision)),'Missing prefab asset pack '+name);
    }
    function resolve(value) {
      if (Array.isArray(value)) return value.map(resolve);
      if (!record(value)) return value;
      if (own(value,'$param')) {
        check(Object.keys(value).length === 1 && own(values,value.$param), 'Unknown prefab parameter ' + value.$param);
        return values[value.$param];
      }
      if (own(value,'$port')) {
        check(Object.keys(value).length===1,'Invalid local prefab port');
        return port(value.$port);
      }
      if (own(value,'$local')) {
        check(Object.keys(value).length === 1 && (value.$local==='@root'||own(definition.entities,value.$local) || own(definition.systems,value.$local)),
          'Unknown local prefab reference ' + value.$local);
        return nameOf(value.$local);
      }
      return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,resolve(v)]));
    }
    const nameOf = key => key==='@root'?as:as + '.' + key;
    function port(value) {
      const [system, pin] = endpoint(value);
      check(own(definition.systems,system), 'Unknown internal prefab system ' + system);
      return nameOf(system) + '/' + pin;
    }
    const ports = Object.fromEntries(Object.entries(definition.ports ?? {}).map(([key,value]) => [key,port(value)]));
    const look = K.authoring.looks.override(resolve(definition.lookAsset), lookAsset);
    const entities = {[as]:{kind:'assembly',position,prefab:name,revision:definition.revision ?? 1,ports,packs:dependencies,
      ...(definition.sockets!==undefined&&{sockets:resolve(definition.sockets)}),
      ...(look !== undefined && {lookAsset:look})}};
    const systems = {};
    for (const [key, item] of Object.entries(definition.entities ?? {})) {
      const entity = resolve(item);
      if (!entity.anchor) entity.parent = entity.parent ? (typeof item.parent==='string'?nameOf(item.parent):entity.parent) : as;
      else entity.anchor = {...entity.anchor, entity:typeof item.anchor.entity==='string'?nameOf(item.anchor.entity):entity.anchor.entity};
      entities[nameOf(key)] = entity;
    }
    for (const [key,item] of Object.entries(definition.systems ?? {})) systems[nameOf(key)] = resolve(item);
    const connections = (definition.connections ?? []).map(edge => ({...edge,from:port(edge.from),to:port(edge.to)}));
    const instance = apply({entities,systems,connections},overrides,{validate:null}).world;
    for (const [section, entries] of [['entities',instance.entities],['systems',instance.systems]]) {
      for (const key of Object.keys(entries))
        check(key === as && section === 'entities' || key.startsWith(as + '.'),
          'Prefab override changes ownership ' + key);
    }
    for (const entity of Object.values(instance.entities)) {
      for (const binding of [entity.lookAsset, entity.visual?.lookAsset])
        if (binding !== undefined && binding !== false) K.authoring.looks.bind(binding, assets());
    }
    return instance;
  }
  function stamp(source,name,as,options={}){
    check(own(source.prefabs,name)&&!own(source.entities,as),'Unknown prefab or occupied assembly '+name+'/'+as);
    const instance=prefabParts(source,name,as,options);
    for(const section of ['entities','systems'])for(const key of Object.keys(instance[section]))
      check(!own(source[section],key),'Prefab would reuse ID '+key);
    const entities={...instance.entities};
    if(entities[as]?.kind==='assembly'){
      const {params={},position=[0,0,0],overrides=[],lookAsset}=options;
      entities[as]={...entities[as],prefabStamp:{params,position,overrides,
        ...(lookAsset!==undefined&&{lookAsset}),members:{entities:Object.keys(entities),systems:Object.keys(instance.systems)}}};
    }
    return apply(source,[
      {op:'merge',path:['entities'],value:entities},
      {op:'merge',path:['systems'],value:instance.systems},
      {op:'set',path:['connections'],value:[...source.connections,...instance.connections]}
    ]);
  }
  function remix(source, original, name, operations = []) {
    check(own(source.prefabs,original) && id(name) && !own(source.prefabs,name), 'Invalid prefab remix ' + name);
    const definition = apply(source.prefabs[original], operations, {validate:null}).world;
    return apply(source,[{op:'set',path:['prefabs',name],value:{...definition,revision:1,source:original}}]);
  }
  function capture(source, instance, name) {
    const root=source.entities[instance];
    check(own(source.entities,instance)&&root.kind==='assembly'&&id(name)&&!own(source.prefabs,name),
      'Expected a placed assembly and an unused prefab ID');
    const prefix=instance+'.';
    const entityKeys=Object.keys(source.entities).filter(key=>key.startsWith(prefix));
    const systemKeys=Object.keys(source.systems).filter(key=>key.startsWith(prefix));
    const ids=new Set([...entityKeys,...systemKeys]);
    const local=key=>key.slice(prefix.length);
    function refs(value) {
      if (value===instance)return {$local:'@root'};
      if (typeof value==='string'&&ids.has(value))return {$local:local(value)};
      if (typeof value==='string'&&value.startsWith(prefix)&&value.includes('/')){
        const parts=value.split('/');
        if(parts.length===2&&systemKeys.includes(parts[0]))return {$port:local(parts[0])+'/'+parts[1]};
      }
      if (Array.isArray(value))return value.map(refs);
      if (!record(value))return value;
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,refs(item)]));
    }
    const entities={}, systems={}, ports={};
    for(const key of entityKeys){
      const entity=refs(source.entities[key]);
      const parent=source.entities[key].parent, host=source.entities[key].anchor?.entity;
      check((!parent||parent===instance||entityKeys.includes(parent))&&(!host||host===instance||entityKeys.includes(host)),
        'Cannot capture an assembly with an external attachment: '+key);
      if(parent&&parent!==instance)entity.parent=local(parent);
      else delete entity.parent;
      if(host)entity.anchor.entity=host===instance?'@root':local(host);
      entities[local(key)]=entity;
    }
    for(const key of systemKeys) systems[local(key)]=refs(source.systems[key]);
    const localPort=value=>{
      const [system,pin]=endpoint(value);
      return systemKeys.includes(system)?local(system)+'/'+pin:null;
    };
    const connections=source.connections.flatMap(edge=>{
      const from=localPort(edge.from),to=localPort(edge.to);
      return from&&to?[{...edge,from,to}]:[];
    });
    for(const [key,value] of Object.entries(root.ports??{})){
      const port=localPort(value);
      check(port,'Cannot capture a port outside the assembly: '+key);
      ports[key]=port;
    }
    const prefab={entities,systems,connections,ports,packs:root.packs??[],revision:1,...(root.prefab?{source:root.prefab}:{}),
      ...(root.sockets!==undefined&&{sockets:root.sockets}),
      ...(root.lookAsset !== undefined && {lookAsset:root.lookAsset})};
    return apply(source,[{op:'set',path:['prefabs',name],value:prefab}]);
  }
  K.world = {format, manifest, apply, stamp, remix, capture};
  K.world.data = Object.freeze({own,record,safeKey,id,vector,check,copy,equal,read,selector,endpoint,portOf,prefabParts});
})(KIT);
