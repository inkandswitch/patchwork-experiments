/**
 * Fabrik.js on newdefs: parts bin, pins, and the bits-on-the-screen class browser.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Automerge from '@automerge/automerge';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return (s: unknown) => ({ width: String(s ?? '').length * 8 });
        if (prop === 'canvas') return (globalThis as any).canvas;
        return (..._args: unknown[]) => undefined;
      },
      set() {
        return true;
      },
    },
  );
}

function installBrowserStubs() {
  const ctx = makeCtxStub();
  const canvas: any = {
    width: 1600,
    height: 600,
    style: {},
    tabIndex: 0,
    clientWidth: 1600,
    clientHeight: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 600, right: 1600, bottom: 600 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const g = globalThis as any;
  g.window = globalThis;
  g.canvas = canvas;
  g.ctx = ctx;
  const elementStub = () => ({
    getContext: () => ctx,
    style: {},
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 600 }),
  });
  g.document = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'createElement') return () => elementStub();
        if (prop === 'body' || prop === 'documentElement') return elementStub();
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
        return (..._args: unknown[]) => null;
      },
      set() {
        return true;
      },
    },
  );
  g.requestAnimationFrame = (_cb: () => void) => 1;
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

function stripTrailingInit(src: string) {
  return src.replace(/\binit\(\)\s*(?:\/\/[^\n]*\s*)*$/, '');
}

function bootFabrik(start: string) {
  installBrowserStubs();
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const newdefs = stripTrailingInit(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
  const fabrik = readFileSync(join(__dirname, '..', 'Fabrik.js'), 'utf8');
  rt.eval(newdefs);
  rt.eval(fabrik);
  rt.eval(start);
  return { rt, handle };
}

function makeFabrik() {
  return bootFabrik('initUI(); openFabrik(); fabrikTest();');
}

function makePopulatedFabrik() {
  return bootFabrik('initUI(); populateLively();');
}

function opsDuring(handle: ReturnType<typeof createAutomergeTestDocHandle>, act: () => void) {
  const headsBefore = Automerge.getHeads(handle.doc() as any);
  act();
  const changes = Automerge.getChanges(
    Automerge.view(handle.doc() as any, headsBefore) as any,
    handle.doc() as any,
  );
  let count = 0;
  const keys: string[] = [];
  for (const ch of changes) {
    const dec = Automerge.decodeChange(ch);
    count += dec.ops.length;
    for (const op of dec.ops as any[]) {
      keys.push(
        `${op.action} key=${String(op.key ?? op.elemId ?? '?')} val=${JSON.stringify(op.value ?? '')}`.slice(0, 110),
      );
    }
  }
  return { count, keys };
}

describe('Fabrik', () => {
  it('builds a simple world with a parts bin and the class-browser demo', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let catFn = Lively.get('browserCategoryNames');
        let catSrc = catFn && catFn.contentPane && catFn.contentPane.shape ? catFn.contentPane.shape.string : '';
        let wired = false;
        let from = fabrikPinNamed(catFn, 'result');
        let to = fabrikPinNamed(Lively.get('categories'), 'strings');
        for (let i = 0; i < Lively.fabrikWires.length; i++) {
          let w = Lively.fabrikWires[i];
          if (w.fromPin === from && w.toPin === to) wired = true;
        }
        return [
          !!Lively.isFabrikWorld,
          !!Lively.get('fabrikBin'),
          Lively.fabrikWires.length >= 9,
          !!Lively.$fabrikEditMode,
          Lively.$fabrikViewMode === 'edit',
          !Lively.get('fabrik'),
          !!catFn,
          !!(catFn && !(catFn.fabrikInputs && catFn.fabrikInputs.length)),
          catSrc.indexOf('browserCategoryNames') >= 0,
          wired,
          !!fabrikPinNamed(Lively.get('categories'), 'strings'),
          !!fabrikPinNamed(Lively.get('classNames'), 'strings'),
          !!fabrikPinNamed(Lively.get('methodNames'), 'strings'),
          !Lively.get('fabrikBrowser') && Lively.get('categories').owner === Lively,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('shows Ellipse.moveBy in edit view and user view', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let classNames = Lively.get('classNames');
        let names = classNames.contentPane.itemList || [];
        let methods = Lively.get('methodNames').contentPane.itemList || [];
        let text = Lively.get('methodDefinition').contentPane.shape.string || '';
        fabrikSetView('user', Lively);
        let userText = Lively.get('methodDefinition').contentPane.shape.string || '';
        fabrikSetView('edit', Lively);
        return [
          names.indexOf('Ellipse') >= 0,
          methods.indexOf('moveBy') >= 0,
          text.indexOf('moveBy') >= 0,
          text.indexOf(String.fromCharCode(10)) >= 0,
          userText.indexOf('moveBy') >= 0,
          !Lively.$fabrikEditMode ? 'no' : 'edit',
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,edit');
  }, 20000);

  it('method list content is taller than the pane and scrollByLines moves it', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        fabrikReveal(Lively, 'Morphs', 'Morph', 'addMorph');
        let list = Lively.get('methodNames');
        let room = fabrikContentHeight(list) - list.fabrikPaneHeight();
        let before = list.contentPane.$scrollOffsetY || 0;
        let b = list.boundsInWorld();
        Lively.onWheel(b.center(), { deltaY: 120, deltaMode: 0 });
        let after = list.contentPane.$scrollOffsetY || 0;
        return [room > 8, after < before].join(',');
      })()`),
    ).toBe('true,true');
  }, 20000);

  it('user view hugs and abuts; edit view leaves a wire gap with name gutters', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let cats = Lively.get('categories');
        let classes = Lively.get('classNames');
        let methods = Lively.get('methodNames');
        let defn = Lively.get('methodDefinition');
        fabrikSetView('edit', Lively);
        let editPad = cats.contentPane.transform.translation.x;
        let aEdit = fabrikPinLabelAlpha(Lively);
        let editGap = methods.getBounds().topLeft.x - (cats.getBounds().topLeft.x + cats.getBounds().width());
        let editDefGap = defn.getBounds().topLeft.y - (cats.getBounds().topLeft.y + cats.getBounds().height());
        fabrikSetView('user', Lively);
        cats = Lively.get('categories');
        classes = Lively.get('classNames');
        methods = Lively.get('methodNames');
        defn = Lively.get('methodDefinition');
        let userPad = cats.contentPane.transform.translation.x;
        let aUser = fabrikPinLabelAlpha(Lively);
        let userVGap = classes.getBounds().topLeft.y - (cats.getBounds().topLeft.y + cats.getBounds().height());
        let userHGap = methods.getBounds().topLeft.x - (cats.getBounds().topLeft.x + cats.getBounds().width());
        let userDefGap = defn.getBounds().topLeft.y - Math.max(
          classes.getBounds().topLeft.y + classes.getBounds().height(),
          methods.getBounds().topLeft.y + methods.getBounds().height(),
        );
        fabrikSetView('edit', Lively);
        let fn = Lively.get('classNamesInCategory');
        let catFn = Lively.get('browserCategoryNames');
        let fnX = fn.getBounds().topLeft.x;
        let fnW = fn.getBounds().width();
        let editFnGap = cats.getBounds().topLeft.x - (fnX + fnW);
        let catGap = fn.getBounds().topLeft.y - (catFn.getBounds().topLeft.y + catFn.getBounds().height());
        let inPin = fabrikPinNamed(cats, 'strings');
        let outPin = fabrikPinNamed(cats, 'selection');
        let pinRight = inPin.getBounds().topLeft.x + inPin.getBounds().width();
        let inGreen = inPin.shape.fillColor && inPin.shape.fillColor.g > inPin.shape.fillColor.b;
        let outBlue = outPin.shape.fillColor && outPin.shape.fillColor.b > outPin.shape.fillColor.g;
        fabrikSetView('user', Lively);
        let userOrigin = Lively.get('categories').boundsInWorld().topLeft;
        let userPanel = fabrikFindPanel(Lively);
        let userWrapped = !!(userPanel && userPanel.$fabrikWrapped && Lively.get('categories').owner === userPanel);
        fabrikSetView('edit', Lively);
        cats = Lively.get('categories');
        let hugSingle =
          cats.shape.borderWidth === 2 &&
          cats.contentPane.shape.borderWidth === 0 &&
          !!(cats.shape.fillColor && Math.abs(cats.shape.fillColor.r - Color.lightGray.r) < 0.05);
        let fnHug = fn.contentPane && fn.contentPane.shape && fn.contentPane.shape.borderWidth === 0;
        let o = cats.getBounds();
        cats.setBounds(rect(o.topLeft.x, o.topLeft.y, o.width() + 80, o.height()));
        let grown =
          cats.contentPane.getBounds().width() <= o.width() + 4 && cats.contentPane.shape.borderWidth >= 1;
        fabrikSetView('layout', Lively);
        let aLayout = fabrikPinLabelAlpha(Lively);
        let layoutGap = Lively.get('methodNames').getBounds().topLeft.x - (
          Lively.get('categories').getBounds().topLeft.x + Lively.get('categories').getBounds().width()
        );
        let layoutPinsOff = !fabrikPaneShowsPins(Lively.get('categories'));
        fabrikSetView('edit', Lively);
        cats = Lively.get('categories');
        let eb = cats.getBounds();
        cats.setBounds(rect(eb.topLeft.x + 16, eb.topLeft.y + 8, eb.width() + 24, eb.height() + 16));
        let ePos = cats.getBounds();
        let eGrid =
          ePos.topLeft.x === fabrikGrid(ePos.topLeft.x) &&
          ePos.topLeft.y === fabrikGrid(ePos.topLeft.y) &&
          ePos.width() === fabrikGrid(ePos.width()) &&
          ePos.height() === fabrikGrid(ePos.height());
        fabrikSetView('layout', Lively);
        let lb = Lively.get('categories').getBounds();
        Lively.get('categories').setBounds(rect(lb.topLeft.x + 32, lb.topLeft.y + 16, lb.width() + 8, lb.height() + 8));
        let lPos = Lively.get('categories').getBounds();
        let lGrid =
          lPos.topLeft.x === fabrikGrid(lPos.topLeft.x) &&
          lPos.width() === fabrikGrid(lPos.width()) &&
          lPos.height() === fabrikGrid(lPos.height());
        fabrikSetView('edit', Lively);
        let eBack = Lively.get('categories').getBounds();
        fabrikSetView('layout', Lively);
        let lBack = Lively.get('categories').getBounds();
        let restored =
          eBack.topLeft.x === ePos.topLeft.x &&
          eBack.topLeft.y === ePos.topLeft.y &&
          eBack.width() === ePos.width() &&
          eBack.height() === ePos.height() &&
          lBack.topLeft.x === lPos.topLeft.x &&
          lBack.topLeft.y === lPos.topLeft.y &&
          lBack.width() === lPos.width() &&
          lBack.height() === lPos.height();
        return [
          editPad < 8,
          editGap > 40 && editGap < 70,
          editDefGap > 40,
          userPad < 8,
          Math.abs(userVGap) < 6,
          Math.abs(userHGap) < 6,
          Math.abs(userDefGap) < 6,
          fnX === fabrikGrid(fnX),
          Math.abs(editFnGap - 80) < 16,
          fn.getBounds().topLeft.y === fabrikGrid(fn.getBounds().topLeft.y),
          Math.abs(catGap - 48) < 8,
          userOrigin.x === fabrikGrid(userOrigin.x),
          userOrigin.y === fabrikGrid(userOrigin.y),
          pinRight <= 1,
          inGreen,
          outBlue,
          Lively.$fabrikViewMode === 'layout',
          Math.abs(layoutGap) < 6,
          aEdit === 0.8,
          aLayout === 0,
          aUser === 0,
          hugSingle,
          fnHug,
          grown,
          userWrapped,
          layoutPinsOff,
          eGrid,
          lGrid,
          restored,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('function view source wraps without blank lines after return', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let fv = Lively.get('classNamesInCategory');
        let box = fv.contentPane.shape;
        box.compose();
        let n = box.lines.length;
        let empty = 0;
        let returnWithLong = false;
        for (let i = 0; i < n; i++) {
          let s = box.lines[i].string || '';
          let t = '';
          for (let j = 0; j < s.length; j++) {
            let ch = s.charAt(j);
            if (ch !== ' ' && ch !== String.fromCharCode(10) && ch !== String.fromCharCode(13)) t += ch;
          }
          if (t === '') empty++;
          if (s.indexOf('return') >= 0 && s.indexOf('fabrikClassNamesInCategory') >= 0) returnWithLong = true;
        }
        return [n < 16, empty === 0, !returnWithLong, (box.string || '').indexOf('fabrikClassNamesInCategory') >= 0].join(',');
      })()`),
    ).toBe('true,true,true,true');
  }, 20000);

  it('ctrl-S in a function view installs that function on the part', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let fv = new FabrikFunctionView(rect(40, 40, 220, 40), {
          source: 'function (v) { return v; }',
          inputs: [{ name: 'v', type: 'any' }],
        });
        Lively.addMorph(fv);
        fv.setText('function twice(n) { return n * 2; }', { force: true });
        let tb = fv.contentPane.shape;
        tb.handleKeyboardShortcuts({ key: 's', ctrlKey: true, preventDefault() {}, stopPropagation() {} });
        let inN = fabrikPinNamed(fv, 'n');
        let oldV = fabrikPinNamed(fv, 'v');
        if (inN) inN.value = 6;
        fv.fabrikRun();
        let out = fabrikPinNamed(fv, 'result');
        let hit = fabrikHandleHit(fv, pt(fv.shape.topLeft.x + fv.shape.extent.x - 2, fv.shape.topLeft.y + 2));
        return [
          fv.getName() === 'twice',
          fv.fabrikPartName === 'twice',
          !!inN,
          !oldV,
          out && out.value === 12,
          hit === 'move',
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true');
  }, 20000);

  it('text view ctrl-S emits; eval view prints then evals; slider is 0-100 i/o', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let tv = new FabrikTextView(rect(40, 40, 180, 40));
        Lively.addMorph(tv);
        let tvIn = fabrikPinNamed(tv, 'text');
        tv.setText('hello', { force: true });
        tv.contentPane.shape.handleKeyboardShortcuts({
          key: 's',
          ctrlKey: true,
          preventDefault() {},
          stopPropagation() {},
        });
        let textOut = fabrikPinNamed(tv, 'textOut');

        let ev = new FabrikEvalView(rect(40, 100, 180, 40));
        Lively.addMorph(ev);
        let evIn = fabrikPinNamed(ev, 'in');
        let nilShown = ev.contentPane && ev.contentPane.shape ? '' + ev.contentPane.shape.string : '';
        evIn.receive(50);
        let shown = ev.contentPane && ev.contentPane.shape ? '' + ev.contentPane.shape.string : '';
        ev.setText('55', { force: true });
        ev.contentPane.shape.handleKeyboardShortcuts({
          key: 's',
          ctrlKey: true,
          preventDefault() {},
          stopPropagation() {},
        });
        let evOut = fabrikPinNamed(ev, 'out');

        let sl = new FabrikSliderView(rect(40, 160, 180, 32));
        Lively.addMorph(sl);
        let slIn = fabrikPinNamed(sl, 'value');
        let slOut = fabrikPinNamed(sl, 'valueOut');
        let slider = fabrikSliderOf(sl);
        if (slider && slider.emitValueFunction) slider.emitValueFunction.call(sl, 0.4);
        let emitted = slOut && slOut.value;
        slIn.receive(75);
        let frac = slider && slider.getValue ? slider.getValue() : -1;
        let binEv = Lively.get('fabrikBin').findKindIn('views', 'evalView');
        let binSl = Lively.get('fabrikBin').findKindIn('views', 'sliderView');
        let binNil = binEv && binEv.contentPane && binEv.contentPane.shape ? '' + binEv.contentPane.shape.string : '';
        let noBi =
          tvIn.pinDir === 'in' &&
          textOut.pinDir === 'out' &&
          evIn.pinDir === 'in' &&
          evOut.pinDir === 'out' &&
          slIn.pinDir === 'in' &&
          slOut.pinDir === 'out';
        return [
          !!(textOut && textOut.value === 'hello'),
          nilShown === 'nil',
          shown === '50',
          !!(evOut && evOut.value === 55 && typeof evOut.value === 'number'),
          noBi,
          emitted === 40,
          Math.abs(frac - 0.75) < 0.02,
          binNil === 'nil',
          !!(binSl && binSl.className === 'FabrikSliderView' && fabrikPinNamed(binSl, 'valueOut')),
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('eval view prints at most 3 decimals; halo rotate sticks near 45 degrees', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let ev = new FabrikEvalView(rect(40, 40, 120, 32));
        Lively.addMorph(ev);
        fabrikPinNamed(ev, 'in').receive(1.23456);
        let shown = ev.contentPane && ev.contentPane.shape ? '' + ev.contentPane.shape.string : '';
        return [
          shown === '1.235',
          fabrikPrintValue(50) === '50',
          fabrikPrintValue(Math.PI) === '3.142',
          Math.abs(stickyRotation(0.05)) < 1e-9,
          Math.abs(stickyRotation(Math.PI / 4 + 0.04) - Math.PI / 4) < 1e-9,
          Math.abs(stickyRotation(0.4) - 0.4) < 1e-9,
          Math.abs(stickyRotation(0.5, Math.PI / 4) - Math.PI / 4) < 1e-9,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true');
  }, 20000);

  it('rotated slider pins track the part and remain hittable for wiring', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let sl = new FabrikSliderView(rect(120, 80, 180, 32));
        Lively.addMorph(sl);
        let pin = fabrikPinNamed(sl, 'valueOut');
        sl.transform.rotation = Math.PI / 2;
        let loc = fabrikPinAttachLocal(pin, fabrikHostXY(7));
        let g = pin.globalize(pt(loc.x, loc.y));
        let c = fabrikPinCenterWorld(pin);
        let away = fabrikPinAwayWorldInto(pin, fabrikHostXY(8));
        let ax = away.x;
        let ay = away.y;
        let stub = fabrikWireStubWorld(pin);
        let fb = sl.fullBounds();
        let pInOwner = sl.owner ? sl.owner.localize(g) : g;
        let pInHost = sl.localize(g);
        let hitPin = pin.includesPt(pInHost);
        let found = fabrikPinAtWorld(Lively, g);
        let ev = new FabrikEvalView(rect(300, 80, 120, 40));
        Lively.addMorph(ev);
        fabrikConnect(pin, fabrikPinNamed(ev, 'in'));
        let wire = Lively.fabrikWires[Lively.fabrikWires.length - 1];
        fabrikWireRefreshGeom(wire);
        return [
          Math.abs(c.x - g.x) < 2 && Math.abs(c.y - g.y) < 2,
          Math.abs(ax) < 0.08 && Math.abs(ay - 1) < 0.08,
          Math.abs(stub.x - (c.x + ax * 20)) < 2 && Math.abs(stub.y - (c.y + ay * 20)) < 2,
          fb.includesPt(pInOwner),
          hitPin,
          found === pin,
          Math.abs(wire.$ax - c.x) < 2 && Math.abs(wire.$ay - c.y) < 2,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true');
  }, 20000);

  it('halo copy of a rotated slider keeps the inner slider in the frame', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let sl = new FabrikSliderView(rect(120, 80, 180, 32));
        Lively.addMorph(sl);
        sl.setRotation(Math.PI / 4);
        let copy = sl.morphCopy();
        Lively.addMorph(copy);
        let inner = fabrikSliderOf(copy);
        let mid = inner ? inner.boundsInWorld().center() : pt(0, 0);
        let fb = copy.fullBounds();
        return [
          copy.className === 'FabrikSliderView',
          !!(inner && inner.className === 'SliderMorph' && inner.owner === copy),
          !!(fabrikPinNamed(copy, 'value') && fabrikPinNamed(copy, 'valueOut')),
          fb.includesPt(mid),
          Math.abs((copy.transform.rotation || 0) - Math.PI / 4) < 0.05,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true');
  }, 20000);

  it('function views with n inputs are tall enough for inset pin layout', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let fv = new FabrikFunctionView(rect(40, 40, 220, 24), {
          source: 'function triple(a, b, c) { return a; }',
          inputs: [
            { name: 'a', type: 'any' },
            { name: 'b', type: 'any' },
            { name: 'c', type: 'any' },
          ],
        });
        Lively.addMorph(fv);
        let need = 2 * FABRIK_GRID + 3 * FABRIK_PIN_W;
        let h = fv.getBounds().height();
        fv.setBounds(rect(fv.getBounds().topLeft.x, fv.getBounds().topLeft.y, 220, 16));
        let h2 = fv.getBounds().height();
        let a = fabrikPinNamed(fv, 'a');
        let c = fabrikPinNamed(fv, 'c');
        let ay = a.getBounds().topLeft.y;
        let cb = c.getBounds().topLeft.y + c.getBounds().height();
        let gap = c.getBounds().topLeft.y - (a.getBounds().topLeft.y + a.getBounds().height());
        return [
          h >= need,
          h2 >= need,
          ay >= FABRIK_GRID - 1,
          cb <= h2 - FABRIK_GRID + 1,
          gap >= 0,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true');
  }, 20000);

  it('list halo follows the pane frame, not the text extent', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let list = Lively.get('classNames');
        let frame = list.boundsInWorld();
        let halo = list.contentPane.clippedBoundsInWorld();
        let contentH = list.contentPane.getBounds().height();
        return [
          Math.abs(halo.height() - frame.height()) < 3,
          contentH > frame.height() + 8 || list.contentPane.itemList.length < 8,
        ].join(',');
      })()`),
    ).toBe('true,true');
  }, 20000);

  it('offers make a Fabrik part for globals and Open Fabrik on the world menu', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        let wm = Lively.get('worldMenu');
        let spec = methodSelectorPaneMenuSpec({ selectedClass: 'globals', selectedMethod: 'classNamed' });
        let items = typeof spec.items === 'function' ? spec.items() : spec.items;
        let hasMake = false;
        for (let i = 0; i < items.length; i++) if (items[i] == 'make a Fabrik part') hasMake = true;
        let noMake = methodSelectorPaneMenuSpec({ selectedClass: 'Ellipse', selectedMethod: 'moveBy' });
        let noItems = typeof noMake.items === 'function' ? noMake.items() : noMake.items;
        let hasOnClass = false;
        for (let i = 0; i < noItems.length; i++) if (noItems[i] == 'make a Fabrik part') hasOnClass = true;
        let fv = fabrikPartFromGlobalName('classNamed', pt(20, 20));
        let src = fv && fv.contentPane && fv.contentPane.shape ? fv.contentPane.shape.string : '';
        let pin = fv ? fabrikPinNamed(fv, 'name') : null;
        let openIx = wm && wm.findItem ? wm.findItem('Open Fabrik') : -1;
        let transIx = wm && wm.findItem ? wm.findItem('transcript') : -1;
        let demoSrc = Lively.get('classNamed').contentPane.shape.string || '';
        let bin = Lively.get('fabrikBin');
        let listProto = bin.findKindIn('views', 'listView');
        let fnProto = bin.findKindIn('views', 'functionView');
        let vm = Lively.get('fabrikViewMenu');
        let belowGap = vm
          ? vm.getBounds().topLeft.y - (wm.getBounds().topLeft.y + wm.getBounds().height())
          : -1;
        return [
          !!wm,
          wm.getBounds().width() <= 205,
          Math.abs(wm.getBounds().topLeft.y - 20) < 8,
          Math.abs(wm.getBounds().topLeft.x - 20) < 8 && Math.abs(vm.getBounds().topLeft.x - 20) < 8,
          !!(vm && vm.findItem && vm.findItem('user view') >= 0 && vm.findItem('layout view') >= 0 && vm.findItem('make new panel') >= 0 && vm.findItem('clear parts') >= 0),
          Math.abs(belowGap - 20) < 8,
          openIx >= 0 && openIx < transIx,
          hasMake,
          !hasOnClass,
          src.indexOf('function classNamed') >= 0,
          !!pin,
          demoSrc.indexOf('function classNamed') >= 0,
          !!(listProto && listProto.fabrikList && listProto.fabrikList.length === 3),
          !!(fnProto && ('' + fnProto.fabrikSource).indexOf('=>') >= 0),
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('clear parts removes world parts and wires but keeps the parts bin', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let hadCats = !!Lively.get('categories');
        let hadWires = Lively.fabrikWires.length >= 9;
        let vm = Lively.get('fabrikViewMenu');
        vm.setSelectionString('clear parts');
        let leftover = 0;
        Lively.eachSubmorph(function (m) {
          if (m.owner !== Lively) return;
          if (m.className === 'FabrikFunctionView' || m.className === 'FabrikListView' || m.className === 'FabrikTextView') leftover = leftover + 1;
        });
        let bin = Lively.get('fabrikBin');
        let proto = bin && bin.findKindIn('views', 'textView');
        return [
          hadCats,
          hadWires,
          vm.findItem('clear parts') >= 0,
          leftover === 0,
          !Lively.get('categories'),
          Lively.fabrikWires.length === 0,
          !!(bin && bin.className === 'FabrikBin' && bin.world() === Lively),
          !!(proto && proto.isFabrikProto),
          !!(Lively.get('worldMenu') && Lively.get('fabrikViewMenu')),
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('parts bin lists shapes, parts, and views in a scrollable pane', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let bin = Lively.get('fabrikBin');
        let bb = bin.getBounds();
        let binXBefore = bb.topLeft.x;
        let star = bin.findKind('star');
        let line = bin.findKind('line');
        let protoStar = new Pen().star(10, 30, Color.black);
        let starMatch =
          star &&
          star.shape &&
          star.shape.vertices &&
          protoStar.vertices &&
          star.shape.vertices.length === protoStar.vertices.length;
        if (line && line.updateHoverHandles) line.updateHoverHandles(line.boundsInWorld().center());
        let noHandles = !(line && line.$vertexHandles && line.$vertexHandles.length);
        let lineHitBox = line && line.fullBounds && line.fullBounds();
        let lineHit =
          !!lineHitBox &&
          lineHitBox.height() >= 24 &&
          line.includesPt(lineHitBox.center());
        let lineCopy = line ? fabrikStamp(line, Lively, pt(80, 80)) : null;
        let lineCloned = !!(lineCopy && lineCopy.className === 'LineMorph' && lineCopy.owner === Lively);
        if (lineCopy && lineCopy.remove) lineCopy.remove();
        let parts = bin.$binCats.parts;
        let partKids = 0;
        let hiddenKids = 0;
        if (bin.partsPane && bin.partsPane.contentPane)
          bin.partsPane.contentPane.eachSubmorph(function (m) {
            if (!m.$fabrikHidden) partKids = partKids + 1;
            else hiddenKids = hiddenKids + 1;
          });
        let partSrc = parts && parts[0] && parts[0].fabrikSource ? '' + parts[0].fabrikSource : '';
        let pane = bin.partsPane;
        let pb = pane.boundsInWorld();
        let emptyWorld = pt(pb.topLeft.x + pb.width() - 40, pb.topLeft.y + pb.height() - 40);
        Lively.onPointerDown(emptyWorld, { actorID: 't' });
        Lively.onPointerMove(pt(emptyWorld.x + 30, emptyWorld.y + 20), { actorID: 't' });
        let paneStayed = pane.owner === bin && pane.contentPane && pane.contentPane.owner === pane;
        Lively.onPointerUp(pt(emptyWorld.x + 30, emptyWorld.y + 20), { actorID: 't' });
        let listProto = bin.findKindIn('views', 'listView');
        let textProto = bin.findKindIn('views', 'textView');
        let fnDummy = bin.findKindIn('views', 'functionView');
        let listStr = listProto && listProto.contentPane && listProto.contentPane.shape ? '' + listProto.contentPane.shape.string : '';
        let textStr = textProto && textProto.contentPane && textProto.contentPane.shape ? '' + textProto.contentPane.shape.string : '';
        let holderH = pane.contentPane ? pane.contentPane.getBounds().height() : 0;
        let worldR = Lively.getBounds().topLeft.x + Lively.getBounds().width();
        let shapes = bin.$binCats.shapes || [];
        let shapeRow =
          shapes.length >= 2 &&
          Math.abs(shapes[0].getBounds().topLeft.y - shapes[1].getBounds().topLeft.y) < 8;
        let fp0 = shapes[0] && fabrikBinFootprint(shapes[0]);
        let fp1 = shapes[1] && fabrikBinFootprint(shapes[1]);
        let shapeSpread =
          !!(fp0 && fp1) &&
          (fp0.topLeft.x + fp0.width() + 8 <= fp1.topLeft.x ||
            fp0.topLeft.y + fp0.height() + 8 <= fp1.topLeft.y ||
            fp1.topLeft.x + fp1.width() + 8 <= fp0.topLeft.x ||
            fp1.topLeft.y + fp1.height() + 8 <= fp0.topLeft.y);
        let partFp = parts[0] && fabrikBinFootprint(parts[0]);
        let shapeVsPart =
          !!(partFp && fp0) &&
          (partFp.topLeft.x + partFp.width() + 8 <= fp0.topLeft.x ||
            partFp.topLeft.y + partFp.height() + 8 <= fp0.topLeft.y ||
            fp0.topLeft.x + fp0.width() + 8 <= partFp.topLeft.x ||
            fp0.topLeft.y + fp0.height() + 8 <= partFp.topLeft.y);
        return [
          bin.className === 'FabrikBin',
          !bin.categoryPane,
          Math.abs(bb.width() - 370) < 2,
          Math.abs(bb.topLeft.x + bb.width() + 10 - worldR) < 8,
          Math.abs(bin.getBounds().topLeft.x - binXBefore) < 1,
          !!starMatch,
          noHandles && lineHit && lineCloned,
          !!(parts && parts.length === 5),
          partKids === 14 && hiddenKids === 0,
          partSrc.indexOf('browserCategoryNames') >= 0,
          bin.partsPane && bin.partsPane.className === 'FabrikBinPartsPane' && !!bin.partsPane.scrollByLines,
          paneStayed,
          !!(listProto && listProto.fabrikList && listProto.fabrikList.length === 3),
          !!(fnDummy && ('' + fnDummy.fabrikSource).indexOf('=>') >= 0),
          !!(parts[0] && parts[0].$fabrikShowPins && parts[0].$fabrikPinLabels === false && fabrikPinNamed(parts[0], 'result')),
          fabrikFunctionHeading(parts[2]) === 'classNamed(s)',
          fabrikBinProtoLabel(fnDummy) === 'JS function(args)',
          !!(listProto.className === 'FabrikListView' && fabrikPinNamed(listProto, 'strings') && fabrikPinNamed(listProto, 'selection')),
          listStr.indexOf('several') >= 0 && listStr.indexOf('items in') >= 0 && listStr.indexOf('a list') >= 0,
          textStr.indexOf('normal JS') >= 0 && textStr.indexOf('text in a string') >= 0,
          listProto.getBounds().height() > 48,
          Math.abs(parts[0].getBounds().width() - fabrikHeadingPixelWidth(fabrikBinProtoLabel(parts[0]))) < 4,
          Math.abs(listProto.getBounds().width() - fabrikBinProtoHugWidth(listProto)) < 4 &&
            Math.abs(textProto.getBounds().width() - fabrikBinProtoHugWidth(textProto)) < 4 &&
            listProto.getBounds().width() < bb.width() - 80,
          Math.abs(parts[0].getBounds().topLeft.x - 32) < 4,
          !!(parts[0].shape && parts[0].shape.borderWidth === 2 && listProto.shape && listProto.shape.borderWidth === 2) &&
            holderH >= shapes[shapes.length - 1].getBounds().topLeft.y + shapes[shapes.length - 1].getBounds().height() &&
            shapeRow &&
            shapeSpread &&
            shapeVsPart,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('stamped line vertex handles reshape without scaling, and be curved keeps vertices', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let proto = Lively.get('fabrikBin').findKind('line');
        let line = fabrikStamp(proto, Lively, pt(80, 80));
        line.dragEnded = fabrikPartDragEnded;
        fabrikEstablishPartFrames(line);
        let verts = line.shape.vertices;
        let dx0 = verts[1].x - verts[0].x;
        let dy0 = verts[1].y - verts[0].y;
        let sc = line.transform.scale;
        let snapKept = verts.length === 2 && dx0 > 30 && Math.abs(dy0) < 6;
        let scaleOk = !!(sc && Math.abs(sc.x - 1) < 0.01 && Math.abs(sc.y - 1) < 0.01);
        let noFabrikDown = line.onPointerDown !== fabrikPartOnPointerDown;
        let endLocal = verts[1];
        let endW = line.globalize(endLocal);
        line.updateHoverHandles(endW);
        let handlesOn = !!(line.$vertexHandles && line.$vertexHandles.length === 2);
        Lively.onPointerDown(endW, { actorID: 't' });
        let dragPt = pt(endW.x + 24, endW.y + 16);
        Lively.onPointerMove(dragPt, { actorID: 't' });
        Lively.onPointerUp(dragPt, { actorID: 't' });
        let sc1 = line.transform.scale;
        let scaleStill = !!(sc1 && Math.abs(sc1.x - 1) < 0.01 && Math.abs(sc1.y - 1) < 0.01);
        let end1 = line.globalize(line.shape.vertices[1]);
        let endMoved = Math.abs(end1.x - endW.x) > 8 || Math.abs(end1.y - endW.y) > 8;
        line.updateHoverHandles(line.globalize(line.shape.vertices[0].addPt(line.shape.vertices[1]).scaleBy(0.5)));
        let mid = line.$midpointHandles && line.$midpointHandles[0];
        let midW = mid ? line.globalize(mid.getBounds().center()) : null;
        if (midW) {
          Lively.onPointerDown(midW, { actorID: 't' });
          Lively.onPointerMove(pt(midW.x, midW.y - 28), { actorID: 't' });
          Lively.onPointerUp(pt(midW.x, midW.y - 28), { actorID: 't' });
        }
        let nSeg = line.shape.vertices.length;
        let curvedOk = false;
        let curved = false;
        let vertsKept = false;
        try {
          let menu = line.morphMenu();
          menu.onSelect('be curved', line);
          curved = !!(line.shape && line.shape.curved);
          vertsKept = !!(line.shape.vertices && line.shape.vertices.length >= 3);
          Lively.renderOn(ctx);
          curvedOk = true;
        } catch (e) {
          curvedOk = false;
        }
        return [snapKept, scaleOk, noFabrikDown, handlesOn, scaleStill, endMoved, nSeg >= 3, curved, vertsKept, curvedOk].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('parts-bin line be curved via halo menu pointer-up does not throw', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let proto = Lively.get('fabrikBin').findKind('line');
        let line = fabrikStamp(proto, Lively, pt(80, 80));
        let err = '';
        let curved = false;
        try {
          line.showMorphMenuAt(pt(120, 40), { fleeting: true });
          let menu = line.menu;
          if (!menu) return 'no-menu';
          let b = menu.getBounds();
          let lh = (menu.shape && menu.shape.lineHeight) || 16;
          let insetY = menu.shape && menu.shape.inset ? menu.shape.inset.y : 2;
          let p = pt(b.topLeft.x + 24, b.topLeft.y + insetY + lh * 0.5);
          menu.onPointerDown(p, { actorID: 't', shiftKey: false });
          menu.onPointerUp(p, { actorID: 't', shiftKey: false });
          curved = !!(line.shape && line.shape.curved);
        } catch (e) {
          err = String(e && e.message ? e.message : e);
        }
        return [err === '', curved, err].join('|');
      })()`),
    ).toBe('true|true|');
  }, 20000);

  it('starts from populateLively; Open Fabrik rebuilds the browser test', () => {
    const { rt } = makePopulatedFabrik();
    expect(
      rt.eval(`(() => {
        let menus = [];
        Lively.eachSubmorph(function (m) {
          if (m.className === 'MenuMorph') menus.push(m);
        });
        let openBefore = false;
        for (let i = 0; i < menus.length; i++) {
          if (menus[i].findItem && menus[i].findItem('Open Fabrik') >= 0) openBefore = true;
        }
        let hadBox = !!Lively.box;
        let hadFabrik = !!Lively.get('categories');
        openFabrik();
        let afterOpen = !Lively.get('categories') && !!Lively.get('fabrikBin') && !!Lively.get('fabrikViewMenu');
        fabrikTest();
        let again = Lively.get('categories');
        openFabrik();
        fabrikTest();
        let wm = Lively.get('worldMenu');
        return [
          hadBox,
          !hadFabrik,
          openBefore,
          afterOpen,
          !!again,
          !!Lively.get('categories') && !Lively.get('fabrikBrowser'),
          !!(wm && wm.findItem && wm.findItem('Open Fabrik') >= 0),
          Lively.fabrikWires.length >= 9,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true');
  }, 20000);

  it('wires attach at the out tip and the in pin outer flat; pb views drop on pointer up', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let cats = Lively.get('categories');
        let inPin = fabrikPinNamed(cats, 'strings');
        let outPin = fabrikPinNamed(cats, 'selection');
        let inW = fabrikPinCenterWorld(inPin);
        let outW = fabrikPinCenterWorld(outPin);
        let inB = inPin.boundsInWorld();
        let outB = outPin.boundsInWorld();
        let proto = Lively.get('fabrikBin').findKindIn('views', 'listView');
        let copy = fabrikStamp(proto, Lively, pt(80, 80));
        copy.beginPointerDrag(pt(80, 80), { actorID: 't' });
        copy.onPointerMove(pt(140, 120), { actorID: 't' });
        copy.onPointerUp(pt(140, 120), { actorID: 't' });
        let worldX = copy.boundsInWorld().topLeft.x;
        let clsOut = fabrikPinNamed(Lively.get('classNamed'), 'result');
        let methIn = fabrikPinNamed(Lively.get('methodsOfClass'), 'cls');
        let wire = null;
        for (let i = 0; i < Lively.fabrikWires.length; i++) {
          let w = Lively.fabrikWires[i];
          if (w.fromPin === clsOut && w.toPin === methIn) wire = w;
        }
        let clsOutW = fabrikPinCenterWorld(clsOut);
        let methInW = fabrikPinCenterWorld(methIn);
        let stubOut = fabrikWireStubWorld(clsOut);
        let stubIn = fabrikWireStubWorld(methIn);
        let cOut = fabrikWireControlWorld(clsOut, methIn, true);
        let cIn = fabrikWireControlWorld(clsOut, methIn, false);
        fabrikSetView('edit', Lively);
        let editHit = !!(wire && wire.includesPt(stubOut));
        fabrikSetView('layout', Lively);
        let layoutHit = !!(wire && wire.includesPt(stubOut));
        fabrikSetView('edit', Lively);
        let fv = new FabrikFunctionView(rect(40, 40, 220, 40), {
          source: 'function () { return "constOk"; }',
          inputs: [],
        });
        Lively.addMorph(fv);
        let tv = new FabrikTextView(rect(40, 90, 180, 40));
        Lively.addMorph(tv);
        fabrikConnect(fabrikPinNamed(fv, 'result'), fabrikPinNamed(tv, 'text'));
        let emitted = tv.contentPane && tv.contentPane.shape ? tv.contentPane.shape.string : '';
        let bin = Lively.get('fabrikBin');
        bin.showCategory('parts');
        let protoA = bin.findKindIn('parts', 'functionView');
        let protoB = (bin.$binCats.parts && bin.$binCats.parts[1]) || protoA;
        let srcPart = fabrikStamp(protoA, Lively, pt(90, 220));
        srcPart.beginPointerDrag(pt(90, 220), { actorID: 't' });
        srcPart.onPointerMove(pt(120, 250), { actorID: 't' });
        srcPart.onPointerUp(pt(120, 250), { actorID: 't' });
        let dstPart = fabrikStamp(protoB, Lively, pt(380, 220));
        dstPart.beginPointerDrag(pt(380, 220), { actorID: 't' });
        dstPart.onPointerMove(pt(410, 250), { actorID: 't' });
        dstPart.onPointerUp(pt(410, 250), { actorID: 't' });
        let srcOut = fabrikPinNamed(srcPart, 'result');
        let dstIn = fabrikPinNamed(dstPart, protoB.fabrikInputs && protoB.fabrikInputs[0] ? protoB.fabrikInputs[0].name : 'category');
        fabrikConnect(srcOut, dstIn);
        srcPart.beginPointerDrag(pt(120, 250), { actorID: 't' });
        srcPart.onPointerUp(pt(120, 250), { actorID: 't' });
        let srcSurvived = srcPart.owner === Lively && srcPart.world() === Lively && !srcPart.$fabrikHidden;
        let dstSurvived = dstPart.owner === Lively && dstPart.world() === Lively;
        return [
          inW.x <= inB.topLeft.x + 2,
          Math.abs(inW.y - (inB.topLeft.y + inB.height() / 2)) < 3,
          outW.x >= outB.topLeft.x + outB.width() - 2,
          Math.abs(outW.y - (outB.topLeft.y + outB.height() / 2)) < 3,
          !copy.$hitPoint,
          Lively.$pointerFocus == null,
          copy.world() === Lively,
          worldX > 90,
          !!(wire && wire.className === 'FabrikWire'),
          Math.abs(stubOut.x - (clsOutW.x + 20)) < 2,
          Math.abs(stubIn.x - (methInW.x - 20)) < 2,
          cOut.x > stubOut.x + 40,
          cIn.x < stubIn.x - 20,
          editHit,
          !layoutHit,
          emitted.indexOf('constOk') >= 0,
          srcSurvived,
          dstSurvived,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('dragging a pin live-wires compatible pins and cancels on miss', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let src = new FabrikFunctionView(rect(40, 420, 220, 40), {
          source: 'function () { return "liveOk"; }',
          inputs: [],
        });
        Lively.addMorph(src);
        let dst = new FabrikTextView(rect(320, 420, 180, 40));
        Lively.addMorph(dst);
        let dst2 = new FabrikTextView(rect(320, 480, 180, 40));
        Lively.addMorph(dst2);
        let out = fabrikPinNamed(src, 'result');
        let inn = fabrikPinNamed(dst, 'text');
        let inn2 = fabrikPinNamed(dst2, 'text');
        let otherOut = fabrikPinNamed(Lively.get('categories'), 'selection');
        let outHit = out.boundsInWorld().center();
        let inHit = inn.boundsInWorld().center();
        let in2Hit = inn2.boundsInWorld().center();
        let out2Hit = otherOut.boundsInWorld().center();
        let miss = pt(20, 560);
        let n0 = Lively.fabrikWires.length;
        Lively.onPointerDown(outHit, { actorID: 't' });
        let decidedLater = Lively.$fabrikWiringFrom == null && Lively.$pointerFocus === out;
        Lively.onPointerMove(inHit, { actorID: 't' });
        let rubberOn = !!(Lively.$fabrikRubber && Lively.$fabrikWiringFrom === out);
        let live1 = fabrikFindWire(out, inn);
        let fed1 = dst.contentPane && dst.contentPane.shape && ('' + dst.contentPane.shape.string).indexOf('liveOk') >= 0;
        Lively.onPointerMove(in2Hit, { actorID: 't' });
        let switched = !!fabrikFindWire(out, inn2) && !fabrikFindWire(out, inn);
        Lively.onPointerMove(out2Hit, { actorID: 't' });
        let noOutOut = !fabrikFindWire(out, otherOut) && !fabrikFindWire(out, inn2);
        Lively.onPointerMove(inHit, { actorID: 't' });
        Lively.onPointerUp(miss, { actorID: 't' });
        let canceled = !fabrikFindWire(out, inn) && !Lively.$fabrikWiringFrom && !Lively.$fabrikRubber;
        let nAfterCancel = Lively.fabrikWires.length;
        Lively.onPointerDown(outHit, { actorID: 't' });
        Lively.onPointerMove(inHit, { actorID: 't' });
        Lively.onPointerUp(inHit, { actorID: 't' });
        let committed = !!fabrikFindWire(out, inn) && !Lively.$fabrikWiringFrom;
        let pinStayed = Math.abs(src.getBounds().topLeft.x - 40) < 4;
        Lively.onPointerDown(inHit, { actorID: 't' });
        let clickNoPickup = !!fabrikFindWire(out, inn) && !Lively.$fabrikWiringFrom;
        Lively.onPointerMove(pt(inHit.x - 16, inHit.y), { actorID: 't' });
        let picked = Lively.$fabrikWiringFrom === out && !fabrikFindWire(out, inn);
        Lively.onPointerUp(miss, { actorID: 't' });
        let deleted = !fabrikFindWire(out, inn) && !Lively.$fabrikWiringFrom && clickNoPickup;
        let pinY0 = inn.getBounds().topLeft.y;
        Lively.onPointerDown(inHit, { actorID: 't' });
        Lively.onPointerMove(pt(inHit.x, inHit.y + 24), { actorID: 't' });
        Lively.onPointerUp(pt(inHit.x, inHit.y + 24), { actorID: 't' });
        let slid = Math.abs(inn.getBounds().topLeft.y - pinY0) > 8;
        let dstB = dst.boundsInWorld();
        let rightHit = pt(dstB.topLeft.x + dstB.width() + 4, dstB.topLeft.y + dstB.height() / 2);
        Lively.onPointerDown(inn.boundsInWorld().center(), { actorID: 't' });
        Lively.onPointerMove(rightHit, { actorID: 't' });
        Lively.onPointerUp(rightHit, { actorID: 't' });
        let inFacesIn = inn.$fabrikPinSide === 'r' && fabrikPinTipDir(inn) === 'l';
        let srcB = src.boundsInWorld();
        let leftHit = pt(srcB.topLeft.x - 4, srcB.topLeft.y + srcB.height() / 2);
        Lively.onPointerDown(out.boundsInWorld().center(), { actorID: 't' });
        Lively.onPointerMove(leftHit, { actorID: 't' });
        Lively.onPointerUp(leftHit, { actorID: 't' });
        let outFacesOut = out.$fabrikPinSide === 'l' && fabrikPinTipDir(out) === 'l';
        let topHit = pt(dstB.topLeft.x + dstB.width() / 2, dstB.topLeft.y - 4);
        Lively.onPointerDown(inn.boundsInWorld().center(), { actorID: 't' });
        Lively.onPointerMove(topHit, { actorID: 't' });
        Lively.onPointerUp(topHit, { actorID: 't' });
        let inOnTop = inn.$fabrikPinSide === 't' && fabrikPinTipDir(inn) === 'd';
        let body = src.boundsInWorld().center();
        let x0 = src.getBounds().topLeft.x;
        Lively.onPointerDown(body, { actorID: 't' });
        Lively.onPointerMove(pt(body.x + 20, body.y + 12), { actorID: 't' });
        Lively.onPointerUp(pt(body.x + 20, body.y + 12), { actorID: 't' });
        let listUntouched = Math.abs(src.getBounds().topLeft.x - x0) < 4;
        srcB = src.boundsInWorld();
        let moveH = pt(srcB.topLeft.x + srcB.width() - 2, srcB.topLeft.y + 2);
        Lively.onPointerDown(moveH, { actorID: 't' });
        Lively.onPointerMove(pt(moveH.x + 24, moveH.y + 16), { actorID: 't' });
        Lively.onPointerUp(pt(moveH.x + 24, moveH.y + 16), { actorID: 't' });
        let gx = src.getBounds().topLeft.x;
        let gy = src.getBounds().topLeft.y;
        let gridded = gx === fabrikGrid(gx) && gy === fabrikGrid(gy) && Math.abs(gx - x0) >= 8;
        let wb = src.boundsInWorld();
        let corner = pt(wb.topLeft.x + wb.width() - 2, wb.topLeft.y + wb.height() - 2);
        let w0 = src.getBounds().width();
        let h0 = src.getBounds().height();
        Lively.onPointerDown(corner, { actorID: 't' });
        Lively.onPointerMove(pt(corner.x + 24, corner.y + 16), { actorID: 't' });
        Lively.onPointerUp(pt(corner.x + 24, corner.y + 16), { actorID: 't' });
        let resized =
          src.getBounds().width() > w0 + 8 &&
          src.getBounds().height() > h0 &&
          src.getBounds().width() === fabrikGrid(src.getBounds().width()) &&
          src.contentPane.getBounds().width() >= src.getBounds().width() - 4;
        let proto = Lively.get('fabrikBin').findKindIn('views', 'textView');
        let stamped = fabrikStamp(proto, Lively, pt(83, 91));
        let sw = stamped.getBounds().width();
        let sh = stamped.getBounds().height();
        let sx = stamped.getBounds().topLeft.x;
        let extentGrid = sw === fabrikGrid(sw) && sh === fabrikGrid(sh) && sx === fabrikGrid(sx);
        fabrikEstablishPartFrames(stamped);
        let framesAtDrop = !!fabrikGetLayout(stamped, 'edit') && !fabrikGetLayout(stamped, 'layout');
        let tb = stamped.boundsInWorld();
        let stampMove = pt(tb.topLeft.x + tb.width() - 2, tb.topLeft.y + 2);
        let stampX0 = stamped.getBounds().topLeft.x;
        Lively.onPointerDown(stampMove, { actorID: 't' });
        Lively.onPointerMove(pt(stampMove.x + 32, stampMove.y), { actorID: 't' });
        Lively.onPointerUp(pt(stampMove.x + 32, stampMove.y), { actorID: 't' });
        let stampMoved = stamped.getBounds().topLeft.x;
        let didStampMove = Math.abs(stampMoved - stampX0) >= 8;
        fabrikSetView('layout', Lively);
        let layoutKept =
          didStampMove &&
          Math.abs(stamped.getBounds().topLeft.x - stampMoved) < 8 &&
          !stamped.$fabrikHidden;
        fabrikSetView('edit', Lively);
        return [
          decidedLater,
          rubberOn,
          !!(live1 && live1.className === 'FabrikWire'),
          fed1,
          switched,
          noOutOut,
          canceled,
          nAfterCancel === n0,
          committed,
          pinStayed,
          picked,
          deleted,
          slid,
          inFacesIn,
          outFacesOut,
          inOnTop,
          listUntouched,
          gridded,
          resized,
          extentGrid,
          framesAtDrop,
          layoutKept,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('make new panel is open until wrap user views adopts the enclosed parts', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('edit', Lively);
        let cats = Lively.get('categories');
        let defn = Lively.get('methodDefinition');
        let panel = fabrikMakeNewPanel(Lively);
        let menu = panel.morphMenu();
        let hasWrap = !!(menu && menu.items && menu.items.indexOf('wrap user views') >= 0);
        let tiny = panel.getBounds().width() <= 140 && panel.getBounds().height() <= 80;
        let mid = cats.boundsInWorld().center();
        let hitOpen = Lively.topMorphAt(mid);
        let pass = hitOpen !== panel && hitOpen !== panel.titleBar;
        let u = cats.boundsInWorld().union(defn.boundsInWorld());
        panel.setBounds(rect(u.topLeft.x - 8, u.topLeft.y - 30, u.width() + 16, u.height() + 40));
        let preview = panel.previewFrameLocal();
        let previewCovers = preview.width() > 80 && preview.height() > 80;
        panel.wrapUserViews();
        let wrappedManual = panel.$fabrikWrapped === true && cats.owner === panel && defn.owner === panel;
        panel.unwrapUserViews();
        fabrikSetView('user', Lively);
        let autoWrap = Lively.get('categories').owner === panel && panel.$fabrikWrapped === true;
        fabrikSetView('edit', Lively);
        let unwrapped = Lively.get('categories').owner === Lively && !panel.$fabrikWrapped;
        return [
          panel.className === 'FabrikPanel',
          !!(panel.shape && panel.shape.fillColor === Color.lightGray),
          tiny,
          hasWrap,
          cats.owner === Lively || pass,
          pass,
          previewCovers,
          wrappedManual,
          unwrapped,
          autoWrap,
          Lively.get('classNamesInCategory').owner === Lively,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);

  it('layout-mode panel dashed frame tracks Z scale 1:1', () => {
    const { rt } = makeFabrik();
    expect(
      rt.eval(`(() => {
        fabrikSetView('layout', Lively);
        let cats = Lively.get('categories');
        let defn = Lively.get('methodDefinition');
        let panel = fabrikMakeNewPanel(Lively);
        let u = cats.boundsInWorld().union(defn.boundsInWorld());
        panel.setBounds(rect(u.topLeft.x - 8, u.topLeft.y - 30, u.width() + 16, u.height() + 40));
        let sh0 = panel.shape.getBounds();
        let prev0 = panel.previewFrameLocal();
        let atRest = Math.abs(prev0.width() - sh0.width()) < 2 && Math.abs(prev0.height() - sh0.height()) < 2;
        panel.beginEphemeralTransform();
        panel.transform.scale.x = 2;
        panel.transform.scale.y = 2;
        if (panel.syncBoundsFromGeometry) panel.syncBoundsFromGeometry();
        let sh = panel.shape.getBounds();
        let prev = panel.previewFrameLocal();
        let localMatch = Math.abs(prev.width() - sh.width()) < 2 && Math.abs(prev.height() - sh.height()) < 2;
        let dashBR = panel.globalize(prev.bottomRight());
        let worldB = panel.boundsInWorld();
        let tracks =
          Math.abs(dashBR.x - worldB.bottomRight().x) < 3 &&
          Math.abs(dashBR.y - worldB.bottomRight().y) < 3;
        let notDouble = Math.abs(prev.width() - sh.width() * 2) > 8;
        return [atRest, localMatch, tracks, notDouble].join(',');
      })()`),
    ).toBe('true,true,true,true');
  }, 20000);

  it('parts-bin category clicks and proto clicks do not grow the doc', () => {
    const { rt, handle } = makeFabrik();
    const cat = opsDuring(handle, () => {
      rt.eval(`(() => {
        let bin = Lively.get('fabrikBin');
        bin.showCategory('parts');
        bin.showCategory('views');
        bin.showCategory('shapes');
        bin.showCategory('parts');
        bin.showCategory('views');
        bin.showCategory('shapes');
      })()`);
    });
    expect(cat.count, `category switches wrote ops:\n  ${cat.keys.join('\n  ')}`).toBe(0);
    rt.eval(`(() => {
      Lively.get('fabrikBin').showCategory('views');
      let proto = Lively.get('fabrikBin').findKindIn('views', 'listView');
      let c = proto.boundsInWorld().center();
      Lively.onPointerDown(c, { actorID: 't' });
      Lively.onPointerUp(c, { actorID: 't' });
    })()`);
    const click = opsDuring(handle, () => {
      rt.eval(`(() => {
        let proto = Lively.get('fabrikBin').findKindIn('views', 'listView');
        let c = proto.boundsInWorld().center();
        Lively.onPointerDown(c, { actorID: 't' });
        Lively.onPointerUp(c, { actorID: 't' });
      })()`);
    });
    expect(click.count, `proto click wrote ops:\n  ${click.keys.join('\n  ')}`).toBe(0);
    const stamp = opsDuring(handle, () => {
      rt.eval(`fabrikStamp(Lively.get('fabrikBin').findKindIn('views', 'textView'), Lively, pt(200, 80))`);
    });
    expect(stamp.count, `stamp wrote ${stamp.count} ops:\n  ${stamp.keys.slice(0, 40).join('\n  ')}`).toBeLessThan(1200);
    const back = opsDuring(handle, () => {
      rt.eval(`Lively.get('fabrikBin').showCategory('shapes')`);
    });
    expect(back.count, `back to shapes wrote ops:\n  ${back.keys.join('\n  ')}`).toBe(0);
    const paint = (n: number) => {
      rt.eval(`(() => { for (let i = 0; i < ${n}; i++) Lively.renderOn(ctx); })()`);
    };
    paint(1);
    const idleParts = opsDuring(handle, () => {
      rt.eval(`Lively.get('fabrikBin').showCategory('parts')`);
      paint(5);
    });
    expect(idleParts.count, `idle parts paint wrote ops:\n  ${idleParts.keys.join('\n  ')}`).toBe(0);
    const idleViews = opsDuring(handle, () => {
      rt.eval(`Lively.get('fabrikBin').showCategory('views')`);
      paint(5);
    });
    expect(idleViews.count, `idle views paint wrote ops:\n  ${idleViews.keys.join('\n  ')}`).toBe(0);
    rt.eval(`fabrikStamp(Lively.get('fabrikBin').findKindIn('parts', 'functionView'), Lively, pt(80, 320))`);
    paint(1);
    const idleAfterStamp = opsDuring(handle, () => {
      rt.eval(`Lively.get('fabrikBin').showCategory('shapes')`);
      paint(5);
    });
    expect(
      idleAfterStamp.count,
      `idle paint after stamp wrote ops:\n  ${idleAfterStamp.keys.join('\n  ')}`,
    ).toBe(0);
  }, 20000);
});
