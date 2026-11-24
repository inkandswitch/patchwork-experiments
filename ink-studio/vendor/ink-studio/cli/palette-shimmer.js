const R = require('./render.js');
const Color = require('../src/color-space.js');
const FrameComposite = require('../src/frame-composite.js');
const { history: artHistory } = require('../src/art-effects.js');
const { history: transparencyHistory } = require('../src/splat-order.js');

const spaces = ['screen','world','object'];
const channels = ['coverage','splatId','objectId','materialId','objectPosition','motion'];
const marks = [[255,186,77],[246,98,180]];
const colorAt = (rgb,p) => rgb[p*3]*65536 + rgb[p*3+1]*256 + rgb[p*3+2];
const hex = color => '#'+color.toString(16).padStart(6,'0');
const integer = (value,min,max) => Number.isSafeInteger(value) && value>=min && value<=max;
const unit = value => Number.isFinite(value) && value>=0 && value<=1;

function sameSurface(a,p,b,q) {
  return a.objectId[p]===b.objectId[q] && a.materialId[p]===b.materialId[q];
}

function restDistance(a,p,b,q) {
  const i=p*3, j=q*3, dx=a[i]-b[j], dy=a[i+1]-b[j+1], dz=a[i+2]-b[j+2];
  return dx*dx+dy*dy+dz*dz;
}

function neighborhood(w,h,p,visit) {
  const x=p%w;
  if (x) visit(p-1);
  if (x+1<w) visit(p+1);
  if (p>=w) visit(p-w);
  if (p+w<w*h) visit(p+w);
}

function surfaceGrid(frame, minCoverage) {
  const {w,h,passes,alpha}=frame, size=w*h;
  const visible=new Uint8Array(size), step=new Float32Array(size);
  let count=0;
  for (let p=0;p<size;p++) {
    if (!passes.splatId[p] || passes.coverage[p]<minCoverage || alpha?.[p]===0) continue;
    visible[p]=1;
    count++;
  }
  for (let p=0;p<size;p++) {
    if (!visible[p]) continue;
    let nearest=Infinity;
    neighborhood(w,h,p,q=>{
      if (!visible[q] || !sameSurface(passes,p,passes,q)) return;
      const distance=restDistance(passes.objectPosition,p,passes.objectPosition,q);
      if (distance>1e-12 && distance<nearest) nearest=distance;
    });
    step[p]=nearest;
  }
  return {w,h,passes,visible,step,count};
}

function trackSurfacePixels(before, current) {
  const {w,h,passes,visible,step}=current, size=w*h;
  const links=new Int32Array(size).fill(-1);
  if (!before) return {links,count:0};
  const previous=before.passes, motion=passes.motion;
  const claimed=new Int32Array(size).fill(-1), errors=new Float64Array(size);
  let count=0;
  for (let p=0;p<size;p++) {
    if (!visible[p]) continue;
    const x=p%w-motion[p*2], y=Math.floor(p/w)-motion[p*2+1];
    const left=Math.round(x), top=Math.round(y);
    let best=-1, distance=Infinity, reprojection=Infinity;
    for (let j=Math.max(0,top-1);j<=Math.min(h-1,top+1);j++) {
      for (let i=Math.max(0,left-1);i<=Math.min(w-1,left+1);i++) {
        const q=j*w+i;
        if (!before.visible[q] || !sameSurface(passes,p,previous,q)) continue;
        const d=restDistance(passes.objectPosition,p,previous.objectPosition,q);
        // Use the nearer render sample spacing to reject depth changes across silhouettes.
        const spacing=Math.min(step[p],before.step[q]), limit=Number.isFinite(spacing) ? spacing*1.44 : 1e-10;
        if (d>Math.max(1e-10,limit)) continue;
        const pixelError=(x-i)**2+(y-j)**2;
        if (d<distance || d===distance && pixelError<reprojection) {
          best=q;
          distance=d;
          reprojection=pixelError;
        }
      }
    }
    if (best<0) continue;
    const prior=claimed[best];
    if (prior>=0 && errors[best]<=distance) continue;
    if (prior>=0) links[prior]=-1;
    else count++;
    claimed[best]=p;
    errors[best]=distance;
    links[p]=best;
  }
  return {links,count};
}

function inBoundary(grid,colors,p) {
  let boundary=false;
  neighborhood(grid.w,grid.h,p,q=>{
    if (grid.visible[q] && sameSurface(grid.passes,p,grid.passes,q) && colors[q]!==colors[p]) boundary=true;
  });
  return boundary;
}

function bounds(w,h) {
  let left=w, top=h, right=-1, bottom=-1;
  return {
    add(p) {
      const x=p%w, y=Math.floor(p/w);
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
    },
    rect:()=>right<0 ? null : {x:left,y:top,width:right-left+1,height:bottom-top+1}
  };
}

function colorDistance() {
  const cache=new Map();
  function lab(key) {
    if (cache.has(key)) return cache.get(key);
    const result=Color.toOKLab([(key>>16)/255,(key>>8&255)/255,(key&255)/255]);
    if (cache.size<8192) cache.set(key,result);
    return result;
  }
  return (a,b)=>{
    const A=lab(a), B=lab(b);
    return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);
  };
}

function trackSwatches(frame, grid, before, previous, links, { window, minDelta }, distance, pairs) {
  const { w,h,rgb }=frame, size=w*h;
  const colors=Uint32Array.from({length:size},(_,p)=>colorAt(rgb,p));
  const priorRun=new Int32Array(size).fill(-1), age=new Uint8Array(size).fill(1);
  const mask=new Uint8Array(size), affected=bounds(w,h), edgeBounds=bounds(w,h);
  let changes=0, reversals=0, boundary=0;
  for (let p=0;p<size;p++) {
    const q=links[p];
    if (q<0) continue;
    const a=previous.colors[q], b=colors[p];
    if (a===b) {
      priorRun[p]=previous.priorRun[q];
      age[p]=Math.min(window+1,previous.age[q]+1);
      continue;
    }
    priorRun[p]=a;
    changes++;
    if (b!==previous.priorRun[q] || previous.age[q]>window || distance(a,b)<minDelta) continue;
    const edge=inBoundary(grid,colors,p) || inBoundary(before,previous.colors,q);
    mask[p]=edge ? 1 : 2;
    affected.add(p);
    reversals++;
    if (edge) {
      boundary++;
      edgeBounds.add(p);
    }
    const lo=Math.min(a,b), hi=Math.max(a,b), key=lo*0x1000000+hi;
    if (!pairs.has(key)) pairs.set(key,{colors:[hex(lo),hex(hi)],reversals:0,boundary:0});
    const pair=pairs.get(key);
    pair.reversals++;
    if (edge) pair.boundary++;
  }
  return {colors,priorRun,age,mask,
    counts:{changes,reversals,boundary,bounds:affected.rect(),boundaryBounds:edgeBounds.rect()}};
}

function totals() {
  return {eligiblePixels:0,trackedPixels:0,changes:0,reversals:0,boundary:0};
}

function markFrame(frame, mask) {
  const rgb=frame.rgb.slice();
  for (let p=0;p<mask.length;p++) {
    const at=p*3, color=marks[mask[p]-1];
    for (let k=0;k<3;k++) rgb[at+k]=color ? color[k] : Math.round(17+rgb[at+k]*.5);
  }
  return {w:frame.w,h:frame.h,rgb,alpha:frame.alpha};
}

function comparison(kit, tiles, time) {
  const {w,h}=tiles[0].frame, column=Math.max(144,w);
  const width=24+3*column+16, height=2*h+106;
  const title='#e2eaf6', muted='#a6b8cd';
  const draw=[], layers=[];
  const label=(text,x,y,size,color=title)=>draw.push({type:'text',text,at:[x,y],size,color});
  label('Palette shimmer / '+time.toFixed(2)+' s',width/2,19,14);
  for (const [i,{space,frame,mask,counts}] of tiles.entries()) {
    const x=12+i*(column+8)+(column-w)/2, center=x+w/2;
    label(space,center,43,12);
    layers.push({source:frame,rect:[Math.floor(x),52,w,h]});
    layers.push({source:markFrame(frame,mask),rect:[Math.floor(x),62+h,w,h]});
    label(counts.reversals+' flips',center,73+h*2,9,muted);
  }
  label('Amber / swatch boundary',width*.27,height-10,9,'#ffba4d');
  label('Pink / interior',width*.73,height-10,9,'#f662b4');
  const plan=kit.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(17,24,36)},
    kit.frameComposite.layers(plan,{},0),width,height,'nearest');
}

function reviewPaletteShimmer(world, {
  from=0,to=3,fps=12,window=3,minDelta=.025,minCoverage=.8,width=160,height=96,
  view={},camera,pose,onFrame
}={}) {
  const n=Math.ceil((to-from)*fps-1e-8);
  const px=view.px??1, artWidth=Math.ceil(width/px), artHeight=Math.ceil(height/px);
  if (!Number.isFinite(from) || from<0 || !Number.isFinite(to) || !integer(fps,1,120) || !integer(n,3,240) ||
      !integer(window,1,30) || !unit(minDelta) || !unit(minCoverage) ||
      !integer(width,1,2048) || !integer(height,1,2048) || !integer(px,1,2048) || 3*n*artWidth*artHeight>72e6)
    throw new RangeError('Palette shimmer needs 3–240 frames, a valid art size, and bounded sampling settings');
  if ([camera,pose,onFrame].some(fn=>fn!==undefined && typeof fn!=='function'))
    throw new TypeError('Palette shimmer camera, pose and frame callbacks must be functions');
  if (world.anim?.stateful && !pose) throw new TypeError('A stateful scene needs a pose callback for palette shimmer review');
  if (view.raw) throw new RangeError('Palette shimmer needs a palette-enabled render');
  const kit=require('../index.js').load().KIT, distance=colorDistance();
  const streams=spaces.map(space=>({space,pairs:new Map(),frames:[],total:totals(),
    history:{artHistory:artHistory({frames:24}),volumeHistory:kit.atmosphere.history(),transparencyHistory:transparencyHistory(),
      afterimageHistory:kit.afterimages.history()}}));
  const settings={window,minDelta,minCoverage};
  const base={w:width,h:height,px,composite:false,renderGraph:false,renderHistory:undefined,
    inspection:false,cameraGuides:false,samples:false,captureCoverage:false};
  let before, motionFrom, peak;
  for (let index=0;index<n;index++) {
    const time=from+index/fps;
    if (pose) pose(world,time);
    else world.anim?.update?.(index ? 1/fps : 0,time);
    const at=camera?.(index/(n-1),time);
    let grid, tracking;
    const tiles=streams.map((stream,i)=>{
      const frame=R.render(world,{...view,...at,...base,...stream.history,t:time,time,ditherSpaceOverride:stream.space,
        captureMotion:i===0,surfaceMotionFrom:i===0 ? motionFrom : undefined,passes:i===0 ? channels : false});
      if (i===0) {
        grid=surfaceGrid(frame,minCoverage);
        tracking=trackSurfacePixels(before,grid);
        motionFrom=frame.motionReference;
      }
      const state=trackSwatches(frame,grid,before,stream.previous,tracking.links,settings,distance,stream.pairs);
      stream.previous=state;
      const stats={index,time,eligiblePixels:grid.count,trackedPixels:tracking.count,...state.counts};
      stream.frames.push(stats);
      for (const key of Object.keys(stream.total)) stream.total[key]+=stats[key];
      return {space:stream.space,frame:{w:frame.w,h:frame.h,rgb:frame.rgb,alpha:frame.alpha},mask:state.mask,counts:stats};
    });
    before=grid;
    const score=Math.max(...tiles.map(row=>row.counts.reversals));
    if (!peak || score>peak.score || !score && !peak.score && index===Math.floor(n/2)) peak={index,time,tiles,score};
    if (onFrame) onFrame(comparison(kit,tiles,time),{index,time});
  }
  const variants=streams.map(({space,pairs,total,frames})=>({space,...total,
    reversalRate:total.trackedPixels ? total.reversals/total.trackedPixels : 0,frames,
    pairs:[...pairs.values()].sort((a,b)=>b.reversals-a.reversals).slice(0,16)}));
  return {image:comparison(kit,peak.tiles,peak.time),report:{scene:world.id??null,
    width:artWidth,height:artHeight,pixelSize:px,from,to,fps,frameCount:n,
    ...settings,comparison:{index:peak.index,time:peak.time},
    legend:{boundary:'#ffba4d',interior:'#f662b4'},variants}};
}

module.exports = { reviewPaletteShimmer, surfaceGrid, trackSurfacePixels, trackSwatches };
