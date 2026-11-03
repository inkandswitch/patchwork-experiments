//written on 2026-11-03 11:22 EST
// Fabrik — application construction set on newdefs (Livelymerge Morphic).
// Parts bin, pins, wires, and a system browser with edit / layout / user view.
//
let FABRIK_WRITTEN_ON = '2026-11-03 11:22 EST';
let FABRIK_EDIT_GAP = 48;
let FABRIK_PIN_W = 14;
let FABRIK_PIN_H = 12;
let FABRIK_GRID = 8;
let FABRIK_BORDER_W = 2;
let FABRIK_CORNER = 10;
let FABRIK_FN_X = 250;
let FABRIK_FN_W = 250;
let FABRIK_FN_TO_EDIT = 80;
let FABRIK_FN_Y_DROP = 100;

function fabrikViewMode(world) {
  world = world || Lively;
  let m = world && world.$fabrikViewMode;
  if (m === 'wiring') return 'edit';
  if (m === 'edit' || m === 'layout' || m === 'user') return m;
  return world && world.$fabrikEditMode ? 'edit' : 'user';
}

function fabrikEditMode(world) {
  return fabrikViewMode(world) === 'edit';
}

function fabrikLayoutMode(world) {
  return fabrikViewMode(world) === 'layout';
}

function fabrikCanMoveParts(world) {
  let m = fabrikViewMode(world);
  return m === 'edit' || m === 'layout';
}

function fabrikWiringMode(world) {
  return fabrikViewMode(world) === 'edit';
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

function fabrikFunctionHeading(fv) {
  let name = fv && fv.fabrikPartName;
  if (!name) {
    let src = (fv && fv.fabrikSource) || '';
    let head = 'function ';
    let at = src.indexOf(head);
    if (at >= 0) {
      at = at + head.length;
      let end = at;
      while (end < src.length) {
        let ch = src.charAt(end);
        if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_') end = end + 1;
        else break;
      }
      if (end > at) name = src.substring(at, end);
    }
  }
  if (!name) name = 'function';
  let args = [];
  let inputs = (fv && fv.fabrikInputs) || [];
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i] && inputs[i].name) args.push(inputs[i].name);
  }
  return name + '(' + args.join(', ') + ')';
}

function fabrikBinProtoLabel(fv) {
  if (fv && fv.fabrikPartName === 'function') return 'JS function(args)';
  return fabrikFunctionHeading(fv);
}

function fabrikHeadingPixelWidth(heading) {
  let s = heading || '';
  let tw = 0;
  if (typeof ctx === 'object' && ctx && ctx.measureText) {
    let prev = ctx.font;
    ctx.font = '12px sans-serif';
    let m = ctx.measureText(s);
    if (m && m.width) tw = m.width;
    if (prev) ctx.font = prev;
  }
  if (!(tw > 0)) tw = s.length * 7;
  return Math.max(40, Math.ceil(tw) + 16);
}

function fabrikBinProtoHugWidth(m) {
  let s = '';
  if (m && m.className === 'FabrikFunctionView') s = fabrikBinProtoLabel(m);
  else if (m && m.contentPane && m.contentPane.shape && m.contentPane.shape.string != null)
    s = '' + m.contentPane.shape.string;
  let lines = s.split('\n');
  let w = 40;
  for (let i = 0; i < lines.length; i++) {
    let lw = fabrikHeadingPixelWidth(lines[i]);
    if (lw > w) w = lw;
  }
  return w;
}

function fabrikFitBinProto(m) {
  /** Hug bin tiles to heading / content, same shrink-wrap as parts. */
  if (!m || !m.isFabrikProto) return;
  m.$fabrikShowPins = true;
  m.$fabrikPinLabels = false;
  fabrikStyleBinProto(m);
  if (m.className === 'FabrikFunctionView') {
    fabrikFitFunctionView(m);
    return;
  }
  if (m.className !== 'FabrikListView' && m.className !== 'FabrikTextView') return;
  let o = m.getBounds().topLeft;
  let pad = fabrikHostPad(m);
  let w = fabrikBinProtoHugWidth(m);
  let innerW = Math.max(20, w - pad.l - pad.r);
  if (m.contentPane) {
    fabrikSetFrame(m.contentPane, pad.l, 0, innerW, 20);
    fabrikGrowContent(m);
  }
  let textH = fabrikContentHeight(m) || 20;
  let h = Math.max(24, textH + 4);
  Morph.prototype.setBounds.call(m, rect(o.x, o.y, w, h));
  if (m.contentPane) fabrikSetFrame(m.contentPane, pad.l, 0, innerW, textH);
  fabrikLayoutPins(m);
}

function fabrikFitFunctionView(fv) {
  if (!fv) return;
  let o = fv.getBounds().topLeft;
  let w = fv.getBounds().width();
  if (fv.isFabrikProto) {
    let h = fv.getBounds().height();
    if (!(h > 20)) h = 32;
    w = fabrikHeadingPixelWidth(fabrikBinProtoLabel(fv));
    Morph.prototype.setBounds.call(fv, rect(o.x, o.y, w, h));
    fabrikLayoutPins(fv);
    return;
  }
  if (!fv.contentPane) return;
  let pad = fabrikHostPad(fv);
  fv.contentPane.setBounds(rect(pad.l, 0, Math.max(20, w - pad.l - pad.r), 20));
  fabrikGrowContent(fv);
  let textH = fv.contentPane.shape && fv.contentPane.shape.extent ? fv.contentPane.shape.extent.y : 20;
  let needH = Math.max(32, textH);
  Morph.prototype.setBounds.call(fv, rect(o.x, o.y, w, needH));
  fv.contentPane.setBounds(rect(pad.l, 0, Math.max(20, w - pad.l - pad.r), textH));
  fabrikLayoutPins(fv);
  fabrikSyncPaneChrome(fv);
  if (!fv.$fabrikApplyingLayout) fabrikSnapMorph(fv);
}

function fabrikPaneShowsPins(pane) {
  if (pane && pane.$fabrikShowPins != null) return !!pane.$fabrikShowPins;
  return fabrikEditMode(pane && pane.world ? pane.world() : null);
}

function fabrikPinPad(_edit) {
  /** Edit views hug like user view; pin names overlay the content. */
  return { l: 0, r: 0 };
}

function fabrikHostPad(pane) {
  if (pane && pane.isFabrikProto && pane.$fabrikPinLabels === false) return { l: 4, r: 4 };
  return fabrikPinPad(fabrikPaneShowsPins(pane));
}

function fabrikPinLabelAlpha(world) {
  return fabrikViewMode(world) === 'edit' ? 0.8 : 0;
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
  let pad = fabrikHostPad(pane);
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
  fabrikSyncPaneChrome(pane);
  if (!pane.$fabrikApplyingLayout) fabrikSnapMorph(pane);
  return h;
}

function fabrikGrid(n) {
  return Math.round(n / FABRIK_GRID) * FABRIK_GRID;
}

function fabrikSnapRect(r) {
  if (!r) return r;
  let x;
  let y;
  let w;
  let h;
  if (r.w != null) {
    x = fabrikGrid(r.x);
    y = fabrikGrid(r.y);
    w = Math.max(FABRIK_GRID, fabrikGrid(r.w));
    h = Math.max(FABRIK_GRID, fabrikGrid(r.h));
    return rect(x, y, w, h);
  }
  x = fabrikGrid(r.topLeft.x);
  y = fabrikGrid(r.topLeft.y);
  w = Math.max(FABRIK_GRID, fabrikGrid(r.width()));
  h = Math.max(FABRIK_GRID, fabrikGrid(r.height()));
  if (r.topLeft.x === x && r.topLeft.y === y && r.width() === w && r.height() === h) return r;
  return rect(x, y, w, h);
}

function fabrikSetFrame(m, x, y, w, h) {
  /** In-place translation/extent. Same-value writes are elided; never `rect()`/`pt()`. */
  if (!m) return;
  let t = m.transform && m.transform.translation;
  if (t) {
    if (t.x !== x) t.x = x;
    if (t.y !== y) t.y = y;
  }
  if (m.shape) {
    if (m.shape.topLeft) {
      if (m.shape.topLeft.x !== 0) m.shape.topLeft.x = 0;
      if (m.shape.topLeft.y !== 0) m.shape.topLeft.y = 0;
    }
    if (m.shape.extent) {
      if (m.shape.extent.x !== w) m.shape.extent.x = w;
      if (m.shape.extent.y !== h) m.shape.extent.y = h;
    }
  }
  let b = m.bounds;
  if (b) {
    if (b.topLeft) {
      if (b.topLeft.x !== x) b.topLeft.x = x;
      if (b.topLeft.y !== y) b.topLeft.y = y;
    }
    if (b.extent) {
      if (b.extent.x !== w) b.extent.x = w;
      if (b.extent.y !== h) b.extent.y = h;
    }
  }
}

function fabrikSetPos(m, x, y) {
  /** Move a morph without rewriting shape extent — Path vertices stay in local space. */
  if (!m) return;
  let t = m.transform && m.transform.translation;
  if (t) {
    if (t.x !== x) t.x = x;
    if (t.y !== y) t.y = y;
  }
  let b = m.bounds;
  if (b && b.topLeft) {
    if (b.topLeft.x !== x) b.topLeft.x = x;
    if (b.topLeft.y !== y) b.topLeft.y = y;
  }
}

function fabrikBinFootprint(m) {
  /**
   * Holder-space AABB covering the frame, path vertices, ellipse radii, and pins.
   * Bin packing uses this so star/line/pin stickouts do not overlap neighbors.
   */
  if (!m) return rect(0, 0, 1, 1);
  let b = m.getBounds();
  let minx = b.topLeft.x;
  let miny = b.topLeft.y;
  let maxx = minx + b.width();
  let maxy = miny + b.height();
  let t = m.transform && m.transform.translation;
  let tx = t ? t.x : 0;
  let ty = t ? t.y : 0;
  let sh = m.shape;
  let expand = function (x0, y0, x1, y1) {
    if (x0 < minx) minx = x0;
    if (y0 < miny) miny = y0;
    if (x1 > maxx) maxx = x1;
    if (y1 > maxy) maxy = y1;
  };
  if (sh && sh.vertices && sh.vertices.length) {
    let pad = (sh.borderWidth || 0) + 4;
    for (let i = 0; i < sh.vertices.length; i++) {
      let vx = sh.vertices[i].x + tx;
      let vy = sh.vertices[i].y + ty;
      expand(vx - pad, vy - pad, vx + pad, vy + pad);
    }
  }
  if (sh && sh.p && sh.r && sh.r.x != null) {
    expand(sh.p.x - sh.r.x + tx, sh.p.y - sh.r.y + ty, sh.p.x + sh.r.x + tx, sh.p.y + sh.r.y + ty);
  }
  if (m.fabrikPins) {
    for (let i = 0; i < m.fabrikPins.length; i++) {
      let pb = m.fabrikPins[i].getBounds();
      expand(pb.topLeft.x + tx, pb.topLeft.y + ty, pb.topLeft.x + pb.width() + tx, pb.topLeft.y + pb.height() + ty);
    }
  }
  if (m.className === 'LineMorph' && maxy - miny < 28) {
    let mid = (miny + maxy) / 2;
    miny = mid - 14;
    maxy = mid + 14;
  }
  return rect(minx, miny, maxx - minx, maxy - miny);
}

function fabrikSnapMorph(m) {
  if (!m) return;
  let b = m.getBounds();
  let x = fabrikGrid(b.topLeft.x);
  let y = fabrikGrid(b.topLeft.y);
  if (m.className === 'LineMorph') {
    if (b.topLeft.x !== x || b.topLeft.y !== y) fabrikSetPos(m, x, y);
    return;
  }
  let w = Math.max(FABRIK_GRID, fabrikGrid(b.width()));
  let h = Math.max(FABRIK_GRID, fabrikGrid(b.height()));
  let same = b.topLeft.x === x && b.topLeft.y === y && b.width() === w && b.height() === h;
  if (!same) {
    m.$fabrikSnapping = true;
    Morph.prototype.setBounds.call(m, rect(x, y, w, h));
    m.$fabrikSnapping = false;
  }
  if (m.contentPane && !m.isFabrikProto) fabrikPlaceInnerContent(m, w, h);
  else if (m.fabrikPins) fabrikLayoutPins(m);
}

function fabrikMaybeSnapBounds(m, paneBounds) {
  if (!m || m.isFabrikProto || m.$fabrikSnapping) return paneBounds;
  if (!fabrikCanMoveParts(m.world && m.world())) return paneBounds;
  return fabrikSnapRect(paneBounds);
}

function fabrikEstablishPartFrames(m) {
  /** First world drop: store edit bounds. Layout stays unset until layout mode. */
  if (!m || m.isFabrikProto) return;
  fabrikSnapMorph(m);
  fabrikRememberLayout(m, 'edit', m.getBounds());
  m.$fabrikNeedsBothFrames = false;
}

function fabrikRememberCurrentLayout(m) {
  if (!m || m.isFabrikProto) return;
  let world = m.world && m.world();
  let mode = fabrikViewMode(world);
  if (mode !== 'edit' && mode !== 'layout') return;
  if (m.$fabrikNeedsBothFrames) {
    fabrikEstablishPartFrames(m);
    return;
  }
  fabrikRememberLayout(m, mode, m.getBounds());
}

function fabrikShiftEvent(evt) {
  return typeof effectiveShiftKey === 'function' && effectiveShiftKey(evt);
}

function fabrikShiftIsDown(world) {
  if (world && world.$shiftKeyDown) return true;
  if (typeof isShiftKeyPressed === 'function') return isShiftKeyPressed();
  return false;
}

function fabrikShouldShowHandles(host) {
  if (!host || host.isFabrikProto) return false;
  if (host.className === 'LineMorph') return false;
  return fabrikCanMoveParts(host.world && host.world());
}

function fabrikHandleHit(host, localP) {
  /** 'grow' = bottom-right, 'move' = top-left, else null. */
  if (!host || !localP) return null;
  if (host.className === 'LineMorph') return null;
  let sh = host.shape;
  let ox = sh && sh.topLeft ? sh.topLeft.x : 0;
  let oy = sh && sh.topLeft ? sh.topLeft.y : 0;
  let w = sh && sh.extent ? sh.extent.x : host.getBounds().width();
  let h = sh && sh.extent ? sh.extent.y : host.getBounds().height();
  let s = FABRIK_CORNER;
  if (localP.x >= ox + w - s && localP.x <= ox + w && localP.y >= oy + h - s && localP.y <= oy + h)
    return 'grow';
  if (localP.x >= ox && localP.x <= ox + s && localP.y >= oy && localP.y <= oy + s) return 'move';
  return null;
}

function fabrikDrawHandleBox(ctx, x, y, s) {
  ctx.fillStyle = '#e8e8e8';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, s, s);
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}

function fabrikDrawHandles(ctx, host) {
  if (!fabrikShouldShowHandles(host)) return;
  let sh = host.shape;
  if (!sh || !sh.topLeft || !sh.extent) return;
  let s = FABRIK_CORNER;
  let xL = sh.topLeft.x;
  let xR = sh.topLeft.x + sh.extent.x - s;
  let y0 = sh.topLeft.y;
  let y1 = sh.topLeft.y + sh.extent.y - s;
  ctx.save();
  fabrikDrawHandleBox(ctx, xR, y1, s);
  ctx.beginPath();
  ctx.moveTo(xR + 2, y1 + s - 2);
  ctx.lineTo(xR + s - 2, y1 + s - 2);
  ctx.lineTo(xR + s - 2, y1 + 2);
  ctx.stroke();
  fabrikDrawHandleBox(ctx, xL, y0, s);
  let cx = xL + s / 2;
  let cy = y0 + s / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy);
  ctx.lineTo(cx + 3, cy);
  ctx.moveTo(cx, cy - 3);
  ctx.lineTo(cx, cy + 3);
  ctx.stroke();
  ctx.restore();
}

function fabrikInstallShiftChrome(world) {
  if (!world || world.$fabrikShiftChrome) return;
  world.$fabrikShiftChrome = true;
  let prevDown = world.onKeyDown;
  let prevUp = world.onKeyUp;
  world.onKeyDown = function (evt) {
    let before = !!this.$shiftKeyDown;
    let r = prevDown ? prevDown.call(this, evt) : null;
    if (!!this.$shiftKeyDown !== before && this.changed) this.changed();
    return r;
  };
  world.onKeyUp = function (evt) {
    let before = !!this.$shiftKeyDown;
    let r = prevUp ? prevUp.call(this, evt) : null;
    if (!!this.$shiftKeyDown !== before && this.changed) this.changed();
    return r;
  };
}

function fabrikPartOnPointerDown(p, evt) {
  if (!this.fullBounds().includesPt(p)) return false;
  let world = this.world();
  let localP = this.relativize(p);
  if (fabrikCanMoveParts(world)) {
    let hitEarly = fabrikHandleHit(this, localP);
    if (hitEarly) {
      this.$fabrikResizing = hitEarly === 'grow';
      this.$fabrikMoving = hitEarly === 'move';
      this.$pickUpOnDrag = this.owner != null && this.owner !== this.world();
      this.beginPointerDrag(p, evt);
      let b0 = this.getBounds();
      this.$fabrikGridOX = b0.topLeft.x;
      this.$fabrikGridOY = b0.topLeft.y;
      this.$fabrikResizeOW = b0.width();
      this.$fabrikResizeOH = b0.height();
      this.$fabrikGridDX = 0;
      this.$fabrikGridDY = 0;
      return true;
    }
  }
  if (fabrikEditMode(world)) {
    let pins = this.fabrikPins || [];
    for (let i = 0; i < pins.length; i++) {
      if (pins[i].fullBounds().includesPt(localP) && pins[i].onPointerDown(localP, evt)) return true;
    }
  }
  if (fabrikCanMoveParts(world) && fabrikLayoutMode(world)) {
    this.$fabrikResizing = false;
    this.$fabrikMoving = true;
    this.$pickUpOnDrag = this.owner != null && this.owner !== this.world();
    this.beginPointerDrag(p, evt);
    let b = this.getBounds();
    this.$fabrikGridOX = b.topLeft.x;
    this.$fabrikGridOY = b.topLeft.y;
    this.$fabrikResizeOW = b.width();
    this.$fabrikResizeOH = b.height();
    this.$fabrikGridDX = 0;
    this.$fabrikGridDY = 0;
    return true;
  }
  return Morph.prototype.onPointerDown.call(this, p, evt);
}

function fabrikPreviewExtent(m, w, h) {
  /**
   * Live corner-resize: stretch the ephemeral transform (same as halo Z) so
   * tracking never allocates Automerge rects. Pointer-up restores scale=1 and
   * commits one setBounds.
   */
  let ow = Math.max(1, m.$fabrikResizeOW || 1);
  let oh = Math.max(1, m.$fabrikResizeOH || 1);
  let sc = m.transform && m.transform.scale;
  if (sc) {
    sc.x = w / ow;
    sc.y = h / oh;
  }
  if (m.bounds && m.bounds.extent) {
    m.bounds.extent.x = w;
    m.bounds.extent.y = h;
  }
  if (m.changed) m.changed();
}

function fabrikPartDragMovedBy(delta, p, evt) {
  if (this.$fabrikResizing) {
    this.$fabrikGridDX = (this.$fabrikGridDX || 0) + delta.x;
    this.$fabrikGridDY = (this.$fabrikGridDY || 0) + delta.y;
    let w = Math.max(FABRIK_GRID * 2, fabrikGrid((this.$fabrikResizeOW || 0) + this.$fabrikGridDX));
    let h = Math.max(FABRIK_GRID * 2, fabrikGrid((this.$fabrikResizeOH || 0) + this.$fabrikGridDY));
    fabrikPreviewExtent(this, w, h);
    return;
  }
  if (this.$fabrikMoving || fabrikLayoutMode(this.world())) {
    if (this.$fabrikGridOX == null) {
      let b0 = this.getBounds();
      this.$fabrikGridOX = b0.topLeft.x;
      this.$fabrikGridOY = b0.topLeft.y;
      this.$fabrikGridDX = 0;
      this.$fabrikGridDY = 0;
    }
    this.$fabrikGridDX = (this.$fabrikGridDX || 0) + delta.x;
    this.$fabrikGridDY = (this.$fabrikGridDY || 0) + delta.y;
    let nx = fabrikGrid(this.$fabrikGridOX + this.$fabrikGridDX);
    let ny = fabrikGrid(this.$fabrikGridOY + this.$fabrikGridDY);
    let b = this.getBounds();
    let d = fabrikHostXY(20);
    d.x = nx - b.topLeft.x;
    d.y = ny - b.topLeft.y;
    this.moveBy(d);
    return;
  }
  Morph.prototype.dragMovedBy.call(this, delta, p, evt);
}

function fabrikQuietTextShape(sh) {
  /** TextMorph.renderOn writes these every frame; seed them so same-value elision holds. */
  if (!sh) return;
  if (sh._unsavedInnerBorder !== false) sh._unsavedInnerBorder = false;
  if (sh.editorID != null) sh.editorID = null;
}

function fabrikStyleHost(pane) {
  if (!pane) return;
  if (pane.setColor) pane.setColor(Color.lightGray);
  if (pane.setStyles) pane.setStyles(Color.lightGray, FABRIK_BORDER_W, Color.black);
  fabrikQuietTextShape(pane.shape);
  if (pane.contentPane && pane.contentPane.shape) fabrikQuietTextShape(pane.contentPane.shape);
}

function fabrikPaneIsGrown(pane) {
  /** True when the outer frame is larger than the inner pane, like an enlarged PanelMorph. */
  let cp = pane && pane.contentPane;
  if (!cp) return false;
  let ow = pane.getBounds().width();
  let oh = pane.getBounds().height();
  let iw = cp.getBounds().width();
  let ih = cp.getBounds().height();
  return ow > iw + 8 || oh > ih + 8;
}

function fabrikSyncPaneChrome(pane) {
  if (!pane) return;
  if (pane.isFabrikProto) {
    fabrikStyleBinProto(pane);
    return;
  }
  fabrikStyleHost(pane);
  let cp = pane.contentPane;
  if (!cp || !cp.shape) return;
  if (fabrikPaneIsGrown(pane)) {
    if (cp.setStyles) cp.setStyles(Color.white, FABRIK_BORDER_W, Color.black);
    cp.shape.borderWidth = FABRIK_BORDER_W;
    cp.shape.borderColor = Color.black;
    if (cp.shape.boxColor != null) cp.shape.boxColor = Color.white;
  } else {
    if (cp.setStyles) cp.setStyles(Color.white, 0, Color.white);
    cp.shape.borderWidth = 0;
    cp.shape.borderColor = null;
    if (cp.shape.boxColor != null) cp.shape.boxColor = Color.white;
  }
}

function fabrikViewApplyBounds(view, paneBounds) {
  paneBounds = fabrikMaybeSnapBounds(view, paneBounds);
  let b = view.getBounds();
  let x = paneBounds.topLeft.x;
  let y = paneBounds.topLeft.y;
  let w = paneBounds.width();
  let h = paneBounds.height();
  if (!(b && b.topLeft && b.topLeft.x === x && b.topLeft.y === y && b.width() === w && b.height() === h))
    Morph.prototype.setBounds.call(view, paneBounds);
  return paneBounds;
}

function fabrikPlaceInnerContent(pane, outerW, outerH) {
  /** Hug like a panel's single pane; keep the inner size if the outer is grown.
   * Corner-reframe fills the inner so the view tracks both narrower and wider. */
  let cp = pane && pane.contentPane;
  if (!cp) return;
  let pad = fabrikHostPad(pane);
  let availW = Math.max(20, outerW - pad.l - pad.r);
  let prevB = cp.getBounds();
  let prevW = prevB.width();
  let cw = availW;
  if (!pane.$fabrikReframing && pane.$fabrikInnerReady && prevW > 1 && availW > prevW + 4) cw = prevW;
  let innerH = Math.max(20, outerH);
  if (pane.$fabrikInnerReady && !pane.$fabrikReframing && prevW === cw && prevB.height() === innerH) {
    fabrikGrowContent(pane);
    fabrikSyncPaneChrome(pane);
    return;
  }
  fabrikSetFrame(cp, pad.l, 0, cw, innerH);
  fabrikGrowContent(pane);
  pane.$fabrikInnerReady = true;
  fabrikSyncPaneChrome(pane);
}

function fabrikGrowContent(pane) {
  /** Let the content morph be as tall as its text so wheel-scroll has room. */
  let cp = pane && pane.contentPane;
  if (!cp || !cp.shape) return;
  let w = cp.shape.extent.x || 20;
  let str = cp.shape.string;
  let already = cp.shape.$fabrikLaidW === w && cp.shape.$fabrikLaidStr === str && cp.shape.lines && cp.shape.lines.length;
  if (!already && cp.shape.compose) {
    cp.shape.compose();
    cp.shape.$fabrikLaidW = w;
    cp.shape.$fabrikLaidStr = str;
  }
  let textH = fabrikContentHeight(pane);
  if (!(textH > 0)) textH = 16;
  if (cp.shape.extent.y !== textH) cp.shape.extent.y = textH;
  let t = cp.transform && cp.transform.translation;
  let x = t ? t.x : 0;
  let y = t ? t.y : 0;
  let b = cp.bounds;
  if (b && b.topLeft && b.extent) {
    if (b.topLeft.x !== x) b.topLeft.x = x;
    if (b.topLeft.y !== y) b.topLeft.y = y;
    if (b.extent.x !== w) b.extent.x = w;
    if (b.extent.y !== textH) b.extent.y = textH;
  }
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

function fabrikPinSideOf(pin) {
  if (pin && pin.$fabrikPinSide) return pin.$fabrikPinSide;
  return pin && pin.pinDir === 'out' ? 'r' : 'l';
}

function fabrikPinExtentW(side) {
  return side === 't' || side === 'b' ? FABRIK_PIN_H : FABRIK_PIN_W;
}

function fabrikPinExtentH(side) {
  return side === 't' || side === 'b' ? FABRIK_PIN_W : FABRIK_PIN_H;
}

function fabrikPinTipDir(pin) {
  /** Triangle tip: inputs toward the part, outputs away from it. */
  let side = fabrikPinSideOf(pin);
  let inward = !pin || pin.pinDir !== 'out';
  if (side === 'l') return inward ? 'r' : 'l';
  if (side === 'r') return inward ? 'l' : 'r';
  if (side === 't') return inward ? 'd' : 'u';
  return inward ? 'u' : 'd';
}

function fabrikPinDrawPath(ctx, w, h, tip, pad) {
  let x0 = -pad;
  let y0 = -pad;
  let x1 = w + pad;
  let y1 = h + pad;
  ctx.beginPath();
  if (tip === 'r') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, (y0 + y1) / 2);
  } else if (tip === 'l') {
    ctx.moveTo(x1, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, (y0 + y1) / 2);
  } else if (tip === 'd') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo((x0 + x1) / 2, y1);
  } else {
    ctx.moveTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo((x0 + x1) / 2, y0);
  }
  ctx.closePath();
}

function fabrikPinAwayInto(pin, out) {
  let side = fabrikPinSideOf(pin);
  out.x = 0;
  out.y = 0;
  if (side === 'l') out.x = -1;
  else if (side === 'r') out.x = 1;
  else if (side === 't') out.y = -1;
  else out.y = 1;
  return out;
}

function fabrikPinAttachLocal(pin, out) {
  let e = pin && pin.shape && pin.shape.extent ? pin.shape.extent : null;
  let w = e && e.x != null ? e.x : FABRIK_PIN_W;
  let h = e && e.y != null ? e.y : FABRIK_PIN_H;
  let side = fabrikPinSideOf(pin);
  if (side === 'l') {
    out.x = 0;
    out.y = h / 2;
  } else if (side === 'r') {
    out.x = w;
    out.y = h / 2;
  } else if (side === 't') {
    out.x = w / 2;
    out.y = 0;
  } else {
    out.x = w / 2;
    out.y = h;
  }
  return out;
}

function fabrikPinCenterInto(pin, out) {
  let loc = fabrikPinAttachLocal(pin, fabrikHostXY(7));
  return fabrikMorphLocalToWorld(pin, loc.x, loc.y, out);
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
  return fabrikPinAwayInto(pin, fabrikHostXY(8)).x;
}

function fabrikWireStubWorld(pin) {
  /** 20px straight out from the pin, along its away direction. */
  let p = fabrikPinCenterInto(pin, fabrikHostXY(0));
  let a = fabrikPinAwayInto(pin, fabrikHostXY(8));
  return pt(p.x + a.x * 20, p.y + a.y * 20);
}

function fabrikWireHeadedBack(fromPin, toPin, fromEnd) {
  let a = fabrikPinCenterInto(fromPin, fabrikHostXY(0));
  let b = fabrikPinCenterInto(toPin, fabrikHostXY(1));
  let away = fabrikPinAwayInto(fromEnd ? fromPin : toPin, fabrikHostXY(8));
  let otherDx = fromEnd ? b.x - a.x : a.x - b.x;
  let otherDy = fromEnd ? b.y - a.y : a.y - b.y;
  return otherDx * away.x + otherDy * away.y < 0;
}

function fabrikWireControlInto(fromPin, toPin, fromEnd, ax, ay, bx, by, stubX, stubY, out) {
  let pin = fromEnd ? fromPin : toPin;
  let away = fabrikPinAwayInto(pin, fabrikHostXY(8));
  let otherDx = fromEnd ? bx - ax : ax - bx;
  let otherDy = fromEnd ? by - ay : ay - by;
  let headedBack = otherDx * away.x + otherDy * away.y < 0;
  let extra = headedBack ? 52 : 16;
  let xOff = 0;
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
    if (away.x !== 0) yOff = (stubY < mid.y ? -1 : 1) * 28;
    else xOff = (stubX < mid.x ? -1 : 1) * 28;
  }
  out.x = stubX + away.x * extra + xOff;
  out.y = stubY + away.y * extra + yOff;
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
  let away = fabrikPinAwayInto(pin, fabrikHostXY(8));
  let stubX = (fromEnd ? a.x : b.x) + away.x * 20;
  let stubY = (fromEnd ? a.y : b.y) + away.y * 20;
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
  let awayA = fabrikPinAwayInto(fromPin, fabrikHostXY(8));
  let awayB = fabrikPinAwayInto(toPin, fabrikHostXY(9));
  let a2x = a.x + awayA.x * 20;
  let a2y = a.y + awayA.y * 20;
  let b2x = b.x + awayB.x * 20;
  let b2y = b.y + awayB.y * 20;
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
  if (this.$fabrikResizing) {
    let sc = this.transform && this.transform.scale;
    if (sc) {
      sc.x = 1;
      sc.y = 1;
    }
    if (this.className !== 'LineMorph') {
      let w = Math.max(FABRIK_GRID * 2, fabrikGrid((this.$fabrikResizeOW || 0) + (this.$fabrikGridDX || 0)));
      let h = Math.max(FABRIK_GRID * 2, fabrikGrid((this.$fabrikResizeOH || 0) + (this.$fabrikGridDY || 0)));
      this.$fabrikReframing = true;
      this.setBounds(rect(this.$fabrikGridOX, this.$fabrikGridOY, w, h));
      this.$fabrikReframing = false;
    } else {
      fabrikSnapMorph(this);
    }
  } else {
    fabrikSnapMorph(this);
  }
  if (this.$fabrikNeedsBothFrames) fabrikEstablishPartFrames(this);
  else fabrikRememberCurrentLayout(this);
  this.$fabrikGridOX = null;
  this.$fabrikGridOY = null;
  this.$fabrikGridDX = 0;
  this.$fabrikGridDY = 0;
  this.$fabrikResizing = false;
  this.$fabrikMoving = false;
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

function fabrikPlacePinOnBorder(host, pin, side, along) {
  if (!host || !pin) return;
  let r = host.shape.getBounds();
  let ox = r.topLeft.x;
  let oy = r.topLeft.y;
  let w = r.extent.x;
  let h = r.extent.y;
  let pw = fabrikPinExtentW(side);
  let ph = fabrikPinExtentH(side);
  if (along < 0) along = 0;
  if (along > 1) along = 1;
  pin.$fabrikPinPlaced = true;
  pin.$fabrikPinSide = side;
  pin.$fabrikPinAlong = along;
  let x = ox;
  let y = oy;
  if (side === 'l') {
    x = ox - pw;
    y = oy + along * Math.max(0, h - ph);
  } else if (side === 'r') {
    x = ox + w;
    y = oy + along * Math.max(0, h - ph);
  } else if (side === 't') {
    y = oy - ph;
    x = ox + along * Math.max(0, w - pw);
  } else {
    y = oy + h;
    x = ox + along * Math.max(0, w - pw);
  }
  fabrikSetFrame(pin, x, y, pw, ph);
}

function fabrikSlidePinOnBorder(host, pin, localP) {
  if (!host || !pin || !localP) return;
  let r = host.shape.getBounds();
  let ox = r.topLeft.x;
  let oy = r.topLeft.y;
  let w = r.extent.x;
  let h = r.extent.y;
  let x = localP.x;
  let y = localP.y;
  let dL = Math.abs(x - ox);
  let dR = Math.abs(x - (ox + w));
  let dT = Math.abs(y - oy);
  let dB = Math.abs(y - (oy + h));
  let side = 'l';
  let d = dL;
  if (dR < d) {
    d = dR;
    side = 'r';
  }
  if (dT < d) {
    d = dT;
    side = 't';
  }
  if (dB < d) side = 'b';
  let along = 0;
  let pw = fabrikPinExtentW(side);
  let ph = fabrikPinExtentH(side);
  if (side === 'l' || side === 'r') {
    let span = Math.max(1, h - ph);
    along = (y - oy) / span;
  } else {
    let span = Math.max(1, w - pw);
    along = (x - ox) / span;
  }
  fabrikPlacePinOnBorder(host, pin, side, along);
}

function fabrikLayoutPins(host) {
  let pins = host.fabrikPins || [];
  let ins = [];
  let outs = [];
  for (let i = 0; i < pins.length; i++) {
    if (pins[i].$fabrikPinPlaced) {
      fabrikPlacePinOnBorder(host, pins[i], pins[i].$fabrikPinSide, pins[i].$fabrikPinAlong);
      continue;
    }
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
      p.$fabrikPinSide = outsideLeft ? 'l' : 'r';
      let pw = fabrikPinExtentW(p.$fabrikPinSide);
      let ph = fabrikPinExtentH(p.$fabrikPinSide);
      let y = gap * (i + 1) - ph / 2;
      let x = outsideLeft ? -pw : b.width();
      fabrikSetFrame(p, x, y, pw, ph);
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
  if (fabrikPaneShowsPins(host) && host.fabrikPins) {
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
   * Bin prototypes are a single border plus pins; function views show name(args).
   * Never write shape.borderWidth here: render runs inside the frame transaction,
   * and toggling 2→0→2 was two Automerge ops per view per frame.
   */
  if (host.$fabrikHidden) return;
  let sh = host.shape;
  if (!sh || !sh.topLeft || !sh.extent) return;
  let x = sh.topLeft.x;
  let y = sh.topLeft.y;
  let w = sh.extent.x;
  let h = sh.extent.y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  let fill = sh.fillColor;
  if (fill && fill.fillStyle) {
    ctx.fillStyle = fill.fillStyle;
    ctx.fillRect(x, y, w, h);
  }
  if (host.isFabrikProto && host.className === 'FabrikFunctionView') {
    let heading = fabrikBinProtoLabel(host);
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(heading, x + 8, y + h / 2);
    ctx.restore();
  } else {
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
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = Color.black && Color.black.fillStyle ? Color.black.fillStyle : '#000000';
  ctx.lineWidth = FABRIK_BORDER_W;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  if (fabrikPaneShowsPins(host)) {
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
  fabrikDrawHandles(ctx, host);
}

function fabrikEmit(host, pinName, value) {
  let pin = fabrikPinNamed(host, pinName);
  if (pin) pin.setValue(value);
}

function fabrikWireEnds(fromPin, toPin) {
  let outPin = fromPin.pinDir === 'in' ? toPin : fromPin;
  let inPin = outPin === fromPin ? toPin : fromPin;
  if (outPin.pinDir === 'in' && inPin.pinDir === 'out') {
    let t = outPin;
    outPin = inPin;
    inPin = t;
  }
  return { outPin: outPin, inPin: inPin };
}

function fabrikCanConnect(fromPin, toPin) {
  if (!fromPin || !toPin || fromPin === toPin) return false;
  if (fromPin.fabrikHost === toPin.fabrikHost) return false;
  if (fromPin.fabrikHost && fromPin.fabrikHost.isFabrikProto) return false;
  if (toPin.fabrikHost && toPin.fabrikHost.isFabrikProto) return false;
  if (!fabrikPinDirOk(fromPin.pinDir, toPin.pinDir)) return false;
  if (!fabrikPinTypeOk(fromPin.pinType, toPin.pinType)) return false;
  return true;
}

function fabrikFindWire(fromPin, toPin) {
  if (!fromPin || !toPin) return null;
  let ends = fabrikWireEnds(fromPin, toPin);
  let world = fromPin.world() || toPin.world() || Lively;
  if (!world || !world.fabrikWires) return null;
  for (let i = 0; i < world.fabrikWires.length; i++) {
    let w = world.fabrikWires[i];
    if (w.fromPin === ends.outPin && w.toPin === ends.inPin) return w;
  }
  return null;
}

function fabrikDisconnectWire(wire) {
  if (!wire) return;
  let world = wire.owner || (wire.world && wire.world()) || Lively;
  if (world && world.fabrikWires) {
    let next = [];
    for (let i = 0; i < world.fabrikWires.length; i++) {
      if (world.fabrikWires[i] !== wire) next.push(world.fabrikWires[i]);
    }
    world.fabrikWires = next;
  }
  if (wire.remove) wire.remove();
}

function fabrikClearLiveWire(world) {
  if (!world) return;
  let w = world.$fabrikLiveWire;
  if (w && w.$fabrikLive) fabrikDisconnectWire(w);
  world.$fabrikLiveWire = null;
  world.$fabrikLiveTo = null;
}

function fabrikShowRubber(world, fromPin, wx, wy) {
  if (!world) return;
  let rubber = world.$fabrikRubber;
  if (!rubber) {
    rubber = new FabrikRubberWire();
    world.$fabrikRubber = rubber;
  }
  if (rubber.owner !== world) {
    if (world.addMorphFront) world.addMorphFront(rubber);
    else world.addMorph(rubber);
  }
  rubber.fromPin = fromPin;
  rubber.toX = wx;
  rubber.toY = wy;
  rubber.$fabrikHidden = !!world.$fabrikLiveTo;
  if (rubber.changed) rubber.changed();
}

function fabrikHideRubber(world) {
  let rubber = world && world.$fabrikRubber;
  if (!rubber) return;
  rubber.fromPin = null;
  if (rubber.remove) rubber.remove();
  world.$fabrikRubber = null;
}

function fabrikIncomingWires(pin) {
  let found = [];
  if (!pin) return found;
  let world = pin.world() || Lively;
  if (!world || !world.fabrikWires) return found;
  for (let i = 0; i < world.fabrikWires.length; i++) {
    if (world.fabrikWires[i].toPin === pin) found.push(world.fabrikWires[i]);
  }
  return found;
}

function fabrikEndWiring(world, keepLive) {
  if (!world) return;
  if (keepLive) {
    if (world.$fabrikLiveWire) world.$fabrikLiveWire.$fabrikLive = false;
  } else {
    fabrikClearLiveWire(world);
  }
  world.$fabrikLiveWire = null;
  world.$fabrikLiveTo = null;
  world.$fabrikWiringFrom = null;
  world.$fabrikWiringHover = null;
  world.$fabrikPickupPin = null;
  fabrikHideRubber(world);
  if (world.setPointerFocus) world.setPointerFocus(null);
  if (world.changed) world.changed();
}

function fabrikWiringMove(fromPin, worldPt) {
  let world = (fromPin && fromPin.world && fromPin.world()) || Lively;
  if (!world || !worldPt) return;
  let target = fabrikPinAtWorld(world, worldPt);
  if (target === fromPin) target = null;
  let ok = !!(target && fabrikCanConnect(fromPin, target));
  world.$fabrikWiringHover = ok ? target : null;
  if (ok) {
    if (world.$fabrikLiveTo !== target) {
      fabrikClearLiveWire(world);
      let prior = fabrikFindWire(fromPin, target);
      let wire = fabrikConnect(fromPin, target);
      if (wire) {
        if (!prior) wire.$fabrikLive = true;
        world.$fabrikLiveWire = wire;
        world.$fabrikLiveTo = target;
      }
    }
  } else {
    fabrikClearLiveWire(world);
  }
  fabrikShowRubber(world, fromPin, worldPt.x, worldPt.y);
}

function fabrikConnect(fromPin, toPin) {
  if (!fabrikCanConnect(fromPin, toPin)) return null;
  let ends = fabrikWireEnds(fromPin, toPin);
  let outPin = ends.outPin;
  let inPin = ends.inPin;
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

function fabrikDecidePinGesture(pin, p) {
  /** Outward (straight off the side) wires; sideways slides the pin. Click does neither. */
  let dx = p.x - (pin.$fabrikGestStartX || 0);
  let dy = p.y - (pin.$fabrikGestStartY || 0);
  if (dx * dx + dy * dy < 25) return null;
  let away = fabrikPinAwayInto(pin, fabrikHostXY(8));
  let outAmt = dx * away.x + dy * away.y;
  let sideAmt = dx * away.y - dy * away.x;
  if (sideAmt < 0) sideAmt = -sideAmt;
  if (outAmt > sideAmt && outAmt > 2) return 'wire';
  return 'slide';
}

function fabrikBeginPinWire(pin, p) {
  let world = pin.world();
  if (!world) return;
  fabrikEndWiring(world, false);
  world.$fabrikWiringFrom = pin;
  world.setPointerFocus(pin);
  let worldP = pin.owner ? pin.owner.globalize(p) : p;
  fabrikShowRubber(world, pin, worldP.x, worldP.y);
  fabrikWiringMove(pin, worldP);
}

function fabrikBeginPinPickup(pin, p) {
  let incoming = fabrikIncomingWires(pin);
  if (!incoming.length) return false;
  let w = incoming[incoming.length - 1];
  let from = w.fromPin || pin;
  fabrikDisconnectWire(w);
  let world = pin.world();
  if (!world) return false;
  world.$fabrikPickupPin = pin;
  world.$fabrikWiringFrom = from;
  world.setPointerFocus(from);
  let worldP = pin.owner ? pin.owner.globalize(p) : p;
  fabrikShowRubber(world, from, worldP.x, worldP.y);
  if (world.changed) world.changed();
  return true;
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
    let tip = fabrikPinTipDir(this);
    let fill = fabrikPinFill(this.pinDir);
    ctx.save();
    ctx.fillStyle = fill.fillStyle;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    fabrikPinDrawPath(ctx, w, h, tip, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (host && host.world) {
      let world = host.world();
      let hot = world && (world.$fabrikWiringFrom === this || world.$fabrikWiringHover === this);
      if (hot) {
        ctx.save();
        ctx.strokeStyle = world.$fabrikWiringHover === this ? '#1a7a1a' : '#c45c00';
        ctx.lineWidth = 2;
        fabrikPinDrawPath(ctx, w, h, tip, 1);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (host && host.$fabrikPinLabels === false) return;
    let name = this.pinName || '';
    if (!name) return;
    let alpha = fabrikPinLabelAlpha(host && host.world ? host.world() : this.world());
    if (!(alpha > 0)) return;
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
    let side = fabrikPinSideOf(this);
    let boxX = w + 2;
    let boxY = h / 2 - boxH / 2;
    if (side === 'r') {
      boxX = -2 - boxW;
      boxY = h / 2 - boxH / 2;
    } else if (side === 't') {
      boxX = w / 2 - boxW / 2;
      boxY = h + 2;
    } else if (side === 'b') {
      boxX = w / 2 - boxW / 2;
      boxY = -2 - boxH;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = Color.blue && Color.blue.fillStyle ? Color.blue.fillStyle : '#0033cc';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(name, boxX + padX, boxY + boxH / 2);
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
    let host = this.fabrikHost || this.owner;
    if (host && host.isFabrikProto) return false;
    let world = this.world();
    if (!world || !fabrikEditMode(world)) return false;
    this.$fabrikGestStartX = p.x;
    this.$fabrikGestStartY = p.y;
    this.$fabrikSliding = false;
    this.$fabrikPinPending = 'undecided';
    world.setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    let host = this.fabrikHost || this.owner;
    let world = this.world();
    if (this.$fabrikPinPending === 'undecided') {
      let kind = fabrikDecidePinGesture(this, p);
      if (!kind) return true;
      this.$fabrikPinPending = kind;
      if (kind === 'slide') {
        this.$fabrikSliding = true;
        fabrikSlidePinOnBorder(host, this, p);
        return true;
      }
      if (this.pinDir !== 'out' && this.pinDir !== 'bi') {
        if (!fabrikBeginPinPickup(this, p)) {
          this.$fabrikPinPending = null;
          if (world && world.setPointerFocus) world.setPointerFocus(null);
        }
        return true;
      }
      fabrikBeginPinWire(this, p);
      return true;
    }
    if (this.$fabrikSliding) {
      fabrikSlidePinOnBorder(host, this, p);
      return true;
    }
    let from = world && world.$fabrikWiringFrom;
    if (!from) return false;
    let worldP = this.owner ? this.owner.globalize(p) : p;
    fabrikWiringMove(from, worldP);
    return true;
  }
  onPointerUp(p, evt) {
    let world = this.world();
    if (this.$fabrikPinPending === 'undecided' || this.$fabrikPinPending === 'slide') {
      this.$fabrikSliding = false;
      this.$fabrikPinPending = null;
      if (world && world.setPointerFocus) world.setPointerFocus(null);
      return true;
    }
    let from = world && world.$fabrikWiringFrom;
    if (!from) {
      this.$fabrikPinPending = null;
      if (world && world.setPointerFocus) world.setPointerFocus(null);
      return true;
    }
    let worldP = this.owner ? this.owner.globalize(p) : p;
    fabrikWiringMove(from, worldP);
    let keep = !!(world.$fabrikLiveTo && fabrikCanConnect(from, world.$fabrikLiveTo));
    if (keep && world.$fabrikPickupPin && world.$fabrikLiveTo === world.$fabrikPickupPin) keep = false;
    this.$fabrikPinPending = null;
    fabrikEndWiring(world, keep);
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

function fabrikPinAtWorld(world, worldPt) {
  /** Prefer pins over wires: a wire stub covers the pin center. */
  if (!world || !worldPt) return null;
  let found = null;
  fabrikEachMorph(world, function (m) {
    if (found || m.className !== 'FabrikPin') return;
    let pInOwner = m.owner ? m.owner.localize(worldPt) : worldPt;
    if (m.includesPt(pInOwner)) found = m;
  });
  return found;
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
    if (!world || fabrikViewMode(world) !== 'edit') return false;
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
    if (!world || fabrikViewMode(world) !== 'edit') return;
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
    ctx.lineWidth = 2.5;
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

class FabrikRubberWire extends Morph {
  constructor() {
    super(rect(0, 0, 1, 1));
    this.fromPin = null;
    this.toX = 0;
    this.toY = 0;
    this.shape.borderWidth = 0;
    this.setColor(Color.white);
  }
  acceptsDroppingMorphs() {
    return false;
  }
  includesPt(_p) {
    return false;
  }
  fullBounds() {
    return this.shape.getBounds().copy();
  }
  renderOn(ctx) {
    if (this.$fabrikHidden || !this.fromPin) return;
    let from = fabrikPinCenterInto(this.fromPin, fabrikHostXY(0));
    let t = this.transform;
    let ox = t && t.translation ? t.translation.x : 0;
    let oy = t && t.translation ? t.translation.y : 0;
    ctx.save();
    ctx.strokeStyle = '#4a7bd0';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (ctx.setLineDash) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x - ox, from.y - oy);
    ctx.lineTo(this.toX - ox, this.toY - oy);
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
    fabrikStyleHost(this);
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
    fabrikSyncPaneChrome(this);
    this.scrollToTop();
  }
  setBounds(paneBounds) {
    paneBounds = fabrikViewApplyBounds(this, paneBounds);
    if (!this.contentPane) return;
    let ht = paneBounds.height();
    let w = paneBounds.width();
    if (this.withScrollBar && this.scrollBar) {
      let scrollW = 15;
      this.contentPane.setBounds(rect(0, 0, w - scrollW, ht));
      this.scrollBar.setBounds(rect(w - scrollW, 0, scrollW, ht));
      fabrikGrowContent(this);
    } else {
      fabrikPlaceInnerContent(this, w, ht);
    }
    fabrikLayoutPins(this);
    if (!this.$fabrikApplyingLayout && !this.isFabrikProto) fabrikRememberCurrentLayout(this);
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
  onPointerDown(p, evt) {
    return fabrikPartOnPointerDown.call(this, p, evt);
  }
  dragMovedBy(delta, p, evt) {
    return fabrikPartDragMovedBy.call(this, delta, p, evt);
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
    fabrikStyleHost(this);
    this.setBounds(bounds);
    fabrikAddPin(this, 'text', 'in', 'text');
    fabrikAddPin(this, 'textOut', 'out', 'text');
    this.setText('', { force: true });
  }
  setBounds(paneBounds) {
    paneBounds = fabrikViewApplyBounds(this, paneBounds);
    if (!this.contentPane) return;
    let ht = paneBounds.height();
    let w = paneBounds.width();
    if (this.withScrollBar && this.scrollBar) {
      let scrollW = 15;
      this.contentPane.setBounds(rect(0, 0, w - scrollW, ht));
      this.scrollBar.setBounds(rect(w - scrollW, 0, scrollW, ht));
      fabrikGrowContent(this);
    } else {
      fabrikPlaceInnerContent(this, w, ht);
    }
    fabrikLayoutPins(this);
    if (!this.$fabrikApplyingLayout && !this.isFabrikProto) fabrikRememberCurrentLayout(this);
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
    fabrikSyncPaneChrome(this);
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
  onPointerDown(p, evt) {
    return fabrikPartOnPointerDown.call(this, p, evt);
  }
  dragMovedBy(delta, p, evt) {
    return fabrikPartDragMovedBy.call(this, delta, p, evt);
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
    fabrikStyleHost(this);
    this.fabrikInputs = spec.inputs || [];
    this.setBounds(bounds);
    let src = spec.source || 'function () { return null; }';
    this.setText(src, { force: true });
    if (this.contentPane && this.contentPane.shape) {
      this.contentPane.shape.verticallyCenterSingleLine = false;
      this.contentPane.shape.hang = 2;
      let inset = this.contentPane.shape.inset;
      if (inset) {
        if (inset.x !== 2) inset.x = 2;
        if (inset.y !== 2) inset.y = 2;
      } else this.contentPane.shape.inset = pt(2, 2);
    }
    for (let i = 0; i < this.fabrikInputs.length; i++) {
      let inp = this.fabrikInputs[i];
      fabrikAddPin(this, inp.name, 'in', inp.type || 'any');
    }
    fabrikAddPin(this, spec.outputName || 'result', 'out', spec.outputType || 'any');
    fabrikFitFunctionView(this);
  }
  setBounds(paneBounds) {
    paneBounds = fabrikViewApplyBounds(this, paneBounds);
    if (!this.contentPane) return;
    fabrikPlaceInnerContent(this, paneBounds.width(), paneBounds.height());
    fabrikLayoutPins(this);
    if (!this.$fabrikApplyingLayout && !this.isFabrikProto) fabrikRememberCurrentLayout(this);
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
  onPointerDown(p, evt) {
    return fabrikPartOnPointerDown.call(this, p, evt);
  }
  dragMovedBy(delta, p, evt) {
    return fabrikPartDragMovedBy.call(this, delta, p, evt);
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
        if (sub.$fabrikHidden) return;
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
      if (sub.$fabrikHidden) return;
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
    let box = this.paneLayoutBounds();
    let w = Math.max(40, box.width() - 8);
    this.partsPane = this.addMorph(
      new FabrikBinPartsPane(rect(4, box.topLeft.y + 4, w, Math.max(40, box.height() - 8))),
    );
    this.relayoutContentPanes();
  }
  relayoutContentPanes() {
    if (this.collapsed) return;
    let box = this.paneLayoutBounds();
    let w = Math.max(40, box.width() - 8);
    if (this.partsPane)
      this.partsPane.setBounds(rect(4, box.topLeft.y + 4, w, Math.max(40, box.height() - 8)));
    this.layoutShownParts();
  }
  showCategory(_name) {
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
    let paneB = pane.getBounds();
    let paneH = paneB.height();
    let scrollW = pane.scrollBarWidth != null ? pane.scrollBarWidth : 15;
    let innerW = Math.max(40, paneB.width() - scrollW);
    let cats = ['parts', 'views', 'shapes'];
    let x = 18;
    let y = 8;
    let rowH = 0;
    let gap = 24;
    let right = innerW - 8;
    for (let c = 0; c < cats.length; c++) {
      if (c > 0 && rowH > 0) {
        y = y + rowH + gap;
        x = 18;
        rowH = 0;
      }
      let items = (this.$binCats && this.$binCats[cats[c]]) || [];
      for (let j = 0; j < items.length; j++) {
        let m = items[j];
        if (!m) continue;
        if (m.owner !== holder) holder.addMorph(m);
        m.$fabrikHidden = false;
        if (
          !m.$fabrikBinPlaced &&
          m.isFabrikProto &&
          (m.className === 'FabrikFunctionView' || m.className === 'FabrikListView' || m.className === 'FabrikTextView')
        ) {
          fabrikSetFrame(m, 0, 0, 80, 32);
          fabrikFitBinProto(m);
        }
        let pin = m.fabrikPins && m.fabrikPins.length ? FABRIK_PIN_W : 0;
        let fb = fabrikBinFootprint(m);
        let need = fb.width();
        if (need < m.getBounds().width() + pin + pin) need = m.getBounds().width() + pin + pin;
        let needH = fb.height();
        if (x > 18 && x + need > right) {
          y = y + rowH + gap;
          x = 18;
          rowH = 0;
        }
        let body = m.getBounds();
        let t = m.transform && m.transform.translation;
        let tx = t ? t.x : body.topLeft.x;
        let ty = t ? t.y : body.topLeft.y;
        let ny = y;
        if (m.className === 'LineMorph' && needH > body.height())
          ny = y + (needH - body.height()) / 2;
        fabrikSetPos(m, tx + (x + pin - body.topLeft.x), ty + (ny - body.topLeft.y));
        m.$fabrikBinPlaced = true;
        x = x + need + gap;
        if (needH > rowH) rowH = needH;
      }
    }
    let contentH = Math.max(paneH, y + rowH + 8);
    fabrikSetFrame(holder, 0, 0, innerW, contentH);
    this.$binLaid = true;
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
    if (fabrikViewMode(this.world()) === 'user') return;
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
    this.setColor(Color.lightGray);
    this.setStyles(Color.lightGray, 1, Color.gray);
    this.setPanelTitle('Fabrik');
    this.isFabrikPanel = true;
    this.$fabrikWrapped = false;
    if (this.titleBar && this.titleBar.closeBtn) this.titleBar.removeMorph(this.titleBar.closeBtn);
  }
  relayoutContentPanes() {}
  setBounds(paneBounds) {
    paneBounds = fabrikMaybeSnapBounds(this, paneBounds);
    PanelMorph.prototype.setBounds.call(this, paneBounds);
    if (!this.$fabrikApplyingLayout) fabrikRememberCurrentLayout(this);
  }
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
    /**
     * Dashed frame in *local* coords. Parent render already applied this
     * panel's transform (halo Z / Fabrik grow), so the rect must be the
     * unscaled shape — using world widths here doubled the live scale.
     */
    let sh = this.shape.getBounds().copy();
    if (this.$fabrikWrapped) return sh;
    if (fabrikViewMode(this.world()) === 'layout') return sh;
    let sc = this.transform && this.transform.scale;
    if (sc && (Math.abs((sc.x || 1) - 1) > 0.001 || Math.abs((sc.y || 1) - 1) > 0.001)) return sh;
    let views = fabrikWrappableViewsIn(this);
    if (!views.length) return sh;
    let u = null;
    for (let i = 0; i < views.length; i++) {
      let wr = views[i].boundsInWorld();
      let tl = this.localize(wr.topLeft);
      let br = this.localize(wr.bottomRight());
      let local = rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
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
  unwrapUserViews() {
    if (!this.$fabrikWrapped) return this;
    let world = this.world();
    if (!world) {
      this.$fabrikWrapped = false;
      return this;
    }
    let kids = [];
    if (this.submorphs) for (let i = 0; i < this.submorphs.length; i++) kids.push(this.submorphs[i]);
    if (this.$submorphs) for (let j = 0; j < this.$submorphs.length; j++) kids.push(this.$submorphs[j]);
    for (let k = 0; k < kids.length; k++) {
      let m = kids[k];
      if (!m || m === this.titleBar) continue;
      if (m.className === 'PanelTitleBar') continue;
      if (m.reparentToOwnerPreservingWorldAnchor) m.reparentToOwnerPreservingWorldAnchor(world, null);
    }
    this.$fabrikWrapped = false;
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
      if (fabrikViewMode(this.world()) !== 'user') fabrikStrokeDashedFrame(ctx, this.previewFrameLocal());
      return;
    }
    if (this.titleBar) {
      ctx.save();
      let tfm = this.titleBar.transform;
      ctx.translate(tfm.translation.x, tfm.translation.y);
      this.titleBar.renderOn(ctx);
      ctx.restore();
    }
    if (fabrikViewMode(this.world()) !== 'user') fabrikStrokeDashedFrame(ctx, this.previewFrameLocal());
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

function fabrikAllWrappableViews(world) {
  let found = [];
  if (!world || !world.eachSubmorph) return found;
  world.eachSubmorph(function (m) {
    if (!fabrikIsWrappableView(m)) return;
    if (m.owner !== world) return;
    found.push(m);
  });
  return found;
}

function fabrikFindPanel(world) {
  let found = null;
  fabrikEachMorph(world, function (m) {
    if (!found && m && m.isFabrikPanel) found = m;
  });
  return found;
}

function fabrikUnwrapAllPanels(world) {
  let panels = [];
  fabrikEachMorph(world, function (m) {
    if (m && m.isFabrikPanel && m.$fabrikWrapped) panels.push(m);
  });
  for (let i = 0; i < panels.length; i++) {
    if (panels[i].unwrapUserViews) panels[i].unwrapUserViews();
  }
}

function fabrikWrapForUserView(world) {
  if (!world) return null;
  let panel = fabrikFindPanel(world);
  let covered = panel ? fabrikWrappableViewsIn(panel) : [];
  if (!panel || !covered.length) {
    let views = fabrikAllWrappableViews(world);
    if (!views.length) return panel;
    let u = null;
    for (let i = 0; i < views.length; i++) {
      let wr = views[i].boundsInWorld();
      u = u ? u.union(wr) : fabrikCopyRect(wr);
    }
    let th = 24;
    if (typeof PanelTitleBar === 'function' && PanelTitleBar.prototype && PanelTitleBar.prototype.HEIGHT)
      th = PanelTitleBar.prototype.HEIGHT;
    if (!panel) panel = fabrikMakeNewPanel(world);
    panel.setBounds(rect(u.topLeft.x, u.topLeft.y - th, Math.max(80, u.width()), u.height() + th));
  }
  if (panel && !panel.$fabrikWrapped) panel.wrapUserViews();
  return panel;
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
  if (!bin || bin.$fabrikHidden || !worldP) return false;
  let b = bin.boundsInWorld ? bin.boundsInWorld() : bin.getBounds();
  if (!b || !b.topLeft) return false;
  let x = worldP.x;
  let y = worldP.y;
  return x >= b.topLeft.x && y >= b.topLeft.y && x <= b.topLeft.x + b.width() && y <= b.topLeft.y + b.height();
}


function fabrikStamp(proto, dest, at) {
  let m = null;
  let kind = proto.fabrikKind;
  at = pt(fabrikGrid(at.x), fabrikGrid(at.y));
  if (kind === 'listView') {
    m = new FabrikListView(rect(at.x, at.y, fabrikGrid(160), fabrikGrid(200)));
    if (proto.fabrikList) m.setList(proto.fabrikList);
  } else if (kind === 'textView') {
    m = new FabrikTextView(rect(at.x, at.y, fabrikGrid(240), fabrikGrid(180)));
    let t =
      proto.contentPane && proto.contentPane.shape && proto.contentPane.shape.string
        ? proto.contentPane.shape.string
        : 'normal JS\n  text in a string';
    m.setText(t, { force: true });
  }
  else if (kind === 'functionView') {
    m = new FabrikFunctionView(rect(at.x, at.y, fabrikGrid(260), fabrikGrid(96)), {
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
  if (m.className !== 'LineMorph') fabrikSnapMorph(m);
  m.dragMovedBy = fabrikPartDragMovedBy;
  if (kind === 'box' || kind === 'oval' || kind === 'star') {
    m.onPointerDown = fabrikPartOnPointerDown;
    m.setBounds = function (b) {
      b = fabrikMaybeSnapBounds(this, b);
      Morph.prototype.setBounds.call(this, b);
      if (!this.$fabrikApplyingLayout) fabrikRememberCurrentLayout(this);
    };
    m.renderOn = function (ctx) {
      Morph.prototype.renderOn.call(this, ctx);
      fabrikDrawHandles(ctx, this);
    };
  }
  m.$fabrikNeedsBothFrames = true;
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
  if (fv) fabrikEstablishPartFrames(fv);
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
    menuItem('layout view', function () {
      fabrikSetView('layout', world);
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

function fabrikStartBinStamp(proto, worldP, evt) {
  if (!proto) return null;
  let world = proto.world();
  let at = proto.boundsInWorld().topLeft;
  let copy = fabrikStamp(proto, world, at);
  if (!copy) return null;
  copy.$fabrikBinDrag = true;
  copy.dragEnded = function (upP, upEvt, wasDrag) {
    let dropP = this.owner ? this.owner.globalize(upP) : upP;
    if (fabrikWorldPtInBin(this.world(), dropP) || !wasDrag) {
      this.remove();
      return;
    }
    this.$fabrikBinDrag = false;
    this.dragEnded = fabrikPartDragEnded;
    fabrikEstablishPartFrames(this);
    fabrikPartDragEnded.call(this, upP, upEvt, wasDrag);
  };
  copy.beginPointerDrag(worldP, evt);
  return copy;
}

function fabrikBinProtoPointerDown(p, evt) {
  if (!this.includesPt(p)) return false;
  let proto = fabrikBinProtoOf(this);
  if (!proto) return false;
  if (typeof effectiveMetaKey === 'function' && effectiveMetaKey(evt)) {
    consumeSoftMetaKey();
    if (proto.showHalo) proto.showHalo();
    return false;
  }
  let worldP = this.owner ? this.owner.globalize(p) : p;
  proto.$fabrikStampP = worldP;
  proto.$fabrikStampEvt = evt;
  this.world().setPointerFocus(this);
  return true;
}

function fabrikBinProtoPointerMove(p, evt) {
  let proto = fabrikBinProtoOf(this);
  if (!proto || !proto.$fabrikStampP) return false;
  let worldP = this.owner ? this.owner.globalize(p) : p;
  let s = proto.$fabrikStampP;
  if (Math.abs(worldP.x - s.x) < 3 && Math.abs(worldP.y - s.y) < 3) return true;
  proto.$fabrikStampP = null;
  proto.$fabrikStampEvt = null;
  fabrikStartBinStamp(proto, worldP, evt);
  return true;
}

function fabrikBinProtoPointerUp(_p, _evt) {
  let proto = fabrikBinProtoOf(this);
  if (proto) {
    proto.$fabrikStampP = null;
    proto.$fabrikStampEvt = null;
  }
  let world = this.world && this.world();
  if (world && world.setPointerFocus) world.setPointerFocus(null);
  return true;
}

function fabrikArmBinProto(morph) {
  fabrikEachMorph(morph, function (m) {
    m.onPointerDown = fabrikBinProtoPointerDown;
    m.onPointerMove = fabrikBinProtoPointerMove;
    m.onPointerUp = fabrikBinProtoPointerUp;
  });
  if (morph.$fabrikHideArmed) return;
  morph.$fabrikHideArmed = true;
  let prevR = morph.renderOn;
  morph.renderOn = function (ctx) {
    if (this.$fabrikHidden) return;
    if (prevR) return prevR.call(this, ctx);
    Morph.prototype.renderOn.call(this, ctx);
  };
  let prevI = morph.includesPt;
  morph.includesPt = function (p) {
    if (this.$fabrikHidden) return false;
    if (this.className === 'LineMorph') return this.fullBounds().includesPt(p);
    return prevI ? prevI.call(this, p) : Morph.prototype.includesPt.call(this, p);
  };
  if (morph.className === 'LineMorph') {
    let prevFB = morph.fullBounds;
    morph.fullBounds = function () {
      let b = prevFB ? prevFB.call(this) : Morph.prototype.fullBounds.call(this);
      let pad = 8;
      let minH = 28;
      let h = b.height();
      let y = b.topLeft.y;
      if (h < minH) {
        y = y + h / 2 - minH / 2;
        h = minH;
      }
      return rect(b.topLeft.x - pad, y - pad, b.width() + 2 * pad, h + 2 * pad);
    };
  }
}

function fabrikStyleBinProto(morph) {
  morph.$fabrikShowPins = true;
  morph.$fabrikPinLabels = false;
  if (morph.setColor) morph.setColor(Color.white);
  if (morph.setStyles) morph.setStyles(Color.white, FABRIK_BORDER_W, Color.black);
  fabrikQuietTextShape(morph.shape);
  let cp = morph.contentPane;
  if (cp) {
    if (cp.setStyles) cp.setStyles(Color.white, 0, Color.white);
    if (cp.shape) {
      cp.shape.borderWidth = 0;
      cp.shape.borderColor = null;
      if (cp.shape.boxColor != null) cp.shape.boxColor = Color.white;
      if (cp.setColor) cp.setColor(Color.white);
      fabrikQuietTextShape(cp.shape);
    }
  }
}

function fabrikMakeBinItem(bin, morph, kind, label, category) {
  morph.fabrikKind = kind;
  morph.isFabrikProto = true;
  if (morph.fabrikPins && morph.fabrikPins.length) fabrikStyleBinProto(morph);
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
    let part = new FabrikFunctionView(rect(0, 0, 220, 32), spec);
    part.fabrikSource = spec.source;
    part.fabrikInputs = spec.inputs;
    part.fabrikOutputType = spec.outputType;
    part.fabrikPartName = spec.name;
    fabrikMakeBinItem(bin, part, 'functionView', null, 'parts');
  }

  let lv = new FabrikListView(rect(0, 0, 180, 58));
  lv.fabrikList = ['several', 'items in', 'a list'];
  lv.setList(lv.fabrikList);
  fabrikMakeBinItem(bin, lv, 'listView', 'listView', 'views');
  let tv = new FabrikTextView(rect(0, 0, 180, 44));
  tv.setText('normal JS\n  text in a string', { force: true });
  fabrikMakeBinItem(bin, tv, 'textView', 'textView', 'views');
  let fv = new FabrikFunctionView(rect(0, 0, 180, 32), {
    source: '(v) => v',
    inputs: [{ name: 'v', type: 'any' }],
  });
  fv.fabrikSource = '(v) => v';
  fv.fabrikInputs = [{ name: 'v', type: 'any' }];
  fv.fabrikPartName = 'function';
  fabrikMakeBinItem(bin, fv, 'functionView', 'functionView', 'views');

  bin.layoutShownParts();
}

function fabrikCopyRect(r) {
  if (!r) return r;
  return rect(r.topLeft.x, r.topLeft.y, r.width(), r.height());
}

function fabrikGetLayout(part, mode) {
  let L = part && part.$fabrikLayouts;
  return L && L[mode] ? L[mode] : null;
}

function fabrikStoredXYWH(stored) {
  let b = stored && stored.bounds;
  if (!b) return null;
  if (b.w != null) return b;
  if (!b.topLeft) return null;
  let n = new window.Object();
  n.x = b.topLeft.x;
  n.y = b.topLeft.y;
  n.w = b.width();
  n.h = b.height();
  return n;
}

function fabrikRememberLayout(part, mode, bounds) {
  if (!part || !bounds) return;
  let x;
  let y;
  let w;
  let h;
  if (bounds.w != null) {
    x = fabrikGrid(bounds.x);
    y = fabrikGrid(bounds.y);
    w = Math.max(FABRIK_GRID, fabrikGrid(bounds.w));
    h = Math.max(FABRIK_GRID, fabrikGrid(bounds.h));
  } else {
    x = fabrikGrid(bounds.topLeft.x);
    y = fabrikGrid(bounds.topLeft.y);
    w = Math.max(FABRIK_GRID, fabrikGrid(bounds.width()));
    h = Math.max(FABRIK_GRID, fabrikGrid(bounds.height()));
  }
  if (!part.$fabrikLayouts) part.$fabrikLayouts = new window.Object();
  let slot = part.$fabrikLayouts[mode];
  if (!slot) {
    slot = new window.Object();
    part.$fabrikLayouts[mode] = slot;
  }
  let b = slot.bounds;
  if (!b || b.topLeft || b.w == null) {
    b = new window.Object();
    slot.bounds = b;
  }
  b.x = x;
  b.y = y;
  b.w = w;
  b.h = h;
}

function fabrikIsArrangedPart(m) {
  if (!m || m.isFabrikProto) return false;
  let cn = m.className;
  if (cn === 'FabrikPin' || cn === 'FabrikWire' || cn === 'FabrikRubberWire') return false;
  if (cn === 'FabrikBin' || cn === 'FabrikBinPartsPane' || cn === 'MenuMorph') return false;
  if (cn === 'PanelTitleBar') return false;
  if (cn === 'FabrikListView' || cn === 'FabrikTextView' || cn === 'FabrikFunctionView') return true;
  if (m.isFabrikPanel) return true;
  if (m.fabrikKind || m.fabrikPins) return true;
  return false;
}

function fabrikEachArrangedPart(world, fn) {
  fabrikEachMorph(world, function (m) {
    if (!fabrikIsArrangedPart(m)) return;
    if (m.owner && m.owner !== world && !m.owner.isFabrikPanel) return;
    fn(m);
  });
}

function fabrikStoreModeLayouts(world, mode) {
  if (!world || (mode !== 'edit' && mode !== 'layout')) return;
  fabrikEachArrangedPart(world, function (m) {
    fabrikRememberLayout(m, mode, m.getBounds());
  });
}

function fabrikStoredFrameUsable(world, stored) {
  let n = fabrikStoredXYWH(stored);
  if (!n) return false;
  let mid = fabrikHostXY(21);
  mid.x = n.x + n.w / 2;
  mid.y = n.y + n.h / 2;
  if (fabrikWorldPtInBin(world, mid)) return false;
  return true;
}

function fabrikApplyModeLayouts(world, mode) {
  if (!world || (mode !== 'edit' && mode !== 'layout')) return;
  let showPins = mode === 'edit';
  fabrikEachArrangedPart(world, function (m) {
    if (m.$fabrikNeedsBothFrames) fabrikEstablishPartFrames(m);
    let stored = fabrikGetLayout(m, mode);
    if (mode === 'layout' && !fabrikStoredFrameUsable(world, stored)) stored = fabrikGetLayout(m, 'edit');
    if (!fabrikStoredFrameUsable(world, stored)) {
      fabrikRememberLayout(m, 'edit', m.getBounds());
      stored = fabrikGetLayout(m, 'edit');
    }
    let n = fabrikStoredXYWH(stored);
    if (!n) return;
    m.$fabrikApplyingLayout = true;
    m.$fabrikShowPins = showPins && !m.isFabrikPanel;
    let b = fabrikSnapRect(n);
    if (m.setBounds) m.setBounds(b);
    else Morph.prototype.setBounds.call(m, b);
    m.$fabrikApplyingLayout = false;
  });
}

function fabrikDefaultUserPanelBounds() {
  let e = typeof browserPanelDefaultExtent === 'function' ? browserPanelDefaultExtent() : pt(400, 300);
  let x = FABRIK_FN_X + FABRIK_FN_W + FABRIK_FN_TO_EDIT;
  return fabrikSnapRect(rect(x, 84, e.x, e.y));
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
  userPanes = fabrikPackSnappedPanes(userPanes);
  return edit ? fabrikExpandUserPaneBounds(userPanes, FABRIK_EDIT_GAP) : userPanes;
}

function fabrikPackSnappedPanes(user) {
  let ox = fabrikGrid(user.category.topLeft.x);
  let oy = fabrikGrid(user.category.topLeft.y);
  let leftW = Math.max(FABRIK_GRID, fabrikGrid(user.category.width()));
  let catH = Math.max(FABRIK_GRID, fabrikGrid(user.category.height()));
  let classH = Math.max(FABRIK_GRID, fabrikGrid(user.classNames.height()));
  let methW = Math.max(FABRIK_GRID, fabrikGrid(user.methodNames.width()));
  let methH = Math.max(FABRIK_GRID, fabrikGrid(user.methodNames.height()));
  let defH = Math.max(FABRIK_GRID, fabrikGrid(user.methodDefinition.height()));
  return {
    category: rect(ox, oy, leftW, catH),
    classNames: rect(ox, oy + catH, leftW, classH),
    methodNames: rect(ox + leftW, oy, methW, methH),
    methodDefinition: rect(ox, oy + Math.max(catH + classH, methH), leftW + methW, defH),
  };
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
  Morph.prototype.setBounds.call(m, fabrikSnapRect(rect(x, y, w, 40)));
  fabrikFitFunctionView(m);
  fabrikSnapMorph(m);
  fabrikRememberLayout(m, 'edit', m.getBounds());
  fabrikRememberLayout(m, 'layout', m.getBounds());
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
    fabrikRememberLayout(m, 'layout', userRects[names[i]]);
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
  fabrikApplyModeLayouts(world, edit ? 'edit' : 'layout');
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
      let n = fabrikStoredXYWH(L);
      if (n) {
        m.$fabrikApplyingLayout = true;
        if (m.setBounds) m.setBounds(fabrikSnapRect(n));
        else Morph.prototype.setBounds.call(m, fabrikSnapRect(n));
        m.$fabrikApplyingLayout = false;
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
  if (onTop && world && world.$fabrikRubber && world.promote) world.promote(world.$fabrikRubber);
}

function fabrikApplyFabrikChrome(world) {
  let fab = world && world.get ? world.get('fabrik') : null;
  if (!fab || !fab.setStyles) return;
  let bw = fabrikViewMode(world) === 'user' ? 2 : 1;
  fab.setStyles(Color.white, bw, Color.gray);
}

function fabrikModeLabel(mode) {
  return mode === 'user' ? 'user view' : mode === 'layout' ? 'layout view' : 'edit view';
}

function fabrikModePaneMenuSpec() {
  return {
    items: ['edit view', 'layout view', 'user view'],
    onSelect: function (item, pane) {
      let mode = item === 'user view' ? 'user' : item === 'layout view' ? 'layout' : 'edit';
      fabrikSetView(mode, (pane && pane.world && pane.world()) || Lively);
    },
  };
}

function fabrikSetView(mode, world) {
  world = world || Lively;
  if (mode === 'wiring') mode = 'edit';
  if (mode !== 'user' && mode !== 'layout') mode = 'edit';
  let prev = fabrikViewMode(world);
  if (prev === 'edit' || prev === 'layout') fabrikStoreModeLayouts(world, prev);
  if (prev === 'user' && mode !== 'user') fabrikUnwrapAllPanels(world);
  if (mode !== 'edit') fabrikEndWiring(world, false);
  world.$fabrikViewMode = mode;
  world.$fabrikEditMode = mode !== 'user';
  fabrikEnsureLayouts(world);
  let construction = mode === 'edit';
  if (mode === 'user') fabrikApplyModeLayouts(world, 'layout');
  else fabrikApplyModeLayouts(world, mode);
  fabrikPlaceHelpers(world, construction);
  fabrikStackWires(world, construction);
  fabrikApplyFabrikChrome(world);
  if (mode === 'user') fabrikWrapForUserView(world);
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
  world.$fabrikRubber = null;
  world.$fabrikWiringFrom = null;
  world.$fabrikLiveWire = null;
  world.$fabrikLiveTo = null;
}


function fabrikBinRect(world) {
  /** Sit 10px inside the world's right edge. */
  let wb = world && world.getBounds ? world.getBounds() : rect(0, 0, 800, 600);
  let w = 370;
  let h = 536;
  let x = wb.topLeft.x + wb.width() - 10 - w;
  if (x < wb.topLeft.x + 10) x = wb.topLeft.x + 10;
  let y = 32;
  return rect(x, y, w, h);
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
  fabrikInstallShiftChrome(world);

  let bin = world.addMorph(new FabrikBin(fabrikBinRect(world)));
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

//written on 2026-11-03 11:22 EST
