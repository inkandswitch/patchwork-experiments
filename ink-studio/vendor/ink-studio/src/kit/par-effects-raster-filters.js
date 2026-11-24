/* Raster filters in premultiplied color, with explicit sampling boundaries. */
(function (P) {
  const R = P.raster, valid = P.graphTypes.validator('raster');
  const finite = Number.isFinite;
  const unit = n => Math.max(0,Math.min(1,n));
  const byte = n => Math.round(Math.max(0,Math.min(255,n)));
  const int = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
  const tuple = (value,n,check=finite) => Array.isArray(value) && value.length===n && Array.from(value).every(check);
  const plane = (width,height,data) => ({width,height,channels:1,data});
  const validateEdge = edge => {
    if (!['clamp','transparent','wrap'].includes(edge)) throw new TypeError('Pixel filter edge must be clamp, transparent or wrap');
  };

  function view(source) {
    if (!valid(source) || source.width>8192 || source.height>8192 || source.width*source.height>4e6)
      throw new RangeError('Pixel effects need a bounded raster of at most four million pixels');
    return source;
  }

  function channel(source,name) {
    const {width,height,data}=view(source), count=source.channels ?? data.length/(width*height);
    return R.channel(source,{channel:name ?? (count===2 || count===4 ? 'alpha' : 'luma')}).data;
  }

  function alpha(source,p) {
    const count=source.channels ?? source.data.length/(source.width*source.height);
    return count===2 || count===4 ? unit(source.data[p*count+count-1]/255) : 1;
  }

  function image(source) { return R.rgba(view(source)); }

  function boundary(edge) {
    if (edge==='wrap') return (n,span) => ((n%span)+span)%span;
    if (edge==='clamp') return (n,span) => Math.max(0,Math.min(span-1,n));
    return (n,span) => n>=0 && n<span ? n : -1;
  }

  function checkWork(width,height,taps) {
    if (width*height*taps>96e6) throw new RangeError('Pixel filter exceeds its sample budget');
  }

  function weights(radius,kind='gaussian',sigma=Math.max(.5,radius/2)) {
    if (!int(radius,0,64) || !['box','gaussian'].includes(kind) || !finite(sigma) || sigma<=0)
      throw new RangeError('Blur needs a radius from 0 to 64 and a positive sigma');
    const values=Array.from({length:2*radius+1},(_,i) => kind==='box' || i===radius ? 1 :
      Math.exp(-.5*((i-radius)/sigma)**2));
    const sum=values.reduce((a,b)=>a+b);
    return values.map(value=>value/sum);
  }

  function convolve(data,width,height,channels,taps,edge) {
    const {length}=data, result=new Float32Array(length), bound=boundary(edge);
    const sum=new Float64Array(channels);
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      sum.fill(0);
      for (const [dx,dy,w] of taps) {
        const u=bound(x+dx,width), v=bound(y+dy,height);
        if (u<0 || v<0) continue;
        const from=(v*width+u)*channels;
        for (let c=0; c<channels; c++) sum[c]+=data[from+c]*w;
      }
      result.set(sum,(y*width+x)*channels);
    }
    return result;
  }

  function separable(data,width,height,channels,kernel,edge) {
    const r=(kernel.length-1)/2;
    if (!r) return data;
    checkWork(width,height,kernel.length*2);
    const horizontal=kernel.map((w,i)=>[i-r,0,w]), vertical=kernel.map((w,i)=>[0,i-r,w]);
    const first=convolve(data,width,height,channels,horizontal,edge);
    return convolve(first,width,height,channels,vertical,edge);
  }

  function customKernel(kernel) {
    const h=kernel?.length, w=kernel?.[0]?.length;
    if (!int(h,1,31) || !int(w,1,31) || !(w%2 && h%2) ||
        !Array.isArray(kernel) || !Array.from(kernel).every(row=>tuple(row,w,n=>finite(n) && n>=0)))
      throw new TypeError('A blur kernel needs odd dimensions up to 31 and nonnegative weights');
    const total=kernel.reduce((sum,row)=>sum+row.reduce((a,b)=>a+b,0),0);
    if (!finite(total) || !total) throw new RangeError('A blur kernel needs a finite positive weight sum');
    return kernel.flatMap((row,y)=>row.map((value,x)=>[x-(w-1)/2,y-(h-1)/2,value/total])).filter(t=>t[2]);
  }

  function premultiply(value) {
    const {data}=value, out=new Float32Array(data.length);
    for (let i=0;i<data.length;i+=4) {
      for (let c=0;c<3;c++) out[i+c]=data[i+c]*data[i+3]/255;
      out[i+3]=data[i+3];
    }
    return out;
  }

  function resolve(value,samples) {
    const {data}=value;
    for (let i=0;i<data.length;i+=4) {
      const a=samples[i+3];
      data[i+3]=byte(a);
      for (let c=0;c<3;c++) data[i+c]=data[i+3] ? byte(255*samples[i+c]/a) : 0;
    }
    return value;
  }

  function kernelBlur(source,{kind='gaussian',radius=2,sigma,kernel,edge='clamp'}={}) {
    validateEdge(edge);
    const value=image(source), {width,height}=value;
    if (kernel!==undefined) {
      const taps=customKernel(kernel);
      checkWork(width,height,taps.length);
      return resolve(value,convolve(premultiply(value),width,height,4,taps,edge));
    }
    const row=weights(radius,kind,sigma);
    return radius ? resolve(value,separable(premultiply(value),width,height,4,row,edge)) : value;
  }

  function pathTaps(path,samples,anchor,falloff) {
    const vertices=Array.isArray(path) ? path : path?.points, closed=path?.closed ?? false;
    if (!Array.isArray(vertices) || !int(vertices.length,2,4096) ||
        !Array.from(vertices).every(p=>tuple(p,2,n=>finite(n) && Math.abs(n)<=1e6)) || typeof closed!=='boolean')
      throw new TypeError('Path blur needs a finite 2D path');
    const points=closed ? [...vertices,vertices[0]] : vertices;
    const lengths=[0];
    for (let i=1;i<points.length;i++) {
      const [x,y]=points[i],[u,v]=points[i-1];
      lengths.push(lengths.at(-1)+Math.hypot(x-u,y-v));
    }
    const total=lengths.at(-1);
    if (!total) return [[0,0,1]];
    function at(t) {
      const d=total*t;
      let first=0,last=lengths.length-1;
      while(last-first>1) {
        const mid=(first+last)>>1;
        if(lengths[mid]<=d) first=mid;
        else last=mid;
      }
      const delta=lengths[last]-lengths[first], f=delta ? (d-lengths[first])/delta : 0;
      return points[first].map((n,c)=>n+(points[last][c]-n)*f);
    }
    const [x,y]=at(anchor==='start' ? 0 : anchor==='end' ? 1 : .5);
    const taps=Array.from({length:samples},(_,i)=>{
      const t=i/(samples-1), [u,v]=at(t);
      return [x-u,y-v,falloff==='start' ? 1-t : falloff==='end' ? t : 1];
    });
    const sum=taps.reduce((n,tap)=>n+tap[2],0);
    return taps.filter(t=>t[2]).map(([u,v,w])=>[u,v,w/sum]);
  }

  function pathBlur(source,path,{samples=13,anchor='start',falloff='uniform',filter='linear',edge='transparent'}={}) {
    validateEdge(edge);
    if (!int(samples,2,128) || !['start','center','end'].includes(anchor) ||
        !['uniform','start','end'].includes(falloff) || !['linear','nearest'].includes(filter))
      throw new TypeError('Invalid path blur sample count, anchor or filter');
    const value=image(source), {width,height}=value, taps=pathTaps(path,samples,anchor,falloff);
    checkWork(width,height,taps.length*(filter==='linear' ? 4 : 1));
    const effective=[];
    for (const [x,y,w] of taps) {
      if (filter==='nearest') effective.push([Math.round(x),Math.round(y),w]);
      else {
        const u=Math.floor(x),v=Math.floor(y), fx=x-u,fy=y-v;
        for(let j=0;j<2;j++) for(let i=0;i<2;i++) {
          const gain=w*(i ? fx : 1-fx)*(j ? fy : 1-fy);
          if(gain) effective.push([u+i,v+j,gain]);
        }
      }
    }
    return resolve(value,convolve(premultiply(value),width,height,4,effective,edge));
  }

  P.pixelEffects={kernelBlur,pathBlur};
  P.pixelEffectSupport={view,image,channel,alpha,unit,byte,int,tuple,plane,weights,separable};
})(KIT.procedural);
