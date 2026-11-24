const Color = require('../src/color-space.js');
const TargetSelectors = require('../src/target-selectors.js');
const FrameComposite = require('../src/frame-composite.js');

const defaults = Object.freeze({color:.09,lightness:.055,weakShare:.25,depthBias:.05});
const cameraFields = ['yaw','pitch','dist','zoom','target','ortho','cameraShot'];
const lightFields = ['skyTime','skyProfiles','skyEnvironment','liveSun','areaLights'];
const weatherFields = ['weatherBinding','retainedWeather','weatherFronts','weatherTracks','precipitation',
  'atmosphere','shapedAtmosphere','atmosphereDepthBands'];
const tones = ['#81dac1','#9cafff','#ffc372','#ff777f'];
const packed = (rgb,p) => rgb[p*3]*65536 + rgb[p*3+1]*256 + rgb[p*3+2];
const hex = color => '#'+color.toString(16).padStart(6,'0');
const bytes = color => [color>>16,color>>8&255,color&255];
const integer = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
const swatch = value => typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value);
const record = value => value && Object.getPrototypeOf(value)===Object.prototype;
const unit = n => Number.isFinite(n) && n>=0 && n<=1;

function fields(value, valid, label) {
  if (!record(value) || Object.keys(value).some(key=>!valid.includes(key)))
    throw new TypeError('Invalid '+label);
  return value;
}

function list(rows, limit, validate, label) {
  if (!Array.isArray(rows) || !integer(rows.length,1,limit))
    throw new RangeError('Readability review needs 1–'+limit+' '+label);
  const ids=new Set();
  return Array.from(rows,row=>{
    const prepared=validate(row);
    if (!TargetSelectors.name(prepared.id) || prepared.id.length>64 || ids.has(prepared.id))
      throw new TypeError('Readability '+label+' need unique names of up to 64 characters');
    ids.add(prepared.id);
    return prepared;
  });
}

function prepareReview(plan, time) {
  fields(plan,['subjects','views','states','thresholds','matte'],'readability review plan');
  const subjects=list(plan.subjects,8,row=>{
    const {id,select}=fields(row,['id','select'],'readability subject');
    return {id,select:TargetSelectors.prepare(select)};
  },'subjects');
  const views=list(plan.views??[{id:'Authored view'}],32,row=>{
    const {id,...camera}=fields(row,['id',...cameraFields],'readability camera');
    for (const [key,value] of Object.entries(camera)) {
      const valid=key==='target' ? Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite) :
        key==='ortho' ? typeof value==='boolean' : key==='cameraShot' ? TargetSelectors.name(value) :
          Number.isFinite(value) && (!['dist','zoom'].includes(key) || value>0);
      if (!valid) throw new RangeError('Invalid readability camera '+key);
    }
    return {id,camera};
  },'views');
  const states=list(plan.states??[{id:'Current lighting',time}],24,row=>{
    const {id,time:t=time,lighting={},weather}=fields(row,['id','time','lighting','weather'],'readability state');
    fields(lighting,lightFields,'readability lighting overrides');
    if (weather!==undefined) fields(weather,weatherFields,'review weather overrides');
    if (!Number.isFinite(t) || t<0 || lighting.skyTime!==undefined && !Number.isFinite(lighting.skyTime))
      throw new RangeError('Readability states need finite scene and sky times');
    return {id,time:t,lighting,...(weather!==undefined && {weather})};
  },'states');
  const thresholds={...defaults,...fields(plan.thresholds??{},Object.keys(defaults),'readability thresholds')};
  const {color,lightness,weakShare,depthBias}=thresholds, {matte}=plan;
  if (![color,lightness,weakShare].every(unit) || !Number.isFinite(depthBias) || depthBias<0 ||
      matte!==undefined && !swatch(matte))
    throw new RangeError('Readability needs valid contrast thresholds, depth bias and an optional hex matte');
  return {subjects,views,states,thresholds,matte};
}

function compositeMatte(frame, matte) {
  if (!frame.alpha || !matte) return frame;
  const rgb=frame.rgb.slice(), back=bytes(parseInt(matte.slice(1),16));
  for (let p=0;p<frame.alpha.length;p++) {
    const opacity=frame.alpha[p]/255;
    for (let k=0;k<3;k++) rgb[p*3+k]=Math.round(rgb[p*3+k]*opacity + back[k]*(1-opacity));
  }
  return { ...frame,rgb,alpha:undefined };
}

const percentile = values => {
  if (!values.length) return null;
  let sum=0;
  for (const value of values) sum+=value;
  values.sort((a,b)=>a-b);
  return {min:values[0],p10:values[Math.floor((values.length-1)*.1)],mean:sum/values.length};
};

function measure(frame, subjects, thresholds, matte, indices=subjects.map((_,i)=>i)) {
  const sample=compositeMatte(frame,matte), {w,h,rgb,alpha}=sample;
  const {readabilityMask,passes:{depth}}=frame, cache=new Map();
  const count=w*h, overlay=new Uint8Array(count);
  function lab(color) {
    if (cache.has(color)) return cache.get(color);
    const value=Color.toOKLab(bytes(color).map(n=>n/255));
    if (cache.size<8192) cache.set(color,value);
    return value;
  }
  const point=(p,color)=>({x:p%w,y:Math.floor(p/w),swatch:hex(color)});
  const rows=indices.map(index=>{
    const subject=subjects[index];
    const bit=1<<index, owns=p=>(readabilityMask[p]&bit)!==0 && frame.alpha?.[p]!==0;
    const colorDistances=[], lightnessDistances=[];
    let pixels=0, boundaryPixels=0, croppedEdges=0, occludedEdges=0, transparentEdges=0;
    let weakColor=0, weakLightness=0, lighter=0, darker=0, worstColor=null, worstLightness=null;
    let left=w, top=h, right=-1, bottom=-1;
    function edge(p,q) {
      if (q<0) { croppedEdges++; return; }
      if (owns(q)) return;
      if (frame.alpha?.[q]!==0 && depth[q]+thresholds.depthBias<depth[p]) { occludedEdges++; return; }
      if (alpha && (alpha[p]!==255 || alpha[q]!==255)) { transparentEdges++; return; }
      const a=packed(rgb,p), b=packed(rgb,q), A=lab(a), B=lab(b);
      const signed=A[0]-B[0], lightnessDistance=Math.abs(signed);
      const colorDistance=Math.hypot(signed,A[1]-B[1],A[2]-B[2]);
      colorDistances.push(colorDistance);
      lightnessDistances.push(lightnessDistance);
      if (signed>0) lighter++;
      if (signed<0) darker++;
      const colorWeak=colorDistance<thresholds.color, lightnessWeak=lightnessDistance<thresholds.lightness;
      if (colorWeak) weakColor++;
      if (lightnessWeak) weakLightness++;
      const colorMinimum=!worstColor || colorDistance<worstColor.colorDistance;
      const lightnessMinimum=!worstLightness || lightnessDistance<worstLightness.lightnessDistance;
      if (colorMinimum || lightnessMinimum) {
        const pair={subject:point(p,a),background:point(q,b),colorDistance,lightnessDistance,signedLightness:signed};
        if (colorMinimum) worstColor=pair;
        if (lightnessMinimum) worstLightness=pair;
      }
      const rank=1+Number(colorWeak)+2*Number(lightnessWeak);
      overlay[p]=Math.max(overlay[p],rank);
    }
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const p=y*w+x;
      if (!owns(p)) continue;
      pixels++;
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
      const previous=colorDistances.length;
      edge(p,x?p-1:-1);
      edge(p,x+1<w?p+1:-1);
      edge(p,y?p-w:-1);
      edge(p,y+1<h?p+w:-1);
      if (colorDistances.length>previous) boundaryPixels++;
    }
    const samples=colorDistances.length, flags=[];
    const weakColorShare=samples ? weakColor/samples : null;
    const weakLightnessShare=samples ? weakLightness/samples : null;
    if (!pixels) flags.push('not-visible');
    else if (!samples) flags.push('no-background-samples');
    if (croppedEdges) flags.push('clipped');
    if (weakColor && weakColorShare>=thresholds.weakShare) flags.push('weak-color');
    if (weakLightness && weakLightnessShare>=thresholds.weakShare) flags.push('weak-lightness');
    return { ...subject,pixels,boundaryPixels,samples,croppedEdges,occludedEdges,transparentEdges,
      bounds:pixels ? {x:left,y:top,width:right-left+1,height:bottom-top+1} : null,
      color:percentile(colorDistances),lightness:percentile(lightnessDistances),
      weakColor,weakLightness,weakColorShare,weakLightnessShare,lighter,darker,worstColor,worstLightness,flags };
  });
  const marked=rgb.slice(), colors=tones.map(tone=>bytes(parseInt(tone.slice(1),16)));
  for (let p=0;p<count;p++) {
    if (overlay[p]) marked.set(colors[overlay[p]-1],p*3);
    else for (let k=0;k<3;k++) marked[p*3+k]=Math.round(14+marked[p*3+k]*.49);
  }
  return {subjects:rows,frame:{w,h,rgb,alpha},marked:{w,h,rgb:marked,alpha}};
}

function dimensions(w,h,samples,columns) {
  const cellWidth=Math.max(164,w)+8, cellHeight=2*h+58;
  return { w:16+columns*cellWidth,h:69+Math.ceil(samples/columns)*cellHeight,cellWidth,cellHeight };
}

const edgeLegend = ['Clear edge','Low color','Low lightness','Both low'].map((label,i)=>[label,tones[i]]);

function sheet(kit, tiles, layout, columns, {title='Subject readability',subtitle='Scene / edge evidence',legend=edgeLegend}={}) {
  const {w,cellWidth,cellHeight}=layout, draw=[], layers=[];
  const across=Math.min(legend.length,Math.max(2,Math.floor(w/108)));
  const lines=Math.ceil(legend.length/across), h=layout.h+Math.max(0,lines-2)*12;
  const label=(text,x,y,size,color='#e2ebf6')=>draw.push({type:'text',text,at:[x,y],size,color});
  label(title,w/2,19,16);
  label(subtitle,w/2,39,10,'#a5b6ca');
  for (const [i,row] of tiles.entries()) {
    const { frame,marked,result }=row, x=8+(i%columns)*cellWidth+(cellWidth-frame.w)/2;
    const top=49+Math.floor(i/columns)*cellHeight, mid=x+frame.w/2;
    const flags=result.findings??result.subjects.flatMap(subject=>subject.flags);
    label(result.view.slice(0,17),mid,top+8,10);
    label(result.state.slice(0,17),mid,top+24,9,'#a5b6ca');
    layers.push({source:frame,rect:[Math.floor(x),top+34,frame.w,frame.h]},
      {source:marked,rect:[Math.floor(x),top+39+frame.h,frame.w,frame.h]});
    label(result.status ?? (result.isBaseline ? 'Baseline' : flags.length ? flags.length+(flags.length===1 ? ' flag' : ' flags') : 'Clear'),
      mid,top+48+2*frame.h,9,
      flags.length ? '#ffb282' : '#81dac1');
  }
  for (const [i,[text,color]] of legend.entries()) {
    const row=Math.floor(i/across), items=Math.min(across,legend.length-row*across);
    const x=(i%across+.5)*w/items;
    label(text,x,h-10-(lines-row-1)*12,9,color);
  }
  const plan=kit.frameComposite.prepare({layers:[...layers,{draw}]},w,h,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(17,24,36)},kit.frameComposite.layers(plan,{},0),w,h,'nearest');
}

function overview(subjects, samples) {
  return subjects.map(({id},i)=>{
    let weakColor=null, weakLightness=null, flagged=0, notVisible=0, measured=0;
    for (const {view,state,subjects} of samples) {
      const row=subjects[i];
      if (row.flags.length) flagged++;
      if (!row.pixels) notVisible++;
      if (!row.samples) continue;
      measured++;
      if (!weakColor || row.color.p10<weakColor.p10) weakColor={view,state,p10:row.color.p10};
      if (!weakLightness || row.lightness.p10<weakLightness.p10) weakLightness={view,state,p10:row.lightness.p10};
    }
    return {id,measured,flagged,notVisible,weakestColor:weakColor,weakestLightness:weakLightness};
  });
}

function captureReview(world,{subjects,views,states,thresholds,matte},
  {width=160,height=96,view={},columns,pose,fixedCameraAt},
  analyze=(frame,subjects,thresholds,matte)=>measure(frame,subjects,thresholds,matte)) {
  const px=view.px??1, w=Math.ceil(width/px), h=Math.ceil(height/px), count=views.length*states.length;
  columns??=Math.min(views.length,4);
  if (!integer(px,1,2048) || !integer(width,1,2048) || !integer(height,1,2048) || !integer(columns,1,12) ||
      !integer(count,1,64) || pose!==undefined && typeof pose!=='function')
    throw new RangeError('Readability review needs valid dimensions, up to 64 samples, and an optional pose callback');
  const layout=dimensions(w,h,count,columns);
  if (layout.w*layout.h>32e6) throw new RangeError('Readability review exceeds its sheet pixel budget');
  if (world.anim?.stateful && !pose) throw new TypeError('A stateful scene needs a pose callback for readability review');
  const {render}=require('./render.js'), kit=require('../index.js').load().KIT;
  const fixed=fixedCameraAt===undefined ? {} : { cameraTime:fixedCameraAt,lockCamera:true,
    ...(!world.cameraRig && {camera:{...world.cam,target:Array.from(world.cam.target),...view.camera}}) };
  const tiles=new Array(count), selectors=subjects.map(subject=>subject.select);
  const schedule=states.map((state,index)=>({state,index})).sort((a,b)=>a.state.time-b.state.time || a.index-b.index);
  let last;
  for (const {state,index} of schedule) {
    const {time}=state;
    if (last!==time) {
      if (pose) pose(world,time);
      else world.anim?.update?.(last===undefined ? 0 : time-last,time);
      last=time;
    }
    for (const [i,shot] of views.entries()) {
      let captured;
      const frame=render(world,{...view,...fixed,...state.lighting,...state.weather,...shot.camera,t:time,time,w:width,h:height,px,
        composite:false,renderGraph:false,renderHistory:undefined,inspection:false,cameraGuides:false,
        samples:false,captureCoverage:false,readabilitySelectors:selectors,passes:['depth'],
        shotFrame(info) { captured=info; view.shotFrame?.(info); }});
      const sample={view:shot.id,state:state.id,time,camera:captured.camera,skyTime:captured.skyTime};
      const {frame:scene,marked,...evidence}=analyze(frame,subjects,thresholds,matte,kit,sample);
      tiles[index*views.length+i]={frame:scene,marked,result:{...sample,...evidence}};
    }
  }
  return {kit,tiles,layout,columns,frame:{width:w,height:h,pixelSize:px},samples:tiles.map(row=>row.result)};
}

function reviewSubjectReadability(world,options={}) {
  const {plan=world.readabilityReview,view={}}=options;
  const {subjects,views,states,thresholds,matte}=prepareReview(plan,view.time??view.t??world.lookSnapshot?.time??0);
  const {kit,tiles,layout,columns,frame,samples}=captureReview(world,{subjects,views,states,thresholds,matte},options);
  return {image:sheet(kit,tiles,layout,columns),report:{scene:world.id??null,...frame,
    metric:{color:'oklab-distance',lightness:'oklab-lightness-difference'},thresholds,
    ...(matte && {matte}),views,states,samples,subjects:overview(subjects,samples),
    legend:{clear:tones[0],weakColor:tones[1],weakLightness:tones[2],weakBoth:tones[3]}}};
}

module.exports = { reviewSubjectReadability,measure,prepareReview,captureReview,sheet,edgeLegend };
