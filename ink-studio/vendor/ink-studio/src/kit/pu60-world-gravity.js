/* Spatial reference frames for finite worlds, habitat rings and authored fields. */
(function(K){
  const W=K.world, {V,M}=K, Q=W.query, {check,record,vector}=W.data, {bounds,zone,clamp}=W.fields;
  const up=[0,1,0], zero=[0,0,0], forward=[0,0,-1], eps=1e-8;
  const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const xyz=value=>vector(value)&&value.every(n=>range(n,-1e6,1e6));
  const direction=value=>xyz(value)&&V.len(value)>eps;
  const tangent=(v,axis)=>V.mad(v,axis,-V.dot(v,axis));
  function turn(from,to,fraction=1){
    const cross=V.cross(from,to), dot=clamp(V.dot(from,to),-1,1), length=V.len(cross);
    return length>eps?M.rot(V.mul(cross,1/length),Math.atan2(length,dot)*fraction):
      dot<0?M.rot(V.perp(from),Math.PI*fraction):M.id();
  }
  function basis(axis,heading=forward){
    const projected=tangent(heading,axis), f=V.norm(projected,V.perp(axis));
    const back=V.mul(f,-1), right=V.norm(V.cross(axis,back));
    return [right[0],axis[0],back[0],right[1],axis[1],back[1],right[2],axis[2],back[2]];
  }
  function normalize(raw,fallback=[0,-9.81,0]){
    const acceleration=raw?.acceleration??fallback, angularVelocity=raw?.angularVelocity??zero, buoyancy=raw?.buoyancy??1;
    check(vector(acceleration)&&vector(angularVelocity)&&range(buoyancy,0,1000)&&
      (raw?.up===undefined||direction(raw.up)),'Invalid local gravity frame');
    const axis=raw?.up?V.norm(raw.up):V.norm(V.mul(acceleration,-1),up);
    return {acceleration,up:axis,angularVelocity,buoyancy};
  }
  function sample(query,name,point,fallback){
    const got=name&&query?.probe(name,point);
    if(got?.status!=='ok')return normalize(null,fallback);
    return normalize(Array.isArray(got.value)?{acceleration:got.value}:got.value,fallback);
  }
  const inertial=(frame,velocity)=>V.mad(frame.acceleration,V.cross(frame.angularVelocity,velocity),-2);
  function advance(frame,velocity,seconds,force=zero){
    const acceleration=V.add(frame.acceleration,force), angular=V.len(frame.angularVelocity);
    if(angular<eps)return V.mad(velocity,acceleration,seconds);
    const half=V.mad(velocity,acceleration,seconds*.5);
    const rotated=M.app(M.rot(V.mul(frame.angularVelocity,1/angular),-2*angular*seconds),half);
    return V.mad(rotated,acceleration,seconds*.5);
  }

  function ray(clearance,origin,axis,distance){
    const skin=2e-5, stride=skin*.5;
    let t=0;
    for(let i=0;i<160&&t<=distance+skin;i++){
      const point=V.mad(origin,axis,Math.min(distance,t)), d=clearance(point);
      if(!Number.isFinite(d))return null;
      if(d<=skin){
        if(d<-.003)return null;
        const normal=V.norm([0,1,2].map(k=>{
          const left=point.slice(),right=point.slice();
          left[k]-=skin;right[k]+=skin;
          return clearance(right)-clearance(left);
        }),V.mul(axis,-1));
        if(V.dot(normal,axis)>=-eps)return null;
        return {point:V.mad(point,normal,-d),normal};
      }
      t+=Math.max(stride,d*.82);
    }
    return null;
  }

  function compile(raw){
    check(record(raw)&&['uniform','radial','rotation'].includes(raw.kind??'uniform'),'Invalid gravity frame');
    const {kind='uniform',buoyancy=1,up:override}=raw;
    check(range(buoyancy,0,1000)&&(override===undefined||direction(override)),'Invalid gravity buoyancy or up');
    const fallback=override?V.norm(override):up;
    if(kind==='uniform'){
      const frame=normalize({...raw,buoyancy});
      return ()=>frame;
    }
    const {center=zero}=raw;
    check(xyz(center),'Gravity center needs bounded XYZ coordinates');
    if(kind==='radial'){
      const {strength=9.81,referenceRadius=1,falloff='constant',outward=false}=raw;
      check(range(strength,0,10000)&&range(referenceRadius,.001,1e4)&&
        ['constant','inverse-square'].includes(falloff)&&typeof outward==='boolean','Invalid radial gravity');
      return point=>{
        const offset=V.sub(point,center), distance=V.len(offset), down=V.mul(V.norm(offset,zero),outward?1:-1);
        const factor=falloff==='constant'?1:(referenceRadius/Math.max(referenceRadius,distance))**2;
        return {acceleration:V.mul(down,strength*factor),up:override?fallback:V.norm(V.mul(down,-1),fallback),
          angularVelocity:zero,buoyancy};
      };
    }
    const {axis=forward,omega=1,coriolis=true}=raw;
    check(direction(axis)&&range(omega,-30,30)&&typeof coriolis==='boolean','Invalid rotating reference frame');
    const spin=V.norm(axis), velocity=coriolis?V.mul(spin,omega):zero;
    return point=>{
      const offset=tangent(V.sub(point,center),spin), acceleration=V.mul(offset,omega*omega);
      return {acceleration,up:override?fallback:V.norm(V.mul(offset,-1),fallback),angularVelocity:velocity,buoyancy};
    };
  }

  function gravity(config,{id:system}){
    const fallback=compile(config.frame??{kind:'uniform'});
    const rules=config.regions??[];
    check(Array.isArray(rules)&&rules.length<=128,'Gravity regions need a bounded list');
    const regions=rules.map(rule=>{
      check(record(rule),'Invalid gravity region');
      return {bounds:bounds(rule.bounds),read:compile(rule.frame)};
    });
    const {accelerationField,upField,buoyancyField}=config;
    const references=[accelerationField,upField,buoyancyField];
    check(references.every(name=>name===undefined||typeof name==='string'),'Invalid gravity field binding');
    function at(query,point){
      const zoneMatch=regions.findLast(region=>zone(point,region.bounds));
      const frame=(zoneMatch?.read??fallback)(point);
      const value=name=>{
        const sample=name&&query.probe(name,point);
        return sample?.status==='ok'?sample.value:undefined;
      };
      const acceleration=value(accelerationField)??frame.acceleration, override=value(upField);
      const buoyancy=value(buoyancyField)??frame.buoyancy;
      return normalize({...frame,acceleration,up:override??(acceleration===frame.acceleration?frame.up:
        V.norm(V.mul(acceleration,-1),frame.up)),buoyancy});
    }
    function channel(type,units,key){
      return W.spatialFields.define({type,units},({point,query})=>Q.ok(at(query,point)[key]));
    }
    return {initial:()=>null,checkFields(query){
      for(const [name,type,units] of [[accelerationField,'vec3','world/s^2'],[upField,'vec3','1'],[buoyancyField,'number','1']]){
        if(name===undefined)continue;
        const field=query.field(name);
        check(field?.type===type&&field.units===units&&!field.name.startsWith(system+'/'),'Incompatible gravity field '+name);
      }
    },fields:{
      frame:{type:'record',role:'gravity-frame',read:({query,target})=>target.point?
        Q.ok(at(query,target.point)):Q.missing('XYZ point required')},
      acceleration:channel('vec3','world/s^2','acceleration'),up:channel('vec3','1','up'),
      buoyancy:channel('number','1','buoyancy'),'angular-velocity':channel('vec3','rad/s','angularVelocity')
    }};
  }
  function checkField(query,name){
    if(name===undefined)return;
    const field=query.field(name);
    check(field&&(field.role==='gravity-frame'||field.type==='vec3'&&field.units==='world/s^2'),
      'Gravity needs a frame or XYZ acceleration field: '+name);
  }
  W.gravity=Object.freeze({sample,normalize,inertial,advance,turn,basis,tangent,ray,checkField});
  W.runtime.register('gravity',gravity);
})(KIT);
