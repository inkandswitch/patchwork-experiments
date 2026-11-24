/* Semantic appearance samples and transactional transfers over caller-defined bindings. */
(function(K){
  const A=K.authoring,{clone,freeze}=A.data;
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const name=value=>typeof value==='string'&&value.length>0&&value.length<=128&&
    !['__proto__','prototype','constructor'].includes(value);
  const view=source=>typeof source.snapshot==='function'?source.snapshot():source;
  const equal=(a,b)=>Object.is(a,b)||JSON.stringify(a)===JSON.stringify(b);
  const format='ink-studio/appearance-sample/1';

  function create({describe,compatible=(sample,target)=>sample.family===target.family,validate} = {}){
    if(typeof describe!=='function'||typeof compatible!=='function'||validate!==undefined&&typeof validate!=='function')
      throw Error('Appearance transfer needs a binding and compatibility policy');

    function binding(entity,source,sample){
      const result=describe(entity,source,sample);
      if(result==null)return null;
      if(!record(result)||!name(result.family)||!record(result.slots)||Object.keys(result.slots).length>96||
         result.label!==undefined&&(typeof result.label!=='string'||result.label.length>160))
        throw Error('Invalid appearance binding');
      const entries=Object.entries(result.slots);
      for(const [key,slot] of entries){
        const path=slot?.path;
        if(!name(key)||!Array.isArray(path)||path.length<2||path.length>9||!path.every(name)||
           !['appearance','parameters'].includes(path[0])||path[0]==='parameters'&&path[1]==='transform')
          throw Error('Appearance slots need a semantic key and a local appearance or parameter path');
        if(slot.encode!==undefined&&typeof slot.encode!=='function')
          throw Error('Appearance slot encoders must be functions');
        if(slot.target!==undefined&&(!name(slot.target)||!Object.hasOwn(source.entities,slot.target)))
          throw Error('Appearance slot targets must be existing entities');
      }
      return {family:result.family,label:result.label??result.family,entries};
    }
    function capture(source,id){
      const s=view(source),entity=Object.hasOwn(s.entities,id)&&s.entities[id];
      if(!entity)throw Error('Unknown appearance source: '+id);
      const spec=binding(entity,s);
      if(!spec)return null;
      const values={};
      for(const [key,slot] of spec.entries)if(slot.value!==undefined)values[key]=clone(slot.value);
      if(!Object.keys(values).length)return null;
      return freeze({format,family:spec.family,label:spec.label,values});
    }
    function input(sample){
      if(!record(sample)||sample.format!==format||!name(sample.family)||!record(sample.values)||
         Object.keys(sample.values).length>96||!Object.keys(sample.values).every(name))
        throw Error('Invalid portable appearance sample');
      return freeze(clone(sample));
    }
    function plan(source,ids,raw){
      const s=view(source),sample=input(raw);
      if(!Array.isArray(ids)||ids.length>2048||!ids.every(name))throw Error('Appearance targets need up to 2048 entity IDs');
      const edits=[],skipped=[],writes=new Map();
      for(const id of new Set(ids)){
        const e=Object.hasOwn(s.entities,id)&&s.entities[id];
        if(!e){skipped.push({id,reason:'missing'});continue;}
        const target=binding(e,s,sample);
        if(!target||!compatible(sample,target,e,s)){skipped.push({id,reason:'incompatible'});continue;}
        let matched=false,changed=false;
        for(const [key,slot] of target.entries){
          if(!Object.hasOwn(sample.values,key))continue;
          const {path,value,encode}=slot;
          const owner=slot.target??id;
          let paths=writes.get(owner);
          if(!paths)writes.set(owner,paths=new Map());
          const supplied=sample.values[key],next=encode?clone(encode(clone(supplied))):supplied,
            encoded=JSON.stringify(path),same=Object.hasOwn(slot,'stored')?equal(slot.stored,next):equal(value,supplied);
          matched=true;changed||=!same;
          if(paths.has(encoded)){
            if(!equal(paths.get(encoded).next,next))throw Error('Appearance slots conflict on '+owner);
            paths.get(encoded).same&&=same;
          }else paths.set(encoded,{path,next,same});
        }
        if(!matched)skipped.push({id,reason:'no-common-slots'});
        else if(!changed)skipped.push({id,reason:'unchanged'});
      }
      for(const [id,paths] of writes){
        const patch={};
        for(const {path,next,same} of paths.values()){
          for(let i=1;i<path.length;i++){
            const prefix=JSON.stringify(path.slice(0,i));
            if(paths.has(prefix))throw Error('Overlapping appearance slots on '+id);
          }
          if(same)continue;
          let current=patch;
          for(const part of path.slice(0,-1))current=current[part]??(current[part]={});
          current[path.at(-1)]=clone(next);
        }
        if(Object.keys(patch).length)edits.push({id,patch});
      }
      const result=freeze({edits,skipped});
      if(edits.length)validate?.(s,result.edits,sample);
      return result;
    }
    function apply(doc,ids,sample,{label='Transfer appearance'} = {}){
      const result=plan(doc,ids,sample);
      if(!result.edits.length)return result;
      const write=()=>{for(const {id,patch} of result.edits)doc.update(id,patch);};
      if(doc.pending())write();
      else doc.transact(label,write);
      return result;
    }
    return Object.freeze({capture,plan,apply});
  }
  A.appearanceTransfer=Object.freeze({create});
})(KIT);
