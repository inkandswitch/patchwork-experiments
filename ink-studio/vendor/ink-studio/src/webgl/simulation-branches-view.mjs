const roots=new WeakMap();
const defaultLabels={
  title:'Checkpoint branches',play:'Play',pause:'Pause',step:'Step',branch:'Active branch',tick:'Tick',
  playing:'Playing',paused:'Paused',mark:'Pin checkpoint',markName:'Checkpoint ID',fork:'Fork branch',
  forkName:'Branch ID',origin:'Starting point',current:'Active branch head',inputs:'Simulation inputs',
  apply:'Queue inputs',actions:'Actions'
};
const theme=`
  :host{display:block;color:var(--ink-branch-text,#eaf0f5);background:var(--ink-branch-background,#18232e);
    font:var(--ink-branch-font,14px system-ui,sans-serif);color-scheme:var(--ink-branch-color-scheme,dark)}
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  .shell{padding:var(--ink-branch-padding,16px);display:grid;gap:12px}
  h2{margin:0;font-size:18px}
  :is(.bar,form,.actions,label){display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  label{font-size:12px}
  .bar,form,.actions{display:flex;gap:10px;align-items:end;border:1px solid var(--ink-branch-border,#4e6172);
    border-radius:7px;padding:9px;background:var(--ink-branch-panel,#202e3b)}
  :is(button,input,select){font:inherit;color:inherit;background:var(--ink-branch-background,#18232e);
    border:1px solid var(--ink-branch-border,#4e6172);border-radius:4px;min-height:32px;padding:4px 8px}
  :is(button,input,select):focus-visible{outline:2px solid var(--ink-branch-accent,#e9b77b);outline-offset:2px}
  button{cursor:pointer}input[type=number]{width:88px}input[required]{max-width:160px}
  label span{white-space:nowrap}output{margin-inline-start:auto;font-variant-numeric:tabular-nums}
  [role=alert]{margin:0;color:var(--ink-branch-error,#ffbcab)}
`;

/** Optional fixed-tick controls. The host can supply any preview through the default slot. */
export function mountSimulationBranches(host,{
  session,inputs=[],actions=[],labels={},controls={},clock=true,stylesheet='',defaultStyles=true
}={}) {
  if(!session?.subscribe||!session?.checkpoint||!Array.isArray(inputs)||!Array.isArray(actions)||
    typeof clock!=='boolean'||typeof defaultStyles!=='boolean'||typeof stylesheet!=='string')
    throw new TypeError('Branch controls need a branch session and valid mount settings');
  const manual=session.checkpoint().manual;
  const settings=inputs.map(spec=>{
    if(!spec||!Object.hasOwn(manual,spec.port))throw new Error('Unknown mounted input '+spec?.port);
    const initial=manual[spec.port], type=typeof initial;
    return {spec,type};
  });
  if(actions.some(item=>!item||typeof item.action!=='string'))throw new TypeError('Invalid mounted simulation action');
  const text={...defaultLabels,...labels}, doc=host.ownerDocument, win=doc.defaultView;
  const root=roots.get(host)??host.attachShadow({mode:'open'});
  if(root.childElementCount)throw new Error('This host already has mounted branch controls');
  roots.set(host,root);
  root.innerHTML=`<div class="shell" part="shell">
    <h2 part="title" data-label="title"></h2>
    <div class="bar" part="transport">
      <label part="branch-control"><span data-label="branch"></span><select part="branch"></select></label>
      <button type="button" part="playback"></button><button type="button" part="step" data-label="step"></button>
      <output part="status" role="timer" aria-live="off"></output>
    </div>
    <form part="mark-controls">
      <label><span data-label="markName"></span><input name="id" part="mark-name" required maxlength="96"></label>
      <button part="mark" data-label="mark"></button>
    </form>
    <form part="fork-controls">
      <label><span data-label="origin"></span><select name="origin" part="origin"></select></label>
      <label><span data-label="forkName"></span><input name="id" part="fork-name" required maxlength="96"></label>
      <button part="fork" data-label="fork"></button>
    </form>
    <form part="input-controls" aria-label=""><button part="apply" data-label="apply"></button></form>
    <div class="actions" part="action-controls" role="group" aria-label=""></div>
    <p part="error" role="alert" hidden></p><slot></slot>
  </div>`;
  if(defaultStyles||stylesheet) {
    const style=doc.createElement('style');
    style.textContent=(defaultStyles?theme:'')+stylesheet;
    root.prepend(style);
  }
  const part=name=>root.querySelector('[part="'+name+'"]');
  for(const node of root.querySelectorAll('[data-label]'))node.textContent=text[node.dataset.label];
  const play=part('playback'), step=part('step'), selector=part('branch'), origin=part('origin'),
    error=part('error'), editForm=part('input-controls'), actionBar=part('action-controls'),
    markForm=part('mark-controls'), forkForm=part('fork-controls');
  part('title').hidden=!text.title;
  part('branch-control').hidden=controls.branch===false;
  play.hidden=step.hidden=controls.playback===false;
  markForm.hidden=controls.mark===false;
  forkForm.hidden=controls.fork===false;
  editForm.hidden=controls.inputs===false||!inputs.length;
  actionBar.hidden=controls.actions===false||!actions.length;
  editForm.setAttribute('aria-label',text.inputs);
  actionBar.setAttribute('aria-label',text.actions);

  let frame=0, previousFrame, lastBranch, branchOptions, markOptions;
  function handle(work) {
    try {
      work();
      error.hidden=true;
      error.textContent='';
      return true;
    } catch(cause) {
      error.hidden=false;
      error.textContent=cause.message;
      return false;
    }
  }
  function queue(action) {
    session.pause();
    session.queue(action);
  }
  const editors=settings.map(({spec,type})=>{
    const label=doc.createElement('label'), span=doc.createElement('span'), input=doc.createElement('input');
    span.textContent=spec.label??spec.port;
    input.setAttribute('part','input');
    input.type=type==='boolean'?'checkbox':type==='number'?'number':'text';
    if(type==='number') {
      input.required=true;
      input.step=spec.step??'any';
      if(spec.min!==undefined)input.min=spec.min;
      if(spec.max!==undefined)input.max=spec.max;
    }
    label.append(span,input);
    editForm.insertBefore(label,part('apply'));
    return {port:spec.port,input,type};
  });
  for(const action of actions) {
    const button=doc.createElement('button');
    button.type='button';
    button.textContent=action.label??action.action;
    button.setAttribute('part','action');
    button.onclick=()=>handle(()=>queue({actions:[{action:action.action,args:action.args??{}}]}));
    actionBar.append(button);
  }
  function options(select,items) {
    const previous=select.value;
    select.replaceChildren(...items.map(([value,label])=>{
      const option=doc.createElement('option');
      option.value=value;
      option.textContent=label;
      return option;
    }));
    if(items.some(([value])=>value===previous))select.value=previous;
  }
  function draw(snapshot) {
    play.textContent=snapshot.playing?text.pause:text.play;
    part('status').textContent=text.tick+' '+snapshot.tick+' · '+(snapshot.playing?text.playing:text.paused);
    if(!branchOptions||branchOptions!==snapshot.branches.length) {
      options(selector,snapshot.branches.map(row=>[row.id,row.label]));
      branchOptions=snapshot.branches.length;
    }
    selector.value=snapshot.active;
    if(markOptions!==snapshot.marks.length) {
      options(origin,[['',text.current],...snapshot.marks.map(row=>[row.id,row.id+' · '+text.tick.toLowerCase()+' '+row.tick])]);
      markOptions=snapshot.marks.length;
    }
    if(editors.length) {
      const checkpoint=session.checkpoint(), activeChanged=lastBranch!==snapshot.active;
      for(const editor of editors) {
        const pending=checkpoint.pending.findLast(row=>row.tick===snapshot.tick+1&&
          row.action==='world/input'&&row.args.port===editor.port);
        const value=pending?pending.args.value:checkpoint.manual[editor.port];
        if(activeChanged||root.activeElement!==editor.input) {
          if(editor.type==='boolean')editor.input.checked=value;
          else editor.input.value=editor.type==='number'?String(value):JSON.stringify(value);
        }
      }
      lastBranch=snapshot.active;
    }
    if(snapshot.playing&&clock&&!frame)frame=win.requestAnimationFrame(tick);
    if(!snapshot.playing) {
      win.cancelAnimationFrame(frame);
      frame=0;
      previousFrame=undefined;
    }
  }
  function tick(now) {
    frame=0;
    if(!session.status().playing)return;
    const before=previousFrame;
    previousFrame=now;
    if(before!==undefined)handle(()=>session.update(Math.max(0,(now-before)/1000)));
    if(session.status().playing&&!frame)frame=win.requestAnimationFrame(tick);
  }
  play.onclick=()=>handle(()=>session.status().playing?session.pause():session.play());
  step.onclick=()=>handle(()=>session.step());
  selector.onchange=()=>handle(()=>session.select(selector.value));
  markForm.onsubmit=event=>{
    event.preventDefault();
    if(handle(()=>{session.pause();session.mark(part('mark-name').value.trim());}))markForm.reset();
  };
  forkForm.onsubmit=event=>{
    event.preventDefault();
    if(handle(()=>session.fork(part('fork-name').value.trim(),origin.value?{mark:origin.value}:{})))
      part('fork-name').value='';
  };
  editForm.onsubmit=event=>{
    event.preventDefault();
    handle(()=>queue({inputs:Object.fromEntries(editors.map(({port,input,type})=>[port,
      type==='number'?input.valueAsNumber:type==='boolean'?input.checked:JSON.parse(input.value)]))}));
  };
  const unsubscribe=session.subscribe(draw);
  return Object.freeze({destroy() {
    unsubscribe();
    win.cancelAnimationFrame(frame);
    if(clock)session.pause();
    root.replaceChildren();
  }});
}
