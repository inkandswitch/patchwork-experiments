/**
 * Full-stack tests for per-user UI state: text/list selections, scroll positions,
 * and scrollbar state are $-properties (local + ephemeral), never in the Automerge
 * document.
 *
 * Uses the same browser stubs as newdefsDrag.test.ts: real transpiled newdefs.js,
 * real Automerge document.
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
        if (prop === 'querySelector')
          return (sel: string) => (sel === 'canvas' ? canvas : null);
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

function makeWorld() {
  installBrowserStubs();
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  rt.eval(src);
  rt.eval(`
initUI();
initLively();
// A scrollable text pane: 50 lines of 16px text inside a 100px-tall pane.
Lively.testPane = Lively.addMorph(new TextPane(rect(0, 0, 200, 100), rect(0, 0, 1, 1)));
Lively.testPane.setText('line of text\\n'.repeat(50), { force: true });
`);
  return { handle, rt };
}

function entryKeys(handle: any, rt: any, expr: string): string[] {
  const id = rt.eval(`(${expr}).$id`) as string;
  const entry = handle.doc().objectTable[id] as Record<string, unknown> | undefined;
  return entry ? Object.keys(entry) : [];
}

describe('per-user text selection', () => {
  it('selection lives in $-props on the TextBox and never reaches the document', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`Lively.testPane.contentPane.shape.setSelectionRange([2, 6]);`);
    // readable across transactions
    expect(rt.eval(`Lively.testPane.contentPane.shape.$selStart.strIx`)).toBe(2);
    expect(rt.eval(`Lively.testPane.contentPane.shape.$selStop.strIx`)).toBe(7);
    // no selection state in the shape's document entry
    const keys = entryKeys(handle, rt, `Lively.testPane.contentPane.shape`);
    const selKeys = keys.filter(
      (k) =>
        k.includes('selStart') ||
        k.includes('selStop') ||
        k.includes('selectedLineIndex') ||
        k.includes('priorNullSelection'),
    );
    expect(selKeys).toEqual([]);
  }, 60_000);

  it('typing state (paste/undo buffers) stays local too', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      let tb = Lively.testPane.contentPane.shape;
      tb.setSelectionRange([0, 3]);
      tb.paste('hello');
    `);
    expect(rt.eval(`Lively.testPane.contentPane.shape.string.startsWith('hello')`)).toBe(true);
    const keys = entryKeys(handle, rt, `Lively.testPane.contentPane.shape`);
    const typingKeys = keys.filter(
      (k) => k.includes('stringPutIn') || k.includes('stringTakenOut') || k.includes('duringTyping'),
    );
    expect(typingKeys).toEqual([]);
  }, 60_000);
});

describe('per-user scroll state', () => {
  it('scrolling sets $scrollOffsetY, not the shared transform', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`Lively.testPane.setScrollPosition(0.5);`);
    expect(rt.eval(`Lively.testPane.getScrollPosition()`)).toBeCloseTo(0.5, 2);
    expect(rt.eval(`Lively.testPane.contentPane.$scrollOffsetY`)).toBeLessThan(0);
    // the replicated transform is untouched
    expect(rt.eval(`Lively.testPane.contentPane.transform.translation.y`)).toBe(0);
    // and nothing scroll-related is in the contentPane's document entry
    const keys = entryKeys(handle, rt, `Lively.testPane.contentPane`);
    expect(keys.filter((k) => k.includes('scrollOffset'))).toEqual([]);
  }, 60_000);

  it('coordinate primitives include the per-user offset (globalize/localize roundtrip)', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.testPane.setScrollPosition(0.5);`);
    const offset = rt.eval(`Lively.testPane.contentPane.$scrollOffsetY`) as number;
    // world -> content-local undoes the scroll offset
    expect(rt.eval(`Lively.testPane.contentPane.localize(pt(10, 10)).y`)).toBeCloseTo(10 - offset, 6);
    // and the roundtrip is exact
    expect(
      rt.eval(`Lively.testPane.contentPane.globalize(Lively.testPane.contentPane.localize(pt(10, 10))).y`),
    ).toBeCloseTo(10, 6);
  }, 60_000);
});

describe('per-user scrollbar state', () => {
  it('the thumb is an ephemeral submorph and the value is a $-prop', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`Lively.testPane.scrollBar.setValue(0.25);`);
    expect(rt.eval(`Lively.testPane.scrollBar.getValue()`)).toBe(0.25);
    // thumb lives in the ephemeral layer...
    expect(rt.eval(`Lively.testPane.scrollBar.$thumb != null`)).toBe(true);
    expect(
      rt.eval(`Lively.testPane.scrollBar.ephemeralSubmorphs().includes(Lively.testPane.scrollBar.$thumb)`),
    ).toBe(true);
    // ...the persistent submorph list holds only the menu button
    expect(rt.eval(`Lively.testPane.scrollBar.submorphs.length`)).toBe(1);
    expect(rt.eval(`Lively.testPane.scrollBar.submorphs.at(0) === Lively.testPane.scrollBar.menuButton`)).toBe(
      true,
    );
    // ...and neither value nor thumb is in the scrollbar's document entry
    const keys = entryKeys(handle, rt, `Lively.testPane.scrollBar`);
    expect(keys.includes('@value')).toBe(false);
    expect(keys.filter((k) => k.includes('thumb'))).toEqual([]);
  }, 60_000);
});
