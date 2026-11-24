/* Four/eight-neighbor raster segmentation with stable labels and bounded queues. */
(function (P) {
  const R = P.raster, D = P.drawing2d;
  const blocked = 0xffffffff, maxPixels = 8e6;
  const four = [[1,0],[-1,0],[0,1],[0,-1]], eight = [...four,[1,1],[-1,1],[1,-1],[-1,-1]];
  const valid = P.graphTypes.validator('raster');
  const raster = (width,height,data) => ({width,height,channels:1,data});

  function prepare(source, connectivity) {
    if (!valid(source) || source.width*source.height > maxPixels)
      throw new RangeError('Region analysis needs a bounded raster');
    if (connectivity !== 4 && connectivity !== 8) throw new RangeError('Raster connectivity must be 4 or 8');
    return {width:source.width,height:source.height,steps:connectivity===4 ? four : eight,
      queue:new Uint32Array(source.width*source.height)};
  }

  function visit(seed, marks, id, matches, context) {
    const {width,height,steps,queue} = context;
    const startX = seed%width, startY = Math.floor(seed/width);
    let left=startX, right=startX, top=startY, bottom=startY, area=1;
    marks[seed]=id; queue[0]=seed;
    for (let i=0; i<area; i++) {
      const p=queue[i], x=p%width, y=Math.floor(p/width);
      left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      for (const [dx,dy] of steps) {
        const u=x+dx, v=y+dy;
        if (u<0 || u>=width || v<0 || v>=height) continue;
        const key=v*width+u;
        if (!marks[key] && matches(key)) {
          marks[key]=id;
          queue[area++]=key;
        }
      }
    }
    return {id,area,seed:[startX,startY],rect:{x:left,y:top,width:right-left+1,height:bottom-top+1}};
  }

  function floodFill(source, {seed, color = '#ffffff', connectivity = 4, tolerance = 0} = {}) {
    const context=prepare(source,connectivity), {width,height,queue}=context;
    if (!Array.isArray(seed) || seed.length!==2 || !Array.from(seed).every(Number.isSafeInteger) ||
        seed[0]<0 || seed[0]>=width || seed[1]<0 || seed[1]>=height ||
        !Number.isFinite(tolerance) || tolerance<0 || tolerance>255)
      throw new RangeError('Flood fill needs an in-bounds seed and tolerance from 0 to 255');
    const rgba=DrawingPrimitives.color(color);
    const value=R.rgba(source), {data}=value, marks=new Uint8Array(width*height);
    const start=seed[1]*width+seed[0], target=data.slice(start*4,start*4+4);
    const stats=visit(start,marks,255,p=>target.every((n,i)=>Math.abs(n-data[p*4+i])<=tolerance),context);
    for (let i=0; i<stats.area; i++) data.set(rgba,queue[i]*4);
    return {value,mask:raster(width,height,marks),stats:{area:stats.area,seed:stats.seed,rect:stats.rect}};
  }

  function components(source, {connectivity = 4, channel, threshold = 1, minArea = 1, invert = false} = {}) {
    const context=prepare(source,connectivity), {width,height,queue}=context;
    if (!Number.isFinite(threshold) || !Number.isSafeInteger(minArea) || minArea<1 || typeof invert!=='boolean')
      throw new RangeError('Invalid component threshold, minimum area or invert flag');
    const channels=source.channels ?? source.data.length/(width*height);
    const samples=R.channel(source,{channel:channel ?? (channels===2 || channels===4 ? 'alpha' : 'luma')}).data;
    const marks=new Uint32Array(width*height), regions=[];
    function active(p) {
      if ((samples[p]>=threshold)!==invert) return true;
      marks[p]=blocked;
      return false;
    }
    for (let p=0; p<marks.length; p++) {
      if (marks[p] || !active(p)) continue;
      const region=visit(p,marks,regions.length+1,active,context);
      if (region.area<minArea) for (let i=0; i<region.area; i++) marks[queue[i]]=blocked;
      else {
        if (regions.length>=32768) throw new RangeError('Raster exceeds its connected-component budget');
        regions.push(region);
      }
    }
    for (let p=0; p<marks.length; p++) if (marks[p]===blocked) marks[p]=0;
    return {value:regions,labels:raster(width,height,marks)};
  }

  function extract(source, labels, component) {
    const {id,rect}=component ?? {};
    if (!valid(source) || !valid(labels) || source.width!==labels.width || source.height!==labels.height ||
        labels.data.length!==source.width*source.height || !Number.isSafeInteger(id) || id<1 || !rect)
      throw new TypeError('Component extraction needs aligned raster labels and a component record');
    const value=R.rgba(R.crop(source,rect)), {data,width,height}=value;
    let count=0;
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      if (labels.data[(rect.y+y)*labels.width+rect.x+x]===id) count++;
      else data.fill(0,(y*width+x)*4,(y*width+x+1)*4);
    }
    if (!count) throw new RangeError('Component label is absent from its rectangle');
    return value;
  }

  Object.assign(D,{floodFill,components,extract});
})(KIT.procedural);
