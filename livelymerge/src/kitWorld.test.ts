/**
 * The Kit, phase 4 (kitdefs.js): geometry, layout, drawing, pointer input as
 * signals, drag and drop between containers, ticks — through the real frame path
 * (queued browser events -> kitFrame), with a stubbed canvas.
 */
import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

const KITDEFS = readFileSync(join(__dirname, '..', 'kitdefs.js'), 'utf8');

function makeKit() {
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  g.window = globalThis;
  const drawCalls: string[] = [];
  g.ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return (s: unknown) => ({ width: String(s ?? '').length * 10 });
        return (..._args: unknown[]) => {
          drawCalls.push(String(prop));
        };
      },
      set() {
        return true;
      },
    },
  );
  g.canvas = { width: 800, height: 600, style: {}, addEventListener() {}, tabIndex: 0 };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  rt.eval(KITDEFS);
  rt.eval('initUI()');
  let now = 1000;
  const frame = () => {
    now += 50;
    rt.eval(`kitFrame(${now})`);
  };
  const send = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    g._kitEvents.push({ type, offsetX: x, offsetY: y, button: 0, ...extra });
    frame();
  };
  const click = (x: number, y: number, extra: Record<string, unknown> = {}) => {
    send('pointerdown', x, y, extra);
    send('pointerup', x, y, extra);
  };
  const drag = (x0: number, y0: number, x1: number, y1: number) => {
    send('pointerdown', x0, y0);
    send('pointermove', x0 + 10, y0 + 10);
    send('pointermove', x1, y1);
    send('pointerup', x1, y1);
  };
  frame();
  return { rt, handle, send, click, drag, frame, drawCalls };
}

describe('Kit world (phase 4)', () => {
  it('clicking the +1 button increments the counter through its wire', () => {
    const { rt, click } = makeKit();
    // button at (170,44), 60x44 -> centre (200,66)
    click(200, 66);
    click(200, 66);
    expect(rt.eval(`kitWorld.find('number').get('count') + '|' + kitWorld.find('number').get('text')`)).toBe('2|2');
    expect(rt.eval(`$kit.lastError`)).toBe(null);
  });

  it('dragging the slider drives the dial and the readout', () => {
    const { rt, send } = makeKit();
    // slider at (30,150), 200x24; value v sits at x = 30 + 12 + v/100 * 176
    send('pointerdown', 30 + 12 + 88, 162);
    expect(rt.eval(`kitWorld.find('slider').get('value')`)).toBe(50);
    send('pointermove', 30 + 12 + 176 + 40, 200); // past the end, off the slider: still captured
    send('pointerup', 30 + 12 + 176 + 40, 200);
    expect(
      rt.eval(`[kitWorld.find('slider').get('value'), kitWorld.find('needle').get('rotation'),
        kitWorld.find('readout').get('text'), kitWorld.find('knob').get('x')].join(',')`),
    ).toBe('100,270,100,176');
  });

  it('the clock ticks', () => {
    const { rt } = makeKit();
    expect(rt.eval(`typeof kitWorld.find('secondHand').get('rotation')`)).toBe('number');
    expect(rt.eval(`typeof kitWorld.find('hourHand').get('rotation')`)).toBe('number');
  });

  it('drag a part off the shelf onto the world, then back; the row layout follows', () => {
    const { rt, drag } = makeKit();
    // shelf at (300,270), padding 10: red sits at (310,280), 40x40
    expect(rt.eval(`kitWorld.find('red').owner.name`)).toBe('shelf');
    drag(330, 300, 600, 500);
    expect(rt.eval(`[kitWorld.find('red').owner.name, kitWorld.find('shelf').parts.length,
      kitWorld.find('green').get('x'), kitWorld.find('red').get('x'), kitWorld.find('red').get('y')].join(',')`)).toBe(
      'world,1,10,580,480',
    );
    // drop it on the green ball: green doesn't accept drops, its shelf does
    drag(600, 500, 330, 300);
    expect(rt.eval(`[kitWorld.find('red').owner.name, kitWorld.find('shelf').parts.map(p => p.name).join('+'),
      kitWorld.find('red').get('x'), kitWorld.find('shelf').get('w')].join(',')`)).toBe('shelf,green+red,58,108');
  });

  it('hands go with the clock: dragging a hand moves the whole clock', () => {
    const { rt, drag } = makeKit();
    // clock at (60,270) 140x140; the hour hand starts at its centre (130,340)
    drag(135, 340, 435, 440);
    expect(rt.eval(`kitWorld.find('clock').get('x') + ',' + kitWorld.find('clock').get('y') + ',' + kitWorld.find('hourHand').owner.name`)).toBe(
      '360,370,clock',
    );
  });

  it('hit testing respects rotation and ovals', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let w = kitWorld;
  let r = [];
  r.push(w.partAt(62, 272) === w);          // corner of the clock's square, outside the oval
  r.push(w.partAt(130, 274) === w.find('clock')); // inside the oval, beyond the hands' reach
  let b = w.add(part({ name: 'bar', x: 500, y: 450, w: 100, h: 10, rotation: 90 }));
  r.push(w.partAt(550, 420) === b, w.partAt(510, 455) === w);
  return r.join(',');
})()`),
    ).toBe('true,true,true,true');
  });

  it('draws without errors', () => {
    const { rt, frame, drawCalls } = makeKit();
    frame();
    expect(rt.eval(`$kit.lastError`)).toBe(null);
    expect(drawCalls.includes('fillText')).toBe(true);
    expect(drawCalls.includes('ellipse')).toBe(true);
  });

  it('a script error is caught and shown, not fatal', () => {
    const { rt, click } = makeKit();
    rt.eval(`kitWorld.find('number').define('increment', function () { throw new Error('oops'); })`);
    click(200, 66);
    expect(rt.eval(`$kit.lastError`)).toBe('oops');
  });

  it('idle frames and pointer moves write nothing to the document', () => {
    const { rt, handle, frame, send } = makeKit();
    rt.eval(`kitWorld.find('clock').put('stepEvery', 0)`);
    frame();
    const heads = JSON.stringify(Automerge.getHeads(handle.doc() as any));
    for (let i = 0; i < 5; i++) frame();
    send('pointermove', 500, 500);
    send('pointermove', 520, 510);
    expect(JSON.stringify(Automerge.getHeads(handle.doc() as any))).toBe(heads);
  });

  it('re-evaluating kitdefs keeps the world and upgrades existing parts', () => {
    const { rt, click } = makeKit();
    click(200, 66);
    rt.eval(KITDEFS.replace("toString: function () {\n    return this.name != null ? \"a Part named '\"", "kitProbe: function () { return 'upgraded'; },\n  toString: function () {\n    return this.name != null ? \"a Part named '\""));
    expect(rt.eval(`kitWorld.find('number').get('count') + ',' + kitWorld.find('number').kitProbe() + ',' + (Object.getPrototypeOf(kitWorld) === Part)`)).toBe(
      '1,upgraded,true',
    );
  });

  it('dragging from the bin stamps an instance and leaves the prototype', () => {
    const { rt, drag } = makeKit();
    const pos = rt.eval(`(() => {
      let b = kitWorld.find('bin').find('box');
      let c = b.worldFromLocal(b.get('w') / 2, b.get('h') / 2);
      return [c.x, c.y, kitWorld.find('bin').parts.filter(function (p) { return p.name === 'box'; }).length];
    })()`) as [number, number, number];
    expect(pos[2]).toBe(1);
    drag(pos[0], pos[1], 450, 480);
    expect(
      rt.eval(`(() => {
        let proto = kitWorld.find('bin').find('box');
        let stamps = kitWorld.parts.filter(function (p) { return p.isLike(proto); });
        return [proto.owner.name, stamps.length, stamps[0].owner.name, stamps[0].isLike(proto), stamps[0].hasOwn('fill')].join(',');
      })()`),
    ).toBe('bin,1,world,true,false');
  });

  it('alt-click shows a halo; copy and delete work; resize changes size', () => {
    const { rt, click, send } = makeKit();
    click(200, 66, { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('button');
    const copyBtn = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'copy'; }); return [h.x + 2, h.y + 2]; })()`) as [number, number];
    click(copyBtn[0], copyBtn[1]);
    expect(rt.eval(`kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length`)).toBe(2);
    const del = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'del'; }); return [h.x + 2, h.y + 2]; })()`) as [number, number];
    click(del[0], del[1]);
    expect(rt.eval(`kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length + ',' + ($kit.haloTarget == null)`)).toBe('1,true');

    click(330, 300, { metaKey: true }); // red on the shelf
    const rz = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'resize'; }); return [h.x + 8, h.y + 8, $kit.haloTarget.get('w'), $kit.haloTarget.get('h')]; })()`) as number[];
    send('pointerdown', rz[0], rz[1]);
    send('pointermove', rz[0] + 20, rz[1] + 10);
    send('pointerup', rz[0] + 20, rz[1] + 10);
    expect(rt.eval(`kitWorld.find('red').get('w') > 40 && kitWorld.find('red').get('h') > 40`)).toBe(true);
  });

  it('halo wire button opens a picker that actually wires two parts', () => {
    const { rt, click } = makeKit();
    rt.eval(`
      kitWorld.add(part({ name: 'srcA', x: 400, y: 400, w: 40, h: 40, n: 0, fill: '#aaa' }));
      kitWorld.add(part({ name: 'dstB', x: 500, y: 400, w: 40, h: 40, n: 0, fill: '#aaa' }));
      kitOpenPicker(kitWorld.find('srcA'), kitWorld.find('dstB'), 410, 360);
    `);
    const picks = rt.eval(`(() => {
      let items = kitPickerItems();
      let o = items.find(function (i) { return i.kind === 'outlet' && i.name === 'n'; });
      let inn = items.find(function (i) { return i.kind === 'inlet' && i.name === 'n'; });
      return [o.x + 2, o.y + 2, inn.x + 2, inn.y + 2];
    })()`) as number[];
    click(picks[0], picks[1]);
    click(picks[2], picks[3]);
    expect(
      rt.eval(`kitWorld.find('srcA').set('n', 7); kitWorld.find('dstB').get('n') + ',' + ($kit.picker == null)`),
    ).toBe('7,true');
  });

  it('inspector lists slots, edits a script, and can inspect itself', () => {
    const { rt, click, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('number'))`);
    frame();
    expect(
      rt.eval(`(() => {
        let ins = kitWorld.find('inspector');
        let names = ins.find('rows').parts.map(function (r) { return r.get('slotName'); });
        return ins.get('target').name + ',' + names.includes('count') + ',' + names.includes('increment');
      })()`),
    ).toBe('number,true,true');
    rt.eval(`kitWorld.find('inspector').run('pick', 'increment')`);
    frame();
    rt.eval(`
      kitWorld.find('inspector').find('editor').set('text', 'function () { this.set("count", this.get("count") + 5); }');
      kitWorld.find('inspector').find('editor').run('accept');
    `);
    click(200, 66);
    expect(rt.eval(`kitWorld.find('number').get('count')`)).toBe(5);

    rt.eval(`kitInspect(kitWorld.find('inspector'))`);
    frame();
    expect(
      rt.eval(`(() => {
        let ins = kitWorld.find('inspector');
        let names = ins.find('rows').parts.map(function (r) { return r.get('slotName'); });
        return (ins.get('target') === ins) + ',' + names.includes('show') + ',' + names.includes('refresh');
      })()`),
    ).toBe('true,true,true');
  });

  it('finder search hits open the inspector', () => {
    const { rt, click, frame } = makeKit();
    rt.eval(`kitFind('increment')`);
    frame();
    const hit = rt.eval(`(() => {
      let h = kitWorld.find('finder').find('hits').parts[0];
      let p = h.worldFromLocal(10, 8);
      return [p.x, p.y, h.get('text')];
    })()`) as [number, number, string];
    expect(String(hit[2]).includes('increment')).toBe(true);
    click(hit[0], hit[1]);
    expect(rt.eval(`kitWorld.find('inspector').get('target').name`)).toBe('number');
  });

  it('a text field has a caret, replaces a selection, and arrows', () => {
    const { rt, send, frame } = makeKit();
    rt.eval(`
      let f = kitWorld.add(kitField({ name: 'note', x: 10, y: 10, w: 160, h: 24, text: 'abcd' }));
      $kit.focus = f;
      f.$caret = 4;
      f.$anchor = 4;
    `);
    send('keydown', 20, 20, { key: 'Backspace' });
    expect(rt.eval(`kitWorld.find('note').get('text') + '|' + kitWorld.find('note').$caret`)).toBe('abc|3');
    send('keydown', 20, 20, { key: 'ArrowLeft' });
    send('keydown', 20, 20, { key: 'ArrowLeft', shiftKey: true });
    send('keydown', 20, 20, { key: 'x' });
    expect(rt.eval(`kitWorld.find('note').get('text') + '|' + kitWorld.find('note').$caret`)).toBe('axc|2');
    rt.eval(`kitWorld.find('note').put('multiline', true); kitWorld.find('note').$caret = 2; kitWorld.find('note').$anchor = 2;`);
    send('keydown', 20, 20, { key: 'Enter' });
    expect(rt.eval(`kitWorld.find('note').get('text')`)).toBe('ax\nc');
    frame();
    expect(rt.eval(`$kit.lastError`)).toBe(null);
  });

  it('a tall text field scrolls so the caret stays in view', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
        let f = kitWorld.add(kitField({ name: 'long', x: 10, y: 10, w: 120, h: 36, multiline: true, text: 'a\\nb\\nc\\nd\\ne\\nf\\ng' }));
        $kit.focus = f;
        f.$caret = f.get('text').length;
        f.$anchor = f.$caret;
        kitTextRevealCaret(f);
        return f.$scrollY > 0 && kitScrollMax(f) > 0;
      })()`),
    ).toBe(true);
  });

  it('dragging across a text field selects, double-click completes the whole match', () => {
    const { rt, send, click } = makeKit();
    const pos = rt.eval(`(() => {
      let f = kitWorld.add(kitField({ name: 'note', x: 20, y: 20, w: 200, h: 24, text: 'hello world' }));
      let a = f.worldFromLocal(4, 12);
      let b = f.worldFromLocal(4 + 50, 12);
      let w = f.worldFromLocal(4 + 70, 12);
      let z = f.worldFromLocal(4, 12);
      return [a.x, a.y, b.x, b.y, w.x, w.y, z.x, z.y];
    })()`) as number[];
    send('pointerdown', pos[0], pos[1]);
    send('pointermove', pos[2], pos[3]);
    send('pointerup', pos[2], pos[3]);
    expect(rt.eval(`kitWorld.find('note').$anchor + ',' + kitWorld.find('note').$caret`)).toBe('0,5');

    click(pos[4], pos[5]);
    click(pos[4], pos[5]);
    expect(rt.eval(`kitTextRange(kitWorld.find('note')).lo + ',' + kitTextRange(kitWorld.find('note')).hi`)).toBe('6,11');

    click(pos[6], pos[7]);
    click(pos[6], pos[7]);
    expect(rt.eval(`kitTextRange(kitWorld.find('note')).lo + ',' + kitTextRange(kitWorld.find('note')).hi`)).toBe('0,11');
  });

  it('selectWord covers string ends, lines, brackets, quotes, and words', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
        function r(s, i) { let p = kitTextSelectWord(s, i); return p.lo + '-' + p.hi; }
        return [
          r('hello world', 0),
          r('hello world', 11),
          r('hello world', 1),
          r('ab\\ncd', 3),
          r('ab\\ncd', 2),
          r('foo(bar)', 4),
          r('foo(bar)', 7),
          r('x = "hi"', 5),
          r('a/*z*/b', 3),
        ].join(',');
      })()`),
    ).toBe('0-11,0-11,0-5,3-5,0-3,4-7,4-7,5-7,3-4');
  });

  it('shift-drag extends the nearer end of a selection', () => {
    const { rt, send } = makeKit();
    const pos = rt.eval(`(() => {
      let f = kitWorld.add(kitField({ name: 'note', x: 20, y: 20, w: 220, h: 24, text: 'abcdefghij' }));
      let a = f.worldFromLocal(4 + 20, 12);
      let b = f.worldFromLocal(4 + 80, 12);
      let c = f.worldFromLocal(4, 12);
      return [a.x, a.y, b.x, b.y, c.x, c.y];
    })()`) as number[];
    send('pointerdown', pos[0], pos[1]);
    send('pointermove', pos[2], pos[3]);
    send('pointerup', pos[2], pos[3]);
    expect(rt.eval(`kitTextRange(kitWorld.find('note')).lo + ',' + kitTextRange(kitWorld.find('note')).hi`)).toBe('2,8');

    send('pointerdown', pos[0], pos[1], { shiftKey: true });
    send('pointermove', pos[4], pos[5], { shiftKey: true });
    send('pointerup', pos[4], pos[5], { shiftKey: true });
    expect(rt.eval(`kitTextRange(kitWorld.find('note')).lo + ',' + kitTextRange(kitWorld.find('note')).hi`)).toBe('0,8');
  });

  it('bracket matching finds the mate or marks a lone bracket', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
        let a = kitTextBracketAt('foo(bar)', 4);
        let b = kitTextBracketAt('foo(bar', 4);
        let c = kitTextBracketAt('plain', 2);
        return [a.a, a.b, a.ok, b.ok, c == null].join(',');
      })()`),
    ).toBe('3,7,true,false,true');
  });

  it('clicking in a text field places the caret', () => {
    const { rt, click } = makeKit();
    const pos = rt.eval(`(() => {
      let f = kitWorld.add(kitField({ name: 'note', x: 20, y: 20, w: 200, h: 24, text: 'hello' }));
      let p = f.worldFromLocal(4 + 20, 12); // ~2 characters in (10px each in the stub)
      return [p.x, p.y];
    })()`) as number[];
    click(pos[0], pos[1]);
    expect(rt.eval(`$kit.focus && $kit.focus.name`)).toBe('note');
    expect(rt.eval(`kitWorld.find('note').$caret`)).toBe(2);
  });

  it('typing in a finder field then Enter runs search', () => {
    const { rt, send, frame } = makeKit();
    rt.eval(`kitFind()`);
    frame();
    const q = rt.eval(`(() => { let f = kitWorld.find('finder').find('query'); let p = f.worldFromLocal(8, 10); return [p.x, p.y]; })()`) as number[];
    send('pointerdown', q[0], q[1]);
    send('pointerup', q[0], q[1]);
    for (const ch of 'tick') send('keydown', q[0], q[1], { key: ch });
    send('keydown', q[0], q[1], { key: 'Enter' });
    expect(rt.eval(`kitWorld.find('finder').find('hits').parts.length > 0 && kitWorld.find('finder').find('query').get('text')`)).toBe('tick');
  });
});
