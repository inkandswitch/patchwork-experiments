/* Adapt the existing ground-fire solver to shared material channels. */
(function(K){
  K.ecology.processes.fire=({id='fire',seed=71}={})=>{
    if(!Number.isSafeInteger(seed))throw new RangeError('Fire needs an integer seed');
    return {id,version:1,channels:{fuel:{},heat:{},char:{},moisture:{},burning:{}},create(domain){
      let rng=(seed>>>0)||1,context=null;
      const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)/4294967296;};
      const eco=K.play.eco({width:domain.width,height:domain.height,origin:domain.origin,cellSize:domain.cellSize,random});
      const lastHeat=new Float32Array(domain.count),lastFuel=new Float32Array(domain.count),capacity=new Float32Array(domain.count);
      const read=(key,x,z)=>{const i=domain.cell([x,0,z]);return i<0?0:context?context.read(key,i):domain.read(key,i);};
      const realm={bed:(x,z)=>{const i=domain.cell([x,0,z]);return i<0?0:domain.point(i)[1];},
        fuel:(x,z)=>{const i=domain.cell([x,0,z]);return i<0?0:capacity[i];},
        available:(x,z)=>read('fuel',x,z),moisture:(x,z)=>read('moisture',x,z)};
      function climate(ctx){
        const env={winter:ctx.environment.winter??0,rain:ctx.environment.rain??0,wx:ctx.environment.wx??0,wz:ctx.environment.wz??0};
        if(!Object.values(env).every(Number.isFinite))throw new RangeError('Fire climate values must be finite numbers');
        env.winter=K.clamp(env.winter,0,1);env.rain=K.clamp(env.rain,0,1);env.wx=K.clamp(env.wx,-1,1);env.wz=K.clamp(env.wz,-1,1);return env;
      }
      function reset(){context=null;rng=(seed>>>0)||1;eco.reset(realm);lastHeat.fill(0);for(let i=0;i<domain.count;i++)capacity[i]=lastFuel[i]=domain.initial('fuel',i);}
      reset();
      return {reset,
        contact(ctx,event){
          context=ctx;
          try{
            for(const i of ctx.cellsInDisc(event.p,event.radius)){
              const fuel=ctx.read('fuel',i);
              if(fuel>lastFuel[i]+1e-6){capacity[i]=Math.max(capacity[i],fuel);eco.setCell(i,{burn:0,fuel:capacity[i]});}
              if(event.values?.heat!==undefined)eco.setCell(i,{heat:event.values.heat});
            }
            if(event.type==='ignite')eco.ignite(event.p[0],event.p[2],event.radius,climate(ctx).rain);
          }
          finally{context=null;}
        },
        step(ctx,h){
          context=ctx;
          try{
            // The legacy fraction tracks a burn cycle; shared fuel and char own
            // consumption and persistent damage across material/renderer types.
            const before=new Float32Array(domain.count);
            for(let i=0;i<domain.count;i++){
              const heat=ctx.read('heat',i),fuel=ctx.read('fuel',i);
              if(fuel>lastFuel[i]+1e-6){capacity[i]=Math.max(capacity[i],fuel);eco.setCell(i,{burn:0,fuel:capacity[i]});}
              if(Math.abs(heat-lastHeat[i])>1e-6)eco.setCell(i,{heat});
              before[i]=eco.sampleCell(i).burn;
            }
            eco.update(h,climate(ctx));
            for(let i=0;i<domain.count;i++){
              const state=eco.sampleCell(i),oldFuel=ctx.read('fuel',i);
              const used=Math.min(oldFuel,Math.max(0,state.burn-before[i])),fuel=oldFuel-used;
              ctx.set('fuel',i,fuel);ctx.add('char',i,used/Math.max(.001,capacity[i]));
              ctx.set('heat',i,Math.min(1,state.heat));ctx.set('burning',i,state.burning&&fuel>0?1:0);
              if(oldFuel>0&&fuel<=0)ctx.emit('fuel-exhausted',{cell:i,p:ctx.point(i)});
              lastHeat[i]=Math.min(1,state.heat);lastFuel[i]=fuel;
            }
          }finally{context=null;}
        },
        save(){return {rng,solver:eco.capture(),lastHeat:lastHeat.slice(),lastFuel:lastFuel.slice(),capacity:capacity.slice()};},
        restore(state){
          if(!state||!Number.isSafeInteger(state.rng)||state.rng<-2147483648||state.rng>4294967295||state.lastHeat?.length!==domain.count||state.lastFuel?.length!==domain.count||state.capacity?.length!==domain.count||
            !Array.from(state.capacity).every(v=>Number.isFinite(v)&&v>=0&&v<=1)||
            !Array.from(state.lastHeat).every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Array.from(state.lastFuel).every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new RangeError('Invalid ecology fire state');
          eco.restore(state.solver);rng=state.rng;lastHeat.set(state.lastHeat);lastFuel.set(state.lastFuel);capacity.set(state.capacity);context=null;
        }
      };
    }};
  };
})(KIT);
