/**
 * The Kit kernel (kitdefs.js), headless: parts, slots, like, signals, wires,
 * names, copy/instance, search.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeKit() {
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  rt.eval(readFileSync(join(__dirname, '..', 'kitdefs.js'), 'utf8'));
  return { rt, handle };
}

describe('Kit kernel', () => {
  it('slots: own values, like-delegation, overrides', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let proto = part({ name: 'proto', color: 'red', size: 3 });
  let a = part({ like: proto, size: 5 });
  let r = [a.get('color'), a.get('size'), a.hasOwn('color'), a.slotNames().join('|')];
  proto.put('color', 'blue');
  r.push(a.get('color'));
  a.removeSlot('size');
  r.push(a.get('size'));
  let threw = false;
  try { proto.makeLike(a); } catch (e) { threw = true; }
  r.push(threw);
  return r.join(',');
})()`),
    ).toBe('red,5,false,size|color,blue,3,true');
  });

  it('signals run scripts and pass along wires; set fires only on change', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let log = [];
  let slider = part({ name: 'slider', value: 0 });
  let dial = part({ name: 'dial', angle: 0 });
  dial.define('onAngle', function (v) { this.put('seen', v); });
  wire(slider, 'value', dial, 'angle');
  slider.set('value', 10);
  log.push(dial.get('seen'));
  // a data inlet is set (and an action inlet is run)
  let label = part({ text: '' });
  wire(slider, 'value', label, 'text', v => 'v=' + v);
  slider.set('value', 20);
  log.push(label.get('text'));
  // unchanged value: no signal
  label.put('text', 'untouched');
  slider.set('value', 20);
  log.push(label.get('text'));
  // a transform answering undefined filters
  let evens = part({ n: 0 });
  wire(slider, 'value', evens, 'n', v => (v % 2 === 0 ? v : undefined));
  slider.set('value', 7);
  log.push(evens.get('n'));
  slider.set('value', 8);
  log.push(evens.get('n'));
  return log.join(',');
})()`),
    ).toBe('10,v=20,untouched,0,8');
  });

  it('a two-way wire loop settles instead of ringing', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let a = part({ v: 0 }), b = part({ v: 0 });
  wire(a, 'v', b, 'v'); wire(b, 'v', a, 'v');
  a.set('v', 42);
  return a.get('v') + ',' + b.get('v');
})()`),
    ).toBe('42,42');
  });

  it('scripts from text keep their source and run with this = part', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let counter = part({ count: 0 });
  counter.define('increment', 'function () { this.set("count", this.get("count") + 1); }');
  let button = part({ name: 'button' });
  wire(button, 'click', counter, 'increment');
  button.signal('click'); button.signal('click');
  return counter.get('count') + '|' + (counter.scriptSource('increment').indexOf('this.set') > 0) + '|' + counter.isScript('count');
})()`),
    ).toBe('2|true|false');
  });

  it('find: nearest named part, siblings before cousins', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let world = part({ name: 'world' });
  let clock = world.add(part({ name: 'clock' }));
  let face = clock.add(part({ name: 'face' }));
  let hourDeep = face.add(part({ name: 'hand', which: 'deep' }));
  let hand = clock.add(part({ name: 'hand', which: 'shallow' }));
  let other = world.add(part({ name: 'other' }));
  return [
    clock.find('hand').get('which'),
    face.find('hand').get('which'),
    other.find('face') === face,
    hand.find('clock') === clock,
    world.find('nope') === null,
    String(clock),
  ].join(',');
})()`),
    ).toBe("shallow,deep,true,true,true,a Part named 'clock'");
  });

  it('copy is independent; instance delegates; internal wires come along', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let bin = part({ name: 'bin' });
  let counter = bin.add(part({ name: 'counter' }));
  let num = counter.add(part({ name: 'number', count: 0 }));
  num.define('increment', function () { this.set('count', this.get('count') + 1); });
  let btn = counter.add(part({ name: 'button' }));
  wire(btn, 'click', num, 'increment');
  let outside = part({ hits: 0 });
  wire(btn, 'click', outside, 'hits', v => 1);

  let c = counter.copy();
  c.find('button').signal('click');
  let r = [c.find('number').get('count'), num.get('count'), c.find('button').wiresOut.length];

  let inst = counter.instance();
  r.push(inst.find('number').isLike(num), inst.find('number').hasOwn('increment'));
  inst.find('button').signal('click');
  r.push(inst.find('number').get('count'));
  // editing the prototype's script shows through in the instance
  num.define('increment', function () { this.set('count', this.get('count') + 10); });
  inst.find('button').signal('click');
  r.push(inst.find('number').get('count'));
  return r.join(',');
})()`),
    ).toBe('1,0,1,true,false,1,11');
  });

  it('kitSearch finds names, slot names, script text, and wires', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let world = part({ name: 'world' });
  let clock = world.add(part({ name: 'clock', label: 'tick tock' }));
  clock.define('onTick', function () { this.put('hourAngle', 1); });
  let w = wire(clock, 'tick', world, 'beat');
  w.setName('heartbeatWire');
  return kitSearch(world, 'tick').map(h => (h.part.name || '?') + ':' + h.slot + ':' + h.where).join(' ') +
    ' / ' + kitSearch(world, 'heartbeat').length;
})()`),
    ).toBe('clock:label:value clock:onTick:slot name / 1');
  });

  it('pt and rect: arithmetic, contains, part origin/extent', () => {
    const { rt } = makeKit();
    expect(
      rt.eval(`(() => {
  let a = pt(3, 4).add(pt(1, 2));
  let b = pt(a);
  let c = pt(1, 0).rot(Math.PI / 2);
  let r = rect(10, 20, 30, 40);
  let box = part({ bounds: rect(5, 7, 10, 20) });
  let p = box.worldFromLocal(2, 3);
  let q = box.worldFromLocal(pt(2, 3));
  box.put('origin', pt(8, 9));
  box.put('extent', pt(12, 16));
  return [
    a.x, a.y, b.x, b.y,
    Math.round(c.x * 1000) / 1000, Math.round(c.y * 1000) / 1000,
    r.contains(pt(10, 20)), r.contains(pt(40, 60)), r.contains(pt(9, 20)),
    r.center().x, r.center().y,
    box.origin().x, box.origin().y, box.extent().x, box.extent().y,
    box.bounds().w, box.bounds().h,
    p.x, p.y, q.x, q.y,
    String(pt(1, 2)), String(rect(0, 1, 2, 3)),
    Math.round(ptPolar(1, 0).scaleBy(pt(100, 40)).r()),
    Math.round(ptPolar(1, -Math.PI / 2).scaleBy(pt(100, 40)).r()),
  ].join(',');
})()`),
    ).toBe('4,6,4,6,0,1,true,true,false,25,40,8,9,12,16,12,16,7,10,7,10,pt(1, 2),rect(0, 1, 2, 3),100,40');
  });

  it('parts persist in the document and survive a reload', () => {
    const { rt, handle } = makeKit();
    rt.eval(`
kitWorld = part({ name: 'world' });
let s = kitWorld.add(part({ name: 'slider', value: 1 }));
let d = kitWorld.add(part({ name: 'dial', angle: 0 }));
wire(s, 'value', d, 'angle', v => v * 2);
`);
    const rt2 = createLivelymergeRuntime(handle);
    (globalThis as any).runtime = rt2;
    expect(
      rt2.eval(`(() => {
  kitWorld.find('slider').set('value', 21);
  return kitWorld.find('dial').get('angle');
})()`),
    ).toBe(42);
  });
});
