const Color = require('../src/color-space.js');
const TargetSelectors = require('../src/target-selectors.js');
const FrameComposite = require('../src/frame-composite.js');

const names = ['base','lit','graded','final'];
const titles = ['Base paint','Lit composite','Graded output','Final swatches'];
const hex = color => '#' + color.toString(16).padStart(6,'0');
const packed = (rgb,p) => rgb[p*3]*65536 + rgb[p*3+1]*256 + rgb[p*3+2];
const count = (map,key) => map.set(key,(map.get(key)??0)+1);
const rank = (map,limit) => [...map].sort(([a,n],[b,m])=>m-n||a-b).slice(0,limit);
const swatches = (map,limit) => rank(map,limit).map(([color,pixels])=>({swatch:hex(color),pixels}));

function scoped(image, selection) {
  if (!image || !selection) return image;
  return { ...image,alpha:Uint8Array.from(selection,(bit,p)=>bit ? image.alpha?.[p]??255 : 0) };
}

function summary(image, read, limit) {
  if (!image) return {available:false,pixels:0};
  const counts=new Map(), {w,h,alpha,rgb}=image;
  for (let p=0;p<w*h;p++) if (alpha?.[p]!==0) count(counts,packed(rgb,p));
  const {alpha:coverage,brightness,hue,tones}=read(image);
  return {available:coverage.included>0,pixels:coverage.included,swatchCount:counts.size,
    swatches:swatches(counts,limit),brightness,hue,tones};
}

function compareStages(before, after, {hueThreshold,minChroma,limit}) {
  const source=new Set(), dest=new Map(), hueCache=new Map(), shifts=new Map();
  let pixels=0, changed=0, hueShifted=0, neutralized=0, chromatic=0, totalHue=0;
  function hue(color) {
    if (hueCache.has(color)) return hueCache.get(color);
    const [,a,b]=Color.toOKLab([(color>>16)/255,(color>>8&255)/255,(color&255)/255]);
    const value=Math.hypot(a,b)>=minChroma ? Math.atan2(b,a)*180/Math.PI : null;
    if (hueCache.size<8192) hueCache.set(color,value);
    return value;
  }
  for (let p=0;p<before.w*before.h;p++) {
    if (before.alpha?.[p]===0 || after.alpha?.[p]===0) continue;
    const a=packed(before.rgb,p), b=packed(after.rgb,p);
    pixels++;
    source.add(a);
    if (!dest.has(b)) dest.set(b,new Map());
    count(dest.get(b),a);
    if (a!==b) changed++;
    const h1=hue(a), h2=hue(b);
    if (h1===null) continue;
    if (h2===null) { neutralized++; continue; }
    chromatic++;
    const distance=Math.abs(((h2-h1+540)%360)-180);
    totalHue+=distance;
    if (!distance || distance<hueThreshold) continue;
    hueShifted++;
    const key=a*0x1000000+b;
    if (!shifts.has(key)) shifts.set(key,{from:hex(a),to:hex(b),degrees:distance,
      x:p%before.w,y:Math.floor(p/before.w),pixels:0});
    shifts.get(key).pixels++;
  }
  const merged=[], introduced=new Map();
  let mergedSwatches=0, mergedPixels=0;
  for (const [color,inputs] of dest) {
    let total=0;
    for (const value of inputs.values()) total+=value;
    if (!source.has(color)) introduced.set(color,total);
    if (inputs.size<2) continue;
    mergedSwatches++;
    mergedPixels+=total;
    merged.push({swatch:hex(color),pixels:total,sourceSwatches:inputs.size,sources:swatches(inputs,limit)});
  }
  return {pairedPixels:pixels,changedPixels:changed,inputSwatches:source.size,outputSwatches:dest.size,
    mergedSwatches,mergedPixels,merges:merged.sort((a,b)=>b.pixels-a.pixels||a.swatch.localeCompare(b.swatch)).slice(0,limit),
    introducedCount:introduced.size,introduced:swatches(introduced,limit),
    hue:{comparedPixels:chromatic,shiftedPixels:hueShifted,neutralizedPixels:neutralized,
      averageDegrees:chromatic ? totalHue/chromatic : null,
      examples:[...shifts.values()].sort((a,b)=>b.pixels-a.pixels||b.degrees-a.degrees).slice(0,limit)}};
}

function unexpected(rasters, allowed, limit) {
  const image=rasters.final, colors=new Map(), introducedAt=new Map();
  const earlier=names.slice(0,-1).reverse().filter(name=>rasters[name]);
  let pixels=0;
  for (let p=0;p<image.w*image.h;p++) {
    if (image.alpha?.[p]===0) continue;
    const color=packed(image.rgb,p);
    if (allowed.has(color)) continue;
    count(colors,color);
    pixels++;
    let origin='final';
    for (const name of earlier) {
      const stage=rasters[name];
      if (stage.alpha?.[p]===0 || packed(stage.rgb,p)!==color) break;
      origin=name;
    }
    count(introducedAt,origin);
  }
  return {pixels,swatchCount:colors.size,swatches:swatches(colors,limit),introducedAt:Object.fromEntries(introducedAt)};
}

function preview(kit, rasters, report) {
  const {w,h}=rasters.final, col=Math.max(w,164)+12, width=4*col+12, height=h+165;
  const draw=[], layers=[], dim='#a7b8ca';
  const text=(value,x,y,size,color='#e6edf7')=>draw.push({type:'text',text:value,at:[x,y],size,color});
  text('Render stage palette review',width/2,22,18);
  for (const [i,name] of names.entries()) {
    const center=6+col*(i+.5), left=Math.floor(center-w/2), stage=report.stages[name];
    text(titles[i],center,52,12);
    if (stage.available) {
      layers.push({source:rasters[name],rect:[left,68,w,h]});
      text(stage.swatchCount+' visible swatches',center,h+82,10,dim);
      for (const [j,row] of stage.swatches.slice(0,7).entries())
        draw.push({type:'rect',rect:[center-63+j*18,h+94,17,13],color:row.swatch});
    } else text(!rasters[name] ? 'Indexed grading' : name==='base' ? 'No retained paint' : 'No visible samples',
      center,68+h/2,10,dim);
    const link=report.transitions.find(row=>row.to===name);
    if (link?.pairedPixels) {
      text(link.mergedSwatches+' merges',center,h+120,9,dim);
      text(link.hue.shiftedPixels+' hue shifts',center,h+135,9,dim);
    }
  }
  if (report.unexpectedFinal)
    text(report.unexpectedFinal.pixels+' final pixels outside allowed swatches',width/2,h+152,9,'#ffbe80');
  const plan=kit.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(18,25,37)},kit.frameComposite.layers(plan,{},0),width,height,'nearest');
}

function reviewPaletteStages(world,{select,allowed,hueThreshold=22,minChroma=.025,limit=12,...view}={}) {
  if (!Number.isFinite(hueThreshold) || hueThreshold<0 || hueThreshold>180 ||
      !Number.isFinite(minChroma) || minChroma<=0 || minChroma>1 ||
      !Number.isSafeInteger(limit) || limit<1 || limit>64)
    throw new RangeError('Palette stages needs a hue threshold, positive chroma floor and report limit from 1 to 64');
  if (view.raw) throw new RangeError('Palette stages needs a palette-enabled render');
  const time=view.time??view.t??world.lookSnapshot?.time??0;
  if (!Number.isFinite(time)) throw new RangeError('Palette stage time must be finite');
  const selection=select===undefined ? undefined : TargetSelectors.prepare(select);
  let permitted;
  if (allowed!==undefined) {
    if (!Array.isArray(allowed) || !allowed.length || allowed.length>4096 ||
        !Array.from(allowed).every(value=>typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value)))
      throw new TypeError('Allowed swatches need 1 to 4096 RGB hex colors');
    permitted=new Set(allowed.map(value=>parseInt(value.slice(1),16)));
  }
  const kit=require('../index.js').load().KIT;
  const frame=require('./render.js').render(world,{...view,time,t:time,captureColorStages:true,lookAudit:true,
    readabilitySelectors:selection && [selection],samples:false,captureCoverage:false,
    composite:false,renderGraph:false,renderHistory:undefined,inspection:false,cameraGuides:false});
  const {w,h,px}=frame;
  const rasters=Object.fromEntries(names.map(name=>[name,scoped(frame.colorStages[name],frame.readabilityMask)]));
  const stages=Object.fromEntries(names.map(name=>[name,summary(rasters[name],kit.palette.distributions,limit)]));
  const path=names.filter(name=>stages[name].available), transitions=[];
  for (let i=1;i<path.length;i++) {
    const from=path[i-1], to=path[i];
    transitions.push({from,to,...compareStages(rasters[from],rasters[to],{hueThreshold,minChroma,limit})});
  }
  const report={scene:world.id??null,time,width:w,height:h,pixelSize:px,select:selection??null,
    thresholds:{hueDegrees:hueThreshold,minChroma},stages,transitions,
    ...(permitted && {allowed:[...permitted].map(hex),unexpectedFinal:unexpected(rasters,permitted,limit)}),
    clipping:frame.lookAudit.clipping};
  return {rasters,report,image:preview(kit,rasters,report)};
}

module.exports = { reviewPaletteStages,compareStages };
