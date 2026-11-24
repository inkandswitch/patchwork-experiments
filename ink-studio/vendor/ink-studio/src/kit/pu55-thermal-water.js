/* Water-equivalent ice and vapor, with an enthalpy budget per area. */
(function(K){
  const W=K.world, {check,record}=W.data, {zone,patchList,regions,clamp}=W.fields;
  const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const sum=values=>values.reduce((a,b)=>a+b,0);

  function create(config,{width,height,dx,dz,point,maxDepth,catalog}){
    check(record(config),'Invalid thermal water settings');
    const {freezingPoint=0,ambientTemperature=20,sourceTemperature=ambientTemperature,ambientField,
      heatCapacity=2e6,conductance=2e4,waterHeatCapacity=4.186e6,latentFusion=334e6,latentVaporization=2.45e9,
      saturation=.00005,evaporation=.5,condensation=2,vaporDiffusivity=.06,conductivity=2e4}=config;
    const temperature=n=>range(n,-273.15,1e4);
    const coefficient=n=>range(n,0,1e12), rate=n=>range(n,0,1e4);
    check(temperature(freezingPoint)&&temperature(ambientTemperature)&&temperature(sourceTemperature)&&
      (ambientField===undefined||typeof ambientField==='string')&&[heatCapacity,waterHeatCapacity,latentFusion,latentVaporization]
        .every(n=>range(n,1e-6,1e12))&&[conductance,conductivity].every(coefficient)&&
      range(saturation,1e-12,maxDepth)&&[evaporation,condensation,vaporDiffusivity].every(rate),'Invalid heat or phase coefficients');
    const temperatureMap=patchList(config.initialTemperature??[],2), vaporMap=patchList(config.initialVapor??[],2);
    check(temperatureMap.every(row=>temperature(row.value))&&vaporMap.every(row=>range(row.value,0,maxDepth)),
      'Invalid initial temperature or vapor depth');
    const size=width*height, area=dx*dz, vaporLatent=latentFusion+latentVaporization;
    const zones=config.materials??[];
    check(Array.isArray(zones)&&zones.length<=128,'Thermal material regions need a bounded list');
    const materialZones=zones.map(row=>{
      check(record(row)&&typeof row.material==='string','Thermal material region needs a material asset');
      const bounds=W.fields.bounds(row.bounds,2);
      const profile=W.materials.profile(W.materials.requireAsset(catalog,row.material),0);
      return {bounds,profile};
    });
    const cells=Array.from({length:size},(_,i)=>{
      const position=point(i);
      const profile=materialZones.findLast(row=>zone(position,row.bounds))?.profile;
      return {position,material:profile?.id??null,capacity:profile?.thermal?.heatCapacity??heatCapacity,
        ambient:profile?.thermal?.conductance??conductance,dry:profile?.dryingRate??evaporation};
    });
    const links=[];
    for(let i=0;i<size;i++){
      if(i%width+1<width)links.push([i,i+1,dx*dx,0]);
      if(i+width<size)links.push([i,i+width,dz*dz,1]);
    }
    const sensibleCapacity=(i,water)=>cells[i].capacity+waterHeatCapacity*water;
    function decode(e,water,i){
      const fusion=water*latentFusion;
      if(e<0)return {temperature:freezingPoint+e/sensibleCapacity(i,water),liquid:0};
      if(e>fusion)return {temperature:freezingPoint+(e-fusion)/sensibleCapacity(i,water),liquid:water};
      return {temperature:freezingPoint,liquid:Math.min(water,e/latentFusion)};
    }
    const vaporCapacity=t=>saturation*2**clamp((t-freezingPoint)/12,-16,18);
    const liquidEnergy=t=>latentFusion+waterHeatCapacity*(Math.max(t,freezingPoint)-freezingPoint);
    const incoming=liquidEnergy(sourceTemperature);
    function boot(fluid){
      const ice=[],vapor=[],energy=[];
      for(let i=0;i<size;i++){
        const {position}=cells[i], water=fluid.depth[i], t=regions(temperatureMap,position,ambientTemperature);
        ice[i]=t<freezingPoint?water:0;
        if(ice[i]){fluid.depth[i]=0;fluid.mx[i]=0;fluid.mz[i]=0;}
        vapor[i]=regions(vaporMap,position,0);
        energy[i]=sensibleCapacity(i,water)*(t-freezingPoint)+(ice[i]?0:water*latentFusion);
      }
      const initialEnergy=(sum(energy)+sum(vapor)*vaporLatent)*area;
      return {ice,vapor,energy,initialEnergy,initialVapor:sum(vapor)*area,ambientEnergy:0,
        sourceEnergy:0,exportedEnergy:0,appliedEnergy:0,evaporated:0,condensed:0};
    }
    function sample(state,fluid,i){
      const {ice,vapor,energy}=state, liquid=fluid.depth[i], {temperature}=decode(energy[i],liquid+ice[i],i);
      return {temperature,ice:ice[i],liquid,vapor:vapor[i],humidity:vapor[i]/vaporCapacity(temperature),
        material:cells[i].material,phase:ice[i]>1e-6?(liquid>1e-6?'mixed':'ice'):liquid>1e-6?'liquid':vapor[i]>1e-9?'vapor':'dry'};
    }
    function energyReport(state){
      const energy=(sum(state.energy)+sum(state.vapor)*vaporLatent)*area;
      const {initialEnergy,ambientEnergy,sourceEnergy,exportedEnergy,appliedEnergy,evaporated,condensed}=state;
      return {energy,initialEnergy,ambientEnergy,sourceEnergy,exportedEnergy,appliedEnergy,evaporated,condensed,
        error:energy-initialEnergy-ambientEnergy-sourceEnergy+exportedEnergy-appliedEnergy};
    }
    function validate(state){
      check(record(state)&&['ice','vapor','energy'].every(key=>Array.isArray(state[key])&&state[key].length===size&&
        state[key].every(n=>Number.isFinite(n)&&(key==='energy'||n>=0)))&&
        ['initialEnergy','initialVapor','ambientEnergy','sourceEnergy','exportedEnergy','appliedEnergy','evaporated','condensed']
          .every(key=>Number.isFinite(state[key])),'Invalid thermal checkpoint');
      const metric=energyReport(state), scale=Math.max(1,...Object.values(metric).slice(0,6).map(Math.abs));
      check(Math.abs(metric.error)<=1e-6*scale,'Saved heat balance is inconsistent');
    }
    function exchange(state,fluid,i,delta){
      const energy=state.energy.slice();
      const q=delta>=0?delta*incoming:delta*liquidEnergy(sample(state,fluid,i).temperature);
      energy[i]+=q;
      return {...state,energy,sourceEnergy:state.sourceEnergy+Math.max(0,q*area),
        exportedEnergy:state.exportedEnergy+Math.max(0,-q*area)};
    }
    function heat(state,indices,joules){
      if(!indices.length||!joules)return state;
      const energy=state.energy.slice(), increment=joules/(indices.length*area);
      for(const i of indices)energy[i]+=increment;
      return {...state,energy,appliedEnergy:state.appliedEnergy+joules};
    }
    function transport(state){
      const energy=state.energy.slice(), out=new Float64Array(size), shares=new Float64Array(size),
        sources=new Uint32Array(2*size), targets=new Uint32Array(2*size), amounts=new Float64Array(2*size);
      let elapsed=0,n=0,lost, sourceEnergy=state.sourceEnergy, exportedEnergy=state.exportedEnergy;
      const specific=(i,depth)=>liquidEnergy(decode(energy[i],depth+state.ice[i],i).temperature);
      return {
        begin(dt){elapsed=dt;n=0;out.fill(0);lost?.fill(0);},
        face(left,right,rate){
          const source=rate>0?left:right, amount=Math.abs(rate)*elapsed;
          sources[n]=source;targets[n]=rate>0?right:left;amounts[n++]=amount;out[source]+=amount;
        },
        exit(source,rate){
          lost??=new Float64Array(size);
          const amount=rate*elapsed;
          lost[source]+=amount;
          out[source]+=amount;
        },
        advect(depth){
          for(let i=0;i<size;i++)if(out[i])shares[i]=specific(i,depth[i])*depth[i]/Math.max(depth[i],out[i]);
          for(let j=0;j<n;j++){
            const q=amounts[j]*shares[sources[j]];
            energy[sources[j]]-=q;energy[targets[j]]+=q;
          }
          if(lost)for(let i=0;i<size;i++)if(lost[i]){
            const q=lost[i]*shares[i];
            energy[i]-=q;
            exportedEnergy+=q*area;
          }
        },
        rain(i,amount){energy[i]+=amount*incoming;sourceEnergy+=amount*incoming*area;},
        drain(i,amount,available){
          const q=amount*specific(i,available);
          energy[i]-=q;exportedEnergy+=q*area;
        },
        pump(from,to,amount,available){
          const q=amount*specific(from,available);
          energy[from]-=q;energy[to]+=q;
        },
        settle(){},
        capture:()=>({...state,energy,sourceEnergy,exportedEnergy})
      };
    }
    function phase(state,fluid,ctx,wall){
      const {ice,energy,vapor}=state, depth=fluid.depth, dt=ctx.dt, nextIce=ice.slice(), nextVapor=vapor.slice();
      let ambientEnergy=state.ambientEnergy, evaporated=state.evaporated, condensed=state.condensed;
      const total=depth.map((liquid,i)=>liquid+ice[i]);
      const capacity=total.map((water,i)=>sensibleCapacity(i,water));
      for(const [a,b,distance,axis] of links){
        if(wall?.(a,axis))continue;
        if(conductivity){
          const ka=capacity[a],kb=capacity[b], effective=ka*kb/(ka+kb);
          const difference=decode(energy[a],total[a],a).temperature-decode(energy[b],total[b],b).temperature;
          const q=difference*effective*-Math.expm1(-conductivity*dt/(distance*effective));
          energy[a]-=q;energy[b]+=q;
        }
        if(vaporDiffusivity){
          const q=(nextVapor[a]-nextVapor[b])*.5*-Math.expm1(-2*vaporDiffusivity*dt/distance);
          nextVapor[a]-=q;nextVapor[b]+=q;
        }
      }
      for(let i=0;i<size;i++){
        const {position,ambient,dry}=cells[i];
        const measured=ambientField&&ctx.query.probe(ambientField,[position[0],fluid.bed[i],position[1]]);
        const outside=measured?.status==='ok'&&temperature(measured.value)?measured.value:
          clamp(ctx.input.ambient,-273.15,1e4);
        let equilibrium=decode(energy[i],total[i],i);
        const heat=(outside-equilibrium.temperature)*capacity[i]*-Math.expm1(-ambient*dt/capacity[i]);
        energy[i]+=heat;ambientEnergy+=heat*area;
        equilibrium=decode(energy[i],total[i],i);
        const excess=nextVapor[i]-vaporCapacity(equilibrium.temperature);
        const condenses=excess>0, direction=condenses?1:-1;
        const rate=condenses?condensation:dry;
        let amount=Math.min(Math.abs(excess)*-Math.expm1(-rate*dt),
          condenses?Math.max(0,maxDepth-total[i]):equilibrium.liquid);
        if(amount>0){
          const gap=n=>{
            const signed=n*direction, temperature=decode(energy[i]+signed*vaporLatent,total[i]+signed,i).temperature;
            return direction*(nextVapor[i]-signed-vaporCapacity(temperature));
          };
          if(gap(amount)<0){
            let low=0, high=amount;
            for(let k=0;k<18;k++){
              const mid=(low+high)*.5;
              if(gap(mid)<0)high=mid;else low=mid;
            }
            amount=low;
          }
          const signed=amount*direction;
          total[i]+=signed;nextVapor[i]-=signed;energy[i]+=signed*vaporLatent;
          if(condenses)condensed+=amount*area;else evaporated+=amount*area;
        }
        const next=Math.min(maxDepth,decode(energy[i],total[i],i).liquid);
        const retain=depth[i]>0?Math.min(1,next/depth[i]):0;
        fluid.mx[i]*=retain;fluid.mz[i]*=retain;
        depth[i]=next;
        nextIce[i]=Math.max(0,total[i]-next);
      }
      return {...state,ice:nextIce,vapor:nextVapor,ambientEnergy,evaporated,condensed};
    }
    function checkFields(query){
      if(ambientField){
        const desc=query.field(ambientField);
        check(desc?.type==='number'&&desc.units==='degC','Thermal air forcing needs a numeric degC field');
      }
    }
    return {boot,sample,energyReport,validate,exchange,heat,transport,phase,checkFields,ambientField,ambientTemperature};
  }

  W.thermalWater=Object.freeze({create});
})(KIT);
