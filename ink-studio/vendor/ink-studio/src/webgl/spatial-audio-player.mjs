/* Play spatial mix frames through caller-owned Web Audio resources. */
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const position=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

export function createSpatialAudioPlayer(context, {
  resolveAsset, destination=context?.destination, panning='HRTF', maxVoices=32, smoothing=.025
}={}) {
  if(typeof context?.createBufferSource!=='function'||!context.listener||!destination||
    typeof resolveAsset!=='function'||!['HRTF','equalpower'].includes(panning)||
    !Number.isSafeInteger(maxVoices)||maxVoices<1||maxVoices>128||!finite(smoothing,0,1))
    throw new TypeError('Spatial audio needs a Web Audio context, asset resolver, and valid mix settings');

  const voices=new Map(), seen=new Set(), assets=new Map(), retiring=new Set();
  let disposed=false, previousTime=-Infinity;
  function remember(id){
    seen.add(id);
    if(seen.size>8192)seen.delete(seen.values().next().value);
  }
  function asset(id){
    if(!assets.has(id)){
      const pending=Promise.resolve().then(()=>resolveAsset(id)).then(buffer=>{
        if(!buffer||!finite(buffer.duration,Number.EPSILON,1e9)||typeof buffer.getChannelData!=='function')
          throw new TypeError('Audio asset resolver must return an AudioBuffer for '+id);
        return buffer;
      }).catch(error=>{if(assets.get(id)===pending)assets.delete(id);throw error;});
      assets.set(id,pending);
      if(assets.size>512)assets.delete(assets.keys().next().value);
    }
    return assets.get(id);
  }
  function parameter(param,value,time,immediate=false){
    param.cancelScheduledValues(time);
    if(smoothing&&!immediate)param.setTargetAtTime(value,time,smoothing);
    else param.setValueAtTime(value,time);
  }
  function coordinates(node,name,value,time,immediate){
    value.forEach((n,i)=>parameter(node[name+'XYZ'[i]],n,time,immediate));
  }
  function listen(listener,immediate){
    if(!listener)return;
    const native=context.listener, at=context.currentTime;
    if(native.positionX){
      coordinates(native,'position',listener.position,at,immediate);
      coordinates(native,'forward',listener.forward,at,immediate);
      coordinates(native,'up',listener.up,at,immediate);
    }else{
      native.setPosition(...listener.position);
      native.setOrientation(...listener.forward,...listener.up);
    }
  }
  function tune(row,immediate){
    if(!row.source)return;
    const {voice,gain,low,high,filter,panner}=row, at=context.currentTime;
    parameter(gain.gain,voice.gain,at,immediate);
    const relative=band=>clamp(20*Math.log10(Math.max(1e-8,voice.bands[band]/voice.gain)),-60,40);
    parameter(low.gain,relative('low'),at,immediate);
    parameter(high.gain,relative('high'),at,immediate);
    parameter(filter.frequency,Math.min(voice.cutoff,context.sampleRate*.49),at,immediate);
    if(panner){
      const point=voice.apparentSource??voice.position;
      if(panner.positionX)coordinates(panner,'position',point,at,immediate);
      else panner.setPosition(...point);
    }
  }
  function disconnect(row){
    for(const node of row.nodes??[])node.disconnect();
  }
  function stop(row,fade=false){
    if(voices.get(row.voice.id)===row)voices.delete(row.voice.id);
    if(!row.source)return;
    const now=context.currentTime, tail=fade&&context.state==='running'&&row.started<=now?smoothing*3:0;
    if(tail){
      if(retiring.size>=maxVoices)stop(retiring.values().next().value);
      parameter(row.gain.gain,0,now);
      retiring.add(row);
    }
    else retiring.delete(row);
    row.source.stop(now+tail);
    if(!tail)disconnect(row);
  }
  function reset(){
    for(const row of voices.values())stop(row);
    for(const row of retiring)stop(row);
    seen.clear();
    previousTime=-Infinity;
  }
  function start(voice){
    const row={voice,when:context.currentTime+voice.delay};
    voices.set(voice.id,row);
    row.pending=asset(voice.asset).then(buffer=>{
      if(disposed||voices.get(voice.id)!==row)return;
      const live=row.voice, when=Math.max(context.currentTime,row.when), late=when-row.when;
      let offset=live.offset+late*live.rate;
      const remaining=live.duration===undefined?undefined:live.duration-late;
      if(live.mode==='loop')offset%=buffer.duration;
      if(offset>=buffer.duration||remaining!==undefined&&remaining<=0){
        voices.delete(live.id);
        if(live.mode==='clip')remember(live.id);
        return;
      }
      const source=context.createBufferSource(), low=context.createBiquadFilter(), high=context.createBiquadFilter(),
        filter=context.createBiquadFilter(), gain=context.createGain();
      source.buffer=buffer;
      source.loop=live.mode==='loop';
      source.playbackRate.value=live.rate;
      low.type='lowshelf';low.frequency.value=Math.min(250,context.sampleRate*.1);
      high.type='highshelf';high.frequency.value=Math.min(2600,context.sampleRate*.4);
      filter.type='lowpass';filter.Q.value=-3;
      source.connect(low);low.connect(high);high.connect(filter);filter.connect(gain);
      const nodes=[source,low,high,filter,gain];
      let panner;
      if(live.position){
        panner=context.createPanner();
        panner.panningModel=panning;
        panner.rolloffFactor=0;
        gain.connect(panner);panner.connect(destination);nodes.push(panner);
      }else gain.connect(destination);
      Object.assign(row,{source,low,high,filter,gain,panner,nodes,started:when});
      tune(row,true);
      source.onended=()=>{
        retiring.delete(row);
        if(voices.get(live.id)===row){
          voices.delete(live.id);
          if(live.mode==='clip')remember(live.id);
        }
        disconnect(row);
      };
      if(remaining===undefined)source.start(when,offset);
      else source.start(when,offset,remaining*live.rate);
    }).catch(error=>{
      if(voices.get(voice.id)!==row)return;
      voices.delete(voice.id);
      if(voice.mode==='cue')seen.delete(voice.id);
      disconnect(row);
      throw error;
    });
    return row.pending;
  }
  function validate(frame){
    if(!frame||!finite(frame.time,0,1e9)||!Array.isArray(frame.active)||!Array.isArray(frame.cues)||
      frame.active.length+frame.cues.length>4096||
      frame.listener&&![frame.listener.position,frame.listener.forward,frame.listener.up].every(position))
      throw new TypeError('Expected a spatial audio mix frame');
    const ids=new Set();
    for(const [rows,modes] of [[frame.active,['loop','clip']],[frame.cues,['cue']]])for(const row of rows){
      if(typeof row?.id!=='string'||ids.has(row.id)||typeof row.asset!=='string'||!modes.includes(row.mode)||
        !finite(row.gain,0,16384)||!['low','mid','high'].every(band=>finite(row.bands?.[band],0,16384))||
        !finite(row.rate,.001,64)||!finite(row.offset,0,65e9)||!finite(row.cutoff,20,22000)||
        !finite(row.delay,0,1e9)||row.position!==null&&!position(row.position)||
        row.apparentSource!==undefined&&!position(row.apparentSource)||
        (row.mode==='clip'?!finite(row.duration,0,1e9):row.duration!==undefined))
        throw new TypeError('Invalid spatial audio voice');
      ids.add(row.id);
    }
  }
  return Object.freeze({
    update(frame,{seek=false}={}){
      if(disposed)throw new Error('Spatial audio player is disposed');
      validate(frame);
      if(seek||frame.time<previousTime)reset();
      listen(frame.listener,previousTime===-Infinity);
      previousTime=frame.time;
      const desired=new Map();
      for(const row of voices.values())if(row.voice.mode==='cue')desired.set(row.voice.id,row.voice);
      for(const voice of frame.active)if(voice.gain>0&&!seen.has(voice.id))desired.set(voice.id,voice);
      for(const voice of frame.cues)if(!seen.has(voice.id)){
        remember(voice.id);
        if(voice.gain>0)desired.set(voice.id,voice);
      }
      const selected=new Map([...desired].sort(([,a],[,b])=>b.gain-a.gain).slice(0,maxVoices));
      for(const row of voices.values())if(!selected.has(row.voice.id))stop(row,true);
      const pending=[];
      for(const [id,voice] of selected){
        let row=voices.get(id);
        if(row&&(row.voice.asset!==voice.asset||row.voice.rate!==voice.rate||Boolean(row.voice.position)!==Boolean(voice.position))){
          stop(row);
          row=undefined;
        }
        if(row){
          if(!row.source){
            if(voice.mode!=='cue')row.when=context.currentTime+voice.delay;
            pending.push(row.pending);
          }
          row.voice=voice;
          tune(row,false);
        }else pending.push(start(voice));
      }
      return Promise.all(pending).then(()=>undefined);
    },
    reset,
    dispose(){if(!disposed){disposed=true;reset();assets.clear();}}
  });
}
