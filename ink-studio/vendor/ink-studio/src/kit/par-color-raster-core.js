/* Color transfers for standalone rasters share Ink's palette and color math. */
(function (K) {
  const P = K.procedural, R = P.raster, C = P.materials.perceptual;
  const finite = Number.isFinite, clamp = n => Math.max(0,Math.min(1,n));
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const byte = n => Math.round(clamp(n)*255);
  const valid = P.graphTypes.validator('raster');
  const record = P.graphTypes.validator('record');
  const tuple = (value,n,test=finite) => Array.isArray(value) && value.length===n && Array.from(value).every(test);
  const scalar = (width,height,data) => ({width,height,channels:1,data});
  const read = (data,i,out) => {
    for (let c=0; c<3; c++) out[c]=data[i+c]/255;
    return out;
  };
  const mix = (a,b,t) => a*(1-t)+b*t;

  function context({palette,roles=palette?.roles ?? {}} = {}) {
    const values = palette?.palette ?? palette;
    if ((values !== undefined && !P.graphTypes.validator('palette')(palette)) || !record(roles))
      throw new TypeError('Expected an Ink palette and named roles');
    const packed = values === undefined ? [] : Array.from(values,value=>C.toHex(C.parse(value)));
    return {palette:packed,roles};
  }
  const color = (value,ctx) => C.parse(
    typeof value==='string' && !value.startsWith('#') || Number.isInteger(value) && ctx.palette.length ?
      PixelLook.roleColor(value,ctx.palette,ctx.roles) : value);

  function rgba(source) {
    if (!valid(source) || source.width*source.height > 8e6)
      throw new RangeError('Color operation needs a bounded raster');
    return R.rgba(source);
  }

  function readMask({width,height}, {mask, maskChannel='luma', maskScale=255} = {}) {
    if (mask === undefined) return () => 1;
    if (mask?.width !== width || mask?.height !== height || !finite(maskScale) || maskScale <= 0)
      throw new RangeError('Color mask needs the same dimensions as the raster and a positive scale');
    const {data}=R.channel(mask,{channel:maskChannel});
    return p=>clamp(data[p]/maskScale);
  }

  function transfer(value, operation, mask, protectedPixel = () => false) {
    const {data} = value, rgb = [0,0,0], out = [0,0,0];
    for (let p=0,i=0; i<data.length; p++,i+=4) {
      const gate = mask(p);
      if (!gate || !data[i+3] || protectedPixel(p)) continue;
      const amount = gate*operation(read(data,i,rgb),out,p);
      if (amount) for (let c=0; c<3; c++) data[i+c]=byte(mix(rgb[c],out[c],amount));
    }
    return value;
  }

  function coordinate(source, channel) {
    if (channel==='lightness') return {sample:(_,rgb)=>ColorSpace.toOKLab(rgb)[0],range:[0,1]};
    const {data}=R.channel(source,{channel});
    return {sample:p=>data[p],range:[0,255]};
  }

  function gradientTransfer(source, ramp, options, ctx) {
    const {channel='lightness',time=0,strength=1} = options;
    const input=coordinate(source,channel), limits=options.range ?? input.range;
    if (!tuple(limits,2) || limits[0]>=limits[1] || !finite(limits[1]-limits[0]) || !unit(strength) || !finite(time))
      throw new RangeError('Invalid gradient range, strength or time');
    const resolve = value=>color(value,ctx);
    let sample, weight;
    if (ramp?.sample && typeof ramp.sample==='function') {
      const frame = ramp.frame?.(time) ?? ramp;
      sample = (t,out) => {
        const result = frame.sample(t,out);
        for (let c=0;c<3;c++) out[c]=result[c];
      };
    } else if (ramp?.type) {
      const field = K.palette.ramp(ramp,resolve);
      sample=(field.frame?.(time) ?? field).sample;
    } else if (ramp?.colors !== undefined || ramp?.curves !== undefined || ramp?.transfer !== undefined) {
      const path=K.palette.path(ramp);
      sample=(t,out)=>{
        const rgb=path.sample(t);
        for (let c=0;c<3;c++) out[c]=rgb[c];
      };
    } else {
      let stops = ramp?.stops, interpolation = ramp?.interpolation;
      let swatches = Array.isArray(ramp) ? ramp : undefined;
      if (typeof ramp==='string') swatches=PixelLook.paletteSelector(ctx.palette,ctx.roles)(ramp);
      if (swatches) {
        if (!swatches.length || swatches.length>256) throw new RangeError('Gradient needs one to 256 ramp colors');
        stops=swatches.map((value,i)=>[i/Math.max(1,swatches.length-1),value]);
        if (stops.length===1) stops.push([1,swatches[0]]);
        interpolation=options.interpolation;
      }
      if (ramp?.weights !== undefined) {
        if (!Array.isArray(stops) || !tuple(ramp.weights,stops.length,unit))
          throw new TypeError('Gradient weights need one unit value per stop');
        weight=ColorCurves.scalar({stops:stops.map(([at],i)=>[at,ramp.weights[i]]),interpolation},true);
      }
      sample=ColorCurves.ramp({stops,interpolation},resolve);
    }
    return (rgb,out,p)=>{
      const t=clamp((input.sample(p,rgb)-limits[0])/(limits[1]-limits[0]));
      sample(t,out);
      return strength*(weight?.(t) ?? 1);
    };
  }

  function gradient(source,ramp,options={}) {
    const value=rgba(source);
    return transfer(value,gradientTransfer(source,ramp,options,context(options)),readMask(value,options));
  }

  function stackTransfer(stack,ctx,strength=1) {
    if (!unit(strength)) throw new RangeError('Color stack strength must be in [0, 1]');
    const plan=PixelLook.prepareColorStack(stack,ctx.palette,ctx.roles);
    if (!plan) return () => 0;
    const referenced=plan.requiresIndex ? ctx.palette.map(C.parse) : [], exact=new Map();
    if (referenced.length) ctx.palette.forEach((color,i)=>{ if (!exact.has(color)) exact.set(color,i); });
    return (rgb,out)=>{
      const index = referenced.length ? (exact.get(C.toHex(rgb)) ?? PixelLook.nearest(rgb,referenced,false)) : undefined;
      plan.sample(rgb,out,index);
      return strength;
    };
  }

  function stack(source,definition,options={}) {
    const value=rgba(source);
    return transfer(value,stackTransfer(definition,context(options),options.strength),readMask(value,options));
  }

  function channels(source,{order=['r','g','b','alpha']}={}) {
    const value=rgba(source), {data}=value;
    if (!Array.isArray(order) || ![3,4].includes(order.length)) throw new TypeError('Provide three or four output channel selectors');
    const names=['r','g','b','alpha','luma'];
    const readChannel=(v,i)=>v===4 ? .2126*data[i]+.7152*data[i+1]+.0722*data[i+2] : data[i+v];
    const list=Array.from(order, selector=>{
      if (finite(selector) && selector>=0 && selector<=255) return ()=>Math.round(selector);
      const opts=typeof selector==='string' ? {channel:selector} : selector;
      const {channel,gain=1,bias=0}=opts ?? {}, from=names.indexOf(channel);
      if (from<0 || !finite(gain) || !finite(bias))
        throw new TypeError('A channel selector needs a named input and finite gain or bias');
      return i=>Math.round(Math.max(0,Math.min(255,readChannel(from,i)*gain+bias)));
    });
    const pixel=[0,0,0,0];
    for (let i=0; i<data.length; i+=4) {
      for (let c=0; c<4; c++) pixel[c]=c<list.length ? list[c](i) : data[i+c];
      data.set(pixel,i);
    }
    return value;
  }

  function feather(distance,tolerance,softness) {
    if (distance<=tolerance) return 1;
    if (!softness || distance>=tolerance+softness) return 0;
    const t=(distance-tolerance)/softness;
    return 1-t*t*(3-2*t);
  }

  function selection(from, metric, ctx, tolerance, softness) {
    if (!['rgb','perceptual','chroma'].includes(metric) || !finite(tolerance) || tolerance<0 || !finite(softness) || softness<0)
      throw new TypeError('Color selection needs rgb, perceptual or chroma distance and nonnegative tolerances');
    const rgb=color(from,ctx), target=metric==='rgb' ? rgb : ColorSpace.toOKLab(rgb);
    const start=metric==='chroma' ? 1 : 0;
    return (original,point)=>{
      if (!tolerance && !softness && metric!=='chroma') return Number(C.toHex(original)===C.toHex(rgb));
      const value=metric==='rgb' ? original : point;
      const distance=Math.hypot(start ? 0 : value[0]-target[0],value[1]-target[1],value[2]-target[2]);
      return feather(distance,tolerance,softness);
    };
  }

  function replace(source,rules,options={}) {
    const {metric='perceptual'}=options, ctx=context(options);
    if (!Array.isArray(rules) || rules.length>64) throw new RangeError('Color replacement accepts up to 64 rules');
    const value=rgba(source), compiled=Array.from(rules, rule=>{
      const {from,to,tolerance=0,softness=0,amount=1,preserveLightness=false}=rule ?? {};
      if (!unit(amount) || typeof preserveLightness!=='boolean') throw new RangeError('Invalid replacement amount or lightness flag');
      const pick=selection(from,metric,ctx,tolerance,softness), rgb=color(to,ctx);
      return {pick,rgb,amount,lab:preserveLightness && ColorSpace.toOKLab(rgb)};
    });
    if (compiled.length*value.width*value.height>64e6) throw new RangeError('Color replacement exceeds its rule visit budget');
    const needLab=metric!=='rgb' || compiled.some(rule=>rule.lab);
    return transfer(value,(rgb,out)=>{
      const point=needLab && ColorSpace.toOKLab(rgb);
      for (const rule of compiled) {
        const weight=rule.amount*rule.pick(rgb,point);
        if (!weight) continue;
        const tint=rule.lab ? ColorSpace.fromOKLab([point[0],rule.lab[1],rule.lab[2]]) : rule.rgb;
        for (let c=0;c<3;c++) out[c]=tint[c];
        return weight;
      }
      return 0;
    },readMask(value,options));
  }

  function key(source,options={}) {
    const {mode='color',metric='perceptual',tolerance=.04,softness=0,invert=false,strength=1,channel='luma',range}=options;
    if (!['color','channel'].includes(mode) || typeof invert!=='boolean' || !unit(strength) || !finite(softness) || softness<0)
      throw new TypeError('Invalid color key mode or settings');
    const value=rgba(source), mask=readMask(value,options), {width,height,data}=value;
    let select;
    if (mode==='color') {
      const pick=selection(options.color,metric,context(options),tolerance,softness);
      select=(_,rgb)=>pick(rgb,metric==='rgb' ? rgb : ColorSpace.toOKLab(rgb));
    } else {
      if (!tuple(range,2) || range[0]>range[1]) throw new TypeError('Channel key needs an ordered range');
      const {sample}=coordinate(source,channel);
      select=(p,rgb)=>{
        const value=sample(p,rgb);
        return feather(Math.max(range[0]-value,value-range[1],0),0,softness);
      };
    }
    const rgb=[0,0,0], matte=new Uint8Array(width*height);
    for (let p=0,i=0; i<data.length; p++,i+=4) {
      if (!data[i+3]) continue;
      const gate=mask(p)*strength, selected=gate ? select(p,read(data,i,rgb)) : 0;
      data[i+3]=matte[p]=byte(data[i+3]*(1-gate*(invert ? 1-selected : selected))/255);
    }
    return {value,matte:scalar(width,height,matte)};
  }

  P.rasterColor = {gradient,stack,channels,replace,key};
  P.rasterColorSupport = {context,rgba,readMask,transfer,gradientTransfer,stackTransfer,scalar,read,byte,clamp,unit,tuple};
})(KIT);
