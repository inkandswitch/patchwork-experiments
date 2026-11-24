/* Resolve shared palette policies on pixels, including deterministic scanline diffusion. */
(function (K) {
  const P = K.procedural, R = P.rasterColor;
  const {context,rgba,readMask,transfer,gradientTransfer,stackTransfer,scalar,read,byte,clamp,unit,tuple} = P.rasterColorSupport;

  function prepare(policy,ctx) {
    return PixelLook.preparePalette(policy,{...ctx,blueNoise:P.materials.blueNoise,skipDitherRegions:true});
  }

  function quantize(value, plan, options, mask, protectedPixel = () => false) {
    const {method='ordered',strength=1,serpentine=true,phase=[0,0],maskThreshold=.5} = options;
    if (!['solid','ordered','diffusion'].includes(method) || !unit(strength) || typeof serpentine!=='boolean' ||
        !tuple(phase,2,n=>Number.isSafeInteger(n) && Math.abs(n)<=1e9) || !unit(maskThreshold))
      throw new RangeError('Invalid palette resolve method, diffusion settings, phase or mask threshold');
    const {width,height,data}=value, pixels=width*height;
    const diffusion=method==='diffusion' && strength>0;
    const passes=diffusion || method==='ordered' && plan.amount ? 2 : 1;
    if (pixels*plan.packed.length*passes>96e6) throw new RangeError('Palette resolve exceeds its swatch visit budget');
    const slots=new Int16Array(pixels).fill(-1);
    let row=diffusion && new Float32Array((width+2)*3), next=diffusion && new Float32Array((width+2)*3);
    const rgb=[0,0,0], adjusted=[0,0,0];
    function spread(i,c,error,direction) {
      row[i+direction*3+c]+=error*7/16;
      next[i-direction*3+c]+=error*3/16;
      next[i+c]+=error*5/16;
      next[i+direction*3+c]+=error/16;
    }
    for (let y=0; y<height; y++) {
      const reverse=diffusion && serpentine && y%2;
      const direction=reverse ? -1 : 1;
      for (let x=reverse ? width-1 : 0; x>=0 && x<width; x+=direction) {
        const p=y*width+x, i=p*4, j=(x+1)*3, gate=mask(p);
        if (!data[i+3] || !gate || gate<maskThreshold || protectedPixel(p)) continue;
        read(data,i,rgb);
        const locked=plan.reservedIndex(rgb);
        let slot;
        if (locked!==undefined) slot=locked;
        else if (diffusion) {
          for (let c=0;c<3;c++) adjusted[c]=clamp(rgb[c]+row[j+c]);
          slot=plan.diffusionIndex(rgb,adjusted);
          if (plan.canMix(slot)) for (let c=0;c<3;c++)
            spread(j,c,(adjusted[c]-plan.swatches[slot][c])*strength*data[i+3]/255,direction);
        } else slot=plan.index(rgb,x+phase[0],y+phase[1],method==='ordered');
        slots[p]=slot;
        for (let c=0;c<3;c++) data[i+c]=byte(plan.swatches[slot][c]);
      }
      if (diffusion) {
        [row,next]=[next,row];
        next.fill(0);
      }
    }
    return {value,indices:scalar(width,height,slots),
      palette:plan.packed.map(color=>'#'+color.toString(16).padStart(6,'0'))};
  }

  function resolve(source, policy, options={}) {
    const value=rgba(source), plan=prepare(policy,context(options));
    return quantize(value,plan,options,readMask(value,options));
  }

  function look(source, pack, binding, options={}) {
    if (binding===false) return {value:rgba(source),metadata:{id:null,revision:null,stack:false,ramp:false,palette:false}};
    const ctx=context(options), value=rgba(source), mask=readMask(value,options);
    const packs=Array.isArray(pack) ? pack : pack?.format==='ink-studio/asset-bundle' ?
      K.authoring.assetPacks.merge([],pack).packs : [pack];
    const catalog=K.authoring.assetPacks.create({packs}), bound=K.authoring.looks.bind(binding,catalog);
    if (!bound) throw new TypeError('A raster look needs an asset binding');
    const {id,revision,weight=1,lightingRamp}=bound;
    const {time=0}=options;
    const active=bound.driver ? LookInputs.resolve(bound.driver,LookInputs.session(time)) : bound;
    const {strength,stack,palette,mask:sceneMask}=active, amount=strength*weight;
    const metadata={id,revision,stack:Boolean(stack),ramp:Boolean(lightingRamp),palette:Boolean(palette)};
    if (!amount) return {value,metadata};
    if (sceneMask && options.mask===undefined)
      throw new TypeError('A scene-masked look needs a raster mask when bound to a raster');
    const plan=palette && prepare(palette,ctx);
    const locks=plan && new Uint8Array(value.width*value.height);
    if (locks) {
      const rgb=[0,0,0], {data}=value;
      for (let p=0,i=0; p<locks.length;p++,i+=4)
        if (data[i+3] && plan.reservedIndex(read(data,i,rgb))!==undefined) locks[p]=1;
    }
    const protectedPixel=p=>locks?.[p]===1;
    if (stack) transfer(value,stackTransfer(stack,ctx,weight),mask,protectedPixel);
    if (lightingRamp) transfer(value,gradientTransfer(value,lightingRamp,{...options,strength:amount},ctx),mask,protectedPixel);
    if (plan) quantize(value,plan,options,p=>mask(p)*weight,protectedPixel);
    return {value,metadata};
  }

  Object.assign(R,{resolve,look});
})(KIT);
