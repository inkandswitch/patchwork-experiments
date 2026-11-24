/* Portable scene entities with a single owner, stable lifetimes and staged arrival. */
(function(K){
  const W=K.world, {check,record,id,own,safeKey,vector,copy}=W.data, {freeze}=K.procedural.data;
  const projection=Symbol('scene entity projection'), identity=freeze(K.M.id());
  const empty=freeze({}), maxGroups=4096, maxParts=256, maxEntities=10000;
  const parentOf=row=>row.anchor?.entity??row.parent;
  const validGeneration=value=>Number.isSafeInteger(value)&&value>0;
  const parts=group=>Object.keys(group.entities);
  function rotation(value){
    check(K.anim.keyframeTrack.orientation(value),'Entity rotation needs a right-handed rigid matrix');
    return value;
  }

  function bundle(value,generation,loaded,known){
    const {id:key,place,entities,state=null,rotation:turn=identity}=copy(value);
    check(id(key)&&safeKey(place)&&known(place)&&record(entities)&&own(entities,key)&&
      Object.keys(entities).length<=maxParts&&typeof loaded==='boolean'&&validGeneration(generation),
    'A lifecycle group needs a root, a known place and a bounded entity table');
    for(const [name,row] of Object.entries(entities)){
      check(id(name)&&record(row)&&(row.position===undefined||vector(row.position))&&
        (row.sockets===undefined||record(row.sockets)&&Object.entries(row.sockets).every(([name,point])=>id(name)&&vector(point))),
      'Invalid lifecycle entity '+name);
      if(row.parent!=null)check(id(row.parent)&&own(entities,row.parent),'Unresolved lifecycle parent on '+name);
      if(row.anchor!==undefined)check(record(row.anchor)&&id(row.anchor.entity)&&own(entities,row.anchor.entity)&&
        (row.anchor.socket===undefined||id(row.anchor.socket)&&own(entities[row.anchor.entity].sockets,row.anchor.socket)),
      'Unresolved lifecycle anchor on '+name);
      check(row.place===undefined||row.place===place,'Lifecycle entities must share their group place');
      delete row.place;
    }
    check(parentOf(entities[key])==null,'The lifecycle root cannot have a parent');
    for(const name of Object.keys(entities)){
      const visited=new Set();
      let cursor=name;
      while(cursor!==key){
        check(cursor!=null&&!visited.has(cursor),'Lifecycle entities must form one rooted group: '+name);
        visited.add(cursor);
        cursor=parentOf(entities[cursor]);
      }
    }
    return freeze({id:key,generation,place,loaded,entities,state,rotation:rotation(turn)});
  }
  function assertAvailable(names,authored){
    check(record(authored),'Authored entity IDs need a record');
    const collision=names.find(name=>own(authored,name));
    check(collision===undefined,'Lifecycle entity ID collides with authored entity '+collision);
  }
  function reader(entries){
    const scenes=new Map();
    function scene(place){
      if(!scenes.has(place)){
        const entities={}, rotations={};
        for(const group of entries().values())if(group.place===place&&group.loaded){
          Object.assign(entities,group.entities);
          rotations[group.id]=group.rotation;
        }
        scenes.set(place,freeze({entities,rotations}));
      }
      return scenes.get(place);
    }
    return Object.freeze({
      get:key=>entries().get(key)??null,
      scene,invalidate:place=>place===undefined?scenes.clear():scenes.delete(place),
      assertPlace(place,authored){
        assertAvailable([...entries().values()].filter(group=>group.place===place).flatMap(parts),authored);
      }
    });
  }

  function create({known=()=>true,authored=()=>empty,guard=()=>{}}={}){
    check([known,authored,guard].every(value=>typeof value==='function'),'Invalid entity lifecycle host');
    let groups=new Map(), members=new Set(), generation=1;
    const reading=reader(()=>groups);
    function replace(group){
      const prior=groups.get(group.id);
      groups.set(group.id,group);
      if(prior&&prior.place!==group.place&&prior.loaded)reading.invalidate(prior.place);
      if(!prior||prior.place!==group.place||prior.loaded!==group.loaded||
        (group.loaded&&(prior.entities!==group.entities||prior.rotation!==group.rotation)))reading.invalidate(group.place);
      return group;
    }
    function resolve(handle){
      check(record(handle)&&id(handle.id)&&validGeneration(handle.generation),'Expected an entity lifetime handle');
      const group=groups.get(handle.id);
      check(group?.generation===handle.generation,'Unknown or stale entity lifetime '+handle.id);
      return group;
    }
    const handleOf=group=>freeze({id:group.id,generation:group.generation});
    function spawn(spec){
      guard();
      check(groups.size<maxGroups&&generation<Number.MAX_SAFE_INTEGER,'Entity lifecycle capacity reached');
      const group=bundle(spec,generation,true,known), names=parts(group);
      check(members.size+names.length<=maxEntities&&names.every(name=>!members.has(name)),
        'Lifecycle entity IDs must be unique across all loaded and unloaded groups');
      assertAvailable(names,authored(group.place));
      for(const name of names)members.add(name);
      generation++;
      replace(group);
      return handleOf(group);
    }
    function setLoaded(handle,loaded){
      guard();
      const group=resolve(handle);
      if(group.loaded===loaded)return group;
      if(loaded)assertAvailable(parts(group),authored(group.place));
      return replace(freeze({...group,loaded}));
    }
    function update(handle,edit){
      guard();
      check(record(edit)&&Object.keys(edit).every(key=>['position','rotation','state'].includes(key)),'Invalid lifecycle entity update');
      const group=resolve(handle), {position,rotation:turn,state}=copy(edit);
      check(position===undefined||vector(position),'Entity position must be finite XYZ');
      const entities=position===undefined?group.entities:
        {...group.entities,[group.id]:{...group.entities[group.id],position}};
      return replace(freeze({...group,entities,rotation:turn===undefined?group.rotation:rotation(turn),
        state:state===undefined?group.state:state}));
    }
    function despawn(handle){
      guard();
      const group=resolve(handle);
      groups.delete(group.id);
      for(const name of parts(group))members.delete(name);
      if(group.loaded)reading.invalidate(group.place);
      return group;
    }
    function actor(handle,properties={}){
      const group=resolve(handle);
      check(group.loaded&&record(properties),'A portal actor needs a loaded entity group');
      const value=copy(properties);
      check(value.position===undefined||vector(value.position),'Actor position must be finite XYZ');
      if(value.rotation!==undefined)rotation(value.rotation);
      return freeze({position:group.entities[group.id].position??[0,0,0],rotation:group.rotation,...value,
        id:group.id,entityHandle:handleOf(group)});
    }
    function mapActor(actor,opening){
      if(!actor.entityHandle||!opening||actor.rotation===undefined)return null;
      const turn=rotation(actor.rotation), axes=K.M.tr(turn);
      return {rotation:K.M.tr([0,3,6].flatMap(i=>opening.direction(axes.slice(i,i+3))))};
    }
    function planTravel({actor,arrival,link,authored:destination}){
      if(actor.entityHandle===undefined)return {status:'ready'};
      const handle=actor.entityHandle, from=link.from.place, to=link.to.place;
      const group=groups.get(handle?.id);
      const blocked=(reason,entity=handle?.id)=>freeze({status:'blocked',reason,...(id(entity)&&{entity})});
      if(!group||group.generation!==handle.generation||actor.id!==group.id)return blocked('stale-entity');
      if(!group.loaded||group.place!==from)return blocked('unavailable-entity');
      if(arrival.id!==group.id||!W.data.equal(arrival.entityHandle,handle))return blocked('entity-identity');
      const collision=parts(group).find(name=>own(destination,name));
      if(collision!==undefined)return blocked('occupied-entity',collision);
      const next=freeze({...group,place:to,rotation:rotation(arrival.rotation??group.rotation),
        entities:{...group.entities,[group.id]:{...group.entities[group.id],position:arrival.position}}});
      return {status:'ready',entity:handleOf(group),commit:()=>replace(next)};
    }
    function checkpoint(){
      return freeze({version:1,nextGeneration:generation,groups:[...groups.values()]});
    }
    function planRestore(saved,placeExists=known){
      check(record(saved)&&saved.version===1&&validGeneration(saved.nextGeneration)&&
        Array.isArray(saved.groups)&&saved.groups.length<=maxGroups,'Invalid entity lifecycle checkpoint');
      const next=new Map(), names=new Set(), generations=new Set();
      for(const row of saved.groups){
        check(record(row),'Invalid saved lifecycle group');
        const group=bundle(row,row.generation,row.loaded,placeExists), ids=parts(group);
        check(group.generation<saved.nextGeneration&&!generations.has(group.generation)&&names.size+ids.length<=maxEntities&&
          ids.every(name=>!names.has(name)),'Conflicting saved entity lifetimes');
        for(const name of ids)names.add(name);
        generations.add(group.generation);
        next.set(group.id,group);
      }
      return {view:reader(()=>next),commit(){
        generation=saved.nextGeneration;
        members=names;
        groups=next;
        reading.invalidate();
      }};
    }
    const api=Object.freeze({
      spawn,get:(key,generation)=>{const group=reading.get(key);return generation===undefined||group?.generation===generation?group:null;},
      update,unload:handle=>setLoaded(handle,false),restoreEntity:handle=>setLoaded(handle,true),despawn,actor,
      scene:place=>reading.scene(place),checkpoint
    });
    return Object.freeze({api,mapActor,planTravel,planRestore,get view(){return reading;}});
  }
  W.entityLifecycle=Object.freeze({create,projection,assertAvailable});
})(KIT);
