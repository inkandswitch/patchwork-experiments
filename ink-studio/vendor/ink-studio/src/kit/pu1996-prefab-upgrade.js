/* Three-way prefab upgrades against the placed revision and its authored replacement. */
(function(K){
  const W=K.world, {check,copy,equal,id,own,record,read,selector,endpoint,portOf,prefabParts}=W.data;
  const freeze=K.procedural.data.freeze, sections=['entities','systems'];
  const rootFields=new Set(['kind','prefab','revision','packs','prefabStamp']);
  const pointer=path=>'/'+path.map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/');
  const columns=['entities','systems','params','ports','pins','sockets','fields','accounts','actions'];
  function upgrade(source,instance,target,{migration={},checkpoint,implementations}={}){
    const R=W.runtime, world=W.manifest(source), options={implementations};
    const root=world.entities[instance], targetDefinition=world.prefabs[target];
    check(id(instance)&&own(world.entities,instance)&&root.kind==='assembly'&&id(root.prefab)&&
      id(target)&&own(world.prefabs,target),'Expected a placed assembly and a target prefab');
    check(record(migration)&&Object.keys(migration).every(key=>[...columns,'from','to','fromDefinition',
      'overridePaths','state','chunks','repairs','actionEdits'].includes(key)),'Invalid prefab migration specification');
    for(const key of columns)check(migration[key]===undefined||record(migration[key])&&
      Object.values(migration[key]).every(value=>value===null||typeof value==='string'),'Invalid migration '+key+' map');
    for(const key of ['overridePaths','state','chunks','actionEdits'])check(migration[key]===undefined||record(migration[key]),
      'Invalid migration '+key+' table');
    const from={prefab:root.prefab,revision:root.revision??1},to={prefab:target,revision:targetDefinition.revision??1};
    const report={instance,from,to,ok:false,...(checkpoint&&{tick:checkpoint.tick}),
      parameters:[],overrides:[],attachments:[],ports:[],connections:[],
      commands:[],state:[],issues:[]};
    const issue=(kind,detail)=>{report.issues.push({kind,...detail});};
    const finish=(world,checkpoint)=>freeze({report:{...report,ok:report.issues.length===0},
      ...(world&&report.issues.length===0&&{world,...(checkpoint&&{checkpoint})})});
    const match=(selector,revision)=>selector===undefined||record(selector)&&
      Object.keys(selector).every(key=>['prefab','revision'].includes(key)&&selector[key]===revision[key]);
    if(!match(migration.from,from)||!match(migration.to,to)||to.revision<=from.revision){
      issue('revision',{reason:'The source and target must match the migration and advance the revision'});
      return finish();
    }
    const previous=migration.fromDefinition??world.prefabs[from.prefab];
    if(!record(previous)||(previous.revision??1)!==from.revision){
      issue('revision',{reason:'The placed revision definition is unavailable',required:from});
      return finish();
    }
    if(checkpoint)check(checkpoint.format===R.checkpointFormat&&checkpoint.version===1&&equal(checkpoint.world,world),
      'The saved checkpoint belongs to a different world');
    const prefix=instance+'.', local=name=>name===instance?'@root':name.slice(prefix.length);
    const qualified=name=>name==='@root'?instance:prefix+name;
    const recipe=root.prefabStamp??{position:root.position??[0,0,0]};
    const parameters={};
    for(const [name,value] of Object.entries(recipe.params??{})){
      const next=own(migration.params,name)?migration.params[name]:name;
      if(next===null){report.parameters.push({from:name,status:'discarded'});continue;}
      if(!own(targetDefinition.params,next)||own(parameters,next)){
        issue('parameter',{name,to:next,reason:'Parameter has no unique target'});
        continue;
      }
      parameters[next]=value;
      report.parameters.push({from:name,to:next,status:next===name?'preserved':'remapped'});
    }
    let base,replacement;
    try{
      base=prefabParts(world,from.prefab,instance,{params:recipe.params,position:recipe.position},previous);
      replacement=prefabParts(world,to.prefab,instance,{params:parameters,position:recipe.position,lookAsset:recipe.lookAsset});
    }catch(error){issue('definition',{reason:error.message});return finish();}
    const owned=Object.fromEntries(sections.map(section=>[section,new Set([
      ...Object.keys(base[section]),...(recipe.members?.[section]??[])
    ])]));
    check(sections.every(section=>[...owned[section]].every(name=>id(name)&&
      (section==='entities'&&name===instance||name.startsWith(prefix)))),'Invalid saved prefab member list');
    function member(name,section){
      if(!owned[section].has(name)||name===instance)return name;
      const key=local(name), mapped=own(migration[section],key)?migration[section][key]:key;
      check(mapped===null||id(mapped),'Invalid prefab member mapping for '+key);
      if(mapped===null)return null;
      const next=qualified(mapped);
      if(own(replacement[section],next))return next;
      if(!own(base[section],name)&&own(world[section],name)&&!own(migration[section],key))return next;
      return null;
    }
    for(const section of sections){
      const mapped=[...owned[section]].map(name=>member(name,section)).filter(Boolean);
      if(new Set(mapped).size!==mapped.length)issue('ownership',{section,reason:'More than one member maps to the same target'});
      for(const name of new Set([...mapped,...Object.keys(replacement[section])]))
        if(!owned[section].has(name)&&own(world[section],name))issue('ownership',{section,name,reason:'Target ID is occupied'});
    }
    function scoped(value,group){
      const [name,pin]=endpoint(value);
      if(!owned.systems.has(name))return value;
      const key=local(name)+'/'+pin;
      if(own(migration[group],key)){
        const mapped=migration[group][key];
        if(mapped===null)return null;
        const [next,port]=endpoint(mapped);
        return qualified(next)+'/'+port;
      }
      const next=member(name,'systems');
      return next?next+'/'+pin:null;
    }
    function alias(name){
      const mapped=own(migration.ports,name)?migration.ports[name]:name;
      check(mapped===null||id(mapped),'Invalid public port mapping for '+name);
      return mapped;
    }
    function wire(value){
      const [name,pin]=endpoint(value);
      if(name===instance&&own(root.ports,pin)){
        const next=alias(pin);
        return next&&own(replacement.entities[instance].ports,next)?instance+'/'+next:null;
      }
      return scoped(value,'pins');
    }
    function anchor(value){
      if(!owned.entities.has(value.entity))return value;
      const key=local(value.entity)+'/'+value.socket;
      if(value.socket!==undefined&&own(migration.sockets,key)){
        const mapped=migration.sockets[key];
        if(mapped===null)return null;
        const parts=mapped.split('/');
        check(parts.length===2&&(parts[0]==='@root'||id(parts[0]))&&id(parts[1]),'Invalid socket map for '+key);
        return {...value,entity:qualified(parts[0]),socket:parts[1]};
      }
      const entity=member(value.entity,'entities');
      return entity?{...value,entity}:null;
    }
    function ref(value){
      if(typeof value==='string'){
        if(owned.entities.has(value))return member(value,'entities')??value;
        if(owned.systems.has(value))return member(value,'systems')??value;
        const parts=value.split('/');
        if(parts.length===2&&parts.every(id)&&owned.systems.has(parts[0]))return scoped(value,'fields')??value;
        return value;
      }
      if(Array.isArray(value))return value.map(ref);
      if(!record(value))return value;
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,ref(item)]));
    }
    function remapEntity(name,row){
      const next={...row};
      if(owned.entities.has(row.parent)){
        const mapped=member(row.parent,'entities');
        next.parent=mapped??row.parent;
        report.attachments.push({entity:name,kind:'parent',from:row.parent,to:mapped,
          status:mapped?(mapped===row.parent?'preserved':'remapped'):'repair'});
        if(!mapped)issue('attachment',{entity:name,from:row.parent,reason:'Parent has no target'});
      }
      if(row.anchor&&owned.entities.has(row.anchor.entity)){
        const mapped=anchor(row.anchor);
        if(mapped)next.anchor=mapped;
        report.attachments.push({entity:name,kind:'anchor',from:row.anchor,to:mapped});
      }
      if(row.ports)next.ports=Object.fromEntries(Object.entries(row.ports).map(([key,value])=>[key,scoped(value,'pins')??value]));
      return next;
    }

    const cleanRoot=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!rootFields.has(key)));
    const baseline={entities:{...base.entities,[instance]:cleanRoot(base.entities[instance])},systems:base.systems};
    const live=Object.fromEntries(sections.map(section=>[section,Object.fromEntries(
      [...owned[section]].filter(name=>own(world[section],name)).map(name=>[name,
        section==='entities'&&name===instance?cleanRoot(root):world[section][name]]) )]));
    const rules=Object.entries(migration.overridePaths??{}).map(([from,to])=>{
      const a=selector(from),b=to===null?null:selector(to);
      check(a.length>=2&&sections.includes(a[0])&&(!b||b.length>=2&&sections.includes(b[0])),
        'Override path mappings need local entity or system paths');
      return [a,b];
    })
      .sort(([a],[b])=>b.length-a.length);
    let changes=W.query.keyedChanges(baseline,live,{limit:10000}).slice();
    const overBudget=()=>{
      if(changes.length<=10000)return false;
      issue('overrides',{reason:'Instance changes exceed the upgrade edit budget'});
      return true;
    };
    if(overBudget())return finish();
    const authored=[], wholeArrays=new Set();
    function remember(path,value){
      if(record(value)&&Object.keys(value).length){
        for(const [key,child] of Object.entries(value))remember([...path,key],child);
        return;
      }
      if(!sections.includes(path[0])||!owned[path[0]].has(path[1])||path.length<3||
        path[0]==='entities'&&path[1]===instance&&rootFields.has(path[2]))return;
      const current=read(live,path);
      const sourcePath=[path[0],local(path[1]),...path.slice(2)];
      const mapsChildren=rules.some(([from])=>from.length>sourcePath.length&&sourcePath.every((key,i)=>String(from[i])===String(key)));
      if(Array.isArray(value)&&Array.isArray(current)&&!mapsChildren){
        // A placed vector or keyframe list carries its whole authored value.
        wholeArrays.add(pointer(path));
        authored.push({op:'set',path,value:current});
      }else if(equal(read(baseline,path),value)&&equal(current,value))authored.push({op:'set',path,value});
    }
    for(const change of recipe.overrides??[]){
      const at=selector(change.path);
      if(change.op==='set'||change.op==='merge')remember(at,change.value);
    }
    if(wholeArrays.size)changes=changes.filter(edit=>!edit.path.some((_,i)=>wholeArrays.has(pointer(edit.path.slice(0,i+1)))));
    const parents=new Set(changes.map(edit=>pointer(edit.path)));
    changes.push(...authored.filter(edit=>!edit.path.some((_,i)=>parents.has(pointer(edit.path.slice(0,i+1))))));
    if(overBudget())return finish();
    function mapEditPath(path){
      const [section,name,part]=path;
      if(!sections.includes(section)||!owned[section].has(name))return {mapped:path};
      const sourcePath=[section,local(name),...path.slice(2)];
      const rule=rules.find(([prefix])=>prefix.every((key,i)=>String(sourcePath[i])===String(key)));
      if(rule&&rule[1]===null)return {mapped:null,rule};
      const next=member(name,section);
      let mapped=rule?[rule[1][0],qualified(rule[1][1]),...rule[1].slice(2),...sourcePath.slice(rule[0].length)]:
        next?[section,next,...path.slice(2)]:null;
      if(mapped&&section==='entities'&&name===instance&&part==='ports'&&path.length>=4&&!rule){
        const pin=alias(path[3]);
        mapped=pin?[section,instance,'ports',pin,...path.slice(4)]:null;
      }
      return {mapped,rule};
    }
    let draft={entities:replacement.entities,systems:replacement.systems};
    const recorded=[], pathsSeen=new Set();
    for(const edit of changes){
      let path=edit.path, value=edit.value;
      const [section,name,part]=path;
      if(section==='entities'&&part==='anchor'&&read(live,[section,name,'anchor'])){
        path=[section,name,'anchor'];value=read(live,path);
      }
      if(pathsSeen.has(pointer(path)))continue;
      pathsSeen.add(pointer(path));
      const sourcePath=[section,local(name),...path.slice(2)];
      const {mapped,rule}=mapEditPath(path);
      if(rule&&rule[1]===null){report.overrides.push({from:pointer(sourcePath),status:'discarded'});continue;}
      const reportRow={from:pointer(sourcePath),...(mapped&&{to:pointer([mapped[0],local(mapped[1]),...mapped.slice(2)])})};
      try{
        if(edit.op==='remove'&&(!mapped||read(draft,mapped)===undefined)){
          report.overrides.push({...reportRow,status:'already-removed'});continue;
        }
        check(mapped&&sections.includes(mapped[0])&&
          (mapped[0]==='entities'&&mapped[1]===instance||mapped[1].startsWith(prefix))&&
          !(mapped[0]==='entities'&&mapped[1]===instance&&rootFields.has(mapped[2])),
        'Override has no target');
        check(rule||read(baseline,path)===undefined||read(replacement,mapped)!==undefined,'Overridden field has no target');
        check(path.length!==2||edit.op!=='set'||read(baseline,path)!==undefined||read(replacement,mapped)===undefined||
          rule||own(migration[section],local(name)), 'An added member collides with the replacement definition');
        const op=value!==undefined?'set':edit.op;
        if(op==='set'){
          if(section==='entities'&&path.length===2)value=remapEntity(mapped[1],value);
          else if(section==='entities'&&part==='anchor'){value=anchor(value);check(value,'Anchor has no target');}
          else if(section==='entities'&&name===instance&&part==='ports'&&path.length===4){
            value=scoped(value,'pins');check(value,'Overridden port has no target');
          }else value=ref(value);
        }
        const applied={op,path:mapped,...(op==='set'&&{value})};
        draft=W.apply(draft,[applied],{validate:null}).world;
        recorded.push(applied);
        report.overrides.push({...reportRow,status:equal(sourcePath,[mapped[0],local(mapped[1]),...mapped.slice(2)])?'preserved':'remapped'});
      }catch(error){issue('override',{...reportRow,reason:error.message});report.overrides.push({...reportRow,status:'repair'});}
    }
    replacement={...replacement,...draft};
    if(!replacement.entities[instance]){issue('ownership',{reason:'The upgrade must retain the assembly root'});return finish();}
    const entities=Object.fromEntries(Object.entries(world.entities).filter(([name])=>!owned.entities.has(name))
      .map(([name,row])=>[name,remapEntity(name,row)]));
    const systems=Object.fromEntries(Object.entries(world.systems).filter(([name])=>!owned.systems.has(name))
      .map(([name,row])=>[name,ref(row)]));
    Object.assign(entities,replacement.entities);
    Object.assign(systems,replacement.systems);
    entities[instance]={...entities[instance],prefabStamp:{position:recipe.position,params:parameters,overrides:recorded,
      ...(recipe.lookAsset!==undefined&&{lookAsset:recipe.lookAsset}),
      members:{entities:Object.keys(replacement.entities),systems:Object.keys(replacement.systems)}}};
    for(const pin of Object.keys(root.ports??{})){
      const next=alias(pin), saved=next&&own(entities[instance].ports,next);
      report.ports.push({from:pin,to:saved?next:null,status:saved?(pin===next?'preserved':'remapped'):'retired'});
    }
    const canonical=(edge,source)=>({...edge,from:portOf(source,edge.from),to:portOf(source,edge.to)});
    const internal=edge=>[edge.from,edge.to].every(value=>owned.systems.has(endpoint(portOf(world,value))[0]));
    const oldInternal=world.connections.filter(internal).map(edge=>canonical(edge,world));
    const mapEdge=edge=>({...edge,from:wire(edge.from),to:wire(edge.to)});
    let planned=replacement.connections.slice();
    for(const edge of base.connections)if(!oldInternal.some(item=>equal(item,edge))){
      const mapped=mapEdge(edge);
      planned=planned.filter(row=>row.from!==mapped.from||row.to!==mapped.to);
    }
    for(const edge of oldInternal)if(!base.connections.some(item=>equal(item,edge))){
      const mapped=mapEdge(edge);
      planned=planned.filter(row=>row.from!==mapped.from||row.to!==mapped.to);
      planned.push(mapped);
      report.connections.push({kind:'internal-override',before:edge,after:mapped});
    }
    for(const edge of base.connections)if(oldInternal.some(item=>equal(item,edge))){
      const mapped=mapEdge(edge), next=planned.find(row=>equal(row,mapped));
      report.connections.push({kind:'internal-definition',before:edge,after:next??null,
        ...(!next&&{status:'replaced'})});
    }
    for(const edge of world.connections)if(!internal(edge)){
      const mapped=mapEdge(edge);
      planned.push(mapped);
      if(!equal(edge,mapped)||[edge.from,edge.to].some(value=>owned.systems.has(endpoint(portOf(world,value))[0])))
        report.connections.push({kind:'boundary',before:edge,after:mapped});
    }
    let next={...world,entities,systems,connections:planned};
    const helpers={member,owned,local,scoped,wire,anchor,ref,issue,report,options,mapEditPath};
    try{
      next=W.prefabState.rewriteWorld(next,world,migration,helpers);
      if(migration.repairs!==undefined)next=W.apply(next,migration.repairs,{validate:null}).world;
      check(next.entities[instance]?.kind==='assembly'&&next.entities[instance].prefab===to.prefab&&
        next.entities[instance].revision===to.revision,'Repairs must retain the upgraded assembly identity');
      const ports=R.prefabInterfaces(next,options).ports;
      const incoming=new Map();
      for(const edge of next.connections)if(edge.to&&edge.from){
        const to=portOf(next,edge.to);
        incoming.set(to,(incoming.get(to)??0)+1);
      }
      for(const [alias,port] of Object.entries(next.entities[instance].ports??{}))
        if(!own(ports.outputs,port)&&!own(ports.inputs,port))
          issue('port',{alias,port,reason:'Public alias does not address a target input or output'});
      for(const row of report.connections){
        const edge=row.after;
        if(!edge)continue;
        const from=edge.from&&ports.outputs[portOf(next,edge.from)], to=edge.to&&ports.inputs[portOf(next,edge.to)];
        const alreadyDriven=edge.to&&incoming.get(portOf(next,edge.to))>1;
        if(!from||!to||from.type!==to.type||alreadyDriven){
          row.status='repair';row.reason=!from||!to?'Missing mapped output or input':
            from.type!==to.type?'Mapped port types differ':'More than one connection feeds the mapped input';
          issue('connection',{before:row.before,after:edge,reason:row.reason});
        }else row.status=equal(row.before,edge)?'preserved':'remapped';
      }
      for(const row of report.attachments)if(row.kind==='anchor'){
        const actual=next.entities[row.entity]?.anchor;
        const host=actual&&next.entities[actual.entity];
        row.status=host&&(row.to!==null||!equal(row.from,actual))&&(actual.socket===undefined||own(host.sockets,actual.socket))?
          (equal(row.from,actual)?'preserved':'remapped'):'repair';
        if(row.status==='repair')issue('attachment',{entity:row.entity,from:row.from,to:row.to,reason:'Mapped socket is missing'});
      }
      if(report.issues.length)return finish();
      next=R.validate(next,options);
      const saved=checkpoint&&W.prefabState.checkpoint(checkpoint,next,migration,helpers);
      return finish(next,saved);
    }catch(error){issue(checkpoint?'checkpoint-or-scene':'validation',{reason:error.message});return finish();}
  }
  W.upgradePrefab=upgrade;
})(KIT);
