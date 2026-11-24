import { createRenderer } from './renderer.mjs';
import { makeCamera, cameraPose } from './view.mjs';
import { linkedPaint, linkedSymbol } from './linked-encoding-paint.mjs';
import { createViewerInput } from './viewer-input.mjs';

const theme = `
  :host{display:block;color:var(--ink);font:var(--ink-linked-font,14px system-ui,sans-serif);
    --surface:var(--ink-linked-surface,#132130);--ink:var(--ink-linked-text,#e4edf6);
    --muted:var(--ink-linked-muted,#9fb2c7);--line:var(--ink-linked-border,#2b3d50);
    --accent:var(--ink-linked-selection,#ffc477);background:var(--ink-linked-background,#0c151f);color-scheme:dark}
  *{box-sizing:border-box}
  .shell{max-width:1500px;margin:auto;padding:32px 34px 38px}
  h1,h2,p{margin:0}h1{font-size:clamp(27px,4vw,43px);letter-spacing:-.045em;line-height:1.1}
  h2{font-size:15px;letter-spacing:.015em}
  .top{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:22px}
  output,.meta,.small{color:var(--muted);font-size:12px}
  .toolbar{display:flex;align-items:end;gap:16px;padding:13px 15px;margin-bottom:17px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
  label{display:grid;gap:6px;font-size:12px;color:var(--muted)}
  .clock{flex:1;min-width:100px;max-width:540px}.clock span{display:flex;justify-content:space-between}
  input[type=range]{width:100%;accent-color:var(--accent);min-height:30px;margin:0}
  select,button{min-height:32px;background:var(--ink-linked-control,#192a3a);border:1px solid var(--ink-linked-control-border,#3a5167);color:var(--ink);border-radius:5px;font:inherit;padding:4px 10px}
  button{cursor:pointer}button:disabled{opacity:.42;cursor:default}
  .panels{display:grid;grid-template-columns:var(--ink-linked-columns,minmax(0,1.28fr) minmax(0,1fr));gap:16px}
  .panels:has(>section:only-child){grid-template-columns:1fr}
  section{min-width:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
  .panel-head{height:51px;padding:0 15px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line)}
  canvas{display:block;width:100%;height:var(--ink-linked-canvas-height,300px);touch-action:none}
  canvas[data-view=chart]{height:var(--ink-linked-chart-height,270px)}
  .table-wrap{height:var(--ink-linked-table-height,226px);overflow:auto}
  table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:13px}
  th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line)}
  th{position:sticky;top:0;background:var(--ink-linked-table-header,#192939);color:var(--muted);font-size:11px;font-weight:600}
  td:first-child button{padding:0 4px;min-height:22px;border:0;background:none;text-align:left}
  tr[data-selected=true]{background:var(--ink-linked-selected-row,#594634);color:var(--ink-linked-selected-text,#ffe0ab)}
  tr[data-selected=true] button{color:var(--ink-linked-selected-text,#ffe0ab)}
  .table-controls{height:44px;display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:6px 12px;border-top:1px solid var(--line)}
  .table-controls button{min-height:25px}
  .encoding-legend{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;padding:9px 12px;margin:0 0 14px;
    border:1px solid var(--line);border-radius:7px;background:var(--surface)}
  .encoding-legend strong{font-size:12px}
  .encoding-legend ul{display:flex;flex-wrap:wrap;gap:8px 16px;list-style:none;padding:0;margin:0}
  .encoding-legend li{display:flex;align-items:center;gap:5px;font-size:12px}
  [part~=pattern-swatch]{width:23px;height:20px;flex:none;display:inline-block;vertical-align:middle;touch-action:auto}
  .scale{margin:0;padding:9px 13px;border-top:1px solid var(--line);display:grid;gap:4px;font-size:12px}
  .scale>div{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}
  .scale dt{font-weight:600}.scale dd{margin:0;display:flex;gap:8px;color:var(--muted);font-variant-numeric:tabular-nums}
  .scale dd span:last-child::before{content:'–';padding-right:8px}
  :is(canvas,button):focus-visible{outline:2px solid var(--ink-linked-focus,#e8f3ff);outline-offset:-3px}
  button[aria-pressed=true]{text-decoration:underline;text-underline-offset:3px}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  [hidden]{display:none!important}
  @media(max-width:760px){.shell{padding:20px 14px}.panels{grid-template-columns:1fr}.toolbar,.top{flex-wrap:wrap}}
`;
const paintDefaults={ selection:'#ffc477',point:'#6cdadf',grid:'#263a4c',muted:'#9fb2c7',
  'plot-background':'#101b28','plot-font':'11px system-ui,sans-serif',playhead:'#d89445',series:'#527285',
  'pattern-fill':'#e8edf2','pattern-ink':'#26313c',focus:'#f4f8ff' };
const allPanels=['scene','map','chart','table'], roots=new WeakMap();
function plotStyle(canvas) {
  const style=canvas.ownerDocument.defaultView.getComputedStyle(canvas);
  return Object.fromEntries(Object.entries(paintDefaults)
    .map(([name,fallback])=>[name,style.getPropertyValue('--ink-linked-'+name).trim()||fallback]));
}
const finite = Number.isFinite;
const print = value => value == null ? '—' : Array.isArray(value) ? value.map(print).join(', ') :
  typeof value === 'number' ? Number(value.toFixed(2)).toString() : String(value);
const pickMode = event => event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
const canvasKeys={previous:'ArrowLeft',next:'ArrowRight',start:'Home',end:'End',select:'Enter',clear:'Escape'};
const modified=controls=>controls.flatMap(input=>[input,...['Shift','Control','Meta'].map(modifier=>({input,modifiers:[modifier]}))]);
const linkedBindings={records:{
  previous:['key:ArrowLeft','key:ArrowUp','pad:DPadLeft','pad:DPadUp'],
  next:['key:ArrowRight','key:ArrowDown','pad:DPadRight','pad:DPadDown'],
  start:['key:Home'],end:['key:End'],select:[...modified(['key:Enter','key:Space']),'pad:South'],
  clear:['key:Escape','pad:East'],point:modified(['mouse:Left','pen:Tip','touch:Contact'])
}};
const element = (doc, name, value) => {
  const el = doc.createElement(name);
  if (value !== undefined) el.textContent = value;
  return el;
};

function extent(points) {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of points)if(p.every(finite)){
    x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
  }
  if(x0===Infinity)return [[0,1],[0,1]];
  const expand=(a,b)=>a===b?[a-.5,a+.5]:[a,b];
  return [expand(x0,x1),expand(y0,y1)];
}
function vertices(shape, add) {
  if(!shape)return;
  if(shape.type==='GeometryCollection')return shape.geometries.forEach(child=>vertices(child,add));
  function read(values) {
    if(typeof values[0]==='number')add(values);
    else values.forEach(read);
  }
  read(shape.coordinates);
}
function viewport(canvas,style) {
  const width=Math.max(1,Math.round(canvas.clientWidth)),height=Math.max(1,Math.round(canvas.clientHeight));
  if(canvas.width!==width)canvas.width=width;
  if(canvas.height!==height)canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle=style['plot-background'];
  ctx.fillRect(0,0,width,height);
  ctx.font=style['plot-font'];
  return {ctx,width,height};
}

function plot(canvas, points, bounds, labels, time, { connect, color, brush, encoding, focusRow }) {
  const style=plotStyle(canvas), {selection,grid,muted,playhead,series}=style;
  const {ctx,width,height}=viewport(canvas,style), left=56,right=width-20,top=22,bottom=height-43;
  const paint=linkedPaint(ctx,style,encoding,color), [[x0,x1],[y0,y1]]=bounds;
  const x=v=>left+(v-x0)/(x1-x0)*(right-left), y=v=>bottom-(v-y0)/(y1-y0)*(bottom-top);
  ctx.strokeStyle=grid;
  ctx.fillStyle=muted;
  for(let i=0;i<=4;i++){
    const c=left+(right-left)*i/4, r=bottom-(bottom-top)*i/4;
    ctx.beginPath();ctx.moveTo(c,top);ctx.lineTo(c,bottom);ctx.moveTo(left,r);ctx.lineTo(right,r);ctx.stroke();
    ctx.textAlign='center';ctx.fillText(print(x0+(x1-x0)*i/4),c,bottom+17);
    ctx.textAlign='right';ctx.fillText(print(y0+(y1-y0)*i/4),left-8,r+3);
  }
  ctx.textAlign='center';ctx.fillText(labels[0],(left+right)/2,height-8);
  ctx.save();ctx.translate(14,(top+bottom)/2);ctx.rotate(-Math.PI/2);ctx.fillText(labels[1],0,0);ctx.restore();
  if(finite(time)&&time>=x0&&time<=x1){
    ctx.strokeStyle=playhead;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x(time),top);ctx.lineTo(x(time),bottom);ctx.stroke();ctx.setLineDash([]);
  }
  if(connect&&points.length>1){
    ctx.strokeStyle=series;ctx.beginPath();
    points.forEach((p,i)=>i?ctx.lineTo(x(p.x),y(p.y)):ctx.moveTo(x(p.x),y(p.y)));ctx.stroke();
  }
  const hits=points.map(p=>({...p,px:x(p.x),py:y(p.y)}));
  for(const p of [...hits].sort((a,b)=>Number(a.selected)-Number(b.selected))){
    const mark=encoding.mark(p.ref), size=mark?7:p.selected?6:3.4, path=new Path2D();
    linkedSymbol(path,p.px,p.py,size,mark?.symbol);
    paint.fill(path,mark||!p.selected?paint.tint(p.ref):selection,mark);
    if(mark){
      ctx.strokeStyle=style['pattern-ink'];ctx.stroke(path);
      if(mark.code){
        ctx.textAlign='left';ctx.fillStyle=style.focus;
        ctx.fillText(mark.code,p.px+size+4,p.py-5);
      }
    }
    if(p.selected){
      ctx.strokeStyle=selection;ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(p.px,p.py,mark?11:9,0,2*Math.PI);ctx.stroke();ctx.lineWidth=1;
    }
    if(p.ref.row===focusRow)focusBox(ctx,style,p.px,p.py,mark?14:12);
  }
  if(brush){
    const [a,b]=brush, x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(a[0]-b[0]),h=Math.abs(a[1]-b[1]);
    ctx.fillStyle=selection;ctx.globalAlpha=.15;ctx.fillRect(x,y,w,h);ctx.globalAlpha=1;
    ctx.strokeStyle=selection;ctx.strokeRect(x,y,w,h);
  }
  return hits;
}

function focusBox(ctx,style,x,y,r) {
  ctx.save();ctx.setLineDash([3,2]);ctx.strokeStyle=style.focus;ctx.lineWidth=1.5;
  ctx.strokeRect(x-r,y-r,r*2,r*2);ctx.restore();
}

function mapPlot(canvas, shapes, bounds, { color, encoding, focusRow }) {
  const style=plotStyle(canvas), {selection,grid}=style;
  const {ctx,width,height}=viewport(canvas,style), [[a,b],[c,d]]=bounds, margin=24;
  const paint=linkedPaint(ctx,style,encoding,color);
  const scale=Math.max(.001,Math.min((width-2*margin)/(b-a),(height-2*margin)/(d-c)));
  const toScreen=([x,y])=>[width*.5+(x-(a+b)*.5)*scale,height*.5-(y-(c+d)*.5)*scale];
  ctx.strokeStyle=grid;ctx.beginPath();
  for(let i=0;i<=8;i++){
    const x=width*i/8+.5,y=height*i/8+.5;
    ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.moveTo(0,y);ctx.lineTo(width,y);
  }
  ctx.stroke();
  const hits=[];
  function trace(shape, ref, selected) {
    if(shape.type==='GeometryCollection'){shape.geometries.forEach(child=>trace(child,ref,selected));return;}
    const p=new Path2D(), data=shape.coordinates, mark=encoding.mark(ref), anchors=[];
    function dot(point) {
      const [x,y]=toScreen(point);
      anchors.push([x,y]);
      linkedSymbol(p,x,y,mark?7:selected?6:4,mark?.symbol);
    }
    function track(row, close=false) {
      row.forEach((point,i)=>i?p.lineTo(...toScreen(point)):p.moveTo(...toScreen(point)));
      if(close)p.closePath();
    }
    function polygon(rows){rows.forEach(row=>track(row,true));}
    const draw={Point:dot,MultiPoint:rows=>rows.forEach(dot),LineString:track,MultiLineString:rows=>rows.forEach(row=>track(row)),
      Polygon:polygon,MultiPolygon:rows=>rows.forEach(polygon)};
    draw[shape.type]?.(data);
    const area=shape.type.includes('Polygon'), fill=area||shape.type.includes('Point');
    const tint=selected&&!mark?selection:paint.tint(ref);
    ctx.strokeStyle=selected?selection:fill&&mark?style['pattern-ink']:tint;
    ctx.lineWidth=selected?2.6:1.5;
    if(fill)paint.fill(p,tint,mark,{area});
    else paint.dash(mark);
    ctx.stroke(p);
    ctx.setLineDash([]);
    if(mark?.code && !anchors.length)vertices(shape,point=>{
      if(!anchors.length)anchors.push(toScreen(point));
    });
    for(const [x,y] of anchors){
      if(mark?.code){ctx.textAlign='left';ctx.fillStyle=style.focus;ctx.fillText(mark.code,x+10,y-6);}
      if(selected){ctx.strokeStyle=selection;ctx.beginPath();ctx.arc(x,y,11,0,2*Math.PI);ctx.stroke();}
      if(ref.row===focusRow)focusBox(ctx,style,x,y,14);
    }
    if(ref.row===focusRow&&!anchors.length){
      ctx.strokeStyle=style.focus;ctx.setLineDash([2,2]);ctx.lineWidth=2;ctx.stroke(p);ctx.setLineDash([]);
    }
    hits.push({p,ref,fill});
  }
  [...shapes].sort((a,b)=>Number(a.selected)-Number(b.selected)).forEach(row=>trace(row.geometry,row.ref,row.selected));
  return point=>{
    ctx.lineWidth=10;
    return hits.findLast(({p,fill})=>fill&&ctx.isPointInPath(p,...point,'evenodd')||ctx.isPointInStroke(p,...point))?.ref;
  };
}

function drawSwatch(doc,style,mark) {
  const canvas=element(doc,'canvas');
  canvas.width=23;canvas.height=20;
  canvas.setAttribute('aria-hidden','true');
  canvas.setAttribute('part','pattern-swatch');
  const ctx=canvas.getContext('2d'), path=new Path2D();
  linkedSymbol(path,11.5,10,8,mark.symbol);
  linkedPaint(ctx,style,{}).fill(path,style['pattern-fill'],mark);
  ctx.strokeStyle=style['pattern-ink'];ctx.stroke(path);
  return canvas;
}

function scaleEndpoints(doc,node,bounds,axes,names={}) {
  const rows=bounds.map(([min,max],i)=>{
    const line=element(doc,'div'), pair=element(doc,'dd');
    const [unit,description]=axes[i], defaults=description==='$time'?{min:'Start',max:'End'}:{min:'Min',max:'Max'};
    const labels=names[i===0?'x':'y']??{};
    for(const [key,value] of [['min',min],['max',max]]) {
      const text=(labels[key]??defaults[key])+' '+String(Number(value.toPrecision(10)));
      const end=element(doc,'span',text);
      end.setAttribute('part','scale-endpoint '+key+'-endpoint');
      pair.append(end);
    }
    line.append(element(doc,'dt',unit),pair);
    return line;
  });
  node.replaceChildren(...rows);
}

function ray(world, frame, canvas, [x,y]) {
  const camera=makeCamera(world,frame,canvas.width,canvas.height), {eye,right,up,back}=cameraPose(camera);
  const u=(2*x/canvas.clientWidth-1)*camera.tangent*camera.aspect,v=(1-2*y/canvas.clientHeight)*camera.tangent;
  const move=(origin,f)=>origin.map((n,i)=>n+(u*right[i]+v*up[i])*f);
  return camera.ortho?{ origin:move(eye,1).map((n,i)=>n-camera.clipNear*back[i]), direction:back.map(n=>-n),
    maxDistance:camera.clipFar-camera.clipNear }:
    { origin:move(eye,camera.clipNear).map((n,i)=>n-camera.clipNear*back[i]), direction:move(back.map(n=>-n),1),
      maxDistance:(camera.clipFar-camera.clipNear)*Math.hypot(1,u,v) };
}

/** Mount linked chart, scene, map, and table controls on one session. */
export function mountLinkedViews(host, { toolkit, session, chart, map={}, table={}, scene, title='Linked views',
  filterBy, timeRange=session?.timeRange, timeStep=.01, color, panels=allPanels, labels={}, controls={},
  stylesheet='', defaultStyles=true, encoding,input={} }={}) {
  if(!Array.isArray(panels)||!panels.length||new Set(panels).size!==panels.length||
    !Array.from(panels).every(name=>allPanels.includes(name))||typeof stylesheet!=='string'||typeof defaultStyles!=='boolean')
    throw new TypeError('Invalid linked panel layout or stylesheet');
  const has=name=>panels.includes(name), keyboard=controls.keyboard!==false;
  if(!session?.subscribe||has('chart')&&!chart||has('scene')&&(!scene?.world||!toolkit?.KIT))
    throw new TypeError('Linked panels need a session, chart axes for a chart, and a world and toolkit for a scene');
  if(timeRange&&(!Array.isArray(timeRange)||timeRange.length!==2||!timeRange.every(finite)||timeRange[1]<timeRange[0]||
    !finite(timeStep)||timeStep<=0))throw new TypeError('Invalid linked time range');
  const {columns}=session.description, rowsPerPage=table.pageSize??10;
  const fieldNames=table.columns??Object.keys(columns);
  if(filterBy&&!Object.hasOwn(columns,filterBy))throw new TypeError('Unknown filter column');
  if(has('table')&&(!fieldNames.length||!Number.isSafeInteger(rowsPerPage)||rowsPerPage<1||rowsPerPage>100))
    throw new TypeError('Invalid linked table columns or page size');
  const coding=session.encoding(encoding);
  if(has('chart'))session.chart(chart);
  if(has('map'))session.map(map);
  if(has('table'))session.table({columns:fieldNames,limit:1});
  const doc=host.ownerDocument, win=doc.defaultView, root=roots.get(host)??host.attachShadow({mode:'open'});
  if(root.childElementCount)throw new Error('This host already has mounted linked views');
  roots.set(host,root);
  root.innerHTML=`<div class="shell" part="shell">
    <header class="top" part="header"><h1 part="title"></h1><output class="summary" part="summary" aria-live="polite"></output></header>
    <div class="toolbar" part="toolbar"><label class="filter" part="filter"><span data-label="filter">Filter</span>
      <select part="filter-input" aria-label="Filter records"></select></label>
      <label class="clock" part="clock"><span><span data-label="time">Time</span><output part="time-value"></output></span>
        <input part="time-slider" type="range" aria-label="Scene time in seconds"></label>
      <button class="clear" part="clear-selection" data-label="clear">Clear selection</button></div>
    <div class="encoding-legend" part="encoding-legend"><strong id="encoding-title"></strong>
      <ul aria-labelledby="encoding-title" part="encoding-items"></ul></div>
    <p class="sr-only" id="keyboard-help" part="keyboard-help">Use arrow keys to move between records.
      Home and End jump to the first or last record. Press Enter or Space to select, or hold Shift to toggle selection. Press Escape to clear selection.</p>
    <output class="sr-only" role="status" aria-live="polite" part="record-status"></output>
    <div class="panels" part="panels">
      <section data-panel="scene" part="panel scene-panel"><div class="panel-head" part="panel-header"><h2 data-label="scene">Scene</h2>
        <span class="meta" part="panel-detail" data-label="world">World view</span></div>
        <canvas data-view="scene" part="canvas scene-canvas" aria-label="3D scene"></canvas></section>
      <section data-panel="map" part="panel map-panel"><div class="panel-head" part="panel-header"><h2 data-label="map">Map</h2>
        <span class="meta map-meta" part="panel-detail"></span></div>
        <canvas data-view="map" part="canvas map-canvas" aria-label="Spatial map"></canvas>
        <dl class="scale" id="map-scale" part="scale map-scale"></dl></section>
      <section data-panel="chart" part="panel chart-panel"><div class="panel-head" part="panel-header"><h2 data-label="chart">Chart</h2>
        <span class="meta chart-meta" part="panel-detail"></span></div>
        <canvas data-view="chart" part="canvas chart-canvas" aria-label="Data chart"></canvas>
        <dl class="scale" id="chart-scale" part="scale chart-scale"></dl></section>
      <section data-panel="table" part="panel table-panel"><div class="panel-head" part="panel-header"><h2 data-label="table">Records</h2>
        <span class="meta record-meta" part="panel-detail"></span></div>
        <div class="table-wrap" part="table-scroll"><table part="table" tabindex="-1">
          <caption class="sr-only" part="table-caption"></caption>
          <thead part="table-header"></thead><tbody part="table-body"></tbody></table></div>
        <div class="table-controls" part="pagination"><button class="prev" part="previous-page" aria-label="Previous records">‹</button>
          <span class="small page" part="page"></span><button class="next" part="next-page" aria-label="Next records">›</button></div></section>
    </div></div>`;
  if(defaultStyles)root.prepend(element(doc,'style',theme));
  if(stylesheet)root.append(element(doc,'style',stylesheet));
  const $=query=>root.querySelector(query), canvas=name=>$(`[data-view="${name}"]`);
  $('.panels').replaceChildren(...panels.map(name=>$(`[data-panel="${name}"]`)));
  $('h1').textContent=title;
  for(const node of root.querySelectorAll('[data-label]'))
    if(Object.hasOwn(labels,node.dataset.label))node.textContent=labels[node.dataset.label];
  const units=column=>column==='$time'?'Time · s':[column,columns[column]?.units].filter(Boolean).join(' · ');
  if(has('chart'))$('.chart-meta').textContent=units(chart.y);
  if(has('map'))$('.map-meta').textContent=map.coordinates?.join(' / ')??(map.plane??'xz').toUpperCase();
  $('#keyboard-help').hidden=!keyboard;
  const announce=$('[part="record-status"]');
  const legend=$('.encoding-legend');
  legend.hidden=controls.legend===false||!coding.entries.length;
  $('#encoding-title').textContent=labels.encoding??coding.category??'';
  let swatchTheme, swatchStyle;
  const swatchImages=new Map();
  function syncSwatches() {
    if(!coding.entries.length)return;
    const style=plotStyle(host), theme=style['pattern-fill']+'/'+style['pattern-ink'];
    if(theme===swatchTheme)return;
    swatchTheme=theme;swatchStyle=style;swatchImages.clear();
    if(!legend.hidden)legend.querySelector('ul').replaceChildren(...coding.entries.map(item=>{
      const li=element(doc,'li');
      li.setAttribute('part','encoding-item');
      li.append(drawSwatch(doc,style,item),element(doc,'span',item.code===undefined?item.label:item.code+' · '+item.label));
      return li;
    }));
  }
  function recordSwatch(mark) {
    const code=mark.pattern+'/'+mark.symbol;
    if(!swatchImages.has(code))swatchImages.set(code,drawSwatch(doc,swatchStyle,mark).toDataURL());
    const image=element(doc,'img');
    image.src=swatchImages.get(code);image.alt='';image.width=23;image.height=20;
    image.setAttribute('aria-hidden','true');image.setAttribute('part','pattern-swatch');
    return image;
  }
  const chartCanvas=canvas('chart'), mapCanvas=canvas('map'), sceneCanvas=canvas('scene');
  let renderer;
  try {
    if(sceneCanvas)renderer=createRenderer(sceneCanvas,{toolkit});
  } catch(error) {
    root.replaceChildren();
    throw error;
  }
  const filter=$('select'), slider=$('input');
  const filterValues=filterBy?Array.from(new Set(session.records.map(row=>row.record[filterBy])
    .filter(value=>['string','number','boolean'].includes(typeof value)))):[];
  $('.filter').hidden=!filterBy||controls.filter===false;
  const option=(text,value)=>{const row=element(doc,'option',text);row.value=value;filter.append(row);return row;};
  option(labels.allRecords??'All records','');
  filterValues.forEach((value,i)=>option(print(value),String(i)));
  const customFilter=option(labels.customFilter??'Custom filter','custom');
  customFilter.disabled=true;
  $('.clock').hidden=!timeRange||controls.time===false;
  $('.clear').hidden=controls.clear===false;
  $('.toolbar').hidden=['.filter','.clock','.clear'].every(name=>$(name).hidden);
  if(timeRange){
    slider.min=timeRange[0];slider.max=timeRange[1];slider.step=timeStep;
  }
  const chartBounds=chartCanvas&&extent(session.records.map(row=>[chart.x==='$time'?row.time:row.record[chart.x],row.record[chart.y]]));
  const mapPoints=[], indices={xy:[0,1],xz:[0,2],yz:[1,2]}[map.plane??'xz'];
  if(mapCanvas)for(const row of session.records) {
    if(map.coordinates)mapPoints.push(map.coordinates.map(name=>row.record[name]));
    else vertices(row.geometry,p=>mapPoints.push(indices.map(i=>p[i])));
  }
  const mapBounds=extent(mapPoints);
  if(chartCanvas){
    const node=$('#chart-scale');
    node.hidden=controls.scales===false;
    scaleEndpoints(doc,node,chartBounds,[[units(chart.x),chart.x],[units(chart.y),chart.y]],chart.scaleLabels);
  }
  if(mapCanvas){
    const node=$('#map-scale');
    node.hidden=controls.scales===false;
    const mapAxes=map.coordinates?map.coordinates.map(key=>[units(key),key]):
      Array.from((map.plane??'xz').toUpperCase(),key=>[key+' · world units',key]);
    scaleEndpoints(doc,node,mapBounds,mapAxes,map.scaleLabels);
  }
  const body=$('tbody');
  if(body){
    $('caption').textContent=table.caption??(labels.table??'Records');
    const head=element(doc,'tr');
    for(const key of fieldNames){
      const heading=element(doc,'th',units(key));
      heading.scope='col';
      head.append(heading);
    }
    $('thead').append(head);
  }
  let page=0,pending=0,inputFrame=0,stopped=false,drawn,source,linkedWorld,view,points=[],findMap=()=>undefined,brush,cursor;
  const panelInput={};
  function showRecord(ref) {
    cursor=ref.row;
    if(body)page=Math.floor(session.snapshot().visible.findIndex(row=>row.ref.row===cursor)/rowsPerPage);
  }
  const select=(ref,event)=>{
    if(!ref)return;
    showRecord(ref);
    session.update({selection:[ref],mode:pickMode(event)});
    schedule();
  };
  const position=(event,canvas)=>{const box=canvas.getBoundingClientRect();return [event.clientX-box.left,event.clientY-box.top];};
  const schedule=()=>{if(!pending&&!stopped)pending=win.requestAnimationFrame(render);};
  function candidateRefs(kind,snapshot) {
    if(kind==='chart')return session.chart(chart,snapshot).map(row=>row.ref);
    if(kind==='map')return session.map(map,snapshot).map(row=>row.ref);
    if(kind==='scene'){
      const marks=linkedWorld?.dataMarks?.list({limit:20000}).marks??[];
      const visible=new Set(marks.filter(mark=>mark.status==='visible'&&mark.source?.dataset===session.description.id)
        .map(mark=>mark.source.row));
      return snapshot.visible.filter(row=>visible.has(row.ref.row)).map(row=>row.ref);
    }
    return snapshot.visible.map(row=>row.ref);
  }
  function focusRecord(ref,refs) {
    if(!ref)return;
    showRecord(ref);
    const category=coding.mark(ref)?.label, selected=session.snapshot().selection.some(row=>row.row===cursor);
    announce.textContent=[coding.name(ref),category,'Record '+(refs.indexOf(ref)+1)+' of '+refs.length,
      selected?'Selected':'Unselected'].filter(Boolean).join('. ');
    schedule();
  }
  function navigate(event,kind,key=event.key) {
    const delta={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
    if(!Object.hasOwn(delta,key)&&!['Home','End','Enter',' ','Escape'].includes(key))return;
    const refs=candidateRefs(kind,session.snapshot());
    if(key==='Escape'){
      event.preventDefault();
      session.update({selection:[]});
      if(!refs.length)announce.textContent='No matching records in this view';
    }
    if(!refs.length)return;
    event.preventDefault();
    const current=refs.findIndex(ref=>ref.row===cursor);
    let index;
    if(Object.hasOwn(delta,key))index=current<0?0:Math.max(0,Math.min(refs.length-1,current+delta[key]));
    else index=key==='Home'?0:key==='End'?refs.length-1:Math.max(0,current);
    const ref=refs[index];
    if(key==='Enter'||key===' ')select(ref,event);
    focusRecord(ref,refs);
  }
  if(keyboard)for(const item of [chartCanvas,mapCanvas,sceneCanvas])if(item){
    const kind=item.dataset.view;
    item.tabIndex=0;
    item.setAttribute('aria-describedby',['keyboard-help',...((kind==='chart'||kind==='map')&&controls.scales!==false?[kind+'-scale']:[])].join(' '));
    if(!input?.[kind])item.onkeydown=event=>navigate(event,kind);
    item.onfocus=()=>{
      const refs=candidateRefs(kind,session.snapshot());
      const ref=refs.find(row=>row.row===cursor)??refs[0];
      if(ref)focusRecord(ref,refs);
      else announce.textContent='No matching records in this view';
    };
    item.onblur=schedule;
  }
  function render() {
    pending=0;
    if(stopped)return;
    const snapshot=session.snapshot(), {time,selection,visible}=snapshot;
    syncSwatches();
    $('.summary').textContent=visible.length+' / '+session.records.length+' records · '+selection.length+' selected';
    $('.clock output').textContent=print(time)+' s';
    slider.value=time;
    $('.clear').disabled=!selection.length;
    if(filterBy){
      const rule=snapshot.filter, i=rule?.path?.length===1&&rule.path[0]===filterBy&&(rule.op??'eq')==='eq'?
        filterValues.indexOf(rule.value):-1;
      customFilter.hidden=!rule||i>=0;
      filter.value=i>=0?String(i):rule?'custom':'';
    }
    const active=root.activeElement;
    const focusRow=keyboard&&(active?.dataset.view||body?.contains(active))?cursor:undefined;
    if(chartCanvas)points=plot(chartCanvas,session.chart(chart,snapshot),chartBounds,[units(chart.x),units(chart.y)],
      chart.x==='$time'?time:undefined,{connect:chart.connect,color,brush,encoding:coding,focusRow});
    if(mapCanvas)findMap=mapPlot(mapCanvas,session.map(map,snapshot),mapBounds,{color,encoding:coding,focusRow});
    if(body){
      page=Math.max(0,Math.min(page,Math.ceil(visible.length/rowsPerPage)-1));
      const rows=session.table({columns:fieldNames,offset:page*rowsPerPage,limit:rowsPerPage},snapshot);
      const focused=body.contains(active)?active.dataset.row:undefined;
      const tabStop=rows.rows.find(row=>row.ref.row===cursor)?.ref??rows.rows[0]?.ref;
      body.replaceChildren(...rows.rows.map(row=>{
        const tr=element(doc,'tr');
        tr.dataset.selected=row.selected;
        tr.setAttribute('part',row.selected?'row selected-row':'row');
        row.values.forEach((value,i)=>{
          const td=element(doc,'td');
          td.setAttribute('part','cell');
          if(i===0){
            const btn=element(doc,'button',print(value));
            btn.type='button';btn.setAttribute('part','record');btn.dataset.row=row.ref.row;btn.setAttribute('aria-pressed',String(row.selected));
            const mark=coding.mark(row.ref);
            if(mark)btn.prepend(recordSwatch(mark));
            if(mark?.code){
              const tag=element(doc,'span',mark.code+' ');
              tag.setAttribute('aria-hidden','true');
              btn.insertBefore(tag,btn.lastChild);
            }
            if(mark||coding.label!==undefined)btn.setAttribute('aria-label',[
              coding.label===undefined?print(value):coding.name(row.ref),mark?.label].filter(Boolean).join('. '));
            btn.onclick=event=>select(row.ref,event);
            if(keyboard){
              btn.tabIndex=row.ref===tabStop?0:-1;
              btn.onkeydown=event=>navigate(event,'table');
              btn.onfocus=()=>{
                if(cursor!==row.ref.row){cursor=row.ref.row;schedule();}
              };
            }
            td.append(btn);
          }else td.textContent=print(value);
          tr.append(td);
        });
        return tr;
      }));
      if(!rows.rows.length){
        const empty=element(doc,'tr'), cell=element(doc,'td',labels.empty??'No matching records');
        cell.colSpan=fieldNames.length;
        empty.append(cell);body.append(empty);
      }
      if(focused!==undefined){
        const row=body.querySelector(`button[data-row="${keyboard?tabStop?.row:focused}"]`);
        (row??$('table')).focus({preventScroll:true});
      }
      $('.record-meta').textContent=String(rows.total);
      $('.prev').disabled=page===0;$('.next').disabled=(page+1)*rowsPerPage>=rows.total;
      $('.page').textContent=rows.total?(page*rowsPerPage+1)+'–'+Math.min(rows.total,(page+1)*rowsPerPage):'0';
    }
    if(sceneCanvas){
      const width=Math.max(1,sceneCanvas.clientWidth), height=Math.max(1,sceneCanvas.clientHeight);
      if(drawn!==snapshot||view.width!==width||view.height!==height){
        if(drawn!==snapshot){
          source=typeof scene.world==='function'?scene.world(snapshot):scene.world;
          linkedWorld=session.scene(source,snapshot,{highlight:scene.highlight});
        }
        const frame=typeof scene.frame==='function'?scene.frame(snapshot):scene.frame;
        view={raw:true,...frame,time,width,height};
        renderer.render(linkedWorld,view);
        drawn=snapshot;
      }
    }
  }
  filter.onchange=()=>{
    page=0;
    session.update({filter:filter.value===''?null:{path:[filterBy],value:filterValues[Number(filter.value)]}});
  };
  slider.oninput=()=>session.update({time:Number(slider.value)});
  $('.clear').onclick=()=>session.update({selection:[]});
  if(has('table')){
    $('.prev').onclick=()=>{page--;schedule();};
    $('.next').onclick=()=>{page++;schedule();};
  }
  function beginBrush(at){brush=[at,at];}
  function updateBrush(at){if(brush){brush[1]=at;schedule();}}
  function cancelBrush(){brush=undefined;schedule();}
  function finishBrush(event){
      if(!brush)return;
      const [a]=brush,b=position(event,chartCanvas);brush=undefined;
      if(Math.hypot(a[0]-b[0],a[1]-b[1])>5){
        const refs=points.filter(p=>p.px>=Math.min(a[0],b[0])&&p.px<=Math.max(a[0],b[0])&&p.py>=Math.min(a[1],b[1])&&p.py<=Math.max(a[1],b[1])).map(p=>p.ref);
        session.update({selection:refs,mode:pickMode(event)});
      } else {
        let best=10,ref;
        for(const p of points){
          const distance=Math.hypot(p.px-b[0],p.py-b[1]);
          if(distance<best){best=distance;ref=p.ref;}
        }
        select(ref,event);
      }
      schedule();
  }
  if(chartCanvas&&!input?.chart){
    chartCanvas.onpointerdown=event=>{
      if(event.button!==0)return;
      beginBrush(position(event,chartCanvas));
      chartCanvas.setPointerCapture(event.pointerId);
    };
    chartCanvas.onpointermove=event=>updateBrush(position(event,chartCanvas));
    chartCanvas.onpointercancel=cancelBrush;
    chartCanvas.onpointerup=finishBrush;
  }
  const pickMap=event=>select(findMap(position(event,mapCanvas)),event);
  const pickScene=event=>{
    if(linkedWorld&&view)session.pick(renderer.pick(linkedWorld,ray(linkedWorld,view,sceneCanvas,position(event,sceneCanvas)),view).dominant,
      {mode:pickMode(event)});
  };
  if(mapCanvas&&!input?.map)mapCanvas.onclick=pickMap;
  if(sceneCanvas&&!input?.scene)sceneCanvas.onclick=pickScene;
  function watchInput(){
    if(!inputFrame&&!stopped)inputFrame=win.requestAnimationFrame(()=>{
      inputFrame=0;
      let focused=false;
      for(const controller of Object.values(panelInput))focused=controller.poll().focused||focused;
      if(focused)watchInput();
    });
  }
  try {
    for(const [kind,surface] of Object.entries({chart:chartCanvas,map:mapCanvas,scene:sceneCanvas})){
      const options=input?.[kind];
      if(!surface||!options)continue;
      let gesture;
      panelInput[kind]=createViewerInput(surface,{contexts:linkedBindings,...options,toolkit,
        onFocus(focused){if(focused)watchInput();options.onFocus?.(focused);},
        onAction(row){
          const key=Object.hasOwn(canvasKeys,row.action)&&canvasKeys[row.action];
          if(key&&(row.phase==='press'||row.phase==='repeat')){
            const {shiftKey,ctrlKey,metaKey}=row.event??{};
            navigate({shiftKey,ctrlKey,metaKey,preventDefault(){}},kind,key);
          }
          options.onAction?.(row);
        },
        onPointer(row){
          if(row.action==='point'){
            if(row.phase==='start'&&gesture===undefined){
              gesture=row.id;
              if(kind==='chart')beginBrush(row.point);
            }else if(gesture===row.id){
              if(row.phase==='move'&&kind==='chart')updateBrush(row.point);
              if(row.phase==='cancel'||row.phase==='end'){
                gesture=undefined;
                if(kind==='chart')row.phase==='end'?finishBrush(row.event):cancelBrush();
                else if(row.phase==='end')(kind==='map'?pickMap:pickScene)(row.event);
              }
            }
          }
          options.onPointer?.(row);
        }
      });
    }
  } catch(error) {
    stopped=true;
    for(const controller of Object.values(panelInput))controller.dispose();
    win.cancelAnimationFrame(inputFrame);win.cancelAnimationFrame(pending);
    renderer?.dispose();root.replaceChildren();throw error;
  }
  const stop=session.subscribe(schedule);
  const resize=new win.ResizeObserver(schedule);
  resize.observe(host);
  for(const item of [chartCanvas,mapCanvas,sceneCanvas])if(item)resize.observe(item);
  return Object.freeze({input:Object.freeze(panelInput),render(){
    win.cancelAnimationFrame(pending);
    drawn=undefined;
    render();
  },destroy(){
    if(stopped)return;
    stopped=true;stop();resize.disconnect();
    win.cancelAnimationFrame(pending);win.cancelAnimationFrame(inputFrame);
    for(const controller of Object.values(panelInput))controller.dispose();
    renderer?.dispose();root.replaceChildren();
  }});
}
