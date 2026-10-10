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

function makeFabrik() {
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
  rt.eval('initUI(); initFabrik();');
  return { rt, handle };
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
          !!fabrikPinNamed(fab, 'probe'),
          !!fabrikPinNamed(fab, 'categories'),
          !!fabrikPinNamed(Lively.get('categories'), 'strings'),
          !!fabrikPinNamed(Lively.get('classNames'), 'strings'),
          !!fabrikPinNamed(Lively.get('methodNames'), 'strings'),
          !!Lively.get('fabrikBrowser'),
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true');
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

  it('user view hugs and abuts; edit view leaves a wire gap without name gutters', () => {
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
        fabrikSetView('wiring', Lively);
        let wiringGap = Lively.get('methodNames').getBounds().topLeft.x - (
          Lively.get('categories').getBounds().topLeft.x + Lively.get('categories').getBounds().width()
        );
        return [
          editPad < 8,
          editGap > 40 && editGap < 70,
          editDefGap > 40,
          userPad < 8,
          Math.abs(userVGap) < 6,
          Math.abs(userHGap) < 6,
          Math.abs(userDefGap) < 6,
          Math.abs(outGap - 50) < 8,
          pinRight <= 1,
          inGreen,
          outBlue,
          userBw === 2,
          Lively.$fabrikViewMode === 'wiring',
          wiringGap > 40 && wiringGap < 70,
        ].join(',');
      })()`),
    ).toBe('true,true,true,true,true,true,true,true,true,true,true,true,true,true');
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
});
