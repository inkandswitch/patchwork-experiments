/* Device controls mapped to named actions in each caller-owned context. */
(function (K) {
  const P=K.procedural||K.authoring;
  const name=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}$/i.test(value);
  const control=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}:[a-z0-9][a-z0-9_-]{0,47}$/i.test(value);
  function chord(modifiers){
    if(!Array.isArray(modifiers)||modifiers.length>8||!Array.from(modifiers).every(name)||
       new Set(modifiers).size!==modifiers.length)throw Error('Invalid input modifiers');
    return modifiers.slice().sort().join('+');
  }

  function compile(contexts) {
    const entries=Object.entries(contexts||{}), maps=new Map();
    if (!entries.length||entries.length>16) throw Error('Input needs 1..16 contexts');
    for (const [context,actions] of entries) {
      const list=Object.entries(actions||{}), byControl=new Map(), byAction=new Map();
      if (!name(context)||!list.length||list.length>128) throw Error('Invalid input context');
      for (const [action,bindings] of list) {
        if (!name(action)||!Array.isArray(bindings)||bindings.length>16) throw Error('Invalid input action');
        const owned=Array.from(bindings,binding=>{
          const { input, deadZone=0, scale=1, modifiers=[] }=typeof binding==='string'?{input:binding}:binding||{};
          if (!control(input)||!Number.isFinite(deadZone)||deadZone<0||deadZone>=1||
              !Number.isFinite(scale)||Math.abs(scale)>1) throw Error('Invalid action binding');
          const key=chord(modifiers),combinations=byControl.get(input)||new Map();
          if(combinations.has(key))throw Error('A control already has an action in '+context+': '+input+(key?' + '+key:''));
          const value=Object.freeze({ input, deadZone, scale,
            ...(key&&{modifiers:Object.freeze(key.split('+'))}) });
          combinations.set(key,{action,binding:value});
          byControl.set(input,combinations);
          return value;
        });
        byAction.set(action,Object.freeze(owned));
      }
      maps.set(context,{byControl,byAction});
    }
    function get(context) {
      if (!maps.has(context)) throw Error('Unknown input context: '+context);
      return maps.get(context);
    }
    function level(raw,{deadZone,scale}) {
      if (!Number.isFinite(raw)||Math.abs(raw)>1) throw Error('Input values must be in [-1, 1]');
      const magnitude=Math.abs(raw);
      return magnitude<=deadZone ? 0 : Math.sign(raw)*(magnitude-deadZone)/(1-deadZone)*scale;
    }
    function resolve(context,input,raw=1,modifiers=[]) {
      const match=get(context).byControl.get(input)?.get(chord(modifiers));
      return match?{action:match.action,value:level(raw,match.binding)}:null;
    }
    function sample(context,sources) {
      const {byControl,byAction}=get(context), values=new Map([...byAction.keys()].map(id=>[id,0]));
      for (const source of sources) for (const [input,raw] of Object.entries(source)) {
        const match=byControl.get(input)?.get('');
        if (!match) continue;
        const value=level(raw,match.binding);
        if (Math.abs(value)>Math.abs(values.get(match.action))) values.set(match.action,value);
      }
      return Object.freeze(Object.fromEntries(values));
    }
    const profile=Object.freeze(Object.fromEntries([...maps].map(([context,{byAction}])=>
      [context,Object.freeze(Object.fromEntries(byAction))])));
    return Object.freeze({ resolve, sample, profile, bindings:(context,action)=>get(context).byAction.get(action) });
  }

  function radial(x,y,deadZone=0) {
    if (![x,y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1) ||
        !Number.isFinite(deadZone)||deadZone<0||deadZone>=1)
      throw Error('Radial input needs two axes in [-1, 1] and a dead zone below 1');
    const length=Math.hypot(x,y);
    if (length<=deadZone) return [0,0];
    const strength=(Math.min(1,length)-deadZone)/(1-deadZone);
    return [x/length*strength,y/length*strength];
  }

  function permutation(controls,overrides={}) {
    if (!Array.isArray(controls)||controls.length<1||controls.length>128||
        !Array.from(controls).every(control)||new Set(controls).size!==controls.length)
      throw Error('Expected 1..128 distinct controls');
    if (!overrides||typeof overrides!=='object'||Array.isArray(overrides))
      throw Error('Invalid control overrides');
    const selected=new Set(controls);
    if (Object.entries(overrides).some(([key,target])=>!selected.has(key)||!selected.has(target)))
      throw Error('Unknown control in overrides');
    const mapping=new Map(controls.map(key=>[key,Object.hasOwn(overrides,key)?overrides[key]:key]));
    const owners=new Map([...mapping].map(([key,target])=>[target,key]));
    if (owners.size!==mapping.size) throw Error('Each physical control needs a unique assignment');
    const remap=input=>mapping.get(input)??input;
    const saved=Object.freeze(Object.fromEntries([...mapping].filter(([key,target])=>key!==target)));
    function swap(logical,physical) {
      if (!mapping.has(logical)||!owners.has(physical)) throw Error('Unknown control');
      return permutation([...mapping.keys()],{...saved,[logical]:physical,[owners.get(physical)]:remap(logical)});
    }
    return Object.freeze({remap,swap,overrides:saved});
  }

  function axisMapping(controls,{overrides={},inverted=[]}={}){
    const mapping=permutation(controls,overrides),slots=controls.slice();
    if(!Array.isArray(inverted)||!Array.from(inverted).every(axis=>slots.includes(axis))||
       new Set(inverted).size!==inverted.length)throw Error('Expected distinct inverted axes from the control list');
    const reversed=new Set(inverted),directions=Object.freeze(slots.filter(axis=>reversed.has(axis)));
    const assignments=slots.map(axis=>[axis,mapping.remap(axis),reversed.has(axis)?-1:1]);
    function project(source){
      const sample={...source};
      for(const [axis,input,sign] of assignments){
        const value=source[input]??0;
        if(!Number.isFinite(value)||Math.abs(value)>1)throw Error('Axis values must be in [-1, 1]');
        sample[axis]=value===0?0:sign*value;
      }
      return sample;
    }
    function swap(axis,input){
      return axisMapping(slots,{overrides:mapping.swap(axis,input).overrides,inverted:directions});
    }
    function invert(axis,enabled=true){
      if(!slots.includes(axis)||typeof enabled!=='boolean')throw Error('Unknown axis or invalid inversion');
      const next=directions.filter(input=>input!==axis);
      if(enabled)next.push(axis);
      return axisMapping(slots,{overrides:mapping.overrides,inverted:next});
    }
    return Object.freeze({project,swap,invert,remap:mapping.remap,overrides:mapping.overrides,inverted:directions});
  }

  P.inputActions=Object.freeze({compile,radial,permutation,axisMapping});
})(KIT);
