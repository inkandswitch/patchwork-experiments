/* Inverse UV fields and alpha-correct sampling in top-left image coordinates. */
(function (P) {
  const R=P.raster, valid=P.graphTypes.validator('raster');
  const finite=Number.isFinite;
  const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
  const fraction=n=>finite(n) && n>=0 && n<=1;
  const wrap=(n,span=1)=>{
    const phase=n%span;
    return phase<0 ? phase+span : phase;
  };
  const bounded=n=>finite(n) && Math.abs(n)<=1e9;
  const tuple=(v,n,test=finite)=>Array.isArray(v) && v.length===n && Array.from(v).every(test);
  const int=(n,min,max)=>Number.isSafeInteger(n) && n>=min && n<=max;
  const raster=(width,height,channels,data)=>({width,height,channels,data});

  function size(width,height) {
    if (!int(width,1,8192) || !int(height,1,8192) || width*height>4e6)
      throw new RangeError('Warp dimensions exceed the four-million-pixel budget');
    return {width,height};
  }

  function view(source) {
    if (!valid(source)) throw new TypeError('Warp needs a typed raster');
    const {width,height,data}=source;
    size(width,height);
    return {width,height,data,channels:source.channels ?? data.length/(width*height)};
  }

  function output(source,{width=source.width,height=source.height}={}) { return size(width,height); }

  function address(edge) {
    if (edge==='transparent') return (n,span)=>n>=0 && n<span ? n : -1;
    if (edge==='clamp') return (n,span)=>clamp(n,0,span-1);
    if (edge==='wrap') return (n,span)=>wrap(n,span);
    if (edge==='mirror') return (n,span)=>{
      const p=wrap(n,span*2);
      return p<span ? p : span*2-1-p;
    };
    throw new RangeError('Warp edges need transparent, clamp, wrap or mirror addressing');
  }

  function sampler(source,{filter='linear',edge='clamp',edgeU=edge,edgeV=edge}={}) {
    view(source);
    if (!['nearest','linear'].includes(filter)) throw new TypeError('Warp sampling needs nearest or linear filtering');
    const {width,height,data}=R.rgba(source);
    const ax=address(edgeU), ay=address(edgeV);
    function add(x,y,w,out) {
      const u=ax(x,width),v=ay(y,height);
      if (u<0 || v<0 || !w) return;
      const i=(v*width+u)*4,a=data[i+3]/255*w;
      for (let c=0;c<3;c++) out[c]+=data[i+c]*a;
      out[3]+=a;
    }
    if (filter==='nearest') return (u,v,out)=>{
      out.fill(0);
      add(Math.floor(u*width),Math.floor(v*height),1,out);
    };
    return (u,v,out)=>{
      out.fill(0);
      const sx=u*width-.5,sy=v*height-.5;
      const x=Math.floor(sx),y=Math.floor(sy),tx=sx-x,ty=sy-y;
      add(x,y,(1-tx)*(1-ty),out); add(x+1,y,tx*(1-ty),out);
      add(x,y+1,(1-tx)*ty,out); add(x+1,y+1,tx*ty,out);
    };
  }

  function paint(data,i,value,coverage=1) {
    const a=value[3];
    data[i+3]=Math.round(clamp(a*coverage)*255);
    if (data[i+3]) for (let c=0;c<3;c++) data[i+c]=Math.round(clamp(value[c]/a,0,255));
  }

  function mix(a,b,t,out) {
    for (let c=0;c<4;c++) out[c]=a[c]*(1-t)+b[c]*t;
  }

  function fieldFrom(width,height,channels,formula) {
    size(width,height);
    const data=new Float32Array(width*height*channels), value=new Float64Array(channels);
    for (let y=0,p=0;y<height;y++) for (let x=0;x<width;x++,p++) {
      formula((x+.5)/width,(y+.5)/height,x,y,p,value);
      if (!value.every(bounded)) throw new RangeError('UV field produced a nonfinite or out-of-range coordinate');
      data.set(value,p*channels);
    }
    return raster(width,height,channels,data);
  }

  function field({width,height,matrix=[[1,0,0],[0,1,0]]}={}) {
    if (!tuple(matrix,2,row=>tuple(row,3,bounded))) throw new TypeError('UV transform needs a finite 2 by 3 matrix');
    const [[a,b,c],[d,e,f]]=matrix;
    return fieldFrom(width,height,2,(u,v,_x,_y,_p,out)=>{
      out[0]=a*u+b*v+c; out[1]=d*u+e*v+f;
    });
  }

  function sample(source,uv,settings={}) {
    const {width,height,data,channels}=view(uv);
    if (channels!==2 && channels!==3) throw new TypeError('UV field needs U,V and optional coverage channels');
    const at=sampler(source,settings), rgba=new Uint8Array(width*height*4), color=new Float64Array(4);
    for (let i=0,p=0;i<data.length;i+=channels,p++) {
      const u=data[i],v=data[i+1],coverage=channels===3 ? data[i+2] : 1;
      if (!bounded(u) || !bounded(v) || !fraction(coverage)) throw new RangeError('Invalid UV field sample');
      if (!coverage) continue;
      at(u,v,color);
      paint(rgba,p*4,color,coverage);
    }
    return raster(width,height,4,rgba);
  }

  P.rasterWarp={field,sample};
  P.rasterWarpSupport={size,view,output,tuple,int,finite,bounded,fraction,clamp,wrap,raster,sampler,paint,mix,fieldFrom};
})(KIT.procedural);
