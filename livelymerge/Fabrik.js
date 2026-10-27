//written on 2026-10-27 11:38 PDT
// Fabrik — application construction set on newdefs (Livelymerge Morphic).
// Parts bin, pins, wires, and a system browser with edit view / user view.
//
let FABRIK_WRITTEN_ON = '2026-10-27 11:38 PDT';
let FABRIK_EDIT_GAP = 50;
let FABRIK_PIN_W = 14;
let FABRIK_PIN_H = 12;
let FABRIK_FN_X = 250;
let FABRIK_FN_W = 250;
let FABRIK_FN_TO_EDIT = 80;
let FABRIK_FN_Y_DROP = 100;

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
  let pad = fabrikPinPad(fabrikPaneShowsPins(fv));
  fv.contentPane.setBounds(rect(pad.l, 2, Math.max(20, w - pad.l - pad.r), 20));
  fabrikGrowContent(fv);
  let textH = fv.contentPane.shape && fv.contentPane.shape.extent ? fv.contentPane.shape.extent.y : 20;
  let needH = Math.max(32, textH + 10);
  let o = fv.getBounds().topLeft;
  Morph.prototype.setBounds.call(fv, rect(o.x, o.y, w, needH));
  fv.contentPane.setBounds(rect(pad.l, 2, Math.max(20, w - pad.l - pad.r), textH));
  fabrikLayoutPins(fv);
}

function fabrikPaneShowsPins(pane) {
  if (pane && pane.$fabrikShowPins != null) return !!pane.$fabrikShowPins;
  return fabrikEditMode(pane && pane.world ? pane.world() : null);
}

function fabrikPinPad(edit) {
  /** Inward gutter so pin-name labels sit on empty part chrome, not on text. */
  return edit ? { l: 30, r: 30 } : { l: 0, r: 0 };
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
    n === 'FabrikFunctionView' ||
    n === 'FabrikBinPartsPane'
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

function fabrikHostXY(i) {
  /**
   * Scratch x/y records on the host `window` object — never `pt()`. Wire
   * redraw runs inside the Automerge frame transaction; a Morphic Point is a
   * heap allocation, and the old cubic path made thousands of them per frame
   * (Chrome's rAF-violation log).
   */
  let bag = window._fabrikXY;
  if (!bag) {
    bag = new window.Array();
    window._fabrikXY = bag;
  }
  while (bag.length <= i) {
    let o = new window.Object();
    o.x = 0;
    o.y = 0;
    bag.push(o);
  }
  return bag[i];
}

function fabrikMorphLocalToWorld(morph, lx, ly, out) {
  /** Scale, canvas-rotate(+r), translate — same order as SimpleTransform.transformPt. */
  let m = morph;
  let x = lx;
  let y = ly;
  while (m && m.owner) {
    let t = m.transform;
    let sc = t && t.scale;
    let sx = sc && sc.x != null ? sc.x : 1;
    let sy = sc && sc.y != null ? sc.y : 1;
    x = x * sx;
    y = y * sy;
    let r = t && t.rotation ? t.rotation : 0;
    if (r) {
      let c = Math.cos(-r);
      let s = Math.sin(-r);
      let nx = x * c - y * s;
      let ny = x * s + y * c;
      x = nx;
      y = ny;
    }
    let tr = t && t.translation;
    if (tr) {
      x = x + tr.x;
      y = y + tr.y;
    }
    if (m.$scrollOffsetY) y = y + m.$scrollOffsetY;
    m = m.owner;
  }
  out.x = x;
  out.y = y;
  return out;
}

function fabrikPinCenterInto(pin, out) {
  let e = pin && pin.shape && pin.shape.extent ? pin.shape.extent : null;
  let w = e && e.x != null ? e.x : FABRIK_PIN_W;
  let h = e && e.y != null ? e.y : FABRIK_PIN_H;
  let lx = pin && pin.pinDir === 'out' ? w : 0;
  return fabrikMorphLocalToWorld(pin, lx, h / 2, out);
}

function fabrikPinCenterWorld(pin) {
  /**
   * Wire attachment: output tip (outward point), or the midpoint of an input
   * pin's outward flat side.
   */
  let o = fabrikPinCenterInto(pin, fabrikHostXY(0));
  return pt(o.x, o.y);
}

function fabrikPinAwayX(pin) {
  return pin && pin.pinDir === 'out' ? 1 : -1;
}

function fabrikWireStubWorld(pin) {
  /** 20px straight out from the pin, along its away direction. */
  let p = fabrikPinCenterInto(pin, fabrikHostXY(0));
  return pt(p.x + fabrikPinAwayX(pin) * 20, p.y);
}

function fabrikWireHeadedBack(fromPin, toPin, fromEnd) {
  let a = fabrikPinCenterInto(fromPin, fabrikHostXY(0));
  let b = fabrikPinCenterInto(toPin, fabrikHostXY(1));
  let away = fabrikPinAwayX(fromEnd ? fromPin : toPin);
  let otherDx = fromEnd ? b.x - a.x : a.x - b.x;
  return otherDx * away < 0;
}

function fabrikWireControlInto(fromPin, toPin, fromEnd, ax, ay, bx, by, stubX, stubY, out) {
  let pin = fromEnd ? fromPin : toPin;
  let away = fabrikPinAwayX(pin);
  let otherDx = fromEnd ? bx - ax : ax - bx;
  let headedBack = otherDx * away < 0;
  let extra = headedBack ? 52 : 16;
  let yOff = 0;
  let host = pin && pin.fabrikHost;
  if (headedBack && host && host.shape) {
    let hb = host.shape.getBounds();
    let mid = fabrikMorphLocalToWorld(
      host,
      hb.topLeft.x + hb.extent.x / 2,
      hb.topLeft.y + hb.extent.y / 2,
      fabrikHostXY(4),
    );
    yOff = (stubY < mid.y ? -1 : 1) * 28;
  }
  out.x = stubX + away * extra;
  out.y = stubY + yOff;
  return out;
}

function fabrikWireControlWorld(fromPin, toPin, fromEnd) {
  /**
   * Cubic handle past the 20px stub, still pointing away from the part.
   * Backward runs reach farther and bow around the part so the stub and
   * curve leave the pin as one smooth departure.
   */
  let a = fabrikPinCenterInto(fromPin, fabrikHostXY(0));
  let b = fabrikPinCenterInto(toPin, fabrikHostXY(1));
  let pin = fromEnd ? fromPin : toPin;
  let stubX = (fromEnd ? a.x : b.x) + fabrikPinAwayX(pin) * 20;
  let stubY = fromEnd ? a.y : b.y;
  let o = fabrikWireControlInto(fromPin, toPin, fromEnd, a.x, a.y, b.x, b.y, stubX, stubY, fabrikHostXY(2));
  return pt(o.x, o.y);
}

function fabrikXYSegDist(px, py, ax, ay, bx, by) {
  let dx = bx - ax;
  let dy = by - ay;
  let len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) {
    let ox = px - ax;
    let oy = py - ay;
    return Math.sqrt(ox * ox + oy * oy);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  let qx = ax + t * dx - px;
  let qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function fabrikBezierXY(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t, out) {
  let u = 1 - t;
  let a = u * u * u;
  let b = 3 * u * u * t;
  let c = 3 * u * t * t;
  let d = t * t * t;
  out.x = a * p0x + b * p1x + c * p2x + d * p3x;
  out.y = a * p0y + b * p1y + c * p2y + d * p3y;
  return out;
}

function fabrikWireRefreshGeom(wire) {
  let fromPin = wire.fromPin;
  let toPin = wire.toPin;
  if (!fromPin || !toPin) return false;
  let a = fabrikPinCenterInto(fromPin, fabrikHostXY(0));
  let b = fabrikPinCenterInto(toPin, fabrikHostXY(1));
  if (wire.$gReady && wire.$ax === a.x && wire.$ay === a.y && wire.$bx === b.x && wire.$by === b.y)
    return true;
  let awayA = fabrikPinAwayX(fromPin);
  let awayB = fabrikPinAwayX(toPin);
  let a2x = a.x + awayA * 20;
  let a2y = a.y;
  let b2x = b.x + awayB * 20;
  let b2y = b.y;
  let c1 = fabrikWireControlInto(fromPin, toPin, true, a.x, a.y, b.x, b.y, a2x, a2y, fabrikHostXY(2));
  let c2 = fabrikWireControlInto(fromPin, toPin, false, a.x, a.y, b.x, b.y, b2x, b2y, fabrikHostXY(3));
  wire.$ax = a.x;
  wire.$ay = a.y;
  wire.$bx = b.x;
  wire.$by = b.y;
  wire.$a2x = a2x;
  wire.$a2y = a2y;
  wire.$b2x = b2x;
  wire.$b2y = b2y;
  wire.$c1x = c1.x;
  wire.$c1y = c1.y;
  wire.$c2x = c2.x;
  wire.$c2y = c2.y;
  wire.$gReady = true;
  return true;
}

function fabrikCachedWireHits(wire, px, py) {
  if (!fabrikWireRefreshGeom(wire)) return false;
  if (fabrikXYSegDist(px, py, wire.$ax, wire.$ay, wire.$a2x, wire.$a2y) <= 8) return true;
  if (fabrikXYSegDist(px, py, wire.$b2x, wire.$b2y, wire.$bx, wire.$by) <= 8) return true;
  let prev = fabrikHostXY(5);
  let cur = fabrikHostXY(6);
  prev.x = wire.$a2x;
  prev.y = wire.$a2y;
  for (let i = 1; i <= 16; i++) {
    fabrikBezierXY(
      wire.$a2x,
      wire.$a2y,
      wire.$c1x,
      wire.$c1y,
      wire.$c2x,
      wire.$c2y,
      wire.$b2x,
      wire.$b2y,
      i / 16,
      cur,
    );
    if (fabrikXYSegDist(px, py, prev.x, prev.y, cur.x, cur.y) <= 8) return true;
    prev.x = cur.x;
    prev.y = cur.y;
  }
  return false;
}

function fabrikWireHitsWorldPt(fromPin, toPin, worldPt) {
  if (!fromPin || !toPin || !worldPt) return false;
  let probe = new window.Object();
  probe.fromPin = fromPin;
  probe.toPin = toPin;
  return fabrikCachedWireHits(probe, worldPt.x, worldPt.y);
}

function fabrikViewOnPointerMove(view, p, evt) {
  /** While the view itself is being dragged (parts-bin stamp), skip content hit-testing. */
  if (view.$hitPoint) return Morph.prototype.continuePointerDrag.call(view, p, evt);
  return Morph.prototype.onPointerMove.call(view, p, evt);
}

function fabrikViewOnPointerUp(view, p, evt) {
  if (view.$hitPoint) return Morph.prototype.endPointerDrag.call(view, p, evt);
  return Morph.prototype.onPointerUp.call(view, p, evt);
}

function fabrikPartDragEnded(p, evt, wasDrag) {
  /** Fabrik parts stay in the world — they must not be adopted as submorphs. */
  if (!wasDrag) return;
  let world = this.world();
  if (!world) return;
  if (this.owner && this.owner !== world)
    this.reparentToOwnerPreservingWorldAnchor(world, this.relativize(p));
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
  if (!fabrikPaneShowsPins(host)) return;
  let pins = host.fabrikPins || [];
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
  fabrikEmitIfNoInputs(outPin.fabrikHost);
  if (outPin.value !== undefined) inPin.receive(outPin.value);
  return wire;
}

function fabrikEmitIfNoInputs(host) {
  if (!host || host.className !== 'FabrikFunctionView') return;
  if (host.fabrikInputs && host.fabrikInputs.length) return;
  if (host.fabrikRun) host.fabrikRun();
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
    this.setStyles(fill, 0, fill);
  }
  includesPt(p) {
    let host = this.fabrikHost || this.owner;
    if (host && host.$fabrikShowPins === false) return false;
    if (!fabrikEditMode(this.world())) return false;
    return Morph.prototype.includesPt.call(this, p);
  }
  renderOn(ctx) {
    let host = this.fabrikHost || this.owner;
    if (host && host.$fabrikShowPins === false) return;
    let w = this.shape.extent.x;
    let h = this.shape.extent.y;
    let pointingIn = this.pinDir !== 'out';
    let fill = fabrikPinFill(this.pinDir);
    ctx.save();
    ctx.fillStyle = fill.fillStyle;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // In pins sit on the left (tip toward the part); out pins sit on the right
    // (tip away from the part). Both triangles therefore point right.
    ctx.moveTo(0, 0);
    ctx.lineTo(0, h);
    ctx.lineTo(w, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (host && host.world) {
      let world = host.world();
      if (world && world.$fabrikWiringFrom === this) {
        ctx.save();
        ctx.strokeStyle = '#c45c00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-1, -1);
        ctx.lineTo(-1, h + 1);
        ctx.lineTo(w + 1, h / 2);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
    let name = this.pinName || '';
    if (!name) return;
    ctx.save();
    ctx.font = '11px sans-serif';
    let tw = this.$labelW;
    if (!(tw > 0) || this.$labelFor !== name) {
      tw = 0;
      if (ctx.measureText) {
        let m = ctx.measureText(name);
        if (m && m.width) tw = m.width;
      }
      if (!(tw > 0)) tw = name.length * 6;
      this.$labelW = tw;
      this.$labelFor = name;
    }
    let padX = 3;
    let boxW = tw + padX * 2;
    let boxH = 14;
    let boxX = pointingIn ? w + 2 : -2 - boxW;
    let boxY = h / 2 - boxH / 2;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = Color.blue && Color.blue.fillStyle ? Color.blue.fillStyle : '#0033cc';
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
  if (world && world.morphsAtPointInDepthOrder) {
    let chain = world.morphsAtPointInDepthOrder(worldPt);
    for (let i = 0; i < chain.length; i++) {
      if (chain[i].className === 'FabrikPin') return chain[i];
    }
  }
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
    this.$gReady = false;
  }
  acceptsDroppingMorphs() {
    return false;
  }
  includesPt(p) {
    let world = this.owner;
    if (!world || world.$fabrikViewMode !== 'wiring') return false;
    return fabrikCachedWireHits(this, p.x, p.y);
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    let world = this.owner || this.world();
    if (fabrikPinAtWorld(world, p)) return false;
    if (typeof effectiveMetaKey === 'function' && effectiveMetaKey(evt)) {
      consumeSoftMetaKey();
      if (this.showHalo) this.showHalo();
      return false;
    }
    return true;
  }
  fullBounds() {
    return this.shape.getBounds().copy();
  }
  deliver(value) {
    if (this.toPin) this.toPin.receive(value);
  }
  renderOn(ctx) {
    let world = this.owner;
    if (!world || world.$fabrikViewMode === 'user') return;
    if (!fabrikWireRefreshGeom(this)) return;
    let ox = 0;
    let oy = 0;
    let t = this.transform;
    if (t && t.translation) {
      ox = t.translation.x;
      oy = t.translation.y;
    }
    ctx.save();
    ctx.strokeStyle = '#4a7bd0';
    ctx.lineWidth = world.$fabrikViewMode === 'wiring' ? 2.5 : 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.$ax - ox, this.$ay - oy);
    ctx.lineTo(this.$a2x - ox, this.$a2y - oy);
    ctx.bezierCurveTo(
      this.$c1x - ox,
      this.$c1y - oy,
      this.$c2x - ox,
      this.$c2y - oy,
      this.$b2x - ox,
      this.$b2y - oy,
    );
    ctx.lineTo(this.$bx - ox, this.$by - oy);
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
  acceptsDroppingMorphs() {
    return false;
  }
  dragEnded(p, evt, wasDrag) {
    fabrikPartDragEnded.call(this, p, evt, wasDrag);
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
  onPointerMove(p, evt) {
    return fabrikViewOnPointerMove(this, p, evt);
  }
  onPointerUp(p, evt) {
    return fabrikViewOnPointerUp(this, p, evt);
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
  acceptsDroppingMorphs() {
    return false;
  }
  dragEnded(p, evt, wasDrag) {
    fabrikPartDragEnded.call(this, p, evt, wasDrag);
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
  onPointerMove(p, evt) {
    return fabrikViewOnPointerMove(this, p, evt);
  }
  onPointerUp(p, evt) {
    return fabrikViewOnPointerUp(this, p, evt);
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
    let pad = fabrikPinPad(fabrikPaneShowsPins(this));
    this.contentPane.setBounds(rect(pad.l, 2, Math.max(20, w - pad.l - pad.r), 20));
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
  onPointerMove(p, evt) {
    return fabrikViewOnPointerMove(this, p, evt);
  }
  onPointerUp(p, evt) {
    return fabrikViewOnPointerUp(this, p, evt);
  }
  renderOn(ctx) {
    if (this.$fabrikHidden) return;
    fabrikRenderHostOn(this, ctx);
  }
  fullBounds() {
    return fabrikHostFullBounds(this);
  }
  acceptsDroppingMorphs() {
    return false;
  }
  dragEnded(p, evt, wasDrag) {
    fabrikPartDragEnded.call(this, p, evt, wasDrag);
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
    this.modePane = this.addMorph(
      new TextPane(rect(4, 28, Math.max(40, bounds.width() - 8), 22), rect(0, 0, 1, 1)),
    );
    this.modePane.setPaneMenu(fabrikModePaneMenuSpec());
    this.modePane.setText(fabrikModeLabel('edit'), { force: true });
    fabrikAddPin(this, 'probe', 'in', 'any');
    fabrikAddPin(this, 'categories', 'out', 'text');
    this.relayoutContentPanes();
  }
  relayoutContentPanes() {
    let box = this.paneLayoutBounds();
    let o = box.topLeft;
    if (this.modePane)
      this.modePane.setBounds(rect(o.x + 4, o.y + 2, Math.max(40, box.width() - 8), Math.max(20, box.height() - 4)));
    fabrikLayoutPins(this);
  }
  fabrikPinChanged(pin) {
    if (pin.pinName !== 'probe') return;
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

class FabrikBinPartsPane extends ScrollPane {
  constructor(bounds) {
    super(bounds, rect(0, 0, 1, 1));
    let holder = new Morph(rect(0, 0, Math.max(20, bounds.width() - 15), Math.max(20, bounds.height())));
    holder.setColor(Color.white);
    holder.onPointerDown = function (p, evt) {
      if (!this.fullBounds().includesPt(p)) return false;
      let localP = this.relativize(p);
      let consumed = false;
      this.eachSubmorph(function (sub) {
        if (sub.fullBounds().includesPt(localP)) consumed = sub.onPointerDown(localP, evt);
      });
      return consumed;
    };
    ScrollPane.prototype.installContentAndScrollbar.call(
      this,
      rect(0, 0, 1, 1),
      rect(1, 0, 0, 1),
      holder,
    );
    this.setColor(Color.white);
    this.setStyles(Color.white, 1, Color.gray);
  }
  contentLineHeight() {
    return 24;
  }
  acceptsDroppingMorphs() {
    return false;
  }
  onPointerDown(p, evt) {
    if (!this.fullBounds().includesPt(p)) return false;
    let localP = this.relativize(p);
    this.eachSubmorph(function (sub) {
      if (sub.fullBounds().includesPt(localP)) sub.onPointerDown(localP, evt);
    });
    return true;
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
    this.$binCats = { shapes: [], parts: [], views: [] };
    this.$binCategory = 'shapes';
    let box = this.paneLayoutBounds();
    let w = Math.max(40, box.width() - 8);
    this.categoryPane = this.addMorph(new ListPane(rect(4, box.topLeft.y + 4, w, 62), rect(0, 0, 1, 1)));
    fabrikStripScrollBar(this.categoryPane);
    this.partsPane = this.addMorph(
      new FabrikBinPartsPane(rect(4, box.topLeft.y + 70, w, Math.max(40, box.height() - 74))),
    );
    let bin = this;
    this.categoryPane.onSelect(function (item) {
      bin.showCategory(item);
    });
    this.relayoutContentPanes();
  }
  relayoutContentPanes() {
    if (this.collapsed) return;
    let box = this.paneLayoutBounds();
    let w = Math.max(40, box.width() - 8);
    let catH = 62;
    if (this.categoryPane) {
      Morph.prototype.setBounds.call(this.categoryPane, rect(4, box.topLeft.y + 4, w, catH));
      if (this.categoryPane.contentPane) this.categoryPane.contentPane.setBounds(rect(0, 0, w, catH));
    }
    if (this.partsPane)
      this.partsPane.setBounds(rect(4, box.topLeft.y + 4 + catH + 4, w, Math.max(40, box.height() - catH - 12)));
    this.layoutShownParts();
  }
  showCategory(name) {
    if (name !== 'shapes' && name !== 'parts' && name !== 'views') return;
    this.$binCategory = name;
    this.layoutShownParts();
  }
  findKind(kind) {
    let order = ['shapes', 'parts', 'views'];
    for (let i = 0; i < order.length; i++) {
      let found = this.findKindIn(order[i], kind);
      if (found) return found;
    }
    return null;
  }
  findKindIn(cat, kind) {
    let items = this.$binCats && this.$binCats[cat];
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i].fabrikKind === kind) return items[i];
    }
    return null;
  }
  layoutShownParts() {
    let pane = this.partsPane;
    if (!pane || !pane.contentPane) return;
    let holder = pane.contentPane;
    let kids = [];
    holder.eachSubmorph(function (m) {
      kids.push(m);
    });
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].owner === holder) holder.removeMorph(kids[i]);
    }
    let paneB = pane.getBounds();
    let paneH = paneB.height();
    let scrollW = pane.scrollBarWidth != null ? pane.scrollBarWidth : 15;
    let innerW = Math.max(40, paneB.width() - scrollW);
    let items = (this.$binCats && this.$binCats[this.$binCategory]) || [];
    let x = 8;
    let y = 8;
    let gap = 12;
    for (let j = 0; j < items.length; j++) {
      let m = items[j];
      if (!m) continue;
      holder.addMorph(m);
      if (m.className === 'FabrikFunctionView') {
        Morph.prototype.setBounds.call(m, rect(x, y, Math.max(80, innerW - 16), 40));
        m.$fabrikShowPins = false;
        fabrikFitFunctionView(m);
      } else {
        let b = m.getBounds();
        m.moveBy(pt(x - b.topLeft.x, y - b.topLeft.y));
      }
      let placed = m.getBounds();
      y = placed.topLeft.y + placed.height() + gap;
    }
    let contentH = Math.max(paneH, y + 8);
    holder.setBounds(rect(0, 0, innerW, contentH));
    if (holder.shape && holder.shape.extent) holder.shape.extent.y = contentH;
    if (pane.scrollToTop) pane.scrollToTop();
  }
  includesPt(p) {
    if (this.$fabrikHidden) return false;
    return Morph.prototype.includesPt.call(this, p);
  }
  acceptsDroppingMorphs() {
    return false;
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
    fabrikStrokeDashedFrame(ctx, this.shape.getBounds());
  }
  static new(...args) {
    return new this(...args);
  }
}

class FabrikPanel extends PanelMorph {
  /**
   * Open construction panel: title bar + a tiny content box. Until wrap, the
   * interior is not hittable, so parts under the dashed preview stay editable.
   */
  constructor(bounds) {
    super(bounds || rect(40, 40, 120, 64));
    this.setColor(Color.white);
    this.setStyles(Color.white, 1, Color.gray);
    this.setPanelTitle('Fabrik');
    this.isFabrikPanel = true;
    this.$fabrikWrapped = false;
    if (this.titleBar && this.titleBar.closeBtn) this.titleBar.removeMorph(this.titleBar.closeBtn);
  }
  relayoutContentPanes() {}
  isOpenFabrikPanel() {
    return !this.$fabrikWrapped;
  }
  includesPt(p) {
    if (this.$fabrikWrapped) return Morph.prototype.includesPt.call(this, p);
    if (!this.titleBarHitInfo) return false;
    return !!this.titleBarHitInfo(this.relativize(p));
  }
  morphMenu() {
    return {
      items: ['wrap user views'],
      onSelect: function (item, morph) {
        if (item === 'wrap user views' && morph && morph.wrapUserViews) morph.wrapUserViews();
      },
    };
  }
  previewFrameLocal() {
    let views = fabrikWrappableViewsIn(this);
    if (!views.length) return this.shape.getBounds().copy();
    let u = null;
    for (let i = 0; i < views.length; i++) {
      let wr = views[i].boundsInWorld();
      let tl = this.localize(wr.topLeft);
      let local = rect(tl.x, tl.y, wr.width(), wr.height());
      u = u ? u.union(local) : local;
    }
    return u;
  }
  wrapUserViews() {
    let views = fabrikWrappableViewsIn(this);
    if (!views.length) return this;
    let worldU = null;
    for (let i = 0; i < views.length; i++) {
      let wr = views[i].boundsInWorld();
      worldU = worldU ? worldU.union(wr) : fabrikCopyRect(wr);
    }
    let th = this.titleBarHeight || 24;
    let nb = rect(worldU.topLeft.x, worldU.topLeft.y - th, Math.max(80, worldU.width()), worldU.height() + th);
    this.setBounds(nb);
    for (let j = 0; j < views.length; j++) {
      if (views[j].reparentToOwnerPreservingWorldAnchor)
        views[j].reparentToOwnerPreservingWorldAnchor(this, null);
    }
    this.$fabrikWrapped = true;
    if (this.layoutChrome) this.layoutChrome();
    if (this.changed) this.changed();
    return this;
  }
  renderMeOn(ctx) {
    if (!this.$fabrikWrapped) return;
    Morph.prototype.renderMeOn.call(this, ctx);
  }
  renderOn(ctx) {
    if (this.$fabrikWrapped) {
      Morph.prototype.renderOn.call(this, ctx);
      if (fabrikEditMode(this.world())) fabrikStrokeDashedFrame(ctx, this.shape.getBounds());
      return;
    }
    if (this.titleBar) {
      ctx.save();
      let tfm = this.titleBar.transform;
      ctx.translate(tfm.translation.x, tfm.translation.y);
      this.titleBar.renderOn(ctx);
      ctx.restore();
    }
    if (fabrikEditMode(this.world())) fabrikStrokeDashedFrame(ctx, this.previewFrameLocal());
  }
  static new(...args) {
    return new this(...args);
  }
}

function fabrikStrokeDashedFrame(ctx, b) {
  if (!ctx || !b) return;
  let o = b.topLeft;
  ctx.save();
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1.5;
  if (ctx.setLineDash) ctx.setLineDash([7, 4]);
  ctx.strokeRect(o.x + 1, o.y + 1, b.width() - 2, b.height() - 2);
  ctx.restore();
}

function fabrikIsWrappableView(m) {
  if (!m) return false;
  let cn = m.className;
  if (cn !== 'FabrikListView' && cn !== 'FabrikTextView') return false;
  if (m.isFabrikProto || m.$fabrikHidden) return false;
  return true;
}

function fabrikWrappableViewsIn(panel) {
  let world = panel && panel.world ? panel.world() : null;
  let found = [];
  if (!world || !world.eachSubmorph || !panel.boundsInWorld) return found;
  let frame = panel.boundsInWorld();
  world.eachSubmorph(function (m) {
    if (!fabrikIsWrappableView(m)) return;
    if (m.owner !== world) return;
    if (!m.boundsInWorld) return;
    if (frame.overlapsRect(m.boundsInWorld())) found.push(m);
  });
  return found;
}

function fabrikMakeNewPanel(world) {
  world = world || Lively;
  let th = 24;
  if (typeof PanelTitleBar === 'function' && PanelTitleBar.prototype && PanelTitleBar.prototype.HEIGHT)
    th = PanelTitleBar.prototype.HEIGHT;
  let x = 40;
  let y = 40;
  let cats = world && world.get ? world.get('categories') : null;
  if (cats && cats.getBounds) {
    let b = cats.getBounds();
    x = b.topLeft.x;
    y = b.topLeft.y - (th + 48);
    if (y < 8) y = 8;
  }
  let panel = new FabrikPanel(rect(x, y, 120, th + 40));
  if (world && world.addMorph) world.addMorph(panel);
  return panel;
}

function fabrikWorldPtInBin(world, worldP) {
  let bin = world && world.get && world.get('fabrikBin');
  if (!bin || bin.$fabrikHidden || !bin.boundsInWorld) return false;
  return bin.boundsInWorld().includesPt(worldP);
}

function fabrikStamp(proto, dest, at) {
  let m = null;
  let kind = proto.fabrikKind;
  if (kind === 'listView') {
    m = new FabrikListView(rect(at.x, at.y, 160, 200));
    if (proto.fabrikList) m.setList(proto.fabrikList);
  } else if (kind === 'textView') m = new FabrikTextView(rect(at.x, at.y, 240, 180));
  else if (kind === 'functionView') {
    m = new FabrikFunctionView(rect(at.x, at.y, 260, 96), {
      source: proto.fabrikSource || '(v) => v',
      inputs: proto.fabrikInputs || [{ name: 'v', type: 'any' }],
      outputType: proto.fabrikOutputType || 'any',
    });
    m.fabrikSource = proto.fabrikSource;
    m.fabrikInputs = proto.fabrikInputs;
    m.fabrikOutputType = proto.fabrikOutputType;
    m.fabrikPartName = proto.fabrikPartName;
  } else if (proto.className === 'LineMorph')
    m = new LineMorph([pt(at.x, at.y), pt(at.x + 50, at.y)], { borderWidth: 2, borderColor: Color.black });
  else m = proto.morphCopy();
  if (!m) return null;
  dest.addMorph(m);
  if (kind !== 'listView' && kind !== 'textView' && kind !== 'functionView' && proto.className !== 'LineMorph') {
    m.moveBy(at.subPt(m.getBounds().topLeft));
  }
  return m;
}

function fabrikGuessPinType(name) {
  if (name == 'cls' || name == 'klass' || name == 'obj' || name == 'value' || name == 'fn') return 'any';
  return 'text';
}

function fabrikFnParamNames(fn) {
  if (typeof fn !== 'function' || !fn.toString) return [];
  let src = fn.toString();
  let open = src.indexOf('(');
  let close = src.indexOf(')');
  if (open < 0 || close <= open) return [];
  let parts = src.slice(open + 1, close).split(',');
  let names = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    while (p.length > 0 && (p.charAt(0) == ' ' || p.charAt(0) == '\n' || p.charAt(0) == '\t')) p = p.slice(1);
    if (p.indexOf('...') == 0) p = p.slice(3);
    let eq = p.indexOf('=');
    if (eq >= 0) p = p.slice(0, eq);
    while (p.length > 0 && (p.charAt(p.length - 1) == ' ' || p.charAt(p.length - 1) == '\n')) p = p.slice(0, p.length - 1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)) names.push(p);
  }
  return names;
}

function fabrikPartFromGlobalName(name, at) {
  let fn = null;
  if (typeof $global !== 'undefined' && $global) fn = $global[name];
  if (typeof fn !== 'function' && typeof globalThis !== 'undefined') fn = globalThis[name];
  if (typeof fn !== 'function') return null;
  let params = fabrikFnParamNames(fn);
  let args = params.join(', ');
  let source = fn.toString();
  let namedHead = 'function ' + name + '(';
  if (source.indexOf('function (') === 0 || source.indexOf('function(') === 0)
    source = 'function ' + name + source.slice(source.indexOf('('));
  else if (source.indexOf(namedHead) !== 0 && source.indexOf('function ' + name + ' ') !== 0)
    source = namedHead + args + ') { return $global.' + name + '(' + args + '); }';
  let inputs = [];
  for (let i = 0; i < params.length; i++) inputs.push({ name: params[i], type: fabrikGuessPinType(params[i]) });
  let fv = new FabrikFunctionView(rect(at.x, at.y, 250, 84), {
    source: source,
    inputs: inputs,
    outputType: 'any',
  });
  fv.setName(name);
  fabrikFitFunctionView(fv);
  return fv;
}

function fabrikMakePartFromGlobal(panel) {
  let name = panel && panel.selectedMethod;
  if (!name) return null;
  let world = panel.world && panel.world() ? panel.world() : Lively;
  let at = pt(660, 70);
  if (panel.boundsInWorld) {
    let b = panel.boundsInWorld();
    at = pt(b.topLeft.x + b.width() + 24, b.topLeft.y + 28);
  }
  let fv = fabrikPartFromGlobalName(name, at);
  if (fv && world && world.addMorph) world.addMorph(fv);
  return fv;
}

function fabrikBindOpenFabrikItem(menu) {
  if (!menu) return menu;
  let action = function () {
    openFabrik();
  };
  let ix = menu.findItem ? menu.findItem('Open Fabrik') : -1;
  if (ix >= 0) {
    if (menu.ensureActionList) menu.ensureActionList();
    if (menu.menuActions) menu.menuActions[ix] = action;
    let list = menu.itemList;
    if (list && list[ix] && list[ix].action) list[ix].action = action;
    return menu;
  }
  if (menu.addItemBefore && menu.findItem && menu.findItem('transcript') >= 0)
    menu.addItemBefore('transcript', menuItem('Open Fabrik', action));
  else if (menu.addItem) menu.addItem(menuItem('Open Fabrik', action));
  return menu;
}

function fabrikOfferOpenMenu(world) {
  world = world || (typeof Lively === 'object' ? Lively : null);
  if (!world) return;
  let kids = [];
  if (world.submorphs) for (let i = 0; i < world.submorphs.length; i++) kids.push(world.submorphs[i]);
  if (world.$submorphs) for (let i = 0; i < world.$submorphs.length; i++) kids.push(world.$submorphs[i]);
  for (let i = 0; i < kids.length; i++) {
    let m = kids[i];
    if (!m || m.className !== 'MenuMorph') continue;
    if (m.findItem && m.findItem('transcript') < 0) continue;
    fabrikBindOpenFabrikItem(m);
  }
}

function fabrikMenuWidth() {
  return 200;
}

function fabrikWorldMenuTopLeft(world) {
  /** World menu at (20, 20); Fabrik menu sits 20px below it. */
  let b = world && world.getBounds ? world.getBounds() : rect(0, 0, 800, 600);
  return pt(b.topLeft.x + 20, b.topLeft.y + 20);
}

function fabrikInstallWorldMenu(world) {
  if (!world || !world.showWorldMenuAt) return null;
  let prior = world.get && world.get('worldMenu');
  if (prior && prior.remove) prior.remove();
  let menu = world.showWorldMenuAt(fabrikWorldMenuTopLeft(world));
  if (!menu) return null;
  menu.setName('worldMenu');
  menu.isFleetingMenu = false;
  if (menu.owner !== world && world.addMorph) world.addMorph(menu);
  fabrikBindOpenFabrikItem(menu);
  return menu;
}

function fabrikInstallViewMenu(world) {
  if (!world) return null;
  let prior = world.get && world.get('fabrikViewMenu');
  if (prior && prior.remove) prior.remove();
  let wm = world.get && world.get('worldMenu');
  let at;
  if (wm && wm.getBounds) {
    let b = wm.getBounds();
    at = pt(b.topLeft.x, b.topLeft.y + b.height() + 20);
  } else {
    let o = fabrikWorldMenuTopLeft(world);
    at = pt(o.x, o.y + 44);
  }
  let items = [
    menuItem('user view', function () {
      fabrikSetView('user', world);
    }),
    menuItem('edit view', function () {
      fabrikSetView('edit', world);
    }),
    menuItem('wiring', function () {
      fabrikSetView('wiring', world);
    }),
    menuItem('make new panel', function () {
      fabrikMakeNewPanel(world);
    }),
  ];
  let menu = new MenuMorph(rect(at.x, at.y, fabrikMenuWidth(), 24 + items.length * 20), items);
  menu.setName('fabrikViewMenu');
  menu.isFleetingMenu = false;
  if (world.addMorph) world.addMorph(menu);
  fabrikSyncViewMenu(world);
  return menu;
}

function fabrikSyncViewMenu(world) {
  let menu = world && world.get ? world.get('fabrikViewMenu') : null;
  if (!menu || !menu.shape) return;
  let ix = menu.findItem ? menu.findItem(fabrikModeLabel(fabrikViewMode(world))) : -1;
  if (ix < 0) {
    if (menu.shape.selectLineAt) menu.shape.selectLineAt(0);
    return;
  }
  menu.shape.$selectedLineIndex = ix + 1;
}

function fabrikBinProtoOf(m) {
  while (m) {
    if (m.isFabrikProto) return m;
    m = m.owner;
  }
  return null;
}

function fabrikBinProtoPointerDown(p, evt) {
  if (!this.includesPt(p)) return false;
  let proto = fabrikBinProtoOf(this);
  if (!proto) return false;
  let world = this.world();
  let worldP = this.owner ? this.owner.globalize(p) : p;
  let at = proto.boundsInWorld().topLeft;
  let copy = fabrikStamp(proto, world, at);
  if (!copy) return false;
  copy.$fabrikBinDrag = true;
  copy.dragEnded = function (upP, upEvt, wasDrag) {
    let dropP = this.owner ? this.owner.globalize(upP) : upP;
    if (fabrikWorldPtInBin(this.world(), dropP) || !wasDrag) {
      this.remove();
      return;
    }
    this.$fabrikBinDrag = false;
    this.dragEnded = fabrikPartDragEnded;
    fabrikPartDragEnded.call(this, upP, upEvt, wasDrag);
  };
  copy.beginPointerDrag(worldP, evt);
  return true;
}

function fabrikArmBinProto(morph) {
  fabrikEachMorph(morph, function (m) {
    m.onPointerDown = fabrikBinProtoPointerDown;
  });
}

function fabrikMakeBinItem(bin, morph, kind, label, category) {
  morph.fabrikKind = kind;
  morph.isFabrikProto = true;
  if (label) morph.setName(label);
  if (!bin.$binCats) bin.$binCats = { shapes: [], parts: [], views: [] };
  let cat = category || 'shapes';
  if (!bin.$binCats[cat]) bin.$binCats[cat] = [];
  bin.$binCats[cat].push(morph);
  fabrikArmBinProto(morph);
  return morph;
}

function fabrikDemoFunctionSpecs() {
  return [
    {
      name: 'browserCategoryNames',
      source: 'function browserCategoryNames() { return $global.browserCategoryNames(); }',
      inputs: [],
      outputType: 'text',
    },
    {
      name: 'classNamesInCategory',
      source: 'function classNamesInCategory(category) { return fabrikClassNamesInCategory(category); }',
      inputs: [{ name: 'category', type: 'text' }],
      outputType: 'text',
    },
    {
      name: 'classNamed',
      source: 'function classNamed(s) { return $global.classNamed(s); }',
      inputs: [{ name: 's', type: 'text' }],
      outputType: 'any',
    },
    {
      name: 'methodsOfClass',
      source: 'function methodsOfClass(cls) { return fabrikMethodNames(cls); }',
      inputs: [{ name: 'cls', type: 'any' }],
      outputType: 'text',
    },
    {
      name: 'codeString',
      source: 'function codeString(cls, name) { return fabrikCodeString(cls, name); }',
      inputs: [
        { name: 'cls', type: 'any' },
        { name: 'name', type: 'text' },
      ],
      outputType: 'text',
    },
  ];
}

function fabrikPopulateBin(bin) {
  let box = new Morph(rect(0, 0, 48, 28));
  fabrikMakeBinItem(bin, box, 'box', 'box', 'shapes');
  let oval = new Morph(null, new Ellipse(pt(20, 16), pt(20, 14)));
  oval.setStyles(Color.green.lighter(), 2, Color.black);
  fabrikMakeBinItem(bin, oval, 'oval', 'oval', 'shapes');
  let star = new Morph(null, new Pen().star(10, 30, Color.black));
  star.setColor(Color.yellow);
  fabrikMakeBinItem(bin, star, 'star', 'star', 'shapes');
  let line = new LineMorph([pt(0, 8), pt(50, 8)], { borderWidth: 2, borderColor: Color.black });
  line.updateHoverHandles = function () {};
  fabrikMakeBinItem(bin, line, 'line', 'line', 'shapes');

  let specs = fabrikDemoFunctionSpecs();
  for (let i = 0; i < specs.length; i++) {
    let spec = specs[i];
    let part = new FabrikFunctionView(rect(0, 0, 220, 40), spec);
    part.$fabrikShowPins = false;
    part.fabrikSource = spec.source;
    part.fabrikInputs = spec.inputs;
    part.fabrikOutputType = spec.outputType;
    part.fabrikPartName = spec.name;
    fabrikFitFunctionView(part);
    fabrikMakeBinItem(bin, part, 'functionView', null, 'parts');
  }

  let lv = new Morph(rect(0, 0, 130, 22));
  lv.setColor(Color.white);
  lv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'listView'));
  lv.fabrikList = ['one', 'two', 'three'];
  fabrikMakeBinItem(bin, lv, 'listView', 'listView', 'views');
  let tv = new Morph(rect(0, 0, 130, 22));
  tv.setColor(Color.white);
  tv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'textView'));
  fabrikMakeBinItem(bin, tv, 'textView', 'textView', 'views');
  let fv = new Morph(rect(0, 0, 130, 22));
  fv.setColor(Color.white);
  fv.addMorph(new TextMorph(rect(4, 2, 120, 18), 'functionView'));
  fv.fabrikSource = '(v) => v';
  fv.fabrikInputs = [{ name: 'v', type: 'any' }];
  fabrikMakeBinItem(bin, fv, 'functionView', 'functionView', 'views');

  if (bin.categoryPane) bin.categoryPane.setList(['shapes', 'parts', 'views']);
  bin.showCategory('shapes');
  if (bin.categoryPane && bin.categoryPane.setSelectionString) bin.categoryPane.setSelectionString('shapes', true);
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
  let x = FABRIK_FN_X + FABRIK_FN_W + FABRIK_FN_TO_EDIT;
  return rect(x, 84, e.x, e.y);
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

function fabrikDemoFnNames() {
  let specs = fabrikDemoFunctionSpecs();
  let names = [];
  for (let i = 0; i < specs.length; i++) names.push(specs[i].name);
  return names;
}

function fabrikDemoUserViewNames() {
  return ['categories', 'classNames', 'methodNames', 'methodDefinition'];
}

function fabrikDemoPaneLocals(edit) {
  let origin = fabrikDefaultUserPanelBounds();
  let th = 24;
  let content = rect(0, th, origin.width(), Math.max(8, origin.height() - th));
  let userPanes =
    typeof browserPanelUserPaneBounds === 'function'
      ? browserPanelUserPaneBounds(content)
      : {
          category: rect(0, th, 160, 22),
          classNames: rect(0, th + 22, 160, 88),
          methodNames: rect(160, th, 240, 110),
          methodDefinition: rect(0, th + 110, 400, 166),
        };
  return edit ? fabrikExpandUserPaneBounds(userPanes, FABRIK_EDIT_GAP) : userPanes;
}

function fabrikOffsetRect(origin, local) {
  return rect(
    origin.topLeft.x + local.topLeft.x,
    origin.topLeft.y + local.topLeft.y,
    local.width(),
    local.height(),
  );
}

function fabrikDemoPaneWorldRects(edit) {
  let origin = fabrikDefaultUserPanelBounds();
  let panes = fabrikDemoPaneLocals(edit);
  return {
    categories: fabrikOffsetRect(origin, panes.category),
    classNames: fabrikOffsetRect(origin, panes.classNames),
    methodNames: fabrikOffsetRect(origin, panes.methodNames),
    methodDefinition: fabrikOffsetRect(origin, panes.methodDefinition),
  };
}

function fabrikPlaceFunctionView(world, name, x, y, w) {
  let m = world && world.get ? world.get(name) : null;
  if (!m) return null;
  Morph.prototype.setBounds.call(m, rect(x, y, w, 40));
  fabrikFitFunctionView(m);
  fabrikRememberLayout(m, 'edit', m.getBounds());
  return m;
}

function fabrikEnsureLayouts(world, _browser) {
  /**
   * User layout hugs the four world-level views. Edit layout expands that
   * region by FABRIK_EDIT_GAP. Stored on each part as $fabrikLayouts.
   */
  if (!world || world.$fabrikLayoutsReady) return;
  let gap = FABRIK_EDIT_GAP;
  let userPanel = fabrikDefaultUserPanelBounds();
  let th = 24;
  let userRects = fabrikDemoPaneWorldRects(false);
  let editRects = fabrikDemoPaneWorldRects(true);
  let names = fabrikDemoUserViewNames();
  for (let i = 0; i < names.length; i++) {
    let m = world.get ? world.get(names[i]) : null;
    if (!m) continue;
    fabrikRememberLayout(m, 'user', userRects[names[i]]);
    fabrikRememberLayout(m, 'edit', editRects[names[i]]);
  }
  let outX = FABRIK_FN_X;
  let y = userPanel.topLeft.y + th + FABRIK_FN_Y_DROP;
  let fnW = FABRIK_FN_W;
  let fnNames = ['classNamesInCategory', 'classNamed', 'methodsOfClass', 'codeString'];
  for (let j = 0; j < fnNames.length; j++) {
    let fm = fabrikPlaceFunctionView(world, fnNames[j], outX, y, fnW);
    if (!fm) continue;
    let b = fm.getBounds();
    y = b.topLeft.y + b.height() + gap;
  }
  let first = world.get ? world.get('classNamesInCategory') : null;
  if (first) {
    let fb = first.getBounds();
    let catFn = fabrikPlaceFunctionView(world, 'browserCategoryNames', outX, fb.topLeft.y - gap - 40, fnW);
    if (catFn) {
      let ch = catFn.getBounds().height();
      fabrikPlaceFunctionView(world, 'browserCategoryNames', outX, fb.topLeft.y - gap - ch, fnW);
    }
  }
  world.$fabrikLayoutsReady = true;
}

function fabrikApplyViewLayouts(world, edit) {
  if (!world) return;
  let mode = edit ? 'edit' : 'user';
  let names = fabrikDemoUserViewNames();
  for (let i = 0; i < names.length; i++) {
    let pane = world.get ? world.get(names[i]) : null;
    if (!pane) continue;
    if (pane.owner && pane.owner !== world) continue;
    let stored = fabrikGetLayout(pane, mode);
    if (!stored || !stored.bounds) continue;
    pane.$fabrikShowPins = !!edit;
    pane.setBounds(fabrikCopyRect(stored.bounds));
  }
}

function fabrikApplyBrowserLayout(browser, edit) {
  if (!browser || browser.collapsed) return;
  fabrikApplyViewLayouts(browser.world ? browser.world() : Lively, edit);
}

function fabrikLayoutBrowser(browser, edit) {
  fabrikApplyBrowserLayout(browser, edit);
}

function fabrikPlaceHelpers(world, edit) {
  let names = fabrikDemoFnNames();
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

function fabrikModeLabel(mode) {
  return mode === 'user' ? 'user view' : mode === 'wiring' ? 'wiring' : 'edit view';
}

function fabrikModePaneMenuSpec() {
  return {
    items: ['edit view', 'wiring', 'user view'],
    onSelect: function (item, pane) {
      let mode = item === 'user view' ? 'user' : item === 'wiring' ? 'wiring' : 'edit';
      fabrikSetView(mode, (pane && pane.world && pane.world()) || Lively);
    },
  };
}

function fabrikSetView(mode, world) {
  world = world || Lively;
  if (mode !== 'user' && mode !== 'wiring') mode = 'edit';
  world.$fabrikViewMode = mode;
  let edit = mode !== 'user';
  world.$fabrikEditMode = edit;
  fabrikEnsureLayouts(world);
  fabrikApplyViewLayouts(world, edit);
  fabrikPlaceHelpers(world, edit);
  fabrikStackWires(world, mode === 'wiring');
  fabrikApplyFabrikChrome(world);
  let fab = world.get && world.get('fabrik');
  if (fab && fab.modePane && fab.modePane.setText) {
    fab.modePane.setPaneMenu(fabrikModePaneMenuSpec());
    fab.modePane.setText(fabrikModeLabel(mode), { force: true });
  }
  fabrikSyncViewMenu(world);
  if (world.changed) world.changed();
}

function fabrikReveal(world, category, className, methodName) {
  let cats = world.get('categories');
  if (cats && category) cats.setSelectionString(category);
  let classes = world.get('classNames');
  if (classes && className) classes.setSelectionString(className);
  let methods = world.get('methodNames');
  if (methods && methodName) methods.setSelectionString(methodName);
}

function fabrikBuildDemo(world) {
  /**
   * A Lively-style system browser from parts laid out as a wiring diagram:
   *   the four user views in the world, then the functions, then the wires.
   */
  let editRects = fabrikDemoPaneWorldRects(true);
  let categories = world.addMorph(new FabrikListView(editRects.categories));
  categories.setName('categories');
  let classNames = world.addMorph(new FabrikListView(editRects.classNames));
  classNames.setName('classNames');
  let methodNames = world.addMorph(new FabrikListView(editRects.methodNames));
  methodNames.setName('methodNames');
  let methodDefinition = world.addMorph(new FabrikTextView(editRects.methodDefinition));
  methodDefinition.setName('methodDefinition');

  let specs = fabrikDemoFunctionSpecs();
  let fns = {};
  for (let i = 0; i < specs.length; i++) {
    let spec = specs[i];
    let fv = world.addMorph(new FabrikFunctionView(rect(FABRIK_FN_X, 70, FABRIK_FN_W, 84), spec));
    fv.setName(spec.name);
    fns[spec.name] = fv;
  }
  let browserCategoryNamesFn = fns.browserCategoryNames;
  let classNamesInCategory = fns.classNamesInCategory;
  let classFn = fns.classNamed;
  let methodsFn = fns.methodsOfClass;
  let codeFn = fns.codeString;

  fabrikConnect(fabrikPinNamed(browserCategoryNamesFn, 'result'), fabrikPinNamed(categories, 'strings'));
  fabrikConnect(fabrikPinNamed(categories, 'selection'), fabrikPinNamed(classNamesInCategory, 'category'));
  fabrikConnect(fabrikPinNamed(classNamesInCategory, 'result'), fabrikPinNamed(classNames, 'strings'));
  fabrikConnect(fabrikPinNamed(classNames, 'selection'), fabrikPinNamed(classFn, 's'));
  fabrikConnect(fabrikPinNamed(classFn, 'result'), fabrikPinNamed(methodsFn, 'cls'));
  fabrikConnect(fabrikPinNamed(methodsFn, 'result'), fabrikPinNamed(methodNames, 'strings'));
  fabrikConnect(fabrikPinNamed(classFn, 'result'), fabrikPinNamed(codeFn, 'cls'));
  fabrikConnect(fabrikPinNamed(methodNames, 'selection'), fabrikPinNamed(codeFn, 'name'));
  fabrikConnect(fabrikPinNamed(codeFn, 'result'), fabrikPinNamed(methodDefinition, 'text'));

  fabrikEnsureLayouts(world);
  fabrikApplyViewLayouts(world, true);
  fabrikReveal(world, 'Basic Graphics', 'Ellipse', 'moveBy');
  return {
    categories: categories,
    classNames: classNames,
    methodNames: methodNames,
    methodDefinition: methodDefinition,
    browserCategoryNames: browserCategoryNamesFn,
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

function openFabrik(world) {
  /**
   * Construction world: parts bin, wheel, world menu, Fabrik view menu.
   * World menu 'Open Fabrik' starts here so a construction can be thrown away
   * and started over. Call fabrikTest() to add the wired browser demo.
   */
  if (world == null) {
    if (typeof initLively === 'function') initLively();
    world = Lively;
  }
  fabrikClearWorld(world);
  world.setColor(Color.white);
  if (world.setStyles) world.setStyles(Color.white, 0, Color.white);
  world.fabrikWires = [];
  world.$fabrikEditMode = true;
  world.$fabrikViewMode = 'edit';
  world.$fabrikLayoutsReady = false;
  world.isFabrikWorld = true;

  let bin = world.addMorph(new FabrikBin(rect(1160, 32, 370, 536)));
  bin.setName('fabrikBin');
  fabrikPopulateBin(bin);

  fabrikInstallWheel(world);
  fabrikInstallWorldMenu(world);
  fabrikInstallViewMenu(world);
  world.fabrikStamp = FABRIK_WRITTEN_ON;
  return world;
}

function fabrikTest(world) {
  /**
   * Browser construction test: user views, function parts, wires, view menu.
   */
  world = world || Lively;
  if (!world) return null;
  if (!world.isFabrikWorld) openFabrik(world);
  world.$fabrikLayoutsReady = false;
  fabrikBuildDemo(world);
  fabrikInstallViewMenu(world);
  fabrikSetView('edit', world);
  return world;
}

function fabrikBuildWorld(world) {
  openFabrik(world);
  fabrikTest(world);
  return world;
}

if (typeof Lively === 'object' && Lively) fabrikOfferOpenMenu(Lively);
