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
        kitWorld.find('readout').get('text'), kitWorld.find('knob').origin().x].join(',')`),
    ).toBe('100,270,100,176');
  });

  it('the clock ticks', () => {
    const { rt } = makeKit();
    expect(rt.eval(`typeof kitWorld.find('secondHand').get('rotation')`)).toBe('number');
    expect(rt.eval(`typeof kitWorld.find('hourHand').get('rotation')`)).toBe('number');
  });

  it('clock hands stay on the oval centre and scaleBy its extent', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
        let c = kitWorld.find('clock');
        c.put('stepEvery', 0);
        c.put('extent', pt(200, 80));
        let hr = c.find('hourHand');
        let hub = c.worldFromLocal(c.extent().scaleBy(0.5));
        let at = function (deg) {
          hr.setLocal('rotation', deg);
          let tip = hr.worldFromLocal(hr.extent());
          return [Math.round(tip.x - hub.x), Math.round(tip.y - hub.y)].join(',');
        };
        return at(0) + '|' + at(90);
      })()`),
    ).toBe('0,-20|50,0');
  });

  it('shelf layout is a script; row and column differ only by delta', () => {
    const { rt, frame } = makeKit();
    expect(
      rt.eval(`(() => {
        let r = kitWorld.find('bin').find('row');
        let c = kitWorld.find('bin').find('column');
        return [
          kitWorld.find('shelf').isScript('layout'),
          r.isScript('layout'),
          c.scriptSource('layout') === r.scriptSource('layout'),
          String(r.get('delta')),
          String(c.get('delta')),
        ].join(',');
      })()`),
    ).toBe('true,true,true,pt(1, 0),pt(0, 1)');
    rt.eval(`
      let r = kitWorld.add(kitMakeRow());
      r.put('origin', pt(10, 500));
      r.add(part({ name: 'a', extent: pt(20, 10) }));
      r.add(part({ name: 'b', extent: pt(30, 10) }));
      let c = kitWorld.add(kitMakeColumn());
      c.put('origin', pt(200, 500));
      c.add(part({ name: 'ca', extent: pt(20, 10) }));
      c.add(part({ name: 'cb', extent: pt(20, 12) }));
    `);
    frame();
    expect(
      rt.eval(`[kitWorld.find('a').origin().x, kitWorld.find('b').origin().x, kitWorld.find('ca').origin().y, kitWorld.find('cb').origin().y].join(',')`),
    ).toBe('10,38,10,28');
  });

  it('drag a part off the shelf onto the world, then back; the row layout follows', () => {
    const { rt, drag } = makeKit();
    // shelf at (300,270), padding 10: red sits at (310,280), 40x40
    expect(rt.eval(`kitWorld.find('red').owner.name`)).toBe('shelf');
    drag(330, 300, 600, 500);
    expect(rt.eval(`[kitWorld.find('red').owner.name, kitWorld.find('shelf').parts.length,
      kitWorld.find('green').origin().x, kitWorld.find('red').origin().x, kitWorld.find('red').origin().y].join(',')`)).toBe(
      'world,1,10,580,480',
    );
    // drop it on the green ball: green doesn't accept drops, its shelf does
    drag(600, 500, 330, 300);
    expect(rt.eval(`[kitWorld.find('red').owner.name, kitWorld.find('shelf').parts.map(p => p.name).join('+'),
      kitWorld.find('red').origin().x, kitWorld.find('shelf').extent().x].join(',')`)).toBe('shelf,green+red,58,108');
  });

  it('hands go with the clock: dragging a hand moves the whole clock', () => {
    const { rt, drag } = makeKit();
    // clock at (60,270) 140x140; the hour hand starts at its centre (130,340)
    drag(135, 340, 435, 440);
    expect(rt.eval(`kitWorld.find('clock').origin().x + ',' + kitWorld.find('clock').origin().y + ',' + kitWorld.find('hourHand').owner.name`)).toBe(
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
  let b = w.add(part({ name: 'bar', bounds: rect(500, 450, 100, 10), rotation: 90 }));
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
      let c = b.worldFromLocal(b.extent().scale(0.5));
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

  it('halo letter handles copy, stamp again, delete, and scale', () => {
    const { rt, click, send } = makeKit();
    click(200, 66, { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('button');
    const copyBtn = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'copy'; }); return [h.x + h.w / 2, h.y + h.h / 2]; })()`) as [number, number];
    click(copyBtn[0], copyBtn[1]);
    expect(rt.eval(`kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length`)).toBe(2);
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget !== kitWorld.find('button')`)).toBe(true);

    const copyAgain = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'copy'; }); return [h.x + h.w / 2, h.y + h.h / 2]; })()`) as [number, number];
    click(copyAgain[0], copyAgain[1]);
    expect(rt.eval(`kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length + ',' + !!$kit.haloTarget`)).toBe('3,true');

    const del = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'del'; }); return [h.x + h.w / 2, h.y + h.h / 2]; })()`) as [number, number];
    click(del[0], del[1]);
    expect(rt.eval(`kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length + ',' + ($kit.haloTarget == null)`)).toBe('2,true');

    click(330, 300, { metaKey: true }); // red on the shelf
    const rz = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'resize'; }); return [h.x + h.w / 2, h.y + h.h / 2, $kit.haloTarget.extent().x, $kit.haloTarget.extent().y]; })()`) as number[];
    send('pointerdown', rz[0], rz[1]);
    send('pointermove', rz[0] + 20, rz[1] + 10);
    send('pointerup', rz[0] + 20, rz[1] + 10);
    expect(rt.eval(`kitWorld.find('red').extent().x > 40 && kitWorld.find('red').extent().y > 40`)).toBe(true);
  });

  it('dragging the copy handle moves the new part and leaves the handle on it', () => {
    const { rt, click, send } = makeKit();
    click(200, 66, { metaKey: true });
    const pos = rt.eval(`(() => {
      let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'copy'; });
      return [h.x + h.w / 2, h.y + h.h / 2, kitWorld.find('button').origin().x, kitWorld.find('button').origin().y];
    })()`) as number[];
    send('pointerdown', pos[0], pos[1]);
    send('pointermove', pos[0] + 40, pos[1] + 30);
    send('pointerup', pos[0] + 40, pos[1] + 30);
    expect(
      rt.eval(`(() => {
        let orig = kitWorld.parts.filter(function (p) { return p.name === 'button'; })[0];
        let cpy = $kit.haloTarget;
        return [kitWorld.parts.filter(function (p) { return p.name === 'button'; }).length, cpy !== orig, cpy.origin().x !== orig.origin().x].join(',');
      })()`),
    ).toBe('2,true,true');
  });

  it('repeated halo click climbs to the owner, then the world, then clears', () => {
    const { rt, click } = makeKit();
    const pos = rt.eval(`(() => { let g = kitWorld.find('green'); let p = g.worldFromLocal(g.extent().scale(0.5)); return [p.x, p.y]; })()`) as number[];
    click(pos[0], pos[1], { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('green');
    click(pos[0], pos[1], { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('shelf');
    click(pos[0], pos[1], { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('world');
    click(40, 520, { metaKey: true });
    expect(rt.eval(`$kit.haloTarget`)).toBe(null);
  });

  it('the world halo is title-only and inspects; examples is a world script', () => {
    const { rt, click, frame } = makeKit();
    expect(
      rt.eval(`(() => {
        let ids = kitHaloItems(kitWorld).map(function (i) { return i.id; }).join(',');
        let hits = kitSearch(kitWorld, 'hourHand').map(function (h) { return (h.part.name || '?') + ':' + (h.slot || '') + ':' + h.where; });
        return [
          kitWorld.isScript('examples'),
          kitWorld.isScript('onOpen'),
          hits.some(function (h) { return h.indexOf('world:examples:script') === 0; }),
          ids,
          kitHaloFrame(kitWorld).x > kitWorld.origin().x,
        ].join(',');
      })()`),
    ).toBe('true,true,true,title,true');
    click(40, 520, { metaKey: true });
    expect(rt.eval(`$kit.haloTarget && $kit.haloTarget.name`)).toBe('world');
    const title = rt.eval(`(() => { let t = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'title'; }); return [t.x + t.w / 2, t.y + t.h / 2]; })()`) as number[];
    click(title[0], title[1]);
    frame();
    expect(
      rt.eval(`(() => {
        let ins = kitWorld.parts.filter(function (p) { return p.name === 'inspector'; }).pop();
        let names = ins.find('rows').parts.map(function (r) { return r.get('slotName'); });
        return (ins.get('target') === kitWorld) + ',' + names.includes('examples') + ',' + names.includes('onOpen');
      })()`),
    ).toBe('true,true,true');
  });

  it('halo wire button opens a picker that actually wires two parts', () => {
    const { rt, click } = makeKit();
    rt.eval(`
      kitWorld.add(part({ name: 'srcA', bounds: rect(400, 400, 40, 40), n: 0, fill: '#aaa' }));
      kitWorld.add(part({ name: 'dstB', bounds: rect(500, 400, 40, 40), n: 0, fill: '#aaa' }));
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

  it('inspector ticks so scale shows up in extent', () => {
    const { rt, click, send, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('red'))`);
    frame();
    click(330, 300, { metaKey: true });
    const rz = rt.eval(`(() => { let h = kitHaloItems($kit.haloTarget).find(function (i) { return i.id === 'resize'; }); return [h.x + h.w / 2, h.y + h.h / 2]; })()`) as number[];
    send('pointerdown', rz[0], rz[1]);
    send('pointermove', rz[0] + 24, rz[1] + 16);
    send('pointerup', rz[0] + 24, rz[1] + 16);
    expect(
      rt.eval(`(() => {
        let rows = kitWorld.find('inspector').find('rows').parts;
        let e = rows.find(function (r) { return r.get('slotName') === 'extent'; });
        return e.get('text') !== 'extent: pt(40, 40)';
      })()`),
    ).toBe(true);
  });

  it('a closer x dismisses the inspector', () => {
    const { rt, click, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('number'))`);
    frame();
    frame();
    const x = rt.eval(`(() => { let r = kitCloserRect(kitWorld.find('inspector')); return [r.x + r.w / 2, r.y + r.h / 2]; })()`) as number[];
    click(x[0], x[1]);
    expect(rt.eval(`kitWorld.find('inspector') == null`)).toBe(true);
  });

  it('opening an inspector leaves earlier ones in place', () => {
    const { rt, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('number'))`);
    frame();
    rt.eval(`kitWorld.find('inspector').put('rotation', 45)`);
    rt.eval(`kitInspect(kitWorld.find('button'))`);
    frame();
    expect(
      rt.eval(`(() => {
        let all = kitWorld.parts.filter(function (p) { return p.name === 'inspector'; });
        let a = all[0];
        let b = all[all.length - 1];
        return all.length + ',' + a.get('rotation') + ',' + a.get('target').name + ',' + b.get('rotation') + ',' + b.get('target').name;
      })()`),
    ).toBe('2,45,number,0,button');
  });

  it('inspector lists child parts; clicking one inspects it', () => {
    const { rt, click, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('clock'))`);
    frame();
    expect(
      rt.eval(`(() => {
        let rows = kitWorld.find('inspector').find('rows').parts;
        let parts = rows.filter(function (r) { return r.get('kind') === 'part'; }).map(function (r) { return r.$hitPart && r.$hitPart.name; });
        return parts.join(',');
      })()`),
    ).toBe('hourHand,minuteHand,secondHand');
    const hit = rt.eval(`(() => {
      let h = kitWorld.find('inspector').find('rows').parts.find(function (r) { return r.$hitPart && r.$hitPart.name === 'hourHand'; });
      let p = h.worldFromLocal(10, 8);
      return [p.x, p.y];
    })()`) as number[];
    click(hit[0], hit[1]);
    frame();
    expect(
      rt.eval(`(() => {
        let all = kitWorld.parts.filter(function (p) { return p.name === 'inspector'; });
        return all.length + ',' + all[all.length - 1].get('target').name;
      })()`),
    ).toBe('2,hourHand');
  });

  it('inspecting the clock does not rebuild inspector rows every tick', () => {
    const { rt, handle, frame } = makeKit();
    rt.eval(`kitInspect(kitWorld.find('clock'))`);
    frame();
    frame();
    frame();
    expect(
      rt.eval(`(() => {
        let rows = kitWorld.find('inspector').find('rows');
        $kit._row0 = rows.parts[0];
        return rows.parts.length;
      })()`),
    ).toBeGreaterThan(3);
    const headsBefore = Automerge.getHeads(handle.doc() as any);
    frame();
    frame();
    frame();
    frame();
    frame();
    expect(rt.eval(`kitWorld.find('inspector').find('rows').parts[0] === $kit._row0`)).toBe(true);
    const changes = Automerge.getChanges(
      Automerge.view(handle.doc() as any, headsBefore) as any,
      handle.doc() as any,
    );
    const keys: string[] = [];
    let count = 0;
    for (const ch of changes) {
      const dec = Automerge.decodeChange(ch);
      count += dec.ops.length;
      for (const op of dec.ops as any[]) {
        keys.push(`${op.action} key=${String(op.key ?? op.elemId ?? '?')} val=${JSON.stringify(op.value ?? '')}`.slice(0, 120));
      }
    }
    expect(count, `idle clock inspector ops:\n  ${keys.join('\n  ')}`).toBe(0);
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
        let all = kitWorld.parts.filter(function (p) { return p.name === 'inspector'; });
        let inner = all[0];
        let outer = all[all.length - 1];
        let names = outer.find('rows').parts.map(function (r) { return r.get('slotName'); });
        return all.length + ',' + (outer.get('target') === inner) + ',' + inner.get('target').name + ',' + names.includes('show') + ',' + names.includes('refresh');
      })()`),
    ).toBe('2,true,number,true,true');
  });

  it('finder search hits open the inspector', () => {
    const { rt, click, frame } = makeKit();
    rt.eval(`kitFind('increment')`);
    frame();
    const hit = rt.eval(`(() => {
      let hits = kitWorld.find('finder').find('hits').parts;
      let h = hits.find(function (p) { return (p.get('text') || '').indexOf('increment') >= 0; }) || hits[0];
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
      let f = kitWorld.add(kitField({ name: 'note', bounds: rect(10, 10, 160, 24), text: 'abcd' }));
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
    rt.eval(`
      kitWorld.find('note').define('accept', function () { this.put('saved', this.get('text')); });
      kitWorld.find('note').$caret = 2;
      kitWorld.find('note').$anchor = 2;
    `);
    send('keydown', 20, 20, { key: 'Enter', shiftKey: true });
    send('keydown', 20, 20, { key: 'Enter', metaKey: true });
    expect(rt.eval(`kitWorld.find('note').get('text') + ',' + kitWorld.find('note').get('saved')`)).toBe('ax\n\nc,undefined');
    send('keydown', 20, 20, { key: 'Enter' });
    expect(rt.eval(`kitWorld.find('note').get('saved')`)).toBe('ax\n\nc');
    frame();
    expect(rt.eval(`$kit.lastError`)).toBe(null);
  });

  it('a tall text field scrolls so the caret stays in view', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
        let f = kitWorld.add(kitField({ name: 'long', bounds: rect(10, 10, 120, 36), multiline: true, text: 'a\\nb\\nc\\nd\\ne\\nf\\ng' }));
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
      let f = kitWorld.add(kitField({ name: 'note', bounds: rect(20, 20, 200, 24), text: 'hello world' }));
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
      let f = kitWorld.add(kitField({ name: 'note', bounds: rect(20, 20, 220, 24), text: 'abcdefghij' }));
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
      let f = kitWorld.add(kitField({ name: 'note', bounds: rect(20, 20, 200, 24), text: 'hello' }));
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
