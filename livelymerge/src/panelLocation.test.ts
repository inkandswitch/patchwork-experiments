/**
 * Cascading panel placement: newPanelLocation / newPanelRect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'canvas') return (globalThis as any).canvas;
        return (..._args: unknown[]) => undefined;
      },
      set() {
        return true;
      },
    },
  );
}

function setup() {
  const rafQueue: Array<() => void> = [];
  const ctx = makeCtxStub();
  const canvas: any = {
    width: 800,
    height: 600,
    style: {},
    tabIndex: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener() {},
    removeEventListener() {},
  };
  const g = globalThis as any;
  g.window = globalThis;
  g.canvas = canvas;
  g.document = {
    querySelector: () => canvas,
    createElement: () => canvas,
    body: { appendChild() {} },
  };
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.Automerge = { getActorId: () => 'actor-test' };
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  g.handle = handle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  rt.eval(src.replace(/\binit\(\)\s*$/, ''));
  return { rt };
}

describe('panel location cascade', () => {
  it('starts at panelLocation and steps by panelLocationDelta', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); $nextPanelLocation = null;`);
    const result = rt.eval(`
(() => {
  let a = newPanelLocation(pt(400, 300));
  let b = newPanelLocation(pt(400, 300));
  return 'origin=' + panelLocation.x + ',' + panelLocation.y +
    ' delta=' + panelLocationDelta.x + ',' + panelLocationDelta.y +
    ' a=' + a.x + ',' + a.y +
    ' b=' + b.x + ',' + b.y;
})()
`) as string;
    expect(result).toContain('origin=400,60');
    expect(result).toContain('delta=20,20');
    expect(result).toContain('a=400,60');
    expect(result).toContain('b=420,80');
  }, 120_000);

  it('wraps to start Y and +300 X when the next panel would go past the world bottom', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); $nextPanelLocation = null;`);
    const result = rt.eval(`
(() => {
  // Place near the bottom so the following cascade step must wrap.
  $nextPanelLocation = pt(400, 280);
  let a = newPanelLocation(pt(400, 300)); // fits at 280? 280+300=580 < 600 — ok
  let b = newPanelLocation(pt(400, 300)); // next would be 295+300=595 ok; or wrap?
  // Force a slot that cannot fit:
  $nextPanelLocation = pt(410, 350);
  let c = newPanelLocation(pt(400, 300)); // 350+300 > 600 → wrap before place
  return 'a=' + a.x + ',' + a.y +
    ' c=' + c.x + ',' + c.y +
    ' next=' + $nextPanelLocation.x + ',' + $nextPanelLocation.y;
})()
`) as string;
    expect(result).toContain('a=400,280');
    expect(result).toContain('c=710,60');
    expect(result).toContain('next=730,80');
  }, 120_000);

  it('null-bounds BrowserPanel and MethodPanel use the cascade', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); $nextPanelLocation = null;`);
    const result = rt.eval(`
(() => {
  let b1 = Lively.addEphemeralMorph(new BrowserPanel());
  let b2 = Lively.addEphemeralMorph(new MethodPanel(null, 'hi', 'Hi'));
  let p1 = b1.getBounds().topLeft;
  let p2 = b2.getBounds().topLeft;
  return 'p1=' + p1.x + ',' + p1.y + ' p2=' + p2.x + ',' + p2.y;
})()
`) as string;
    expect(result).toContain('p1=400,60');
    expect(result).toContain('p2=420,80');
  }, 120_000);
});

describe('inspectString', () => {
  it('prints numbers, points, rectangles, transforms, and shapes decently', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    const result = rt.eval(`
(() => {
  let p = pt(3, 4);
  let r = rect(10, 20, 30, 40);
  let tfm = new SimpleTransform(pt(1, 2), 0, pt(1, 1));
  let sh = new Shape('rectangle', rect(0, 0, 50, 60), Color.red, 2, Color.black);
  let el = new Ellipse(pt(5, 5), pt(10, 8));
  return 'num=' + inspectString(3.5) +
    ' |pt=' + inspectString(p) +
    ' |rect=' + inspectString(r) +
    ' |tfm=' + inspectString(tfm) +
    ' |shape=' + inspectString(sh) +
    ' |ell=' + inspectString(el);
})()
`) as string;
    expect(result).toContain('num=3.5');
    expect(result).toMatch(/\|pt=pt\(3/);
    expect(result).toMatch(/\|rect=pt\(10/);
    expect(result).toMatch(/\|tfm=trans:/);
    expect(result).toMatch(/\|shape=a Shape/);
    expect(result).toMatch(/\|ell=Ellipse/);
  }, 120_000);
});
