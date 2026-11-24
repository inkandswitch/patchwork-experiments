import { createComparisonRenderer } from './comparison-renderer.mjs';
import { createViewerInput } from './viewer-input.mjs';

const themes = `
  :host{display:block;color:var(--ink-compare-text,#edf2f7);background:var(--ink-compare-background,#111925);
    font:var(--ink-compare-font,14px system-ui,sans-serif);color-scheme:dark}
  *{box-sizing:border-box}
  .shell{max-width:1500px;margin:auto;padding:28px 32px 32px}
  h1{margin:0 0 16px;font-size:clamp(24px,4vw,40px);line-height:1.05;letter-spacing:-.045em}
  :is(nav,footer){display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  nav{padding:10px;margin-bottom:12px;background:var(--ink-compare-control,#1c2a3b);border-radius:6px}
  :is(button,select){color:inherit;background:var(--ink-compare-background,#111925);font:inherit;min-height:30px;
    padding:0 9px;border:1px solid var(--ink-compare-border,#52657e);border-radius:4px}
  :is(input,button,select){accent-color:var(--ink-compare-accent,#ffc27e)}
  label.time{display:flex;align-items:center;gap:8px;flex:1;min-width:135px}
  .time input{flex:1}
  output{min-width:66px;text-align:right;font-variant-numeric:tabular-nums}
  .stage{position:relative;isolation:isolate;overflow:hidden;border:1px solid var(--ink-compare-border,#52657e);border-radius:7px}
  canvas{display:block;width:100%;height:var(--ink-compare-height,440px)}
  canvas[data-orbit]{cursor:grab;touch-action:none}
  canvas:focus-visible{outline:3px solid var(--ink-compare-accent,#ffc27e);outline-offset:-3px}
  .source{position:absolute;inset-block-start:11px;padding:5px 8px;border-radius:3px;pointer-events:none;
    color:var(--ink-compare-source-text,#f6f9ff);background:var(--ink-compare-source,#172232e8)}
  .left{inset-inline-start:11px}.right{inset-inline-end:11px}
  .stage[data-mode=side-by-side] .right{inset-inline-start:calc(50% + 11px);inset-inline-end:auto}
  .divider{position:absolute;touch-action:none;z-index:1;color:var(--ink-compare-divider,#fff)}
  .stage[data-axis=x] .divider{top:0;bottom:0;width:24px;transform:translateX(-50%);cursor:ew-resize}
  .stage[data-axis=y] .divider{left:0;right:0;height:24px;transform:translateY(-50%);cursor:ns-resize}
  .divider::before,.divider::after{content:"";position:absolute;background:currentColor}
  .divider::before{top:0;bottom:0;left:calc(50% - 1px);width:2px}
  .stage[data-axis=y] .divider::before{left:0;right:0;top:calc(50% - 1px);height:2px;width:auto}
  .divider::after{width:18px;height:18px;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);
    border:5px double var(--ink-compare-background,#111925)}
  .divider:focus-visible{outline:3px solid var(--ink-compare-accent,#ffc27e);outline-offset:-3px}
  footer{justify-content:center;padding-top:11px;color:var(--ink-compare-muted,#afc0d3);font-size:12px}
  footer i{display:inline-block;width:11px;height:11px;margin-right:4px;vertical-align:-1px;border-radius:2px}
  [hidden]{display:none!important}
  @media(max-width:640px){.shell{padding:16px 12px}canvas{height:var(--ink-compare-height,340px)}}
`;
const roots = new WeakMap(), labelsDefault = {
  title:'Comparison',left:'Reference',right:'Comparison',play:'Play',pause:'Pause',time:'Time',
  mode:'View',axis:'Swipe axis',side:'Side by side',swipe:'Swipe',difference:'Signed difference',
  x:'Horizontal',y:'Vertical',negative:'Decrease',positive:'Increase',divider:'Swipe divider'
};
const clamp = (n,min,max)=>Math.min(max,Math.max(min,n));
const drag=['mouse:Left','pen:Tip','touch:Contact'];
const signed=(input,scale)=>({input,scale});
const cameraBindings={camera:{
  orbit:drag,
  yaw:[signed('key:ArrowLeft',-1),'key:ArrowRight',{input:'pad:RightX',deadZone:.2}],
  pitch:['key:ArrowUp',signed('key:ArrowDown',-1),{input:'pad:RightY',deadZone:.2,scale:-1}]
}};
const shift=inputs=>inputs.map(input=>({input,modifiers:['Shift']}));
const previous=['key:ArrowLeft','key:ArrowUp'], next=['key:ArrowRight','key:ArrowDown'];
const dividerBindings={divider:{
  drag,previous:[...previous,'pad:DPadLeft','pad:DPadUp'],next:[...next,'pad:DPadRight','pad:DPadDown'],
  'previous-fast':shift(previous),'next-fast':shift(next),start:['key:Home'],end:['key:End']
}};

/** Opt-in controls for a comparison session and a pair of native scenes. */
export function mountComparisonView(host,{
  toolkit,session,left,right,labels={},controls={},stylesheet='',defaultStyles=true,input={}
}={}) {
  const api=toolkit?.KIT?.comparison;
  if(!api||!session?.subscribe||!left?.world||!right?.world||typeof stylesheet!=='string'||typeof defaultStyles!=='boolean')
    throw new TypeError('Comparison view needs a toolkit, session, two worlds and valid stylesheet options');
  const text={...labelsDefault,...labels};
  const doc=host.ownerDocument, win=doc.defaultView, root=roots.get(host)??host.attachShadow({mode:'open'});
  if(root.childElementCount)throw new Error('This host already has a mounted comparison');
  roots.set(host,root);
  root.innerHTML=`<div class="shell" part="shell">
    <h1 part="title" data-label="title"></h1>
    <nav part="toolbar">
      <button type="button" data-control="play" part="playback"></button>
      <label class="time" data-control="time" part="timeline">
        <span data-label="time"></span><input type="range" step="any" part="scrubber">
        <output part="time-value"></output></label>
      <label data-control="mode" part="mode-control"><span data-label="mode"></span>
        <select part="mode"><option value="side-by-side" data-label="side"></option>
          <option value="swipe" data-label="swipe"></option><option value="difference" data-label="difference"></option></select></label>
      <label data-control="axis" part="axis-control"><span data-label="axis"></span>
        <select part="axis"><option value="x" data-label="x"></option><option value="y" data-label="y"></option></select></label>
    </nav>
    <div class="stage" part="stage">
      <canvas part="canvas"></canvas><span class="source left" data-label="left" part="source left-label"></span>
      <span class="source right" data-label="right" part="source right-label"></span>
      <div class="divider" part="divider" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"></div>
    </div>
    <footer part="legend"><span><i part="negative-swatch"></i><span data-label="negative"></span></span>
      <span><i part="positive-swatch"></i><span data-label="positive"></span></span></footer>
  </div>`;
  function style(css,first) {
    const node=doc.createElement('style');
    node.textContent=css;
    if(first)root.prepend(node);
    else root.append(node);
  }
  if(defaultStyles)style(themes,true);
  if(stylesheet)style(stylesheet,false);
  const $=selector=>root.querySelector(selector), named=part=>$('[part="'+part+'"]');
  for(const node of root.querySelectorAll('[data-label]'))node.textContent=text[node.dataset.label];
  const stage=named('stage'), canvas=named('canvas'), divider=named('divider'), toolbar=named('toolbar');
  const play=named('playback'), time=named('scrubber'), mode=named('mode'), axis=named('axis');
  const legend=named('legend');
  named('title').hidden=!text.title;
  divider.setAttribute('aria-label',text.divider);
  canvas.setAttribute('aria-label',text.left+' / '+text.right);
  if(controls.camera!==false)canvas.dataset.orbit='';
  let renderer;
  try { renderer=createComparisonRenderer(canvas,{toolkit}); }
  catch(error){root.replaceChildren();throw error;}

  let capture,camera,pending=0,destroyed=false,lost=false,lastTick,lastInput,orbit,canvasInput,dividerInput,dirty=true;
  function requestFrame() {
    if(!pending&&!destroyed&&!lost)pending=win.requestAnimationFrame(tick);
  }
  function schedule() {
    dirty=true;
    requestFrame();
  }
  function paint(snapshot) {
    if(destroyed||lost)return;
    const { time:seconds,range,playing,mode:viewMode,axis:direction,divider:at,difference }=snapshot;
    stage.dataset.mode=viewMode;
    stage.dataset.axis=direction;
    divider.hidden=viewMode!=='swipe'||controls.divider===false;
    divider.style.left=direction==='x'?100*at+'%':'';
    divider.style.top=direction==='y'?100*at+'%':'';
    divider.setAttribute('aria-valuenow',String(Math.round(at*100)));
    divider.setAttribute('aria-orientation',direction==='x'?'horizontal':'vertical');
    mode.value=viewMode;
    axis.value=direction;
    time.min=range[0];time.max=range[1];time.value=seconds;
    named('time-value').textContent=seconds.toFixed(2)+' s';
    play.textContent=playing?text.pause:text.play;
    toolbar.hidden=true;
    for(const node of toolbar.querySelectorAll('[data-control]')) {
      node.hidden=controls[node.dataset.control]===false || node.dataset.control==='axis'&&viewMode!=='swipe';
      if(!node.hidden)toolbar.hidden=false;
    }
    $('.left').hidden=controls.sourceLabels===false||viewMode==='difference';
    $('.right').hidden=$('.left').hidden;
    legend.hidden=controls.legend===false||viewMode!=='difference';
    named('negative-swatch').style.backgroundColor=difference.negative;
    named('positive-swatch').style.backgroundColor=difference.positive;
    const width=Math.max(viewMode==='side-by-side'?2:1,canvas.clientWidth), height=Math.max(1,canvas.clientHeight);
    const viewport={width,height}, view=api.dimensions(width,height,viewMode);
    if(!capture||capture.width!==view.width||capture.height!==view.height||capture.time!==seconds||
      capture.camera!==snapshot.camera||capture.cameraSource!==snapshot.cameraSource) {
      camera=renderer.capture({left,right},snapshot,viewport);
      capture={...view,time:seconds,camera:snapshot.camera,cameraSource:snapshot.cameraSource};
    }
    renderer.present(snapshot,viewport);
  }
  function tick(now) {
    pending=0;
    if(destroyed||lost)return;
    const active=canvasInput?.poll(), slider=dividerInput?.poll(), focus=active?.focused||slider?.focused;
    const dt=lastInput===undefined?0:clamp((now-lastInput)/1000,0,.05);
    lastInput=focus?now:undefined;
    if(active?.focused&&camera&&dt&&(active.values.yaw||active.values.pitch)){
      moveCamera(camera.yaw+(active.values.yaw??0)*dt*1.8,camera.pitch+(active.values.pitch??0)*dt*1.8);
    }
    let snapshot=session.snapshot();
    if(snapshot.playing&&lastTick!==undefined)snapshot=session.advance(Math.max(0,now-lastTick)/1000);
    lastTick=snapshot.playing?now:undefined;
    if(dirty||snapshot.playing){dirty=false;paint(snapshot);}
    if(snapshot.playing||focus)requestFrame();
  }

  play.onclick=()=>session.snapshot().playing?session.pause():session.play();
  mode.onchange=()=>session.update({mode:mode.value});
  axis.onchange=()=>session.update({axis:axis.value});
  time.oninput=()=>session.seek(Number(time.value));

  function swipe(event) {
    const box=stage.getBoundingClientRect(), snapshot=session.snapshot();
    const at=snapshot.axis==='x'?(event.clientX-box.left)/box.width:(event.clientY-box.top)/box.height;
    session.update({divider:clamp(at,0,1)});
  }
  function moveCamera(yaw,pitch) {
    session.update({camera:{...session.snapshot().camera,yaw,pitch:clamp(pitch,-1.55,1.55),pose:null}});
  }
  function bind(surface,defaults,options,action,pointer) {
    return createViewerInput(surface,{contexts:defaults,...options,toolkit,
      onFocus(focused){schedule();options?.onFocus?.(focused);},
      onAction(row){action?.(row);options?.onAction?.(row);},
      onPointer(row){pointer?.(row);options?.onPointer?.(row);}
    });
  }
  try {
    if(input!==false&&input?.divider!==false&&controls.divider!==false)dividerInput=bind(
      divider,dividerBindings,input?.divider,row=>{
        if(divider.hidden||!['press','repeat'].includes(row.phase))return;
        const {divider:at}=session.snapshot();
        const target={start:0,end:1,previous:at-.01,next:at+.01,'previous-fast':at-.1,'next-fast':at+.1}[row.action];
        if(Number.isFinite(target))session.update({divider:clamp(target,0,1)});
      },row=>{
        if(!divider.hidden&&row.action==='drag'&&row.phase!=='cancel')swipe(row.event);
      });
    else divider.tabIndex=-1;
    if(input!==false&&input?.canvas!==false&&controls.camera!==false)canvasInput=bind(
      canvas,cameraBindings,input?.canvas,undefined,row=>{
        if(row.action!=='orbit')return;
        if(row.phase==='start'&&camera&&!orbit)orbit={id:row.id,point:row.point,yaw:camera.yaw,pitch:camera.pitch};
        if(orbit?.id!==row.id)return;
        if(row.phase==='move')moveCamera(orbit.yaw-(row.point[0]-orbit.point[0])*.008,
          orbit.pitch+(row.point[1]-orbit.point[1])*.008);
        else if(row.phase==='end'||row.phase==='cancel')orbit=undefined;
      });
  } catch(error) {
    dividerInput?.dispose();
    canvasInput?.dispose();
    renderer.dispose();
    root.replaceChildren();
    win.cancelAnimationFrame(pending);
    throw error;
  }

  const lose=()=>{lost=true;lastTick=lastInput=undefined;capture=undefined;win.cancelAnimationFrame(pending);pending=0;};
  const restore=()=>{lost=false;schedule();};
  canvas.addEventListener('webglcontextlost',lose);
  canvas.addEventListener('webglcontextrestored',restore);
  const resize=new win.ResizeObserver(schedule);
  resize.observe(canvas);
  const unsubscribe=session.subscribe(schedule);
  return Object.freeze({
    input:Object.freeze({canvas:canvasInput,divider:dividerInput}),
    render(){
      win.cancelAnimationFrame(pending);
      pending=0;capture=undefined;
      const snapshot=session.snapshot();
      paint(snapshot);
      if(snapshot.playing||canvasInput?.focused||dividerInput?.focused)requestFrame();
    },
    destroy(){
      if(destroyed)return;
      destroyed=true;
      unsubscribe();
      resize.disconnect();
      canvasInput?.dispose();
      dividerInput?.dispose();
      win.cancelAnimationFrame(pending);
      canvas.removeEventListener('webglcontextlost',lose);
      canvas.removeEventListener('webglcontextrestored',restore);
      renderer.dispose();
      root.replaceChildren();
    }
  });
}
