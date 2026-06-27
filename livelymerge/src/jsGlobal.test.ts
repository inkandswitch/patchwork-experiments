import { beforeEach, describe, expect, it } from 'vitest';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';
import type { Obj } from './types';
import { createAutomergeTestDocHandle } from './testDocHandle';

const TEST_GLOBAL = 'lmTestJsBox';

function createFreshRuntime(): LivelymergeRuntime {
  return createLivelymergeRuntime(createAutomergeTestDocHandle());
}

function installTestJsGlobal(rt: LivelymergeRuntime) {
  (globalThis as Record<string, unknown>)[TEST_GLOBAL] = {
    count: 0,
    label: 'hello',
    inc() {
      this.count++;
    },
  };

  rt.change(() => {
    const doc = rt.doc();
    doc.objectTable['test-box'] = {
      $type: 'obj',
      $id: 'test-box',
      $jsGlobal: TEST_GLOBAL,
    };
    (doc.objectTable.global as Obj)['@testBox'] = { $type: 'ref', $id: 'test-box' };
  });
}

describe('jsGlobal proxies', () => {
  let rt: LivelymergeRuntime;

  beforeEach(() => {
    rt = createFreshRuntime();
  });

  it('reads properties from the JS global target', () => {
    installTestJsGlobal(rt);
    expect(rt.eval('$global.testBox.label')).toBe('hello');
    expect(rt.eval('$global.testBox.count')).toBe(0);
  });

  it('writes properties through to the JS global target', () => {
    installTestJsGlobal(rt);
    rt.eval('$global.testBox.count = 7');
    expect((globalThis as Record<string, { count: number }>)[TEST_GLOBAL].count).toBe(7);
    expect(rt.eval('$global.testBox.count')).toBe(7);
  });

  it('calls methods on the JS global target with correct this', () => {
    installTestJsGlobal(rt);
    rt.eval('$global.testBox.inc()');
    rt.eval('$global.testBox.inc()');
    expect(rt.eval('$global.testBox.count')).toBe(2);
  });

  it('exposes canvas, ctx, and document on $global by default', () => {
    (globalThis as Record<string, unknown>).canvas = { width: 640 };
    (globalThis as Record<string, unknown>).ctx = { lineWidth: 3 };
    expect(rt.eval('$global.canvas.width')).toBe(640);
    expect(rt.eval('$global.ctx.lineWidth')).toBe(3);
    expect(rt.eval('typeof $global.document')).toBe('object');
  });
});
