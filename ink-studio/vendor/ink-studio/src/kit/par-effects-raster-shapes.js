/* Mask-driven outlines, relief, glow, and morphological edits. */
(function (P) {
  const R=P.raster, E=P.pixelEffects;
  const {view,image,channel,alpha,unit,byte,int,tuple,plane,weights,separable}=P.pixelEffectSupport;
  const finite=Number.isFinite, maxCells=6000000;

  function selection(source,{channel:name,threshold=128,invert=false}={}) {
    if (!finite(threshold) || typeof invert!=='boolean') throw new TypeError('Invalid pixel selection threshold or invert flag');
    const samples=channel(source,name);
    return Uint8Array.from(samples,(n,p)=>Number(alpha(source,p)>0 && (n>=threshold)!==invert));
  }

  function padded(source,options,pad=1) {
    const {width,height}=view(source), w=width+pad*2,h=height+pad*2;
    if (w>8192 || h>8192 || w*h>maxCells) throw new RangeError('Pixel shape exceeds the padded distance budget');
    const binary=selection(source,options), mask=new Uint8Array(w*h);
    for(let y=0;y<height;y++) mask.set(binary.subarray(y*width,(y+1)*width),(y+pad)*w+pad);
    return {size:[w,h],mask,binary,index:p=>(Math.floor(p/width)+pad)*w+p%width+pad,pad};
  }

  const distance=(mask,size,settings={})=>P.geometry.distanceTransform(mask,{size,maxCells,indices:false,...settings});
  const scalar=(source,data)=>plane(source.width,source.height,data);
  const ink=color=>DrawingPrimitives.color(color);

  function tintField(source,coverage,rgba) {
    const {width,height}=source,data=new Uint8Array(width*height*4);
    for(let p=0,i=0;p<coverage.length;p++,i+=4) {
      const a=byte(coverage[p]*rgba[3]);
      if (!a) continue;
      data[i]=rgba[0]; data[i+1]=rgba[1]; data[i+2]=rgba[2]; data[i+3]=a;
    }
    return {width,height,channels:4,data};
  }

  function merge(source,layers) {
    const value=R.stack({width:source.width,height:source.height,layers}).value;
    return source.pivot ? {...value,pivot:source.pivot.slice()} : value;
  }

  function tint(data,i,rgba,weight) {
    const amount=weight*rgba[3]/255;
    for(let c=0;c<3;c++) data[i+c]=byte(data[i+c]+(rgba[c]-data[i+c])*amount);
  }

  function outline(source,options={}) {
    const {outer=1,inner=0,feather=0,color='#1b2036',innerColor=color}=options;
    if (![outer,inner,feather].every(n=>finite(n) && n>=0 && n<=128)) throw new RangeError('Outline widths must be in [0,128]');
    const value=image(source), {mask,size,index}=padded(source,options);
    const fields=P.materials.outline(mask,{size,outer,inner,feather,maxCells});
    const pixelCount=value.width*value.height, outside=new Float32Array(pixelCount), inside=new Uint8Array(pixelCount);
    const a=ink(color), b=ink(innerColor);
    for(let p=0;p<pixelCount;p++) {
      const j=index(p);
      outside[p]=fields.outside[j];
      inside[p]=byte(fields.inside[j]*255);
      if (inside[p] && value.data[p*4+3]) tint(value.data,p*4,b,fields.inside[j]);
    }
    return {value:merge(value,[{source:tintField(value,outside,a)},{source:value}]),
      outer:scalar(value,Uint8Array.from(outside,n=>byte(n*255))),inner:scalar(value,inside)};
  }

  function bevel(source,options={}) {
    const {width=3,direction=[-1,-1],strength=.8,highlight='#fff1d4',shadow='#25304f'}=options;
    if (!finite(width) || width<=0 || width>128 || !tuple(direction,2) ||
        !finite(strength) || strength<0 || strength>1)
      throw new RangeError('Bevel needs a positive width, direction and strength in [0,1]');
    const magnitude=Math.hypot(...direction);
    if (!finite(magnitude) || !magnitude) throw new RangeError('Bevel light direction must be nonzero');
    const [lx,ly]=direction.map(v=>v/magnitude), value=image(source);
    const {mask,binary,size,index}=padded(source,options), [w]=size;
    const signed=distance(mask,size,{signed:true}).distance;
    const relief=Float32Array.from(signed,n=>unit((-n-.5)/width)), height=new Float32Array(binary.length);
    const light=ink(highlight), dark=ink(shadow);
    for(let p=0;p<binary.length;p++) {
      if (!binary[p]) continue;
      const j=index(p);
      height[p]=relief[j];
      const surface=(relief[j-1]-relief[j+1])*lx+(relief[j-w]-relief[j+w])*ly;
      const amount=unit(Math.abs(surface)*width*.8)*strength;
      if(amount) tint(value.data,p*4,surface>0 ? light : dark,amount);
    }
    return {value,height:scalar(value,height)};
  }

  function glow(source,{channel:name='alpha',threshold=1,radius=5,sigma,strength=1.2,color='#ffc476',placement='behind',mode='screen'}={}) {
    if (!finite(threshold) || !finite(strength) || strength<0 || strength>16 || !['behind','over'].includes(placement) ||
        !['normal','screen','add'].includes(mode)) throw new RangeError('Invalid glow threshold, strength, placement or blend');
    const value=image(source), {width,height}=value, samples=channel(source,name);
    const coverage=Float32Array.from(samples,(n,p)=>n>=threshold ? unit(n/255)*(name==='alpha' ? 1 : alpha(source,p)) : 0);
    const field=separable(coverage,width,height,1,weights(radius,'gaussian',sigma),'transparent');
    const glow= tintField(value,Float32Array.from(field,n=>unit(n*strength)),ink(color));
    const layers=placement==='behind' ? [{source:glow},{source:value}] : [{source:value},{source:glow,mode}];
    return {value:merge(value,layers),glow,mask:scalar(value,Uint8Array.from(field,n=>byte(n*strength*255)))};
  }

  function erode(source,options={}) {
    const {radius=1}=options;
    if (!finite(radius) || radius<0 || radius>128) throw new RangeError('Erosion radius must be in [0,128]');
    const value=image(source), {mask,binary,size,index}=padded(source,options);
    const inside=radius && distance(mask,size,{signed:true}).distance;
    const kept=new Uint8Array(binary.length);
    for(let p=0;p<binary.length;p++) {
      if(binary[p] && (!radius || -inside[index(p)]>radius)) kept[p]=255;
      else if (radius) value.data.fill(0,p*4,p*4+4);
    }
    return {value,mask:scalar(value,kept)};
  }

  function bridge(binary,width,height,maxGap,paint) {
    const axes=[[1,0],[0,1],[1,1],[1,-1]];
    if (binary.length*maxGap*8>96e6) throw new RangeError('Gap repair exceeds its bridge sample budget');
    function endpoint(x,y,dx,dy) {
      for(let step=1;step<=maxGap;step++) {
        const u=x+dx*step,v=y+dy*step;
        if(u<0 || v<0 || u>=width || v>=height) break;
        const p=v*width+u;
        if(binary[p]) return {p,step};
      }
      return null;
    }
    for(let p=0;p<binary.length;p++) {
      if(binary[p]) continue;
      const x=p%width,y=Math.floor(p/width);
      let best=null;
      for(const [dx,dy] of axes) {
        const a=endpoint(x,y,dx,dy), b=endpoint(x,y,-dx,-dy);
        if(!a || !b || a.step+b.step-1>maxGap) continue;
        const next=a.step<b.step || a.step===b.step && a.p<b.p ? a : b;
        if(!best || next.step<best.step || next.step===best.step && next.p<best.p) best=next;
      }
      if(best) paint(p,best.p);
    }
  }

  function repair(source,options={}) {
    const {radius=1,method='close',maxGap=1,color}=options;
    if (!finite(radius) || radius<0 || radius>128 || !int(maxGap,1,64) || !['close','bridge'].includes(method))
      throw new RangeError('Invalid gap repair method, radius or maximum gap');
    const value=image(source), original=value.data.slice(), replacement=color===undefined ? null : ink(color);
    const shape=method==='close' ? padded(source,options,Math.ceil(radius)+1) : null;
    const binary=shape?.binary ?? selection(source,options);
    const added=new Uint8Array(binary.length), kept=Uint8Array.from(binary,n=>n*255);
    function paint(p,owner) {
      value.data.set(replacement ?? original.subarray(owner*4,owner*4+4),p*4);
      added[p]=kept[p]=255;
    }
    if (method==='bridge') bridge(binary,value.width,value.height,maxGap,paint);
    else if (radius && binary.includes(1)) {
      const {mask,size,index,pad}=shape, [w]=size;
      const spread=distance(mask,size,{indices:true});
      const expanded=Uint8Array.from(spread.distance,n=>Number(n<=radius));
      const closed=distance(expanded,size,{signed:true}).distance;
      for(let p=0;p<binary.length;p++) {
        if(binary[p]) continue;
        const j=index(p);
        if (-closed[j]<=radius) continue;
        const owner=spread.nearest[j], x=owner%w-pad,y=Math.floor(owner/w)-pad;
        paint(p,y*value.width+x);
      }
    }
    return {value,mask:scalar(value,kept),added:scalar(value,added)};
  }

  Object.assign(P.pixelEffectSupport,{selection});
  Object.assign(E,{outline,bevel,glow,erode,repair});
})(KIT.procedural);
