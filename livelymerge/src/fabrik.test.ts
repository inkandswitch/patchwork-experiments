/**
 * Fabrik.js on newdefs: parts bin, pins, and the bits-on-the-screen class browser.
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
    width: 800,
    height: 600,
    style: {},
    tabIndex: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
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
  return bootFabrik('initUI(); initFabrik();');
}

function makePopulatedFabrik() {
  return bootFabrik('initUI(); populateLively();');
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
  });

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
  });

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
  });

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
        let editGap = methods.getBounds().topLeft.x - (cats.getBounds().topLeft.x + cats.getBounds().width());
        let editDefGap = defn.getBounds().topLeft.y - (cats.getBounds().topLeft.y + cats.getBounds().height());
        fabrikSetView('user', Lively);
        cats = Lively.get('categories');
        classes = Lively.get('classNames');
        methods = Lively.get('methodNames');
        defn = Lively.get('methodDefinition');
        let userPad = cats.contentPane.transform.translation.x;
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
        let userOrigin = Lively.get('categories').getBounds().topLeft;
        fabrikSetView('wiring', Lively);
        let wiringGap = Lively.get('methodNames').getBounds().topLeft.x - (
          Lively.get('categories').getBounds().topLeft.x + Lively.get('categories').getBounds().width()
        );
        return [
          editPad >= 28 && editPad <= 32,
          editGap > 40 && editGap < 70,
          editDefGap > 40,
          userPad < 8,
          Math.abs(userVGap) < 6,
          Math.abs(userHGap) < 6,
          Math.abs(userDefGap) < 6,
          Math.abs(fnX - 50) < 3,
          Math.abs(editFnGap - 80) < 8,
          Math.abs(fn.getBounds().topLeft.y - 208) < 8,
          Math.abs(catGap - 50) < 8,
          Math.abs(userOrigin.x - 380) < 3,
          Math.abs(userOrigin.y - 108) < 8,
          pinRight <= 1,
          inGreen,
          outBlue,
          Lively.$fabrikViewMode === 'wiring',
          wiringGap > 40 && wiringGap < 70,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
  });

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
  });

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
  });

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
        let listProto = null;
        let fnProto = null;
        Lively.get('fabrikBin').eachSubmorph(function (m) {
          if (m.fabrikKind === 'listView') listProto = m;
          if (m.fabrikKind === 'functionView') fnProto = m;
        });
        let vm = Lively.get('fabrikViewMenu');
        let worldB = Lively.getBounds();
        let rightGap = worldB.topLeft.x + worldB.width() - (wm.getBounds().topLeft.x + wm.getBounds().width());
        let belowGap = vm
          ? vm.getBounds().topLeft.y - (wm.getBounds().topLeft.y + wm.getBounds().height())
          : -1;
        return [
          !!wm,
          wm.getBounds().width() <= 205,
          Math.abs(wm.getBounds().topLeft.y - 100) < 8,
          Math.abs(rightGap - 100) < 8,
          !!(vm && vm.findItem && vm.findItem('user view') >= 0 && vm.findItem('wiring') >= 0 && vm.findItem('make new panel') >= 0),
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
  });

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
        initFabrik();
        let again = Lively.get('categories');
        initFabrik();
        let wm = Lively.get('worldMenu');
        return [
          hadBox,
          !hadFabrik,
          openBefore,
          !!again,
          !!Lively.get('categories') && !Lively.get('fabrikBrowser'),
          !!(wm && wm.findItem && wm.findItem('Open Fabrik') >= 0),
          Lively.fabrikWires.length >= 9,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true');
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
        let proto = null;
        Lively.get('fabrikBin').eachSubmorph(function (m) {
          if (m.fabrikKind === 'listView') proto = m;
        });
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
        fabrikSetView('wiring', Lively);
        let wiringHit = !!(wire && wire.includesPt(stubOut));
        let fv = new FabrikFunctionView(rect(40, 40, 220, 40), {
          source: 'function () { return "constOk"; }',
          inputs: [],
        });
        Lively.addMorph(fv);
        let tv = new FabrikTextView(rect(40, 90, 180, 40));
        Lively.addMorph(tv);
        fabrikConnect(fabrikPinNamed(fv, 'result'), fabrikPinNamed(tv, 'text'));
        let emitted = tv.contentPane && tv.contentPane.shape ? tv.contentPane.shape.string : '';
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
          !editHit,
          wiringHit,
          emitted.indexOf('constOk') >= 0,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
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
        return [
          panel.className === 'FabrikPanel',
          tiny,
          hasWrap,
          cats.owner === Lively || pass,
          pass,
          previewCovers,
          panel.$fabrikWrapped === true,
          cats.owner === panel,
          defn.owner === panel,
          Lively.get('classNamesInCategory').owner === Lively,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true');
  });
});
