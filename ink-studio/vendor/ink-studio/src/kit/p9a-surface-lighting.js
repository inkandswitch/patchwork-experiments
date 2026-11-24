/* Carry a material-independent surface tone into any presentation renderer. */
(function(K){
  const P=K.procedural||K.authoring;
  const irradianceMax=1.5;
  const defaults=P.data.freeze({albedo:[.90,.89,.86],fallback:.59,background:null,
    preserveEmission:true,preserveLiquid:true});
  const color=value=>Array.isArray(value)&&value.length===3&&value.every(v=>Number.isFinite(v)&&v>=0&&v<=1);

  function override(value={}){
    if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.keys(value).some(key=>!Object.hasOwn(defaults,key)))
      throw Error('Unknown surface lighting override settings');
    const {albedo,fallback,background,preserveEmission,preserveLiquid}={...defaults,...value};
    if(!color(albedo)||!Number.isFinite(fallback)||fallback<0||fallback>irradianceMax||
       background!==null&&!color(background)||typeof preserveEmission!=='boolean'||typeof preserveLiquid!=='boolean')
      throw Error('Surface lighting needs normalized colors, a valid fallback and boolean exclusions');
    return P.data.freeze({albedo:albedo.slice(),fallback,background:background?.slice()??null,
      preserveEmission,preserveLiquid});
  }

  function shade(irradiance,style=defaults){
    if(irradiance!==undefined&&!Number.isFinite(irradiance))
      throw Error('Surface irradiance must be finite');
    const light=K.clamp(irradiance??style.fallback,0,irradianceMax);
    return style.albedo.map(channel=>Math.min(1,channel*light));
  }

  P.surfaceLighting=Object.freeze({defaults,irradianceMax,override,shade});
})(KIT);
