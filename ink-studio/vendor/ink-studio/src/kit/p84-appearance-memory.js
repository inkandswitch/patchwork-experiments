/* Storage-independent snapshots of last-used appearance settings. */
(function (K) {
  const A=K.authoring,P=K.procedural||A,{clone,freeze}=A.data;
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const name=value=>typeof value==='string'&&value.length>0&&
    !['__proto__','prototype','constructor'].includes(value);

  function appearanceMemory({storage,key='ink-studio/tool-appearance',normalize=value=>value}={}) {
    if(!name(key)||typeof normalize!=='function'||
       storage!=null&&(typeof storage.getItem!=='function'||typeof storage.setItem!=='function'))
      throw Error('Appearance memory needs a key, a normalizer and an optional storage adapter');
    function setting(value){
      if(!record(value))throw Error('An appearance setting must be an object');
      const result=clone(normalize(clone(value)));
      if(!record(result))throw Error('An appearance normalizer must return an object');
      return result;
    }
    let state=freeze({});
    const saved=storage?.getItem(key);
    if(saved){
      const prior=JSON.parse(saved);
      if(!record(prior)||!Object.keys(prior).every(name))throw Error('Invalid appearance memory');
      state=freeze(Object.fromEntries(Object.entries(prior).map(([id,value])=>[id,setting(value)])));
    }
    function save(next){
      if(storage)storage.setItem(key,JSON.stringify(next));
      state=freeze(next);
    }
    return Object.freeze({
      get(id){return Object.hasOwn(state,id)?state[id]:null;},
      set(id,value){
        if(!name(id))throw Error('Invalid appearance scope');
        save({...state,[id]:setting(value)});
      },
      clear(id){
        if(id===undefined){save({});return;}
        if(!name(id))throw Error('Invalid appearance scope');
        if(!Object.hasOwn(state,id))return;
        const next={...state};
        delete next[id];
        save(next);
      },
      snapshot(){return state;}
    });
  }
  P.appearanceMemory=appearanceMemory;
})(KIT);
