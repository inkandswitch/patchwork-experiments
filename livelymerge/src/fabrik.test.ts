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
        let fab = Lively.get('fabrik');
        return [
          !!Lively.isFabrikWorld,
          !!Lively.get('fabrikBin'),
          Lively.fabrikWires.length >= 9,
          !!Lively.$fabrikEditMode,
          Lively.$fabrikViewMode === 'edit',
          !!fab,
          !!(fab.modePane && ('' + (fab.modePane.contentPane && fab.modePane.contentPane.shape && fab.modePane.contentPane.shape.string)).indexOf('edit') >= 0),
          !!(fab.modePane && fab.modePane.paneMenu && fab.modePane.paneMenu.items && fab.modePane.paneMenu.items.indexOf('user view') >= 0),
          !!fabrikPinNamed(fab, 'probe'),
          !!fabrikPinNamed(fab, 'categories'),
          !!fabrikPinNamed(Lively.get('categories'), 'strings'),
          !!fabrikPinNamed(Lively.get('classNames'), 'strings'),
          !!fabrikPinNamed(Lively.get('methodNames'), 'strings'),
          !!Lively.get('fabrikBrowser'),
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
        fabrikReveal(Lively, 'All', 'Morph', 'addMorph');
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
        let browser = Lively.get('fabrikBrowser');
        let fn = Lively.get('classNamesInCategory');
        let outGap = fn.getBounds().topLeft.x - (browser.getBounds().topLeft.x + browser.getBounds().width());
        let inPin = fabrikPinNamed(cats, 'strings');
        let outPin = fabrikPinNamed(cats, 'selection');
        let pinRight = inPin.getBounds().topLeft.x + inPin.getBounds().width();
        let inGreen = inPin.shape.fillColor && inPin.shape.fillColor.g > inPin.shape.fillColor.b;
        let outBlue = outPin.shape.fillColor && outPin.shape.fillColor.b > outPin.shape.fillColor.g;
        fabrikSetView('user', Lively);
        let userBw = Lively.get('fabrik').shape.borderWidth;
        let userOrigin = Lively.get('fabrikBrowser').getBounds().topLeft;
        let fabY = Lively.get('fabrik').getBounds().topLeft.y;
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
          Math.abs(outGap - 100) < 8,
          Math.abs(fabY - 14) < 3,
          Math.abs(userOrigin.x - 232) < 3,
          Math.abs(userOrigin.y - 84) < 3,
          pinRight <= 1,
          inGreen,
          outBlue,
          userBw === 2,
          Lively.$fabrikViewMode === 'wiring',
          wiringGap > 40 && wiringGap < 70,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true');
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
        return [
          !!wm,
          wm.getBounds().width() <= 205,
          Math.abs(wm.getBounds().topLeft.x - 20) < 4,
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
    ).toBe('true,true,true,true,true,true,true,true,true,true,true');
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
        let hadFabrik = !!Lively.get('fabrikBrowser');
        initFabrik();
        let again = Lively.get('fabrikBrowser');
        initFabrik();
        let wm = Lively.get('worldMenu');
        return [
          hadBox,
          !hadFabrik,
          openBefore,
          !!again,
          !!Lively.get('fabrikBrowser'),
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
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true');
  }, 20000);
});
