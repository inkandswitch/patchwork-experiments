/* DOM input and focus ownership for caller-defined scene actions. */
const buttons=['South','East','West','North','LeftBumper','RightBumper','LeftTrigger','RightTrigger',
  'Back','Start','LeftStick','RightStick','DPadUp','DPadDown','DPadLeft','DPadRight','Home'];
const axes=['LeftX','LeftY','RightX','RightY'];
const mouseButtons=['Left','Middle','Right','Back','Forward'];
const penButtons={0:'Tip',2:'Barrel',5:'Eraser'};
const mouseMasks=[1,4,2,8,16,32];
const modifierNames=['Alt','Control','Meta','Shift'];
const attached=new WeakSet();
const clamp=n=>Math.min(1,Math.max(-1,n));
const empty=Object.freeze([]);
const editable='input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"]),[role="textbox"]';

function modifiers(event) {
  return modifierNames.filter(name=>event[name==='Control'?'ctrlKey':name.toLowerCase()+'Key']);
}
function keyModifiers(event,code) {
  return modifierNames.filter(name=>event.includes(name)&&code!=='key:'+name+'Left'&&code!=='key:'+name+'Right');
}
function stronger(rows,values) {
  for(const [action,value] of rows)if(Math.abs(value)>Math.abs(values[action]))values[action]=value;
}
function physicalPad(pad) {
  const standard=pad.mapping==='standard', rows=new Map();
  Array.from(pad.buttons??[]).slice(0,64).forEach((button,i)=>{
    const value=Number.isFinite(button?.value)?button.value:button?.pressed?1:0;
    rows.set('pad:'+(standard&&buttons[i]||'Button'+i),Math.max(0,Math.min(1,value)));
  });
  Array.from(pad.axes??[]).slice(0,32).forEach((axis,i)=>{
    rows.set('pad:'+(standard&&axes[i]||'Axis'+i),Number.isFinite(axis)?clamp(axis):0);
  });
  return rows;
}

export function createViewerInput(element, {
  toolkit, contexts, context, onAction, onPointer, onFocus, focusOnPointer=true, tabStop=true,
  motionScale=96, readGamepads
}={}) {
  const compile=(toolkit?.KIT??toolkit)?.procedural?.inputActions?.compile;
  const doc=element?.ownerDocument, win=doc?.defaultView;
  if(typeof compile!=='function'||!win||typeof element.focus!=='function'||attached.has(element)||
    [onAction,onPointer,onFocus,readGamepads].some(fn=>fn!==undefined&&typeof fn!=='function')||
    typeof focusOnPointer!=='boolean'||typeof tabStop!=='boolean'||!Number.isFinite(motionScale)||motionScale<=0)
    throw new TypeError('Viewer input needs an available DOM surface, action toolkit, and valid options');

  let map=compile(contexts), current=context??Object.keys(map.profile)[0];
  let values={...map.sample(current,empty)}, focused=false, enabled=true, disposed=false, suspended=false;
  const keys=new Set(), pointers=new Map(), pads=new Map(), impulses=new Map();
  const pressed=new Set(), released=new Set(), listeners=[];
  let chord=[];
  const tabIndex=element.getAttribute('tabindex'), addedTabStop=tabStop&&tabIndex===null&&element.tabIndex<0;
  if(addedTabStop)element.setAttribute('tabindex','0');
  attached.add(element);

  function listen(target,type,handler,options) {
    target.addEventListener(type,handler,options);
    listeners.push(()=>target.removeEventListener(type,handler,options));
  }
  function activate(action,phase,value,source) {
    onAction?.(Object.freeze({action,phase,value,...source}));
  }
  function publish(next,source) {
    const previous=values;
    values=next;
    for(const [action,value] of Object.entries(next)) {
      if(values!==next)break;
      const before=previous[action]??0;
      if(value===before)continue;
      const phase=value===0?'release':before===0?'press':'change';
      if(phase==='press')pressed.add(action);
      if(phase==='release')released.add(action);
      activate(action,phase,value,source);
    }
  }
  function update(source) {
    const next={...map.sample(current,empty)};
    for(const input of keys) {
      const result=map.resolve(current,input,1,keyModifiers(chord,input));
      if(result)stronger([[result.action,result.value]],next);
    }
    for(const {binding} of pointers.values())if(binding)stronger([[binding.action,binding.value]],next);
    for(const {levels} of pads.values())stronger(levels,next);
    publish(next,source);
  }
  function releasePointer(row) {
    if(element.hasPointerCapture?.(row.id))element.releasePointerCapture(row.id);
  }
  function sendPointer(row,phase,event,delta=[0,0]) {
    onPointer?.(Object.freeze({phase,id:row.id,device:row.device,action:row.binding?.action??null,
      input:row.input,point:Object.freeze(row.point.slice()),delta:Object.freeze(delta),event}));
  }
  function clear() {
    keys.clear();
    chord=[];
    pads.clear();
    impulses.clear();
    pressed.clear();
    const captured=[...pointers.values()];
    pointers.clear();
    publish({...map.sample(current,empty)},{device:'focus'});
    for(const row of captured){
      releasePointer(row);
      sendPointer(row,'cancel');
    }
  }
  function pollPads() {
    let list;
    try { list=readGamepads?readGamepads():win.navigator.getGamepads?.(); }
    catch { list=empty; }
    const seen=new Set();
    for(const [index,pad] of Array.from(list??empty).slice(0,16).entries()){
      if(!pad||pad.connected===false)continue;
      seen.add(index);
      const identity=pad.id+'\0'+pad.mapping, saved=pads.get(index), raw=physicalPad(pad);
      const blocked=saved?.identity===identity?saved.blocked:
        new Set([...raw].filter(([,value])=>Math.abs(value)>.12).map(([input])=>input));
      const levels=[];
      for(const [input,value] of raw){
        if(blocked.has(input)){
          if(Math.abs(value)<=.12)blocked.delete(input);
          continue;
        }
        const result=map.resolve(current,input,value);
        if(result)levels.push([result.action,result.value]);
      }
      pads.set(index,{identity,blocked,levels});
    }
    for(const index of pads.keys())if(!seen.has(index))pads.delete(index);
    update({device:'gamepad'});
  }
  function checkFocus() {
    const next=!disposed&&enabled&&!suspended&&doc.visibilityState!=='hidden'&&
      (doc.hasFocus?.()??true)&&element.getRootNode().activeElement===element&&
      !element.matches?.(editable)&&!element.isContentEditable;
    if(next!==focused){
      focused=next;
      if(next)pollPads();
      else clear();
      onFocus?.(focused);
    }
    return focused;
  }
  function local(event) {
    const target=event.composedPath?.()[0]??event.target;
    return target===element&&!target.closest?.(editable)&&!target.isContentEditable;
  }
  function focus() {
    if(disposed||!enabled)return false;
    element.focus({preventScroll:true});
    return checkFocus();
  }
  function key(event,down) {
    if(!checkFocus()||!local(event)||event.defaultPrevented||event.isComposing||!event.code||
      event.code==='Tab'||!/^\w[\w-]{0,47}$/.test(event.code))return;
    const input='key:'+event.code;
    if(down&&event.repeat&&!keys.has(input))return;
    chord=modifiers(event);
    const match=map.resolve(current,input,1,keyModifiers(chord,input)), wasHeld=keys.has(input);
    if(down)keys.add(input);
    else keys.delete(input);
    const source={device:'keyboard',input,event};
    update(source);
    if(down&&event.repeat&&match?.value)activate(match.action,'repeat',match.value,source);
    if(match?.value&&(down||wasHeld))event.preventDefault();
  }
  function point(event) {
    const box=element.getBoundingClientRect();
    return [event.clientX-box.left,event.clientY-box.top];
  }
  function pointerDown(event) {
    if(!enabled||event.defaultPrevented||!local(event)||pointers.has(event.pointerId)||pointers.size>=16)return;
    if(focusOnPointer&&!checkFocus())focus();
    if(!checkFocus())return;
    const device=event.pointerType==='touch'?'touch':event.pointerType==='pen'?'pen':'mouse';
    const button=device==='touch'?'Contact':device==='pen'?penButtons[event.button]:mouseButtons[event.button];
    const chord=modifiers(event), input=button&&device+':'+button;
    const binding=input?map.resolve(current,input,1,chord):null;
    const drag=['X','Y'].some(axis=>map.resolve(current,device+':Drag'+axis,1,chord)?.value);
    if(!binding?.value&&!drag)return;
    const row={id:event.pointerId,device,input,binding,chord,button:event.button,point:point(event)};
    pointers.set(row.id,row);
    try { element.setPointerCapture?.(row.id); } catch { /* Untrusted events may have no active pointer to capture. */ }
    event.preventDefault();
    update({device,input,event});
    if(pointers.has(row.id))sendPointer(row,'start',event);
  }
  function impulse(input,delta,chord,source) {
    if(!Number.isFinite(delta)||!delta||!map.resolve(current,input,1,chord)?.value)return false;
    const key=input+' '+chord.join('+'), value=(impulses.get(key)?.value??0)+delta;
    impulses.set(key,{input,value,chord});
    const result=map.resolve(current,input,clamp(delta/motionScale),chord);
    if(result.value)activate(result.action,'pulse',result.value,{...source,input});
    return true;
  }
  function pointerMove(event) {
    if(!checkFocus())return;
    const row=pointers.get(event.pointerId);
    if(!row)return;
    if(row.device!=='touch'&&event.isTrusted&&!(event.buttons&mouseMasks[row.button])){
      pointerEnd(event,'end');
      return;
    }
    const next=point(event), delta=[next[0]-row.point[0],next[1]-row.point[1]];
    row.point=next;
    const source={device:row.device,event};
    impulse(row.device+':DragX',delta[0],row.chord,source);
    impulse(row.device+':DragY',delta[1],row.chord,source);
    if(pointers.has(row.id))sendPointer(row,'move',event,delta);
    event.preventDefault();
  }
  function pointerEnd(event,phase) {
    const row=pointers.get(event.pointerId);
    if(!row)return;
    pointers.delete(row.id);
    if(phase==='end')row.point=point(event);
    releasePointer(row);
    update({device:row.device,input:row.input,event});
    sendPointer(row,phase,event);
  }
  function wheel(event) {
    if(event.defaultPrevented||!local(event)||!checkFocus())return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1, chord=modifiers(event);
    const source={device:'wheel',event};
    const x=impulse('wheel:X',event.deltaX*unit,chord,source);
    const y=impulse('wheel:Y',event.deltaY*unit,chord,source);
    if(x||y)event.preventDefault();
  }

  function setProfile(contexts,context=current) {
    if(disposed)throw new Error('Viewer input is disposed');
    const next=compile(contexts);
    next.sample(context,empty);
    clear();
    map=next;
    current=context;
    values={...map.sample(current,empty)};
    if(checkFocus())pollPads();
    return map.profile;
  }
  for(const [type,handler] of Object.entries({
    focus:checkFocus,blur:checkFocus,keydown:event=>key(event,true),keyup:event=>key(event,false),
    pointerdown:pointerDown,pointermove:pointerMove,pointerup:event=>pointerEnd(event,'end'),
    pointercancel:event=>pointerEnd(event,'cancel'),lostpointercapture:event=>pointerEnd(event,'cancel')
  }))listen(element,type,handler);
  listen(element,'wheel',wheel,{passive:false});
  listen(doc,'visibilitychange',checkFocus);
  listen(win,'blur',()=>{suspended=true;checkFocus();});
  listen(win,'focus',()=>{suspended=false;checkFocus();});
  listen(win,'gamepaddisconnected',()=>{if(checkFocus())pollPads();});

  return Object.freeze({
    get focused(){return checkFocus();},
    get context(){return current;},
    profile:()=>map.profile,
    focus,
    setProfile,
    setContext(context){
      if(context!==current)setProfile(map.profile,context);
    },
    setBindings(context,action,bindings){
      const profile=map.profile;
      if(!Object.hasOwn(profile,context)||!Object.hasOwn(profile[context],action))
        throw new TypeError('Unknown viewer input context or action');
      return setProfile({...profile,[context]:{...profile[context],[action]:bindings}});
    },
    setEnabled(value){
      if(typeof value!=='boolean')throw new TypeError('Viewer input enabled state must be Boolean');
      enabled=value;
      checkFocus();
    },
    poll(){
      if(checkFocus())pollPads();
      const next={...values};
      for(const {input,value,chord} of impulses.values()){
        const row=map.resolve(current,input,clamp(value/motionScale),chord);
        if(row)stronger([[row.action,row.value]],next);
      }
      const frame=Object.freeze({context:current,focused,values:Object.freeze(next),
        pressed:Object.freeze([...pressed]),released:Object.freeze([...released])});
      pressed.clear();released.clear();impulses.clear();
      return frame;
    },
    dispose(){
      if(disposed)return;
      disposed=true;
      for(const remove of listeners)remove();
      attached.delete(element);
      if(addedTabStop&&element.getAttribute('tabindex')==='0')element.removeAttribute('tabindex');
      if(focused){focused=false;clear();onFocus?.(false);}
    }
  });
}
