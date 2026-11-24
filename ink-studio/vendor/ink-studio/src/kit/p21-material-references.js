/* Resolve named material chains, keeping local property overrides. */
(function(K){
  const {clone,merge}=(K.procedural||K.authoring).data;
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const reference=value=>typeof value==='string'&&value.length>0&&
    !value.startsWith('#')&&!['__proto__','constructor','prototype'].includes(value);

  function resolve(materials,role,missing='Unknown material role'){
    const seen=new Set(),layers=[];
    for(;;){
      if(seen.has(role))throw Error('Cyclic material role: '+role);
      seen.add(role);
      const raw=Object.hasOwn(materials,role)?materials[role]:undefined;
      if(raw===undefined)throw Error(missing+': '+role);
      if(typeof raw==='string'&&!raw.startsWith('#')){
        if(!reference(raw))throw Error('Invalid material alias');
        role=raw;
        continue;
      }
      const value=isRecord(raw)?clone(raw):{color:raw};
      if(value.alias===undefined){
        return layers.reduceRight((base,layer)=>merge(base,layer),value);
      }
      if(!reference(value.alias))throw Error('Invalid material alias');
      role=value.alias;
      delete value.alias;
      layers.push(value);
    }
  }

  function recolor(raw,color){
    return reference(raw)?{alias:raw,color}:{color};
  }
  K.materialReferences=Object.freeze({reference,resolve,recolor});
})(KIT);
