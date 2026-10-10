//written on 2026-10-10 16:10 PDT
// Fabrik — application construction set on newdefs (Livelymerge Morphic).
// Parts bin, pins, wires, and a system browser with edit view / user view.
//
let FABRIK_WRITTEN_ON = '2026-10-10 16:10 PDT';
let FABRIK_EDIT_GAP = 50;
let FABRIK_PIN_W = 14;
let FABRIK_PIN_H = 12;

function fabrikViewMode(world) {
  world = world || Lively;
  if (world && world.$fabrikViewMode) return world.$fabrikViewMode;
  return world && world.$fabrikEditMode ? 'edit' : 'user';
}

function fabrikEditMode(world) {
  let m = fabrikViewMode(world);
  return m === 'edit' || m === 'wiring';
}

function fabrikWiringMode(world) {
  return fabrikViewMode(world) === 'wiring';
}

function fabrikSetEditMode(on, world) {
  fabrikSetView(on ? 'edit' : 'user', world);
}

function fabrikCategoryNames() {
  let names = typeof browserCategoryNames === 'function' ? browserCategoryNames() : [];
  let out = ['All'];
  for (let i = 0; i < names.length; i++) if (names[i] !== 'All') out.push(names[i]);
  return out;
}

function fabrikClassNamesInCategory(category) {
  if (typeof classNamesForBrowserCategory === 'function') return classNamesForBrowserCategory(category || 'All');
  return typeof allClassNames === 'function' ? allClassNames() : [];
}

function fabrikShowPart(m, show) {
  if (!m) return;
  m.$fabrikHidden = !show;
  if (m.changed) m.changed();
}

function fabrikLabel(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (typeof x === 'function' && x.name) return x.name;
  if (typeof x === 'object' && typeof x.name === 'string' && x.name) return x.name;
  return '';
}

function fabrikAsList(v) {
  /**
   * Pin values that mean "a list of names". LM arrays often fail Array.isArray,
   * and ''+array / String(array) throw (valueOf) — copy out real strings.
   */
  if (v == null) return [];
  if (typeof v === 'function') return v.name ? [v.name] : [];
  if (typeof v === 'string') return v === '' ? [] : v.split('\n');
  if (typeof v === 'object' && typeof v.length === 'number') {
    let out = [];
    for (let i = 0; i < v.length; i++) {
      let s = fabrikLabel(v[i]);
      if (s) out.push(s);
    }
    return out;
  }
  let one = fabrikLabel(v);
  return one ? [one] : [];
}

function fabrikAsText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.length === 'number' && typeof v !== 'function') {
    let names = fabrikAsList(v);
    let s = names.length ? names[0] : '';
    for (let i = 1; i < names.length; i++) s = s + '\n' + names[i];
    return s;
  }
  return fabrikLabel(v);
}

function fabrikFitFunctionView(fv) {
  if (!fv || !fv.contentPane) return;
  let w = fv.getBounds().width();
  fv.contentPane.setBounds(rect(2, 2, Math.max(20, w - 4), 20));
  fabrikGrowContent(fv);
  let textH = fv.contentPane.shape && fv.contentPane.shape.extent ? fv.contentPane.shape.extent.y : 20;
  let needH = Math.max(32, textH + 10);
  let o = fv.getBounds().topLeft;
  Morph.prototype.setBounds.call(fv, rect(o.x, o.y, w, needH));
  fv.contentPane.setBounds(rect(2, 2, Math.max(20, w - 4), textH));
  fabrikLayoutPins(fv);
}

function fabrikPaneShowsPins(pane) {
  if (pane && pane.$fabrikShowPins != null) return !!pane.$fabrikShowPins;
  return fabrikEditMode(pane && pane.world ? pane.world() : null);
}

function fabrikPinPad(_edit) {
  /** Pin names overlay the part; no extra inward gutter. */
  return { l: 0, r: 0 };
}

function fabrikContentHeight(pane) {
  let cp = pane && pane.contentPane;
  if (!cp) return 0;
  let h = 0;
  if (cp.shape && cp.shape.extent) h = cp.shape.extent.y;
  if (cp.itemList && cp.shape) {
    let n = cp.itemList.length;
    let lh = cp.shape.lineHeight || 16;
    h = Math.max(h, n * lh + 4);
  }
  if (cp.shape && cp.shape.lines && cp.shape.lines.length && cp.shape.lineHeight)
    h = Math.max(h, cp.shape.lines.length * cp.shape.lineHeight + 4);
  return h;
}

function fabrikHugPane(pane, width, edit) {
  if (!pane) return 0;
  pane.$fabrikShowPins = !!edit;
  let pad = fabrikPinPad(edit);
  let o = pane.getBounds().topLeft;
  Morph.prototype.setBounds.call(pane, rect(o.x, o.y, width, Math.max(20, pane.getBounds().height())));
  if (pane.contentPane) {
    pane.contentPane.setBounds(rect(pad.l, 0, Math.max(20, width - pad.l - pad.r), 20));
    fabrikGrowContent(pane);
  }
  let textH = fabrikContentHeight(pane) || 20;
  let h = Math.max(22, textH + 4);
  Morph.prototype.setBounds.call(pane, rect(o.x, o.y, width, h));
  if (pane.contentPane) pane.contentPane.setBounds(rect(pad.l, 0, Math.max(20, width - pad.l - pad.r), textH));
  fabrikLayoutPins(pane);
  return h;
}

function fabrikGrowContent(pane) {
  /** Let the content morph be as tall as its text so wheel-scroll has room. */
  let cp = pane && pane.contentPane;
  if (!cp || !cp.shape) return;
  if (cp.shape.compose) cp.shape.compose();
  let textH = fabrikContentHeight(pane);
  if (!(textH > 0)) textH = 16;
  cp.shape.extent.y = textH;
  let t = cp.transform && cp.transform.translation;
  let x = t ? t.x : 0;
  let y = t ? t.y : 0;
  let w = cp.shape.extent.x || 20;
  if (cp.bounds && cp.bounds.setToRect) cp.bounds.setToRect(rect(x, y, w, textH));
}

function fabrikPreviewText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 96 ? v.substring(0, 96) + '…' : v;
  let names = fabrikAsList(v);
  if (names.length > 1) {
    let s = names.length + ': ' + names[0];
    for (let i = 1; i < names.length && s.length < 96; i++) s = s + ', ' + names[i];
    return s;
  }
  if (names.length === 1) return names[0];
  return '';
}

function fabrikPinTypeOk(a, b) {
  if (!a || !b || a === 'any' || b === 'any') return true;
  if (a === 'strings') a = 'text';
  if (b === 'strings') b = 'text';
  if (a === b) return true;
  // lists of names travel as text
  if ((a === 'text' && b === 'list') || (a === 'list' && b === 'text')) return true;
  return false;
}

function fabrikPinDirOk(fromDir, toDir) {
  /** from is the pin the drag started on. out→in, in→out, bi to either. */
  let a = fromDir || 'bi';
  let b = toDir || 'bi';
  if (a === 'bi' || b === 'bi') return a !== b || a === 'bi';
  return (a === 'out' && b === 'in') || (a === 'in' && b === 'out');
}

function fabrikIsScrollPane(m) {
  if (!m) return false;
  let n = m.className;
  return (
    n === 'ScrollPane' ||
    n === 'TextPane' ||
    n === 'ListPane' ||
    n === 'TranscriptTextPane' ||
    n === 'FabrikListView' ||
    n === 'FabrikTextView' ||
    n === 'FabrikFunctionView'
  );
}

if (typeof isScrollPaneMorph === 'function') {
  let _fabrikPrevIsScroll = isScrollPaneMorph;
  isScrollPaneMorph = function (m) {
    return fabrikIsScrollPane(m) || _fabrikPrevIsScroll(m);
  };
}
function fabrikEachMorph(m, fn) {
  if (!m) return;
  fn(m);
  let subs = m.allSubmorphsTopFirst ? m.allSubmorphsTopFirst() : m.submorphs || [];
  for (let i = 0; i < (subs.length || 0); i++) fabrikEachMorph(subs.at ? subs.at(i) : subs[i], fn);
}

function fabrikScrollPaneAtWorld(world, worldPt) {
  if (!world || !worldPt) return null;
  let m = world.topMorphAtExcludingHaloUI
    ? world.topMorphAtExcludingHaloUI(worldPt)
    : world.topMorphAt
      ? world.topMorphAt(worldPt)
      : null;
  while (m && m !== world) {
    if (fabrikIsScrollPane(m) && m.scrollByLines) return m;
    m = m.owner;
  }
  let found = null;
  fabrikEachMorph(world, function (p) {
    if (found || !p || !p.scrollByLines || p.$fabrikHidden) return;
    if (!fabrikIsScrollPane(p) && p.className !== 'ListPane' && p.className !== 'TextPane') return;
    if (p.boundsInWorld && p.boundsInWorld().includesPt(worldPt)) found = p;
  });
  return found;
}

if (typeof scrollPaneAtWorldPt === 'function') {
  let _fabrikPrevScrollAt = scrollPaneAtWorldPt;
  scrollPaneAtWorldPt = function (world, worldPt) {
    return fabrikScrollPaneAtWorld(world, worldPt) || _fabrikPrevScrollAt(world, worldPt);
  };
}
function fabrikWorldOnWheel(p, evt) {
  if (typeof setPointerLocation === 'function') setPointerLocation(p);
  let pane = fabrikScrollPaneAtWorld(this, p);
  if (pane && pane.scrollByLines) {
    let lh = pane.contentLineHeight ? pane.contentLineHeight() : 16;
    let deltaPx = evt && evt.deltaY != null ? evt.deltaY : 0;
    if (evt && evt.deltaMode === 1) deltaPx = evt.deltaY * lh;
    else if (evt && evt.deltaMode === 2) deltaPx = evt.deltaY * pane.getBounds().height();
    let lines = deltaPx / lh;
    if (Math.abs(lines) < 0.01) return false;
    if (Math.abs(lines) < 1 && evt && evt.deltaMode === 0 && Math.abs(evt.deltaY) >= 40)
      lines = lines > 0 ? 1 : -1;
    pane.scrollByLines(lines);
    return true;
  }
  return false;
}

function fabrikInstallWheel(world) {
  if (world) world.onWheel = fabrikWorldOnWheel;
  try {
    if (typeof WorldMorph !== 'undefined' && WorldMorph && WorldMorph.prototype)
      WorldMorph.prototype.onWheel = fabrikWorldOnWheel;
  } catch (err) {}
}

function fabrikPinCenterWorld(pin) {
  let b = pin.boundsInWorld();
  return b.center();
}

function fabrikAddPin(host, name, dir, type) {
  if (!host.fabrikPins) host.fabrikPins = [];
  let pin = new FabrikPin(name, dir, type);
  pin.fabrikHost = host;
  host.addMorph(pin);
  host.fabrikPins.push(pin);
  fabrikLayoutPins(host);
  return pin;
}

function fabrikPinNamed(host, name) {
  let pins = host.fabrikPins || [];
  for (let i = 0; i < pins.length; i++) if (pins[i].pinName === name) return pins[i];
  return null;
}

function fabrikLayoutPins(host) {
  let pins = host.fabrikPins || [];
  let ins = [];
  let outs = [];
  for (let i = 0; i < pins.length; i++) {
    let d = pins[i].pinDir;
    if (d === 'in' || d === 'bi') ins.push(pins[i]);
    if (d === 'out' || d === 'bi') outs.push(pins[i]);
  }
  let b = host.getBounds();
  let place = function (list, outsideLeft) {
    if (list.length === 0) return;
    let gap = b.height() / (list.length + 1);
    for (let i = 0; i < list.length; i++) {
      let p = list[i];
      let s = p.shape && p.shape.extent ? p.shape.extent : p.getBounds().extent;
      let y = gap * (i + 1) - s.y / 2;
      let x = outsideLeft ? -s.x : b.width();
      p.setBounds(rect(x, y, s.x, s.y));
    }
  };
  place(ins, true);
  place(outs, false);
}

function fabrikPinFill(dir) {
  return dir === 'out' ? Color.blue : Color.green;
}

function fabrikHostFullBounds(host) {
  let b = host.shape.getBounds().copy();
  if (fabrikEditMode(host.world()) && host.fabrikPins) {
    for (let i = 0; i < host.fabrikPins.length; i++) {
      b = b.union(host.fabrikPins[i].getBounds());
    }
  }
  return b.translatedBy(host.transform.translation);
}

function fabrikRenderHostOn(host, ctx) {
  /**
   * ScrollPane clips to its frame, which hid pins sitting outside the part.
   * Draw the frame+content clipped, then the pins (and their labels) unclipped.
   */
  let pins = host.fabrikPins || [];
  ctx.save();
  let bnds = host.shape.getBounds();
  ctx.beginPath();
  ctx.rect(bnds.topLeft.x, bnds.topLeft.y, bnds.extent.x, bnds.extent.y);
  ctx.clip();
  if (host.renderMeOn) host.renderMeOn(ctx);
  host.eachSubmorph(function (each) {
    if (each.fabrikHost === host) return;
    ctx.save();
    let tfm = each.transform;
    let scrollY = each.$scrollOffsetY;
    ctx.translate(tfm.translation.x, tfm.translation.y + (scrollY ? scrollY : 0));
    if (tfm.rotation) ctx.rotate(tfm.rotation);
    if (tfm.scale) ctx.scale(tfm.scale.x || 1, tfm.scale.y || 1);
    each.renderOn(ctx);
    ctx.restore();
  });
  ctx.restore();
  for (let i = 0; i < pins.length; i++) {
    let each = pins[i];
    ctx.save();
    let tfm = each.transform;
    ctx.translate(tfm.translation.x, tfm.translation.y);
    each.renderOn(ctx);
    ctx.restore();
  }
}

function fabrikEmit(host, pinName, value) {
  let pin = fabrikPinNamed(host, pinName);
  if (pin) pin.setValue(value);
}

function fabrikConnect(fromPin, toPin) {
  if (!fromPin || !toPin || fromPin === toPin) return null;
  if (fromPin.fabrikHost === toPin.fabrikHost) return null;
  if (!fabrikPinDirOk(fromPin.pinDir, toPin.pinDir)) return null;
  if (!fabrikPinTypeOk(fromPin.pinType, toPin.pinType)) return null;
  let outPin = fromPin.pinDir === 'in' ? toPin : fromPin;
  let inPin = outPin === fromPin ? toPin : fromPin;
  if (outPin.pinDir === 'in' && inPin.pinDir === 'out') {
    let t = outPin;
    outPin = inPin;
    inPin = t;
  }
  let world = outPin.world() || inPin.world() || Lively;
  if (!world.fabrikWires) world.fabrikWires = [];
  for (let i = 0; i < world.fabrikWires.length; i++) {
    let w = world.fabrikWires[i];
    if (w.fromPin === outPin && w.toPin === inPin) return w;
  }
  let wire = new FabrikWire(outPin, inPin);
  if (fabrikWiringMode(world) && world.addMorphFront) world.addMorphFront(wire);
  else world.addMorphBack(wire);
  world.fabrikWires.push(wire);
  if (outPin.value !== undefined) inPin.receive(outPin.value);
  return wire;
}

function fabrikMethodNames(cls) {
  if (!cls) return [];
  if (typeof classInstanceMemberNames === 'function') return classInstanceMemberNames(cls);
  if (!cls.prototype) return [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter(function (n) {
      return n !== 'constructor' && n !== 'className';
    })
    .sort();
}

function fabrikCodeString(cls, methodName) {
  if (!cls || methodName == null || methodName === '') return '';
  if (methodName === 'constructor' && typeof constructorBodyOf === 'function') {
    return constructorBodyOf(cls) || '';
  }
  let fn = cls.prototype && cls.prototype[methodName];
  if (typeof fn !== 'function') fn = cls[methodName];
  if (typeof fn === 'function' && fn.toString) return fn.toString();
  return '';
}

function fabrikStripScrollBar(pane) {
  pane.withScrollBar = false;
  pane.scrollBarWidth = 0;
  if (pane.scrollBar) {
    pane.removeMorph(pane.scrollBar);
    pane.scrollBar = null;
  }
  pane.scrollToTop = function () {
    this.setScrollPosition(0);
    if (this.scrollBar) this.scrollBar.setValue(0);
  };
}

class FabrikPin extends Morph {
  constructor(name, dir, type) {
    super(rect(0, 0, FABRIK_PIN_W, FABRIK_PIN_H));
    this.pinName = name;
    this.pinDir = dir || 'bi';
    this.pinType = type || 'any';
    this.value = undefined;
    this.fabrikHost = null;
    let fill = fabrikPinFill(this.pinDir);
    this.setColor(fill);
    this.setStyles(fill, 1, Color.black);
  }
  includesPt(p) {
    if (!fabrikEditMode(this.world())) return false;
    return Morph.prototype.includesPt.call(this, p);
  }
  renderOn(ctx) {
    if (!fabrikEditMode(this.world())) return;
    let w = this.shape.extent.x;
    let h = this.shape.extent.y;
    let pointingIn = this.pinDir !== 'out';
    let fill = fabrikPinFill(this.pinDir);
    ctx.save();
    ctx.fillStyle = fill.fillStyle;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (pointingIn) {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, h);
      ctx.lineTo(w, h / 2);
    } else {
      ctx.moveTo(w, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h / 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    let world = this.world();
    if (world && world.$fabrikWiringFrom === this) {
      ctx.save();
      ctx.strokeStyle = '#c45c00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (pointingIn) {
        ctx.moveTo(-1, -1);
        ctx.lineTo(-1, h + 1);
        ctx.lineTo(w + 1, h / 2);
      } else {
        ctx.moveTo(w + 1, -1);
        ctx.lineTo(w + 1, h + 1);
        ctx.lineTo(-1, h / 2);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    let name = this.pinName || '';
    if (!name) return;
    ctx.save();
    ctx.font = '11px sans-serif';
    let tw = 0;
    if (ctx.measureText) {
      let m = ctx.measureText(name);
      if (m && m.width) tw = m.width;
    }
    if (!(tw > 0)) tw = name.length * 6;
    let padX = 3;
    let padY = 2;
    let boxW = tw + padX * 2;
    let boxH = 14;
    let boxX = pointingIn ? w + 2 : -2 - boxW;
    let boxY = h / 2 - boxH / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,30,30,0.7)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(name, boxX + padX, h / 2);
    ctx.restore();
  }
  setValue(v) {
    this.value = v;
    this.fanOut();
  }
  fanOut() {
    let world = this.world();
    if (!world || !world.fabrikWires) return;
    for (let i = 0; i < world.fabrikWires.length; i++) {
      let w = world.fabrikWires[i];
      if (w.fromPin === this) w.deliver(this.value);
    }
  }
  receive(v) {
    this.value = v;
    let host = this.fabrikHost;
    if (host && host.fabrikPinChanged) host.fabrikPinChanged(this);
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    let world = this.world();
    let from = world && world.$fabrikWiringFrom;
    if (from && from !== this) {
      fabrikConnect(from, this);
      world.$fabrikWiringFrom = null;
      world.setPointerFocus(null);
      if (world.changed) world.changed();
      return true;
    }
    if (from === this) {
      world.$fabrikWiringFrom = null;
      world.setPointerFocus(null);
      if (world.changed) world.changed();
      return true;
    }
    world.$fabrikWiringFrom = this;
    world.setPointerFocus(this);
    if (world.changed) world.changed();
    return true;
  }
  onPointerMove(p, evt) {
    return !!(this.world() && this.world().$fabrikWiringFrom);
  }
  onPointerUp(p, evt) {
    let world = this.world();
    let from = world && world.$fabrikWiringFrom;
    if (!from) return true;
    let worldPt = this.owner ? this.owner.globalize(p) : p;
    let target = fabrikPinAtWorld(world, worldPt);
    if (from && target && target !== from) {
      fabrikConnect(from, target);
      world.$fabrikWiringFrom = null;
      world.setPointerFocus(null);
      if (world.changed) world.changed();
      return true;
    }
    // click on the start pin: keep it armed so the next pin pointerDown finishes the wire
    world.setPointerFocus(null);
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

function fabrikPinAtWorld(world, worldPt) {
  let m = world.topMorphAt ? world.topMorphAt(worldPt) : null;
  while (m && m !== world) {
    if (m.className === 'FabrikPin') return m;
    m = m.owner;
  }
  return null;
}

class FabrikWire extends Morph {
  constructor(fromPin, toPin) {
    super(rect(0, 0, 800, 600));
    this.fromPin = fromPin;
    this.toPin = toPin;
    this.shape.borderWidth = 0;
    this.setColor(Color.white);
  }
  includesPt(_p) {
    return false;
  }
  fullBounds() {
    return this.shape.getBounds().copy();
  }
  deliver(value) {
    if (this.toPin) this.toPin.receive(value);
  }
  renderOn(ctx) {
    if (!fabrikEditMode(this.world())) return;
    if (!this.fromPin || !this.toPin) return;
    let a = this.localize(fabrikPinCenterWorld(this.fromPin));
    let b = this.localize(fabrikPinCenterWorld(this.toPin));
    ctx.save();
    ctx.strokeStyle = '#4a7bd0';
    ctx.lineWidth = fabrikWiringMode(this.world()) ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikListView extends ListPane {
  constructor(bounds) {
    super(bounds, rect(0, 0, 1, 1));
    fabrikStripScrollBar(this);
    this.setBounds(bounds);
    fabrikAddPin(this, 'strings', 'in', 'text');
    fabrikAddPin(this, 'selection', 'out', 'text');
    let view = this;
    this.onSelect(function (item) {
      fabrikEmit(view, 'selection', item);
    });
    let pane = this;
    this.contentPane.clippedBounds = function () {
      return pane.getBounds().copy();
    };
    this.contentPane.clippedBoundsInWorld = function () {
      return pane.boundsInWorld();
    };
  }
  clippedBounds() {
    return this.getBounds().copy();
  }
  clippedBoundsInWorld() {
    return this.boundsInWorld();
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  setList(list) {
    let items = list || [];
    let lm = this.contentPane;
    if (!lm) return;
    lm.itemList = items;
    lm.displayItems = items.map(function (item) {
      return typeof menuItemLabel === 'function' ? menuItemLabel(item) : '' + item;
    });
    let itemText = '';
    for (let i = 0; i < lm.displayItems.length; i++) itemText += lm.displayItems[i] + '\n';
    lm.shape.setText(itemText);
    fabrikGrowContent(this);
    this.scrollToTop();
  }
  setBounds(paneBounds) {
    Morph.prototype.setBounds.call(this, paneBounds);
    if (!this.contentPane) return;
    let ht = paneBounds.height();
    let w = paneBounds.width();
    if (this.withScrollBar && this.scrollBar) {
      let scrollW = 15;
      this.contentPane.setBounds(rect(0, 0, w - scrollW, ht));
      this.scrollBar.setBounds(rect(w - scrollW, 0, scrollW, ht));
    } else {
      let pad = fabrikPinPad(fabrikPaneShowsPins(this));
      this.contentPane.setBounds(rect(pad.l, 0, Math.max(20, w - pad.l - pad.r), ht));
    }
    fabrikGrowContent(this);
    fabrikLayoutPins(this);
  }
  renderOn(ctx) {
    fabrikRenderHostOn(this, ctx);
  }
  fabrikPinChanged(pin) {
    if (pin.pinName !== 'strings') return;
    this.setList(fabrikAsList(pin.value));
  }
  fabrikPaneHeight() {
    return this.shape && this.shape.extent ? this.shape.extent.y : this.getBounds().height();
  }
  getScrollPosition() {
    let slideRoom = fabrikContentHeight(this) - this.fabrikPaneHeight();
    if (!(slideRoom > 0) || !this.contentPane) return 0;
    let scrollY = (this.contentPane.$scrollOffsetY || 0) + this.contentPane.transform.translation.y;
    return -scrollY / slideRoom;
  }
  _scrollContentTo(scrollPos) {
    let clipped = Math.max(0, Math.min(1, scrollPos));
    if (!this.contentPane) return 0;
    if (this.contentPane.transform.translation.y !== 0) this.contentPane.transform.translation.y = 0;
    let slideRoom = fabrikContentHeight(this) - this.fabrikPaneHeight();
    if (!(slideRoom > 0)) {
      this.contentPane.$scrollOffsetY = 0;
      return 0;
    }
    this.contentPane.$scrollOffsetY = Math.min(0, -slideRoom * clipped);
    return clipped;
  }
  scrollByLines(lineCount) {
    if (!this.contentPane || !lineCount) return 0;
    let slideRoom = fabrikContentHeight(this) - this.fabrikPaneHeight();
    if (!(slideRoom > 0)) return 0;
    let lh = this.contentLineHeight ? this.contentLineHeight() : 16;
    return this._scrollContentTo(this.getScrollPosition() + (lineCount * lh) / slideRoom);
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikTextView extends TextPane {
  constructor(bounds) {
    super(bounds, rect(0, 0, 1, 1));
    fabrikStripScrollBar(this);
    this.setBounds(bounds);
    fabrikAddPin(this, 'text', 'in', 'text');
    fabrikAddPin(this, 'textOut', 'out', 'text');
    this.setText('', { force: true });
  }
  setBounds(paneBounds) {
    Morph.prototype.setBounds.call(this, paneBounds);
    if (!this.contentPane) return;
    let ht = paneBounds.height();
    let w = paneBounds.width();
    if (this.withScrollBar && this.scrollBar) {
      let scrollW = 15;
      this.contentPane.setBounds(rect(0, 0, w - scrollW, ht));
      this.scrollBar.setBounds(rect(w - scrollW, 0, scrollW, ht));
    } else {
      let pad = fabrikPinPad(fabrikPaneShowsPins(this));
      this.contentPane.setBounds(rect(pad.l, 0, Math.max(20, w - pad.l - pad.r), ht));
    }
    fabrikGrowContent(this);
    fabrikLayoutPins(this);
  }
  renderOn(ctx) {
    fabrikRenderHostOn(this, ctx);
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  setText(text, opts) {
    let r = TextPane.prototype.setText.call(this, text, opts);
    fabrikGrowContent(this);
    return r;
  }
  fabrikPinChanged(pin) {
    if (pin.pinName !== 'text') return;
    this.setText(fabrikAsText(pin.value), { force: true });
  }
  fabrikPaneHeight() {
    return FabrikListView.prototype.fabrikPaneHeight.call(this);
  }
  getScrollPosition() {
    return FabrikListView.prototype.getScrollPosition.call(this);
  }
  _scrollContentTo(scrollPos) {
    return FabrikListView.prototype._scrollContentTo.call(this, scrollPos);
  }
  scrollByLines(lineCount) {
    return FabrikListView.prototype.scrollByLines.call(this, lineCount);
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikFunctionView extends TextPane {
  constructor(bounds, spec) {
    super(bounds, rect(0, 0, 1, 1));
    spec = spec || {};
    fabrikStripScrollBar(this);
    this.fabrikInputs = spec.inputs || [];
    this.setBounds(bounds);
    let src = spec.source || 'function () { return null; }';
    this.setText(src, { force: true });
    if (this.contentPane && this.contentPane.shape) {
      this.contentPane.shape.verticallyCenterSingleLine = false;
      this.contentPane.shape.hang = 2;
      this.contentPane.shape.inset = pt(2, 2);
    }
    for (let i = 0; i < this.fabrikInputs.length; i++) {
      let inp = this.fabrikInputs[i];
      fabrikAddPin(this, inp.name, 'in', inp.type || 'any');
    }
    fabrikAddPin(this, spec.outputName || 'result', 'out', spec.outputType || 'any');
    fabrikFitFunctionView(this);
  }
  setBounds(paneBounds) {
    Morph.prototype.setBounds.call(this, paneBounds);
    if (!this.contentPane) return;
    let w = paneBounds.width();
    this.contentPane.setBounds(rect(2, 2, Math.max(20, w - 4), 20));
    fabrikGrowContent(this);
    fabrikLayoutPins(this);
  }
  fabrikPinChanged(_pin) {
    this.fabrikRun();
  }
  fabrikRun() {
    let src = this.contentPane && this.contentPane.shape ? this.contentPane.shape.string : '';
    let fn;
    try {
      fn = eval('(' + src + ')');
    } catch (err) {
      fabrikEmit(this, 'result', String(err && err.message ? err.message : err));
      return;
    }
    if (typeof fn !== 'function') return;
    let args = [];
    for (let i = 0; i < this.fabrikInputs.length; i++) {
      let pin = fabrikPinNamed(this, this.fabrikInputs[i].name);
      args.push(pin ? pin.value : undefined);
    }
    let result;
    try {
      result = fn.apply(null, args);
    } catch (err) {
      result = String(err && err.message ? err.message : err);
    }
    if (
      result &&
      typeof result !== 'string' &&
      typeof result !== 'function' &&
      typeof result.length === 'number'
    )
      result = fabrikAsList(result);
    fabrikEmit(this, 'result', result);
  }
  includesPt(p) {
    if (this.$fabrikHidden) return false;
    return Morph.prototype.includesPt.call(this, p);
  }
  renderOn(ctx) {
    if (this.$fabrikHidden) return;
    fabrikRenderHostOn(this, ctx);
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  static new(...args) {
    return new this(...args);
  }
}

class Fabrik extends PanelMorph {
  constructor(bounds) {
    super(bounds);
    this.setColor(Color.white);
    this.setStyles(Color.white, 1, Color.gray);
    this.setPanelTitle('Fabrik');
    this.isFabrikPanel = true;
    if (this.titleBar && this.titleBar.closeBtn) this.titleBar.removeMorph(this.titleBar.closeBtn);
    this.probeField = this.addMorph(new TextMorph(rect(4, 28, Math.max(40, bounds.width() - 8), 18), ''));
    this.probeField.shape.fontSize = 11;
    fabrikAddPin(this, 'probe', 'in', 'any');
    fabrikAddPin(this, 'categories', 'out', 'text');
    this.relayoutContentPanes();
  }
  relayoutContentPanes() {
    let box = this.paneLayoutBounds();
    let o = box.topLeft;
    if (this.probeField) this.probeField.setBounds(rect(o.x + 4, o.y + 2, Math.max(40, box.width() - 8), 18));
    fabrikLayoutPins(this);
  }
  fabrikPinChanged(pin) {
    if (pin.pinName !== 'probe') return;
    if (this.probeField) this.probeField.setText(fabrikPreviewText(pin.value));
  }
  emitCategories() {
    fabrikEmit(this, 'categories', fabrikCategoryNames());
  }
  renderOn(ctx) {
    fabrikRenderHostOn(this, ctx);
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikSource extends Morph {
  constructor(bounds, label, produce) {
    super(bounds);
    this.setColor(Color.white);
    this.setStyles(Color.white, 1, Color.gray);
    this.produce = produce;
    this.addMorph(new TextMorph(rect(8, 10, Math.max(40, bounds.width() - 16), 20), label || 'source'));
    fabrikAddPin(this, 'out', 'out', 'any');
  }
  renderOn(ctx) {
    fabrikRenderHostOn(this, ctx);
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  emit() {
    let v = typeof this.produce === 'function' ? this.produce() : this.produce;
    fabrikEmit(this, 'out', v);
    return v;
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikBin extends PanelMorph {
  constructor(bounds) {
    super(bounds);
    this.setColor(Color.gray.lighter());
    this.setStyles(Color.gray.lighter(), 1, Color.gray);
    this.setPanelTitle('Parts bin');
    if (this.titleBar && this.titleBar.closeBtn) this.titleBar.removeMorph(this.titleBar.closeBtn);
    this.isFabrikBin = true;
  }
  relayoutContentPanes() {}
  includesPt(p) {
    if (this.$fabrikHidden) return false;
    return Morph.prototype.includesPt.call(this, p);
  }
  renderOn(ctx) {
    if (this.$fabrikHidden) return;
    Morph.prototype.renderOn.call(this, ctx);
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikBrowser extends PanelMorph {
  constructor(bounds) {
    super(bounds);
    this.setColor(Color.white);
    this.setStyles(Color.white, 1, Color.gray);
    this.setPanelTitle('System Browser');
    if (this.titleBar && this.titleBar.closeBtn) this.titleBar.removeMorph(this.titleBar.closeBtn);
    this.fabrikPanes = {};
  }
  addPane(name, morph) {
    this.fabrikPanes[name] = morph;
    this.addMorph(morph);
    morph.setName(name);
    return morph;
  }
  relayoutContentPanes() {
    fabrikLayoutBrowser(this, fabrikEditMode(this.world()));
  }
  renderOn(ctx) {
    Morph.prototype.renderOn.call(this, ctx);
    if (!fabrikEditMode(this.world())) return;
    let b = this.shape.getBounds();
    let o = b.topLeft;
    ctx.save();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([7, 4]);
    ctx.strokeRect(o.x + 1, o.y + 1, b.width() - 2, b.height() - 2);
    ctx.restore();
  }
  static new(...args) {
    return new this(...args);
  }
}

function fabrikWorldPtInBin(world, worldP) {
  let bin = world && world.get && world.get('fabrikBin');
  if (!bin || bin.$fabrikHidden || !bin.boundsInWorld) return false;
  return bin.boundsInWorld().includesPt(worldP);
}

function fabrikStamp(proto, dest, at) {
  let m = null;
  let kind = proto.fabrikKind;
  if (kind === 'listView') m = new FabrikListView(rect(at.x, at.y, 160, 200));
  else if (kind === 'textView') m = new FabrikTextView(rect(at.x, at.y, 240, 180));
  else if (kind === 'functionView')
    m = new FabrikFunctionView(rect(at.x, at.y, 260, 96), {
      source: proto.fabrikSource || 'function (v) { return v; }',
      inputs: proto.fabrikInputs || [{ name: 'v', type: 'any' }],
    });
  else if (proto.className === 'LineMorph')
    m = new LineMorph([pt(at.x, at.y), pt(at.x + 50, at.y)], { borderWidth: 2, borderColor: Color.black });
  else m = proto.morphCopy();
  if (!m) return null;
  dest.addMorph(m);
  if (kind !== 'listView' && kind !== 'textView' && kind !== 'functionView' && proto.className !== 'LineMorph') {
    m.moveBy(at.subPt(m.getBounds().topLeft));
  }
  return m;
}

function fabrikMakeBinItem(bin, morph, kind, label) {
  morph.fabrikKind = kind;
  morph.isFabrikProto = true;
  bin.addMorph(morph);
  if (label) morph.setName(label);
  morph.onPointerDown = function (p, evt) {
    if (!this.includesPt(p)) return false;
    let world = this.world();
    let worldP = this.owner ? this.owner.globalize(p) : p;
    let at = this.boundsInWorld().topLeft;
    let copy = fabrikStamp(this, world, at);
    if (!copy) return false;
    copy.$fabrikBinDrag = true;
    let ended = copy.dragEnded;
    copy.dragEnded = function (upP, upEvt, wasDrag) {
      let dropP = this.owner ? this.owner.globalize(upP) : upP;
      if (fabrikWorldPtInBin(this.world(), dropP) || !wasDrag) {
        this.remove();
        return;
      }
      if (typeof ended === 'function') ended.call(this, upP, upEvt, wasDrag);
    };
    copy.beginPointerDrag(worldP, evt);
    return true;
  };
  return morph;
}

function fabrikPopulateBin(bin) {
  let y = 36;
  let x = 16;
  let label = function (text, yy) {
    bin.addMorph(new TextMorph(rect(x, yy, 140, 16), text));
  };
  let box = new Morph(rect(x, y, 48, 28));
  fabrikMakeBinItem(bin, box, 'box', 'box');
  y += 40;
  let oval = new Morph(null, new Ellipse(pt(x + 20, y + 16), pt(20, 14)));
  oval.setStyles(Color.green.lighter(), 2, Color.black);
  fabrikMakeBinItem(bin, oval, 'oval', 'oval');
  y += 44;
  let star = new Morph(null, new Pen().star(8, 18, Color.black));
  star.setColor(Color.yellow);
  fabrikMakeBinItem(bin, star, 'star', 'star');
  star.moveBy(pt(x + 8, y).subPt(star.getBounds().topLeft));
  y += 48;
  let line = new LineMorph([pt(x, y + 8), pt(x + 50, y + 8)], { borderWidth: 2, borderColor: Color.black });
  fabrikMakeBinItem(bin, line, 'line', 'line');
  y += 28;
  label('Views', y);
  y += 20;
  let lv = new Morph(rect(x, y, 130, 22));
  lv.setColor(Color.white);
  lv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'listView'));
  fabrikMakeBinItem(bin, lv, 'listView', 'listView');
  y += 30;
  let tv = new Morph(rect(x, y, 130, 22));
  tv.setColor(Color.white);
  tv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'textView'));
  fabrikMakeBinItem(bin, tv, 'textView', 'textView');
  y += 30;
  let fv = new Morph(rect(x, y, 130, 22));
  fv.setColor(Color.white);
  fv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'functionView'));
  fv.fabrikSource = 'function (v) { return v; }';
  fv.fabrikInputs = [{ name: 'v', type: 'any' }];
  fabrikMakeBinItem(bin, fv, 'functionView', 'functionView');
}

function fabrikCopyRect(r) {
  if (!r) return r;
  return rect(r.topLeft.x, r.topLeft.y, r.width(), r.height());
}

function fabrikGetLayout(part, mode) {
  let L = part && part.$fabrikLayouts;
  return L && L[mode] ? L[mode] : null;
}

function fabrikRememberLayout(part, mode, bounds) {
  if (!part) return;
  if (!part.$fabrikLayouts) part.$fabrikLayouts = {};
  part.$fabrikLayouts[mode] = { bounds: fabrikCopyRect(bounds) };
}

function fabrikDefaultUserPanelBounds() {
  let e = typeof browserPanelDefaultExtent === 'function' ? browserPanelDefaultExtent() : pt(400, 300);
  return rect(212, 64, e.x, e.y);
}

function fabrikExpandUserPaneBounds(user, gap) {
  /** Insert `gap` between the abutting user-view panes so wires and pins show. */
  if (!gap) gap = FABRIK_EDIT_GAP;
  let cats = user.category;
  let classes = user.classNames;
  let methods = user.methodNames;
  let defn = user.methodDefinition;
  let ox = cats.topLeft.x;
  let oy = cats.topLeft.y;
  let leftW = cats.width();
  let catH = cats.height();
  let classH = classes.height();
  let methW = methods.width();
  let methH = methods.height();
  let defH = defn.height();
  let topBand = Math.max(catH + gap + classH, methH);
  return {
    category: rect(ox, oy, leftW, catH),
    classNames: rect(ox, oy + catH + gap, leftW, classH),
    methodNames: rect(ox + leftW + gap, oy, methW, methH),
    methodDefinition: rect(ox, oy + topBand + gap, leftW + gap + methW, defH),
  };
}

function fabrikUnionRects(list) {
  let r = null;
  for (let i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    r = r ? r.union(list[i]) : fabrikCopyRect(list[i]);
  }
  return r;
}

function fabrikEnsureLayouts(world, browser) {
  /**
   * User layout = BrowserPanel pane bounds. Edit layout expands that region by
   * FABRIK_EDIT_GAP. Stored on each part as $fabrikLayouts so both views can
   * later be changed and kept.
   */
  if (!browser || browser.$fabrikLayouts) return;
  let gap = FABRIK_EDIT_GAP;
  let userPanel = fabrikDefaultUserPanelBounds();
  let th = browser.titleBarHeight || 24;
  let content = rect(0, th, userPanel.width(), Math.max(8, userPanel.height() - th));
  let userPanes =
    typeof browserPanelUserPaneBounds === 'function'
      ? browserPanelUserPaneBounds(content)
      : {
          category: rect(0, th, 160, 22),
          classNames: rect(0, th + 22, 160, 88),
          methodNames: rect(160, th, 240, 110),
          methodDefinition: rect(0, th + 110, 400, 166),
        };
  let editPanes = fabrikExpandUserPaneBounds(userPanes, gap);
  let editUnion = fabrikUnionRects([
    editPanes.category,
    editPanes.classNames,
    editPanes.methodNames,
    editPanes.methodDefinition,
  ]);
  let editPanel = rect(
    userPanel.topLeft.x,
    userPanel.topLeft.y,
    editUnion.topLeft.x + editUnion.width(),
    editUnion.topLeft.y + editUnion.height(),
  );
  browser.$fabrikLayouts = {
    user: { bounds: fabrikCopyRect(userPanel), panes: userPanes },
    edit: { bounds: fabrikCopyRect(editPanel), panes: editPanes },
  };
  let outX = editPanel.topLeft.x + editPanel.width() + gap;
  let y = userPanel.topLeft.y + th;
  let fnW = 250;
  let fnNames = ['classNamesInCategory', 'classNamed', 'methodsOfClass', 'codeString'];
  for (let i = 0; i < fnNames.length; i++) {
    let m = world && world.get ? world.get(fnNames[i]) : null;
    if (!m) continue;
    Morph.prototype.setBounds.call(m, rect(outX, y, fnW, 40));
    fabrikFitFunctionView(m);
    fabrikRememberLayout(m, 'edit', m.getBounds());
    let b = m.getBounds();
    y = b.topLeft.y + b.height() + gap;
  }
  let bin = world && world.get ? world.get('fabrikBin') : null;
  if (bin) {
    let bb = bin.getBounds();
    fabrikRememberLayout(bin, 'edit', rect(outX + fnW + 200, userPanel.topLeft.y, bb.width(), bb.height()));
  }
}

function fabrikApplyBrowserLayout(browser, edit) {
  if (!browser || browser.collapsed) return;
  let mode = edit ? 'edit' : 'user';
  let stored = fabrikGetLayout(browser, mode);
  let panes = stored && stored.panes;
  if (!panes) {
    let box = browser.paneLayoutBounds();
    let userPanes =
      typeof browserPanelUserPaneBounds === 'function' ? browserPanelUserPaneBounds(box) : null;
    panes = edit && userPanes ? fabrikExpandUserPaneBounds(userPanes, FABRIK_EDIT_GAP) : userPanes;
  }
  if (!panes) return;
  let map = [
    ['categories', panes.category],
    ['classNames', panes.classNames],
    ['methodNames', panes.methodNames],
    ['methodDefinition', panes.methodDefinition],
  ];
  for (let i = 0; i < map.length; i++) {
    let pane = browser.fabrikPanes && browser.fabrikPanes[map[i][0]];
    let r = map[i][1];
    if (!pane || !r) continue;
    pane.$fabrikShowPins = !!edit;
    pane.setBounds(fabrikCopyRect(r));
  }
}

function fabrikLayoutBrowser(browser, edit) {
  fabrikApplyBrowserLayout(browser, edit);
}

function fabrikPlaceHelpers(world, edit) {
  let names = ['classNamesInCategory', 'classNamed', 'methodsOfClass', 'codeString'];
  for (let i = 0; i < names.length; i++) {
    let m = world.get(names[i]);
    fabrikShowPart(m, edit);
    if (edit && m) {
      let L = fabrikGetLayout(m, 'edit');
      if (L && L.bounds) {
        Morph.prototype.setBounds.call(m, L.bounds);
        fabrikFitFunctionView(m);
      }
    }
  }
  let bin = world.get('fabrikBin');
  fabrikShowPart(bin, edit);
  if (edit && bin) {
    let Lb = fabrikGetLayout(bin, 'edit');
    if (Lb && Lb.bounds) Morph.prototype.setBounds.call(bin, Lb.bounds);
  }
}

function fabrikStackWires(world, onTop) {
  let wires = world && world.fabrikWires ? world.fabrikWires : [];
  for (let i = 0; i < wires.length; i++) {
    let w = wires[i];
    if (!w || w.owner !== world) continue;
    if (onTop) {
      if (world.promote) world.promote(w);
    } else if (world.bottomZIndexInBand) {
      let bottom = world.bottomZIndexInBand(0);
      w.zIndex = bottom == null ? 0 : bottom - 1;
      if (world.zOrderChanged) world.zOrderChanged();
    }
  }
}

function fabrikApplyFabrikChrome(world) {
  let fab = world && world.get ? world.get('fabrik') : null;
  if (!fab || !fab.setStyles) return;
  let bw = fabrikViewMode(world) === 'user' ? 2 : 1;
  fab.setStyles(Color.white, bw, Color.gray);
}

function fabrikSetView(mode, world) {
  world = world || Lively;
  if (mode !== 'user' && mode !== 'wiring') mode = 'edit';
  world.$fabrikViewMode = mode;
  let edit = mode !== 'user';
  world.$fabrikEditMode = edit;
  let browser = world.get('fabrikBrowser');
  if (browser) {
    fabrikEnsureLayouts(world, browser);
    let L = fabrikGetLayout(browser, edit ? 'edit' : 'user');
    if (L && L.bounds) browser.setBounds(L.bounds);
    fabrikLayoutBrowser(browser, edit);
  }
  fabrikPlaceHelpers(world, edit);
  fabrikStackWires(world, mode === 'wiring');
  fabrikApplyFabrikChrome(world);
  let btn = world.get('fabrikViewMenu');
  if (btn && btn.shape) {
    btn.shape.setText(mode === 'user' ? 'user view' : mode === 'wiring' ? 'wiring' : 'edit view');
  }
  if (world.changed) world.changed();
}

function fabrikShowViewMenu(world, at) {
  let items = [
    menuItem('edit view', function () {
      fabrikSetView('edit', world);
    }),
    menuItem('wiring', function () {
      fabrikSetView('wiring', world);
    }),
    menuItem('user view', function () {
      fabrikSetView('user', world);
    }),
  ];
  let menu = new MenuMorph(rect(at.x, at.y, 110, 84), items);
  menu.isFleetingMenu = true;
  world.addMorph(menu);
}

function fabrikInstallViewMenu(world, fab) {
  let fb = fab && fab.getBounds ? fab.getBounds() : rect(212, 4, 280, 56);
  let x = fb.topLeft.x + fb.width() + 8;
  let y = fb.topLeft.y + 6;
  let btn = world.addMorph(new SimpleButtonMorph(rect(x, y, 80, 20), 'edit view'));
  btn.setName('fabrikViewMenu');
  btn.onPointerUp = function (p, evt) {
    if (!this.includesPt(p)) return false;
    let b = this.boundsInWorld();
    fabrikShowViewMenu(world, b.bottomLeft());
    return true;
  };
}

function fabrikReveal(world, category, className, methodName) {
  let cats = world.get('categories');
  if (cats && category) cats.setSelectionString(category);
  let classes = world.get('classNames');
  if (classes && className) classes.setSelectionString(className);
  let methods = world.get('methodNames');
  if (methods && methodName) methods.setSelectionString(methodName);
}

function fabrikBuildDemo(world, fab) {
  /**
   * A Lively-style system browser from parts:
   *   first the four user-view panes, then the functions that sit outside,
   *   then the wires that couple them.
   */
  fab = fab || (world.get && world.get('fabrik'));

  let browser = world.addMorph(new FabrikBrowser(fabrikDefaultUserPanelBounds()));
  browser.setName('fabrikBrowser');

  let categories = browser.addPane('categories', new FabrikListView(rect(0, 0, 160, 56)));
  let classNames = browser.addPane('classNames', new FabrikListView(rect(0, 0, 160, 150)));
  let methodNames = browser.addPane('methodNames', new FabrikListView(rect(0, 0, 200, 150)));
  let methodDefinition = browser.addPane('methodDefinition', new FabrikTextView(rect(0, 0, 400, 150)));

  let classNamesInCategory = world.addMorph(
    new FabrikFunctionView(rect(660, 70, 250, 84), {
      source: 'function (category) { return fabrikClassNamesInCategory(category); }',
      inputs: [{ name: 'category', type: 'text' }],
      outputType: 'text',
    }),
  );
  classNamesInCategory.setName('classNamesInCategory');

  let classFn = world.addMorph(
    new FabrikFunctionView(rect(660, 164, 250, 84), {
      source: 'function (s) { return classNamed(s); }',
      inputs: [{ name: 's', type: 'text' }],
      outputType: 'any',
    }),
  );
  classFn.setName('classNamed');

  let methodsFn = world.addMorph(
    new FabrikFunctionView(rect(660, 258, 250, 84), {
      source: 'function (cls) { return fabrikMethodNames(cls); }',
      inputs: [{ name: 'cls', type: 'any' }],
      outputType: 'text',
    }),
  );
  methodsFn.setName('methodsOfClass');

  let codeFn = world.addMorph(
    new FabrikFunctionView(rect(660, 352, 250, 100), {
      source: 'function (cls, name) { return fabrikCodeString(cls, name); }',
      inputs: [
        { name: 'cls', type: 'any' },
        { name: 'name', type: 'text' },
      ],
      outputType: 'text',
    }),
  );
  codeFn.setName('codeString');

  fabrikConnect(fabrikPinNamed(fab, 'categories'), fabrikPinNamed(categories, 'strings'));
  fabrikConnect(fabrikPinNamed(categories, 'selection'), fabrikPinNamed(classNamesInCategory, 'category'));
  fabrikConnect(fabrikPinNamed(classNamesInCategory, 'result'), fabrikPinNamed(classNames, 'strings'));
  fabrikConnect(fabrikPinNamed(classNames, 'selection'), fabrikPinNamed(classFn, 's'));
  fabrikConnect(fabrikPinNamed(classFn, 'result'), fabrikPinNamed(methodsFn, 'cls'));
  fabrikConnect(fabrikPinNamed(methodsFn, 'result'), fabrikPinNamed(methodNames, 'strings'));
  fabrikConnect(fabrikPinNamed(classFn, 'result'), fabrikPinNamed(codeFn, 'cls'));
  fabrikConnect(fabrikPinNamed(methodNames, 'selection'), fabrikPinNamed(codeFn, 'name'));
  fabrikConnect(fabrikPinNamed(codeFn, 'result'), fabrikPinNamed(methodDefinition, 'text'));

  if (fab && fab.emitCategories) fab.emitCategories();
  fabrikEnsureLayouts(world, browser);
  fabrikLayoutBrowser(browser, true);
  fabrikReveal(world, 'Basic Graphics', 'Ellipse', 'moveBy');
  return {
    fab: fab,
    browser: browser,
    categories: categories,
    classNames: classNames,
    methodNames: methodNames,
    methodDefinition: methodDefinition,
    classNamesInCategory: classNamesInCategory,
    classFn: classFn,
    methodsFn: methodsFn,
    codeFn: codeFn,
  };
}

function fabrikClearWorld(world) {
  let kids = [];
  if (world.submorphs) for (let i = 0; i < world.submorphs.length; i++) kids.push(world.submorphs[i]);
  if (world.$submorphs) for (let i = 0; i < world.$submorphs.length; i++) kids.push(world.$submorphs[i]);
  for (let i = 0; i < kids.length; i++) {
    if (world.removeMorph) world.removeMorph(kids[i]);
  }
  world.fabrikWires = [];
}

function fabrikBuildWorld(world) {
  fabrikClearWorld(world);
  world.setColor(Color.white);
  if (world.setStyles) world.setStyles(Color.white, 0, Color.white);
  world.fabrikWires = [];
  world.$fabrikEditMode = true;
  world.$fabrikViewMode = 'edit';
  world.isFabrikWorld = true;

  let fab = world.addMorph(new Fabrik(rect(212, 4, 280, 56)));
  fab.setName('fabrik');

  let bin = world.addMorph(new FabrikBin(rect(1110, 32, 170, 536)));
  bin.setName('fabrikBin');
  fabrikPopulateBin(bin);

  fabrikInstallViewMenu(world, fab);
  fabrikBuildDemo(world, fab);
  fabrikInstallWheel(world);
  fabrikSetView('edit', world);
}

function initFabrik() {
  /**
   * Build (or rebuild) the Fabrik surface. A stamp change after re-eval gets a
   * fresh world so pin/list fixes show up without a new document.
   */
  if (typeof Lively === 'object' && Lively && Lively.isFabrikWorld && Lively.fabrikStamp === FABRIK_WRITTEN_ON)
    return Lively;
  initLively();
  fabrikBuildWorld(Lively);
  Lively.fabrikStamp = FABRIK_WRITTEN_ON;
  return Lively;
}

//written on 2026-10-10 16:10 PDT
