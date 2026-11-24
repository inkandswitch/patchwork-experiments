/* Portable material properties shared by solvers and the renderer. */
(function (K) {
  const A=K.authoring, {clone,freeze}=A.data;
  const name='[a-z][a-z0-9-]{0,47}', assetId=new RegExp('^'+name+'/'+name+'$');
  const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const hasKeys=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const coefficient=(value,min,max)=>number(value,min,max)||hasKeys(value,['dry','wet'])&&
    number(value.dry,min,max)&&number(value.wet,min,max);
  const rules={
    friction:[0,4],permeability:[0,100],dryingRate:[0,100],
    thermal:{heatCapacity:[1e-6,1e12],conductance:[0,1e12]},
    fracture:{energy:[0,1e12],parts:[2,32]},
    fatigue:{endurance:[1e-6,1e12],life:[1e-4,1e12],exponent:[1,12]},
    plastic:{yield:[1e-6,1e12],creep:[0,1e4],limit:[0,4]},
    erosion:{threshold:[0,1e4],rate:[0,100]}
  };
  const cue=value=>typeof value==='string'&&/^[a-z][a-z0-9._/-]{0,127}$/.test(value);
  const color=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  const ramp=value=>Array.isArray(value)&&value.length>=1&&value.length<=16&&
    value.every(color);
  function checkContactEffects(value) {
    check(hasKeys(value,['rut','spray','sound','shake']), 'Invalid material contact effects');
    for (const [kind,spec] of Object.entries(value)) {
      const valid=kind==='rut'?coefficient(spec,0,16):kind==='spray'?
        hasKeys(spec,['count','speed','life','radius','color'])&&coefficient(spec.count,0,32)&&
          number(spec.speed??2,.01,50)&&number(spec.life??.34,.02,3)&&number(spec.radius??.035,.001,1)&&
          (spec.color===undefined||color(spec.color)):
        kind==='sound'?hasKeys(spec,['gain','interval'])&&coefficient(spec.gain??1,0,4)&&
          number(spec.interval??.15,0,10):
        hasKeys(spec,['strength','life','frequency'])&&coefficient(spec.strength,0,1)&&
          number(spec.life??.16,.02,2)&&number(spec.frequency??18,1,60);
      check(valid,'Invalid material contact effects '+kind);
    }
  }
  function checkStructural(key,value,wet=true) {
    const rule=key==='fatigue'||key==='plastic'?rules[key]:undefined;
    check(rule&&hasKeys(value,Object.keys(rule))&&Object.entries(rule).every(([k,[min,max]])=>
      (wet?coefficient(value[k],min,max):number(value[k],min,max))),'Invalid structural material '+key);
  }

  function definition(input,pack) {
    check(hasKeys(input,['id','label',...Object.keys(rules),'sounds','appearance','contactEffects'])&&
      typeof input.id==='string'&&assetId.test(input.id)&&input.id.startsWith(pack+'/')&&
      typeof input.label==='string'&&input.label.trim().length>0&&input.label.length<=100,
    'A physical material needs a name within its asset pack and a label');
    for(const [key,range] of Object.entries(rules)) {
      if(!Object.hasOwn(input,key))continue;
      const value=input[key], fail='Invalid physical material '+input.id+' '+key;
      if(key==='fatigue'||key==='plastic'){checkStructural(key,value);continue;}
      if(Array.isArray(range))check(coefficient(value,...range),fail);
      else {
        check(hasKeys(value,Object.keys(range))&&Object.keys(value).length===Object.keys(range).length,fail);
        for(const [property,[min,max]] of Object.entries(range)) {
          const valid=property==='parts'?Number.isSafeInteger(value[property])&&number(value[property],min,max):
            coefficient(value[property],min,max);
          check(valid,fail+'.'+property);
        }
      }
    }
    if(Object.hasOwn(input,'sounds'))check(hasKeys(input.sounds,['step','roll','impact','fracture'])&&
      Object.values(input.sounds).every(cue),'Invalid physical material sound cue on '+input.id);
    if(Object.hasOwn(input,'contactEffects'))checkContactEffects(input.contactEffects);
    if(Object.hasOwn(input,'appearance')) {
      const value=input.appearance;
      check(hasKeys(value,['dry','wet'])&&ramp(value.dry)&&
        (!Object.hasOwn(value,'wet')||ramp(value.wet)&&value.wet.length===value.dry.length),
      'Physical material appearance needs equal-length hex color ramps on '+input.id);
    }
    return freeze({...clone(input),label:input.label.trim()});
  }
  function profile(entry,wetness=0) {
    check(number(wetness,0,1),'Material wetness must be between 0 and 1');
    const {material,pack,revision}=entry, {id,label,sounds,appearance,contactEffects}=material;
    const blend=value=>typeof value==='number'?value:value.dry*(1-wetness)+value.wet*wetness;
    const result={id,label,pack,revision,wetness,...(sounds&&{sounds}),...(appearance&&{appearance}),
      ...(contactEffects&&{contactEffects})};
    for(const [key,range] of Object.entries(rules)) {
      if(!Object.hasOwn(material,key))continue;
      const value=material[key];
      result[key]=Array.isArray(range)?blend(value):
        Object.fromEntries(Object.entries(value).map(([name,coefficient])=>[name,blend(coefficient)]));
    }
    return result;
  }
  A.physicalMaterials=Object.freeze({definition,profile,checkStructural,checkContactEffects});
})(KIT);
