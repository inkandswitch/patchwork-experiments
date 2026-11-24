/* Sort eligible raster runs and trace image regions into typed geometry. */
(function (P) {
  const E=P.pixelEffects, D=P.drawing2d;
  const {view,image,channel,int,tuple,plane,selection}=P.pixelEffectSupport;

  function sortKey(source,key) {
    if (!['hue','saturation','lightness'].includes(key)) return channel(source,key);
    const {data,width,height}=image(source);
    return Float64Array.from({length:width*height},(_,p)=>{
      const r=data[p*4]/255,g=data[p*4+1]/255,b=data[p*4+2]/255;
      if(key==='lightness') return ColorSpace.toOKLab([r,g,b])[0];
      const high=Math.max(r,g,b),low=Math.min(r,g,b),delta=high-low;
      if(key==='saturation') return high ? delta/high : 0;
      if(!delta) return 0;
      const hue=high===r ? (g-b)/delta : high===g ? 2+(b-r)/delta : 4+(r-g)/delta;
      return ((hue+6)%6)/6;
    });
  }

  function pixelSort(source,{axis='horizontal',key='luma',range,order='asc',minLength=2,mask,maskChannel='luma',maskThreshold=128}={}) {
    if (!['horizontal','vertical','diagonal','antidiagonal'].includes(axis) || !['asc','desc'].includes(order) ||
      !int(minLength,2,8192) || !Number.isFinite(maskThreshold) || range!==undefined && (!tuple(range,2) || range[0]>range[1]))
      throw new RangeError('Invalid pixel sort direction, range or run length');
    const value=image(source), {width,height,data}=value, original=data.slice(), keys=sortKey(source,key);
    if(mask!==undefined && (mask?.width!==width || mask?.height!==height)) throw new RangeError('Pixel sort mask must align to the source');
    const gate=mask!==undefined ? channel(mask,maskChannel) : null, run=[];
    function flush() {
      if(run.length>=minLength) {
        const sorted=P.graph.arrays.stableSort(run,p=>keys[p],order);
        for(let i=0;i<run.length;i++) data.set(original.subarray(sorted[i]*4,sorted[i]*4+4),run[i]*4);
      }
      run.length=0;
    }
    const vertical=axis==='vertical', horizontal=axis==='horizontal';
    const dx=vertical ? 0 : axis==='antidiagonal' ? -1 : 1, dy=horizontal ? 0 : 1;
    function line(x,y) {
      while(x>=0 && x<width && y<height) {
        const p=y*width+x, score=keys[p];
        if(original[p*4+3] && (!gate || gate[p]>=maskThreshold) && (!range || score>=range[0] && score<=range[1])) run.push(p);
        else flush();
        x+=dx; y+=dy;
      }
      flush();
    }
    if(!horizontal) for(let x=0;x<width;x++) line(x,0);
    if(!vertical) for(let y=horizontal ? 0 : 1;y<height;y++) line(dx<0 ? width-1 : 0,y);
    return value;
  }

  function compact(path) {
    const {closed}=path, points=closed ? path.points.slice(0,-1) : path.points;
    const kept=points.filter(([x,y],i)=>{
      if(!closed && (i===0 || i===points.length-1)) return true;
      const [u,v]=points[(i+points.length-1)%points.length], [a,b]=points[(i+1)%points.length];
      const dx=x-u,dy=y-v,ex=a-x,ey=b-y;
      return Math.abs(dx*ey-dy*ex)>1e-9 || dx*ex+dy*ey<=0;
    });
    return {points:kept.length>=(closed ? 3 : 2) ? kept : points,closed};
  }

  function analyze(source,options={}) {
    const {paths:trace=true,pointMode='centroids',stride=1,limit=32768,minArea=1,connectivity=4}=options;
    if(typeof trace!=='boolean' || !['centroids','boundary','pixels','none'].includes(pointMode) ||
        !int(stride,1,8192) || !int(limit,1,100000))
      throw new RangeError('Invalid raster analysis path or point settings');
    const {width,height}=view(source);
    if((trace || pointMode==='boundary') && (width+1)*(height+1)>500000)
      throw new RangeError('Raster contours exceed the marching cell budget');
    const binary=selection(source,options);
    const {value:components,labels}=D.components(plane(width,height,binary),{minArea,connectivity});
    const paths=trace || pointMode==='boundary' ? P.contours.march((x,y)=>{
      const u=Math.floor(x),v=Math.floor(y);
      return u>=0 && v>=0 && u<width && v<height && labels.data[v*width+u] ? -1 : 1;
    },{bounds:{min:[-.5,-.5],max:[width+.5,height+.5]},cell:1,maxCells:500000}).map(compact) : [];
    const sums=new Float64Array(components.length*2), points=[];
    function append(point) {
      if(points.length>=limit) throw new RangeError('Raster analysis exceeds its point limit');
      points.push(point);
    }
    const mask=new Uint8Array(binary.length);
    for(let p=0;p<binary.length;p++) {
      const id=labels.data[p];
      if(!id) continue;
      const x=p%width,y=Math.floor(p/width),i=(id-1)*2;
      mask[p]=255;
      sums[i]+=x+.5; sums[i+1]+=y+.5;
      if(pointMode==='pixels' && x%stride===0 && y%stride===0) append([x+.5,y+.5]);
    }
    const regions=components.map((region,i)=>({...region,centroid:[sums[i*2]/region.area,sums[i*2+1]/region.area]}));
    if(pointMode==='centroids') for(const {centroid} of regions) append(centroid);
    if(pointMode==='boundary') for(const path of paths) for(let i=0;i<path.points.length;i+=stride) append(path.points[i]);
    return {paths:trace ? paths : [],points,regions,mask:plane(width,height,mask)};
  }

  Object.assign(E,{pixelSort,analyze});
})(KIT.procedural);
