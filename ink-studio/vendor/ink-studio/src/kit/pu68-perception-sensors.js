/* Snapshot-local sight, hearing and proximity probes. */
(function(K){
  const W=K.world, Q=W.query, {V,M}=K, {check,record,id,vector,endpoint}=W.data;
  const east=[1,0,0], zero=[0,0,0], eps=1e-7;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const point=at=>vector(at)&&at.every(n=>bounded(n,-1e6,1e6));
  const facing=at=>vector(at)&&Math.hypot(...at)>eps&&Number.isFinite(Math.hypot(...at));
  const decibels=n=>bounded(n,-200,250);
  const range=n=>bounded(n,.001,10000);
  const bands=['low','mid','high'];

  function profile(raw){
    check(keys(raw,['sight','hearing','proximity','eyeHeight'])&&
      [raw.sight,raw.hearing,raw.proximity].some(value=>value!==undefined)&&
      (raw.eyeHeight===undefined||bounded(raw.eyeHeight,-16,16)),'Invalid perception profile');
    const {sight,hearing,proximity,eyeHeight=0}=raw;
    if(sight!==undefined){
      check(keys(sight,['range','fov','rays'])&&range(sight.range)&&
        (sight.fov===undefined||bounded(sight.fov,1,360))&&
        (sight.rays===undefined||Array.isArray(sight.rays)&&sight.rays.length<=8&&
          new Set(sight.rays).size===sight.rays.length),'Invalid sight profile');
      for(const name of sight.rays??[])endpoint(name);
    }
    if(hearing!==undefined){
      check(keys(hearing,['range','field','thresholdDb'])&&range(hearing.range)&&
        (hearing.thresholdDb===undefined||decibels(hearing.thresholdDb)),'Invalid hearing profile');
      if(hearing.field!==undefined)endpoint(hearing.field);
    }
    if(proximity!==undefined)
      check(keys(proximity,['range'])&&range(proximity.range),'Invalid proximity profile');
    return {eyeHeight,
      ...(sight&&{sight:{...sight,rays:sight.rays??[],angle:Math.cos((sight.fov??360)*Math.PI/360)}}),
      ...(hearing&&{hearing:{...hearing,thresholdDb:hearing.thresholdDb??30}}),...(proximity&&{proximity})};
  }
  function checkFields(profiles,query){
    if(!profiles.some(item=>item.hearing?.field||item.sight?.rays.length))return;
    const traces=new Map(query.inspect().traces.map(row=>[row.name,row]));
    for(const {sight,hearing} of profiles){
      for(const name of sight?.rays??[])check(traces.get(name)?.role==='occlusion-ray','Unknown occlusion ray '+name);
      if(hearing?.field)check(query.field(hearing.field)?.role==='acoustic-hearing','Unknown acoustic hearing field '+hearing.field);
    }
  }
  function anchor(query,at){
    if(at.agent){
      const {system,id:agent,generation}=at.agent;
      const read=query.probe(system+'/agent',undefined,{agent,generation});
      if(read.status!=='ok'||read.value.mode==='dormant')return null;
      const row=read.value, position=at.socket?query.frame({entity:row.entity,socket:at.socket})?.point:row.position;
      return point(position)?{position,forward:row.direction,exclude:[row.id,row.entity]}:null;
    }
    const resolved=Array.isArray(at)?{point:at}:query.frame(at);
    return point(resolved?.point)?{position:resolved.point,
      ...(resolved.rotation&&{forward:M.app(resolved.rotation,east)}),exclude:at.entity?[at.entity]:[]}:null;
  }
  function listener(source,spec,heading){
    const {position}=source;
    return {...source,eye:[position[0],position[1]+spec.eyeHeight,position[2]],
      facing:V.norm(heading??source.forward??east,east)};
  }
  function seen(query,observer,target,spec){
    const aim=target.aim??target.position, delta=V.sub(aim,observer.eye), distance=V.len(delta);
    const result=(status,blocker)=>({status,visible:status==='visible',distance,...(blocker&&{blocker})});
    if(distance>spec.range)return result('out-of-range');
    if(distance<=eps)return result('visible');
    const direction=V.mul(delta,1/distance);
    if(V.dot(direction,observer.facing)<spec.angle-eps)return result('outside-view');
    let blocker, unavailable=false;
    const exclude=[...new Set([...observer.exclude,...target.exclude])];
    for(const trace of spec.rays){
      const sample=query.trace(trace,observer.eye,{direction,distance:Math.max(0,distance-eps),exclude});
      if(sample.status==='ok'&&sample.value.distance<distance-eps){
        const hit=sample.value;
        if(!blocker||hit.distance<blocker.distance)
          blocker={trace,id:hit.id,position:hit.point,distance:hit.distance};
      }else if(!['empty','ok'].includes(sample.status))unavailable=true;
    }
    return blocker?result('occluded',blocker):result(unavailable?'unavailable':'visible');
  }
  function nearby(observer,target,spec){
    const distance=V.dist(observer.position,target.position), near=distance<=spec.range;
    return {status:near?'near':'out-of-range',near,distance};
  }
  function heard(query,observer,sound,spec){
    const delta=V.sub(sound.position,observer.eye), distance=V.len(delta);
    if(distance>spec.range)return {status:'out-of-range',audible:false,distance};
    if(spec.field){
      const sample=query.probe(spec.field,observer.eye,{from:sound.position,band:sound.band,
        sourceLevelDb:sound.levelDb,thresholdDb:spec.thresholdDb});
      if(sample.status!=='ok')return {status:sample.status,audible:false,distance};
      const {audible,status,levelDb,direction,apparentSource,fromRoom,toRoom}=sample.value;
      return {status,audible,distance,levelDb,direction:direction??zero,
        ...(apparentSource&&fromRoom!==toRoom&&{apparentSource})};
    }
    const levelDb=sound.levelDb-20*Math.log10(Math.max(1,distance)), audible=levelDb>=spec.thresholdDb;
    return {status:audible?'audible':'attenuated',audible,distance,levelDb,
      direction:distance<=eps?zero:V.mul(delta,1/distance)};
  }
  function test(query,spec,observer,target,sound){
    return {
      ...(spec.sight&&{sight:seen(query,observer,target,spec.sight)}),
      ...(spec.proximity&&{proximity:nearby(observer,target,spec.proximity)}),
      ...(spec.hearing&&{hearing:sound?heard(query,observer,sound,spec.hearing):{status:'silent',audible:false}})
    };
  }
  function validSound(sound){
    return keys(sound,['levelDb','band'])&&decibels(sound.levelDb)&&(sound.band===undefined||bands.includes(sound.band));
  }

  W.perceptionSensors=Object.freeze({profile,checkFields,anchor,listener,seen,nearby,heard,test,
    point,facing,decibels,validSound,bands});
})(KIT);
