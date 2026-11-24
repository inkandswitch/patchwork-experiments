/* Shared playback state and image math for comparison views. */
(function (K) {
  const { clone, freeze } = K.procedural.data;
  const modes = ['side-by-side','swipe','difference'];
  const channels = ['luminance','red','green','blue'];
  const weights = [.2126,.7152,.0722];
  const clamp = (n,min=0,max=1) => Math.min(max,Math.max(min,n));
  const record = o => o && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
  const finite = Number.isFinite;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const check = (ok,message) => { if (!ok) throw new TypeError('Comparison views: ' + message); };
  const decode = ColorSpace.prepare('srgb','srgb-linear');
  const linear = Float64Array.from({length:256},(_,i)=>decode([i/255,0,0])[0]);

  function color(value) {
    check(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),'difference colors need six-digit RGB hex');
    return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
  }

  function settings({ mode='side-by-side',divider=.5,axis='x',difference={} }={}) {
    check(modes.includes(mode) && unit(divider) && (axis === 'x' || axis === 'y'),'invalid mode, divider or swipe axis');
    check(record(difference) && Object.keys(difference).every(k =>
      ['channel','gain','deadband','opacity','context','negative','positive'].includes(k)),'invalid difference options');
    const { channel='luminance',gain=3,deadband=.008,opacity=1,context=.42,
      negative='#63bcfa',positive='#ffae61' } = difference;
    check(channels.includes(channel) && finite(gain) && gain>0 && gain<=1000 &&
      [deadband,opacity,context].every(unit),'invalid difference channel, gain, deadband, opacity or context');
    color(negative);
    color(positive);
    const paint = { channel,gain,deadband,opacity,context,negative,positive };
    return { mode,divider,axis,difference:paint };
  }

  function create({ range=[0,1],time,camera=null,cameraSource='left',rate=1,loop=false,playing=false,...view } = {}) {
    check(Array.isArray(range) && range.length === 2 && Array.from(range).every(finite) && range[0]>=0 &&
      range[1]>range[0],'playback range needs a start and later end in seconds');
    const [start,end] = range;
    range = freeze(range.slice());
    const listeners=new Set(), pending=[];
    let state, publishing=false;
    function normalize(next) {
      check(finite(next.time) && finite(next.rate) && next.rate>0 && typeof next.loop==='boolean' &&
        typeof next.playing==='boolean' && (next.cameraSource==='left'||next.cameraSource==='right') &&
        (next.camera===null||record(next.camera)),'invalid time, playback or camera settings');
      return { ...settings(next),time:clamp(next.time,start,end),rate:next.rate,loop:next.loop,
        playing:next.playing && (next.loop||next.time<end),cameraSource:next.cameraSource,
        camera:next.camera===state?.camera ? next.camera : freeze(clone(next.camera)) };
    }
    state=freeze({...normalize({time:time??start,camera,cameraSource,rate,loop,playing,...view}),range,revision:0});
    const allowed=['mode','divider','axis','difference','time','rate','loop','playing','camera','cameraSource'];
    function publish(snapshot) {
      pending.push(snapshot);
      if(publishing)return;
      publishing=true;
      let failure;
      try {
        while(pending.length) {
          const update=pending.shift();
          for(const listener of [...listeners]) {
            try { listener(update); } catch(error) { failure ??= error; }
          }
        }
      } finally { publishing=false; }
      if(failure)throw failure;
    }
    function update(change) {
      check(record(change)&&Object.keys(change).every(key=>allowed.includes(key)),'invalid comparison update');
      const difference=record(change.difference) ? {...state.difference,...change.difference} :
        Object.hasOwn(change,'difference') ? change.difference : state.difference;
      const values=normalize({...state,...change,difference});
      if(allowed.every(key=>K.world.data.equal(values[key],state[key])))return state;
      if(K.world.data.equal(values.camera,state.camera))values.camera=state.camera;
      const next=state=freeze({...values,range,revision:state.revision+1});
      publish(next);
      return next;
    }
    return Object.freeze({
      snapshot:()=>state,update,seek:time=>update({time}),pause:()=>update({playing:false}),
      play:()=>update({playing:true,...(state.time===end&&{time:start})}),
      advance(seconds) {
        check(finite(seconds)&&seconds>=0,'elapsed time must be finite and nonnegative');
        if(!state.playing||!seconds)return state;
        const elapsed=seconds*state.rate;
        check(finite(elapsed),'elapsed time exceeds supported range');
        const time=state.time+elapsed;
        const length=end-start;
        return update({time:state.loop&&time>=end ? start+((state.time-start)%length+elapsed%length)%length : Math.min(time,end)});
      },
      subscribe(listener,{immediate=true}={}) {
        check(typeof listener==='function','expected a listener');
        listeners.add(listener);
        try { if(immediate)listener(state); } catch(error) { listeners.delete(listener);throw error; }
        return ()=>listeners.delete(listener);
      }
    });
  }

  function dimensions(width,height,mode) {
    check(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&
      (mode!=='side-by-side'||width>=2),'invalid comparison dimensions');
    if(mode!=='side-by-side')return {width,height,gutter:0};
    const half=Math.floor(width/2);
    return {width:half,height,gutter:width-2*half};
  }

  const bytes = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  function image(frame) {
    const { w,h,rgb,rgba,alpha }=frame??{}, count=w*h;
    check(Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&count<=33554432&&
      (rgba!==undefined ? bytes(rgba)&&rgba.length===count*4 :
        bytes(rgb)&&rgb.length===count*3&&(alpha===undefined||bytes(alpha)&&alpha.length===count)),
      'expected a bounded RGB or RGBA frame');
    return {w,h,pixels:rgba??rgb,stride:rgba ? 4 : 3,alpha};
  }

  function pair(left,right) {
    const a=image(left), b=image(right);
    check(a.w===b.w&&a.h===b.h,'comparison frames must have matching dimensions');
    return [a,b];
  }

  const coverage=(frame,p)=>frame.stride===4?frame.pixels[4*p+3]/255:(frame.alpha?.[p]??255)/255;
  function luma(values,rgb,at) {
    return weights[0]*values[rgb[at]]+weights[1]*values[rgb[at+1]]+weights[2]*values[rgb[at+2]];
  }
  const display=Float64Array.from({length:256},(_,i)=>i/255);
  function metric(frame,p,channel,alpha) {
    const at=p*frame.stride, rgb=frame.pixels;
    return alpha*(channel===0 ? luma(linear,rgb,at) : linear[rgb[at+channel-1]]);
  }

  function measure(left,right,{channel='luminance'}={}) {
    const [a,b]=pair(left,right), c=channels.indexOf(channel);
    check(c>=0,'invalid difference channel');
    const values=new Float32Array(a.w*a.h);
    for(let p=0;p<values.length;p++)values[p]=metric(b,p,c,coverage(b,p))-metric(a,p,c,coverage(a,p));
    return {w:a.w,h:a.h,values};
  }

  function compose(left,right,options) {
    const {mode,axis,divider,difference}=settings(options), [a,b]=pair(left,right);
    const {w,h}=a, both=mode==='side-by-side', width=both ? 2*w : w;
    const output=new Uint8Array(width*h*3);
    if(mode==='difference'){
      const { channel,gain,deadband,opacity,context,negative,positive }=difference;
      const c=channels.indexOf(channel), cool=color(negative), warm=color(positive);
      for(let p=0;p<w*h;p++) {
        const aa=coverage(a,p), ab=coverage(b,p);
        const delta=metric(b,p,c,ab)-metric(a,p,c,aa);
        const base=luma(display,a.pixels,p*a.stride)*aa*context;
        const ink=delta<0 ? cool : warm, strength=clamp((Math.abs(delta)-deadband)*gain)*opacity;
        for(let i=0;i<3;i++)output[p*3+i]=Math.round(255*(base+(ink[i]-base)*strength));
      }
    } else {
      for(let y=0;y<h;y++)for(let x=0;x<width;x++){
        const fromLeft=both ? x<w : axis==='x' ? (x+.5)/w<divider : (y+.5)/h<divider;
        const src=fromLeft ? a : b, p=y*w+(both ? x%w : x), at=p*src.stride, alpha=coverage(src,p);
        const dst=(y*width+x)*3;
        for(let c=0;c<3;c++)output[dst+c]=Math.round(src.pixels[at+c]*alpha);
      }
    }
    return {w:width,h,rgb:output};
  }

  K.comparison=Object.freeze({create,settings,dimensions,measure,compose,color});
})(KIT);
