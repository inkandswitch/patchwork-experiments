/* Persistent wetness, standing water, temperature and phase deposits on an XZ grid. */
(function (K) {
  const P=K.procedural,M=P.motion,V=K.V,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    between=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    unit=n=>between(n,0,1),
    clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),
    vector=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);

  function surfaceWeather(options={}){
    const d=M.gridDomain(options),{width,height,size,open,dx,dz,center,inside}=d,
      {initial,normal,clock,maxDt=0.2,maxRunoff=0.8,maxWork=52000000, wetDiffusion=0.024,
        heatDiffusion=0.018, capacity=1, snowCapacity=3, freezePoint=0, exchange=0.72,
        sunHeat=12, evaporation=0.29, meltRate=0.11, freezeRate=0.08, standingWater=false}=options;
    if([initial,normal].some(fn=>fn!==undefined&&typeof fn!=='function')||
      !between(maxDt,1e-5,3)||!between(maxRunoff,0,1000)||!integer(maxWork,1,180000000)||
      !between(capacity,1e-5,1e4)||!between(snowCapacity,1e-5,1e4)||!between(freezePoint,-120,120)||
      ![wetDiffusion,heatDiffusion,exchange,sunHeat,evaporation,meltRate,freezeRate].every(v=>between(v,0,1e4))||
      (clock!==undefined&&(!clock||typeof clock!=='object'||Array.isArray(clock))))
      throw new Error('Surface weather needs bounded thermal and moisture controls');
    const water = standingWater === true ? {} : standingWater;
    if (water !== false && (!water || ![Object.prototype, null].includes(Object.getPrototypeOf(water)) ||
        Object.keys(water).some(key => !['capacity','drainage','evaporation'].includes(key))))
      throw new TypeError('Standing water needs capacity, drainage or evaporation settings');
    const { capacity: basinCapacity = .20, drainage = .045, evaporation: waterEvaporation = .5 } = water || {};
    if ((typeof basinCapacity !== 'function' && !between(basinCapacity,0,1e4)) ||
        !between(drainage,0,1e4) || !between(waterEvaporation,0,1e4))
      throw new RangeError('Invalid standing water capacity, drainage or evaporation');
    const basins = water && new Float64Array(size);
    const solar=clock===undefined?null:P.data.freeze(P.data.clone(clock)), normals=[],
      fields={wetness:new Float64Array(size),temperature:new Float64Array(size),
        snow:new Float64Array(size),frost:new Float64Array(size),exposure:new Float64Array(size)};
    if (basins) fields.standingWater = new Float64Array(size);
    if(solar)P.environmentFields.evaluate(solar,0);
    for(let i=0;i<size;i++){
      if(!open[i])continue;
      const p=center(i),n=normal?normal(...p,i):[0,1,0],
        state = initial ? initial(...p,i) ?? {} : {},
        {wetness=0,temperature=10,snow=0,frost=0,exposure=0}=state;
      if (basins) {
        const limit = typeof basinCapacity === 'function' ? basinCapacity(...p,i) : basinCapacity;
        const depth = state.standingWater ?? 0;
        if (!between(limit,0,1e4) || !between(depth,0,limit - Math.max(0,frost - capacity)))
          throw new RangeError('Initial standing water must fit its local basin capacity');
        basins[i] = limit;
        fields.standingWater[i] = depth;
      }
      if(!vector(n,3)||V.len(n)<1e-9||!between(wetness,0,capacity)||
        !between(temperature,-240,550)||!between(snow,0,snowCapacity)||!between(frost,0,capacity+(basins?.[i] ?? 0))||
        !between(exposure,0,1e14))throw new Error('Initial surface weather must be finite and within each field capacity');
      normals[i]=V.norm(n);
      fields.wetness[i]=wetness;
      fields.temperature[i]=temperature;
      fields.snow[i]=snow;
      fields.frost[i]=frost;
      fields.exposure[i]=exposure;
    }
    const X=1/(dx*dx),Z=1/(dz*dz),
      stability=2*Math.max(wetDiffusion,heatDiffusion)*(X+Z)+maxRunoff*(1/dx+1/dz),
      timeStep=Math.min(maxDt,stability?0.47/stability:Infinity);
    let time=0;
    function snapshot(substeps=0){
      const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.slice()]));
      return Object.freeze({time,width,height,bounds:d.bounds,...data,substeps,
        sample(x,z){
          if(!inside(x,z))return null;
          return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,d.sample(value,x,z)]));
        }});
    }
    function checkpoint(){
      return {format:'ink-studio/surface-weather',version:1,time,width,height,bounds:{min:d.bounds.min.slice(),max:d.bounds.max.slice()},
        ...(options.mask && {open:Array.from(open)}),
        fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,Array.from(value)]))};
    }
    function restore(state){
      if(state?.format!=='ink-studio/surface-weather'||state.version!==1||
        state.width!==width||state.height!==height||!Number.isFinite(state.time)||state.time<0||
        !state.bounds||['min','max'].some(key=>!vector(state.bounds[key],2)||
          state.bounds[key].some((v,i)=>v!==d.bounds[key][i]))||
        (state.open===undefined ? open.some(v=>v!==1) :
          !vector(state.open,size)||open.some((v,i)=>v!==state.open[i]))||
        !state.fields||Object.keys(state.fields).length!==Object.keys(fields).length)
        throw new TypeError('Invalid surface weather checkpoint for this grid');
      const restored={};
      for(const key of Object.keys(fields)){
        if(!vector(state.fields[key],size))throw new TypeError('Invalid surface weather checkpoint field '+key);
        restored[key]=Float64Array.from(state.fields[key]);
      }
      Object.assign(fields,restored);
      time=state.time;
      return snapshot();
    }
    function step(duration,{forcing=()=>({})}={}){
      if(!between(duration,0,120)||typeof forcing!=='function')throw new Error('Surface weather needs a bounded interval and forcing field');
      if(!duration)return snapshot();
      const steps=Math.ceil(duration/timeStep),dt=duration/steps;
      if(steps>16000||steps*size*22>maxWork)throw new Error('Surface weather exceeds its integration budget');
      const wet=fields.wetness.slice(),temperature=fields.temperature.slice(),snow=fields.snow.slice(),
        frost=fields.frost.slice(),exposure=fields.exposure.slice(), pool=fields.standingWater?.slice(),
        dw=new Float64Array(size),dT=new Float64Array(size),records=new Array(size);
      function transfer(i,j,axis,coefficient,spacing){
        const flow=(records[i].runoff[axis]+records[j].runoff[axis])*0.5,
          move=(wet[i]-wet[j])*wetDiffusion*coefficient+
            (flow>=0?wet[i]:wet[j])*flow/spacing,
          heat=(temperature[i]-temperature[j])*heatDiffusion*coefficient;
        dw[i]-=move;
        dw[j]+=move;
        dT[i]-=heat;
        dT[j]+=heat;
      }
      for(let k=0;k<steps;k++){
        const t=time+k*dt,sun=solar?P.environmentFields.evaluate(solar,t).sun:null;
        for(let i=0;i<size;i++){
          if(!open[i])continue;
          const state={wetness:wet[i],temperature:temperature[i],snow:snow[i],frost:frost[i],
            exposure:exposure[i],normal:normals[i].slice(), ...(pool && { standingWater:pool[i] })};
          const {rain=0,snowfall=0,precipitationExposure=1,air=10,humidity=0.44,wind=0.35,shelter=0,heat=0,runoff=[0,0],
            light=sun?clamp(V.dot(sun,normals[i]),0,1):0}=forcing(...center(i),t,state)??{};
          if(!between(rain,0,1000)||!between(snowfall,0,1000)||!between(air,-240,500)||
            ![humidity,wind,shelter,light,precipitationExposure].every(unit)||!between(heat,-240,250)||!vector(runoff,2)||
            Math.hypot(...runoff)>maxRunoff+1e-10)
            throw new Error('Surface forcing values must be finite and within their configured limits');
          records[i]={rain:rain*precipitationExposure,snowfall:snowfall*precipitationExposure,
            air,humidity,wind,shelter,heat,light:light*(1-shelter),runoff:runoff.slice()};
        }
        dw.fill(0);dT.fill(0);
        for(let z=0,i=0;z<height;z++)for(let x=0;x<width;x++,i++){
          if(!open[i])continue;
          if(x+1<width&&open[i+1])transfer(i,i+1,0,X,dx);
          if(z+1<height&&open[i+width])transfer(i,i+width,1,Z,dz);
        }
        for(let i=0;i<size;i++){
          if(!open[i])continue;
          const {rain,snowfall,air,humidity,wind,shelter,heat,light}=records[i],
            source=clamp(air+light*sunHeat+heat,-240,550),
            nextT=temperature[i]+dt*dT[i],
            temp=nextT+(source-nextT)*(-Math.expm1(-exchange*dt)),
            hot=Math.max(0,temp-freezePoint),cold=Math.max(0,freezePoint-temp),
            catchment=snowfall?P.environmentFields.deposition({normal:normals[i],load:1,shelter}):0,
            packed=Math.min(snowCapacity,snow[i]+dt*snowfall*catchment),snowMelt=Math.min(packed,dt*meltRate*hot),
            thaw=Math.min(frost[i],dt*meltRate*hot*0.73),
            wet0=Math.max(0,wet[i]+dt*(dw[i]+rain))+snowMelt+thaw,
            pooled=pool?.[i] ?? 0,
            basin=basins?.[i] ?? 0,
            freeze=Math.min(wet0+pooled,Math.max(0,capacity+basin-frost[i]+thaw),freezeRate*cold*dt),
            ice=frost[i]+(freeze-thaw),
            drying=evaporation*(1-humidity)*(0.38+0.62*wind)*(1+light*0.78+0.04*hot);
          temperature[i]=temp;
          const film = Math.max(0, wet0 - (freeze - Math.min(pooled, freeze)));
          const survival = Math.exp(-drying*dt);
          if (basin) {
            // Fill the surface film first. Excess liquid stays in low spots and keeps the stone wet as it dries.
            const stillWet = Math.min(capacity, film) * survival;
            const room = Math.max(0, basin - Math.max(0, ice - capacity));
            const retained = Math.min(room, Math.max(0, pooled - freeze) + Math.max(0, film - capacity));
            const remaining = retained * Math.exp(-(drainage + drying * waterEvaporation)*dt);
            const absorbed = Math.min(remaining, capacity - stillWet);
            pool[i] = remaining - absorbed;
            wet[i] = stillWet + absorbed;
          } else wet[i] = Math.min(capacity, film * survival);
          snow[i]=packed-snowMelt;
          frost[i]=ice;
          exposure[i]+=light*dt;
        }
      }
      Object.assign(fields,{wetness:wet,temperature,snow,frost,exposure});
      if (pool) fields.standingWater = pool;
      time+=duration;
      return snapshot(steps);
    }
    return Object.freeze({step,snapshot,checkpoint,restore});
  }
  M.surfaceWeather=surfaceWeather;
})(KIT);
