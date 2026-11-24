/* Material contacts drive persistent rut inputs and deterministic transient effects. */
(function (K) {
  const W=K.world, Q=W.query, V=K.V, P=K.procedural;
  const {check,record,id,vector}=W.data;
  const {clamp}=W.fields, up=[0,1,0];
  const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const unit=(value,min,max)=>Number.isSafeInteger(value)&&bounded(value,min,max);
  const token=value=>typeof value==='string'&&value.length>0&&value.length<=256;
  const cue=value=>typeof value==='string'&&/^[a-z][a-z0-9._/-]{0,127}$/.test(value);
  const interaction=value=>['roll','step','impact'].includes(value);
  const coefficient=(value,wetness)=>typeof value==='number'?value:K.mix(value.dry,value.wet,wetness);
  const mix=(seed,salt)=>P.data.hash(salt,seed)/4294967296;
  const direction=(v,fallback)=>v&&V.len(v)>1e-8?V.norm(v):fallback;
  const materialSample=profile=>({wetness:profile.wetness,
    ...(profile.revision!==undefined&&{revision:profile.revision}),
    ...(profile.friction!==undefined&&{friction:profile.friction}),
    ...(profile.temperature!==undefined&&{temperature:profile.temperature})});

  function capture(ctx,row,serial,type,{speed,load,travel,normal,heading,profile}) {
    return {...row,id:[ctx.id,ctx.tick,ctx.substep??1,serial].join('.'),source:ctx.id,tick:ctx.tick,
      interaction:type,speed,load,travel,normal,heading,interval:ctx.dt,
      ...(profile&&{surface:materialSample(profile)})};
  }

  function validContact(row) {
    return record(row)&&vector(row.point)&&bounded(row.speed,0,1e8)&&bounded(row.load??0,0,1e12)&&
      bounded(row.weight??1,0,1e12)&&bounded(row.travel??0,0,1e8)&&bounded(row.interval??1/60,0,10000)&&
      (row.entity===undefined||id(row.entity))&&(row.id===undefined||token(row.id))&&
      (row.source===undefined||id(row.source))&&(row.tick===undefined||unit(row.tick,0,10000000))&&
      (row.support==null||token(row.support))&&(row.material==null||token(row.material))&&
      (row.wheel===undefined||id(row.wheel))&&(row.cue===undefined||cue(row.cue))&&
      (row.surface===undefined||record(row.surface)&&bounded(row.surface.wetness,0,1)&&
        (row.surface.revision===undefined||unit(row.surface.revision,1,Number.MAX_SAFE_INTEGER))&&
        (row.surface.friction===undefined||bounded(row.surface.friction,0,4))&&
        (row.surface.temperature===undefined||bounded(row.surface.temperature,-273.15,1e4)))&&
      (row.normal===undefined||vector(row.normal)&&bounded(V.len(row.normal),1e-8,1e8))&&
      (row.heading===undefined||vector(row.heading)&&bounded(V.len(row.heading),0,1e8))&&
      interaction(row.interaction??'roll');
  }

  function sample(state,time,{point,entity,range,maxParticles,maxKick}) {
    const particles=[], kick=[0,0,0];
    const distance=at=>point?V.dist(at,point):0;
    function factor(row) {
      if (entity!==undefined&&row.entity!==entity) return 0;
      return clamp(1-distance(row.point)/range,0,1);
    }
    // The newest visible bursts have priority when several contacts exceed the rendering budget.
    for (let i=state.bursts.length-1;i>=0&&particles.length<maxParticles;i--) {
      const row=state.bursts[i], age=time-row.start;
      if (age<0||age>=row.life||(entity!==undefined&&row.entity!==entity)) continue;
      const fade=1-age/row.life;
      const side=V.norm(V.cross(row.normal,row.heading),V.perp(row.normal));
      for (let j=0;j<row.count&&particles.length<maxParticles;j++) {
        const seed=(row.seed+Math.imul(j+1,2654435761))>>>0;
        const sideways=(mix(seed,'s')-.5)*1.7;
        const back=.18+.65*mix(seed,'b'), rise=.42+.7*mix(seed,'u');
        const point=row.point.map((n,k)=>n+row.radius*row.normal[k]+
          row.speed*(side[k]*sideways-row.heading[k]*back+row.normal[k]*rise)*age-
          4.905*row.normal[k]*age*age);
        particles.push({id:row.id+'.'+j,contact:row.id,...(row.entity&&{entity:row.entity}),
          point,color:row.color,radius:row.radius*(.7+.5*mix(seed,'r'))*(1+.35*age/row.life),alpha:.88*fade});
      }
    }
    for (const row of state.shakes) {
      const age=time-row.start, falloff=factor(row);
      if (age<0||age>=row.life||!falloff) continue;
      const scale=row.strength*falloff*(1-age/row.life)**2, phase=2*Math.PI*(age*row.frequency+row.phase);
      for(let axis=0;axis<3;axis++) kick[axis]+=Math.sin(phase*(1+.21*axis)+axis*2.4)*scale;
    }
    const length=V.len(kick);
    return {particles,kick:length>maxKick?V.mul(kick,maxKick/length):kick};
  }

  function effects(config,{catalog}) {
    const {minSpeed=.05,speedReference=2,loadReference=10,maxContacts=512,maxBursts=128,maxShakes=64,
      maxParticles=512,maxKick=.12,range=8,soundEvents=true,channels=[],fallback={}}=config;
    check(bounded(minSpeed,0,1e4)&&bounded(speedReference,.001,1e4)&&bounded(loadReference,.001,1e8)&&
      unit(maxContacts,1,2048)&&unit(maxBursts,0,512)&&unit(maxShakes,0,256)&&unit(maxParticles,0,8192)&&
      bounded(maxKick,0,2)&&bounded(range,.01,1e6)&&typeof soundEvents==='boolean'&&
      Array.isArray(channels)&&channels.length<=16&&channels.every(id)&&new Set(channels).size===channels.length&&
      !channels.includes('contacts'),'Invalid contact-effects limits or channels');
    K.authoring.physicalMaterials.checkContactEffects(fallback);
    const inputs={contacts:'event',...Object.fromEntries(channels.map(name=>[name,'event']))};
    const streams=Object.keys(inputs), initial=P.data.freeze({contacts:[],ruts:[],sounds:[],
      bursts:[],shakes:[],cooldowns:[],dropped:0});
    function step(state,ctx) {
      if(state===initial&&streams.every(name=>!ctx.input[name].length))return state;
      const contacts=[], ruts=[], sounds=[];
      const bursts=state.bursts.filter(row=>row.start+row.life>ctx.time);
      const shakes=state.shakes.filter(row=>row.start+row.life>ctx.time);
      const cooldowns=new Map();
      for(const row of state.cooldowns)if(row.until>ctx.time)cooldowns.set(row.key,row);
      let dropped=0, serial=0, seen;
      for(const [stream,rows] of [['scripted-impact',state.pending??[]],...streams.map(name=>[name,ctx.input[name]])]){
        const accepted=Math.min(rows.length,maxContacts-serial);
        dropped+=rows.length-accepted;
        for(let i=0;i<accepted;i++){
          const raw=rows[i];
          check(validContact(raw),'Invalid material contact on '+ctx.id+'/'+stream);
          const type=raw.interaction??'roll', load=raw.load??loadReference, wetness=raw.surface?.wetness??0;
          const contactId=raw.id??[ctx.id,ctx.tick,ctx.substep??1,serial].join('.');
          serial++;
          if(raw.id!==undefined){
            seen??=new Set();
            if(seen.has(contactId))continue;
            seen.add(contactId);
          }
          const material=catalog?.getMaterial(raw.material)?.material;
          const authored=material?.contactEffects??fallback;
          const weight=raw.weight??1, point=raw.point;
          const force=clamp(load/loadReference,0,4), speed=raw.speed;
          const strength=speed>=minSpeed?clamp(speed/speedReference*Math.sqrt(force),0,1):0;
          const reaction={};
          if (strength>0) {
            if (authored.rut!==undefined) {
              const value=coefficient(authored.rut,wetness)*weight*force;
              if(value>0) {
                ruts.push({contact:contactId,point,weight:value,material:raw.material??null,support:raw.support??null});
                reaction.rut=value;
              }
            }
            const seed=P.data.hash(contactId,ctx.world.seed);
            const spray=authored.spray;
            if (spray&&maxBursts&&maxParticles) {
              const rate=coefficient(spray.count,wetness)*strength*(type==='roll'?(raw.interval??ctx.dt)*60:1);
              const count=Math.min(32,Math.floor(rate+mix(seed,'count')));
              if (count) {
                const normal=direction(raw.normal,up);
                const heading=direction(raw.heading&&W.gravity.tangent(raw.heading,normal),V.perp(normal));
                bursts.push({id:contactId,entity:raw.entity??null,start:ctx.time,life:spray.life??.34,point,normal,heading,
                  seed,count,color:spray.color??'#a7b9ad',radius:spray.radius??.035,speed:(spray.speed??2)*(.5+.5*strength)});
                reaction.spray=count;
              }
            }
            const shake=authored.shake;
            if (shake&&maxShakes&&maxKick) {
              const amount=coefficient(shake.strength,wetness)*strength;
              if (amount>0) {
                shakes.push({id:contactId,entity:raw.entity??null,start:ctx.time,life:shake.life??.16,
                  point,strength:amount,frequency:shake.frequency??18,phase:mix(seed,'shake')});
                reaction.shake=amount;
              }
            }
            const soundCue=raw.cue??material?.sounds?.[type], sound=authored.sound;
            const gain=coefficient(sound?.gain??1,wetness)*strength;
            const key=[raw.source??stream,raw.entity??'',raw.wheel??type].join('/');
            if (soundCue&&gain>0&&!cooldowns.has(key)) {
              const row={contact:contactId,cue:soundCue,interaction:type,entity:raw.entity??null,
                material:raw.material??null,at:point,speed,gain,pitch:.88+.24*mix(seed,'pitch')};
              const interval=sound?.interval??(type==='roll'?.15:0);
              if(interval&&cooldowns.size<maxContacts*4)cooldowns.set(key,{key,until:ctx.time+interval});
              sounds.push(row);
              reaction.sound=soundCue;
              if(soundEvents)ctx.emit('material-sound',row);
            }
          }
          contacts.push({...raw,id:contactId,interaction:type,load,strength,appliedTick:ctx.tick,reaction});
        }
      }
      if (!serial&&!dropped&&!state.contacts.length&&!state.ruts.length&&!state.sounds.length&&!state.dropped&&
        bursts.length===state.bursts.length&&shakes.length===state.shakes.length&&cooldowns.size===state.cooldowns.length)
        return state;
      if(!serial&&!dropped&&!bursts.length&&!shakes.length&&!cooldowns.size)return initial;
      if(bursts.length>maxBursts)bursts.splice(0,bursts.length-maxBursts);
      if(shakes.length>maxShakes)shakes.splice(0,shakes.length-maxShakes);
      return P.data.freeze({contacts,ruts,sounds,bursts,shakes,
        cooldowns:[...cooldowns.values()],dropped});
    }
    function impact(contact) {
      const row = { ...contact, interaction: 'impact' };
      check(record(contact) && validContact(row), 'A scripted impact needs a valid material contact');
      return row;
    }
    return {inputs,initial:()=>initial,step,outputs:{ruts:'event'},output:state=>({ruts:state.ruts}),
      checkAction(type, args) { impact(args); },
      actions:{impact(state, args) {
        const pending = state.pending ?? [];
        check(pending.length < maxContacts, 'Scripted impact budget exceeded');
        return { ...state, pending: [...pending, impact(args)] };
      }},
      validateState(state) {
        const list=(key,max,valid)=>Array.isArray(state?.[key])&&state[key].length<=max&&state[key].every(valid);
        const active=row=>record(row)&&token(row.id)&&vector(row.point)&&
          (row.entity===null||id(row.entity))&&bounded(row.start,0,1e7)&&bounded(row.life,.02,3);
        check((state?.pending===undefined || list('pending',maxContacts,row=>validContact(row)&&row.interaction==='impact')) &&
          list('contacts',maxContacts,row=>validContact(row)&&token(row.id)&&unit(row.appliedTick,1,1e7)&&
          bounded(row.strength,0,1)&&record(row.reaction))&&
          list('ruts',maxContacts,row=>record(row)&&token(row.contact)&&vector(row.point)&&bounded(row.weight,0,64e12))&&
          list('sounds',maxContacts,row=>record(row)&&token(row.contact)&&cue(row.cue)&&vector(row.at)&&
            bounded(row.gain,0,4)&&bounded(row.pitch,.88,1.12))&&
          list('bursts',maxBursts,row=>active(row)&&vector(row.normal)&&vector(row.heading)&&
            unit(row.seed,0,4294967295)&&unit(row.count,1,32)&&bounded(row.speed,.005,50)&&
            bounded(row.radius,.001,1)&&typeof row.color==='string'&&/^#[0-9a-f]{6}$/i.test(row.color))&&
          list('shakes',maxShakes,row=>active(row)&&bounded(row.strength,0,1)&&bounded(row.frequency,1,60)&&bounded(row.phase,0,1))&&
          list('cooldowns',maxContacts*4,row=>record(row)&&typeof row.key==='string'&&row.key.length<=300&&bounded(row.until,0,1e7+10))&&
          unit(state?.dropped,0,Number.MAX_SAFE_INTEGER),'Invalid contact-effects checkpoint');
      },
      fields:{
        contacts:{type:'records',read:({state,target})=>Q.ok(target.entity===undefined?state.contacts:
          state.contacts.filter(row=>row.entity===target.entity))},
        sounds:{type:'records',read:({state,target})=>Q.ok(target.entity===undefined?state.sounds:
          state.sounds.filter(row=>row.entity===target.entity))},
        dropped:{type:'number',units:'count',read:({state})=>Q.ok(state.dropped)},
        frame:{type:'record',role:'contact-effects-frame',read:({state,time:now,target,args})=>{
          const time=args.time??now;
          check(bounded(time,0,1e7),'Invalid contact-effects sample time');
          return Q.ok(sample(state,time,{point:target.point,entity:target.entity,range,maxParticles,maxKick}));
        }}
      }
    };
  }
  W.contactEffects=Object.freeze({capture});
  W.runtime.register('contact-effects',effects);
})(KIT);
