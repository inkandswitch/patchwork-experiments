import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function setup() {
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle; g.runtime = rt; g.window = globalThis;
  g.canvas = { width: 800, height: 600, style: {}, getContext: () => ({ measureText: () => ({ width: 10 }) }), getBoundingClientRect: () => ({ left:0,top:0,width:800,height:600,right:800,bottom:600 }), addEventListener(){}, removeEventListener(){} };
  g.document = { createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, addEventListener(){}, removeEventListener(){}, focus(){}, getBoundingClientRect: () => ({ left:0,top:0,width:800,height:600 }), getContext: () => g.canvas.getContext() }), body: {}, documentElement: {}, querySelector: () => g.canvas };
  g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
  g.AbortController = class { abort() {} };
  g.Automerge = { getActorId: () => 'a' };
  g.HTMLImageElement = class {}; g.HTMLCanvasElement = class {};
  g.Image = class { width=0; height=0; set src(_v:string){} };
  g.OffscreenCanvas = class { width=0; height=0; constructor(w:number,h:number){this.width=w;this.height=h;} getContext(){return { measureText:()=>({width:10})}; } };
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8').replace(/\binit\(\)\s*$/, ''));
  return { rt };
}

describe('startStepping arg packing', () => {
  it('packs a single object arg correctly', () => {
    const { rt } = setup();
    const info = rt.eval(`
(() => {
  initUI(); initLively();
  let m = new Morph(rect(0,0,10,10));
  Lively.addMorph(m);
  m.startStepping('toString', 50, { goDist: 2, turnAngle: 60, nSteps: 26 });
  let s = m.steppingSpecs()[0];
  let a0 = s.\$args[0];
  return 'len=' + s.\$args.length +
    ' isArrArgs=' + Array.isArray(s.\$args) +
    ' a0isArr=' + Array.isArray(a0) +
    ' goDist=' + (a0 && a0.goDist) +
    ' typeof0=' + typeof a0;
})()
`) as string;
    console.log(info);
    expect(info).toContain('goDist=2');
    expect(info).toContain('a0isArr=false');
  }, 120_000);

  it('false arg does not open inspect on step', () => {
    const { rt } = setup();
    const info = rt.eval(`
(() => {
  initUI(); initLively();
  let panel = pt(1,2).inspect();
  // select a var so showSelectedValue would do something
  panel.selectedVarName = 'x';
  panel.target = pt(3,4);
  // count inspectors before/after forced step
  let before = Lively.submorphs.filter(m => m.className === 'InspectorPanel').length;
  let spec = panel.steppingSpecs().find(s => s.methodName === 'showSelectedValue');
  let a0 = spec && spec.\$args && spec.\$args[0];
  // manually invoke as handleStepList would
  let args = spec.\$args != null ? spec.\$args : [];
  if (args.length > 0) panel.showSelectedValue(...args);
  else panel.showSelectedValue();
  let after = Lively.submorphs.filter(m => m.className === 'InspectorPanel').length;
  return 'a0=' + a0 + ' typeofA0=' + typeof a0 + ' before=' + before + ' after=' + after + ' argsLen=' + args.length;
})()
`) as string;
    console.log(info);
    expect(info).toContain('a0=false');
    expect(info).toContain('before=');
    // after should equal before (no new inspector) when shiftKey is false
    const before = Number(info.match(/before=(\d+)/)?.[1]);
    const after = Number(info.match(/after=(\d+)/)?.[1]);
    expect(after).toBe(before);
  }, 120_000);
});
