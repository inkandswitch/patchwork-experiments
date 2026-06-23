/**
 * UI-faithful eval tests — uses the same livelymergeRuntime + Automerge.change
 * path as the editor (Mod-d / Mod-p), NOT a parallel harness.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle, roundTripDocHandle } from './testDocHandle';

/** User's exact Pt example from the bug report. */
export const PT_SETUP = `class Pt {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}

const p1 = new Pt(1, 2);
const p2 = new Pt(3, 4);`;

/** Full block ending with bare p1 (Mod-p on selection). */
export const PT_PRINT_P1 = `${PT_SETUP}\np1`;

/** Full block ending with p1.toString(). */
export const PT_PRINT_TOSTRING = `${PT_SETUP}\np1.toString()`;

function createFreshRuntime(): LivelymergeRuntime {
  return createLivelymergeRuntime(createAutomergeTestDocHandle());
}

describe('UI eval: Pt toString (production runtime + Automerge doc)', () => {
  let rt: LivelymergeRuntime;

  beforeEach(() => {
    rt = createFreshRuntime();
  });

  // --- User's three reported outcomes ---

  it('case 1 (Mod-p): print-it selection ending with p1 → (1, 2)', () => {
    expect(rt.printIt(PT_PRINT_P1)).toBe('(1, 2)');
  });

  it('case 2 (Mod-p): print-it selection ending with p1.toString() → (1, 2)', () => {
    expect(rt.printIt(PT_PRINT_TOSTRING)).toBe('(1, 2)');
  });

  it('case 3 (Mod-d): eval p1.toString() after setup → (1, 2), not [object Object]', () => {
    rt.printIt(PT_SETUP);
    const raw = rt.eval('p1.toString()');
    expect(raw).toBe('(1, 2)');
    expect(raw).not.toBe('[object Object]');
  });

  it('case 3 (Mod-p): print-it p1.toString() after setup → (1, 2)', () => {
    rt.printIt(PT_SETUP);
    expect(rt.printIt('p1.toString()')).toBe('(1, 2)');
  });

  // --- Exact 3-step session from bug report ---

  it('full session: setup print p1, setup print toString, then lone p1.toString()', () => {
    expect(rt.printIt(PT_PRINT_P1)).toBe('(1, 2)');
    expect(rt.printIt(PT_PRINT_TOSTRING)).toBe('(1, 2)');
    expect(rt.eval('p1.toString()')).toBe('(1, 2)');
    expect(rt.printIt('p1.toString()')).toBe('(1, 2)');
  });

  // --- Mod-p formats AFTER change ends (proxies cleared, heap in Automerge doc) ---

  it('Mod-p formatEvalResult runs after change/gc with stale proxy reference', () => {
    const raw = rt.eval(`${PT_SETUP}\nreturn p1;`);
    expect(rt.formatEvalResult(raw)).toBe('(1, 2)');
  });

  // --- Automerge persist round-trip (like sync / reload) ---

  it('survives Automerge save/load between setup and eval', () => {
    let handle = createAutomergeTestDocHandle();
    const rt1 = createLivelymergeRuntime(handle);
    rt1.printIt(PT_SETUP);

    handle = roundTripDocHandle(handle);
    const rt2 = createLivelymergeRuntime(handle);

    expect(rt2.printIt('p1')).toBe('(1, 2)');
    expect(rt2.eval('p1.toString()')).toBe('(1, 2)');
  });
});

describe('UI eval: Automerge persist round-trip with state', () => {
  it('save/load preserves Pt class toString across new runtime', () => {
    let handle = createAutomergeTestDocHandle();
    const rt1 = createLivelymergeRuntime(handle);
    rt1.printIt(PT_SETUP);

    handle = roundTripDocHandle(handle);
    const rt2 = createLivelymergeRuntime(handle);

    expect(rt2.printIt('p1')).toBe('(1, 2)');
    expect(rt2.printIt('p1.toString()')).toBe('(1, 2)');
    expect(rt2.eval('p1.toString()')).toBe('(1, 2)');
  });
});

describe('UI eval: regression guards', () => {
  it('never prints [object Object] for Pt instances', () => {
    const rt = createFreshRuntime();
    rt.printIt(PT_SETUP);
    expect(rt.printIt('p1')).not.toBe('[object Object]');
    expect(rt.printIt('p1.toString()')).not.toBe('[object Object]');
    expect(rt.formatEvalResult(rt.eval('p1'))).not.toBe('[object Object]');
  });

  it('never prints [obj id] for Pt instances', () => {
    const rt = createFreshRuntime();
    const out = rt.printIt(PT_PRINT_P1);
    expect(out).not.toMatch(/^\[obj /);
    expect(out).toBe('(1, 2)');
  });

  it('print-it on p2.m shows user-written method source, not transpiled @-access', () => {
    const rt = createFreshRuntime();
    const setup = `class Pt {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  m() {
    return this.x + this.y;
  }

  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}

const p1 = new Pt(1, 2);
const p2 = new Pt(3, 4);`;
    rt.printIt(setup);
    const printed = rt.printIt('p2.m');
    expect(printed).toContain('return this.x + this.y');
    expect(printed).not.toContain("this['@x']");
  });
});
