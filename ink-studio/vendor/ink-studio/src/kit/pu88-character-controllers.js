/* Named locomotion profiles for the shared character capsule solver. */
(function(K){
  const W=K.world, {check,record,id,own,vector}=W.data, {V}=K;
  const {freeze}=K.procedural.data;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const magnitude=(n,limit)=>Number.isFinite(n)&&n>=0&&n<=limit;
  const horizontal=v=>[v[0],0,v[2]];

  function compile(definitions,tuning){
    const defaults={
      walk:{speed:tuning.walkSpeed,acceleration:tuning.groundAcceleration,airAcceleration:tuning.airAcceleration,jumpSpeed:tuning.jumpSpeed},
      swim:{speed:tuning.swimSpeed,verticalSpeed:tuning.swimVerticalSpeed,acceleration:tuning.swimAcceleration,
        currentScale:tuning.currentScale,buoyancy:tuning.buoyancy},
      climb:{speed:1.3,verticalSpeed:2.3,acceleration:20},
      fly:{speed:5,verticalSpeed:3,acceleration:16},
      vehicle:{speed:9,reverseSpeed:3,acceleration:7,braking:12,turnRate:2.4}
    };
    check(record(definitions)&&Object.keys(definitions).length<=64,'Invalid character controller profiles');
    return new Map(Object.entries(definitions).map(([name,spec])=>{
      check(id(name)&&name!=='auto'&&record(spec)&&own(defaults,spec.kind),'Invalid character controller '+name);
      const {kind,...settings}=spec, fallback=defaults[kind];
      check(Object.entries(settings).every(([key,value])=>own(fallback,key)&&
        (key==='buoyancy'?Number.isFinite(value)&&Math.abs(value)<=128:
          magnitude(value,key==='turnRate'?32:128))),'Invalid movement profile settings for '+name);
      return [name,freeze({kind,...fallback,...settings})];
    }));
  }

  function climbSite(world,point){
    const value=world.climbAt?.(point);
    if(value==null||value===false)return null;
    if(value===true)return {};
    check(record(value)&&vector(value.normal)&&V.len(value.normal)>1e-8,'A climb surface needs a finite, nonzero normal');
    return {normal:V.norm(value.normal)};
  }

  function freeVelocity(profile,site,input){
    let move=input.move;
    if(site?.normal){
      const axis=horizontal(site.normal);
      if(V.len(axis)>1e-8)move=W.gravity.tangent(move,V.norm(axis));
    }
    return [move[0]*profile.speed,(input.jump?1:input.vertical)*profile.verticalSpeed,move[2]*profile.speed];
  }

  function drive(actor,input,driver,traction,dt){
    const throttle=input.throttle??-input.move[2], steer=input.steer??input.move[0];
    const forward=V.norm(horizontal(actor.forward),[0,0,-1]);
    const speed=V.dot(actor.velocity,forward), target=throttle*(throttle<0?driver.reverseSpeed:driver.speed);
    const braking=throttle===0||speed*target<0||Math.abs(target)<Math.abs(speed);
    const limit=(braking?driver.braking:driver.acceleration)*traction*dt;
    const next=speed+clamp(target-speed,-limit,limit);
    const yaw=steer*driver.turnRate*dt*clamp(next/Math.max(.01,driver.speed*.3),-1,1);
    const cos=Math.cos(yaw),sin=Math.sin(yaw);
    const facing=[forward[0]*cos-forward[2]*sin,0,forward[0]*sin+forward[2]*cos];
    return {forward:facing,velocity:V.mul(facing,next)};
  }

  W.movementControllers=Object.freeze({compile,climbSite,freeVelocity,drive});
})(KIT);
