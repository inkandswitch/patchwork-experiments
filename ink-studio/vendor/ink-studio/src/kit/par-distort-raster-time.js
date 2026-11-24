/* Sample independently timed pixels from reusable Ink raster frames. */
(function (P) {
  const W=P.rasterWarp, R=P.raster;
  const {view,size,finite,int,bounded,clamp,wrap,raster,sampler,paint,mix}=P.rasterWarpSupport;
  const budget=16e6;

  function frames(source,{tag='all',layers}={}) {
    const asset=P.graph.raster(source), clip=asset.clipInfo(tag);
    const {start,end,fps,loop}=clip,count=end-start;
    size(asset.width,asset.height);
    if (asset.width*asset.height*count>budget) throw new RangeError('Raster clip exceeds its time sampling budget');
    const value=Array.from({length:count},(_,i)=>asset.composite(i/fps,{tag,layers}));
    return {value,fps,times:value.map((_,i)=>i/fps),loop};
  }

  function prepareTime(source,options={}) {
    const {fps=12,times,mode='offset',scale=1,bias=0,interpolation='linear',playback='hold',channel=0,duration}=options;
    if (!Array.isArray(source) || !int(source.length,1,512) || !finite(fps) || fps<=0 || fps>4096 ||
        !['offset','absolute'].includes(mode) || !bounded(scale) || !bounded(bias) ||
        !['hold','loop','pingpong'].includes(playback) || !['step','nearest','linear'].includes(interpolation))
      throw new RangeError('Invalid raster frame list or time remap options');
    const {width,height}=view(source[0]);
    if (width*height*source.length>budget || !Array.from(source).every(frame=>frame?.width===width && frame?.height===height))
      throw new RangeError('Time remap needs equal frame dimensions within its pixel budget');
    const keys=times ?? source.map((_,i)=>i/fps), count=source.length;
    if (!Array.isArray(keys) || keys.length!==count || keys[0]!==0 ||
        !Array.from(keys).every((t,i)=>bounded(t) && (!i || t>keys[i-1])))
      throw new RangeError('Raster frame times must increase from zero');
    const last=keys[count-1], loop=duration ?? last+1/fps;
    if (!bounded(loop) || loop<=last) throw new RangeError('Loop duration must exceed the last frame time');
    const inputs=source.map(frame=>sampler(frame,options));
    function locate(t,out) {
      if (count===1) { out[0]=out[1]=out[2]=0; return; }
      if (playback==='loop') t=wrap(t,loop);
      else if (playback==='pingpong') {
        const mirrored=wrap(t,2*last);
        t=Math.min(mirrored,2*last-mirrored);
      } else t=clamp(t,0,last);
      if (t>=last) {
        out[0]=count-1; out[1]=playback==='loop' ? 0 : count-1; out[2]=(t-last)/(loop-last);
        return;
      }
      let first=0,high=count-1;
      while (high-first>1) {
        const middle=(first+high)>>1;
        if (keys[middle]<=t) first=middle;
        else high=middle;
      }
      out[0]=first; out[1]=high; out[2]=(t-keys[first])/(keys[high]-keys[first]);
    }
    return (map,time=0)=>{
      const {width:w,height:h}=view(map), data=R.channel(map,{channel}).data;
      if (!bounded(time)) throw new RangeError('Raster remap time must be finite');
      const rgba=new Uint8Array(w*h*4), at=new Float64Array(3);
      const a=new Float64Array(4),b=new Float64Array(4),out=new Float64Array(4);
      const base=mode==='offset' ? time : 0;
      for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
        const t=base+bias+data[p]*scale;
        if (!bounded(t)) throw new RangeError('Pixel time map produced an out-of-range time');
        locate(t,at);
        const [first,second,weight]=at, u=(x+.5)/w,v=(y+.5)/h;
        if (interpolation==='linear' && weight && first!==second) {
          inputs[first](u,v,a); inputs[second](u,v,b); mix(a,b,weight,out);
        } else inputs[interpolation==='nearest' && weight>=.5 ? second : first](u,v,out);
        paint(rgba,p*4,out);
      }
      return raster(w,h,4,rgba);
    };
  }

  function timeRemap(source,map,options={}) {
    return prepareTime(source,options)(map,options.time ?? 0);
  }

  P.rasterWarpSupport.prepareTime=prepareTime;
  Object.assign(W,{frames,timeRemap});
})(KIT.procedural);
