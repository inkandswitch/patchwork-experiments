// newdefs.js — class-based Livelymerge definitions (full catalog)
// Conventional ES classes; no w.* prefixes in source.

// Per-user (ephemeral) UI state lives in `$uiState`, an ephemeral `$`-property of the
// global object: per-replica, never stored in the Automerge document, lost on reload,
// but persistent across transactions. It is (re)initialized by initUI(), which runs at
// the start of every session. Raw host objects (DOM events, etc.) must never enter the
// Livelymerge heap — those live in plain side-tables on `window` instead.
$uiState = null;

function setPointerLocation(p) {
  // Last known pointer position for THIS user (per-replica; never shared or persisted).
  if ($uiState) $uiState.pointerLocation = p;
}
function getPointerLocation() {
  return $uiState ? $uiState.pointerLocation : null;
}

// +-----------------------+
// |  Classes and Objects  |
// +-----------------------+

let menuItemMaxChars = 30;
let menuSeparator = '—menuSep—';
let paneSelectionMenuNarrowBy = 0;
let paneSelectionMenuMinWidth = 48;
let $shiftKeyPressedFlag = false;
let $lockKeyPressedFlag = false;
let $metaKeyPressedFlag = false;
let pasteBufferItems = ['nothing to paste'];
let kbdDefaultShiftTable = {
  1: '!',
  2: '@',
  3: '#',
  4: '$',
  5: '%',
  6: '^',
  7: '&',
  8: '*',
  9: '(',
  0: ')',
  '`': '~',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};
let kbdShiftTable = { ...kbdDefaultShiftTable };
let $useOnScreenKbd = false;
let longClickForHalosLabel = 'Long click for halos';
let onScreenKeyboardLabel = 'Show on-screen keyboard';
let TRANSCRIPT_MAX_BEFORE_TRUNC = 1000;
let TRANSCRIPT_KEEP_LEN = 500;
let TRANSCRIPT_MARKER_RECURSIVE = '---recursive call ---';
let TRANSCRIPT_MARKER_STOPPED = '---stopped mirroring---';
let Lively = null;
let topLevelMorph = null;
let recentChanges = null;
let bugImage = null;
let $onScreenKeyboardMorph = null;
let $oskSavedChrome = null;
let _transcriptConsoleTargets = [];
let _lastEvalSource = null;
let _evalJustFailed = false;
let _alldefsSourceLines = null;
let _lastErrorReport = null;
let _errorRecoveryInProgress = false;
let traceMe = false;
let debugReparent = false;
let copyPasteBuffer = null;

function clearArray(xs) {
  xs.splice(0, xs.length);
}
function deleteFromArray(xs, x) {
  const idx = xs.indexOf(x);
  if (idx >= 0) {
    xs.splice(idx, 1);
  }
  return xs;
}
function deleteFromArrayPred(xs, pred) {
  while (true) {
    const idx = xs.findIndex(pred);
    if (idx < 0) {
      break;
    }
    xs.splice(idx, 1);
  }
}
function isClass(fn) {
  return typeof fn === 'function' && /^\s*class\s+/.test(fn.toString());
}
function findSuperclassOf(sub) {
  // findSuperclassOf(Ellipse) ==> Shape; null for base classes
  if (!isClass(sub) || !sub.prototype) return null;
  let superProto = Object.getPrototypeOf(sub.prototype);
  if (!superProto) return null;
  for (const cName of allClassNames()) {
    let cls = $global[cName];
    if (cls !== sub && cls.prototype === superProto) return cls;
  }
  return null;
}
function subclassDepth(cls) {
  // Prototype-chain hops below the base; used for superclass ordering.
  let depth = 0;
  let p = cls && cls.prototype ? Object.getPrototypeOf(cls.prototype) : null;
  while (p) {
    depth++;
    p = Object.getPrototypeOf(p);
  }
  return depth;
}
function allClassNames() {
  // allClassNames().length ==> 27
  return Object.getOwnPropertyNames($global)
    .sort()
    .filter((name) => isClass($global[name]));
}
function allClassNamesInSuperclassOrder() {
  // allClassNamesInSuperclassOrder()
  return allClassNames().sort(function (a, b) {
    return subclassDepth($global[a]) - subclassDepth($global[b]);
  });
}
function classStaticNames(cls) {
  // Statics only. The class transpiler also mirrors instance methods onto the class
  // object (the prototype literal reads them back); those are not statics.
  let proto = cls.prototype;
  return Object.getOwnPropertyNames(cls)
    .filter((name) => !(proto && proto[name] === cls[name]))
    .sort();
}
function classInstanceMemberNames(cls) {
  // Method (and accessor) names on the class's prototype, minus bookkeeping keys.
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'className' && name !== 'constructor')
    .sort();
}
function allClassNamesWithStatics() {
  // allClassNamesWithStatics()
  // Returns two formats in one sorted array:
  //    Classname - for regular classes
  //    Classname.class - for classes with static methods
  let classNames = [];
  for (const name of allClassNames()) {
    classNames.push(name);
    if (classStaticNames($global[name]).length > 0) classNames.push(name + '.class');
  }
  return classNames;
}
function dropNewline(str) {
  if (str.charCodeAt(str.length - 1) == 10) return str.slice(0, -1); // drop newline
  if (str.charCodeAt(str.length - 1) == 13) return str.slice(0, -1);
  return str;
}

//  Color
// -------
// RGBA paint with fillStyle for canvas; named swatches on Color.*.
class Color {
  constructor(cr, cg, cb) {
    this.r = cr;
    this.g = cg;
    this.b = cb;
    this.fillStyle = this.computeFillStyle(this.r, this.g, this.b);
    //console.log('new color fillStyle = ', this.fillStyle);
  }
  asString() {
    return this.toString();
  }
  computeFillStyle(r, g, b) {
    let s = '#';
    s += Math.floor(r * 255.999)
      .toString(16)
      .padStart(2, '0');
    s += Math.floor(g * 255.999)
      .toString(16)
      .padStart(2, '0');
    s += Math.floor(b * 255.999)
      .toString(16)
      .padStart(2, '0');
    return s;
  }
  copy() {
    return new Color(this.r, this.g, this.b);
  }
  darker() {
    return this.mixedWith(Color.black, 0.5);
  }
  lighter() {
    return this.mixedWith(Color.white, 0.5);
  }
  mixedWith(other, proportion) {
    // Mix with another color
    let p = proportion;
    let q = 1.0 - p;
    return new Color(this.r * p + other.r * q, this.g * p + other.g * q, this.b * p + other.b * q);
  }
  random() {
    return new Color(Math.random(), Math.random(), Math.random());
  }
  toString() {
    return 'new Color(' + [this.r, this.g, this.b].toString() + ')';
  }
  withAlpha(a) {
    return {
      fillStyle:
        'rgba(' +
        Math.floor(this.r * 255.999) +
        ',' +
        Math.floor(this.g * 255.999) +
        ',' +
        Math.floor(this.b * 255.999) +
        ',' +
        a +
        ')',
    };
  }
  static new(...args) {
    return new this(...args);
  }
}

Color.black = new Color(0, 0, 0);
Color.blue = new Color(0, 0, 0.8);
Color.cyan = new Color(0, 0.8, 0.8);
Color.darkGray = new Color(0.4, 0.4, 0.4);
Color.gray = new Color(0.8, 0.8, 0.8);
Color.green = new Color(0, 0.8, 0);
Color.lightGray = new Color(0.9, 0.9, 0.9);
Color.orange = new Color(0.8, 0.52, 0);
Color.paleLavender = new Color(0.93, 0.88, 0.98);
Color.red = new Color(0.8, 0, 0);
Color.veryLightGray = new Color(0.95, 0.95, 0.95);
Color.white = new Color(1, 1, 1);
Color.yellow = new Color(0.8, 0.8, 0);

// +---------------------+
// |  Canvas and Events  |
// +---------------------+
// Canvas viewport, initUI, pointer/keyboard entry, demo world bootstrap.

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  topLevelMorph.render(ctx);
}
function viewportBounds() {
  /** Layout box for the drawable canvas (Pyonpyon host: .canvas-container); else canvas bounding rect. */
  if (typeof document === 'undefined') return null;
  let c = canvas;
  if (!c) return null;
  let rw;
  let rh;
  let cont = document.querySelector('.canvas-container');
  if (cont) {
    let r = cont.getBoundingClientRect();
    rw = r.width;
    rh = r.height;
  }
  if (!rw || !rh) {
    let r2 = c.getBoundingClientRect();
    rw = r2.width;
    rh = r2.height;
  }
  if (!rw || !rh) {
    rw = c.clientWidth || c.width;
    rh = c.clientHeight || c.height;
  }
  if (!rw || !rh) return null;
  return rect(0, 0, Math.max(1, Math.round(rw)), Math.max(1, Math.round(rh)));
}
function getBounds() {
  let vp = viewportBounds();
  if (vp) return vp;
  return rect(0, 0, canvas.width, canvas.height);
}
function truncateString(str, num) {
  return str.length > num ? str.slice(0, num) + '...' : str;
}
function init() {
  // init()
  console.log('init!');
  initUI();
  initLively(); // build a simple world with a single rectangle morph
  populateLively();
}
function initLively() {
  Lively = new WorldMorph(getBounds()); // make up a morphic world
  topLevelMorph = Lively; // 'install' the morphic world in patchwork world
  return Lively;
}
function populateLively() {
  // populateLively()
  initLively(); // build a simple world with a single rectangle morph
  Lively.box = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
  Lively.oval = Lively.addMorph(new Morph(null, new Ellipse(pt(60, 75), pt(30, 15))));
  Lively.oval.setStyles(Color.green.lighter(), 2, Color.black);
  Lively.star = Lively.addMorph(new Morph(null, new Pen().star(10, 30, Color.black)));
  Lively.star.setColor(Color.yellow);
  let d = pt(30, 100).subPt(Lively.star.getBounds().topLeft);
  Lively.star.moveBy(d);

  let welcomeRect = rect(25, 350, 400, 220);
  let boxB = Lively.box.getBounds();
  let lineY = welcomeRect.topLeft.y - 20;
  let plmVerts = [pt(boxB.topLeft.x, lineY), pt(boxB.topLeft.x + boxB.width(), lineY)];
  Lively.demoLine = Lively.addMorph(
    new LineMorph(plmVerts, { borderWidth: 2, borderColor: Color.black, arrowheads: 'end' }),
  );
  Lively.demoLine.startHandleStepping();

  Lively.addMorph(
    new MethodPanel(
      welcomeRect,
      `The shapes you see are objects in Pyonpyon.  You can drag them around, copy and reshape them at will.  The tools for such manipulation are described in "halos" described in 'Halo help' in the screen menu.

Everywhere you see text, you can edit it, search, and evaluate JavaScript expressions as in 'Text help' also in the screen menu.
  355/113 -- select this and press ctrl-P
  help -- select this and press ctrl-F

`,
      'Welcome to Livelymerge! (' + new Date().toLocaleString() + ')',
    ),
  );

  Lively.showWorldMenuAt(pt(130, 40));
  testTransforms();

  bugImage = new EmojiMorph('LADY BEETLE', 64);
  // Cute bug drawing a spiral (uses bugImage at scale 0.5 via Pen.withBug)...
  Lively.spiral = Lively.addMorph(new Morph(rect(50, 210, 1, 1)));
  Lively.spiral.pen = new Pen(pt(60, 210)).withBug();
  Lively.spiral.animatedSpiral = function (argsObj) {
    if (!this.args) {
      this.args = argsObj;
      this.pen.setPenColor(Color.red);
      this.spiralI = 0;
    }
    this.spiralI++;
    if (this.spiralI > this.args.nSteps) {
      this.stopStepping();
      this.pen.bug.moveTo(this.pen.location.addPt(pt(0, 20)));
      this.world().changed();
      return;
    }
    this.pen.go(this.args.goDist * this.spiralI);
    this.pen.turn(this.args.turnAngle);
    if (this.trail) this.trail.remove();
    this.trail = this.owner.addMorph(new Morph(null, this.pen.polyLine()));
    this.world().changed();
  };
  setTimeout(() => {
    Lively.spiral.startStepping('animatedSpiral', 
      { goDist: 2, turnAngle: 60, nSteps: 8 /* was 26 */ }, 50);
  }, 2000);
}

// comment this out if you want to run in pyonpyon
class Map {
  entries = [];

  set(key, value) {
    for (const e of this.entries) {
      if (e[0] === key) {
        e[1] = value;
        return;
      }
    }
    this.entries.push([key, value]);
  }

  get(key) {
    for (const [k, v] of this.entries) {
      if (k === key) {
        return v;
      }
    }
    return undefined;
  }

  delete(key) {
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i][0] === key) {
        this.entries.splice(i, 1);
        return;
      }
    }
  }

  has(key) {
    for (const [k, v] of this.entries) {
      if (k === key) {
        return true;
      }
    }
  }

  clear() {
    clearArray(this.entries);
  }

  forEach(callback) {
    for (const [k, v] of this.entries) {
      callback(v, k, this);
    }
  }

  size() {
    return this.entries.length;
  }

  keys() {
    return this.entries.map(([k, v]) => k);
  }

  values() {
    return this.entries.map(([k, v]) => v);
  }
}

// comment this out if you want to run in pyonpyon
class Set {
  entries = [];

  add(value) {
    for (const [k, v] of this.entries) {
      if (v === value) {
        return this;
      }
    }
    this.entries.push([value, value]);
    return this;
  }

  delete(value) {
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i][1] === value) {
        this.entries.splice(i, 1);
        return;
      }
    }
  }

  has(value) {
    for (const [k, v] of this.entries) {
      if (v === value) {
        return true;
      }
    }
    return false;
  }

  clear() {
    this.entries = [];
  }

  forEach(callback) {
    for (const [k, v] of this.entries) {
      callback(v, k, this);
    }
  }

  size() {
    return this.entries.length;
  }

  keys() {
    return this.entries.map(([k, v]) => k);
  }

  values() {
    return this.entries.map(([k, v]) => v);
  }
}

function initUI() {
  // Per-user UI state: ephemeral (never in the Automerge document), survives across
  // transactions, reset on reload. `eventListeners` keeps the listener closures (and
  // their captured scopes) alive across transactions; without it the GC would collect
  // them and the browser-held listener proxies would go stale.
  $uiState = {
    eventListeners: [],
    /** pointerId → { timer, pressPt, startPt, longClickMoveCancelPx? }; raw DOM events
     *  are not representable in the heap, so they live in window._lcEvts instead. */
    longClickByPointerId: {},
    pointerLocation: null,
    lastFrameTime: null,
  };
  // Raw side-tables (plain JS on the real window; never touch the LM heap):
  window._canvasEvents = new window.Array(); // DOM events queued between frames
  window._lcEvts = new window.Object(); // pointerId → raw pointerdown event
  window._lcTimers = new window.Object(); // pointerId → raw timer handle (a host object in Node)

  function addEventListener(source, type, listener) {
    // prevents GC from collecting the listener
    $uiState.eventListeners.push(listener);
    source.addEventListener(type, listener);
  }

  /** After this many ms with the pointer still down, the original pointerdown gets `longClick === true`. */
  $LONG_CLICK_MS = 700;
  /** Cancel long-click timer if the pointer moves farther than this from press (CSS px). */
  $LONG_CLICK_MOVE_CANCEL_PX = 7;
  /** When true, a completed long-click runs halo cycling like meta-click (see {@link WorldMorph.longClickHaloDefersAt}). Default false; toggled from world menu "Long click for halos". */
  $longClickForHalos = false;
  $uiState.longClickDisarmPointer = function (pointerId) {
    let arm = $uiState.longClickByPointerId[pointerId];
    if (!arm) return;
    if (window._lcTimers[pointerId] != null) clearTimeout(window._lcTimers[pointerId]);
    delete $uiState.longClickByPointerId[pointerId];
    delete window._lcEvts[pointerId];
    delete window._lcTimers[pointerId];
  };
  $uiState.longClickArmIfNeeded = function (pressPt, downEvt) {
    if (!downEvt || typeof downEvt.pointerId !== 'number') return;
    if (typeof downEvt.button === 'number' && downEvt.button !== 0) return;
    $uiState.longClickDisarmPointer(downEvt.pointerId);
    let pid = downEvt.pointerId;
    let ms = $LONG_CLICK_MS != null ? $LONG_CLICK_MS : 1000;
    let timer = setTimeout(function () {
      let arm = $uiState.longClickByPointerId[pid];
      if (!arm) return;
      let downEvt = window._lcEvts[pid];
      try {
        if (downEvt) downEvt.longClick = true;
      } catch (err) {
        /* ignore */
      }
      if ($longClickForHalos !== false && topLevelMorph && topLevelMorph.onLongClickHalo)
        topLevelMorph.onLongClickHalo(arm.pressPt, downEvt);
    }, ms);
    window._lcEvts[pid] = downEvt;
    window._lcTimers[pid] = timer; // raw handle stays out of the heap
    $uiState.longClickByPointerId[pid] = {
      armed: true,
      pressPt: pt(pressPt.x, pressPt.y),
      startPt: pt(pressPt.x, pressPt.y),
    };
  };

  $actorID = window.Automerge.getActorId(window.handle.doc());
  // Fresh UI init must not inherit stale soft-shift state.
  $shiftKeyPressedFlag = false; // per-user soft-shift resets on session start
  if (topLevelMorph) topLevelMorph.$shiftKeyDown = false;
  _refreshPadModifierStyles();

  // Remove any previous listeners so we never double-register (avoids doubled clicks)

  if (window._uiAbortController) window._uiAbortController.abort();
  window._uiAbortController = new window.AbortController();

  canvas.style.touchAction = 'none';
  addEventListener(canvas, 'pointerdown', (e) => window._canvasEvents.push(e));
  addEventListener(canvas, 'pointerup', (e) => window._canvasEvents.push(e));
  addEventListener(canvas, 'pointermove', (e) => window._canvasEvents.push(e));
  addEventListener(canvas, 'pointercancel', (ev) => {
    if (ev && ev.pointerId != null) $uiState.longClickDisarmPointer(ev.pointerId);
  });
  canvas.tabIndex = 1;
  addEventListener(canvas, 'keydown', (e) => window._canvasEvents.push(e));
  addEventListener(canvas, 'keypress', (e) => window._canvasEvents.push(e));
  addEventListener(canvas, 'keyup', (e) => window._canvasEvents.push(e));

  /** Target time between frames (ms). rAF fires at the display's refresh rate
   *  (60Hz+); frames that arrive sooner than this are skipped, so events/render
   *  run at ~30Hz. */
  $FRAME_INTERVAL_MS = 1000 / 30;

  function onFrame(now) {
    if ($uiState.lastFrameTime != null && now - $uiState.lastFrameTime < $FRAME_INTERVAL_MS) {
      window._uiRafId = window.requestAnimationFrame(onFrame);
      return;
    }
    // Advance by the interval rather than to `now`, so 16.7ms rAF ticks don't drift
    // us down to 20Hz; snap to `now` when we've fallen behind (hidden tab, slow frame).
    $uiState.lastFrameTime =
      $uiState.lastFrameTime == null || now - $uiState.lastFrameTime >= 2 * $FRAME_INTERVAL_MS
        ? now
        : $uiState.lastFrameTime + $FRAME_INTERVAL_MS;
    try {
      window.runtime.change(() => {
        processEvents();
        if (render) {
          render();
        }
        window._uiRafId = window.requestAnimationFrame(onFrame);
      });
    } catch (e) {
      if (handleRuntimeError) handleRuntimeError(e, 'animation frame');
      window._uiRafId = window.requestAnimationFrame(onFrame);
    }
  }

  // requestAnimationFrame holds onFrame's proxy, but that is invisible to the LM GC:
  // without an LM-visible root, onFrame's captured scope would be collected and the
  // next frame would fire a stale closure. Retaining it here keeps it (and everything
  // it captures, e.g. processEvents) alive — ephemerally, per user.
  $uiState.onFrame = onFrame;
  if (window._uiRafId != null) window.cancelAnimationFrame(window._uiRafId);
  window._uiRafId = window.requestAnimationFrame(onFrame);

  function processEvents() {
    const seen = new window.Set(); // native Set; holds raw DOM events
    for (const e of window._canvasEvents) {
      if (seen.has(e)) continue;
      seen.add(e);

      e.actorID = $actorID;

      switch (e.type) {
        case 'pointerdown': {
          const pt = pointerEventCanvasLocalPt(canvas, e);
          onPointerDown(pt, e);
          break;
        }
        case 'pointerup': {
          const pt = pointerEventCanvasLocalPt(canvas, e);
          onPointerUp(pt, e);
          break;
        }
        case 'pointermove': {
          const pt = pointerEventCanvasLocalPt(canvas, e);
          onPointerMove(pt, e);
          break;
        }
        case 'keydown':
          onKeyDown(e);
          break;
        case 'keypress':
          onKeyPress(e);
          break;
        case 'keyup':
          onKeyUp(e);
          break;
        default:
          console.error('unsupported event type', e.type);
      }
    }
    window._canvasEvents = new window.Array();
  }
  console.log('initUI loaded');
  ensureAlldefsSourceLines();
}
// function initLively() {
//   Lively = new WorldMorph(getBounds()); // make up a morphic world
//   topLevelMorph = Lively; // 'install' the morphic world in patchwork world
//   return Lively;
// }
function onKeyDown(e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  // console.log('TODO(dan): handle key press event', e);
  // if (e.key == 'Meta') return; // ignore; check evt.metaKey on simple chars
  topLevelMorph.onKeyDown(e);
  // hello
  e.preventDefault();
}
function onKeyPress(e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  // console.log('TODO(dan): handle key onKeyPress event', e);
  // topLevelMorph.onKeyPress(e);
}
function onKeyUp(e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  if (topLevelMorph && topLevelMorph.onKeyUp) topLevelMorph.onKeyUp(e);
}
function onPointerDown(p, e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  if ($uiState && $uiState.longClickArmIfNeeded) $uiState.longClickArmIfNeeded(p, e);
  topLevelMorph.onPointerDown(p, e);
}
function onPointerDownNow(p, e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  topLevelMorph.onPointerDown(p, e);
}
function onPointerMove(p, e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  if (e && typeof e.pointerId === 'number' && $uiState) {
    let arm = $uiState.longClickByPointerId[e.pointerId];
    if (arm) {
      let lim =
        arm.longClickMoveCancelPx != null
          ? arm.longClickMoveCancelPx
          : $LONG_CLICK_MOVE_CANCEL_PX != null
            ? $LONG_CLICK_MOVE_CANCEL_PX
            : 18;
      if (p.dist(arm.startPt) > lim) $uiState.longClickDisarmPointer(e.pointerId);
    }
  }
  topLevelMorph.onPointerMove(p, e);
}
function onPointerUp(p, e) {
  if (e && e.actorID == null) e.actorID = $actorID;
  if (e && typeof e.pointerId === 'number' && $uiState) $uiState.longClickDisarmPointer(e.pointerId);
  topLevelMorph.onPointerUp(p, e);
}
function pointerEventCanvasLocalPt(canvas, e) {
  /** Local coords on canvas for Pointer Events. Touch/pen use clientX/Y − rect (Safari often omits or misreports offsetX/Y). */
  if (!canvas || !e) return pt(0, 0);
  let clientBased =
    e.pointerType === 'touch' ||
    e.pointerType === 'pen' ||
    typeof e.offsetX !== 'number' ||
    typeof e.offsetY !== 'number' ||
    Number.isNaN(e.offsetX) ||
    Number.isNaN(e.offsetY);
  if (!clientBased) return pt(e.offsetX, e.offsetY);
  let r = canvas.getBoundingClientRect();
  let cx = e.clientX != null ? e.clientX : 0;
  let cy = e.clientY != null ? e.clientY : 0;
  return pt(cx - r.left, cy - r.top);
}
function setShiftKeyPressed(v) {
  $shiftKeyPressedFlag = !!v;
  _refreshPadModifierStyles();
}
function setLockKeyPressed(v) {
  $lockKeyPressedFlag = !!v;
  _refreshPadModifierStyles();
}
function setMetaKeyPressed(v) {
  $metaKeyPressedFlag = !!v;
  _refreshPadModifierStyles();
}
function toggleMetaKeyPressed() {
  setMetaKeyPressed(!$metaKeyPressedFlag);
}
function consumeSoftMetaKey() {
  if (!$metaKeyPressedFlag) return;
  $metaKeyPressedFlag = false;
  _refreshPadModifierStyles();
}
function consumeSoftShiftKey() {
  /** Clear one-shot soft SHIFT (LOCK is unchanged). */
  if (!$shiftKeyPressedFlag || $lockKeyPressedFlag) return;
  setShiftKeyPressed(false);
}
function isShiftKeyPressed() {
  /** True if shift should apply: hardware shift, LOCK, shift flag, or world shiftKeyDown from keys. */
  let worldDown = topLevelMorph && topLevelMorph.$shiftKeyDown;
  return $shiftKeyPressedFlag || $lockKeyPressedFlag || !!worldDown;
}
function isLockKeyPressed() {
  return $lockKeyPressedFlag;
}
function isMetaKeyPressed() {
  return $metaKeyPressedFlag;
}
function effectiveMetaKey(evt) {
  /** True if meta should apply: hardware meta or soft META flag (use {@link consumeSoftMetaKey} after halo use). */
  return !!(evt && evt.metaKey) || $metaKeyPressedFlag;
}
function effectiveShiftKey(evt) {
  /** True if shift should apply for this event (LOCK forces shift until cleared). */
  let hardware = !!evt && evt.shiftKey;
  let worldDown = topLevelMorph && topLevelMorph.$shiftKeyDown;
  let evtType = evt && evt.type ? evt.type : '';
  let worldDownApplies =
    worldDown && evtType !== 'pointerdown' && evtType !== 'pointermove' && evtType !== 'pointerup';
  let flag = $shiftKeyPressedFlag;
  if (flag) $shiftKeyPressedFlag = false;
  if (flag) _refreshPadModifierStyles();
  return hardware || flag || $lockKeyPressedFlag || worldDownApplies;
}
function _refreshPadModifierStyles() {
  let root = topLevelMorph;
  if (!root) return;
  let kb = $onScreenKeyboardMorph;
  if (kb && kb.world() && kb.refreshModifierKeyHighlights) kb.refreshModifierKeyHighlights();
  if (kb && kb.world() && kb.refreshKeyLabels) kb.refreshKeyLabels();
  if (root.changed) root.changed();
}
function pointerOnOskKeyUI(world, worldPt) {
  /** Pointer is over an OSK key so world should not steal meta for cycleHalo. */
  let t = world.topMorphAt(worldPt);
  while (t) {
    if (t.className === 'KbdKeyMorph') return true;
    t = t.owner;
  }
  return false;
}
function testTransforms() {
  Lively.box.testTransform(() => {
    Lively.oval.testTransform(() => {
      Lively.star.testTransform();
    });
  });
}
// +------------+
// |  Geometry  |
// +------------+
// Points, rectangles, transforms, and pen/turtle geometry.

function pt(x, y) {
  return new Point(x, y); // make-a-point
}
function ptPolar(r, theta) {
  return new Point(r * Math.sin(theta), r * Math.cos(theta));
}
function rect(x, y, width, height) {
  return new Rectangle(pt(x, y), pt(width, height)); // make-a-point
}
function unionPts(points) {
  return Rectangle.prototype.unionPts(points);
}
//  Point
// -------
// 2D point: addPt, subPt, scaleBy, dist, gridBy, boundsWithRadius.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  addPt(p) {
    return pt(this.x + p.x, this.y + p.y);
  }
  adhereTo(rect) {
    if (rect.includesPt(this)) return this; // it's inside
    let br = rect.bottomRight();
    return pt(
      Math.min(Math.max(this.x, rect.topLeft.x), br.x),
      Math.min(Math.max(this.y, rect.topLeft.y), br.y),
    );
  }
  asString() {
    return `pt(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
  }
  boundsWithRadius(r) {
    return rect(this.x - r, this.y - r, 2 * r, 2 * r);
  }
  copy() {
    return pt(this.x, this.y);
  }
  dist(p) {
    let dx = p.x - this.x;
    let dy = p.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  extent(ext) {
    // Make a rectangle
    return new Rectangle(this, ext);
  }
  flipX() {
    /** Reflect velocity off a vertical wall (negate x). */
    return pt(-this.x, this.y);
  }
  flipY() {
    /** Reflect velocity off a horizontal wall (negate y). */
    return pt(this.x, -this.y);
  }
  gridBy(n) {
    return this.scaleBy(1 / n)
      .round()
      .scaleBy(n);
  }
  lePt(p) {
    return this.x <= p.x && this.y <= p.y;
  }
  maxPt(p) {
    return new Point(Math.max(this.x, p.x), Math.max(this.y, p.y));
  }
  minPt(p) {
    return new Point(Math.min(this.x, p.x), Math.min(this.y, p.y));
  }
  moveBy(p) {
    // ** why are we side-effecting here, but copying in other methods?
    this.x += p.x;
    this.y += p.y;
  }
  nearestPointOnLineFrom(p1, p2) {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    let len2 = dx * dx + dy * dy;
    if (len2 === 0) return pt(p1.x, p1.y);
    let t = ((this.x - p1.x) * dx + (this.y - p1.y) * dy) / len2;
    if (t <= 0) return pt(p1.x, p1.y);
    if (t >= 1) return pt(p2.x, p2.y);
    return pt(p1.x + t * dx, p1.y + t * dy);
  }
  negated() {
    return pt(-this.x, -this.y);
  }
  polarAngle() {
    return Math.atan2(this.x, this.y);
  }
  rect(p) {
    return rect(this.minPt(p), this.maxPt(p));
  }
  render(ctx) {
    // ctx.beginPath();
    ctx.fillStyle = Color.black.fillStyle;
    ctx.arc(this.x, this.y, 8, 0, 2 * Math.PI);
    ctx.fill();
  }
  rotatedBy(radians, pivotPt) {
    let v = this.subPt(pivotPt);
    let polarDist = v.dist(pt(0, 0));
    let rot = ptPolar(polarDist, v.polarAngle() + radians);
    return rot.addPt(pivotPt);
  }
  round() {
    return pt(Math.round(this.x), Math.round(this.y));
  }
  scaleBy(s) {
    const sp = typeof s === 'number' ? pt(s, s) : s;
    return pt(this.x * sp.x, this.y * sp.y);
  }
  subPt(p) {
    return pt(this.x - p.x, this.y - p.y);
  }
  toString() {
    return this.asString();
  }
  translatedBy(p) {
    return this.addPt(p);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  Rectangle
// -----------
// Axis-aligned rect: union, intersection, includesPt.
class Rectangle {
  constructor(p, ext) {
    this.topLeft = p;
    this.extent = ext;
  }
  asString() {
    return `${this.topLeft.asString()}.extent(${this.extent.asString()})`;
  }
  bottom() {
    return this.topLeft.y + this.extent.y;
  }
  bottomLeft() {
    return this.topLeft.addPt(pt(0, this.height()));
  }
  bottomRight() {
    return this.topLeft.addPt(this.extent);
  }
  center() {
    return this.topLeft.addPt(this.extent.scaleBy(0.5));
  }
  copy() {
    return this.topLeft.copy().extent(this.extent.copy());
  }
  expandBy(n) {
    const d = typeof n === 'number' ? n : n.x;
    return this.insetBy(pt(-d, -d));
  }
  getBounds() {
    return new Rectangle(this.topLeft, this.extent);
  }
  height() {
    return this.extent.y;
  }
  includesPt(p) {
    return this.topLeft.lePt(p) && p.lePt(this.bottomRight());
  }
  insetBy(numOrPt) {
    const inset = typeof numOrPt === 'number' ? pt(numOrPt, numOrPt) : numOrPt;
    return this.topLeft.addPt(inset).extent(this.extent.subPt(inset).subPt(inset));
  }
  intersection(other) {
    /** Axis-aligned overlap, or zero-size rect at this topLeft when disjoint. */
    if (!this.overlapsRect(other)) return rect(this.topLeft.x, this.topLeft.y, 0, 0);
    let tl = this.topLeft.maxPt(other.topLeft);
    let br = this.bottomRight().minPt(other.bottomRight());
    return rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }
  moveBy(p) {
    //NOTE: this does not return a copy, but *changes this rect*
    this.topLeft = this.topLeft.addPt(p);
  }
  movedBy(p) {
    //NOTE: this *does* return a copy, and doesnt change this rect
    return this.topLeft.addPt(p).extent(this.extent.copy());
  }
  onPointerDown(p, e) {
    if (this.includesPt(p)) {
      this.hitPoint = p;
      this.actorID = e.actorID;
      return true;
    }
    return false;
  }
  onPointerMove(p, e) {
    if (this.hitPoint) {
      this.moveBy(p.subPt(this.hitPoint));
      this.hitPoint = p;
    }
  }
  onPointerUp(p) {
    this.actorID = null;
    delete this.hitPoint;
  }
  overlapBounceAxis(other, velIfAny) {
    /**
     * When this overlaps `other`, which velocity component to flip: return `'x'` for a vertical wall
     * (overlap shallower on x), `'y'` for a horizontal wall. `velIfAny` breaks ties when depths are equal.
     */
    if (!this.overlapsRect(other)) return null;
    let ox =
      Math.min(this.bottomRight().x, other.bottomRight().x) -
      Math.max(this.topLeft.x, other.topLeft.x);
    let oy =
      Math.min(this.bottomRight().y, other.bottomRight().y) -
      Math.max(this.topLeft.y, other.topLeft.y);
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return 'x';
    if (oy < ox) return 'y';
    if (velIfAny) {
      if (Math.abs(velIfAny.x) > Math.abs(velIfAny.y)) return 'x';
      if (Math.abs(velIfAny.y) > Math.abs(velIfAny.x)) return 'y';
    }
    return 'x';
  }
  overlapsRect(other) {
    /** True if this axis-aligned rect overlaps `other` (positive area overlap). */
    let a2 = this.bottomRight();
    let b2 = other.bottomRight();
    return (
      this.topLeft.x < b2.x &&
      a2.x > other.topLeft.x &&
      this.topLeft.y < b2.y &&
      a2.y > other.topLeft.y
    );
  }
  render(ctx, fillColor, borderWidth, borderColor) {
    let x = this.topLeft.x;
    let y = this.topLeft.y;
    let wdt = this.extent.x;
    let hgt = this.extent.y;
    if (fillColor) {
      ctx.fillStyle = fillColor.fillStyle;
      ctx.fillRect(x, y, wdt, hgt);
    }
    if (borderWidth > 0 && borderColor) {
      ctx.strokeStyle = borderColor.fillStyle;
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(x, y, wdt, hgt);
    }
  }
  renderOn(ctx) {
    //console.log('rendering rectangle', this._id);
    // this.render(ctx, 'white', 1, 'black')
  }
  scaleRect(spec) {
    // spec is a rectangle giving a relative placement of, eg a browser pane
    let topLeft = this.topLeft.addPt(spec.topLeft.scaleBy(this.extent));
    let extent = this.extent.scaleBy(spec.extent);
    return topLeft.extent(extent);
  }
  setBounds(rect) {
    this.topLeft = rect.topLeft;
    this.extent = rect.extent;
  }
  top() {
    return this.topLeft.y;
  }
  topRight() {
    return this.topLeft.addPt(pt(this.width(), 0));
  }
  toString() {
    return this.asString();
  }
  translatedBy(p) {
    // Synonym of movedBy
    return this.topLeft.addPt(p).extent(this.extent.copy());
  }
  union(other) {
    let tl = this.topLeft.minPt(other.topLeft);
    let br = this.bottomRight().maxPt(other.bottomRight());
    return new Rectangle(tl, br.subPt(tl));
  }
  unionPts(points) {
    // points is an array
    let tl = points[0];
    let br = points[0];
    points.forEach((each) => {
      tl = tl.minPt(each);
      br = br.maxPt(each);
    });
    return new Rectangle(tl, br.subPt(tl));
  }
  width() {
    return this.extent.x;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  SimpleTransform
// -----------------
// Translation, rotation, scale — local ↔ owner coords.
class SimpleTransform {
  constructor(trans, rot, scale) {
    this.translation = trans; // a point
    this.rotation = rot; // radians
    this.scale = scale; // a point
  }
  asString() {
    let deg = ((this.rotation * 180) / Math.PI).toFixed(1);
    let s = 'trans: ' + this.translation.asString() + '; rot: ' + deg + '°';
    let sx = this.scale && this.scale.x !== undefined ? this.scale.x : 1;
    let sy = this.scale && this.scale.y !== undefined ? this.scale.y : 1;
    if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) {
      s += '; scale: ' + this.scale.asString();
    }
    return s;
  }
  copy() {
    return new SimpleTransform(this.translation, this.rotation, this.scale);
  }
  // NOTE: Point.rotatedBy(r) turns the OPPOSITE way from ctx.rotate(r)
  // (polarAngle is measured from +y, so rotatedBy(r) is the canvas rotation
  // by -r). Rendering applies ctx.rotate(+rotation), so transformPt must use
  // rotatedBy(-rotation) and invertPt must use rotatedBy(+rotation).
  invertPt(p) {
    // owner -> local (inverse of transformPt)
    let q = p.subPt(this.translation); // undo translation
    q = q.rotatedBy(this.rotation, pt(0, 0)); // undo rotation (see NOTE above)
    // guard against degenerate scale
    let sx = this.scale.x || 1;
    let sy = this.scale.y || 1;
    return pt(q.x / sx, q.y / sy); // undo scale
  }
  transformPt(p) {
    // local -> owner
    // Match render order used in rendering:
    //   ctx.translate(tx, ty); ctx.rotate(rot); ctx.scale(sx, sy);
    // Applied to a point, that means: scale, then rotate, then translate.
    let q = p.scaleBy(this.scale); // scale about origin
    q = q.rotatedBy(-this.rotation, pt(0, 0)); // rotate about origin (see NOTE above)
    return q.addPt(this.translation); // then translate
  }
  translateBy(delta) {
    this.translation = this.translation.addPt(delta);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  StepSpec
// ----------
// One entry in a morph stepping schedule.
class StepSpec {
  constructor(morph, method, argIfAny, msTime, nextStepTimeIfAny) {
    this.stepMorph = morph;
    this.methodName = method;
    this.arg = argIfAny;
    this.stepPeriod = msTime;
    this.nextStepTime = nextStepTimeIfAny != null ? nextStepTimeIfAny : Date.now();
  }
  asString() {
    return `StepSpec(${this.stepMorph.className}.${this.methodName} every ${this.stepPeriod}ms)`;
  }
  copyForMorph(morph) {
    return new StepSpec(morph, this.methodName, this.arg, this.stepPeriod, this.nextStepTime);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  Pen
// -----
// Turtle pen: vertices → PolyLine shapes and demo spirals.
class Pen {
  constructor(startLocation) {
    this.location = startLocation ? pt(startLocation.x, startLocation.y) : pt(0, 0);
    this.startingLocation = this.location;
    this.penWidth = 2;
    this.penColor = Color.blue;
    this.fillColor = null;
    this.heading = 0;
    this.vertices = [this.location];
    this.bug = null;
  }
  fillLines(color) {
    this.fillColor = color;
    this.drawLines();
  }
  go(dist) {
    // debugger;
    this.location = this.location.addPt(ptPolar(dist, (this.heading / 180) * Math.PI));
    this.vertices.push(this.location);
    if (this.bug) this.bug.moveTo(this.location);
  }
  makeHandShape(location, color) {
    /* (Lively.addMorph(new Morph(null,
    new Pen().makeHandShape(pt(100, 100), Color.red)))) */
    this.setPenColor(color);
    this.location = location;
    this.vertices = [this.location];
    for (let i = 1; i <= 3; i++) {
      this.go(20);
      this.turn(120);
    }
    let handShape = this.polyLine();
    handShape.setColor(color);
    handShape.setBorderWidth(1);
    handShape.setBorderColor(Color.black);
    return handShape;
  }
  makeMorph() {
    let morph = new Morph(null, this.polyLine());
    return morph;
  }
  polyLine() {
    return new PolyLine(this.vertices, this.penWidth, this.penColor);
  }
  setPenColor(color) {
    this.penColor = color;
  }
  setPenWidth(size) {
    this.penWidth = size;
  }
  spiral(n, d, a) {
    this.setPenColor(Color.red);
    for (let i = 1; i <= n; i++) {
      this.go(d * i);
      this.turn(a);
    }
    return this.polyLine().setMorphOrigin(this.vertices[0]);
  }
  star(nVerts, radius, colr) {
    // Really belongs in PolyLine
    let vertices = [];
    for (let i = 0; i <= nVerts; i++) {
      let angle = ((2 * Math.PI) / nVerts) * i;
      let p = ptPolar(radius, angle);
      if (i % 2 == 0) p = p.scaleBy(0.39);
      vertices.push(p.addPt(this.location));
    }
    return new PolyLine(vertices, 2, Color.black).setMorphOrigin(pt(0, 0));
  }
  turn(degrees) {
    this.heading += degrees;
    if (this.bug) this.bug.setHeading(this.heading);
  }
  withBug(emoji) {
    let morph;
    if (bugImage && bugImage.instanceOf && bugImage.instanceOf(EmojiMorph)) {
      morph = new EmojiMorph(bugImage._emojiName, bugImage._emojiSize);
      morph.transform.scale = pt(0.5, 0.5);
    } else {
      let size = 32;
      let canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      let ctx = canvas.getContext('2d');
      ctx.font = size + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji || '🐞', size / 2, size / 2);
      morph = new ImageMorph(new ImageShape(canvas));
    }
    morph.moveTo(this.location);
    morph.setHeading(this.heading);
    Lively.addMorph(morph);
    this.bug = morph;
    return this;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +--------------------+
// |  Colors and Style  |
// +--------------------+
// Color model, HSV, style snapshots, and StylePanel paint helpers.

function styleColorNames() {
  return ['none', 'black', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'cyan'];
}
function colorByStyleName(name) {
  if (!name || name === 'none') return null;
  return Color[name] ? Color[name].copy() : Color.gray.copy();
}
function baseColorFromPaint(paint) {
  if (!paint) return null;
  if (paint.r != null && paint.g != null && paint.b != null) return paint.copy();
  let fs = paint.fillStyle;
  if (!fs) return null;
  let m = fs.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return new Color(parseInt(m[1], 10) / 255, parseInt(m[2], 10) / 255, parseInt(m[3], 10) / 255);
}
function colorAlphaFromPaint(paint) {
  if (!paint) return 1;
  if (paint.r != null && paint.g != null && paint.b != null) return 1;
  let fs = paint.fillStyle;
  if (!fs) return 1;
  let m = fs.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
  if (m) return Math.min(1, Math.max(0, parseFloat(m[1])));
  return 1;
}
function paintWithAlpha(color, alpha) {
  if (!color) return null;
  let a = alpha != null ? alpha : 1;
  if (a >= 0.999) return color.copy();
  return color.withAlpha(a);
}
function hsvToColor(h, s, v) {
  let hh = ((h % 1) + 1) % 1;
  let ss = Math.min(1, Math.max(0, s));
  let vv = Math.min(1, Math.max(0, v));
  let i = Math.floor(hh * 6);
  let f = hh * 6 - i;
  let p = vv * (1 - ss);
  let q = vv * (1 - f * ss);
  let t = vv * (1 - (1 - f) * ss);
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0:
      r = vv;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = vv;
      b = p;
      break;
    case 2:
      r = p;
      g = vv;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = vv;
      break;
    case 4:
      r = t;
      g = p;
      b = vv;
      break;
    default:
      r = vv;
      g = p;
      b = q;
  }
  return new Color(r, g, b);
}
function styleNameForColor(color) {
  if (!color) return 'none';
  let base = baseColorFromPaint(color);
  if (!base) return 'none';
  for (let i = 1; i < styleColorNames().length; i++) {
    let name = styleColorNames()[i];
    let c = Color[name];
    if (
      c &&
      Math.abs(c.r - base.r) < 0.02 &&
      Math.abs(c.g - base.g) < 0.02 &&
      Math.abs(c.b - base.b) < 0.02
    )
      return name;
  }
  return 'gray';
}
function styleSnapshotFromMorph(morph) {
  let sh = morph && morph.shape;
  if (!sh)
    return { fillColor: null, fillAlpha: 1, borderColor: null, borderAlpha: 1, borderWidth: 0 };
  return {
    fillColor: baseColorFromPaint(sh.fillColor),
    fillAlpha: colorAlphaFromPaint(sh.fillColor),
    borderColor: baseColorFromPaint(sh.borderColor),
    borderAlpha: colorAlphaFromPaint(sh.borderColor),
    borderWidth: roundLineWidth(sh.borderWidth != null ? sh.borderWidth : 0),
  };
}
function morphLineStyleIsBorder(morph) {
  let sh = morph && morph.shape;
  if (!sh) return false;
  if (sh.className === 'PolyLine' || morph.className === 'LineMorph') return false;
  if (sh.className === 'Ellipse') return true;
  if (sh.className === 'Shape') return true;
  return false;
}
function morphDefaultLineWidth(morph) {
  return 2;
}
function roundLineWidth(width) {
  return Math.round(width * 10) / 10;
}
function lineWidthCaptionText(width) {
  let w10 = roundLineWidth(width != null ? width : 0);
  let s = w10 % 1 === 0 ? '' + w10 : w10.toFixed(1);
  return 'line width = ' + s;
}
function copyStyleSnapshot(snap) {
  return {
    fillColor: snap.fillColor ? snap.fillColor.copy() : null,
    fillAlpha: snap.fillAlpha != null ? snap.fillAlpha : 1,
    borderColor: snap.borderColor ? snap.borderColor.copy() : null,
    borderAlpha: snap.borderAlpha != null ? snap.borderAlpha : 1,
    borderWidth: snap.borderWidth != null ? snap.borderWidth : 0,
  };
}
function colorsEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a.r - b.r) < 0.02 && Math.abs(a.g - b.g) < 0.02 && Math.abs(a.b - b.b) < 0.02;
}
function styleSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  if (!colorsEqual(a.fillColor, b.fillColor)) return false;
  if (!colorsEqual(a.borderColor, b.borderColor)) return false;
  if (
    Math.abs((a.fillAlpha != null ? a.fillAlpha : 1) - (b.fillAlpha != null ? b.fillAlpha : 1)) >
    0.001
  )
    return false;
  if (
    Math.abs(
      (a.borderAlpha != null ? a.borderAlpha : 1) - (b.borderAlpha != null ? b.borderAlpha : 1),
    ) > 0.001
  )
    return false;
  return roundLineWidth(a.borderWidth) === roundLineWidth(b.borderWidth);
}
function applyStyleSnapshotToMorph(morph, snap) {
  if (!morph || !morph.shape || !snap) return;
  let fill = snap.fillColor ? paintWithAlpha(snap.fillColor, snap.fillAlpha) : null;
  let border = snap.borderColor ? paintWithAlpha(snap.borderColor, snap.borderAlpha) : null;
  let width = snap.borderWidth != null ? snap.borderWidth : 0;
  if (!border) width = 0;
  morph.setStyles(fill, width, border);
  morph.changed();
  let world = morph.world();
  if (world && world.changed) world.changed();
}

// +--------------------+
// |  Text Composition  |
// +--------------------+
// Low-level specs used by TextBox layout and selection.

//  TextCharSpec
// --------------
// Caret/selection anchor: string index + line geometry.
class TextCharSpec {
  constructor(lineNo, lineY, charX, strIx) {
    this.lineNo = lineNo;
    this.lineY = lineY;
    this.charX = charX;
    this.strIx = strIx;
  }
  asString() {
    return `spec: lineNo=${this.lineNo}, lineY=${this.lineY}, charX=${this.charX}, strIx = ${this.strIx}`;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  TextLineSpec
// --------------
// One composed line of text (array of TextCharSpec).
class TextLineSpec {
  constructor(p, ext, str) {
    this.topLeft = p;
    this.extent = ext;
    this.string = str;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +----------+
// |  Shapes  |
// +----------+
// Drawable shapes: rects, ellipses, polylines, images, text layout.

//  Shape
// -------
// Rectangle-backed drawable with border and fill.
class Shape extends Rectangle {
  constructor(shapeType, bounds, color, borderWidth, borderColor) {
    super(bounds.topLeft, bounds.extent);
    this.shapeType = shapeType;
    this.morphOrigin = bounds.topLeft; // default for, eg, rectangles
    this.setStyles(color, borderWidth, borderColor);
  }
  asString() {
    return (
      'a ' + this.className + ' (' + this.shapeType + ' at ' + this.getBounds().asString() + ')'
    );
  }
  copy(color) {
    return new Shape(
      this.shapeType,
      this.getBounds(),
      this.fillColor ? this.fillColor.copy() : null,
      this.borderWidth,
      this.borderColor ? this.borderColor.copy() : null,
    );
  }
  renderOn(ctx) {
    this.getBounds().render(ctx, this.fillColor, this.borderWidth, this.borderColor);
  }
  setBorderColor(color) {
    this.borderColor = color;
  }
  setBorderWidth(width) {
    this.borderWidth = width;
  }
  setBounds(newBounds) {
    super.setBounds(newBounds);
  }
  setColor(color) {
    this.fillColor = color;
  }
  setMorphOrigin(p) {
    this.morphOrigin = p;
    return this;
  }
  setStyles(color, borderWidth, borderColor) {
    this.fillColor = color || null;
    this.borderWidth = borderWidth || 0;
    this.borderColor = borderColor || null;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  Ellipse
// ---------
// Ellipse shape; used for line handles and round hit targets.
class Ellipse extends Shape {
  constructor(center, rn) {
    const p = center;
    const r = typeof rn === 'number' ? pt(rn, rn) : rn;
    super('Ellipse', rect(p.x - r.x, p.y - r.y, r.x * 2, r.y * 2));
    this.p = p;
    this.r = r;
    this.morphOrigin = center;
    if (!this.fillColor) this.fillColor = Color.blue;
  }
  asString() {
    return `Ellipse at ${this.p.asString()} with radius ${this.r}`;
  }
  copy() {
    let copy = new Ellipse(this.p, this.r);
    copy.setStyles(this.fillColor, this.borderWidth, this.borderColor);
    return copy;
  }
  includesPt(q) {
    let dx = (q.x - this.p.x) / this.r.x;
    let dy = (q.y - this.p.y) / this.r.y;
    return dx * dx + dy * dy <= 1;
  }
  moveBy(delta) {
    super.moveBy(delta);
    this.p = this.p.addPt(delta);
  }
  render(ctx) {
    ctx.beginPath();
    ctx.ellipse(this.p.x, this.p.y, this.r.x, this.r.y, 0, 0, Math.PI * 2);
    if (this.fillColor) {
      ctx.fillStyle = this.fillColor.fillStyle;
      ctx.fill();
    }
    if (this.borderWidth > 0 && this.borderColor) {
      ctx.lineWidth = this.borderWidth;
      ctx.strokeStyle = this.borderColor.fillStyle;
      ctx.stroke();
    }
  }
  renderOn(ctx) {
    this.render(ctx);
  }
  setBounds(bnds) {
    this.p = bnds.center();
    this.r = bnds.extent.scaleBy(0.5).maxPt(pt(0, 0));
    super.setBounds(bnds); // keep Rectangle topLeft/extent in sync so getBounds() is correct
  }
  static new(...args) {
    return new this(...args);
  }
}

//  PolyLine
// ----------
// Vertex list, optional curve/close/fill; line hit tolerance.
class PolyLine extends Shape {
  constructor(verts, width, color) {
    const bounds = PolyLine.boundsForVertices(verts, width);
    super('PolyLine', bounds, null, width, color);
    this.vertices = verts;
    this.curved = false;
    this.closed = false;
    this.arrowheads = 'none';
    this.morphOrigin = pt(0, 0);
  }
  asString() {
    return `PolyLine at ${this.topLeft.asString()} with size ${this.extent}`;
  }
  boundsForVertices(vertices, borderWidth) {
    return PolyLine.boundsForVertices(vertices, borderWidth);
  }
  static boundsForVertices(vertices, borderWidth) {
    /** Union of vertices with minimum width/height so flat lines stay hittable and setBounds never divides by zero. */
    let b = unionPts(vertices);
    let pad = Math.max(2, borderWidth != null ? borderWidth : 2);
    let wdt = b.width();
    let hgt = b.height();
    if (wdt < 1) wdt = 1;
    if (hgt < 1) hgt = pad;
    return rect(b.topLeft.x, b.topLeft.y, wdt, hgt);
  }
  copy() {
    let copy = new PolyLine([...this.vertices], this.borderWidth, this.borderColor);
    copy.setStyles(this.fillColor, this.borderWidth, this.borderColor);
    copy.curved = this.curved;
    copy.closed = this.closed;
    copy.arrowheads = this.arrowheads;
    return copy;
  }
  distanceFromPoint(vertices, closed, pt) {
    /** Shortest distance from `pt` to straight segments between vertices (chord approximation when curved). */
    if (!vertices || vertices.length < 2) return Infinity;
    let min = Infinity;
    let n = vertices.length;
    let segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      let p1 = vertices[i];
      let p2 = vertices[(i + 1) % n];
      let nearest = pt.nearestPointOnLineFrom(p1, p2);
      min = Math.min(min, pt.dist(nearest));
    }
    return min;
  }
  drawArrowhead(ctx, from, tip, size) {
    /** Draw filled arrowhead at `tip` pointing from `from`. */
    let angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    let wing = Math.PI * 0.82;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x + Math.cos(angle + wing) * size, tip.y + Math.sin(angle + wing) * size);
    ctx.lineTo(tip.x + Math.cos(angle - wing) * size, tip.y + Math.sin(angle - wing) * size);
    ctx.closePath();
    ctx.fill();
  }
  drawBezierThrough(ctx, verts, closed) {
    /** Smooth cubic Bézier through vertices (Catmull–Rom style). If `closed`, includes last→first segment. */
    if (verts.length < 2) return;
    let n = verts.length;
    ctx.moveTo(verts[0].x, verts[0].y);
    if (n === 2) {
      ctx.lineTo(verts[1].x, verts[1].y);
      if (closed) ctx.closePath();
      return;
    }
    let segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      let p0, p1, p2, p3;
      if (closed) {
        p0 = verts[(i - 1 + n) % n];
        p1 = verts[i % n];
        p2 = verts[(i + 1) % n];
        p3 = verts[(i + 2) % n];
      } else {
        p0 = verts[Math.max(0, i - 1)];
        p1 = verts[i];
        p2 = verts[i + 1];
        p3 = verts[Math.min(n - 1, i + 2)];
      }
      let cp1x = p1.x + (p2.x - p0.x) / 6;
      let cp1y = p1.y + (p2.y - p0.y) / 6;
      let cp2x = p2.x - (p3.x - p1.x) / 6;
      let cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }
  hitTolerance(borderWidth) {
    return Math.max(6, (borderWidth != null ? borderWidth : 2) * 2) + 1 + 2;
  }
  includesPt(pt) {
    if (!Rectangle.prototype.includesPt.call(this, pt)) return false;
    if (this.closed) return true;
    let tol = this.hitTolerance(this.borderWidth);
    return this.distanceFromPoint(this.vertices, this.closed, pt) <= tol;
  }
  moveBy(d) {
    super.moveBy(d); // moves the bounds
    this.vertices = this.vertices.map((vert) => vert.addPt(d));
    this.morphOrigin = this.morphOrigin.translatedBy(d);
  }
  onPointerMove(p) {
    if (this.hitPoint) {
      this.moveBy(p.subPt(this.hitPoint));
      this.hitPoint = p;
    }
  }
  recomputeBounds() {
    let b = this.boundsForVertices(this.vertices, this.borderWidth);
    this.topLeft = b.topLeft;
    this.extent = b.extent;
  }
  render(ctx) {
    let verts = this.vertices;
    if (!verts || verts.length < 1) return;
    ctx.beginPath();
    if (this.curved && verts.length > 2) {
      this.drawBezierThrough(ctx, verts, this.closed);
    } else {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      if (this.closed && verts.length > 2) ctx.closePath();
    }
    if (this.fillColor !== null) {
      ctx.fillStyle = this.fillColor.fillStyle;
      ctx.fill();
    }
    if (this.borderColor !== null) {
      ctx.lineWidth = this.borderWidth;
      ctx.strokeStyle = this.borderColor.fillStyle;
      ctx.stroke();
    }
    let ah = this.arrowheads || 'none';
    if (ah !== 'none' && verts.length >= 2) {
      let size = Math.max(6, (this.borderWidth || 2) * 4);
      ctx.fillStyle = (this.borderColor || Color.black).fillStyle;
      if (ah === 'start' || ah === 'both') this.drawArrowhead(ctx, verts[1], verts[0], size);
      if (ah === 'end' || ah === 'both')
        this.drawArrowhead(ctx, verts[verts.length - 2], verts[verts.length - 1], size);
    }
  }
  renderOn(ctx) {
    // console.log('rendering Shape', this.shapeType);
    this.render(ctx);
  }
  rotateBy(radians, pivotPt) {
    let pivot = pivotPt ? pivotPt : this.center();
    this.vertices = this.vertices.map((vert) => {
      return vert.rotatedBy(radians, pivot);
    });
  }
  setBounds(newBnds) {
    let oldBnds = this.getBounds();
    let oldCtr = oldBnds.center();
    let newCtr = newBnds.center();
    let ow = Math.max(oldBnds.width(), 0.001);
    let oh = Math.max(oldBnds.height(), 0.001);
    let scale = pt(newBnds.width() / ow, newBnds.height() / oh);
    this.vertices = this.vertices.map((vert) => {
      return vert.subPt(oldCtr).scaleBy(scale).addPt(newCtr);
    });
    super.setBounds(this.boundsForVertices(this.vertices, this.borderWidth));
  }
  static new(...args) {
    return new this(...args);
  }
}

//  ImageShape
// ------------
// Bitmap/canvas shape with alpha tight bounds.
class ImageShape extends Shape {
  constructor(imageOrSize) {
    let image = null;
    let width = 32;
    let height = 32;
    if (typeof imageOrSize === 'object' && imageOrSize !== null) {
      if (
        imageOrSize instanceof window.HTMLImageElement ||
        imageOrSize instanceof window.HTMLCanvasElement
      ) {
        image = imageOrSize;
        width = image.naturalWidth || image.width || 32;
        height = image.naturalHeight || image.height || 32;
      } else if (imageOrSize.width != null && imageOrSize.height != null) {
        width = imageOrSize.width;
        height = imageOrSize.height;
      }
    }
    const bounds = rect(0, 0, width, height);
    super('ImageShape', bounds, null, 0, null);
    this.image = image;
    this.width = width;
    this.height = height;
    this.morphOrigin = bounds.center();
  }
  alphaTightBoundsCanvas(canvas, alphaThreshold) {
    /**
     * Axis-aligned bounds of opaque pixels in canvas coordinates (origin top-left).
     * Returns null if nothing above `alphaThreshold` or canvas empty.
     */
    let cw = canvas.width;
    let ch = canvas.height;
    let thr = alphaThreshold != null ? alphaThreshold : 8;
    if (!cw || !ch) return null;
    let ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let imageData = ctx.getImageData(0, 0, cw, ch).data;
    let minX = cw;
    let minY = ch;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < ch; y++) {
      let row = y * cw * 4;
      for (let x = 0; x < cw; x++) {
        let a = imageData[row + x * 4 + 3];
        if (a > thr) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;
    return rect(minX, minY, maxX - minX + 1, maxY - minY + 1);
  }
  copy() {
    let img = this.image;
    let dup = null;
    if (img instanceof window.HTMLCanvasElement) {
      dup = document.createElement('canvas');
      dup.width = img.width;
      dup.height = img.height;
      dup.getContext('2d').drawImage(img, 0, 0);
    } else if (img) {
      dup = img;
    }
    let copy = new ImageShape(dup || { width: this.width, height: this.height });
    if (this._contentBoundsLocal) copy._contentBoundsLocal = this._contentBoundsLocal.copy();
    if (this._alphaBoundsTried) copy._alphaBoundsTried = this._alphaBoundsTried;
    return copy;
  }
  includesPt(q) {
    return this.getBounds().includesPt(q);
  }
  render(ctx) {
    let b = this.getBounds();
    if (this.image && (this.image.complete || this.image.width)) {
      ctx.drawImage(this.image, b.topLeft.x, b.topLeft.y, b.width(), b.height());
    } else {
      ctx.fillStyle = 'rgba(200,100,100,0.8)';
      ctx.fillRect(b.topLeft.x, b.topLeft.y, b.width(), b.height());
      ctx.strokeStyle = '#333';
      ctx.strokeRect(b.topLeft.x, b.topLeft.y, b.width(), b.height());
    }
  }
  renderOn(ctx) {
    this.render(ctx);
  }
  setContentBoundsFromTightCanvas(canvas) {
    let tight = this.alphaTightBoundsCanvas(canvas);
    if (tight)
      this._contentBoundsLocal = this.getBounds().topLeft.addPt(tight.topLeft).extent(tight.extent);
    return tight;
  }
  setImage(img) {
    this.image = img;
    if (img) {
      this.width = img.naturalWidth || img.width || this.width;
      this.height = img.naturalHeight || img.height || this.height;
      this.setBounds(rect(0, 0, this.width, this.height));
    }
    return this;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  TextBox
// ---------
// Multi-line editable text layout, selection, keyboard shortcuts.
class TextBox extends Shape {
  constructor(bounds, str, brk, lineHeight, fontSpec, textColr, boxColr, selColr) {
    //let bounds = p.extent(ext);
    super('TextBox', bounds, boxColr, 2, Color.black);
    this.string = str;
    this.breakChar = brk;
    this.lineHeight = lineHeight;
    this.font = fontSpec;
    this.textColor = textColr ? textColr : Color.black;
    this.boxColor = boxColr ? boxColr : null;
    this.selectionColor = selColr ? selColr : Color.green.lighter().lighter();
    this.fill = this.boxColor; // figure this out
    this.inset = pt(4, 4); // inset of active text from bounds
    this.hang = this.inset.y; // vert offset of top line from bounds
    this.setText(str);
    this.clearTyping();
    this.editorID = null;
    this.workspaceObj = {}; // used for doit and printit
  }
  acceptKeyboardInput(evt) {
    // ** Note $selStart and stop may be reversed!
    let paneDirty = !!(
      this.owner &&
      this.owner.owner &&
      typeof this.owner.owner.hasUnsavedChanges == 'function' &&
      this.owner.owner.hasUnsavedChanges()
    );
    if (paneDirty && this.editorID != null && evt.actorID !== this.editorID) return;
    if (!pasteBufferItems || !Array.isArray(pasteBufferItems))
      pasteBufferItems = ['nothing to paste'];
    if (evt.key == 'Shift') return; // redundant keyDown names
    if (evt.key == 'Control') return;
    if (evt.key == 'Alt') return;
    if (evt.key == 'Enter') {
      this.paste(String.fromCharCode(evt.keyCode));
      return;
    }
    if (evt.metaKey || evt.ctrlKey || evt.addLastKey) return this.handleKeyboardShortcuts(evt);
    if (evt.key == 'Backspace') return this.handleBackspace();
    if (evt.key == 'Escape') return this.handleEscapeKey();
    if (evt.key.startsWith('Arrow')) return this.handleArrowKeys(evt.key);
    let k = evt.key;
    if (k && k.length === 1) {
      let shiftTable = getKbdShiftTable ? getKbdShiftTable() : kbdShiftTable || {};
      let shiftChar =
        evt.shiftKey ||
        $lockKeyPressedFlag ||
        $shiftKeyPressedFlag ||
        (topLevelMorph && topLevelMorph.$shiftKeyDown);
      if (shiftChar && /^[a-z]$/.test(k)) k = k.toUpperCase();
      else if (shiftChar && shiftTable[k]) k = shiftTable[k];
      this.paste(k);
      return;
    }
    this.paste(evt.key);
  }
  asString() {
    return `TextBox[${this.string.slice(0, 4) + '...'}] at ${this.getBounds().asString()}`;
  }
  boxPath(ctx) {
    let x = this.topLeft.x;
    let y = this.topLeft.y;
    let wdt = this.extent.x;
    let hgt = this.extent.y;
    let r = this.cornerRadius != null ? this.cornerRadius : 0;
    ctx.beginPath();
    if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, wdt, hgt, r);
    else ctx.rect(x, y, wdt, hgt);
  }
  charSpecForIndex(ix) {
    let charSpec = null;
    let lineY = this.topLeft.y + this.hang;
    let lineNo = 0;
    let lineStartsLength = this.lineStarts.length;
    let nextLineStart = null;
    // console.log('charSpecForIndex ' + ix + '; lineStartslength = ' + lineStartslength);
    this.lineStarts.forEach((lineStart) => {
      if (lineNo == lineStartsLength - 1)
        nextLineStart = this.string.length + 1; // +1??
      else nextLineStart = this.lineStarts[lineNo + 1];
      if (ix >= lineStart && ix < nextLineStart) {
        let xVals = this.xValuesForLine(lineNo);
        let xInText = xVals[ix - lineStart];
        let originX = this.textDrawOriginX(lineNo);
        charSpec = new TextCharSpec(lineNo, lineY - 2, originX + xInText, ix);
      }
      lineNo += 1;
      lineY += this.lineHeight;
    });
    if (charSpec == null) return new TextCharSpec(0, 0, 0, 0);
    return charSpec;
  }
  charSpecForPt(worldPt) {
    //if (!this.includesPt(p)) return new TextCharSpec(0, 0, 0, 0);
    let p = worldPt.subPt(this.topLeft);
    let lineIndex = Math.floor((p.y - this.hang) / this.lineHeight);
    lineIndex = Math.max(lineIndex, 0);
    lineIndex = Math.min(lineIndex, Math.max(0, this.lines.length - 1));
    let lineY = this.topLeft.y + this.hang + lineIndex * this.lineHeight;
    let xVals = this.xValuesForLine(lineIndex);
    let originX = this.textDrawOriginX(lineIndex);
    let minDist = 999;
    let xBest = 0;
    let iBest = 0;
    let i = 0;
    let px = p.x - originX;
    xVals.forEach((xVal) => {
      // Find closest x-value
      if (Math.abs(xVal - px) < minDist) {
        //Find nearest character x
        xBest = xVal;
        iBest = i;
        minDist = Math.abs(xVal - px);
      }
      i++;
    });
    let strIx = this.lineStarts[lineIndex] + iBest;
    // Fudge: click right of newLine actually selects before it
    if (
      strIx > 0 &&
      (this.string.charCodeAt(strIx - 1) == 10 || this.string.charCodeAt(strIx - 1) == 13)
    )
      strIx -= 1;
    return new TextCharSpec(lineIndex, lineY, originX + xBest, strIx);
  }
  clearTyping() {
    this.$duringTyping = false;
  }
  compose() {
    this.lines = [];
    this.lineStarts = [];
    let ctx = this.getTextContext(this.font);
    let str = this.string != null ? String(this.string) : '';
    let lineStart = 0;
    let lineTopLeft = this.topLeft.addPt(this.inset);
    let lineNo = 0;
    if (str.length === 0) {
      // Empty text still occupies one line of height so caret/selection are visible.
      this.lines.push(new TextLineSpec(lineTopLeft, pt(this.extent.x, this.lineHeight), ''));
      this.lineStarts.push(0);
      return lineTopLeft.y + this.lineHeight + 2;
    }
    let inAlpha = false;
    let alphaBreak = 0;
    for (let idx = 0; idx < str.length; idx++) {
      let c = str[idx];
      let isAlpha = /^[a-zA-Z0-9]*$/.test(c);
      if (c == '\n' || c == '\r' || idx == str.length - 1) {
        let thisLine = new TextLineSpec(
          lineTopLeft,
          pt(this.extent.x, this.lineHeight),
          str.slice(lineStart, idx + 1),
        );
        this.lines.push(thisLine);
        this.lineStarts.push(lineStart);
        lineNo++;
        lineTopLeft = lineTopLeft.addPt(pt(0, this.lineHeight));
        lineStart = idx + 1;
      } else if (!this.noBreak) {
        let maybeLine = str.slice(lineStart, idx + 1);
        let metrics = ctx.measureText(maybeLine);
        if (metrics.width >= this.extent.x) {
          let thisLine = new TextLineSpec(
            lineTopLeft,
            pt(this.extent.x, this.lineHeight),
            str.slice(lineStart, alphaBreak),
          );
          this.lines.push(thisLine);
          this.lineStarts.push(lineStart);
          lineNo++;
          lineTopLeft = lineTopLeft.addPt(pt(0, this.lineHeight));
          lineStart = alphaBreak;
        }
        if (!inAlpha && isAlpha) {
          alphaBreak = idx;
          inAlpha = true;
        }
        inAlpha = isAlpha;
      }
    }
    return lineTopLeft.y + 2;
  }
  copy() {
    let copy = new TextBox(
      this.getBounds().copy(),
      this.string,
      this.breakChar,
      this.lineHeight,
      this.font,
      this.textColor,
      this.boxColor,
      this.selectionColor,
    );
    return copy;
  }
  extendSelectionTo(p) {
    let spec = this.charSpecForPt(p);
    if (this.$shiftAnchorIx != null) {
      let a = this.$shiftAnchorIx;
      let b = spec.strIx;
      this.$selStart = this.charSpecForIndex(Math.min(a, b));
      this.$selStop = this.charSpecForIndex(Math.max(a, b));
    } else {
      this.$selStop = spec;
    }
    // console.log("After extendSelectionTo" + spec.asString());
  }
  finSelection() {
    this.ensureSelectionSpecs();
    this.$shiftAnchorIx = null;
    //  If we were selecting backward, now rectify so $selStart < $selStop
    if (this.$selStart.strIx > this.$selStop.strIx) {
      let swap = this.$selStart;
      this.$selStart = this.$selStop;
      this.$selStop = swap;
    }
    // A chance to notice null selections for selectWord
    if (this.$selStart.strIx == this.$selStop.strIx) {
      if (this.$priorNullSelection == this.$selStop.strIx) this.handleSelectWord();
      else this.$priorNullSelection = this.$selStop.strIx;
    } else {
      this.$priorNullSelection = -1;
    }
    this.clearTyping();
  }
  getText() {
    return this.string;
  }
  getTextContext(font) {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    return ctx;
  }
  handleArrowKeys(key) {
    this.ensureSelectionSpecs();
    let leftIx = this.$selStart.strIx;
    let rightIx = this.$selStop.strIx;
    if (key == 'ArrowLeft') {
      this.$selStart = this.charSpecForIndex(leftIx - 1);
      this.$selStop = this.charSpecForIndex(leftIx - 1);
      return;
    }
    if (key == 'ArrowRight') {
      this.$selStart = this.charSpecForIndex(rightIx + 1);
      this.$selStop = this.charSpecForIndex(rightIx + 1);
      return;
    }
    if (key == 'ArrowUp') return;
    if (key == 'ArrowDown') return;
  }
  handleBackspace() {
    // backspace
    this.ensureSelectionSpecs();
    if (this.selectedTextString().length > 0)
      this.paste(''); // first BS deletes
    else {
      if (this.$selStart.strIx >= 1) {
        // subsequent BS deletes backwards
        this.setSelectionRange([this.$selStart.strIx - 1, this.$selStart.strIx - 1]);
        this.paste('');
      }
    }
    return;
  }
  handleEscapeKey(evt) {
    // Typing ESC selects everything since typing started
    // -- handy if your next action is to hit ctrl-F to search for it
    // $selStop is already at the end of type-in
    this.ensureSelectionSpecs();
    if (this.$stringPutIn == null) return;
    this.$selStart = this.charSpecForIndex(this.$selStop.strIx - this.$stringPutIn.length);
  }
  handleKeyboardShortcuts(evt) {
    this.ensureSelectionSpecs();
    let k = evt.key && evt.key.length === 1 ? evt.key.toLowerCase() : evt.key;
    if ('dacxvzgdspf'.indexOf(k) < 0) return; // so as to not prevent default for some useful cases??
    if (k == 'a') this.setSelectionRange([0, this.string.length - 1]); // SELECT ALL
    if (k == 'c') {
      // COPY
      let copied = this.selectedTextString();
      addPasteBufferItem(copied);
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(copied).catch(() => {});
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    if (k == 'x') {
      addPasteBufferItem(this.selectedTextString()); // Cut
      this.paste('');
    }
    if (k == 'v') {
      this.paste(latestPasteBufferItem()); // Paste
    }
    if (k == 'z') this.undoReplacement(); // Undo
    if (k == 'g') this.redoReplacement(); // aGain
    if (k == 'f') {
      // FIND — avoid an empty throwaway panel when there are no hits
      let term = this.selectedTextString();
      let hits = methodsContaining(term);
      if (!hits || hits.length === 0) {
        // (was `let pt = ... : pt(120, 120)` — the local `pt` shadowed the global
        //  pt() and referenced itself in its own initializer: a TDZ ReferenceError
        //  whenever the pointer location was unknown.)
        let at = getPointerLocation() ? getPointerLocation().copy() : pt(120, 120);
        showFindNoMatchesMenu(Lively, at, term);
      } else {
        Lively.addMorph(
          new MethodListPanel(null, hits, null, 'Occurrences of "' + term + '"', term),
        );
      }
    }
    if (k == 's') {
      // SAVE (eval all)
      if (this.localStorageKey) {
        storageSetItem(this.localStorageKey, this.string);
      } else {
        noteMethodChanges(this.string);
        this.wsEval.call(this.workspaceObj, this.string);
      }
      if (typeof this.onTextSaved === 'function') this.onTextSaved(this);
    }
    if (k == 'd') {
      // DO IT
      this.wsEval.call(this.workspaceObj, this.selectedTextString());
    }
    if (k == 'p') {
      // PRINT IT
      let selA = this.$selStart.strIx;
      let selB = this.$selStop.strIx;
      let start = Math.min(selA, selB);
      let end = Math.max(selA, selB); // end is exclusive
      let evalThing = this.wsEval.call(this.workspaceObj, this.string.slice(start, end));
      if (_evalJustFailed) return;
      let ins = ' ==> ' + this.printitString(evalThing);
      // Save undo state so ctrl-Z can restore both string and selection.
      this.$printitUndo = {
        prefix: this.string.slice(0, end),
        suffix: this.string.slice(end),
        selA: start,
        selB: end,
      };
      this.string = this.$printitUndo.prefix + ins + this.$printitUndo.suffix;
      let bottomY = this.compose();
      this.extent.y = bottomY - this.topLeft.y;
      // Move caret to after inserted text.
      let caretIx = end + ins.length;
      this.$selStart = this.$selStop = this.charSpecForIndex(caretIx);
      this.clearTyping();
    }
    evt.preventDefault();
    evt.stopPropagation();
  }
  handleSelectWord() {
    // A chance to notice null selections for selectWord
    //  console.log('handling select word at ' + this.$selStart.strIx);
    // debugger;
    this.ensureSelectionSpecs();
    let pair = this.selectWord(this.string, this.$selStart.strIx);
    this.setSelectionRange(pair);
  }
  noteReplacement(str) {
    // Copied logic of paste() to save state
    this.ensureSelectionSpecs();
    if (this.$duringTyping) {
      this.$stringPutIn += str;
      return;
    }
    // New edit makes any prior printit undo irrelevant.
    this.$printitUndo = null;
    let startStrix = this.$selStart.strIx;
    let stopStrix = this.$selStop.strIx;
    this.$stringTakenOut = this.string.slice(startStrix, stopStrix);
    this.$stringPutIn = str.slice(0);
    this.$duringTyping = true;
  }
  paste(str) {
    // Paste the string over the current selection
    this.noteReplacement(str); // copied logic to save state
    let before = this.string.slice(0, this.$selStart.strIx);
    let after = this.string.slice(this.$selStop.strIx, this.string.length);
    this.string = before + str + after;
    let bottomY = this.compose();
    this.extent.y = bottomY - this.topLeft.y;
    this.$selStart = this.$selStop = this.charSpecForIndex(this.$selStart.strIx + str.length);
  }
  printitString(obj) {
    if (obj === undefined) return 'undefined';
    if (obj === null) return 'null';
    if (obj.toString && obj.toString !== Object.prototype.toString) return obj.toString();
    if (obj.asString) return obj.asString();
    return '' + obj;
  }
  redoReplacement(str) {
    // The selection is at the end of last replacement.  We simply have to
    // find the next occurrence of $stringTakenOut, extend the selection
    // from there to the end of $stringTakenOut, and call paste ($stringPutIn)
    this.ensureSelectionSpecs();
    if (this.$stringTakenOut == null || this.$stringPutIn == null) return;
    let nextIx = this.string.indexOf(this.$stringTakenOut, this.$selStart.strIx);
    if (nextIx < 0) return;
    this.$selStart = this.charSpecForIndex(nextIx);
    this.$selStop = this.charSpecForIndex(nextIx + this.$stringTakenOut.length);
    this.$duringTyping = false; // so we don't grow $stringPutIn
    this.paste(this.$stringPutIn);
  }
  render(ctx) {
    ctx.save();
    this.boxPath(ctx);
    if (this.boxColor) {
      ctx.fillStyle = this.boxColor.fillStyle;
      ctx.fill();
    }
    if (this.borderWidth > 0 && this.borderColor) {
      ctx.strokeStyle = this.borderColor.fillStyle;
      ctx.lineWidth = this.borderWidth;
      ctx.stroke();
    }
    ctx.clip(); // clip to this rectangle
    // -- turn dropshadows off for the text part of this render
    ctx.shadowColor = 'transparent'; //
    ctx.shadowBlur = 0; //
    ctx.shadowOffsetX = 0; //
    ctx.shadowOffsetY = 0; //
    ctx.fillStyle = this.textColor.fillStyle;
    ctx.font = this.font;
    ctx.textBaseline = 'hanging';
    let lineY = this.topLeft.y + this.hang;
    let nLines = this.lines.length;
    if (this.verticallyCenterSingleLine && nLines === 1) {
      let nudge = this.verticalNudge != null ? this.verticalNudge : 0;
      lineY = this.topLeft.y + Math.max(0, (this.extent.y - this.lineHeight) / 2) + nudge;
    }
    for (let lineNo = 0; lineNo < nLines; lineNo++) {
      ctx.fillStyle = this.selectionColor.fillStyle;
      // *** move this all to a helper function renderSelection()
      let selY = lineY - 2; // selection looks better a bit higher
      if (
        !this.disableSelectionRendering &&
        !this.noMenuLineHighlight &&
        lineNo == this.$selectedLineIndex - 1
      ) {
        // line selection for lists and menus
        ctx.fillRect(this.topLeft.x, selY, this.extent.x, this.lineHeight);
      }
      if (!this.disableSelectionRendering && !this.noMenuLineHighlight && this.$selStart != null) {
        // character selection for editing - egad...
        let spec1 = this.$selStart;
        let spec2 = this.$selStop;
        // Flip stop and start if selection was drawn backwards
        if (
          spec1.lineNo > spec2.lineNo ||
          (spec1.lineNo == spec2.lineNo && spec1.charX > spec2.charX)
        ) {
          spec1 = this.$selStop;
          spec2 = this.$selStart;
        }
        if (spec1.charX < 1) spec1.charX = 1; // Selection was overwriting border??
        if (spec2.charX < 1) spec2.charX = 1;
        if (lineNo == spec1.lineNo) {
          if (lineNo == spec2.lineNo) {
            // starts and ends on this line
            let hairline = spec2.charX - spec1.charX == 0 ? 2 : 0; // show null selection
            ctx.fillRect(
              spec1.charX + this.topLeft.x,
              selY,
              spec2.charX - spec1.charX + hairline,
              this.lineHeight,
            );
          } else {
            // starts here but continues
            ctx.fillRect(
              spec1.charX + this.topLeft.x,
              selY,
              this.extent.x - spec1.charX,
              this.lineHeight,
            );
          }
        } else {
          if (lineNo > spec1.lineNo) {
            if (lineNo == spec2.lineNo) {
              // starts above and ends on this line
              ctx.fillRect(this.topLeft.x, selY, spec2.charX, this.lineHeight);
            } else {
              if (lineNo < spec2.lineNo) {
                // starts above and continues
                ctx.fillRect(this.topLeft.x, selY, this.extent.x, this.lineHeight);
              }
            }
          }
        }
      }
      ctx.fillStyle = this.textColor.fillStyle;
      let padL = this.inset != null ? this.inset.x : 2;
      let textX = this.topLeft.x + padL;
      if (this.centerGlyph && this.lines[lineNo] && this.lines[lineNo].string) {
        let mctx = this.getTextContext(this.font);
        let tw = mctx.measureText(this.lines[lineNo].string).width;
        textX = this.topLeft.x + (this.extent.x - tw) / 2;
      }
      ctx.fillText(this.lines[lineNo].string, textX, lineY);
      lineY += this.lineHeight;
    }
    if (this._unsavedInnerBorder) {
      let borderColor = Color.red;
      let morph = this.morph || null;
      let world = morph && morph.world ? morph.world() : null;
      let hand = world && world.handForID ? world.handForID(this.editorID) : null;
      let handColor = hand && hand.handColor ? hand.handColor() : null;
      if (handColor && handColor.fillStyle) borderColor = handColor;
      ctx.strokeStyle = borderColor.fillStyle;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        this.topLeft.x + 1,
        this.topLeft.y + 1,
        Math.max(0, this.extent.x - 2),
        Math.max(0, this.extent.y - 2),
      );
    }
    ctx.restore();
  }
  renderOn(ctx) {
    // console.log('rendering Shape', this.shapeType);
    this.render(ctx);
  }
  selectedTextString() {
    if (this.$selectedLineIndex > 0) return this.lines[this.$selectedLineIndex - 1].string;
    if (this.$selStart != null) return this.string.slice(this.$selStart.strIx, this.$selStop.strIx);
    return null;
  }
  selectLineAt(p) {
    // Special case: numeric 0 clears the selection
    if (p === 0) return (this.$selectedLineIndex = 0);
    if (!this.includesPt(p)) return (this.$selectedLineIndex = 0);
    // Note line index is 1...N; 0 means no selection
    this.$selectedLineIndex = Math.floor((p.y - (this.topLeft.y + this.hang)) / this.lineHeight + 1);
  }
  selectSearchString(str) {
    // Private method for use in search browsers
    let ix = this.string.toLowerCase().indexOf(str.toLowerCase());
    if (ix < 0) return;
    this.setSelectionRange([ix, ix + str.length - 1]);
  }
  selectWord(str, i1) {
    // Selection caret before char i1
    if (!str) return i1;
    // Dan's super bracket matching feature
    if (i1 == 0 || i1 == str.length) return [0, str.length - 1]; // select entire string
    let rightBrackets = '*)}]>\'"`';
    let leftBrackets = '*({[<\'"`';
    function isWhiteSpace(c) {
      return c === '\t' || c === ' ';
    }
    function isAlpha(s) {
      let regEx = /^[a-zA-Z0-9\-]+$/;
      return (s || '').match(regEx);
    }
    function periodWithDigit(c, prev) {
      // return true iff c is a period and prev is a digit
      if (c != '.') return false;
      return '0123456789'.indexOf(prev) >= 0;
    }
    function matchBrackets(str, chin, chout, start, dir) {
      let i = start;
      let depth = 1;
      while (dir < 0 ? i - 1 >= 0 : i + 1 < str.length) {
        i += dir;
        if (str[i] == chin && chin != chout) depth++;
        if (str[i] == chout) depth--;
        if (depth == 0) return i;
      }
      return i;
    }
    function findLine(str, start, dir, endChar) {
      // start points to a CR or LF (== endChar)
      let i = start;
      while (dir < 0 ? i - 1 >= 0 : i + 1 < str.length) {
        i += dir;
        if (str[i] == endChar) return dir > 0 ? [start, i] : [i + 1, start];
      }
      return dir > 0 ? [start + 1, str.length - 1] : [0, start];
    }
    let i2 = i1 - 1;
    if (i1 > 0) {
      // look left for open backets
      if (str[i1 - 1] == '\n' || str[i1 - 1] == '\r') {
        return findLine(str, i1, -1, str[i1]);
      }
      let i = leftBrackets.indexOf(str[i1 - 1]);
      if (str[i1 - 1] == '*' && (i1 - 2 < 0 || str[i1 - 2] != '/')) i = -1; // spl check for /*
      if (i >= 0) {
        let i2 = matchBrackets(str, leftBrackets[i], rightBrackets[i], i1 - 1, 1);
        return [i1, i2 - 1];
      }
    }
    if (i1 < str.length) {
      // look right for close brackets
      if (str[i1] == '\n' || str[i1] == '\r') return findLine(str, i1, -1, str[i1]);
      let i = rightBrackets.indexOf(str[i1]);
      if (str[i1] == '*' && (i1 + 1 >= str.length || str[i1 + 1] != '/')) i = -1; // spl check for */
      if (i >= 0) {
        i1 = matchBrackets(str, rightBrackets[i], leftBrackets[i], i1, -1);
        return [i1 + 1, i2];
      }
    }
    // is a '//' left of me?
    if (str[i1 - 1] === '/' && str[i1 - 2] === '/') {
      while (i2 + 1 < str.length && str[i2 + 1] !== '\n' && str[i2 + 1] !== '\r') {
        i2++;
      }
      return [i1, i2];
    }
    // inside of whitespaces?
    let myI1 = i1;
    let myI2 = i2;
    while (myI1 - 1 >= 0 && isWhiteSpace(str[myI1 - 1])) myI1--;
    while (myI2 < str.length && isWhiteSpace(str[myI2 + 1])) myI2++;
    if (myI2 - myI1 >= 1) return [myI1, myI2];
    let prev = i1 < str.length ? str[i1] : '';
    while (i1 - 1 >= 0 && (isAlpha(str[i1 - 1]) || periodWithDigit(str[i1 - 1], prev))) {
      prev = str[i1 - 1];
      i1--;
    }
    while (i2 + 1 < str.length && (isAlpha(str[i2 + 1]) || periodWithDigit(str[i2 + 1], prev))) {
      prev = str[i2 + 1];
      i2++;
    }
    return [i1, i2];
  }
  setBounds(newBounds) {
    super.setBounds(newBounds);
    let savedMenuLine = null;
    if (this.$selectedLineIndex > 0 && this.lines && this.lines.length >= this.$selectedLineIndex) {
      savedMenuLine = dropNewline(this.lines[this.$selectedLineIndex - 1].string);
    }
    let bottomY = this.compose();
    this.extent.y = bottomY - this.topLeft.y;
    if (savedMenuLine) this.setSelectedTextString(savedMenuLine);
  }
  setEvalContext(obj) {
    // if not null, this context will be used by do-it and print-it
    this.evalContext = obj;
  }
  setLocalStorageKey(key) {
    // Back door for localStoarage access
    this.localStorageKey = key;
  }
  setNoBreak(ifSo) {
    // Call with true to suppress line breaks
    this.noBreak = ifSo;
  }
  setNullSelection() {
    this.$selectedLineIndex = 0; // means no selection (for menus, lists, etc)
    // Prefer a real charSpec so empty panes still get full lineheight for caret/selection.
    let spec =
      this.lines && this.lines.length > 0
        ? this.charSpecForIndex(0)
        : new TextCharSpec(0, this.topLeft.y + this.hang, this.inset ? this.inset.x : 0, 0);
    this.$selStart = this.$selStop = spec;
    // Must not equal caret index 0 or the first click at doc start looks like a repeat click and runs selectWord.
    this.$priorNullSelection = -1;
  }
  ensureSelectionSpecs() {
    // Selection is per-user ($-state) and lost on reload; restore a null selection on demand.
    if (this.$selStart == null || this.$selStop == null) this.setNullSelection();
  }
  setSelectedTextString(str) {
    let idx = 0;
    this.lines.forEach((line, index) => {
      if (dropNewline(line.string) == str) idx = index;
    });
    return (this.$selectedLineIndex = idx + 1);
  }
  setSelectionRange(pair) {
    this.$selStart = this.charSpecForIndex(pair[0]);
    this.$selStop = this.charSpecForIndex(pair[1] + 1);
    // console.log('setSelectionRange() = ' + pair)
    this.$priorNullSelection = -1;
  }
  setText(str) {
    this.string = str != null ? String(str) : '';
    let bottomY = this.compose();
    this.extent.y = bottomY - this.topLeft.y;
    this.setNullSelection();
  }
  setWorkspaceObj(wsObj) {
    // Arrange it so that evals in this text will have access to wsObj)
    this.workspaceObj = wsObj;
  }
  shiftExtendSelectionToPointer(p) {
    /** Shift-click: extend selection from the end farthest from pointer; empty selection anchors at index (right side). */
    let clickSpec = this.charSpecForPt(p);
    let ci = clickSpec.strIx;
    if (!this.$selStart || !this.$selStop) {
      this.startSelectionAt(p);
      return;
    }
    let a = Math.min(this.$selStart.strIx, this.$selStop.strIx);
    let b = Math.max(this.$selStart.strIx, this.$selStop.strIx);
    if (a === b) {
      this.$shiftAnchorIx = a;
      this.$selStart = this.charSpecForIndex(Math.min(a, ci));
      this.$selStop = this.charSpecForIndex(Math.max(a, ci));
      return;
    }
    let distA = Math.abs(ci - a);
    let distB = Math.abs(ci - b);
    let farIx;
    if (distA < distB) farIx = b;
    else if (distB < distA) farIx = a;
    else farIx = b;
    this.$shiftAnchorIx = farIx;
    this.$selStart = this.charSpecForIndex(Math.min(farIx, ci));
    this.$selStop = this.charSpecForIndex(Math.max(farIx, ci));
  }
  startSelectionAt(p) {
    this.$selectedLineIndex = 0; // list/menu line mode must not override char selection in editors
    let spec = this.charSpecForPt(p);
    this.$selStart = this.$selStop = spec;
    this.$shiftAnchorIx = null;
    // console.log("After startSelectionAt" + spec.asString());
  }
  textDrawOriginX(lineNo) {
    let padL = this.inset != null ? this.inset.x : 2;
    if (this.centerGlyph && this.lines && this.lines[lineNo] && this.lines[lineNo].string) {
      let mctx = this.getTextContext(this.font);
      if (!mctx) return padL;
      let tw = mctx.measureText(this.lines[lineNo].string).width;
      return Math.max(0, (this.extent.x - tw) / 2);
    }
    return padL;
  }
  undoReplacement() {
    if (this.$printitUndo) {
      let u = this.$printitUndo;
      this.$printitUndo = null;
      this.string = u.prefix + u.suffix;
      let bottomY = this.compose();
      this.extent.y = bottomY - this.topLeft.y;
      this.setSelectionRange([u.selA, u.selB - 1]);
      this.clearTyping();
      return;
    }
    // Recreate selection range
    this.ensureSelectionSpecs();
    if (this.$stringPutIn == null || this.$stringTakenOut == null) return;
    this.$selStart = this.charSpecForIndex(this.$selStop.strIx - this.$stringPutIn.length);
    this.paste(this.$stringTakenOut);
    this.$selStart = this.charSpecForIndex(this.$selStop.strIx - this.$stringTakenOut.length);
    this.clearTyping();
  }
  wsEval(str) {
    _lastEvalSource = str;
    let label = 'evaluate: ' + truncateString(str, 80);
    if (this.evalContext)
      return evaluateWithErrorRecovery(() => this.evalContext.evalInMe(str), label);
    return evaluateWithErrorRecovery(() => eval(str), label);
  }
  xValuesForLine(lineNo) {
    // NOTE:  this should receive a line (this.lines.at(lineNo)), insteaad of lineNo
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.font = this.font;
    let xVals = [0.0];
    if (lineNo > this.lines.length - 1) return xVals;
    let txt = this.lines[lineNo].string;
    //let s = 'x-values for line ' + lineNo + ': ';
    for (let i = 0; i < txt.length; i++) {
      let metrics = ctx.measureText(txt.slice(0, i + 1));
      //s += ', ' + metrics.width.toFixed(1);
      xVals.push(metrics.width);
    }
    //console.log(s);
    return xVals;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +---------+
// |  Morph  |
// +---------+
// Base morph: tree, transforms, drag/drop, focus, stepping.

function paneMenuIsFrontmostForPanel(world, panelMorph) {
  /** True when the world's front morph is a selection pane menu owned by a scroll pane in `panelMorph`. */
  if (!world || !panelMorph || !world.submorphs || world.submorphs.length === 0) return false;
  let front = world.submorphs.at(-1);
  if (!front || front.className !== 'MenuMorph' || !front.isFleetingMenu) return false;
  let pane = front._paneMenuOwnerScrollPane;
  if (!pane) return false;
  let m = pane;
  while (m && m !== world) {
    if (m === panelMorph) return true;
    m = m.owner;
  }
  return false;
}
function keyboardFocusBelongsToScrollPane(world, scrollPane) {
  /** True when `world.$keyboardFocus` (per-user) is the content morph (or a submorph of it) for `scrollPane`. */
  let f = world && world.$keyboardFocus;
  if (!f || !scrollPane || !scrollPane.contentPane) return false;
  let want = scrollPane.contentPane;
  let x = f;
  while (x) {
    if (x === want) return true;
    x = x.owner;
  }
  return false;
}
function textPaneWithKeyboardFocus(world) {
  /** TextPane on the owner chain of `world.$keyboardFocus` (per-user), if any. */
  let f = world && world.$keyboardFocus;
  if (!f) return null;
  let m = f;
  while (m && m !== world) {
    if (m.instanceOf && m.instanceOf(TextPane)) return m;
    m = m.owner;
  }
  return null;
}
function shouldShowOnScreenKeyboardForWorld(world) {
  /** True when OSK should track keyboard focus in a TextPane. */
  if (!world || !$useOnScreenKbd) return false;
  let pane = textPaneWithKeyboardFocus(world);
  if (!pane) return false;
  return keyboardFocusBelongsToScrollPane(world, pane);
}
function morphIsUnderOnScreenKeyboard(morph) {
  /** True if `morph` is the OSK or a submorph of it (clicks must not clear keyboardFocus). */
  let kb = $onScreenKeyboardMorph;
  if (!kb || !morph || !kb.world()) return false;
  let x = morph;
  while (x) {
    if (x === kb) return true;
    x = x.owner;
  }
  return false;
}
function clearKeyboardFocusUnlessTypingOrOsk(morph) {
  /** Clear world keyboardFocus unless `morph` is a TextMorph or inside the OSK. Only TextMorph sets focus. Call after pointer hits this morph but no submorph consumed the event (so editable text is not underneath). */
  let world = morph.world();
  if (!world) return;
  if (morph.className === 'TextMorph') return;
  if (morphIsUnderOnScreenKeyboard(morph)) return;
  world.setKeyboardFocus(null);
}
//  Morph
// -------
// Scene-graph node: submorphs, transform, hit-testing, drag/drop.
class Morph {
  constructor(bounds, shape) {
    // If shape is omitted it will be a Rectangle
    // If bounds is omitted, it will be taken from the shape
    if (traceMe) console.log('log ', 1);
    this.owner = null; //another morph (or null in the case of a root Morph)
    this.shape = shape ? shape : new Shape('Rectangle', bounds, Color.green, 1, Color.black);
    this.shape.morph = this;
    //console.log('shape = ', this.shape.asString());
    this.bounds = this.shape.getBounds(); //a Rectangle in owner coordinates
    this.origin = this.shape.morphOrigin;
    this.transform = this.nullTransformation(); // a transform object with trans/rot/scale
    this.transform.translateBy(this.origin);
    this.shape.setBounds(this.shape.getBounds().translatedBy(this.origin.negated()));
    this.submorphs = []; // array of Morphs in Z-order -- first is frontmost
    this.$steppingSpecs = [];
    this.hasChanged = true; //some call on changed() says we need to rerender
    if (traceMe) console.log('log ', 2);
  }
  acceptsDroppingMorphs() {
    return true;
  }
  addMorph(morph) {
    return this.addMorphFront(morph);
  }
  addMorphBack(morph) {
    if (morph.owner) morph.owner.removeMorph(morph);
    if (this.submorphs == null) this.submorphs = [];
    this.submorphs.unshift(morph);
    morph.owner = this;
    morph.changed();
    this.layoutChanged();
    return morph;
  }
  addMorphFront(morph) {
    if (morph.owner) morph.owner.removeMorph(morph);
    if (this.submorphs == null) this.submorphs = [];
    this.submorphs.push(morph);
    morph.owner = this;
    morph.changed();
    this.layoutChanged();
    return morph;
  }
  addEphemeralMorph(morph) {
    /**
     * Attach `morph` as a PER-USER (ephemeral) submorph: rendered and hit-tested like
     * any submorph, drawn above the persistent ones, but never stored in the Automerge
     * document and never seen by other users. Halos and their handles live here.
     * Note it is the attachment EDGE that is ephemeral: `morph`'s own subtree (regular
     * submorphs, shape, etc.) stays ephemeral automatically because it is only
     * reachable through this $-edge. Only meant for freshly created per-user morphs —
     * attaching an already-persistent morph here would orphan it on reload (its owner
     * back-pointer would survive but this list would not).
     */
    if (morph.owner) morph.owner.removeMorph(morph);
    this.ephemeralSubmorphs().push(morph);
    morph.owner = this;
    morph.changed();
    this.layoutChanged();
    return morph;
  }
  ephemeralSubmorphs() {
    /** This morph's per-user submorph list; lazily created (after a reload, persistent morphs come back without one). */
    if (!this.$submorphs) this.$submorphs = [];
    return this.$submorphs;
  }
  allSubmorphs() {
    /** Persistent + ephemeral submorphs in DRAW order: persistent first, ephemeral on top. */
    let all = [];
    if (this.submorphs) this.submorphs.forEach((m) => all.push(m));
    if (this.$submorphs) this.$submorphs.forEach((m) => all.push(m));
    return all;
  }
  allSubmorphsTopFirst() {
    /** Persistent + ephemeral submorphs in HIT-TEST order (reverse draw order): ephemeral frontmost-first, then persistent frontmost-first. */
    let all = [];
    if (this.$submorphs) for (let i = this.$submorphs.length - 1; i >= 0; i--) all.push(this.$submorphs.at(i));
    if (this.submorphs) for (let i = this.submorphs.length - 1; i >= 0; i--) all.push(this.submorphs.at(i));
    return all;
  }
  eachSubmorph(fn) {
    /** Iterate persistent then ephemeral submorphs (draw order) without allocating a combined list. */
try {
    if (this.submorphs) this.submorphs.forEach(fn);
} catch (e) {
  console.log('boom! while iterating over persistent submorphs');
  debugger;
}
try {
    if (this.$submorphs) this.$submorphs.forEach(fn);
} catch (e) {
  console.log('boom! while iterating over local submorphs');
  debugger;
}
  }
  asString() {
    return 'a ' + this.className + ' (' + this.shape.asString() + ')';
  }
  beTopMorph() {
    // Promote my top-level ancestor to be the frontmost morph in the world
    let worldMorph = this.world();
    let m = this;
    while (m.owner && m.owner !== worldMorph) m = m.owner;
    if (m.owner === worldMorph && worldMorph.submorphs.at(-1) !== m) worldMorph.promote(m);
  }
  boundsInOwnerAfterTransform() {
    /** Axis-aligned footprint in owner space; applies scale and rotation like {@link Morph#renderOn}. */
    let local = this.localContentBounds();
    let sx = this.transform.scale.x || 1;
    let sy = this.transform.scale.y || 1;
    let rot = this.transform.rotation || 0;
    let b;
    if (Math.abs(rot) < 1e-10 && Math.abs(sx - 1) < 1e-10 && Math.abs(sy - 1) < 1e-10) {
      b = local.translatedBy(this.transform.translation);
    } else {
      let corners = [local.topLeft, local.topRight(), local.bottomRight(), local.bottomLeft()];
      let pts = corners.map((c) => this.transform.transformPt(c));
      b = unionPts(pts);
    }
    let scrollY = this.$scrollOffsetY;
    return scrollY ? b.translatedBy(pt(0, scrollY)) : b;
  }
  boundsInWorld() {
    /** Axis-aligned bounds of this morph in world coordinates. */
    let ob = this.getBounds();
    let o = this.owner;
    if (!o || o.owner == null) return ob;
    let corners = [ob.topLeft, ob.topRight(), ob.bottomRight(), ob.bottomLeft()];
    let pts = corners.map((c) => o.globalize(c));
    return unionPts(pts);
  }
  bringTopLevelPanelToFrontIfNeeded(p) {
    // If this morph is inside a buried top-level PanelMorph, bring that panel
    // to front and consume the click (caller should return true).
    let world = this.world();
    let topLevel = this;
    while (topLevel.owner && topLevel.owner !== world) topLevel = topLevel.owner;
    if (topLevel.className != 'PanelMorph' || topLevel.owner !== world) return false;
    // Simpler/stronger policy: if the panel is not globally frontmost, first click
    // only raises it; second click can act on inner controls.
    if (world.submorphs.at(-1) !== topLevel) {
      // A pane menu sitting above this panel must not eat the first text click.
      if (paneMenuIsFrontmostForPanel && paneMenuIsFrontmostForPanel(world, topLevel)) return false;
      topLevel.beTopMorph();
      return true;
    }
    return false;
  }
  changed() {
    // Means we have to redraw due to altered content
    this.hasChanged = true;
  }
  clippedBounds() {
    /** Visible bounds for halos etc.; includes transform scale/rotation. Clipped when inside a {@link ScrollPane}. */
    let b = this.boundsInOwnerAfterTransform().copy();
    if (this.owner && this.owner.instanceOf && this.owner.instanceOf(ScrollPane)) {
      b = b.intersection(this.owner.shape.getBounds());
    }
    return b;
  }
  clippedBoundsInWorld() {
    /** {@link clippedBounds} in world coordinates, intersecting every ancestor {@link ScrollPane} viewport. */
    let b = this.boundsInWorld();
    let o = this.owner;
    while (o) {
      if (o.instanceOf && o.instanceOf(ScrollPane)) {
        b = b.intersection(o.boundsInWorld());
      }
      o = o.owner;
    }
    return b;
  }
  dragFrom(p, evt) {
    this.hitPoint = p;
    this.actorID = evt.actorID;
    this.world().setPointerFocus(this);
  }
  dropOnTopMorphAt(worldDropPt, anchorLocal) {
    // Reparent under worldDropPt while preserving world position of a local anchor.
    // anchorLocal: point in this morph's local coords to keep fixed (e.g. relativize(grab)).
    // If omitted, uses shape bounds topLeft (halo grab/copy, etc.).
    let world = this.world();
    if (!world) return;
    // Find deepest accepting owner at drop point (front-most path), not just world children.
    let dropped = this;
    let walk = (ownerMorph, worldPt) => {
      let subs = ownerMorph.submorphs || [];
      for (let i = subs.length - 1; i >= 0; i--) {
        let sub = subs[i];
        if (sub === dropped) continue;
        if (
          sub.className == 'HaloMorph' ||
          sub.className == 'HaloHandle' ||
          sub.className == 'HandMorph' ||
          sub.className == 'LineVertexHandle' ||
          sub.className == 'LineMidpointHandle'
        )
          continue;
        let pInOwner = sub.owner ? sub.owner.localize(worldPt) : worldPt;
        if (!sub.includesPt(pInOwner)) continue;
        if (!sub.acceptsDroppingMorphs()) continue;
        let inner = walk(sub, worldPt);
        return inner != null ? inner : sub;
      }
      return null;
    };
    let deepest = walk(world, worldDropPt);
    let newOwner = deepest != null ? deepest : world;
    let anc = newOwner;
    while (anc) {
      if (anc === dropped) {
        newOwner = world;
        break;
      }
      anc = anc.owner;
    }
    this.reparentToOwnerPreservingWorldAnchor(newOwner, anchorLocal);
  }
  evalInMe(str) {
    // Eval in me, as for use in the debugger / TextBox workspace
    return eval(str);
  }
  forEverySubmorph(fn) {
    // Exhaustively call fn on every submorph, persistent and ephemeral, recursively
    this.eachSubmorph((sub) => {
      fn.call(this, sub);
      sub.forEverySubmorph(fn);
    });
  }
  fullBounds() {
    // Includes this morph's shape and all descendant submorph shapes.
    // Return value is in owner coordinates with this morph's full transform
    // applied (the axis-aligned footprint when rotated/scaled), so hit tests
    // against it match what's rendered.
    return this.boundsInOwnerAfterTransform();
  }
  getBounds() {
    // NOTE: does not include submorph stickouts; use {@link fullBounds} or {@link boundsInOwnerAfterTransform}.
    let b = this.shape.getBounds().translatedBy(this.transform.translation);
    let scrollY = this.$scrollOffsetY;
    return scrollY ? b.translatedBy(pt(0, scrollY)) : b;
  }
  globalize(p) {
    // local coordinates -> world
    if (this.owner == null) return p;
    let q = this.transform.transformPt(p);
    let scrollY = this.$scrollOffsetY;
    if (scrollY) q = pt(q.x, q.y + scrollY);
    return this.owner.globalize(q);
  }
  hasSubmorphs() {
    if (this.submorphs != null && this.submorphs.length > 0) return true;
    return this.$submorphs != null && this.$submorphs.length > 0;
  }
  inaHand() {
    if (this.owner == null) return false;
    if (this.owner.isaHand()) return true;
    return this.owner.inaHand();
  }
  includesPt(p) {
    // p is in owner (or world for root children) coordinates; convert to local
    return this.shape.includesPt(this.relativize(p));
  }
  inspect() {
    // Lively.submorphs.first().inspect()
    let p = new InspectorPanel(rect(500, 100, 300, 300), this);
    Lively.addMorph(p);
    p.startStepping('showSelectedValue', false, 500);
    return p;
  }
  isaHand() {
    return false;
  }
  isStepping(methodName) {
    return this.world().isSteppingMorph(this, methodName);
  }
  layoutChanged(submorph) {
    // ** code goes here
  }
  localContentBounds() {
    /** Shape + submorph stickouts in morph-local coords (before this morph's transform). */
    let b = this.shape.getBounds().copy();
    this.eachSubmorph((sub) => {
      b = b.union(sub.fullBounds());
    });
    return b;
  }
  localize(pt) {
    // world coordinates -> local
    if (this.owner == null) return this.transform.invertPt(pt);
    return this.relativize(this.owner.localize(pt));
  }
  morphCopy() {
    let copy = new Morph(this.bounds, this.shape.copy());
    copy.owner = this.owner;
    copy.transform = this.transform.copy(); // may not need to copy
    this.restartSteppingOnCopy(copy);
    copy.submorphs = this.submorphs.map((m) => m.morphCopy());
    return copy;
  }
  morphMenu() {
    /** Optional halo menu: `{ items: string[], onSelect(item, morph) }` or null. */
    return null;
  }
  moveBy(delta) {
    this.transform.translation = this.transform.translation.addPt(delta);
    if (this.bounds) this.bounds.moveBy(delta);
  }
  myOwningHand() {
    let m = this.owner;
    while (m) {
      if (m.className === 'HandMorph') return m;
      m = m.owner;
    }
    return null;
  }
  nullTransformation() {
    return new SimpleTransform(pt(0, 0), 0, pt(1, 1));
  }
  onKeyDown(evt) {
    // Mainly called by subclass.call()
    return true; // no op
  }
  onKeyUp(evt) {
    // Default: no-op; WorldMorph and focused morphs may override.
    return true;
  }
  onPointerDown(p, evt) {
    // p is in owner (or world for root) coordinates
    // Use fullBounds so protruding submorphs ("stickouts") are still hittable.
    if (!this.fullBounds().includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    let localP = this.relativize(p);
    if (effectiveMetaKey(evt)) {
      consumeSoftMetaKey();
      let maybeHit = this.world().hitMorphAt(p);
      if (maybeHit) maybeHit.showHalo();
      return false;
    }
    let eventConsumed = false;
    this.eachSubmorph((sub) => {
      // localP is in this morph's local coords, i.e. owner coords for submorphs
      // (ephemeral submorphs come last, so as the topmost layer they win the dispatch)
      if (sub.fullBounds().includesPt(localP)) eventConsumed = sub.onPointerDown(localP, evt);
    });
    if (eventConsumed) return true;
    clearKeyboardFocusUnlessTypingOrOsk(this);
    this.beTopMorph();
    if (effectiveShiftKey(evt)) {
      // shift drag means copy
      let copy = this.world().addMorph(this.morphCopy());
      copy.hitPoint = p;
      copy.actorID = evt.actorID;
      this.world().setPointerFocus(copy);
      return true; // could merge code
    }
    this.hitPoint = p;
    this.didDrag = false;
    // For nested morphs, plain drag should pick up to world on first real move.
    this._pickUpOnDrag = this.owner != null && this.owner !== this.world();
    this.actorID = evt.actorID;
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    // p is in owner coordinates
    let localP = this.relativize(p);
    // If any submorph responds, then we're done
    let eventConsumed = false;
    this.eachSubmorph((sub) => {
      // localP is in this morph's local coords, i.e. owner coords for submorphs
      if (sub.includesPt(localP)) eventConsumed = sub.onPointerMove(localP, evt);
    });
    if (eventConsumed) return true;
    if (!this.hitPoint) return false;
    let delta = p.subPt(this.hitPoint);
    if (
      this._pickUpOnDrag &&
      this.owner != null &&
      this.owner !== this.world() &&
      (delta.x !== 0 || delta.y !== 0)
    ) {
      let oldOwner = this.owner;
      let worldPrev = oldOwner.globalize(this.hitPoint);
      let worldNow = oldOwner.globalize(p);
      let deltaWorld = worldNow.subPt(worldPrev);
      let anchorLocal = this.relativize(this.hitPoint);
      this.reparentToOwnerPreservingWorldAnchor(this.world(), anchorLocal);
      this.moveBy(deltaWorld);
      this.hitPoint = worldNow;
      this._pickUpOnDrag = false;
      this.didDrag = true;
      return true;
    }
    this.moveBy(delta);
    if (delta.x !== 0 || delta.y !== 0) this.didDrag = true;
    this.hitPoint = p;
    return true;
  }
  onPointerUp(p, evt) {
    // p is in owner coordinates
    let localP = this.relativize(p);
    // If any submorph responds true, then we're done
    let eventConsumed = false;
    this.eachSubmorph((sub) => {
      // localP is in this morph's local coords, i.e. owner coords for submorphs
      if (sub.includesPt(localP)) eventConsumed = sub.onPointerUp(localP, evt);
    });
    if (eventConsumed) return true;
    let wasDrag = !!this.didDrag;
    this.actorID = null;
    this.hitPoint = null;
    this.didDrag = false;
    this._pickUpOnDrag = false;
    this.world().setPointerFocus(null);
    if (wasDrag) {
      // p is in owner coords; convert to world for drop target selection.
      let worldDropPt = this.owner ? this.owner.globalize(p) : p;
      // Keep the same local point under the cursor as at grab/drag (not bounds topLeft).
      let anchorLocal = this.relativize(p);
      this.dropOnTopMorphAt(worldDropPt, anchorLocal);
    }
    return true;
  }
  onTextBoundsChanged() {
    // to be noticeable by text containers
    if (this.owner != null) this.owner.onTextBoundsChanged();
  }
  position() {
    return this.getBounds().topLeft;
  }
  promote(submorph) {
    // Reorder to frontmost within whichever list holds it (persistent or ephemeral).
    let list = this.submorphs;
    let idx = list ? list.indexOf(submorph) : -1;
    if (idx < 0 && this.$submorphs) {
      list = this.$submorphs;
      idx = list.indexOf(submorph);
    }
    if (idx < 0) return;
    if (submorph === list.at(-1)) return; // already frontmost in its layer
    list.splice(idx, 1);
    list.push(submorph);
    this.changed();
  }
  relativize(p) {
    // owner coordinates -> local
    // $scrollOffsetY is this user's scroll offset (see ScrollPane); undo it before the shared transform.
    let scrollY = this.$scrollOffsetY;
    return this.transform.invertPt(scrollY ? pt(p.x, p.y - scrollY) : p);
  }
  remove() {
    this.stopStepping();
    this.owner.removeMorph(this);
    // this.owner = null;      // Not strictly necess and may be causing
    //               a problem of morphs losing the chain to this.world()
  }
  removeMorph(submorph) {
    deleteFromArray(this.submorphs, submorph);
    if (this.$submorphs) deleteFromArray(this.$submorphs, submorph);
    this.changed();
  }
  renderMeOn(ctx) {
    if (!this.hasChanged) return;
    ctx.beginPath();
    this.shape.renderOn(ctx);
    ctx.closePath();
  }
  renderOn(ctx) {
    this.renderMeOn(ctx);
    this.eachSubmorph((each) => {
      ctx.save();
      let pf = this.world().$pointerFocus;
      let inHand = each.inaHand();
      let haloGrabOrCopyShadow =
        pf &&
        pf.className === 'HaloHandle' &&
        ['Grab', 'Copy'].includes(pf.handleName) &&
        pf.target === each;
      if (inHand || (pf === each && each.shape.shapeType != 'TextBox') || haloGrabOrCopyShadow) {
        let owningHand = each.myOwningHand ? each.myOwningHand() : null;
        let world = this.world ? this.world() : null;
        let focusActorID = each.actorID != null ? each.actorID : $actorID;
        let focusHand =
          !owningHand && world && world.handForID ? world.handForID(focusActorID) : null;
        let handForShadow = owningHand || focusHand;
        let handColor = handForShadow && handForShadow.handColor ? handForShadow.handColor() : null;
        if (handColor && handColor.r != null && handColor.g != null && handColor.b != null) {
          let rr = Math.floor(handColor.r * 255.999);
          let gg = Math.floor(handColor.g * 255.999);
          let bb = Math.floor(handColor.b * 255.999);
          ctx.shadowColor = 'rgba(' + rr + ',' + gg + ',' + bb + ',0.45)';
        } else {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        }
        ctx.shadowBlur = 5;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;
      }
      // ctx.transform(each.getTransform);
      const tfm = each.transform;
      let scrollY = each.$scrollOffsetY;
      ctx.translate(tfm.translation.x, tfm.translation.y + (scrollY ? scrollY : 0));
      ctx.rotate(tfm.rotation);
      ctx.scale(tfm.scale.x, tfm.scale.y);
      each.renderOn(ctx);
      ctx.restore();
    });
  }
  reparentToOwnerPreservingWorldAnchor(newOwner, anchorLocal) {
    /** Reparent under newOwner while keeping anchorLocal at same world point. */
    if (!newOwner) return;
    // morphCopy() sets owner without addMorph; only skip if this morph is actually in newOwner's tree.
    if (this.owner === newOwner && newOwner.submorphs && newOwner.submorphs.indexOf(this) >= 0)
      return;
    let p = anchorLocal == null ? this.shape.getBounds().topLeft : anchorLocal;
    let anchorWorld = this.globalize(p);
    newOwner.addMorph(this); // removes from previous owner
    let ownerPt = newOwner.localize(anchorWorld);
    let rotScale = this.transform.transformPt(p).subPt(this.transform.translation);
    this.transform.translation = ownerPt.subPt(rotScale);
    this.syncBoundsFromGeometry();
    this.changed();
  }
  restartSteppingOnCopy(copy, specHook) {
    copy.$steppingSpecs = (this.$steppingSpecs || []).map((spec) => spec.copyForMorph(copy));
    copy.$steppingSpecs.forEach((spec) => {
      if (!this.isStepping(spec.methodName)) return;
      if (specHook && specHook(spec, copy)) return;
      copy.startStepping(spec.methodName, spec.arg, spec.stepPeriod, spec.nextStepTime);
    });
  }
  restyle() {
    if (!this.shape) return;
    let world = this.world();
    if (!world) return;
    let anchor = this.clippedBoundsInWorld ? this.clippedBoundsInWorld() : this.getBounds();
    let r = anchor.topRight().addPt(pt(12, 0)).extent(pt(280, 340));
    world.addMorph(new StylePanel(r, this));
  }
  rotateBy(angle) {
    this.setRotation(this.transform.rotation + angle);
  }
  setRotation(rot) {
    // Rotate about the center of the morph's shape: adjust the translation so
    // the shape center stays at the same point in owner coordinates. (The
    // transform itself always rotates about the morph's local origin.)
    let c = this.shape.getBounds().center(); // local coords
    let before = this.transform.transformPt(c);
    this.transform.rotation = rot;
    let after = this.transform.transformPt(c);
    let delta = before.subPt(after);
    this.transform.translation = this.transform.translation.addPt(delta);
    // Update the cached bounds in place, like moveBy (replacing this.bounds
    // would orphan a rect another same-frame mutation may have written to).
    if (this.bounds) this.bounds.moveBy(delta);
    this.changed();
  }
  scaleBy(scale) {
    const scalePt = typeof scale === 'number' ? pt(scale, scale) : scale;
    this.transform.scale = this.transform.scale.scaleBy(scalePt);
  }
  setBorderColor(color) {
    this.shape.setBorderColor(color);
  }
  setBorderWidth(width) {
    this.shape.setBorderWidth(width);
  }
  setBounds(rect) {
    this.transform.translation = rect.topLeft.copy();
    this.shape.setBounds(rect.movedBy(rect.topLeft.negated()));
    this.bounds = rect.copy();
  }
  setColor(color) {
    this.shape.setColor(color);
  }
  setPaneBoundsIn(newBounds) {
    Morph.prototype.setBounds.call(this, newBounds);
    // submorphs other than panes simply set bounds
  }
  setStyles(fillColor, borderWidth, borderColor) {
    this.shape.setStyles(fillColor, borderWidth, borderColor);
  }
  showHalo() {
    this.world().removeExistingHalos();
    // Per-user UI: halos never enter the Automerge document.
    this.world().addEphemeralMorph(new HaloMorph(this));
  }
  showMorphMenuAt(worldPt, optsIfAny) {
    /** Show {@link morphMenu} at a world point; returns false when there is no menu. */
    this.menuSpec = this.morphMenu();
    if (!this.menuSpec || !this.menuSpec.items || this.menuSpec.items.length === 0) return false;
    let world = this.world();
    if (!world) return false;
    let opts = optsIfAny || {};
    let items = this.menuSpec.items;
    this.menu = new MenuMorph(
      rect(worldPt.x, worldPt.y, 165, Math.max(48, 24 + items.length * 18)),
      items,
      (item) => {
        if (isMenuSeparator(item)) return;
        if (this.menuSpec.onSelect) this.menuSpec.onSelect(item, this);
        this.menu.remove();
      },
    );
    this.menu.isFleetingMenu = !!opts.fleeting;
    world.addMorph(this.menu);
    return true;
  }
  startStepping(method, argIfAny, msTime, nextStepTimeIfAny) {
    // Replace any existing step with the same method name on this morph
    this.stopStepping(method);
    let spec = new StepSpec(this, method, argIfAny, msTime, nextStepTimeIfAny);
    if (!this.$steppingSpecs) this.$steppingSpecs = [];
    this.$steppingSpecs.push(spec);
    this.world().startSteppingSpec(spec);
  }
  stopStepping(methodName) {
    if (!this.$steppingSpecs) this.$steppingSpecs = [];
    if (methodName) {
      deleteFromArrayPred(this.$steppingSpecs, (spec) => spec.methodName == methodName);
    } else {
      clearArray(this.$steppingSpecs);
    }
    this.world().stopSteppingMorph(this, methodName);
  }
  subBounds(paneSpec) {
    // returns a subrectangle of bounds for, eg, subPanes
    // Submorphs need bounds in this morph's local coords so use shape.getBounds()
    return this.shape.getBounds().scaleRect(paneSpec);
  }
  syncBoundsFromGeometry() {
    // Sync cached this.bounds with shape + translation (setBounds/moveBy already keep it; reparent paths did not).
    // Update in place, like setRotation: replacing this.bounds would orphan a rect
    // that a same-frame in-place mutation (e.g. Morph.moveBy) already wrote a fresh
    // point into, baking a dangling ref into the document.
    let b = this.getBounds();
    if (this.bounds) {
      this.bounds.topLeft = b.topLeft.copy();
      this.bounds.extent = b.extent.copy();
    } else {
      this.bounds = b.copy();
    }
  }
  testTransform(whenDone) {
    // Spin a bit, then reset and optionally run next. Driven by stepping (not
    // a raw timer) so the heap writes in setRotation happen inside the frame
    // loop's runtime.change transaction.
    this.$testTransformStepsLeft = 20; // ~500ms at 25ms/step
    this.$testTransformWhenDone = whenDone;
    this.startStepping('testTransformStep', null, 25);
  }
  testTransformStep() {
    this.rotateBy(Math.PI / 10);
    this.$testTransformStepsLeft -= 1;
    if (this.$testTransformStepsLeft > 0) return;
    this.stopStepping('testTransformStep');
    this.setRotation(0);
    let whenDone = this.$testTransformWhenDone;
    this.$testTransformWhenDone = null;
    if (whenDone) whenDone();
  }
  topMorph() {
    // Note this gets used also to find the
    // root morph -- which could be a hand
    if (this.owner.owner == null) return this;
    return this.owner.topMorph();
  }
  toString() {
    return this.asString();
  }
  translateBy(pt) {
    this.transform.translation = this.transform.translation.addPt(pt);
  }
  translation() {
    return this.transform.translation;
  }
  verifyMorphs(level) {
    // Lively.verifyMorphs()
    // Essentially prints the scene graph
    if (!level) level = 0;
    let str =
      '\n' +
      '  '.repeat(level) +
      this.asString() +
      ' [' +
      this.localize(pt(100, 100)).asString() +
      ']';
    this.submorphs.forEach((morph) => {
      if (!morph.owner)
        str += '\n' + '  '.repeat(level + 1) + '*** owner failure in this ' + morph.className + ':';
      str += morph.verifyMorphs(level + 1, str);
    });
    return str;
  }
  world() {
    // Note this gets used also to find the
    // root morph -- which could be a hand
    if (this.owner == null) return this;
    return this.owner.world();
  }
  static new(...args) {
    return new this(...args);
  }
}

// +--------------------+
// |  Images and Lines  |
// +--------------------+
// Bitmap/emoji morphs and editable polylines with handles.

//  ImageMorph
// ------------
// Morph wrapping ImageShape; collision from opaque pixels.
class ImageMorph extends Morph {
  constructor(imageOrSize) {
    let shape =
      imageOrSize && imageOrSize.instanceOf && imageOrSize.instanceOf(ImageShape)
        ? imageOrSize
        : new ImageShape(imageOrSize);
    let b = shape.getBounds();
    super(b, shape);
  }
  collisionBounds() {
    /**
     * Tight axis-aligned bounds in owner space for collision: uses {@link ImageShape#_contentBoundsLocal}
     * when set (emoji glyph from alpha scan), else one-time alpha scan on a canvas image, else {@link Rectangle#insetBy}(10)
     * on shape bounds; always applies {@link SimpleTransform#transformPt} to corners so scale and rotation match rendering.
     */
    if (!this.shape) return this.getBounds().insetBy(10);
    let sb = this.shape._contentBoundsLocal;
    if (
      !sb &&
      this.shape.image instanceof window.HTMLCanvasElement &&
      !this.shape._alphaBoundsTried
    ) {
      this.shape._alphaBoundsTried = true;
      this.shape.setContentBoundsFromTightCanvas(this.shape.image);
      sb = this.shape._contentBoundsLocal;
    }
    if (!sb) sb = this.shape.getBounds().insetBy(10);
    let corners = [sb.topLeft, sb.topRight(), sb.bottomRight(), sb.bottomLeft()];
    let tfm = this.transform;
    let ownerPts = corners.map((c) => tfm.transformPt(c));
    return unionPts(ownerPts);
  }
  demo() {
    // Demo: show a ladybug image (emoji drawn to canvas, then used as image); drag to move and rotate.
    let size = 64;
    let canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    let ctx = canvas.getContext('2d');
    ctx.font = size + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐞', size / 2, size / 2);
    let img = new Image();
    img.onload = function () {
      let shape = new ImageShape(img);
      let morph = new ImageMorph(shape);
      morph.transform.translation = pt(280, 120);
      Lively.addMorph(morph);
    };
    img.src = canvas.toDataURL('image/png');
  }
  morphCopy() {
    let copy = new ImageMorph(this.shape.copy());
    copy.owner = this.owner;
    copy.transform = this.transform.copy();
    this.restartSteppingOnCopy(copy);
    copy.submorphs = this.submorphs.map((m) => m.morphCopy());
    return copy;
  }
  moveTo(pos) {
    this.transform.translation = pt(pos.x, pos.y);
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (effectiveMetaKey(evt)) {
      let maybeHit = this.world().hitMorphAt(p);
      if (maybeHit) maybeHit.showHalo();
      return false;
    }
    // Let generic Morph logic manage hitPoint, actorID, and pointerFocus.
    this.dragStartAngle = this.transform.rotation;
    return super.onPointerDown(p, evt);
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint) return false;
    let prev = this.hitPoint;
    let moved = super.onPointerMove(p, evt);
    if (!moved) return false;
    // Rotate to face drag direction (only when pointer has moved enough to reduce jitter)
    let delta = p.subPt(prev);
    if (p.dist(prev) > 2 && (delta.x !== 0 || delta.y !== 0)) {
      this.transform.rotation = Math.atan2(delta.y, delta.x) + Math.PI / 2;
    }
    return true;
  }
  onPointerUp(p, evt) {
    // Clear generic Morph drag state, then drop pointer focus.
    super.onPointerUp(p, evt);
    this.world().setPointerFocus(null);
    return true;
  }
  setHeading(angleDegrees) {
    this.transform.rotation = (angleDegrees / 180) * Math.PI;
  }
  syncRotationToVelocity() {
    /** Match {@link ImageMorph#onPointerMove} drag convention: sprite “forward” aligns with velocity. */
    if (!this.velocity) return;
    let vx = this.velocity.x;
    let vy = this.velocity.y;
    if (vx === 0 && vy === 0) return;
    this.transform.rotation = Math.atan2(vy, vx) + Math.PI / 2;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  EmojiMorph
// ------------
// Named emoji or short literal rendered to a tight canvas.
class EmojiMorph extends ImageMorph {
  constructor(emojiName, sizePx) {
    const size = Math.max(8, Math.floor(sizePx != null ? sizePx : 32));
    const ch = EmojiMorph.prototype.resolveChar(emojiName);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = size + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, size / 2, size / 2);
    super(new ImageShape(canvas));
    this._emojiName = emojiName;
    this._emojiSize = size;
    this.shape.setContentBoundsFromTightCanvas(canvas);
  }
  morphCopy() {
    let copy = new EmojiMorph(this._emojiName, this._emojiSize);
    copy.owner = this.owner;
    copy.transform = this.transform.copy();
    this.restartSteppingOnCopy(copy);
    copy.submorphs = this.submorphs.map((m) => m.morphCopy());
    return copy;
  }
  resolveChar(name) {
    if (name == null || name === '') return '\u{1F41E}';
    let s = ('' + name).trim();
    let key = s.toUpperCase().replace(/\s+/g, ' ');
    if (this.emojiByName[key]) return this.emojiByName[key];
    if (s.length <= 8 && /\p{Extended_Pictographic}/u.test(s)) return s;
    return '\u{1F41E}';
  }
  static new(...args) {
    return new this(...args);
  }
}

EmojiMorph.prototype.emojiByName = {
  'LADY BEETLE': '\u{1F41E}',
  LADYBUG: '\u{1F41E}',
  BUTTERFLY: '\u{1F98B}',
  SNAIL: '\u{1F40C}',
  BEE: '\u{1F41D}',
  BUG: '\u{1F41B}',
};

//  LineMorph
// -----------
// Interactive polyline: hover handles, vertex drag/merge.
class LineMorph extends Morph {
  constructor(vertices, opts = {}) {
    let verts = vertices.map((v) => pt(v.x, v.y));
    let worldBounds = PolyLine.boundsForVertices(
      verts,
      opts.borderWidth != null ? opts.borderWidth : 2,
    );
    let origin = worldBounds.topLeft.copy();
    let localVerts = verts.map((v) => v.subPt(origin));
    let pl = new PolyLine(localVerts, opts.borderWidth ?? 2, opts.borderColor ?? Color.black);
    pl.curved = opts.beCurved === true;
    pl.closed = opts.beClosed === true;
    pl.arrowheads = LineMorph.prototype.normalizeArrowheads(opts.arrowheads);
    super(null, pl);
    this.transform.translation = origin;
    this.bounds = worldBounds.copy();
    this.arrowheads = pl.arrowheads;
    this.handleRadius = opts.handleRadius != null ? opts.handleRadius : 5;
    this.$vertexHandles = [];
    this.$midpointHandles = [];
    this.$vertexDragActive = false;
    this.$dragVertexIndex = null;
    this.$mergeNeighborIx = null;
  }
  adjacentOverlapVertex(dragIx) {
    /** Neighboring vertex index if drag handle overlaps it (circles touch), else null. */
    let verts = this.shape.vertices;
    if (dragIx == null || dragIx < 0 || dragIx >= verts.length) return null;
    let lim = 2 * this.handleRadius * 0.98;
    if (dragIx > 0 && verts[dragIx].dist(verts[dragIx - 1]) < lim) return dragIx - 1;
    if (dragIx < verts.length - 1 && verts[dragIx].dist(verts[dragIx + 1]) < lim) return dragIx + 1;
    return null;
  }
  beClosed(on) {
    /** Connect last vertex back to first. `line.beClosed(true)` or read `line.beClosed()`. */
    if (arguments.length === 0) return !!this.shape.closed;
    this.shape.closed = !!on;
    this.changed();
    let world = this.world();
    if (world && world.changed) world.changed();
    this.syncShapeFromVertices();
    return this;
  }
  beCurved(on) {
    /** Smooth Bézier vs straight segments. `line.beCurved(true)` or read `line.beCurved()`. */
    if (arguments.length === 0) return !!this.shape.curved;
    this.shape.curved = !!on;
    this.changed();
    let world = this.world();
    if (world && world.changed) world.changed();
    return this;
  }
  clearAllHandles() {
    this.clearVertexHandles();
    this.clearMidpointHandles();
  }
  clearMidpointHandles() {
    (this.$midpointHandles || []).forEach((h) => h.remove());
    this.$midpointHandles = [];
  }
  clearVertexHandles() {
    (this.$vertexHandles || []).forEach((h) => h.remove());
    this.$vertexHandles = [];
  }
  ensureMidpointHandles() {
    let mids = this.segmentMidpoints();
    let r = Math.max(3, this.handleRadius - 1);
    if (this.$midpointHandles && this.$midpointHandles.length === mids.length) {
      this.layoutMidpointHandles();
      return;
    }
    this.clearMidpointHandles();
    // Per-user hover UI: handles attach via the ephemeral layer, never the document.
    this.$midpointHandles = mids.map((m) => {
      let h = new LineMidpointHandle(this, m.segmentIndex, r);
      this.addEphemeralMorph(h);
      h.positionAt(m.pt);
      return h;
    });
  }
  ensureVertexHandles() {
    let verts = this.shape.vertices;
    let r = this.handleRadius;
    let needRebuild =
      !this.$vertexHandles ||
      this.$vertexHandles.length !== verts.length ||
      this.$vertexHandles.some((h) => h.owner !== this);
    if (!needRebuild) {
      this.layoutVertexHandles();
      return;
    }
    this.clearVertexHandles();
    // Per-user hover UI: handles attach via the ephemeral layer, never the document.
    this.$vertexHandles = verts.map((v, i) => {
      let h = new LineVertexHandle(this, i, r);
      this.addEphemeralMorph(h);
      h.positionAtVertex(v);
      return h;
    });
  }
  hoverHitBounds() {
    let verts = this.shape.vertices;
    if (!verts || verts.length < 1) return this.shape.getBounds().expandBy(10);
    let pad = 10 + (this.handleRadius != null ? this.handleRadius : 5);
    return unionPts(verts).expandBy(pad);
  }
  insertVertexOnSegment(segmentIndex, p) {
    // NB: don't name the parameter `pt` — it would shadow the global pt() below.
    let verts = this.shape.vertices;
    let ix = segmentIndex + 1;
    verts.splice(ix, 0, pt(p.x, p.y));
    this.syncShapeFromVertices();
    return ix;
  }
  isLineHandle(m) {
    return this.isVertexHandle(m) || this.isMidpointHandle(m);
  }
  isMidpointHandle(m) {
    return m && m.className === 'LineMidpointHandle' && m.lineMorph === this;
  }
  isVertexHandle(m) {
    return m && m.className === 'LineVertexHandle' && m.lineMorph === this;
  }
  layoutMidpointHandles() {
    let mids = this.segmentMidpoints();
    if (!this.$midpointHandles || this.$midpointHandles.length !== mids.length) return;
    mids.forEach((m, i) => this.$midpointHandles[i].positionAt(m.pt));
  }
  layoutVertexHandles() {
    let verts = this.shape.vertices;
    if (!this.$vertexHandles || this.$vertexHandles.length !== verts.length) return;
    verts.forEach((v, i) => this.$vertexHandles[i].positionAtVertex(v));
  }
  mergeDraggedVertexWithNeighbor() {
    let dragIx = this.$dragVertexIndex;
    let neighbor = this.$mergeNeighborIx;
    if (dragIx == null || neighbor == null) return;
    let verts = this.shape.vertices;
    if (verts.length < 3) return;
    let removeIx = dragIx;
    if (neighbor > dragIx) removeIx = neighbor;
    verts.splice(removeIx, 1);
    this.$dragVertexIndex = null;
    this.$mergeNeighborIx = null;
    this.syncShapeFromVertices();
  }
  morphCopy() {
    let worldVerts = this.shape.vertices.map((v) => this.globalize(v));
    let copy = new LineMorph(worldVerts, {
      borderWidth: this.shape.borderWidth,
      borderColor: this.shape.borderColor,
      arrowheads: this.arrowheads,
      beCurved: this.shape.curved,
      beClosed: this.shape.closed,
      handleRadius: this.handleRadius,
    });
    copy.owner = this.owner;
    this.restartSteppingOnCopy(copy, (spec, c) => {
      if (spec.methodName === 'stepHoverHandles') {
        c.startHandleStepping();
        return true;
      }
    });
    return copy;
  }
  morphMenu() {
    return {
      items: ['be curved', 'be closed', '---------', '------->', '<-------', '<----->'],
      onSelect: function (item, line) {
        if (item === 'be curved') line.beCurved(!line.beCurved());
        if (item === 'be closed') line.beClosed(!line.beClosed());
        if (item === '---------') line.setArrowheads('none');
        if (item === '------->') line.setArrowheads('end');
        if (item === '<-------') line.setArrowheads('start');
        if (item === '<----->') line.setArrowheads('both');
      },
    };
  }
  moveBy(delta) {
    super.moveBy(delta);
    this.syncBoundsFromGeometry();
  }
  normalizeArrowheads(spec) {
    /** @returns {'none'|'start'|'end'|'both'} */
    if (spec === '---------' || spec === '--------' || spec === '------') return 'none';
    if (spec === '------->' || spec === '------>' || spec === '---->') return 'end';
    if (spec === '<-------' || spec === '<------' || spec === '<----') return 'start';
    if (spec === '<----->' || spec === '<------->' || spec === '<--->') return 'both';
    if (spec === true || spec === 'end') return 'end';
    if (spec === false || spec === 'none' || spec == null) return 'none';
    if (spec === 'start' || spec === 'both') return spec;
    return 'none';
  }
  onPointerDown(p, evt) {
    if (!this.fullBounds().includesPt(p)) return false;
    let localP = this.relativize(p);
    let onHandle = this.submorphs.some((sub) => sub.includesPt(localP));
    if (!onHandle && !this.shape.includesPt(localP)) return false;
    return super.onPointerDown(p, evt);
  }
  refreshMergeHighlight() {
    let dragIx = this.$dragVertexIndex;
    let neighbor = this.adjacentOverlapVertex(dragIx);
    this.$mergeNeighborIx = neighbor;
    (this.$vertexHandles || []).forEach((h, i) => {
      let on = neighbor != null && (i === dragIx || i === neighbor);
      if (h.setMergeHighlight) h.setMergeHighlight(on);
    });
  }
  remove() {
    this.clearAllHandles();
    return super.remove();
  }
  segmentMidpoints() {
    let verts = this.shape.vertices;
    let mids = [];
    for (let i = 0; i < verts.length - 1; i++) {
      mids.push({
        segmentIndex: i,
        pt: verts[i].addPt(verts[i + 1]).scaleBy(0.5),
      });
    }
    if (this.shape.closed && verts.length >= 3) {
      let i = verts.length - 1;
      mids.push({
        segmentIndex: i,
        pt: verts[i].addPt(verts[0]).scaleBy(0.5),
      });
    }
    return mids;
  }
  setArrowheads(spec) {
    let ah = LineMorph.prototype.normalizeArrowheads(spec);
    this.shape.arrowheads = ah;
    this.arrowheads = ah;
    this.changed();
    let world = this.world();
    if (world && world.changed) world.changed();
    return this;
  }
  startHandleStepping() {
    super.startStepping('stepHoverHandles', null, 200);
  }
  stepHoverHandles() {
    let world = this.world();
    if (!world) return;
    if (this.$vertexDragActive) {
      this.ensureVertexHandles();
      this.clearMidpointHandles();
      return;
    }
    let pf = world.$pointerFocus;
    if (pf && this.isLineHandle(pf)) {
      this.ensureVertexHandles();
      if (!this.isMidpointHandle(pf)) this.ensureMidpointHandles();
      return;
    }
    if (!getPointerLocation()) {
      this.clearAllHandles();
      return;
    }
    let localP = this.localize(getPointerLocation());
    if (!this.shape.includesPt(localP)) {
      this.clearAllHandles();
      return;
    }
    this.ensureVertexHandles();
    this.ensureMidpointHandles();
  }
  syncGeometryFromVertices() {
    /** Refresh shape/morph bounds from current vertices (hover region, hit testing). */
    this.shape.recomputeBounds();
    this.syncBoundsFromGeometry();
  }
  syncShapeFromVertices() {
    this.syncGeometryFromVertices();
    let n = this.shape.vertices.length;
    if (!this.$vertexHandles || this.$vertexHandles.length !== n) this.ensureVertexHandles();
    else this.layoutVertexHandles();
    if (!this.$vertexDragActive) {
      let nm = this.segmentMidpoints().length;
      if (!this.$midpointHandles || this.$midpointHandles.length !== nm)
        this.ensureMidpointHandles();
      else this.layoutMidpointHandles();
    }
    this.changed();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  LineVertexHandle
// ------------------
// White disk on a vertex; drag to move or merge.
class LineVertexHandle extends Morph {
  constructor(lineMorph, vertexIndex, radius) {
    const handleRadius = radius != null ? radius : 5;
    let ell = new Ellipse(pt(0, 0), handleRadius);
    ell.setColor(Color.white);
    ell.setBorderWidth(1);
    ell.setBorderColor(Color.gray);
    super(null, ell);
    this.lineMorph = lineMorph;
    this.vertexIndex = vertexIndex;
    this.handleRadius = handleRadius;
  }
  acceptsDroppingMorphs() {
    return false;
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    let lm = this.lineMorph;
    lm.$vertexDragActive = true;
    lm.$dragVertexIndex = this.vertexIndex;
    lm.$mergeNeighborIx = null;
    this.hitPoint = p;
    this.actorID = evt.actorID;
    lm.clearMidpointHandles();
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint) return false;
    let lm = this.lineMorph;
    let verts = lm.shape.vertices;
    let i = lm.$dragVertexIndex != null ? lm.$dragVertexIndex : this.vertexIndex;
    if (i < 0 || i >= verts.length) return true;
    verts[i] = pt(p.x, p.y);
    lm.syncGeometryFromVertices();
    lm.layoutVertexHandles();
    lm.refreshMergeHighlight();
    lm.changed();
    return true;
  }
  onPointerUp(p, evt) {
    let lm = this.lineMorph;
    if (lm.$mergeNeighborIx != null) lm.mergeDraggedVertexWithNeighbor();
    this.hitPoint = null;
    this.actorID = null;
    lm.$vertexDragActive = false;
    lm.$dragVertexIndex = null;
    lm.$mergeNeighborIx = null;
    lm.syncShapeFromVertices();
    this.world().setPointerFocus(null);
    return true;
  }
  positionAtVertex(v) {
    this.setBounds(v.boundsWithRadius(this.handleRadius));
  }
  setMergeHighlight(on) {
    if (on) {
      this.shape.setColor(Color.orange);
      this.shape.setBorderColor(Color.orange);
    } else {
      this.shape.setColor(Color.white);
      this.shape.setBorderColor(Color.gray);
    }
    this.changed();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  LineMidpointHandle
// --------------------
// Green disk on a segment; click inserts a vertex.
class LineMidpointHandle extends Morph {
  constructor(lineMorph, segmentIndex, radius) {
    const handleRadius = radius != null ? radius : 4;
    let ell = new Ellipse(pt(0, 0), handleRadius);
    ell.setColor(Color.green.lighter());
    ell.setBorderWidth(1);
    ell.setBorderColor(Color.gray);
    super(null, ell);
    this.lineMorph = lineMorph;
    this.segmentIndex = segmentIndex;
    this.handleRadius = handleRadius;
    this.$dragVertexIndex = null;
  }
  acceptsDroppingMorphs() {
    return false;
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    let lm = this.lineMorph;
    lm.$vertexDragActive = true;
    this.hitPoint = p;
    this.actorID = evt.actorID;
    let newIx = lm.insertVertexOnSegment(this.segmentIndex, p);
    lm.$dragVertexIndex = newIx;
    lm.$mergeNeighborIx = null;
    this.$dragVertexIndex = newIx;
    lm.ensureVertexHandles();
    lm.clearMidpointHandles();
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint || this.$dragVertexIndex == null) return false;
    let lm = this.lineMorph;
    let verts = lm.shape.vertices;
    let i = lm.$dragVertexIndex;
    if (i < 0 || i >= verts.length) return true;
    verts[i] = pt(p.x, p.y);
    lm.syncGeometryFromVertices();
    lm.layoutVertexHandles();
    lm.refreshMergeHighlight();
    lm.changed();
    return true;
  }
  onPointerUp(p, evt) {
    let lm = this.lineMorph;
    if (lm.$mergeNeighborIx != null) lm.mergeDraggedVertexWithNeighbor();
    this.hitPoint = null;
    this.actorID = null;
    this.$dragVertexIndex = null;
    lm.$vertexDragActive = false;
    lm.$dragVertexIndex = null;
    lm.$mergeNeighborIx = null;
    lm.syncShapeFromVertices();
    this.world().setPointerFocus(null);
    return true;
  }
  positionAt(v) {
    this.setBounds(v.boundsWithRadius(this.handleRadius));
  }
  static new(...args) {
    return new this(...args);
  }
}

// +------------------+
// |  Text UI Morphs  |
// +------------------+
// TextMorph editors, buttons, and keyboard key caps.

function latestPasteBufferItem() {
  if (!pasteBufferItems || pasteBufferItems.length === 0) return 'nothing to paste';
  return pasteBufferItems[pasteBufferItems.length - 1];
}
function addPasteBufferItem(item) {
  if (!pasteBufferItems || !Array.isArray(pasteBufferItems))
    pasteBufferItems = ['nothing to paste'];
  let txt = item == null ? '' : '' + item;
  pasteBufferItems.push(txt);
  while (pasteBufferItems.length > 4) pasteBufferItems.shift();
  copyPasteBuffer = txt; // compatibility for any older callers
}
function showPasteHistoryMenu(pane, textBox) {
  let world = pane && pane.world ? pane.world() : null;
  if (!world || !textBox) return;
  let history =
    pasteBufferItems && pasteBufferItems.length ? pasteBufferItems.slice() : ['nothing to paste'];
  let entries = [];
  for (let i = history.length - 1; i >= 0; i--) {
    let raw = history[i];
    let preview = ('' + raw).replace(/\n/g, '↩');
    if (preview.length === 0) preview = '(empty)';
    if (preview.length > 72) preview = preview.slice(0, 72) + '…';
    entries.push({ label: history.length - i + '. ' + preview, text: '' + raw });
  }
  let anchor =
    getPointerLocation() ||
    (pane.globalize ? pane.globalize(pane.shape.getBounds().topLeft) : pt(8, 8));
  let menu = null;
  menu = new MenuMorph(
    rect(anchor.x, anchor.y, 320, Math.max(48, 24 + entries.length * 18)),
    entries.map((e) => e.label),
    function (label) {
      if (menu) menu.remove();
      let hit = entries.find((e) => e.label === label);
      if (!hit) return;
      let priorScrollPos = pane.getScrollPosition ? pane.getScrollPosition() : null;
      let oldH = textBox.extent.y;
      textBox.paste(hit.text);
      let newH = textBox.extent.y;
      if (pane.onTextBoundsChanged && newH !== oldH) pane.onTextBoundsChanged(priorScrollPos);
    },
  );
  world.addMorph(menu);
}
//  TextMorph
// -----------
// Morph whose shape is a TextBox; pane keyboard focus target.
class TextMorph extends Morph {
  constructor(bounds, str) {
    super(
      bounds,
      new TextBox(
        bounds,
        str,
        '\n',
        16,
        '14px sans-serif',
        Color.black,
        Color.veryLightGray,
        Color.green.lighter(),
      ),
    );
  }
  dragFrom(p, evt) {
    this.textDragHack = true;
    return super.dragFrom(p, evt);
  }
  onKeyDown(evt) {
    let priorScrollPos = null;
    if (this.owner && this.owner.getScrollPosition) priorScrollPos = this.owner.getScrollPosition();
    let oldH = this.shape.extent.y;
    let wasDirty = !!(
      this.owner &&
      typeof this.owner.hasUnsavedChanges == 'function' &&
      this.owner.hasUnsavedChanges()
    );
    this.shape.acceptKeyboardInput(evt);
    let nowDirty = !!(
      this.owner &&
      typeof this.owner.hasUnsavedChanges == 'function' &&
      this.owner.hasUnsavedChanges()
    );
    if (!wasDirty && nowDirty && this.shape.editorID == null) this.shape.editorID = evt.actorID;
    if (!nowDirty) this.shape.editorID = null;
    if (this.shape.extent.y != oldH) this.owner.onTextBoundsChanged(priorScrollPos);
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    this.hitPoint = p;
    this.actorID = evt.actorID;
    let localP = this.relativize(p);
    if (effectiveShiftKey(evt)) this.shape.shiftExtendSelectionToPointer(localP);
    else this.shape.startSelectionAt(localP);
    this.world().setKeyboardFocus(this);
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    // event handling should go to the shape (text); while morph ops to morph(super)...
    // *** If event focus is working right, we should be able to drop pointer events
    //     here, and just let them be handled in superclass Morph
    if (!this.includesPt(p)) return false;
    // Shift-drag extends selection range; it should not switch to morph-drag behavior.
    if (effectiveShiftKey(evt)) {
      if (this.hitPoint) this.shape.extendSelectionTo(this.relativize(p));
      return true;
    }
    if (this.hitPoint) this.shape.extendSelectionTo(this.relativize(p));
    return true;
  }
  onPointerUp(p, evt) {
    // event handling should go to the shape (text); while morph ops to morph(super)...
    if (!this.includesPt(p)) {
      // Release pointer focus even when mouse-up happens outside pane bounds.
      this.actorID = null;
      this.hitPoint = null;
      this.world().setPointerFocus(null);
      return true;
    }
    this.shape.finSelection(); // A chance to notice selectWord click
    this.actorID = null;
    this.hitPoint = null;
    this.world().setPointerFocus(null);
    return true;
  }
  renderOn(ctx) {
    let dirty = false;
    if (
      this.owner &&
      this.owner.className == 'TextPane' &&
      typeof this.owner.hasUnsavedChanges == 'function' &&
      this.owner.hasUnsavedChanges()
    )
      dirty = true;
    this.shape._unsavedInnerBorder = dirty;
    if (!dirty) this.shape.editorID = null;
    super.renderOn(ctx);
  }
  setText(str) {
    this.shape.setText(str); // *** should probably adjust bounds due to recompose
  }
  setWorkspaceObj(wsObj) {
    // Arrange it so that evals in this text will have access to wsObj)
    this.shape.setWorkspaceObj(wsObj);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  SimpleButtonMorph
// -------------------
// TextMorph styled as a labeled button.
class SimpleButtonMorph extends TextMorph {
  constructor(bounds, label) {
    super(bounds, label == null ? ' ' : label);
    this.shape.boxColor = Color.lightGray;
    this.shape.borderWidth = 1;
    this.shape.borderColor = Color.gray;
    this.shape.noMenuLineHighlight = true;
    this.shape.disableSelectionRendering = true;
    this.shape.$selStart = null;
    this.shape.$selStop = null;
    this.shape.inset = pt(0, 0);
    this.shape.hang = 0;
    this.shape.composeBottomPad = 0;
    this.shape.centerGlyph = true;
    this.shape.verticallyCenterSingleLine = true;
    this.shape.verticalNudge = 8;
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    this.hitPoint = p;
    this.actorID = evt.actorID;
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    return false;
  }
  onPointerUp(p, evt) {
    this.actorID = null;
    this.hitPoint = null;
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  KbdKeyMorph
// -------------
// On-screen keyboard key cap.
class KbdKeyMorph extends SimpleButtonMorph {
  constructor(bounds, label, keySpec, keyboardMorph) {
    super(bounds, label);
    this.keySpec = keySpec;
    this.keyboardMorph = keyboardMorph;
    this._kbdKeyBaseBoxColor =
      this.shape && this.shape.boxColor ? this.shape.boxColor.copy() : Color.lightGray.copy();
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    this.hitPoint = p;
    this.actorID = evt.actorID;
    if (this.keyboardMorph) this.keyboardMorph.handleVirtualKey(this.keySpec, evt);
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(p, evt) {
    return !!this.hitPoint;
  }
  onPointerUp(p, evt) {
    this.actorID = null;
    this.hitPoint = null;
    if (this.world() && this.world().$pointerFocus === this) this.world().setPointerFocus(null);
    return true;
  }
  refreshModifierHighlight() {
    let spec = this.keySpec;
    let base = this._kbdKeyBaseBoxColor || Color.lightGray;
    let active = false;
    if (spec && spec.type === 'shift') active = isShiftKeyPressed();
    else if (spec && spec.type === 'caps_unused') active = isLockKeyPressed();
    else if (spec && spec.type === 'meta_toggle') active = $metaKeyPressedFlag;
    this.shape.boxColor = active ? padModifierHighlightOn(base) : base;
    this.changed();
  }
  setKeyLabel(label) {
    this.setText(label);
    this.shape.$selStart = null;
    this.shape.$selStop = null;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +-------------------+
// |  Menus and Lists  |
// +-------------------+
// ListMorph, MenuMorph, and pane/world menu helpers.

function isMenuSeparator(item) {
  return item === menuSeparator;
}
function menuSeparatorDisplay() {
  return '———';
}
function methodSelectorPaneMenuSpec(panel) {
  /** Pane menu for method-selector list panes (browser message list, method-list panel, …). */
  return {
    items: [
      'spawn this method to its own window',
      'export this method to the OS paste buffer',
      menuSeparator,
      'delete this method',
    ],
    onSelect: (item, pane) => {
      if (isMenuSeparator(item)) return;
      if (item == 'spawn this method to its own window') panel.spawnMethodCopyToWindow();
      if (item == 'export this method to the OS paste buffer') panel.exportMethodCopyToOSPaste();
      if (item == 'delete this method') panel.promptDeleteThisMethod();
    },
  };
}
function classSelectorPaneMenuSpec(panel) {
  /** Pane menu for class-selector list pane (browser class list). */
  return {
    items: [
      'spawn this class to its own window',
      'export this class to the OS paste buffer',
      menuSeparator,
      'delete this class',
    ],
    onSelect: (item, pane) => {
      if (isMenuSeparator(item)) return;
      if (item == 'spawn this class to its own window') panel.spawnThisClassToWindow();
      if (item == 'export this class to the OS paste buffer') panel.exportThisClassToOSPaste();
      if (item == 'delete this class') panel.promptDeleteThisClass();
    },
  };
}
function menuToggleLabel(caption, on) {
  /** Brackets only — handlers match with `item.endsWith(caption)`. */
  return (on ? '[X] ' : '[ ] ') + caption;
}
function menuItemCaption(item) {
  /** Strip `[X] ` / `[ ] ` prefix; also accepts a bare caption or truncated display line. */
  let s = '' + item;
  if (s.startsWith('[X] ')) return s.slice(4);
  if (s.startsWith('[ ] ')) return s.slice(4);
  return s;
}
function refreshWorldMenuItems(menuMorph) {
  let refreshed = [];
  menuMorph.itemList.forEach((line) => {
    let cap = menuItemCaption(line);
    if (cap === longClickForHalosLabel || cap.endsWith(longClickForHalosLabel))
      refreshed.push(menuToggleLabel(longClickForHalosLabel, $longClickForHalos));
    else if (cap === onScreenKeyboardLabel || cap.endsWith(onScreenKeyboardLabel))
      refreshed.push(menuToggleLabel(onScreenKeyboardLabel, $useOnScreenKbd));
    else refreshed.push(line);
  });
  menuMorph.setList(refreshed);
}
//  ListMorph
// -----------
// Vertical list of strings; line selection.
class ListMorph extends Morph {
  constructor(initialBounds, list, actionFn) {
    super(
      initialBounds,
      new TextBox(
        initialBounds,
        'text',
        ' ',
        16,
        '14px sans-serif',
        Color.black,
        Color.veryLightGray,
        Color.green.lighter(),
      ),
    );
    this.shape.setNoBreak(true);
    this.setList(list);
    this.setSelectFn(actionFn);
  }
  onPointerDown(p, evt) {
    // p is in owner coordinates; includesPt(p) uses relativize(p) for shape hit test
    if (!this.includesPt(p)) return false;
    clearKeyboardFocusUnlessTypingOrOsk(this);
    this.hitPoint = p;
    this.actorID = evt.actorID;
    this.shape.selectLineAt(this.relativize(p));
    this.world().setPointerFocus(this);
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    return true;
  }
  onPointerMove(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.hitPoint) this.shape.selectLineAt(this.relativize(p));
    return true;
  }
  onPointerUp(p, evt) {
    if (!this.includesPt(p)) {
      // Release pointer focus even when mouse-up happens outside pane bounds.
      this.actorID = null;
      this.hitPoint = null;
      this.world().setPointerFocus(null);
      return true;
    }
    this.actorID = null;
    this.hitPoint = null;
    let selectionIndex = this.shape.$selectedLineIndex;
    this.world().setPointerFocus(null);
    if (selectionIndex > 0) {
      let rawItem = this.itemList ? this.itemList[selectionIndex - 1] : null;
      if (this.actionFn && !isMenuSeparator(rawItem))
        this.actionFn.call(this, rawItem, evt.shiftKey);
    }
    // Retain visible selection after choice (e.g. in ListPanes / class browser)
    return true;
  }
  setList(list) {
    this.itemList = list || [];
    let lim = menuItemMaxChars != null ? menuItemMaxChars : 15;
    if (this.className === 'MenuMorph') lim = Math.max(lim, 48);
    this.displayItems = this.itemList.map((item) =>
      isMenuSeparator(item) ? menuSeparatorDisplay() : truncateString('' + item, lim),
    );
    let itemText = '';
    this.displayItems.forEach((item) => (itemText += item + '\n'));
    this.shape.setText(itemText);
    let ctx = this.shape.getTextContext(this.shape.font);
    let inListPane = this.owner && this.owner.className === 'ListPane';
    if (ctx && !inListPane) {
      let maxW = 0;
      this.displayItems.forEach((item) => {
        maxW = Math.max(maxW, ctx.measureText(item).width);
      });
      let insetX = this.shape.inset ? this.shape.inset.x : 2;
      let isPaneSelMenu = this.className === 'MenuMorph' && this._paneMenuOwnerScrollPane;
      let minMenuW = isPaneSelMenu
        ? paneSelectionMenuMinWidth != null
          ? paneSelectionMenuMinWidth
          : 48
        : 96;
      let targetW = Math.max(minMenuW, Math.ceil(maxW + insetX * 2 + 14));
      if (isPaneSelMenu && paneSelectionMenuNarrowBy) {
        targetW = Math.max(minMenuW, targetW - paneSelectionMenuNarrowBy);
      }
      let b = this.getBounds();
      if (Math.abs(targetW - b.width()) > 0.5)
        this.setBounds(rect(b.topLeft.x, b.topLeft.y, targetW, b.height()));
    }
  }
  setSelectFn(actionFn) {
    this.actionFn = actionFn;
  }
  setSelectionString(str, suppressAction) {
    let idx = -1;
    if (this.itemList) idx = this.itemList.findIndex((item) => item === str);
    if (idx < 0 && this.displayItems) idx = this.displayItems.findIndex((item) => item === str);
    let probe = idx >= 0 && this.displayItems ? this.displayItems[idx] : str;
    let selectionIndex = this.shape.setSelectedTextString(probe);
    if (selectionIndex > 0 && !suppressAction) {
      let rawItem = this.itemList ? this.itemList[selectionIndex - 1] : null;
      if (!isMenuSeparator(rawItem)) this.actionFn.call(this, rawItem);
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

//  MenuMorph
// -----------
// Fleeting or persistent menu built on ListMorph.
class MenuMorph extends ListMorph {
  static new(...args) {
    return new this(...args);
  }
}

// +---------+
// |  Panes  |
// +---------+
// Scroll panes, text editors, transcripts, sliders, hue picker.

function hitScrollPaneMenuButtonAt(world, worldPt) {
  /** Scrollbar whose menuButton (if any) contains `worldPt`. */
  let m = world.topMorphAtExcludingHaloUI(worldPt);
  while (m && m !== world) {
    if (m.className === 'SliderMorph' && m.menuButton) {
      let localP = m.localize(worldPt);
      if (m.menuButton.includesPt(localP)) return m;
    }
    m = m.owner;
  }
  return null;
}
function fleetingPaneMenuForScrollPane(world, scrollPane) {
  /** Fleeting pane menu owned by a scroll pane, if any. */
  if (!world || !scrollPane) return null;
  return world.submorphs.find(
    (sub) =>
      sub.className === 'MenuMorph' &&
      sub.isFleetingMenu &&
      sub._paneMenuOwnerScrollPane === scrollPane,
  );
}
function removeFleetingPaneMenuFor(scrollPane) {
  let menu = fleetingPaneMenuForScrollPane(scrollPane.world(), scrollPane);
  if (menu) menu.remove();
}
function worldPtHitsMorphOrSubmorphs(world, worldPt, targetMorph) {
  /** True if `worldPt` hits `targetMorph` or any of its submorphs (world coordinates). */
  if (!world || !targetMorph || !world.morphsAtPointInDepthOrder) return false;
  let chain = world.morphsAtPointInDepthOrder(worldPt);
  for (let i = 0; i < chain.length; i++) {
    let m = chain[i];
    let x = m;
    while (x) {
      if (x === targetMorph) return true;
      x = x.owner;
    }
  }
  return false;
}
//  ScrollPane
// ------------
// Clipped content + vertical scrollbar.
class ScrollPane extends Morph {
  constructor(panelBounds, boundsSpec) {
    super(panelBounds.scaleRect(boundsSpec));
    this.boundsSpec = boundsSpec;
    this.setColor(Color.lightGray);
    this.contentPane = null; // filled in by subclasses
    this.scrollBar = null; // filled in by subclasses
    this.paneMenu = null;
  }
  _scrollContentTo(scrollPos) {
    // Scroll state is per-user: it lives in contentPane.$scrollOffsetY (applied by the
    // Morph coordinate primitives), never in the shared transform.
    let clipped = Math.max(0, Math.min(1, scrollPos));
    // Heal legacy documents that scrolled by mutating the shared translation.
    if (this.contentPane.transform.translation.y !== 0) this.contentPane.transform.translation.y = 0;
    let ht = this.contentPane.getBounds().height();
    let slideRoom = ht - this.getBounds().height();
    if (!slideRoom || slideRoom <= 0) {
      this.contentPane.$scrollOffsetY = 0;
      return 0;
    }
    this.contentPane.$scrollOffsetY = Math.min(0, -slideRoom * clipped);
    return clipped;
  }
  clippedBounds() {
    /** Halo frame matches the visible pane, not scrolled-away content. */
    return this.getBounds().copy();
  }
  clippedBoundsInWorld() {
    return this.boundsInWorld();
  }
  fullBounds() {
    /** Viewport + scrollbar only — not tall scrolled content — so parent hit tests don't bleed into panes above. */
    let b = this.shape.getBounds().copy();
    if (this.scrollBar) b = b.union(this.scrollBar.getBounds().copy());
    return b.translatedBy(this.transform.translation);
  }
  getScrollPosition() {
    let ht = this.contentPane.getBounds().height();
    let slideRoom = ht - this.getBounds().height();
    if (!slideRoom || slideRoom <= 0) return 0;
    // Per-user scroll state; legacy shared-translation scroll counts until healed.
    let scrollY = (this.contentPane.$scrollOffsetY || 0) + this.contentPane.transform.translation.y;
    return -scrollY / slideRoom;
  }
  installContentAndScrollbar(contentPaneSpec, scrollBarSpec, contentMorph, onTextSaved) {
    this.contentPaneSpec = contentPaneSpec;
    this.contentPane = this.addMorph(contentMorph);
    if (onTextSaved) {
      let pane = this;
      this.contentPane.shape.onTextSaved = function () {
        onTextSaved.call(pane);
      };
    }
    this.scrollBarSpec = scrollBarSpec;
    this.scrollBar = this.addMorph(
      new SliderMorph(this.subBounds(scrollBarSpec), (scrollPos) => {
        this.setScrollPosition(scrollPos);
      }),
    );
    this.scrollBar.setValueTarget(this, 'setScrollPosition');
    this.setBounds(this.getBounds());
  }
  onKeyDown(evt) {
    // Mainly called by subclass.call()
    return super.onKeyDown(evt);
  }
  onTextContentBoundsChanged(priorScrollPos, quiet) {
    let paneH = this.getBounds().height();
    let contentH = this.contentPane.getBounds().height();
    let slideRoom = Math.max(0, contentH - paneH);
    if (priorScrollPos != null) {
      let clipped = this._scrollContentTo(priorScrollPos);
      this.syncScrollBar(clipped, quiet);
      return;
    }
    if (slideRoom > 0) {
      let spec = this.contentPane.shape.$selStop || this.contentPane.shape.$selStart;
      let caretY = spec ? spec.charY + this.contentPane.shape.lineHeight / 2 : null;
      if (caretY == null) {
        let clipped = this._scrollContentTo(this.getScrollPosition());
        this.syncScrollBar(clipped, quiet);
        return;
      }
      let desiredTop = Math.max(0, caretY - paneH / 2);
      let desiredScroll = Math.max(0, Math.min(1, desiredTop / slideRoom));
      let clipped = this._scrollContentTo(desiredScroll);
      this.syncScrollBar(clipped, quiet);
    } else {
      let clipped = this._scrollContentTo(0);
      this.syncScrollBar(clipped, quiet);
    }
  }
  paneMenuAnchorInWorld() {
    /** World point just to the right of this pane’s top-right (stable when content scrolls). */
    let r = this.shape.getBounds();
    return this.globalize(r.topRight().addPt(pt(3, 0)));
  }
  renderOn(ctx) {
    // Context is already in pane-local coords (parent applied our transform); clip to local shape bounds
    let bnds = this.shape.getBounds();
    ctx.save();
    ctx.beginPath(); // path is not saved by save() - must start fresh so clip is only this rect
    ctx.rect(bnds.topLeft.x, bnds.topLeft.y, bnds.extent.x, bnds.extent.y);
    ctx.clip();
    super.renderOn(ctx);
    ctx.restore();
  }
  scrollToTop() {
    this.setScrollPosition(0);
    this.scrollBar.setValue(0.0);
  }
  setBounds(paneBounds) {
    let priorScrollPos = null;
    if (this.contentPane && this.scrollBar) priorScrollPos = this.getScrollPosition();
    super.setBounds(paneBounds);
    let scrollW = 15;
    let contentW = paneBounds.width() - scrollW;
    let ht = paneBounds.height();
    // contentPane and scrollBar are children; bounds must be in pane-local coords
    let contentBounds = rect(0, 0, contentW, ht);
    this.contentPane.setBounds(contentBounds);
    let scrollBounds = rect(contentW, 0, scrollW, ht);
    this.scrollBar.setBounds(scrollBounds);
    if (priorScrollPos != null) {
      let clipped = Math.max(0, Math.min(1, priorScrollPos));
      this.setScrollPosition(clipped);
      this.scrollBar.setValue(clipped);
    }
  }
  setPaneBoundsIn(panelBounds) {
    this.setBounds(panelBounds.scaleRect(this.boundsSpec));
  }
  setPaneMenu(paneMenuSpec) {
    // paneMenuSpec = { items: [...], onSelect: function(item, pane) { ... } }
    this.paneMenu = paneMenuSpec;
    this.changed();
  }
  setScrollPosition(scrollPos) {
    this._scrollContentTo(scrollPos);
  }
  showPaneMenu(ptIfAny, optsIfAny) {
    if (!this.paneMenu || !this.world()) return false;
    let spec = this.paneMenu;
    let items = spec.items || [];
    if (items.length == 0) return false;
    let opts = optsIfAny || {};
    let worldPt = ptIfAny
      ? ptIfAny
      : this.paneMenuAnchorInWorld
        ? this.paneMenuAnchorInWorld()
        : getPointerLocation() || this.globalize(this.shape.getBounds().topLeft);
    let thisPane = this;
    let menu = new MenuMorph(
      rect(worldPt.x, worldPt.y, 165, Math.max(48, 24 + items.length * 18)),
      items,
      function (item) {
        if (isMenuSeparator(item)) return;
        if (spec.onSelect) spec.onSelect(item, thisPane);
        if (menu.staysOpenOnSelect) {
          menu.shape.selectLineAt(0);
          menu.changed();
        } else menu.remove();
      },
    );
    menu.isFleetingMenu = !!opts.fleeting;
    if (opts.fromSelection) {
      menu.staysOpenOnSelect = true;
      menu._paneMenuOwnerScrollPane = thisPane;
      menu._paneMenuPinWhileInContent = thisPane.contentPane;
      menu.setList(items);
    }
    this.world().addMorph(menu);
    return menu;
  }
  showPaneMenuFromMenuButton() {
    /** Fleeting pane menu from the scrollbar menuButton (opens on pointer-down). */
    if (!this.paneMenu || !this.world()) return null;
    let items = this.paneMenu.items || [];
    if (items.length === 0) return null;
    let menu = this.showPaneMenu(this.paneMenuAnchorInWorld(), {
      fleeting: true,
      fromSelection: true,
    });
    if (this.instanceOf && this.instanceOf(TextPane)) syncOnScreenKeyboardWithFocus(this.world());
    return menu;
  }
  syncScrollBar(scrollPos, quiet) {
    if (!this.scrollBar) return;
    let clipped =
      scrollPos == null ? Math.max(0, Math.min(1, this.getScrollPosition())) : scrollPos;
    if (quiet) this.scrollBar.setValueQuiet(clipped);
    else this.scrollBar.setValue(clipped);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  ListPane
// ----------
// Scrollable list with optional pane menu.
class ListPane extends ScrollPane {
  constructor(panelBounds, boundsSpec) {
    super(panelBounds, boundsSpec);
    let contentSpec = rect(0, 0, 0.9, 1);
    super.installContentAndScrollbar(
      contentSpec,
      rect(0.9, 0, 0.1, 1),
      new ListMorph(this.subBounds(contentSpec), [], null),
    );
  }
  onSelect(selectFn) {
    this.contentPane.setSelectFn(selectFn);
  }
  setList(list) {
    this.contentPane.setList(list);
    this.scrollToTop();
  }
  setSelectionString(str, suppressAction) {
    this.contentPane.setSelectionString(str, suppressAction);
    // ** Needs scrollSelectionIntoView
  }
  static new(...args) {
    return new this(...args);
  }
}

//  TextPane
// ----------
// Scrollable TextMorph editor with dirty snapshot.
class TextPane extends ScrollPane {
  constructor(panelBounds, boundsSpec) {
    super(panelBounds, boundsSpec);
    this._savedTextSnapshot = null;
    let self = this;
    let contentSpec = rect(0, 0, 0.95, 1);
    super.installContentAndScrollbar(
      contentSpec,
      rect(0.95, 0, 0.05, 1),
      new TextMorph(this.subBounds(contentSpec), 'Text pane'),
      function () {
        self._savedTextSnapshot = self.contentPane.shape.string;
        self.contentPane.shape.editorID = null;
      },
    );
    this.setPaneMenu(TextPane.prototype.defaultPaneMenuSpec());
  }
  defaultPaneMenuSpec() {
    return {
      items: [
        'cut',
        'copy',
        'paste',
        'paste...',
        'do it',
        'printit',
        'find',
        'undo',
        menuSeparator,
        'save',
        'cancel',
      ],
      onSelect: function (item, pane) {
        let mor = pane.contentPane;
        if (!mor || !mor.shape) return;
        let tb = mor.shape;
        let world = pane.world();
        if (world) world.setKeyboardFocus(mor);
        if (isMenuSeparator(item)) return;
        if (item == 'paste...') {
          showPasteHistoryMenu(pane, tb);
          return;
        }
        if (item == 'cancel') {
          if (pane._savedTextSnapshot != null)
            pane.setText(pane._savedTextSnapshot, { force: true });
          return;
        }
        let evtStub = { preventDefault: function () {}, stopPropagation: function () {}, key: '' };
        let keyByItem = {
          cut: 'x',
          copy: 'c',
          paste: 'v',
          'do it': 'd',
          printit: 'p',
          find: 'f',
          undo: 'z',
          save: 's',
        };
        let k = keyByItem[item];
        if (!k) return;
        let priorScrollPos = pane.getScrollPosition ? pane.getScrollPosition() : null;
        let oldH = tb.extent.y;
        evtStub.key = k;
        tb.handleKeyboardShortcuts(evtStub);
        let newH = tb.extent.y;
        if (pane.onTextBoundsChanged && newH !== oldH) pane.onTextBoundsChanged(priorScrollPos);
      },
    };
  }
  hasUnsavedChanges() {
    if (this._savedTextSnapshot == null) return false;
    if (!this.contentPane || !this.contentPane.shape) return false;
    return this.contentPane.shape.string !== this._savedTextSnapshot;
  }
  onKeyDown(evt) {
    if (this.contentPane && this.contentPane.onKeyDown) return this.contentPane.onKeyDown(evt);
    return super.onKeyDown(evt);
  }
  onTextBoundsChanged(priorScrollPos) {
    this.onTextContentBoundsChanged(priorScrollPos, false);
  }
  setLocalStorageKey(key) {
    this.contentPane.shape.setLocalStorageKey(key);
  }
  setText(text, opts) {
    let force = opts && opts.force;
    if (!force && this.hasUnsavedChanges()) return false;
    let normalized = text != null ? String(text) : '';
    this.contentPane.setText(normalized);
    this._savedTextSnapshot = normalized;
    if (this.contentPane && this.contentPane.shape) this.contentPane.shape.editorID = null;
    this.scrollToTop();
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  TranscriptTextPane
// --------------------
// Append-only transcript; mirrors console quietly.
class TranscriptTextPane extends TextPane {
  constructor(panelBounds, boundsSpec) {
    ScrollPane.prototype.initialize.call(this, panelBounds, boundsSpec);
    this._savedTextSnapshot = '';
    this._consoleMirroring = false;
    this._transcriptReentry = 0;
    let self = this;
    let contentSpec = rect(0, 0, 0.95, 1);
    ScrollPane.prototype.installContentAndScrollbar.call(
      this,
      contentSpec,
      rect(0.95, 0, 0.05, 1),
      new TextMorph(this.subBounds(contentSpec), ''),
      function () {
        self._savedTextSnapshot = self.contentPane.shape.string;
      },
    );
    this.setPaneMenu(TextPane.prototype.defaultPaneMenuSpec());
  }
  _appendTranscriptLineQuiet(line) {
    /** Append one line without going through mirrored nextPut / noisy scroll path. */
    let cur = this.contentPane.shape.string || '';
    let add = (line == null ? '' : '' + line) + '\n';
    let next = this._truncateIfNeeded(cur + add);
    this.contentPane.setText(next);
    this._savedTextSnapshot = next;
    this._scrollTranscriptBottomQuiet();
  }
  _applyScrollQuiet(scrollPos) {
    /** Scroll without SliderMorph.setValue (mirror-safe). */
    let clipped = this._scrollContentTo(scrollPos);
    this.syncScrollBar(clipped, true);
  }
  _disconnectConsoleMirrorHard() {
    /** Unhook from console routing without guard (used from reentry bail and remove). */
    let arr = _transcriptConsoleTargets;
    if (arr) {
      let ix = arr.indexOf(this);
      if (ix >= 0) arr.splice(ix, 1);
    }
    this._consoleMirroring = false;
  }
  _scrollTranscriptBottomQuiet() {
    /** Scroll content to bottom without noisy scroll path (no console → no mirror re-entry). */
    let paneH = this.getBounds().height();
    let contentH = this.contentPane.getBounds().height();
    let slideRoom = Math.max(0, contentH - paneH);
    this._applyScrollQuiet(slideRoom > 0 ? 1 : 0);
  }
  _truncateIfNeeded(str) {
    let maxB = TRANSCRIPT_MAX_BEFORE_TRUNC;
    let keep = TRANSCRIPT_KEEP_LEN;
    if (str.length <= maxB) return str;
    return str.slice(str.length - keep);
  }
  clear() {
    this._transcriptReentry++;
    try {
      if (this._transcriptReentry >= 3) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_STOPPED);
        this._disconnectConsoleMirrorHard();
        return;
      }
      if (this._transcriptReentry >= 2) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_RECURSIVE);
        return;
      }
      this.contentPane.setText('');
      this._savedTextSnapshot = '';
      this.scrollToTop();
    } finally {
      this._transcriptReentry--;
      if (this._transcriptReentry < 0) this._transcriptReentry = 0;
    }
  }
  nextPut(str) {
    this._transcriptReentry++;
    try {
      if (this._transcriptReentry >= 3) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_STOPPED);
        this._disconnectConsoleMirrorHard();
        return;
      }
      if (this._transcriptReentry >= 2) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_RECURSIVE);
        return;
      }
      let cur = this.contentPane.shape.string || '';
      let add = str === undefined || str === null ? '' : '' + str;
      let next = this._truncateIfNeeded(cur + add);
      this.contentPane.setText(next);
      this._savedTextSnapshot = next;
      this.scrollTranscriptToBottom();
    } finally {
      this._transcriptReentry--;
      if (this._transcriptReentry < 0) this._transcriptReentry = 0;
    }
  }
  onTextBoundsChanged(priorScrollPos) {
    this.onTextContentBoundsChanged(priorScrollPos, true);
  }
  receivesConsoleOutput() {
    return !!this._consoleMirroring;
  }
  remove() {
    this._disconnectConsoleMirrorHard();
    return Morph.prototype.remove.call(this);
  }
  scrollTranscriptToBottom() {
    this._scrollTranscriptBottomQuiet();
  }
  setConsoleMirror(on) {
    // TODO: get this working again
    return;

    this._transcriptReentry++;
    try {
      if (this._transcriptReentry >= 3) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_STOPPED);
        this._disconnectConsoleMirrorHard();
        return;
      }
      if (this._transcriptReentry >= 2) {
        this._appendTranscriptLineQuiet(TRANSCRIPT_MARKER_RECURSIVE);
        return;
      }
      _ensureConsoleMirrorInstalled();
      let arr = _transcriptConsoleTargets;
      if (!arr) return;
      let want = !!on;
      let ix = arr.indexOf(this);
      if (want) {
        if (ix < 0) arr.push(this);
        this._consoleMirroring = true;
      } else {
        if (ix >= 0) arr.splice(ix, 1);
        this._consoleMirroring = false;
      }
    } finally {
      this._transcriptReentry--;
      if (this._transcriptReentry < 0) this._transcriptReentry = 0;
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

//  SliderMorph
// -------------
// 0..1 value slider; used in scroll panes and style panel.
class SliderMorph extends Morph {
  constructor(initialBounds, valueFn, optsIfAny) {
    let opts = optsIfAny || {};
    super(initialBounds);
    this.setColor(Color.gray);
    // Value and thumb are per-user ($value / $thumb): each user scrolls independently.
    this.valExtent = 0.1; // for when showing a range
    this.showsMenuButton = opts.menuButton !== false; // scrollbars: true; plain sliders: pass false
    this.menuButtonFraction = this.showsMenuButton ? 0.1 : 0;
    this.ensureThumb();
    if (this.showsMenuButton) {
      this.menuButton = this.addMorph(new Morph(rect(0, 0, 1, 1)));
      this.menuButton.setColor(Color.blue);
      this.menuButton.onPointerDown = function () {
        return false;
      }; // SliderMorph handles pane menu on pointer-down
    } else {
      this.menuButton = null;
    }
    this.emitValueFunction = valueFn;
    this.adjustForNewBounds();
  }
  adjustForNewBounds() {
    this.layoutMenuButton();
    this.syncThumbToValue();
  }
  clipValue(val) {
    return Math.round(Math.min(1.0, Math.max(0.0, val)) * 1000) / 1000;
  }
  ensureThumb() {
    // Per-user thumb: each replica lazily builds its own (my $-state is lost on reload).
    if (this.slider) {
      // Heal legacy documents whose thumb was a shared submorph.
      this.removeMorph(this.slider);
      this.slider = null;
    }
    if (this.$thumb && this.$thumb.owner === this) return this.$thumb;
    let thumb = new Morph(rect(0, 0, 10, 10));
    thumb.onPointerDown = function () {
      return false;
    }; // ignore blipper
    this.$thumb = thumb;
    this.addEphemeralMorph(thumb);
    this.styleSlider();
    return thumb;
  }
  getValue() {
    // By convention, my value ranges from 0.0 to 1.0; per-user, 0 until this user moves it
    return this.$value == null ? 0 : this.$value;
  }
  isVertical() {
    let bnds = this.shape.getBounds();
    return bnds.height() > bnds.width();
  }
  layoutMenuButton() {
    if (!this.showsMenuButton || !this.menuButton) return;
    let bnds = this.shape.getBounds();
    let frac = this.menuButtonFraction;
    if (this.isVertical()) {
      let topH = bnds.height() * frac;
      this.menuButton.setBounds(rect(0, 0, bnds.width(), topH));
    } else {
      let leftW = bnds.width() * frac;
      this.menuButton.setBounds(rect(0, 0, leftW, bnds.height()));
    }
  }
  onPointerDown(pt, evt) {
    //	Note: want setMouseFocus to also cache the transform and record the hitPoint.
    //	Ideally thereafter only have to say, eg, morph moveTo: evt.hand.adjustedMousePoint
    if (!this.includesPt(pt)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(pt)) return true;
    clearKeyboardFocusUnlessTypingOrOsk(this);
    // pt is in owner coords; convert to my local coords for testing the elevator (slider submorph)
    let localP = this.relativize(pt);
    if (this.menuButton && this.menuButton.includesPt(localP)) {
      let pane = this.owner;
      let world = this.world();
      if (pane && pane.instanceOf && pane.instanceOf(ScrollPane) && pane.paneMenu) {
        if (fleetingPaneMenuForScrollPane(world, pane)) removeFleetingPaneMenuFor(pane);
        else {
          let menu = pane.showPaneMenuFromMenuButton();
          if (menu) {
            let worldPt = pane.globalize(pt);
            world.setPointerFocus(menu);
            menu.hitPoint = worldPt;
            menu.actorID = evt.actorID;
            menu.shape.selectLineAt(menu.relativize(worldPt));
          }
        }
      }
      return true;
    }
    let track = this.trackBounds();
    if (!track.includesPt(localP)) return false;
    let thumb = this.ensureThumb();
    if (!thumb.includesPt(localP)) {
      let sliderBR = thumb.getBounds().bottomRight();
      if (localP.lePt(sliderBR)) this.tweakValue(-0.1);
      else this.tweakValue(0.1);
      return true;
    }
    this.hitPoint = pt;
    this.world().setPointerFocus(this);
    return true;
  }
  onPointerMove(pt, evt) {
    if (!this.hitPoint) return false;
    let localP = this.relativize(pt);
    let track = this.trackBounds();
    let ext = this.valExtent;
    let newValue;
    if (this.isVertical()) {
      let elevPix = Math.max(ext * track.height(), 6);
      newValue = (localP.y - track.topLeft.y - elevPix / 2) / (track.height() - elevPix);
    } else {
      let elevPix = Math.max(ext * track.width(), 6);
      newValue = (localP.x - track.topLeft.x - elevPix / 2) / (track.width() - elevPix);
    }
    this.$value = this.clipValue(newValue);
    if (this.valueTarget) this.valueTarget[this.valueMessage](this.$value);
    else this.emitValueFunction.call(this.owner, this.$value);
    this.syncThumbToValue();
    return true;
  }
  onPointerUp(pt, evt) {
    if (!this.includesPt(pt)) {
      if (this.hitPoint) {
        this.hitPoint = null;
        this.world().setPointerFocus(null);
        return true;
      }
      return false;
    }
    this.hitPoint = null;
    this.world().setPointerFocus(null);
    return true;
  }
  setBounds(newBounds) {
    super.setBounds(newBounds);
    this.adjustForNewBounds();
  }
  setValue(newValue) {
    this.$value = newValue;
    this.adjustForNewBounds();
  }
  setValueQuiet(newValue) {
    /** Update value + thumb without console (avoids re-entrancy when transcript mirrors console). */
    this.$value = newValue;
    this.syncThumbToValue();
  }
  setValueTarget(target, msgName) {
    this.valueTarget = target;
    this.valueMessage = msgName;
  }
  renderOn(ctx) {
    if (!this.$thumb) this.syncThumbToValue(); // lazily rebuild this user's thumb (e.g. after reload)
    super.renderOn(ctx);
  }
  styleSlider() {
    if (this.$thumb) this.$thumb.setColor(Color.green.darker());
  }
  syncThumbToValue() {
    /** Reposition thumb from my per-user value — no console (safe when console is mirrored to Transcript). */
    let thumb = this.ensureThumb();
    let bnds = this.shape.getBounds();
    let track = this.trackBounds();
    let ext = this.valExtent;
    let value = this.getValue();
    let topLeft;
    let sliderExt;
    if (this.isVertical()) {
      let elevPixV = Math.max(ext * track.height(), 6);
      topLeft = pt(0, track.topLeft.y + (track.height() - elevPixV) * value);
      sliderExt = pt(track.width(), elevPixV);
    } else {
      let elevPixH = Math.max(ext * track.width(), 6);
      topLeft = pt(track.topLeft.x + (track.width() - elevPixH) * value, track.topLeft.y);
      sliderExt = pt(elevPixH, track.height());
    }
    thumb.setBounds(bnds.topLeft.addPt(topLeft).extent(sliderExt));
  }
  test() {
    // SliderMorph.prototype.test()
    let readOut = Lively.addMorph(new TextMorph(rect(100, 300, 300, 100), 'slider values'));
    readOut.setColor(Color.blue);
    let sliderOpts = { menuButton: false };
    let sliderV = Lively.addMorph(
      new SliderMorph(
        rect(50, 100, 10, 200),
        (value) => readOut.setText('sliderV = ' + sliderV.getValue().toFixed(2)),
        sliderOpts,
      ),
    );
    let sliderH = Lively.addMorph(
      new SliderMorph(
        rect(100, 50, 200, 10),
        (value) => readOut.setText('sliderH = ' + sliderH.getValue().toFixed(2)),
        sliderOpts,
      ),
    );
  }
  trackBounds() {
    /** Track area; 10% reserved for pane menu button (top if vertical, left if horizontal). */
    let bnds = this.shape.getBounds();
    if (!this.showsMenuButton) return bnds.copy();
    let frac = this.menuButtonFraction;
    if (this.isVertical()) {
      let topH = bnds.height() * frac;
      return rect(0, topH, bnds.width(), Math.max(0, bnds.height() - topH));
    }
    let leftW = bnds.width() * frac;
    return rect(leftW, 0, Math.max(0, bnds.width() - leftW), bnds.height());
  }
  tweakValue(tweak) {
    this.setValue(this.clipValue(this.getValue() + tweak));
    if (this.valueTarget) this.valueTarget[this.valueMessage](this.$value);
    else this.emitValueFunction.call(this.owner, this.$value);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  HuePickerMorph
// ----------------
// 2D hue/brightness picker grid.
class HuePickerMorph extends Morph {
  constructor(initialBounds, onPickFn) {
    super(initialBounds, new ImageShape({ width: 64, height: 64 }));
    this.onPick = onPickFn;
    this.rebuildPickerImage();
  }
  applyPickAt(localP) {
    let color = this.pickColorAt(localP);
    if (color && this.onPick) this.onPick(color);
  }
  colorAtCell(col, row) {
    let cols = this.HUE_COLS;
    let half = this.HALF_ROWS;
    let h = (col + 0.5) / cols;
    if (row >= half) {
      let oldRow = row - half;
      let v = 1 - (oldRow + 0.5) / half;
      return hsvToColor(h, 1, v);
    }
    let t = half > 1 ? row / (half - 1) : 0;
    if (t <= 0) return Color.white.copy();
    return hsvToColor(h, t, 1 - 0.05 * t);
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    this.hitPoint = p;
    this.world().setPointerFocus(this);
    this.applyPickAt(this.relativize(p));
    return true;
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint) return false;
    this.applyPickAt(this.relativize(p));
    return true;
  }
  onPointerUp(p, evt) {
    this.hitPoint = null;
    if (this.world() && this.world().$pointerFocus === this) this.world().setPointerFocus(null);
    return true;
  }
  pickColorAt(localP) {
    let b = this.shape.getBounds();
    let cols = this.HUE_COLS;
    let rows = this.BRIGHTNESS_ROWS;
    let rel = localP.subPt(b.topLeft);
    if (rel.x < 0 || rel.y < 0 || rel.x >= b.width() || rel.y >= b.height()) return null;
    let col = Math.min(cols - 1, Math.max(0, Math.floor((rel.x / b.width()) * cols)));
    let row = Math.min(rows - 1, Math.max(0, Math.floor((rel.y / b.height()) * rows)));
    return this.colorAtCell(col, row);
  }
  rebuildPickerImage() {
    if (!this.shape || typeof document === 'undefined') return;
    let b = this.shape.getBounds();
    let wdt = Math.max(4, Math.round(b.width()));
    let hgt = Math.max(4, Math.round(b.height()));
    let cols = this.HUE_COLS;
    let rows = this.BRIGHTNESS_ROWS;
    let canvas = document.createElement('canvas');
    canvas.width = wdt;
    canvas.height = hgt;
    let ctx = canvas.getContext('2d');
    let cellW = wdt / cols;
    let cellH = hgt / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let c = this.colorAtCell(col, row);
        ctx.fillStyle = c.fillStyle;
        ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i < rows; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * cellH + 0.5);
      ctx.lineTo(wdt, i * cellH + 0.5);
      ctx.stroke();
    }
    this.shape.setImage(canvas);
    this.changed();
  }
  setBounds(rect) {
    super.setBounds(rect);
    this.rebuildPickerImage();
  }
  static new(...args) {
    return new this(...args);
  }
}

HuePickerMorph.prototype.HUE_COLS = 50;
HuePickerMorph.prototype.BRIGHTNESS_ROWS = 20;
HuePickerMorph.prototype.HALF_ROWS = 10;

//  StylePane
// -----------
// Inner lavender pane hosting style controls.
class StylePane extends Morph {
  constructor(bounds) {
    super(bounds, new Shape('Rectangle', bounds, Color.paleLavender, 2, Color.black));
  }
  addPaneControl(panelBounds, spec, morph, nudgeIfAny) {
    morph.boundsSpec = spec;
    if (nudgeIfAny) morph._stylePanelNudge = nudgeIfAny;
    morph.setPaneBoundsIn = function (pb) {
      let r = pb.scaleRect(this.boundsSpec);
      if (this._stylePanelNudge) r = r.translatedBy(this._stylePanelNudge);
      Morph.prototype.setPaneBoundsIn.call(this, r);
      if (this.rebuildPickerImage) this.rebuildPickerImage();
    };
    morph.setPaneBoundsIn(panelBounds);
    this.addMorph(morph);
    return morph;
  }
  makeAlphaCaption(panelBounds, spec) {
    return this.makeCaption(panelBounds, spec, '\u03B1', { insetX: 0, centerGlyph: true });
  }
  makeCaption(panelBounds, spec, text, opts) {
    opts = opts || {};
    let m = new TextMorph(rect(0, 0, 10, 10), text);
    m.shape.boxColor = Color.veryLightGray;
    m.shape.inset = pt(opts.insetX != null ? opts.insetX : 4, 0);
    m.shape.hang = 0;
    m.shape.lineHeight = 18;
    m.shape.verticallyCenterSingleLine = true;
    m.shape.verticalNudge = 6;
    if (opts.centerGlyph) m.shape.centerGlyph = true;
    if (opts.border) {
      m.shape.setBorderWidth(1);
      m.shape.setBorderColor(Color.black);
    }
    m.shape.disableSelectionRendering = true;
    m.shape.noMenuLineHighlight = true;
    return this.addPaneControl(panelBounds, spec, m, opts.nudge);
  }
  makeLabel(panelBounds, spec, text, nudgeIfAny) {
    return this.makeCaption(panelBounds, spec, text, { border: true, nudge: nudgeIfAny });
  }
  makeNoneButton(panelBounds, spec, onPress) {
    let btn = new SimpleButtonMorph(rect(0, 0, 10, 10), 'None');
    btn.shape.cornerRadius = 5;
    btn.shape.boxColor = Color.lightGray;
    btn.shape.setBorderWidth(1);
    btn.shape.setBorderColor(Color.darkGray);
    btn.shape.verticalNudge = 5;
    btn.onPointerUp = function (p, evt) {
      if (onPress) onPress();
      this.actorID = null;
      this.hitPoint = null;
      this.world().setPointerFocus(null);
      return true;
    };
    return this.addPaneControl(panelBounds, spec, btn, pt(0, 1));
  }
  paneLayoutBounds() {
    let b = this.shape.getBounds();
    let ins = this.CONTROL_INSET;
    return rect(
      b.topLeft.x + ins,
      b.topLeft.y + ins,
      Math.max(8, b.width() - 2 * ins),
      Math.max(8, b.height() - 2 * ins),
    );
  }
  setDirtyBorder(dirty) {
    let want = dirty ? Color.red : Color.black;
    let cur = this.shape.borderColor;
    if (cur && colorsEqual(cur, want)) return;
    this.shape.setBorderColor(want.copy());
    this.changed();
  }
  setPaneBoundsIn(panelBounds) {
    super.setPaneBoundsIn(panelBounds);
    let inner = this.paneLayoutBounds();
    this.submorphs.forEach((m) => {
      if (m.setPaneBoundsIn) m.setPaneBoundsIn(inner);
    });
  }
  static new(...args) {
    return new this(...args);
  }
}

StylePane.prototype.CONTROL_INSET = 3;

// +----------+
// |  Panels  |
// +----------+
// Titled windows: browser, inspector, style, method list, transcript.

function promptConfirmMenu(world, pt, titleLine, yesLine, noLine, onResult) {
  /** Fleeting yes/no confirm; title line is not selectable. */
  let menu = new MenuMorph(
    rect(pt.x, pt.y, Math.max(200, titleLine.length * 7), 112),
    [titleLine, yesLine, noLine],
    (item) => {
      menu.remove();
      onResult(item === yesLine);
    },
  );
  let bg = Color.yellow;
  menu.shape.boxColor = bg;
  menu.shape.fill = bg;
  world.addMorph(menu);
}
function promptOkToCancelEditsMenu(world, pt, onResult) {
  /** Menu: yes; cancel = discard edits & continue; NO = keep edits (abort). Title line acts like NO. */
  let titleLine = 'OK to cancel edits?';
  let okLine = '  yes; cancel';
  let keepLine = '  NO; keep the changes';
  let menu = new MenuMorph(rect(pt.x, pt.y, 160, 112), [titleLine, okLine, keepLine], (item) => {
    menu.remove();
    onResult(item === okLine);
  });
  let bg = Color.yellow;
  menu.shape.boxColor = bg;
  menu.shape.fill = bg;
  world.addMorph(menu);
}
//  PanelTitleBar
// ---------------
// Collapse/close/title chrome shared by panels.
class PanelTitleBar extends Morph {
  constructor(panel, bounds) {
    super(bounds);
    this.panel = panel;
    let th = this.HEIGHT;
    let bw = this.BUTTON_WIDTH;
    let b = this.shape.getBounds();
    this.collapseBtn = this.addMorph(new SimpleButtonMorph(rect(0, 0, bw, th), '▼'));
    this.closeBtn = this.addMorph(new SimpleButtonMorph(rect(0, 0, bw, th), 'X'));
    this.configureChromeButton(this.collapseBtn, Color.green.lighter().lighter(), '▼');
    this.configureChromeButton(this.closeBtn, Color.red.lighter().lighter(), 'X');
    this.titleMorph = this.addMorph(
      new TextMorph(rect(bw, 0, Math.max(1, b.width() - bw), th), 'A panel'),
    );
    let title = this.titleMorph.shape;
    title.boxColor = Color.lightGray.lighter();
    title.inset = pt(6, 0);
    title.hang = 0;
    title.lineHeight = th;
    title.verticallyCenterSingleLine = true;
    title.verticalNudge = 8;
    title.composeBottomPad = 0;
    this.layout();
  }
  collapsedTitleBarWidth() {
    let bw = this.BUTTON_WIDTH;
    let s = this.titleMorph.shape;
    let ctx = s.getTextContext(s.font);
    let tw = 0;
    if (ctx && s.string != null) tw = ctx.measureText(s.string).width;
    let insetL = s.inset ? s.inset.x : 6;
    let insetR = 6;
    return Math.max(bw + insetL + tw + insetR, bw + 24);
  }
  configureChromeButton(btn, fillColor, expectedLabel) {
    if (!btn || !btn.shape) return;
    let s = btn.shape;
    if (fillColor) {
      s.boxColor = fillColor;
      s.selectionColor = fillColor;
    }
    s.noMenuLineHighlight = true;
    s.disableSelectionRendering = true;
    s.$selectedLineIndex = 0;
    s.$selStart = null;
    s.$selStop = null;
    s.$priorNullSelection = 0;
    s.composeBottomPad = 0;
    s.lineHeight = this.HEIGHT;
    s.setBorderWidth(2);
    s.setBorderColor(Color.black);
    if (expectedLabel != null && s.string !== expectedLabel) s.setText(expectedLabel);
  }
  hasVisibleCloseBtn() {
    return !!(this.closeBtn && this.submorphs && this.submorphs.includes(this.closeBtn));
  }
  hitInfo(panelLocalP) {
    if (!this.includesPt(panelLocalP)) return null;
    let localP = this.relativize(panelLocalP);
    let onCollapse = this.collapseBtn && this.collapseBtn.includesPt(localP);
    let onClose = this.hasVisibleCloseBtn() && this.closeBtn.includesPt(localP);
    return { onCollapse, onClose };
  }
  layout() {
    let b = this.shape.getBounds();
    let th = this.HEIGHT;
    let bw = this.BUTTON_WIDTH;
    let panel = this.panel;
    this.titleMorph.shape.composeBottomPad = 0;
    this.configureChromeButton(this.collapseBtn, Color.green.lighter().lighter(), null);
    this.configureChromeButton(this.closeBtn, Color.red.lighter().lighter(), 'X');
    this.collapseBtn.setBounds(rect(b.topLeft.x, b.topLeft.y, bw, th));
    let hasCloseBtn = this.hasVisibleCloseBtn();
    if (panel.collapsed) {
      if (hasCloseBtn) this.removeMorph(this.closeBtn);
      this.titleMorph.setBounds(
        rect(b.topLeft.x + bw, b.topLeft.y, Math.max(1, b.width() - bw), th),
      );
    } else {
      if (this.closeBtn && !hasCloseBtn) this.addMorph(this.closeBtn);
      if (this.closeBtn)
        this.closeBtn.setBounds(rect(b.topLeft.x + b.width() - bw, b.topLeft.y, bw, th));
      this.titleMorph.setBounds(
        rect(b.topLeft.x + bw, b.topLeft.y, Math.max(1, b.width() - 2 * bw), th),
      );
    }
    this.titleMorph.shape.extent.y = th;
    this.collapseBtn.shape.extent.y = th;
    if (this.closeBtn && this.closeBtn.shape) this.closeBtn.shape.extent.y = th;
    if (this.hasVisibleCloseBtn()) {
      this.removeMorph(this.closeBtn);
      this.addMorph(this.closeBtn);
    }
    this.changed();
  }
  setCollapseGlyph(collapsed) {
    this.collapseBtn.shape.setText(collapsed ? '▶' : '▼');
  }
  setTitle(str) {
    if (!this.titleMorph || !this.titleMorph.shape || !this.titleMorph.shape.setText) return;
    this.titleMorph.shape.setText(str);
    let panel = this.panel;
    if (panel.collapsed) {
      let b = panel.getBounds();
      let nw = this.collapsedTitleBarWidth();
      panel.setBounds(rect(b.topLeft.x, b.topLeft.y, nw, PanelTitleBar.prototype.HEIGHT));
    } else {
      this.layout();
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

PanelTitleBar.prototype.HEIGHT = 24;
PanelTitleBar.prototype.BUTTON_WIDTH = 28;

//  PanelMorph
// ------------
// Titled panel: collapse, dirty prompts, pane layout.
class PanelMorph extends Morph {
  constructor(initialBounds) {
    super(initialBounds);
    this.titleBarHeight = PanelTitleBar.prototype.HEIGHT;
    this.titleButtonWidth = PanelTitleBar.prototype.BUTTON_WIDTH;
    this.collapsed = false;
    this._savedBounds = null;
    this._stashedContent = [];
    this.lastLocationExpanded = null;
    this.lastLocationCollapsed = null;
    this._stickyDragCollapsedBar = false;
    let b = this.shape.getBounds();
    this.titleBar = new PanelTitleBar(
      this,
      rect(b.topLeft.x, b.topLeft.y, b.width(), this.titleBarHeight),
    );
    this.addMorph(this.titleBar);
    this.collapseBtn = this.titleBar.collapseBtn;
    this.closeBtn = this.titleBar.closeBtn;
    this.titleMorph = this.titleBar.titleMorph;
  }
  acceptsDroppingMorphs() {
    return false;
  }
  applyCollapsedBarGridSnap() {
    let snap = this.collapsedBarGridSnap();
    if (snap.x !== 0 || snap.y !== 0) this.moveBy(snap);
    return snap;
  }
  beginTitleBarPress(p, evt, hitInfo) {
    this.hitPoint = p;
    this.didDrag = false;
    this.actorID = evt.actorID;
    this._closeBtnPressed = !!hitInfo.onClose;
    this._collapseBtnPressed = !hitInfo.onClose && !!hitInfo.onCollapse;
    this._titleBarDrag = !hitInfo.onClose && !hitInfo.onCollapse;
    this.world().setPointerFocus(this);
    return true;
  }
  boundsForNew(optionalRect) {
    /** Resolve optional bounds for panel {@link initialize}. */
    return optionalRect != null ? optionalRect : this.defaultRect();
  }
  clearTitleBarPress() {
    this.hitPoint = null;
    this._titleBarDrag = false;
    this._collapseBtnPressed = false;
    this._closeBtnPressed = false;
    this.didDrag = false;
    this.actorID = null;
    this.world().setPointerFocus(null);
  }
  collapsedBarGridSnap() {
    if (!this.collapsed) return pt(0, 0);
    let tl = this.getBounds().topLeft;
    return tl.gridBy(4).subPt(tl);
  }
  collapsedTitleBarWidth() {
    return this.titleBar ? this.titleBar.collapsedTitleBarWidth() : this.titleButtonWidth + 24;
  }
  contentMorphs() {
    return this.submorphs.filter((m) => m !== this.titleBar);
  }
  defaultRect() {
    return rect(400, 60, 400, 300);
  }
  finishStickyCollapsedTitleBarDrag(p, evt) {
    /** End first-collapse sticky drag: drop on pointerDown (not pointerUp). */
    if (!this._stickyDragCollapsedBar) return false;
    if (this.didDrag) {
      let worldDropPt = this.owner ? this.owner.globalize(p) : p;
      let anchorLocal = this.relativize(p);
      this.dropOnTopMorphAt(worldDropPt, anchorLocal);
    }
    if (this.collapsed) this.applyCollapsedBarGridSnap();
    this.savePanelLocation();
    this._stickyDragCollapsedBar = false;
    this.hitPoint = null;
    this.didDrag = false;
    this.actorID = null;
    this.world().setPointerFocus(null);
    return true;
  }
  hasVisibleCloseBtn() {
    return this.titleBar ? this.titleBar.hasVisibleCloseBtn() : false;
  }
  layoutChrome() {
    let b = this.shape.getBounds();
    this.titleBar.setBounds(rect(b.topLeft.x, b.topLeft.y, b.width(), this.titleBarHeight));
    this.titleBar.layout();
    this.changed();
  }
  menuAnchorPt(halfWidthOffset) {
    let tl = this.topLeftInWorld();
    let b = this.shape.getBounds();
    return tl.addPt(pt(Math.max(4, b.width() / 2 - halfWidthOffset), this.titleBarHeight + 16));
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    // first click only raises a buried panel,
    // except chrome buttons (collapse/delete) should act immediately.
    if (this.world().submorphs.at(-1) !== this) {
      let localP = this.relativize(p);
      let hitInfo = this.titleBarHitInfo(localP);
      let onCollapse = hitInfo && hitInfo.onCollapse;
      let onClose = hitInfo && hitInfo.onClose;
      this.beTopMorph();
      if (!onCollapse && !onClose) {
        // Same click should reach text/list in content; do not clear keyboard focus here.
        return super.onPointerDown(p, evt);
      }
      // else: continue to handle title bar press immediately
    }
    // except title hits get immediate action
    if (this.titleMorph.includesPt(p)) {
      return super.onPointerDown(p, evt);
    }
    let localP = this.relativize(p);
    let hitInfo = this.titleBarHitInfo(localP);
    if (hitInfo) return this.beginTitleBarPress(p, evt, hitInfo);
    return super.onPointerDown(p, evt);
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint) return false;
    if (
      (this._collapseBtnPressed || this._closeBtnPressed) &&
      !this._titleBarDrag &&
      !this._stickyDragCollapsedBar
    ) {
      this.hitPoint = p;
      return true;
    }
    if (!this._titleBarDrag && !this._stickyDragCollapsedBar) return false;
    let delta = p.subPt(this.hitPoint);
    this.moveBy(delta);
    if (delta.x !== 0 || delta.y !== 0) this.didDrag = true;
    this.hitPoint = p;
    if (this.collapsed) {
      let snap = this.applyCollapsedBarGridSnap();
      if (snap.x !== 0 || snap.y !== 0) this.hitPoint = this.hitPoint.addPt(snap);
    }
    return true;
  }
  onPointerUp(p, evt) {
    if (this._closeBtnPressed) {
      if (this.submorphHasUnsavedText(this)) {
        this.promptOkToCancelEdits((okToCancel) => {
          this.clearTitleBarPress();
          if (okToCancel) {
            this.revertUnsavedEdits();
            this.remove();
          }
        });
        return true;
      }
      this.remove();
    } else if (this._collapseBtnPressed) {
      if (this.submorphHasUnsavedText(this)) {
        let upP = p;
        this.promptOkToCancelEdits((okToCancel) => {
          if (!okToCancel) {
            this.clearTitleBarPress();
            return;
          }
          this.revertUnsavedEdits();
          this.toggleCollapse();
          if (this._stickyDragCollapsedBar) {
            this.hitPoint = upP;
            this.didDrag = false;
            this._collapseBtnPressed = false;
            return;
          }
          this.clearTitleBarPress();
        });
        return true;
      }
      this.toggleCollapse();
      if (this._stickyDragCollapsedBar) {
        this.hitPoint = p;
        this.didDrag = false;
        this._collapseBtnPressed = false;
        return true;
      }
    } else if (this._titleBarDrag) {
      if (this.didDrag) {
        let worldDropPt = this.owner ? this.owner.globalize(p) : p;
        let anchorLocal = this.relativize(p);
        this.dropOnTopMorphAt(worldDropPt, anchorLocal);
      }
      if (this.collapsed) this.applyCollapsedBarGridSnap();
      this.savePanelLocation();
    }
    if (this._titleBarDrag || this._collapseBtnPressed || this._closeBtnPressed) {
      this.clearTitleBarPress();
      return true;
    }
    return super.onPointerUp(p, evt);
  }
  onTextBoundsChanged() {
    this.setBounds(this.getBounds());
  }
  paneLayoutBounds() {
    let b = this.shape.getBounds();
    let th = this.titleBarHeight;
    // Content region in panel-local coords (shape origin is always 0,0 after setBounds)
    return rect(0, th, b.width(), Math.max(8, b.height() - th));
  }
  promptConfirm(titleLine, yesLine, noLine, onResult) {
    promptConfirmMenu(this.world(), this.menuAnchorPt(100), titleLine, yesLine, noLine, onResult);
  }
  promptOkToCancelEdits(onResult) {
    promptOkToCancelEditsMenu(this.world(), this.menuAnchorPt(150), onResult);
  }
  rectForSpawnedPanel(insetPx, minW, minH) {
    /** Bounds for a new world-level panel offset from this one (uses world coords; works when nested). */
    let ins = insetPx != null ? insetPx : 28;
    let tl = this.topLeftInWorld();
    let s = this.shape.getBounds();
    let bw = Math.max(minW != null ? minW : 320, s.width());
    let bh = Math.max(minH != null ? minH : 220, s.height());
    return tl.addPt(pt(ins, ins)).extent(pt(bw, bh));
  }
  relayoutContentPanes() {
    if (this.collapsed) return;
    let cb = this.paneLayoutBounds();
    this.contentMorphs().forEach((morph) => {
      if (morph.setPaneBoundsIn) morph.setPaneBoundsIn(cb);
    });
  }
  revertUnsavedEdits() {
    let walk = (m) => {
      if (m.className == 'TextPane' && m.hasUnsavedChanges && m._savedTextSnapshot != null)
        m.setText(m._savedTextSnapshot, { force: true });
      if (m.className == 'StylePanel' && m.revertStyle) m.revertStyle();
      (m.submorphs || []).forEach(walk);
    };
    walk(this);
  }
  savePanelLocation() {
    let r = this.getBounds().copy();
    if (this.collapsed) this.lastLocationCollapsed = r;
    else this.lastLocationExpanded = r;
  }
  setBounds(newBounds) {
    super.setBounds(newBounds);
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  setPanelTitle(str) {
    if (this.titleBar) this.titleBar.setTitle(str);
  }
  submorphHasUnsavedText(m) {
    if (m.className == 'TextPane' && m.hasUnsavedChanges()) return true;
    if (m.className == 'StylePanel' && m.hasUnsavedChanges && m.hasUnsavedChanges()) return true;
    let subs = m.submorphs || [];
    for (let i = 0; i < subs.length; i++) {
      if (this.submorphHasUnsavedText(subs[i])) return true;
    }
    return false;
  }
  titleBarHitInfo(localP) {
    return this.titleBar ? this.titleBar.hitInfo(localP) : null;
  }
  titleBarRect() {
    return this.titleBar ? this.titleBar.getBounds().copy() : rect(0, 0, 0, 0);
  }
  toggleCollapse() {
    if (this.collapsed) {
      this.lastLocationCollapsed = this.getBounds().copy();
      this.collapsed = false;
      this._stashedContent.forEach((m) => this.addMorph(m));
      clearArray(this._stashedContent);
      let r = null;
      if (this.lastLocationExpanded) r = this.lastLocationExpanded.copy();
      else if (this._savedBounds) r = this._savedBounds;
      if (r) this.setBounds(r);
      this._savedBounds = null;
      this.titleBar.setCollapseGlyph(false);
      this._stickyDragCollapsedBar = false;
    } else {
      let hasSavedCollapsedLocation = !!this.lastLocationCollapsed;
      this.lastLocationExpanded = this.getBounds().copy();
      this._savedBounds = this.getBounds().copy();
      this.contentMorphs().forEach((m) => {
        this._stashedContent.push(m);
        this.removeMorph(m);
      });
      this.collapsed = true;
      let b = this._savedBounds;
      let cw = this.collapsedTitleBarWidth();
      let cr = null;
      if (this.lastLocationCollapsed) {
        cr = this.lastLocationCollapsed.topLeft.extent(pt(cw, this.titleBarHeight));
      } else {
        cr = b.topLeft.extent(pt(cw, this.titleBarHeight));
      }
      super.setBounds(cr);
      this.titleBar.setCollapseGlyph(true);
      this._stickyDragCollapsedBar = !hasSavedCollapsedLocation;
    }
    this.layoutChrome();
  }
  topLeftInWorld() {
    /** World-space top-left of this panel's shape (for spawning child windows on the world). */
    return this.globalize(this.shape.getBounds().topLeft);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  MethodPanel
// -------------
// Single TextPane for method source or help.
class MethodPanel extends PanelMorph {
  constructor(initialBounds, string, optionalTitle) {
    /** Single full-height {@link TextPane} for method source or help text. */
    let text = string;
    // Hack to read from localStorage...
    if (optionalTitle && optionalTitle.startsWith('localStorage.'))
      text = localStorage.getItem(optionalTitle.slice(13));
    const bounds = initialBounds != null ? initialBounds : rect(400, 60, 400, 300);
    super(bounds);
    this.initTextPane(text != null ? text : '', optionalTitle);
  }
  initTextPane(string, optionalTitle) {
    let panelBounds = this.paneLayoutBounds();
    this.textPane = this.addMorph(new TextPane(panelBounds, rect(0.0, 0.0, 1.0, 1.0)));
    this.textPane.setText(string);
    if (optionalTitle.startsWith('localStorage.'))
      this.textPane.setLocalStorageKey(optionalTitle.slice(13));
    this.setPanelTitle(optionalTitle ? optionalTitle : 'Text Panel');
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  BrowserPanel
// --------------
// Class + method browser with list panes.
class BrowserPanel extends PanelMorph {
  constructor(initialBounds) {
    const bounds = initialBounds != null ? initialBounds : rect(400, 60, 400, 300);
    super(bounds);
    this.selectedClass = null;
    this.selectedMethod = null;
    this.initClassPane();
    this.initMessagePane();
    this.initMethodPane();
    this.setPanelTitle('System Browser');
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  deleteThisClass() {
    let className = this.selectedClassName();
    if (!className) return;
    if (!deleteClassNamed(className)) return;
    this.selectedClass = null;
    this.selectedMethod = null;
    this.classPane.setList(['globals'].concat(allClassNamesWithStatics()));
    if (this.messagePane) this.messagePane.setList(['message names']);
    if (this.methodPane) this.methodPane.setText('Method text', { force: true });
    this.updateBrowserTitle();
  }
  deleteThisMethod() {
    let spec = this.selectedMethodSpec();
    if (!spec) return;
    if (!deleteMethodWithSpec(spec)) return;
    this.selectedMethod = null;
    if (this.methodPane) this.methodPane.setText('Method text', { force: true });
    this.refreshMessageListForSelectedClass();
    this.updateBrowserTitle();
  }
  exportMethodCopyToOSPaste() {
    let exportText = this.methodCopyText();
    if (!exportText) return;
    addPasteBufferItem(exportText);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(exportText).catch(() => {});
  }
  exportThisClassToOSPaste() {
    if (!this.selectedClass) return;
    let classSelection = this.selectedClass;
    if (classSelection == 'globals') return;
    let exportText = exportStringForSelection(classSelection, {
      includeHeader: true,
      includeClassDef: true,
    });
    if (!exportText) return;
    addPasteBufferItem(exportText);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(exportText).catch(() => {});
  }
  initClassPane() {
    /** Class list (upper-left) in the system browser. */
    let panelBounds = this.paneLayoutBounds();
    this.classPane = this.addMorph(new ListPane(panelBounds, rect(0.0, 0.0, 0.4, 0.4)));
    this.classPane.setList(['globals'].concat(allClassNamesWithStatics()));
    this.classPane.setPaneMenu(classSelectorPaneMenuSpec(this));
    this.classPane.onSelect((classSelection) => {
      let applyClass = () => {
        console.log('this.classOrInst = ' + classSelection);
        this.selectedClass = classSelection;
        this.selectedMethod = null;
        this.updateBrowserTitle();
        this.messagePane.setList(this.messageListForSelection(classSelection));
      };
      if (this.methodPane && this.methodPane.hasUnsavedChanges()) {
        if (this.selectedClass != null && classSelection === this.selectedClass) return;
        this.promptOkToCancelEdits((okToCancel) => {
          if (!okToCancel) {
            if (this.selectedClass != null)
              this.classPane.setSelectionString(this.selectedClass, true);
            if (this.selectedMethod != null)
              this.messagePane.setSelectionString(this.selectedMethod, true);
            return;
          }
          this.methodPane.setText('Method text', { force: true });
          applyClass();
        });
        return;
      }
      applyClass();
    });
  }
  initMessagePane() {
    /** Method name list (upper-right) in the system browser. */
    let panelBounds = this.paneLayoutBounds();
    this.messagePane = this.addMorph(new ListPane(panelBounds, rect(0.4, 0.0, 0.6, 0.4)));
    this.messagePane.setList(['message names']);
    this.messagePane.setPaneMenu(methodSelectorPaneMenuSpec(this));
    this.messagePane.onSelect((methodSelection, shiftKey) => {
      let applyMethod = () => {
        console.log('this.selectedMethod = ' + methodSelection);
        this.selectedMethod = methodSelection;
        this.updateBrowserTitle();
        let methodString = null;
        let headerString = null;
        if (this.selectedClass == 'globals') {
          methodString = $global[this.selectedMethod].toString();
          headerString = this.selectedMethod + ' = ';
        } else if (this.selectedClass.endsWith('.class')) {
          methodString = $global[this.classOnly][this.selectedMethod].toString();
          headerString = this.classOnly + '.' + this.selectedMethod + ' = ';
        } else {
          methodString = $global[this.selectedClass].prototype[this.selectedMethod].toString();
          headerString = this.selectedClass + '.prototype.' + this.selectedMethod + ' = ';
        }
        this.methodPane.setText(headerString + methodString, { force: true });
      };
      if (this.methodPane && this.methodPane.hasUnsavedChanges()) {
        if (this.selectedMethod != null && methodSelection === this.selectedMethod) return;
        this.promptOkToCancelEdits((okToCancel) => {
          if (!okToCancel) {
            if (this.selectedMethod != null)
              this.messagePane.setSelectionString(this.selectedMethod, true);
            return;
          }
          applyMethod();
        });
        return;
      }
      applyMethod();
    });
  }
  initMethodPane() {
    /** Editable method source (lower) in the system browser. */
    let panelBounds = this.paneLayoutBounds();
    this.methodPane = this.addMorph(new TextPane(panelBounds, rect(0.0, 0.4, 1.0, 0.6)));
    this.methodPane.setText('Method text');
  }
  methodCopyText() {
    if (!this.methodPane || !this.methodPane.contentPane) return null;
    let text = this.methodPane.contentPane.shape.string;
    if (!text || text === 'Method text') return null;
    return text;
  }
  methodCopyTitle() {
    if (this.selectedClass && this.selectedMethod)
      return this.selectedClass + ' ' + this.selectedMethod;
    return 'Method copy';
  }
  promptDeleteThisClass() {
    let className = this.selectedClassName();
    if (!className) return;
    this.promptConfirm('Do you really want to delete ' + className + '?', ' yes', ' NO', (ok) => {
      if (ok) this.deleteThisClass();
    });
  }
  promptDeleteThisMethod() {
    let spec = this.selectedMethodSpec();
    if (!spec) return;
    this.promptConfirm('Do you really want to delete ' + spec + '?', ' yes', ' NO', (ok) => {
      if (ok) this.deleteThisMethod();
    });
  }
  messageListForSelection(classSelection) {
    /** Names shown in the message pane for a class-pane selection. */
    if (classSelection == 'globals') {
      // Lowercase-first names only: classes get their own list entries.
      return Object.getOwnPropertyNames($global)
        .sort()
        .filter((msg) => msg[0] == msg[0].toLowerCase());
    }
    if (classSelection.endsWith('.class')) {
      this.classOnly = classSelection.split('.')[0];
      return classStaticNames($global[this.classOnly]);
    }
    return classInstanceMemberNames($global[classSelection]);
  }
  refreshMessageListForSelectedClass() {
    if (!this.selectedClass || !this.messagePane) return;
    this.messagePane.setList(this.messageListForSelection(this.selectedClass));
  }
  selectedClassName() {
    if (!this.selectedClass || this.selectedClass == 'globals') return null;
    if (this.selectedClass.endsWith('.class')) return this.selectedClass.split('.')[0];
    return this.selectedClass;
  }
  selectedMethodSpec() {
    if (!this.selectedMethod) return null;
    if (this.selectedClass == 'globals') return this.selectedMethod;
    if (this.selectedClass && this.selectedClass.endsWith('.class'))
      return this.selectedClass.split('.')[0] + '.' + this.selectedMethod;
    if (this.selectedClass) return this.selectedClass + '.prototype.' + this.selectedMethod;
    return null;
  }
  spawnMethodCopyToWindow() {
    let text = this.methodCopyText();
    if (!text) return;
    Lively.addMorph(
      new MethodPanel(this.rectForSpawnedPanel(28, 320, 220), text, this.methodCopyTitle()),
    );
  }
  spawnThisClassToWindow() {
    if (!this.selectedClass || this.selectedClass == 'globals') return;
    let text = exportStringForSelection(this.selectedClass, {
      includeHeader: true,
      includeClassDef: true,
    });
    if (!text) return;
    Lively.addMorph(
      new MethodPanel(this.rectForSpawnedPanel(28, 320, 220), text, this.selectedClass),
    );
  }
  updateBrowserTitle() {
    let t = 'System Browser';
    if (this.selectedClass) t = this.selectedClass;
    if (this.selectedMethod) t = this.selectedClass + ' ' + this.selectedMethod;
    this.setPanelTitle(t);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  StylePanel
// ------------
// Live style editor (fill, stroke, width) for a morph.
class StylePanel extends PanelMorph {
  constructor(initialBounds, target) {
    const bounds = initialBounds != null ? initialBounds : rect(400, 80, 280, 340);
    const styleSnapshot = copyStyleSnapshot(styleSnapshotFromMorph(target));
    super(bounds);
    this.target = target;
    this._styleSnapshot = styleSnapshot;
    this.styleState = copyStyleSnapshot(styleSnapshot);
    this.initControls();
    let title = target && target.className ? target.className : 'Morph';
    this.setPanelTitle('Style: ' + title);
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  applyStyleToTarget() {
    if (!this.target || !this.target.shape) return;
    applyStyleSnapshotToMorph(this.target, this.styleState);
  }
  defaultRect() {
    return rect(400, 80, 280, 340);
  }
  ensureLineWidthForColor() {
    if (this.styleState.borderColor && this.styleState.borderWidth === 0)
      this.styleState.borderWidth = morphDefaultLineWidth(this.target);
  }
  hasUnsavedChanges() {
    if (!this._styleSnapshot || !this.styleState) return false;
    return !styleSnapshotsEqual(this.styleState, this._styleSnapshot);
  }
  initControls() {
    let outer = super.paneLayoutBounds();
    this.stylePane = new StylePane(outer);
    this.stylePane.stylePanel = this;
    this.addMorph(this.stylePane);
    let pane = this.stylePane;
    let panelBounds = pane.paneLayoutBounds();
    let panel = this;
    let alphaW = 0.06;
    let alphaX = 1 - alphaW;
    let pickerW = alphaX - 0.01;
    let capH = 0.07;
    let pickH = 0.28;
    pane.makeLabel(panelBounds, rect(0, 0, 0.12, capH), 'Fill');
    pane.makeNoneButton(panelBounds, rect(0.14, 0, 0.14, capH), () => {
      panel.styleState.fillColor = null;
      panel.previewStyleEdit();
    });
    pane.makeAlphaCaption(panelBounds, rect(alphaX, 0, alphaW, capH));
    this.fillPicker = pane.addPaneControl(
      panelBounds,
      rect(0, capH, pickerW, pickH),
      new HuePickerMorph(rect(0, 0, 64, 64), (color) => {
        panel.styleState.fillColor = color.copy();
        panel.previewStyleEdit();
      }),
    );
    this.fillAlphaSlider = pane.addPaneControl(
      panelBounds,
      rect(alphaX, capH, alphaW, pickH),
      new SliderMorph(
        rect(0, 0, 10, 40),
        (val) => {
          panel.styleState.fillAlpha = val;
          panel.previewStyleEdit();
        },
        { menuButton: false },
      ),
    );
    pane.makeLabel(panelBounds, rect(0, 0.37, 0.12, capH), 'Line');
    pane.makeNoneButton(panelBounds, rect(0.14, 0.37, 0.14, capH), () => {
      panel.styleState.borderColor = null;
      panel.styleState.borderWidth = 0;
      panel.previewStyleEdit();
      panel.syncSlidersFromState();
    });
    pane.makeAlphaCaption(panelBounds, rect(alphaX, 0.37, alphaW, capH));
    this.linePicker = pane.addPaneControl(
      panelBounds,
      rect(0, 0.44, pickerW, pickH),
      new HuePickerMorph(rect(0, 0, 64, 64), (color) => {
        panel.styleState.borderColor = color.copy();
        panel.ensureLineWidthForColor();
        panel.previewStyleEdit();
        panel.syncSlidersFromState();
      }),
    );
    this.lineAlphaSlider = pane.addPaneControl(
      panelBounds,
      rect(alphaX, 0.44, alphaW, pickH),
      new SliderMorph(
        rect(0, 0, 10, 40),
        (val) => {
          panel.styleState.borderAlpha = val;
          panel.previewStyleEdit();
        },
        { menuButton: false },
      ),
    );
    this.lineWidthLabel = pane.makeLabel(
      panelBounds,
      rect(0, 0.76, 0.55, 0.07),
      lineWidthCaptionText(panel.styleState.borderWidth),
      pt(0, -3),
    );
    this.widthSlider = pane.addPaneControl(
      panelBounds,
      rect(0, 0.83, 1, 0.035),
      new SliderMorph(
        rect(0, 0, 80, 10),
        (val) => {
          panel.styleState.borderWidth = roundLineWidth(val * 20);
          if (panel.styleState.borderWidth > 0 && !panel.styleState.borderColor)
            panel.styleState.borderColor = Color.black.copy();
          panel.previewStyleEdit();
          panel.updateLineWidthCaption();
        },
        { menuButton: false },
      ),
    );
    this.revertBtn = pane.addPaneControl(
      panelBounds,
      rect(0.1, 0.9, 0.36, 0.055),
      new SimpleButtonMorph(rect(0, 0, 10, 10), 'Revert'),
    );
    this.titleBar.configureChromeButton(this.revertBtn, Color.orange.lighter(), 'Revert');
    this.styleActionButton(this.revertBtn);
    this.revertBtn.onPointerUp = function (p, evt) {
      panel.revertStyle();
      this.actorID = null;
      this.hitPoint = null;
      this.world().setPointerFocus(null);
      return true;
    };
    this.saveBtn = pane.addPaneControl(
      panelBounds,
      rect(0.54, 0.9, 0.36, 0.055),
      new SimpleButtonMorph(rect(0, 0, 10, 10), 'Save'),
    );
    this.titleBar.configureChromeButton(this.saveBtn, Color.green.lighter().lighter(), 'Save');
    this.styleActionButton(this.saveBtn);
    this.saveBtn.onPointerUp = function (p, evt) {
      panel.saveStyle();
      this.actorID = null;
      this.hitPoint = null;
      this.world().setPointerFocus(null);
      return true;
    };
    this.syncSlidersFromState();
    this.refreshDirtyBorder();
  }
  noteStyleEdited() {
    this.refreshDirtyBorder();
  }
  previewStyleEdit() {
    this.applyStyleToTarget();
    this.noteStyleEdited();
  }
  refreshDirtyBorder() {
    if (this.stylePane) this.stylePane.setDirtyBorder(this.hasUnsavedChanges());
  }
  revertStyle() {
    if (!this._styleSnapshot) return;
    this.styleState = copyStyleSnapshot(this._styleSnapshot);
    this.applyStyleToTarget();
    this.syncSlidersFromState();
    this.refreshDirtyBorder();
  }
  saveStyle() {
    this._styleSnapshot = copyStyleSnapshot(this.styleState);
    this.refreshDirtyBorder();
  }
  styleActionButton(btn) {
    let s = btn.shape;
    s.cornerRadius = 5;
    s.setBorderWidth(1);
    s.setBorderColor(Color.darkGray);
    s.lineHeight = 16;
    s.verticalNudge = 4;
  }
  syncSlidersFromState() {
    if (this.fillAlphaSlider) this.fillAlphaSlider.setValueQuiet(this.styleState.fillAlpha);
    if (this.lineAlphaSlider) this.lineAlphaSlider.setValueQuiet(this.styleState.borderAlpha);
    if (this.widthSlider)
      this.widthSlider.setValueQuiet(Math.min(1, this.styleState.borderWidth / 20));
    this.updateLineWidthCaption();
  }
  updateLineWidthCaption() {
    if (!this.lineWidthLabel) return;
    this.lineWidthLabel.setText(lineWidthCaptionText(this.styleState.borderWidth));
    this.lineWidthLabel.changed();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  InspectorPanel
// ----------------
// Variable list + print-it pane for one object.
class InspectorPanel extends PanelMorph {
  constructor(initialBounds, target) {
    const bounds = initialBounds != null ? initialBounds : rect(500, 100, 300, 300);
    super(bounds);
    this.target = target;
    this.varValue = null;
    this.selectedVarName = null;
    this.initVarsPane();
    this.initPrintAndEvalPanes();
    this.setPanelTitle('Inspector ' + this.target.className);
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  defaultRect() {
    return rect(500, 100, 300, 300);
  }
  initPrintAndEvalPanes() {
    /** Print-it and eval panes (right / bottom) in the inspector. */
    let panelBounds = this.paneLayoutBounds();
    this.printPane = this.addMorph(new TextPane(panelBounds, rect(0.3, 0.0, 0.7, 0.6)));
    this.printPane.setText('Var value asString()');
    this.evalPane = this.addMorph(new TextPane(panelBounds, rect(0.0, 0.6, 1.0, 0.4)));
    this.evalPane.setText('Eval here with this bound to this ' + this.target.className);
    this.evalPane.contentPane.setWorkspaceObj(this.target);
  }
  initVarsPane() {
    /** Instance variable list (left) in the inspector. */
    let panelBounds = this.paneLayoutBounds();
    this.varsPane = this.addMorph(new ListPane(panelBounds, rect(0.0, 0.0, 0.3, 0.6)));
    this.varsPane.setList(Object.getOwnPropertyNames(this.target));
    this.varsPane.setPaneMenu({
      items: ['inspect selected value'],
      onSelect: (item, pane) => {
        if (item == 'inspect selected value' && this.selectedVarName != null)
          this.showSelectedValue(true, null);
      },
    });
    this.varsPane.onSelect((varName, shiftKey) => {
      let applyVar = (printOpts) => {
        this.selectedVarName = varName;
        this.showSelectedValue(shiftKey, printOpts);
      };
      if (this.printPane && this.printPane.hasUnsavedChanges()) {
        if (this.selectedVarName != null && varName === this.selectedVarName) return;
        this.promptOkToCancelEdits((okToCancel) => {
          if (!okToCancel) {
            if (this.selectedVarName != null)
              this.varsPane.setSelectionString(this.selectedVarName, true);
            return;
          }
          applyVar({ force: true });
        });
        return;
      }
      applyVar(null);
    });
  }
  showSelectedValue(shiftKey, printOpts) {
    if (!this.selectedVarName) return;
    this.varValue = this.target[this.selectedVarName];
    if (shiftKey) {
      inspect(this.varValue, this.rectForSpawnedPanel(28, 320, 220));
    } else {
      this.printPane.setText(inspectString(this.varValue), printOpts);
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

//  MethodListPanel
// -----------------
// Search hits or recent changes as a method list.
class MethodListPanel extends PanelMorph {
  constructor(initialBounds, methodSpecs, recentMethodsIfAny, optionalTitle, searchStringIfAny) {
    const bounds = initialBounds != null ? initialBounds : rect(400, 60, 400, 300);
    super(bounds);
    this.methodSpecs = methodSpecs;
    this.recents = recentMethodsIfAny;
    this.searchString = searchStringIfAny || null;
    this._occurrenceLastSpec = null;
    this.initMethodsPane();
    this.initPrintPane();
    this.setPanelTitle(optionalTitle || 'Method list');
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  deleteThisMethod() {
    let spec = this.selectedMethodSpec();
    if (!spec) return;
    if (!deleteMethodWithSpec(spec)) return;
    if (this.methodSpecs) {
      this.methodSpecs = this.methodSpecs.filter((s) => methodSpecKey(s) !== spec);
      this.methodsPane.setList(this.methodSpecs);
    }
    if (this.printPane) this.printPane.setText('Selected method', { force: true });
    this._occurrenceLastSpec = null;
  }
  exportMethodCopyToOSPaste() {
    let exportText = this.methodCopyText();
    if (!exportText) return;
    addPasteBufferItem(exportText);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(exportText).catch(() => {});
  }
  initMethodsPane() {
    /** Method-spec list (upper) for search results and recent changes. */
    let panelBounds = this.paneLayoutBounds();
    this.methodsPane = this.addMorph(new ListPane(panelBounds, rect(0.0, 0.0, 1.0, 0.4)));
    this.methodsPane.setList(this.methodSpecs);
    this.methodsPane.setPaneMenu(methodSelectorPaneMenuSpec(this));
    this.methodsPane.onSelect((spec, shiftKey) => {
      let applySpec = () => {
        let methodString = null;
        let preamble = null;
        if (spec.includes('[')) {
          methodString = this.methodFromRecentSpec(spec);
          preamble = spec.slice(0, spec.indexOf('[') - 1) + ' = ';
        } else {
          methodString = methodFromSpec(spec);
          preamble = spec + ' = ';
        }
        this.printPane.setText(preamble + methodString, { force: true });
        this._occurrenceLastSpec = spec;
        if (this.searchString)
          this.printPane.contentPane.shape.selectSearchString(this.searchString);
        if (shiftKey) {
          Lively.addMorph(
            new MethodPanel(this.rectForSpawnedPanel(28, 320, 220), preamble + methodString, spec),
          );
        }
      };
      if (this.printPane && this.printPane.hasUnsavedChanges()) {
        if (this._occurrenceLastSpec != null && spec === this._occurrenceLastSpec) return;
        this.promptOkToCancelEdits((okToCancel) => {
          if (!okToCancel) {
            if (this._occurrenceLastSpec != null)
              this.methodsPane.setSelectionString(this._occurrenceLastSpec, true);
            return;
          }
          applySpec();
        });
        return;
      }
      applySpec();
    });
  }
  initPrintPane() {
    /** Method source preview (lower) for search / recent-changes panels. */
    let panelBounds = this.paneLayoutBounds();
    this.printPane = this.addMorph(new TextPane(panelBounds, rect(0.0, 0.4, 1.0, 0.6)));
    this.printPane.setText('Selected method');
  }
  methodCopyText() {
    if (!this.printPane || !this.printPane.contentPane) return null;
    let text = this.printPane.contentPane.shape.string;
    if (!text || text === 'Selected method') return null;
    return text;
  }
  methodCopyTitle() {
    return this._occurrenceLastSpec || 'Method copy';
  }
  methodFromRecentSpec(spec) {
    let found = null;
    if (!this.recents) return found;
    this.recents.forEach((tuple) => {
      if (tuple[0] + tuple[1] == spec) found = tuple[2];
    });
    return found;
  }
  promptDeleteThisMethod() {
    let spec = this.selectedMethodSpec();
    if (!spec) return;
    this.promptConfirm('Do you really want to delete ' + spec + '?', ' yes', ' NO', (ok) => {
      if (ok) this.deleteThisMethod();
    });
  }
  selectedMethodSpec() {
    if (this._occurrenceLastSpec) return methodSpecKey(this._occurrenceLastSpec);
    let text = this.methodCopyText();
    if (!text) return null;
    let ix = text.indexOf(' =');
    if (ix < 0) return null;
    return text.slice(0, ix).trim();
  }
  spawnMethodCopyToWindow() {
    let text = this.methodCopyText();
    if (!text) return;
    Lively.addMorph(
      new MethodPanel(this.rectForSpawnedPanel(28, 320, 220), text, this.methodCopyTitle()),
    );
  }
  static new(...args) {
    return new this(...args);
  }
}

//  ErrorStackPanel
// -----------------
// Error stack browser with frame list and source pane.
class ErrorStackPanel extends MethodListPanel {
  constructor(initialBounds, err, contextIfAny, optionalTitle) {
    const stackFrames = stackFramesFromError(err);
    const specs = stackFrames.map(function (f) {
      return f.listLabel;
    });
    super(initialBounds, specs, null, optionalTitle || errorPanelTitle(err), null);
    // The raw host Error is per-replica (not representable in the document).
    this.$errorErr = err;
    this.errorContext = contextIfAny;
    this.stackFrames = stackFrames;
    if (this.printPane)
      this.printPane.setText(
        errorReportHeader(err, contextIfAny) + '\n\n// Select a stack frame above',
        { force: true },
      );
    let self = this;
    this.methodsPane.onSelect(function (label, shiftKey) {
      let idx = self.methodSpecs.indexOf(label);
      if (idx >= 0) self.showStackFrame(idx);
      if (shiftKey && idx >= 0 && self.printPane) {
        let text = self.printPane.contentPane.shape.string;
        Lively.addMorph(new MethodPanel(self.rectForSpawnedPanel(28, 320, 220), text, label));
      }
    });
    if (this.stackFrames.length) this.methodsPane.setSelectionString(this.methodSpecs[0]);
  }
  refreshStackSources() {
    let idx = this.methodSpecs.indexOf(this._occurrenceLastSpec);
    if (idx < 0 && this.stackFrames.length) idx = 0;
    if (idx >= 0) this.showStackFrame(idx);
  }
  showStackFrame(index) {
    let frame = this.stackFrames[index];
    if (!frame || !this.printPane) return;
    frame.sourceText = stackFrameSourceText(frame);
    let text = frame.sourceText || '// source not available for ' + frame.listLabel;
    this.printPane.setText(text, { force: true });
    this._occurrenceLastSpec = this.methodSpecs[index];
    if (index > 0 && this.printPane.contentPane && this.printPane.contentPane.shape) {
      let hl = stackFrameHighlightName(this.stackFrames[index - 1]);
      if (hl) this.printPane.contentPane.shape.selectSearchString(hl);
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

//  TranscriptPanelMorph
// ----------------------
// Panel hosting a TranscriptTextPane.
class TranscriptPanelMorph extends PanelMorph {
  constructor(initialBounds) {
    super(initialBounds);
    let panelBounds = this.paneLayoutBounds();
    this.transcriptPane = this.addMorph(new TranscriptTextPane(panelBounds, rect(0, 0, 1, 1)));
    this.setPanelTitle('Transcript');
    this.layoutChrome();
    this.relayoutContentPanes();
  }
  clear() {
    if (this.transcriptPane) this.transcriptPane.clear();
  }
  nextPut(str) {
    if (this.transcriptPane) this.transcriptPane.nextPut(str);
  }
  receivesConsoleOutput() {
    return this.transcriptPane && this.transcriptPane.receivesConsoleOutput();
  }
  setConsoleMirror(on) {
    if (this.transcriptPane) this.transcriptPane.setConsoleMirror(on);
  }
  static new(...args) {
    return new this(...args);
  }
}

// +---------+
// |  Halos  |
// +---------+
// Meta-click halo ring and its affordance handles.

//  HaloHandle
// ------------
// One halo affordance (move, rotate, copy, …).
class HaloHandle extends Morph {
  constructor(index, iconLetter, handleName, halo) {
    super(null, this.makeHandleShape(index, iconLetter, halo));
    this.halo = halo;
    this.handleName = handleName;
    let m = halo.handleLetterMetrics();
    let localBounds = this.shape.getBounds();
    let c = localBounds.center();
    let letterBounds = rect(c.x - m.letterW / 2, c.y - m.letterH / 2, m.letterW, m.letterH);
    this.letterMorph = this.addMorph(new TextMorph(letterBounds, iconLetter));
    let letter = this.letterMorph.shape;
    letter.font = m.font;
    letter.lineHeight = m.lineHeight;
    letter.setStyles(null, 0, null);
    letter.boxColor = null;
    if (iconLetter != 'I') letter.moveBy(m.nudge);
    letter.$selectedLineIndex = 0;
    letter.$selStart = null;
    letter.$selStop = null;
  }
  makeHandleShape(index, iconLetter, halo) {
    let radius = 10;
    let center = halo.handleCenterForIndex(index);
    let handleShape = new Ellipse(center, radius);
    let chrome = halo.handleChromeStyle();
    handleShape.setStyles(chrome.fill, chrome.borderWidth, chrome.borderColor);
    return handleShape;
  }
  onPointerDown(pt, evt) {
    if (!this.includesPt(pt)) return false;
    this.hitPoint = pt; // set for pointerDownOnHandle (e.g. Rotate) and for drag handles
    if (['Menu', 'Style', 'Browse', 'Inspect', 'Delete'].includes(this.handleName))
      return this.halo.pointerDownOnHandle(this, pt, evt);
    // These handles become active handles on the target
    this.target = this.halo.target;
    if (this.handleName == 'Copy') {
      let copy = this.target.morphCopy();
      copy.reparentToOwnerPreservingWorldAnchor(this.world(), null);
      this.target = copy;
    }
    if (this.handleName == 'Grab') {
      this.target.reparentToOwnerPreservingWorldAnchor(this.world(), null);
    }
    // Drag, Rotate and Scale here drag the handle during manipulation
    this.hitPoint = this.owner.globalize(pt);
    if (this.handleName == 'Rotate') {
      // Pivot is the shape center's true world position (rotateBy keeps it fixed).
      let c = this.target.globalize(this.target.shape.getBounds().center());
      this.rotateStartAngle = Math.atan2(this.hitPoint.y - c.y, this.hitPoint.x - c.x);
    }
    if (this.handleName == 'Scale') {
      let b = this.target.getBounds();
      this.scaleStartTopLeft = b.topLeft.copy();
      this.scaleStartBottomRight = b.bottomRight().copy();
      let ow = this.target.owner;
      this.scaleStartTopLeftWorld = ow
        ? ow.globalize(this.scaleStartTopLeft)
        : this.scaleStartTopLeft.copy();
      this.scaleStartBottomRightWorld = ow
        ? ow.globalize(this.scaleStartBottomRight)
        : this.scaleStartBottomRight.copy();
      this.scaleTransformDrag = effectiveShiftKey(evt);
      this.scaleStartTransform = this.target.transform.scale.copy();
    }
    let worldTopLeft = this.owner.getBounds().topLeft.addPt(this.getBounds().topLeft); // handle topLeft in world before reparent
    this.world().addEphemeralMorph(this); // handle owner was halo; now world (per-user, like the halo itself)
    this.transform.translation = worldTopLeft.subPt(this.shape.getBounds().topLeft); // set world position so topLeft stays at worldTopLeft
    this.syncBoundsFromGeometry();
    this.world().setPointerFocus(this);
    this.halo.remove();
    return true;
  }
  onPointerMove(p, evt) {
    if (!this.hitPoint) return false;
    let delta = p.subPt(this.hitPoint);
    if (['Copy', 'Drag', 'Grab'].includes(this.handleName)) this.target.moveBy(delta);
    if (this.handleName == 'Scale') {
      this.moveBy(delta);
      let cornerPos = this.getBounds().center();
      if (this.scaleTransformDrag) {
        let sw = this.scaleStartBottomRightWorld.x - this.scaleStartTopLeftWorld.x;
        let sh = this.scaleStartBottomRightWorld.y - this.scaleStartTopLeftWorld.y;
        if (Math.abs(sw) < 1) sw = sw < 0 ? -1 : 1;
        if (Math.abs(sh) < 1) sh = sh < 0 ? -1 : 1;
        let nw = cornerPos.x - this.scaleStartTopLeftWorld.x;
        let nh = cornerPos.y - this.scaleStartTopLeftWorld.y;
        let r = (nw / sw + nh / sh) / 2;
        r = Math.max(0.05, Math.min(24, r));
        this.target.transform.scale = pt(
          this.scaleStartTransform.x * r,
          this.scaleStartTransform.y * r,
        );
        if (this.target.syncBoundsFromGeometry) this.target.syncBoundsFromGeometry();
        this.target.changed();
        let world = this.target.world();
        if (world && world.changed) world.changed();
      } else {
        this.target.setBounds(
          this.scaleStartTopLeft.extent(cornerPos.subPt(this.scaleStartTopLeft)),
        );
      }
    }
    if (this.handleName == 'Rotate') {
      let c = this.target.globalize(this.target.shape.getBounds().center());
      let currentAngle = Math.atan2(p.y - c.y, p.x - c.x);
      this.target.rotateBy(currentAngle - this.rotateStartAngle);
      this.rotateStartAngle = currentAngle;
    }
    this.moveBy(delta);
    this.hitPoint = p;
    return true;
  }
  onPointerUp(pt, evt) {
    if (this.target && ['Copy', 'Grab'].includes(this.handleName)) {
      let worldPt = this.owner ? this.owner.globalize(pt) : pt;
      this.target.dropOnTopMorphAt(worldPt);
    }
    this.world().setPointerFocus(null);
    this.remove();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  HaloMorph
// -----------
// Meta-click halo ring around a morph.
class HaloMorph extends Morph {
  constructor(targetMorph) {
    const isWorld =
      targetMorph.className === 'WorldMorph' ||
      (targetMorph.instanceOf && targetMorph.instanceOf(WorldMorph));
    const haloBounds = isWorld
      ? targetMorph.clippedBoundsInWorld().insetBy(20)
      : targetMorph.clippedBoundsInWorld().insetBy(-10);
    super(haloBounds);
    this.target = targetMorph;
    this.shape.setStyles(null, 1, Color.green);
    this.layoutTitleMorph();
    if (isWorld) {
      this.rotateHandle = null;
      this.styleHandle = null;
      this.copyHandle = null;
      this.menuHandle = this.addMorph(new HaloHandle(4, 'M', 'Menu', this));
      this.grabHandle = null;
      this.dragHandle = null;
      this.deleteHandle = null;
      this.codeHandle = this.addMorph(new HaloHandle(8, 'B', 'Browse', this));
      this.inspectHandle = this.addMorph(new HaloHandle(9, 'I', 'Inspect', this));
      this.resizeHandle = null;
    } else {
      this.rotateHandle = this.addMorph(new HaloHandle(1, 'R', 'Rotate', this));
      this.styleHandle = this.addMorph(new HaloHandle(2, 'S', 'Style', this));
      this.copyHandle = this.addMorph(new HaloHandle(3, 'C', 'Copy', this));
      this.menuHandle = this.addMorph(new HaloHandle(4, 'M', 'Menu', this));
      this.grabHandle = this.addMorph(new HaloHandle(5, 'G', 'Grab', this));
      this.dragHandle = this.addMorph(new HaloHandle(6, 'D', 'Drag', this));
      this.deleteHandle = this.addMorph(new HaloHandle(7, 'X', 'Delete', this));
      this.codeHandle = this.addMorph(new HaloHandle(8, 'B', 'Browse', this));
      this.inspectHandle = this.addMorph(new HaloHandle(9, 'I', 'Inspect', this));
      this.resizeHandle = this.addMorph(new HaloHandle(10, 'Z', 'Scale', this));
    }
  }
  handleCenterForIndex(index) {
    /** Center of handle ellipse `index` (1–10) in halo-local coordinates. */
    let wid = 20;
    let haloBounds = this.shape.getBounds();
    let frame = rect(-wid, -wid, haloBounds.width() + 2 * wid, haloBounds.height() + 2 * wid);
    let p1 = frame.bottomLeft().subPt(pt(0, wid));
    let p2 = frame.topLeft;
    let p3 = frame.topRight().subPt(pt(wid, 0));
    let p4 = frame.bottomRight().subPt(pt(wid, wid));
    let c1, c2, d;
    if (index <= 4) {
      c1 = p1;
      c2 = p2;
      d = (4 - index) / 3;
    } else if (index <= 7) {
      c1 = p2;
      c2 = p3;
      d = (7 - index) / 3;
    } else {
      c1 = p3;
      c2 = p4;
      d = (10 - index) / 3;
    }
    let handleLoc = c2.addPt(c1.subPt(c2).scaleBy(d));
    let radius = wid / 2;
    return handleLoc.addPt(pt(radius, radius));
  }
  handleChromeStyle() {
    /** Fill and border for handle ellipses and the halo title plate. */
    return {
      fill: Color.blue.lighter().lighter().withAlpha(0.5),
      borderWidth: 1,
      borderColor: Color.blue,
    };
  }
  handleLetterBaselineYInHalo(index) {
    /** Canvas y of the text baseline for a handle letter, in halo-local coordinates. */
    let m = this.handleLetterMetrics();
    let center = this.handleCenterForIndex(index);
    let letterTop = center.y - m.letterH / 2;
    if (index !== 9) letterTop += m.nudge.y;
    return letterTop + m.hang;
  }
  handleLetterMetrics() {
    return {
      font: '14px sans-serif',
      lineHeight: 16,
      letterW: 14,
      letterH: 16,
      hang: 4,
      nudge: pt(-2, -1),
    };
  }
  includesPt(p) {
    // p is in owner (world) coords. A halo should be hittable if either its
    // own frame contains p or any of its handles (submorphs) does.
    let localP = this.relativize(p); // halo-local
    if (this.shape.includesPt(localP)) return true;
    let hit = false;
    this.submorphs.forEach((sub) => {
      if (!hit && sub !== this.titleMorph && sub.includesPt(localP)) hit = true;
    });
    return hit;
  }
  layoutTitleMorph() {
    let m = this.handleLetterMetrics();
    let rC = this.handleCenterForIndex(1);
    let zC = this.handleCenterForIndex(10);
    let mid = rC.addPt(zC.subPt(rC).scaleBy(0.5));
    let span = Math.max(24, rC.dist(zC) - 36);
    let maxChars = Math.max(4, Math.floor(span / 8));
    let name = this.target && this.target.className ? this.target.className : 'Morph';
    let titleStr = truncateString(name, maxChars);
    let baselineY = this.handleLetterBaselineYInHalo(1);
    let chrome = this.handleChromeStyle();
    let padX = 6;
    let padY = 1;
    let innerW = Math.min(span, Math.max(28, titleStr.length * 8));
    let titleW = innerW + padX * 2;
    let titleH = m.lineHeight + padY * 2;
    let titleTop = baselineY - m.hang - padY;
    let titleBounds = rect(mid.x - titleW / 2, titleTop, titleW, titleH);
    this.titleMorph = this.addMorph(new TextMorph(titleBounds, titleStr));
    let letter = this.titleMorph.shape;
    letter.font = m.font;
    letter.lineHeight = m.lineHeight;
    letter.hang = m.hang + padY;
    letter.inset = pt(m.hang + padX, m.hang + padY);
    letter.boxColor = chrome.fill;
    letter.borderWidth = 1;
    letter.borderColor = chrome.borderColor;
    letter.fill = chrome.fill;
    letter.$selStart = null;
    letter.$selStop = null;
    letter.disableSelectionRendering = true;
    letter.noMenuLineHighlight = true;
    letter.centerGlyph = true;
    letter.verticallyCenterSingleLine = false;
    letter.composeBottomPad = 0;
    if (letter.compose) letter.compose();
    this.titleMorph.onPointerDown = () => false;
    this.titleMorph.includesPt = () => false;
  }
  pointerDownOnHandle(handle, pt, evt) {
    let worldPt = this.getBounds().topLeft.addPt(pt); // pt is in halo coords
    switch (handle.handleName) {
      case 'Style':
        this.target.restyle();
        break;
      case 'Menu': {
        let anchor = this.getBounds().topLeft.addPt(handle.getBounds().center());
        let target = this.target;
        let morphSpec = target && target.morphMenu ? target.morphMenu() : null;
        if (morphSpec && morphSpec.items && morphSpec.items.length > 0) {
          target.showMorphMenuAt(anchor, { fleeting: true });
          break;
        }
        this.world().showWorldMenuAt(anchor, { fleeting: true });
        break;
      }
      case 'Browse': {
        let className = this.target && this.target.className ? this.target.className : 'Morph';
        let browser = Lively.addMorph(new BrowserPanel());
        browser.classPane.setSelectionString(className);
        break;
      }
      case 'Inspect':
        this.target.inspect();
        break;
      case 'Delete':
        this.target.remove();
        break;
      default:
        console.log('Invalid halo handle name??');
    }
    this.remove();
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +---------+
// |  Hands  |
// +---------+
// Alt-drag hand morph for submorph pickup.

//  HandMorph
// -----------
// Alt-drag hand for picking up submorph trees.
class HandMorph extends Morph {
  constructor(id, location, color) {
    super(null, new Pen().makeHandShape(location, color));
    this.actorID = id;
    // Per-hand last point for move deltas — must not share the world pointerLocation
    // (WorldMorph updates that before/after hand moves).
    this.$handPointerLocation = location ? location.copy() : this.location();
    setPointerLocation(this.$handPointerLocation);
  }
  dropMorph(p, evt) {
    let worldPt = p ? p : this.location();
    this.submorphs.slice().forEach((morphToDrop) => {
      let anchorLocal = morphToDrop._handGrabAnchorLocal;
      if (!anchorLocal) anchorLocal = morphToDrop.shape.getBounds().topLeft;
      morphToDrop.dropOnTopMorphAt(worldPt, anchorLocal);
      morphToDrop._handGrabAnchorLocal = null;
    });
  }
  grabMorph(p, evt) {
    let worldPt = p ? p : this.location();
    let morphUnder = this.world().topMorphAt(worldPt);
    if (!morphUnder || morphUnder === this || morphUnder.className == 'WorldMorph') return false;
    let anchorLocal = morphUnder.localize(worldPt);
    morphUnder._handGrabAnchorLocal = anchorLocal;
    morphUnder.reparentToOwnerPreservingWorldAnchor(this, anchorLocal);
    return true;
  }
  handColor() {
    if (!this.shape) return null;
    // Hand visual color is usually fillColor; border is often black outline.
    if (this.shape.fillColor) return this.shape.fillColor;
    if (this.shape.borderColor) return this.shape.borderColor;
    return null;
  }
  isaHand() {
    return true;
  }
  location() {
    return this.getBounds().topLeft;
  }
  onPointerDown(p, evt) {
    this.hitPoint = p;
    this.$handPointerLocation = p;
    setPointerLocation(p);
    // Hand operations are explicit (Alt-click), so normal clicks still edit/select panes.
    // Switching active hand when clicking another is handled in WorldMorph.onPointerDown
    // (hands live in world.hands, not the submorph tree, so inactive hands never get events).
    if (!evt.altKey) return false;
    if (evt.shiftKey) {
      // Alt+Shift click means copy target into hand.
      if (this.hasSubmorphs()) return false; // no sense to copy if laden
      let morphUnder = this.world().topMorphAt(p);
      if (!morphUnder || morphUnder.className == 'WorldMorph' || morphUnder === this) return false;
      let copy = morphUnder.morphCopy();
      let anchorLocal = copy.localize(p);
      copy._handGrabAnchorLocal = anchorLocal;
      copy.reparentToOwnerPreservingWorldAnchor(this, anchorLocal);
      return true;
    }
    if (this.hasSubmorphs()) this.dropMorph(p, evt);
    else this.grabMorph(p, evt);
    return true;
  }
  onPointerMove(p, evt) {
    let prev = this.$handPointerLocation ? this.$handPointerLocation : this.location();
    let d = p.subPt(prev);
    this.$handPointerLocation = p;
    setPointerLocation(p);
    this.moveBy(d);
    // Submorphs ride under transform; do not move them separately.
  }
  onPointerUp(p, evt) {
    this.$handPointerLocation = p;
    setPointerLocation(p);
    if (this.hasSubmorphs() && this.hitPoint.dist(p) > 2) this.dropMorph();
  }
  static new(...args) {
    return new this(...args);
  }
}

// +----------------------+
// |  On-Screen Keyboard  |
// +----------------------+
// Soft keyboard morph and focus sync helpers.

function getKbdShiftTable() {
  /** Ensure shift table is object-shaped even if external patch/load assigns null. */
  let t = kbdShiftTable;
  if (!t || typeof t !== 'object') {
    t = { ...kbdDefaultShiftTable };
    kbdShiftTable = t;
  }
  return t;
}
function defaultOnScreenKeyboardBounds(world) {
  let gb = world && world.getBounds ? world.getBounds() : getBounds();
  if (!gb) return rect(8, 100, 900, 276);
  let width = Math.min(920, Math.max(420, gb.width() - 16));
  let x = Math.max(8, gb.width() - width - 8);
  let y = Math.max(8, gb.height() - 292);
  return rect(x, y, width, 276);
}
function syncOnScreenKeyboardWithFocus(worldIfAny) {
  let world = worldIfAny || Lively;
  if (!world) return;
  if (!shouldShowOnScreenKeyboardForWorld(world)) {
    if (
      $onScreenKeyboardMorph &&
      $onScreenKeyboardMorph.world() &&
      $onScreenKeyboardMorph._openedViaFocusSync
    ) {
      $onScreenKeyboardMorph.remove();
      $onScreenKeyboardMorph = null;
      _refreshPadModifierStyles();
    }
    return;
  }
  let kb = $onScreenKeyboardMorph;
  if (kb && kb.world()) {
    kb._openedViaFocusSync = true;
    _refreshPadModifierStyles();
    return;
  }
  kb = new OnScreenKeyboardMorph(defaultOnScreenKeyboardBounds(world));
  kb._openedViaFocusSync = true;
  world.addEphemeralMorph(kb); // OSK is per-user UI
  kb.startStepping('stepRefreshLockLabels', null, 200);
  $onScreenKeyboardMorph = kb;
  _refreshPadModifierStyles();
}
function toggleOnScreenKeyboard(worldIfAny) {
  let world = worldIfAny || Lively;
  if (!world) return null;
  if ($onScreenKeyboardMorph && $onScreenKeyboardMorph.world()) {
    $onScreenKeyboardMorph.remove();
    $onScreenKeyboardMorph = null;
    _refreshPadModifierStyles();
    if ($useOnScreenKbd) syncOnScreenKeyboardWithFocus(world);
    return null;
  }
  if ($useOnScreenKbd) {
    syncOnScreenKeyboardWithFocus(world);
    return $onScreenKeyboardMorph;
  }
  let kb = new OnScreenKeyboardMorph(defaultOnScreenKeyboardBounds(world));
  kb._openedViaFocusSync = false;
  world.addEphemeralMorph(kb); // OSK is per-user UI
  kb.startStepping('stepRefreshLockLabels', null, 200);
  $onScreenKeyboardMorph = kb;
  _refreshPadModifierStyles();
  return kb;
}
function saveOnScreenKeyboardChrome(kb) {
  /** Remember OSK position/size (world bounds) for the next show. */
  if (!kb || !kb.getBounds) return;
  let b = kb.getBounds();
  $oskSavedChrome = {
    x: b.topLeft.x,
    y: b.topLeft.y,
    w: b.width(),
    h: b.height(),
  };
}
function onScreenKeyboardBoundsForWorld(world) {
  let c = $oskSavedChrome;
  if (c && c.w > 0 && c.h > 0) return rect(c.x, c.y, c.w, c.h);
  return defaultOnScreenKeyboardBounds(world);
}
function padModifierHighlightOn(baseColor) {
  /** Gray highlight for active SHIFT/META on OSK pad keys. */
  let base = baseColor && baseColor.copy ? baseColor.copy() : Color.lightGray.copy();
  return Color.gray.mixedWith(base, 0.58);
}
function pressPadShiftKey() {
  /** SHIFT on OSK ⇧ — clears LOCK if on, else toggles one-shot soft shift. */
  if (isLockKeyPressed()) {
    setLockKeyPressed(false);
    setShiftKeyPressed(false);
  } else {
    setShiftKeyPressed(!$shiftKeyPressedFlag);
  }
  _refreshPadModifierStyles();
}
function pressPadMetaKey() {
  /** META on OSK ⌘ — toggles until next character or pointerDown consumes it. */
  toggleMetaKeyPressed();
}
function clearOskPadModifierState() {
  /** LOCK / shift-lock and soft pad modifiers when the OSK goes away. */
  setLockKeyPressed(false);
  setShiftKeyPressed(false);
  setMetaKeyPressed(false);
}
//  OnScreenKeyboardMorph
// -----------------------
// Soft keyboard for TextPane entry on touch devices.
class OnScreenKeyboardMorph extends Morph {
  constructor(bounds) {
    let ib = bounds || rect(0, 0, 880, 268);
    super(
      ib,
      new Shape(
        'Rectangle',
        rect(0, 0, ib.width(), ib.height()),
        Color.veryLightGray.withAlpha(0.95),
        1,
        Color.gray,
      ),
    );
    this.transform.translation = ib.topLeft.copy();
    this.keyMorphs = [];
    this._kbdRowSpecs = OnScreenKeyboardMorph.prototype.defaultRowSpecs();
    this.buildKeys();
    this._kbdLockWas = isLockKeyPressed();
    // startStepping must run after addMorph — Morph.startStepping uses this.world().
  }
  _noteOskBodyPressForLongClick(evt) {
    if (!evt || typeof evt.pointerId !== 'number' || !$uiState) return;
    let arm = $uiState.longClickByPointerId[evt.pointerId];
    if (arm) arm.longClickMoveCancelPx = OnScreenKeyboardMorph.OSK_LONG_CLICK_MOVE_CANCEL_PX;
  }
  _startOskBodyDragIfNeeded(p, evt) {
    if (!this._oskBodyPress || this.hitPoint) return false;
    let slop = OnScreenKeyboardMorph.OSK_BODY_DRAG_SLOP;
    if (p.dist(this._oskBodyPress.ownerPt) < slop) return true;
    this.hitPoint = this._oskBodyPress.ownerPt;
    this.didDrag = false;
    this._pickUpOnDrag = this.owner != null && this.owner !== this.world();
    this.actorID = evt.actorID;
    this.world().setPointerFocus(this);
    this._oskBodyPress = null;
    return super.onPointerMove(p, evt);
  }
  applyKeyMetrics(keyMorph, ks, displayText) {
    let sh = keyMorph.shape;
    if (!sh) return;
    let txt = displayText != null ? displayText : sh.string || '';
    let twoLine = txt.indexOf('\n') >= 0;
    let baseFs = 12;
    sh.font = baseFs + 'px sans-serif';
    if (twoLine) {
      let lh = Math.max(12, Math.floor((ks - 6) / 2));
      sh.lineHeight = lh;
      sh.inset = pt(Math.max(1, ks * 0.06), Math.max(1, ks * 0.05));
      sh.hang = sh.inset.y + 4;
      sh.verticalNudge = Math.floor(ks * 0.04);
    } else {
      sh.lineHeight = ks;
      sh.inset = pt(Math.max(1, ks * 0.07), Math.max(1, ks * 0.07));
      sh.hang = sh.inset.y;
      sh.verticalNudge = Math.floor(ks * 0.12) + 4;
    }
    sh.composeBottomPad = 0;
    if (sh.compose) sh.compose();
    sh.extent.y = ks;
  }
  buildKeys() {
    this.keyMorphs.forEach((m) => m.remove());
    clearArray(this.keyMorphs);
    let rows = this._kbdRowSpecs || OnScreenKeyboardMorph.prototype.defaultRowSpecs();
    let nRows = rows.length;
    let pad = 8;
    let rowGap = 8;
    let measureRowUnits = function (row) {
      return row.keys.reduce((s, k) => s + (k.units || 1), 0);
    };
    let innerW = Math.max(320, this.shape.getBounds().width() - 2 * pad);
    let innerH = Math.max(120, this.shape.getBounds().height() - 2 * pad);
    let ks = (innerH - (nRows - 1) * rowGap) / nRows;
    let gap = Math.max(3, ks * 0.11);
    let rowWidth = function (row, keySize, g) {
      let u = measureRowUnits(row);
      return row.stagger * keySize + u * keySize + (row.keys.length - 1) * g;
    };
    let widest = 0;
    rows.forEach((row) => {
      widest = Math.max(widest, rowWidth(row, ks, gap));
    });
    if (widest > innerW && widest > 0) ks *= innerW / widest;
    for (let guard = 0; guard < 6; guard++) {
      gap = Math.max(3, ks * 0.11);
      widest = 0;
      rows.forEach((row) => {
        widest = Math.max(widest, rowWidth(row, ks, gap));
      });
      let hNeed = nRows * ks + (nRows - 1) * rowGap;
      if (widest <= innerW && hNeed <= innerH) break;
      ks *= 0.94;
    }
    gap = Math.max(3, ks * 0.11);
    let contentW = pad * 2 + widest;
    let contentH = pad * 2 + nRows * ks + (nRows - 1) * rowGap;
    this.shape.setBounds(rect(0, 0, contentW, contentH));
    this.transform.scale = pt(1, 1);
    let b = this.shape.getBounds();
    for (let r = 0; r < nRows; r++) {
      let row = rows[r];
      let y = b.topLeft.y + pad + r * (ks + rowGap);
      let x = b.topLeft.x + pad + row.stagger * ks;
      row.keys.forEach((spec) => {
        let units = spec.units || 1;
        let wKey = units * ks;
        let keyBounds = rect(x, y, wKey, ks);
        let face = this.keyFaceLabel(spec);
        let key = this.addMorph(new KbdKeyMorph(keyBounds, face, spec, this));
        this.applyKeyMetrics(key, ks, face);
        this.keyMorphs.push(key);
        x += wKey + gap;
      });
    }
    this._kbdKeySize = ks;
    this._kbdNaturalSize = pt(b.width(), b.height());
    this.syncBoundsFromGeometry();
    this.refreshKeyLabels();
    this.refreshModifierKeyHighlights();
    this.changed();
  }
  defaultRowSpecs() {
    /** Staggered rows: numbers, QWERTY (+ tab), ASDF (with return), ZXCV (shifts), bottom row (space + arrows). */
    let spaceU = 7.4;
    return [
      {
        stagger: 0,
        keys: [
          { key: '`', label: '`' },
          { key: '1', label: '1' },
          { key: '2', label: '2' },
          { key: '3', label: '3' },
          { key: '4', label: '4' },
          { key: '5', label: '5' },
          { key: '6', label: '6' },
          { key: '7', label: '7' },
          { key: '8', label: '8' },
          { key: '9', label: '9' },
          { key: '0', label: '0' },
          { key: '-', label: '-' },
          { key: '=', label: '=' },
          { type: 'backspace', key: 'Backspace', label: '⌫', units: 2 },
        ],
      },
      {
        stagger: 0.52,
        keys: [
          { type: 'tab', key: 'Tab', label: '⇥', units: 1.5 },
          { key: 'q', label: 'q' },
          { key: 'w', label: 'w' },
          { key: 'e', label: 'e' },
          { key: 'r', label: 'r' },
          { key: 't', label: 't' },
          { key: 'y', label: 'y' },
          { key: 'u', label: 'u' },
          { key: 'i', label: 'i' },
          { key: 'o', label: 'o' },
          { key: 'p', label: 'p' },
          { key: '[', label: '[' },
          { key: ']', label: ']' },
          { key: '\\', label: '\\' },
        ],
      },
      {
        stagger: 0.58,
        keys: [
          { type: 'caps_unused', label: '⇪', units: 1.75 },
          { key: 'a', label: 'a' },
          { key: 's', label: 's' },
          { key: 'd', label: 'd' },
          { key: 'f', label: 'f' },
          { key: 'g', label: 'g' },
          { key: 'h', label: 'h' },
          { key: 'j', label: 'j' },
          { key: 'k', label: 'k' },
          { key: 'l', label: 'l' },
          { key: ';', label: ';' },
          { key: "'", label: "'" },
          { type: 'enter', key: 'Enter', label: '↵', units: 1.85 },
        ],
      },
      {
        stagger: 0.62,
        keys: [
          { type: 'shift', key: 'Shift', label: '⇧', units: 2 },
          { key: 'z', label: 'z' },
          { key: 'x', label: 'x' },
          { key: 'c', label: 'c' },
          { key: 'v', label: 'v' },
          { key: 'b', label: 'b' },
          { key: 'n', label: 'n' },
          { key: 'm', label: 'm' },
          { key: ',', label: ',' },
          { key: '.', label: '.' },
          { key: '/', label: '/' },
          { type: 'shift', key: 'Shift', label: '⇧', units: 2 },
        ],
      },
      {
        stagger: 0.62,
        keys: [
          { type: 'shift', key: 'Shift', label: '⇧', units: 1.35 },
          { type: 'meta_toggle', label: '⌘', units: 1.35 },
          { type: 'space', key: ' ', label: '', units: spaceU },
          { key: 'ArrowUp', label: '↑' },
          { key: 'ArrowLeft', label: '←' },
          { key: 'ArrowDown', label: '↓' },
          { key: 'ArrowRight', label: '→' },
          { type: 'close', label: '✕', units: 1 },
        ],
      },
    ];
  }
  getBounds() {
    /** Axis-aligned footprint in owner space (includes uniform scale from halo resize). */
    let sb = this.shape.getBounds();
    let sx = this.transform.scale.x || 1;
    let sy = this.transform.scale.y || 1;
    let ext = pt(sb.width() * sx, sb.height() * sy);
    return this.transform.translation.copy().extent(ext);
  }
  handleVirtualKey(spec, evtIfAny) {
    if (!spec) return;
    if (spec.type === 'meta_toggle') {
      pressPadMetaKey();
      this.refreshKeyLabels();
      return;
    }
    if (spec.type === 'caps_unused') {
      setLockKeyPressed(!isLockKeyPressed());
      this.refreshKeyLabels();
      return;
    }
    if (spec.type === 'shift') {
      pressPadShiftKey();
      this.refreshKeyLabels();
      return;
    }
    if (spec.type === 'close') {
      $useOnScreenKbd = false;
      this.remove();
      return;
    }
    let locked = isLockKeyPressed();
    let shiftLike = locked || $shiftKeyPressedFlag;
    let key = spec.key;
    if (spec.type === 'space') key = ' ';
    if (!key) return;
    let metaChord = $metaKeyPressedFlag || !!(evtIfAny && evtIfAny.metaKey);
    if (metaChord && $metaKeyPressedFlag) consumeSoftMetaKey();
    if (!metaChord) {
      let shiftTable = getKbdShiftTable ? getKbdShiftTable() : kbdShiftTable || {};
      if (/^[a-z]$/i.test(key)) {
        key = shiftLike ? key.toUpperCase() : key.toLowerCase();
      } else if (shiftLike && shiftTable[key]) {
        key = shiftTable[key];
      }
    } else if (key && key.length === 1) {
      key = key.toLowerCase();
    }
    let evt = {
      key: key,
      keyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Backspace' ? 8 : 0,
      // Keep synthetic virtual-key events from latching WorldMorph.$shiftKeyDown.
      shiftKey: false,
      metaKey: metaChord,
      ctrlKey: metaChord,
      altKey: false,
      actorID: $actorID,
      preventDefault: function () {},
      stopPropagation: function () {},
    };
    let world = this.world();
    if (!world) return;
    world.$shiftKeyDown = false; // synthetic key events are one-shot; avoid sticky world shift state
    let focus = world.$keyboardFocus;
    if (focus && focus.className === 'TextPane' && focus.contentPane) focus = focus.contentPane;
    if (focus && focus.onKeyDown) focus.onKeyDown(evt);
    else world.onKeyDown(evt);
    consumeSoftShiftKey();
    if (metaChord) _refreshPadModifierStyles();
    this.refreshKeyLabels();
  }
  keyFaceLabel(spec) {
    /** Stable keycap face: shifted glyph on top, base on bottom when both exist (same style before/after shift). */
    if (spec.type === 'shift') return 'Shift';
    if (spec.type === 'meta_toggle') return '⌘';
    if (spec.type === 'close') return '✕';
    if (spec.type === 'space') return 'space';
    if (spec.type === 'tab') return '⇥\nTab';
    if (spec.type === 'enter') return '↵\nreturn';
    if (spec.type === 'backspace') return '⌫\ndelete';
    if (spec.type === 'caps_unused') return isLockKeyPressed() ? 'CAPS*\n⇪' : 'CAPS\n⇪';
    if (spec.key && spec.key.indexOf('Arrow') === 0) {
      if (spec.key === 'ArrowUp') return '▲';
      if (spec.key === 'ArrowDown') return '▼';
      if (spec.key === 'ArrowLeft') return '◀';
      if (spec.key === 'ArrowRight') return '▶';
    }
    if (!spec.key) {
      if (spec.label != null && spec.label !== '') return spec.label;
      return '';
    }
    let k = spec.key;
    if (/^[a-z]$/i.test(k)) {
      let lo = k.toLowerCase();
      return lo.toUpperCase() + '\n' + lo;
    }
    let shiftTable = getKbdShiftTable ? getKbdShiftTable() : kbdShiftTable || {};
    let up = shiftTable[k];
    if (up) return up + '\n' + k;
    return k;
  }
  onPointerDown(p, evt) {
    /** Children (keys) before body handling so soft META + tap toggles keys instead of halo-on-key. */
    if (!this.fullBounds().includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    let localP = this.relativize(p);
    let eventConsumed = false;
    this.submorphs.forEach((sub) => {
      if (sub.fullBounds().includesPt(localP)) eventConsumed = sub.onPointerDown(localP, evt);
    });
    if (eventConsumed) return true;
    clearKeyboardFocusUnlessTypingOrOsk(this);
    if (effectiveMetaKey(evt)) {
      consumeSoftMetaKey();
      this.showHalo();
      return false;
    }
    this.beTopMorph();
    if (effectiveShiftKey(evt)) {
      let copy = this.world().addMorph(this.morphCopy());
      copy.hitPoint = p;
      copy.actorID = evt.actorID;
      this.world().setPointerFocus(copy);
      return true;
    }
    this._oskBodyPress = { ownerPt: p.copy ? p.copy() : pt(p.x, p.y) };
    this._noteOskBodyPressForLongClick(evt);
    return true;
  }
  onPointerMove(p, evt) {
    if (this._startOskBodyDragIfNeeded(p, evt)) return true;
    if (this._oskBodyPress) return true;
    return super.onPointerMove(p, evt);
  }
  onPointerUp(p, evt) {
    this._oskBodyPress = null;
    return super.onPointerUp(p, evt);
  }
  refreshKeyLabels() {
    let ks = this._kbdKeySize || 28;
    this.keyMorphs.forEach((keyMorph) => {
      if (!keyMorph.keySpec) return;
      let face = this.keyFaceLabel(keyMorph.keySpec);
      keyMorph.setKeyLabel(face);
      this.applyKeyMetrics(keyMorph, ks, face);
    });
  }
  refreshModifierKeyHighlights() {
    this.keyMorphs.forEach((keyMorph) => {
      if (keyMorph.refreshModifierHighlight) keyMorph.refreshModifierHighlight();
    });
  }
  remove() {
    this.stopStepping('stepRefreshLockLabels');
    saveOnScreenKeyboardChrome(this);
    clearOskPadModifierState();
    if ($onScreenKeyboardMorph === this) $onScreenKeyboardMorph = null;
    if (_refreshPadModifierStyles) _refreshPadModifierStyles();
    return super.remove();
  }
  setBounds(rect) {
    /** Halo Z (Scale) adjusts uniform scale; shape + layout stay fixed in local space. */
    let nw = Math.max(48, rect.width());
    let nh = Math.max(36, rect.height());
    let bw = this._kbdNaturalSize ? this._kbdNaturalSize.x : nw;
    let bh = this._kbdNaturalSize ? this._kbdNaturalSize.y : nh;
    let s = Math.min(nw / bw, nh / bh);
    if (s < 0.06) s = 0.06;
    if (s > 24) s = 24;
    this.transform.translation = rect.topLeft.copy();
    this.transform.scale = pt(s, s);
    this.syncBoundsFromGeometry();
    this.changed();
  }
  stepRefreshLockLabels() {
    let now = isLockKeyPressed();
    if (now !== this._kbdLockWas) {
      this._kbdLockWas = now;
      this.refreshKeyLabels();
      this.changed();
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

// +--------------+
// |  WorldMorph  |
// +--------------+
// Root morph: event dispatch, halos, hands, stepping, world menu.

function _transcriptFmtConsoleArg(a) {
  if (a === null) return 'null';
  let t = typeof a;
  if (t === 'string') return a;
  if (t === 'number' || t === 'boolean' || t === 'undefined') return '' + a;
  try {
    return JSON.stringify(a);
  } catch (e) {
    try {
      return Object.prototype.toString.call(a);
    } catch (e2) {
      return '?';
    }
  }
}
function _routeConsoleToTranscripts(label, line) {
  let arr = _transcriptConsoleTargets;
  if (!arr || arr.length === 0) return;
  let suffix = label ? '[' + label + '] ' : '';
  let payload = suffix + line;
  let copy = arr.slice();
  for (let i = 0; i < copy.length; i++) {
    let tp = copy[i];
    if (tp && tp.nextPut) tp.nextPut(payload + '\n');
  }
}
function hasTranscriptConsoleTargets() {
  let arr = _transcriptConsoleTargets;
  return !!(arr && arr.length > 0);
}
function _ensureConsoleMirrorInstalled() {
  /** Wraps console once; mirrored panes registered via TranscriptTextPane.setConsoleMirror(true). */
  if (window._consoleMirrorInstalled) return;
  let root = typeof console !== 'undefined' ? console : null;
  if (!root) return;
  window._consoleMirrorInstalled = true;
  _transcriptConsoleTargets = [];
  let origLog = root.log.bind(root);
  let origWarn = root.warn.bind(root);
  let origErr = root.error.bind(root);
  let origInfo = root.info ? root.info.bind(root) : origLog;
  let fmtLine = function (args) {
    let parts = [];
    for (let i = 0; i < args.length; i++) parts.push(_transcriptFmtConsoleArg(args[i]));
    return parts.join(' ');
  };
  root.log = function () {
    let a = arguments;
    origLog.apply(root, a);
    if (!hasTranscriptConsoleTargets()) return;
    _routeConsoleToTranscripts('', fmtLine(a));
  };
  root.info = function () {
    let a = arguments;
    origInfo.apply(root, a);
    if (!hasTranscriptConsoleTargets()) return;
    _routeConsoleToTranscripts('info', fmtLine(a));
  };
  root.warn = function () {
    let a = arguments;
    origWarn.apply(root, a);
    if (!hasTranscriptConsoleTargets()) return;
    _routeConsoleToTranscripts('warn', fmtLine(a));
  };
  root.error = function () {
    let a = arguments;
    origErr.apply(root, a);
    if (!hasTranscriptConsoleTargets()) return;
    _routeConsoleToTranscripts('error', fmtLine(a));
  };
}
function openTranscript() {
  /** Opens a transcript panel in the upper-right quadrant of the backing canvas. */
  let gb = getBounds();
  if (!gb || !Lively) return null;
  let m = 8;
  let rw = Math.max(120, gb.width() / 2 - 2 * m);
  let rh = Math.max(80, gb.height() / 2 - 2 * m);
  let rx = gb.width() / 2 + m / 2;
  let ry = m;
  let panel = new TranscriptPanelMorph(rect(rx, ry, rw, rh));
  Lively.addMorph(panel);
  panel.beTopMorph();
  _lastTranscriptPanel = panel;
  return panel;
}
//  WorldMorph
// ------------
// Root morph: pointer routing, halos, hands, world menu.
class WorldMorph extends Morph {
  constructor(bounds) {
    if (traceMe) console.log('log ', 3);
    super(bounds, null);
    this.setColor(Color.green.lighter().lighter());
    if (traceMe) console.log('log ', 4);
    // PER-USER ($-prefixed): the stepping schedule is replica-local execution state.
    // Only the replica that started an animation runs its step methods (others see the
    // results through the document); reload stops local animations until restarted;
    // and per-step bookkeeping (nextStepTime) never generates Automerge ops.
    this.$stepList = [];
    this.$pointerFocus = null;
    this.$keyboardFocus = null;
    this.$shiftKeyDown = false; // maintained here
    this.hands = null;
    setPointerLocation(bounds.topLeft);
  }
  addHand(handMorph) {
    // maybe should check for duplicate adds
    if (!this.hands) this.hands = [];
    if (handMorph.actorID == null) handMorph.actorID = $actorID;
    this.hands.push(handMorph);
    handMorph.owner = this;
    this.updateCursorForHands();
    this.render(canvas.getContext('2d')); // hand should now appear
  }
  cycleHaloAt(pt) {
    let candidates = this.morphsAtPointInDepthOrder(pt);
    if (candidates.length === 0) {
      this.removeExistingHalos();
      return;
    }
    let existingHalo = this.allSubmorphs().find((morph) => morph.className == 'HaloMorph');
    let prevTarget = existingHalo && existingHalo.target;
    let continueChain =
      prevTarget &&
      prevTarget.clippedBoundsInWorld &&
      prevTarget.clippedBoundsInWorld().includesPt(pt);
    let currentIx = -1;
    if (continueChain && prevTarget) {
      currentIx = candidates.indexOf(prevTarget);
    }
    this.removeExistingHalos();
    let nextIx = currentIx + 1;
    if (nextIx < candidates.length) {
      // Per-user UI: my halo is mine alone (never enters the Automerge document).
      this.addEphemeralMorph(new HaloMorph(candidates[nextIx]));
    }
  }
  dismissFleetingMenusAt(p) {
    let fleetingMenus = this.submorphs.filter(
      (morph) => morph.className == 'MenuMorph' && morph.isFleetingMenu,
    );
    if (fleetingMenus.length == 0) return false;
    if (hitScrollPaneMenuButtonAt(this, p)) return false;
    let clickWasInside = fleetingMenus.some((morph) => morph.includesPt(p));
    if (clickWasInside) return false;
    let removedAny = false;
    let world = this;
    fleetingMenus.forEach((morph) => {
      let pinContent = morph._paneMenuPinWhileInContent;
      let ownerPane = morph._paneMenuOwnerScrollPane;
      if (pinContent && ownerPane && worldPtHitsMorphOrSubmorphs(world, p, pinContent)) {
        if (ownerPane.instanceOf && ownerPane.instanceOf(ListPane)) return;
        if (
          ownerPane.instanceOf &&
          ownerPane.instanceOf(TextPane) &&
          keyboardFocusBelongsToScrollPane(world, ownerPane)
        )
          return;
      }
      morph.remove();
      removedAny = true;
    });
    return removedAny;
  }
  handForActor(actorID) {
    return this.handForID(actorID);
  }
  handForID(id) {
    if (!this.hands || this.hands.length == 0) return null;
    let matched = this.hands.find((hand) => hand.actorID == id);
    if (matched) return matched;
    return null;
  }
  handAt(pt, excludeIfAny) {
    /** Frontmost hand whose bounds contain world-pt `pt`, optionally skipping one hand. */
    if (!this.hands || this.hands.length == 0) return null;
    for (let i = this.hands.length - 1; i >= 0; i--) {
      let hand = this.hands[i];
      if (excludeIfAny && hand === excludeIfAny) continue;
      // Hands are owned by the world but not in submorphs; owner coords == world coords.
      if (hand.fullBounds && hand.fullBounds().includesPt(pt)) return hand;
    }
    return null;
  }
  activateHand(hand, p, evt) {
    /** Make `hand` the local active user (testing multi-hand). */
    if (!hand) return false;
    $actorID = hand.actorID;
    if (evt) evt.actorID = hand.actorID;
    // Avoid a jump on the first move after switching.
    hand.$handPointerLocation = p ? p : getPointerLocation();
    if (p) setPointerLocation(p);
    return true;
  }
  handleStepList() {
    // Fire all due specs without mutating stepList structure during iteration.
    // This avoids stepping corruption when other code calls stopStepping/removeMorph
    // while we're processing due steps.
    let now = Date.now();
    let due = this.activeStepList().filter((spec) => spec.nextStepTime < now);
    due.forEach((spec) => {
      // If spec was removed during earlier step processing, skip it.
      if (!this.activeStepList().includes(spec)) return;
      spec.nextStepTime = now + spec.stepPeriod;
      try {
        if (spec.arg) spec.stepMorph[spec.methodName](spec.arg);
        else spec.stepMorph[spec.methodName]();
      } catch (err) {
        let morphName = spec.stepMorph.className || 'Morph';
        let fn = spec.stepMorph[spec.methodName];
        if (typeof fn === 'function') _lastEvalSource = fn.toString();
        handleRuntimeError(err, 'stepping ' + morphName + '.' + spec.methodName);
        if (spec.stepMorph.stopStepping) spec.stepMorph.stopStepping(spec.methodName);
        else this.stopSteppingMorph(spec.stepMorph, spec.methodName);
      }
    });
  }
  hitMorphAt(pt) {
    return this.topMorphAt(pt);
    /*let minDist = 999;
    let hitMorph = null;
    this.forEverySubmorph((morph) => {
      let d = pt.dist(morph.getBounds().center());
      if (d < minDist) {
        minDist = d; hitMorph = morph;
        console.log('hitMorph at dist ' + minDist + ': ' + hitMorph.asString()) }
    });
    console.log('hitMorph ' + hitMorph.asString() + '/n at ' + pt.asString());
    return hitMorph; */
  }
  initHand(start) {
    if (start == false) {
      this.hands = null;
      this.updateCursorForHands();
      return;
    }
    if (!this.hands) this.hands = [];  //Means we're using hands
    // for testing we give new hands IDs of 0, 1, 2, 3, 4, etc
      let id = this.hands.length;
      $actorID = id;  // now we act like another user N
    let color = Color[['green', 'blue', 'red', 'yellow', 'cyan'][id%5]];
    console.log('creating hand morph');
    const hm = new HandMorph($actorID, getPointerLocation(), color);
    console.log('adding hand morph');
    this.addHand(hm);
  }
  isSteppingMorph(morph, methodName) {
    return this.activeStepList().some((spec) => {
      if (spec.stepMorph !== morph) return false;
      if (methodName != null) return spec.methodName === methodName;
      return true;
    });
  }
  longClickHaloDefersAt(worldPt) {
    /**
     * True → skip long-press halo cycling ({@link onLongClickHalo}); normal interaction applies.
     * Uses the same top-hit basis as {@link morphsAtPointInDepthOrder} / meta-click halos
     * ({@link topMorphAtExcludingHaloUI}), so an existing halo does not block repeats or chain climbs.
     */
    let m = this.topMorphAtExcludingHaloUI(worldPt);
    while (m && m !== this) {
      let cn = m.className;
      if (
        cn === 'HaloHandle' ||
        cn === 'HaloMorph' ||
        cn === 'MenuMorph' ||
        cn === 'SliderMorph' ||
        cn === 'HandMorph' ||
        cn === 'KbdKeyMorph'
      )
        return true;
      if (m.instanceOf && m.instanceOf(PanelMorph)) {
        let localP = m.localize(worldPt);
        let hitInfo = m.titleBarHitInfo(localP);
        if (hitInfo && (hitInfo.onCollapse || hitInfo.onClose)) return true;
      }
      m = m.owner;
    }
    return false;
  }
  makeBouncer() {
    // Lively.makeBouncer()
    // Lively.startStepping("makeBouncer", , 250)
    if (!bouncers) bouncers = [];
    let world = Lively;
    if (!world) return null;
    let wb = world.getBounds();
    let start = wb.center().copy();
    let pen = new Pen(start);
    pen.withBug();
    let bug = pen.bug;
    bug.pen = pen;
    bug.velocity = pt(Math.random() * 12 - 6, Math.random() * 12 - 6);
    bug.syncRotationToVelocity();
    bug.bouncerStep = function () {
      let prevGb = this.collisionBounds();
      let p = this.pen.location.addPt(this.velocity);
      this.pen.location = p;
      this.moveTo(p);
      let b = world.getBounds();
      let gb = this.collisionBounds();
      let eps = 1;
      let wallNudged = false;
      if (gb.topLeft.y < b.topLeft.y && this.velocity.y < 0) {
        this.velocity = this.velocity.flipY();
        this.pen.location = this.pen.location.addPt(pt(0, Math.sign(this.velocity.y) * eps));
        wallNudged = true;
      }
      if (gb.bottomRight().y > b.bottomRight().y && this.velocity.y > 0) {
        this.velocity = this.velocity.flipY();
        this.pen.location = this.pen.location.addPt(pt(0, Math.sign(this.velocity.y) * eps));
        wallNudged = true;
      }
      if (gb.topLeft.x < b.topLeft.x && this.velocity.x < 0) {
        this.velocity = this.velocity.flipX();
        this.pen.location = this.pen.location.addPt(pt(Math.sign(this.velocity.x) * eps, 0));
        wallNudged = true;
      }
      if (gb.bottomRight().x > b.bottomRight().x && this.velocity.x > 0) {
        this.velocity = this.velocity.flipX();
        this.pen.location = this.pen.location.addPt(pt(Math.sign(this.velocity.x) * eps, 0));
        wallNudged = true;
      }
      if (wallNudged) this.moveTo(this.pen.location);
      gb = this.collisionBounds();
      for (let i = 0; i < world.submorphs.length; i++) {
        let sub = world.submorphs[i];
        if (sub === this) continue;
        let sb = sub.getBounds();
        if (!gb.overlapsRect(sb)) continue;
        if (prevGb.overlapsRect(sb)) continue;
        let axis = gb.overlapBounceAxis(sb, this.velocity);
        if (axis === 'x') {
          this.velocity = this.velocity.flipX();
          this.pen.location = this.pen.location.addPt(pt(Math.sign(this.velocity.x) * eps, 0));
        } else if (axis === 'y') {
          this.velocity = this.velocity.flipY();
          this.pen.location = this.pen.location.addPt(pt(0, Math.sign(this.velocity.y) * eps));
        }
        this.moveTo(this.pen.location);
        gb = this.collisionBounds();
        break;
      }
      this.syncRotationToVelocity();
      world.changed();
    };
    bouncers.push(bug);
    bug.startStepping('bouncerStep', null, 50);
    return bug;
  }
  morphsAtPointInDepthOrder(pt) {
    // Return deepest hit morph first, then owner chain up toward world.
    // Skip halo/handle layers in hit-testing so repeated meta-clicks climb real morphs, not the HaloMorph.
    let m = this.topMorphAtExcludingHaloUI(pt);
    if (!m) return [];
    let chain = [];
    while (m && m !== this) {
      if (
        m.className !== 'HaloMorph' &&
        m.className !== 'HaloHandle' &&
        m.className !== 'HandMorph'
      ) {
        chain.push(m);
      }
      m = m.owner;
    }
    if (this.fullBounds().includesPt(pt)) chain.push(this);
    return chain;
  }
  myHand() {
    return this.handForID($actorID);
  }
  onKeyDown(evt) {
    // Match browser modifier state (handles Shift+N and both Shift keys reliably).
    this.$shiftKeyDown = !!evt.shiftKey;
    _refreshPadModifierStyles();
    if (!this.$keyboardFocus) return null;
    if (this.$keyboardFocus.onKeyDown) return this.$keyboardFocus.onKeyDown(evt);
  }
  onKeyPress(evt) {
    this.$shiftKeyDown = !!evt.shiftKey;
    _refreshPadModifierStyles();
    if (this.$keyboardFocus != null && this.$keyboardFocus.world() != null) {
      this.$keyboardFocus.onKeyPress(evt);
    }
  }
  onKeyUp(evt) {
    this.$shiftKeyDown = !!evt.shiftKey;
    _refreshPadModifierStyles();
    if (this.$keyboardFocus && this.$keyboardFocus.onKeyUp) this.$keyboardFocus.onKeyUp(evt);
    return super.onKeyUp(evt);
  }
  onLongClickHalo(pt, downEvt) {
    /** Halo cycling when `evt.longClick` fires after {@link LONG_CLICK_MS}. */
    if (this.dismissFleetingMenusAt(pt)) return;
    if (pointerOnOskKeyUI(this, pt)) return;
    if (this.longClickHaloDefersAt(pt)) return;
    this.cycleHaloAt(pt);
  }
  onPointerDown(p, evt) {
    setPointerLocation(p);
    // Dismiss fleeting menus but still deliver this click to morphs underneath
    // (otherwise the first click after a pane menu only closes the menu).
    this.dismissFleetingMenusAt(p);
    if (effectiveMetaKey(evt) && !pointerOnOskKeyUI(this, p)) {
      consumeSoftMetaKey();
      this.cycleHaloAt(p);
      return true;
    }
    // Hands are drawn from this.hands, not the submorph tree. If the active hand
    // (cursor) is over another hand, clicking it switches $actorID to that hand.
    let activeHand = this.handForID(evt.actorID);
    let handUnder = this.handAt(p, activeHand);
    if (handUnder) {
      this.activateHand(handUnder, p, evt);
      return true;
    }
    // this.removeExistingHalos();  // OK here?
    let hand = activeHand;
    if (hand && evt.altKey) {
      hand.onPointerDown(p, evt);
      return true;
    }
    if (this.$pointerFocus && this.$pointerFocus._stickyDragCollapsedBar) {
      let pf = this.$pointerFocus;
      let pForFocus = pf.owner ? pf.owner.localize(p) : p;
      return pf.finishStickyCollapsedTitleBarDrag(pForFocus, evt);
    }
    let hit = false; // return of true stops at top morph
    this.allSubmorphsTopFirst().forEach((morph) => {
      // Pass world/owner coords into child; it will localize as needed.
      // Top-first order means ephemeral morphs (halos, per-user UI) see the event first.
      if (!hit) hit = morph.onPointerDown(p, evt);
    });
    if (!hit) {
      this.removeExistingHalos();
      this.setKeyboardFocus(null);
    }
    return hit;
  }
  onPointerMove(p, evt) {
    let hand = this.handForID(evt.actorID);
    if (hand) {
      // Hand must see the previous location to compute its delta; update shared
      // pointerLocation only after the hand has moved.
      hand.onPointerMove(p, evt);
      setPointerLocation(p);
      if (hand.hasSubmorphs()) return true;
    } else {
      setPointerLocation(p);
    }
    if (this.$pointerFocus) {
      // pointerFocus expects pt in its owner's coords (e.g. SliderMorph in ListPane)
      let pForFocus = this.$pointerFocus.owner ? this.$pointerFocus.owner.localize(p) : p;
      return this.$pointerFocus.onPointerMove(pForFocus, evt);
    }
    this.eachSubmorph((morph) => morph.onPointerMove(p, evt));
  }
  onPointerUp(p, evt) {
    setPointerLocation(p);
    let hand = this.handForID(evt.actorID);
    if (hand) {
      let handHandled = hand.hasSubmorphs() || evt.altKey;
      hand.onPointerUp(p, evt);
      if (handHandled) return true;
    }
    let result;
    if (this.$pointerFocus) {
      let pForFocus = this.$pointerFocus.owner ? this.$pointerFocus.owner.localize(p) : p;
      result = this.$pointerFocus.onPointerUp(pForFocus, evt);
    } else {
      this.eachSubmorph((morph) => morph.onPointerUp(p, evt));
    }
    return result;
  }
  removeExistingHalos() {
    // Halos are per-user: they live in $submorphs. Collect first, then remove, so we
    // never mutate a list while iterating it. (Scans both layers for robustness.)
    let halos = [];
    this.eachSubmorph((morph) => {
      if (morph.className == 'HaloMorph') halos.push(morph);
    });
    halos.forEach((halo) => halo.remove());
  }
  removeHand(handMorph) {
    this.hands = this.hands.filter((m) => m !== handMorph);
    this.updateCursorForHands();
  }
  render(ctx) {
    this.handleStepList();
    this.renderOn(ctx);
    if (this.hands)
      this.hands.forEach((hand) => {
        ctx.save();
        const tfm = hand.transform;
        ctx.translate(tfm.translation.x, tfm.translation.y);
        ctx.rotate(tfm.rotation);
        ctx.scale(tfm.scale.x, tfm.scale.y);
        hand.renderOn(ctx);
        ctx.restore();
      });
  }
  setKeyboardFocus(morphOrNull) {
    /*
     * Keyboard companion + live documentation:
     * — Only comments inside method bodies (like this block) are indexed for the user’s
     *   online search; place cross-cutting notes near the code they describe.
     * — keyboardFocus is the morph that receives synthetic keys from OnScreenKeyboardMorph
     *   (see handleVirtualKey) and physical keys from the host. Only TextMorph sets it;
     *   other morphs clear it via clearKeyboardFocusUnlessTypingOrOsk when a morph
     *   handles a click that did not go to a submorph (e.g. chrome, not TextMorph).
     * — World menu “On-screen keyboard” toggles $useOnScreenKbd; the keyboard’s ✕ key
     *   removes it and clears $useOnScreenKbd.
     * — When $useOnScreenKbd is true, OSK follows keyboardFocus automatically.
     */
    // PER-USER ($-prefixed): my physical keyboard's focus is mine by nature. Shared
    // focus meant two people editing different panes routed keys to whichever pane
    // was focused last, and a focus set before reload leaked into the next session.
    if (this.$keyboardFocus === morphOrNull) return;
    this.$keyboardFocus = morphOrNull;
    syncOnScreenKeyboardWithFocus(this);
  }
  setPointerFocus(morphOrNull) {
    /**
     * PER-USER ($-prefixed): the morph receiving my pointer stream. Two reasons it
     * must be ephemeral: (1) two users dragging concurrently must not steal each
     * other's gesture; (2) it can point at per-user morphs (halo handles) — a
     * persistent reference would make them persistently reachable, silently promoting
     * the whole halo into the shared document at end-of-transaction GC.
     */
    this.$pointerFocus = morphOrNull;
  }
  showHaloHelp() {
    Lively.addMorph(
      new MethodPanel(
        null,
        `HALOS
    Halos provide ten "handles" for manipulating morphs.  Halos are accessed by a meta-click (see also below) and the handles offer the following functions, not all of which will always be available...
    'R' - Rotate: Drag the handle to rotate the target object
    'S' - Style: Open a style editor to choose fill and border color and border width
    'C' - Copy: Make a copy of this object, attached to the hand for dragging
    'M' - Menu: Bring up a menu of commands for this object
    'G' - Grab: Pluck this object out of its owner, and drop it elsewhere
    Note: this can be useful to bring obscured objects 'forward'
    'D' - Drag: Drag this object without removing it from its current owner
    'X' - Delete: Delete this object
    'B' - Browse: Open a browser to edit the code for this object
    'I' -  Inspect: Open an inspector on this object
    'Z' - Scale: Drag the handle to resize the object (changes bounds)
    Shift-drag Z: drag to grow or shrink via transform.scale (shape and submorphs)
    Note that on platforms that do not offer meta keys, halos can still be accessed by enabling the "Long click for halos" option in the world menu.  This may occasionally prove bothersome when selecting in text, but you can always turn the feature off again.
    [Long-press is currently $LONG_CLICK_MS ==> 700 ms
    and $LONG_CLICK_MOVE_CANCEL_PX ==> 7 pixels]
    `,
        'Halo help',
      ),
    );
  }
  showMorphicHelp() {
    Lively.addMorph(
      new MethodPanel(
        null,
        `MORPHIC
    The graphics model of this system is Morphic, and the UI is taken very closely from Squeak and Lively.
    All objects ("morphs") on the screen are in a tree of morphs (owners) and submorphs, similar to the parent/children structure of HTML.  The root of this tree is a WorldMorph, and any morph can access it with the method "world()".
    Each user is associated with a "hand" that can pick up any morph (removing it from its prior owner (may be the "world")), and drop it on another object that then becomes its new owner. The hand is the sole source of pointer and keyboard events.
    Every morph has a 2-D coordinate transform between its bounds (in its owner's oordinate system) and its submorphs and other graphical content)).
    Please note: hands and transforms are not currently used`,
        'Morphic help',
      ),
    );
  }
  showTextHelp() {
    Lively.addMorph(
      new MethodPanel(
        null,
        `Text editing in this system is very simple - there are no automatic pop-ups or type-aheads.  The following command-keys provide basic edits:
    [Note: currently on a Mac, you must stick to the designated form of meta key to achieve the desired results]
    ctrl-A: select the entire string
    ctrl-X: cut the current selection
    ctrl-C: copy the current selection to a paste buffer
    also gets copied to the OS paste buffer!
    the menu 'paste...' command accesses the last 4 of these
    ctrl-V: paste the contents of the paste buffer
    ctrl-D: evaluate the current selection (more about scope etc)
    ctrl-P: paste the result of evaluating the current selection
    ctrl-F: search for the current selection and browse occurrences
    ctrl-G: (think 'aGain') do another similar replacement
    ctrl-P: paste the result of evaluating the current selection
    ctrl-S: evaluate the entire string (ie 'save' in browser method pane)
    ctrl-Z: should undo most edits, and even a ctrl-P
    esc:    selects what you just typed.  Handy when followed by ctrl-F
    to search for that string, or ctrl-P to print its value
    A couple more nice features:
    Careful double clicking next to most bracket characters will select matching parentheses and other brackets (even // and /*).  Double click at the beginning or end ot the entire text will select all of it.
    If you shift-click near either end of a selection it lets you change that end of the selection range`,
        'Text help',
      ),
    );
  }
  showWorldMenuAt(pos, optsIfAny) {
    let opts = optsIfAny || {};
    let items = [
      'ToDo List',
      'System browser',
      'Recent changes',
      'Morphic help',
      'Halo help',
      'Text help',
      'Init hand',
      'Open Transcript',
      'Open Console',
      'Restart Console',
      menuToggleLabel(longClickForHalosLabel, $longClickForHalos),
      menuToggleLabel(onScreenKeyboardLabel, $useOnScreenKbd),
    ];
    // Use a normal function so MenuMorph's actionFn.call(this, ...) supplies the menu as `this`
    // (avoids referencing outer `theMenu` before assignment / TDZ in the arrow closure).
    let menu = new MenuMorph(pos.extent(pt(220, 24 + items.length * 20)), items, function (item) {
      let wld = this.world();
      let cap = menuItemCaption(item);
      if (item == 'ToDo List') storageEditItem('ToDoList');
      if (item == 'System browser') wld.addMorph(new BrowserPanel());
      if (item == 'Recent changes') browseRecentChanges();
      if (item == 'Morphic help') wld.showMorphicHelp();
      if (item == 'Halo help') wld.showHaloHelp();
      if (item == 'Text help') wld.showTextHelp();
      if (cap === longClickForHalosLabel || cap.endsWith(longClickForHalosLabel)) {
        $longClickForHalos = !$longClickForHalos;
        refreshWorldMenuItems(this);
      }
      if (cap === onScreenKeyboardLabel || cap.endsWith(onScreenKeyboardLabel)) {
        $useOnScreenKbd = !$useOnScreenKbd;
        syncOnScreenKeyboardWithFocus(this.world());
        refreshWorldMenuItems(this);
      }
      if (item == 'Init hand') this.world().initHand(true);
      if (item == 'Open Transcript') {
        let p = openTranscript();
        if (p) {
          p.setPanelTitle('Transcript');
          Transcript = p;
        }
      }
      if (item == 'Open Console') {
        let p = openTranscript();
        if (p) {
          p.setPanelTitle('Console');
          Console = p;
          if (p.transcriptPane) p.transcriptPane.setConsoleMirror(true);
        }
      }
      if (item == 'Restart Console') {
        let con = Console;
        if (con && con.transcriptPane) con.transcriptPane.setConsoleMirror(true);
      }
      this.shape.selectLineAt(0); // deselect after actions
    });
    menu.isFleetingMenu = !!opts.fleeting;
    Lively.addMorph(menu);
  }
  activeStepList() {
    /** Lazily created: worlds restored from older documents have no $stepList yet. */
    if (!this.$stepList) this.$stepList = [];
    return this.$stepList;
  }
  startSteppingSpec(spec) {
    this.activeStepList().push(spec);
  }
  stopSteppingMorph(morph, methodName) {
    if (methodName) {
      this.$stepList = this.activeStepList().filter(
        (spec) => !(spec.stepMorph === morph && spec.methodName === methodName),
      );
      return;
    }
    this.$stepList = this.activeStepList().filter((spec) => spec.stepMorph !== morph);
  }
  topMorphAt(pt) {
    // Deepest morph under pt; among overlapping siblings, frontmost wins.
    // pt is world coordinates.
    let walk = (ownerMorph, worldPt) => {
      let subs = ownerMorph.allSubmorphsTopFirst(); // ephemeral layer is frontmost
      for (let i = 0; i < subs.length; i++) {
        let sub = subs.at(i);
        let pInOwner = sub.owner ? sub.owner.localize(worldPt) : worldPt;
        // fullBounds (AABB incl. submorph stickouts) is just a cheap prefilter;
        // the hit itself must be on a shape, so rotated morphs' AABB corner
        // wedges and stickout dead zones fall through to siblings behind.
        if (!sub.fullBounds().includesPt(pInOwner)) continue;
        let deeper = walk(sub, worldPt);
        if (deeper != null) return deeper;
        if (sub.includesPt(pInOwner)) return sub;
      }
      return null;
    };
    return walk(this, pt);
  }
  topMorphAtExcludingHaloUI(pt) {
    /** Like {@link topMorphAt} but skips halo UI and hands so halo cycling hits morphs *behind* them (avoids halos-on-halos). */
    let walk = (ownerMorph, worldPt) => {
      let subs = ownerMorph.allSubmorphsTopFirst();
      for (let i = 0; i < subs.length; i++) {
        let sub = subs.at(i);
        let cn = sub.className;
        if (cn === 'HaloMorph' || cn === 'HaloHandle' || cn === 'HandMorph') continue;
        let pInOwner = sub.owner ? sub.owner.localize(worldPt) : worldPt;
        // Same shape-exact hit rule as topMorphAt: bounds only gate descent.
        if (!sub.fullBounds().includesPt(pInOwner)) continue;
        let deeper = walk(sub, worldPt);
        if (deeper != null) return deeper;
        if (sub.includesPt(pInOwner)) return sub;
      }
      return null;
    };
    return walk(this, pt);
  }
  updateCursorForHands() {
    let canvas = canvas ? canvas : null;
    if (!canvas) return;
    canvas.style.cursor = this.hands && this.hands.length > 0 ? 'none' : 'default';
  }
  world() {
    // Note should be cleaner -- see other implementations
    return this;
  }
  static new(...args) {
    return new this(...args);
  }
}

// +----------------------------+
// |  Source Code Manipulation  |
// +----------------------------+
// Browse, export, delete, and persist method definitions.

function exportPartsForSelection(selection, optsIfAny) {
  let opts = optsIfAny || {};
  let includeClassDef = opts.includeClassDef !== false;
  let classSelection = selection;
  if (!classSelection) return null;
  let header = '// Export for ' + classSelection + '\n';
  let classDef = '';
  if (classSelection == 'globals') {
    let names = Object.getOwnPropertyNames($global)
      .filter((name) => typeof $global[name] == 'function' && !isClass($global[name]))
      .filter((name) => !exportMethodShouldOmit(name))
      .sort();
    let lines = names.map((name) => name + ' = ' + $global[name].toString());
    return { header, classDef, lines };
  }
  if (classSelection.endsWith('.class')) {
    let classOnly = classSelection.split('.')[0];
    let cls = $global[classOnly];
    if (!cls) return null;
    let names = classStaticNames(cls)
      .filter((name) => typeof cls[name] == 'function')
      .filter((name) => !exportMethodShouldOmit(name));
    let lines = names.map((name) => classOnly + '.' + name + ' = ' + cls[name].toString());
    return { header, classDef, lines };
  }
  let cls = $global[classSelection];
  if (!cls || !cls.prototype) return null;
  if (includeClassDef && isClass(cls)) classDef = cls.toString();
  let names = classInstanceMemberNames(cls)
    .filter((name) => typeof cls.prototype[name] == 'function')
    .filter((name) => !exportMethodShouldOmit(name));
  let lines = names.map(
    (name) => classSelection + '.prototype.' + name + ' = ' + cls.prototype[name].toString(),
  );
  return { header, classDef, lines };
}
function exportStringForSelection(selection, optsIfAny) {
  let opts = optsIfAny || {};
  let includeHeader = opts.includeHeader !== false;
  let parts = exportPartsForSelection(selection, opts);
  if (!parts) return '';
  let out = [];
  if (includeHeader && parts.header) out.push(parts.header);
  if (parts.classDef) out.push(parts.classDef);
  if (parts.lines && parts.lines.length > 0) out.push(parts.lines.join(';\n'));
  return out.join('\n');
}
function exportSelectionsForEntireSystem() {
  let selections = ['globals'];
  allClassNamesInSuperclassOrder().forEach((className) => {
    selections.push(className);
    if (classStaticNames($global[className]).length > 0) selections.push(className + '.class');
  });
  return selections;
}
function methodFromSpec(spec) {
  // methodFromSpec('rect')                     — a global function
  // methodFromSpec('Color.gray')               — a class static
  // methodFromSpec('Color.prototype.copy')     — an instance method
  let parts = spec.split('.');
  if (parts.length == 1) return $global[parts[0]];
  let cls = $global[parts[0]];
  if (cls == null) return null;
  if (parts.length == 2) return cls[parts[1]];
  if (parts.length == 3 && parts[1] == 'prototype' && cls.prototype)
    return cls.prototype[parts[2]];
  return null;
}
function methodSpecKey(spec) {
  /** Method spec key without a recent-changes date suffix. */
  if (!spec) return spec;
  if (spec.includes('[')) return spec.slice(0, spec.indexOf('[') - 1).trim();
  return spec;
}
function deleteMethodWithSpec(spec) {
  /** Remove a live method by spec (`Morph.prototype.foo`, `Color.gray`, `init`, …). */
  let key = methodSpecKey(spec);
  if (!key) return false;
  try {
    let parts = key.split('.');
    if (parts.length == 1) delete $global[parts[0]];
    else if (parts.length == 2) delete $global[parts[0]][parts[1]];
    else if (parts.length == 3 && parts[1] == 'prototype')
      delete $global[parts[0]].prototype[parts[2]];
    else return false;
    return true;
  } catch (e) {
    console.log('delete failed: ' + key, e);
    return false;
  }
}
function deleteClassNamed(className) {
  if (!className || className == 'globals' || !$global[className]) return false;
  try {
    delete $global[className];
    return true;
  } catch (e) {
    console.log('delete class failed: ' + className, e);
    return false;
  }
}
function methodsContaining(searchString) {
  // methodsContaining('Pane').length
  let lcKey = searchString.toLowerCase(); //For case-insensitive compare
  let found = [];
  allMethodSpecs().forEach((spec) => {
    let method = methodFromSpec(spec);
    if (typeof method !== 'function') return;
    let bodyLc = method.toString().toLowerCase();
    let specLc = spec.toLowerCase();
    if (bodyLc.indexOf(lcKey) >= 0 || specLc.indexOf(lcKey) >= 0) found.push(spec);
  });
  return found;
}
function showFindNoMatchesMenu(world, pt, searchString) {
  /** Fleeting notifier for find-in-methods when there are zero hits (no panel required). */
  if (!world) return;
  let term = '' + (searchString != null ? searchString : '');
  let msg =
    "no occurrences of '" + term.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' were found";
  let menu = new MenuMorph(
    rect(pt.x, pt.y, Math.max(280, 24 + Math.min(msg.length, 80) * 7), 48),
    [msg],
    function () {
      menu.remove();
    },
  );
  menu.isFleetingMenu = true;
  world.addMorph(menu);
}
function noteMethodChanges(evalString) {
  /* recentChanges is an array of triples as in the last line here
  spec, eg, 'TextBox.prototype.render'
  date string - see recentDateStr
  the method string beginning with 'function' */
  if (!recentChanges) recentChanges = [];
  let ix1 = evalString.indexOf(' =');
  if (ix1 < 0) return;
  let ix2 = evalString.indexOf('function', ix1);
  if ((ix2, 0)) return;
  let spec = evalString.slice(0, ix1);
  // If method already exists, but no change, add current def for revert
  let noChange = true;
  recentChanges.forEach((tuple) => {
    if (tuple[0] == spec) noChange = false;
  });
  if (noChange && methodFromSpec(spec) !== null) {
    let priorTime = new Date(new Date().getTime() - 60000); // a minute ago
    recentChanges.push([spec, recentDateStr(priorTime), methodFromSpec(spec)]);
  }
  recentChanges.push([spec, recentDateStr(new Date()), evalString.slice(ix2)]);
}
function browseRecentChanges() {
  // browseRecentChanges()
  let changes = recentChanges ?? [];
  let panel = Lively.addMorph(
    new MethodListPanel(
      null,
      changes.map((tuple) => tuple[0] + tuple[1]),
      changes,
      'Recent Changes',
    ),
  );
  return panel;
}
function browseSavedChanges() {
  // browseSavedChanges()
  let changes = JSON.parse(storageGetItem('recentChanges'));
  let panel = Lively.addMorph(
    new MethodListPanel(
      null,
      changes.map((tuple) => tuple[0] + tuple[1]),
      changes,
      'Saved Changes',
    ),
  );
  return panel;
}
function stats() {
  //stats();
  let statList = [];
  statList.push('# classes = ' + allClassNames().length);
  statList.push('# methods = ' + allMethodSpecs().length);
  let nLines = 0,
    nComments = 0,
    nLogs = 0,
    nChars = 0;
  allMethodSpecs().forEach((spec) => {
    let method = methodFromSpec(spec);
    if (typeof method == 'function') {
      let methStr = method.toString();
      nChars += methStr.length;
      let lines = methStr.split(/[\n\r]/);
      lines.forEach((line) => {
        nLines += 1;
        let trimmed = line.trim();
        if (trimmed.startsWith('//')) nComments += 1;
        if (trimmed.startsWith('console.')) nLogs += 1;
      });
    }
  });
  statList.push('# lines = ' + nLines);
  statList.push('# comments = ' + nComments);
  statList.push('# logs = ' + nLogs);
  statList.push('# chars = ' + nChars);
  return statList.join('\n');
}
function allMethodSpecs() {
  // allMethodSpecs().length ==> 307
  let methodSpecs = [];
  // First, all global functions (classes get their own entries below)
  Object.getOwnPropertyNames($global)
    .sort()
    .forEach((name) => {
      if (typeof $global[name] == 'function' && !isClass($global[name])) methodSpecs.push(name);
    });
  allClassNamesInSuperclassOrder().forEach((className) => {
    let cls = $global[className];
    classInstanceMemberNames(cls).forEach((methodName) => {
      methodSpecs.push(className + '.prototype.' + methodName);
    });
    // Here we allow, eg, class constants such as Color.red
    classStaticNames(cls).forEach((methodName) => {
      methodSpecs.push(className + '.' + methodName);
    });
  });
  return methodSpecs;
}
function exportEntireSystem() {
  // exportEntireSystem() — full system source; viewExportedSystem() to browse
  let parts = exportSelectionsForEntireSystem().map((selection) =>
    exportStringForSelection(selection, { includeHeader: true, includeClassDef: true }),
  );
  let text = parts.filter((part) => part && part.length > 0).join('\n\n');
  storageSetItem('system.export', text);
  storageSetItem('system.export.timestamp', new Date().toLocaleString());
  return text.length;
}
function viewExportedSystem() {
  let text = storageGetItem('system.export') || storageGetItem('system.methods');
  if (!text) text = '// No export yet. Run exportEntireSystem() first.';
  let ts =
    storageGetItem('system.export.timestamp') || storageGetItem('system.methods.timestamp') || '';
  let title = ts ? 'alldefs export (' + ts + ')' : 'alldefs export';
  Lively.addMorph(new MethodPanel(null, text, title));
  return text.length;
}
function exportMethodShouldOmit(name) {
  if (
    name === 'downloadTextFile' ||
    name === '_finishSystemExport' ||
    name === 'viewExportedSystem' ||
    name === 'exportEntireSystem' ||
    name === 'exportMethodShouldOmit' ||
    name === 'exportOmitMethodNames'
  )
    return true;
  if (name.indexOf('exportCatalog') === 0) return true;
  if (
    name === 'exportClassChunk' ||
    name === 'exportMethodLinesOn' ||
    name === 'exportProtoDataLines' ||
    name === 'exportColorDataLines'
  )
    return true;
  if (name.indexOf('systemCategory') === 0 || name.indexOf('systemClass') === 0) return true;
  if (name === 'systemCatalog' || name === 'systemClassBlurbs') return true;
  if (name === 'systemFileHeader' || name === 'systemBootstrapSource') return true;
  return false;
}
// +-------------------------------+
// |  Error Handling and Recovery  |
// +-------------------------------+
// On-screen error panel, stack traces, and eval recovery.

function stackTraceLines(err, catchStackIfAny) {
  let lines = [];
  if (err && err.stack) lines = ('' + err.stack).split('\n');
  else if (catchStackIfAny) lines = ('' + catchStackIfAny).split('\n').slice(1);
  return lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
}
function parseStackFrameLine(line) {
  let m = ('' + line)
    .trim()
    .match(/^at\s+(?:([\s\S]+?)\s+\(([\s\S]+?):(\d+):(\d+)\)|([\s\S]+?):(\d+):(\d+))$/);
  if (!m) return null;
  if (m[1] != null) return { name: m[1].trim(), file: m[2], line: +m[3], col: +m[4] };
  return { name: null, file: m[5], line: +m[6], col: +m[7] };
}
function defsSourceFile() {
  /** Basename of the live defs script (override with window.defsScriptUrl). */
  let url =
    window.defsScriptUrl != null
      ? window.defsScriptUrl
      : window.alldefsScriptUrl != null
        ? window.alldefsScriptUrl
        : 'newdefs.js';
  return shortStackFileName(url);
}
function shortStackFileName(file) {
  let s = String(file || '');
  let q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  let ix = s.lastIndexOf('/');
  if (ix >= 0) s = s.slice(ix + 1);
  return s || file;
}
function isDefsStackFile(file) {
  let base = shortStackFileName(file).toLowerCase();
  let want = defsSourceFile().toLowerCase();
  // Accept configured name plus the historical alldefs/newdefs aliases.
  return base === want || base === 'newdefs.js' || base === 'alldefs.js';
}
function extractDefsLineFromFrame(line) {
  let m = ('' + line).match(/([\w.-]+\.js)(?:\?[^:]*)?:(\d+)(?::(\d+))?/i);
  if (!m || !isDefsStackFile(m[1])) return null;
  return { file: shortStackFileName(m[1]), line: +m[2], col: m[3] != null ? +m[3] : 0 };
}
/** @deprecated alias — prefer extractDefsLineFromFrame */
function extractAlldefsLineFromFrame(line) {
  return extractDefsLineFromFrame(line);
}
/** @deprecated alias — prefer isDefsStackFile */
function isAlldefsStackFile(file) {
  return isDefsStackFile(file);
}
function stackFrameLabelName(line) {
  let m = ('' + line).trim().match(/^at\s+(.+?)\s+\(/);
  if (m) return m[1].trim();
  m = ('' + line).trim().match(/^at\s+(\S+)/);
  return m ? m[1] : 'frame';
}
function scrubStackFrameUrls(line) {
  return ('' + line).replace(/https?:\/\/[^\s):]+/g, function (url) {
    return shortStackFileName(url);
  });
}
function formatStackFrameLine(rawLine) {
  let line = String(rawLine).trim();
  let frame = parseStackFrameLine(line);
  if (frame) {
    let shortFile = shortStackFileName(frame.file);
    if (frame.name) return ['  at ' + frame.name + ' (' + shortFile + ':' + frame.line + ')'];
    return ['  at ' + shortFile + ':' + frame.line];
  }
  let defsRef = extractDefsLineFromFrame(line);
  if (defsRef) {
    let name = stackFrameLabelName(line);
    return ['  at ' + name + ' (' + defsRef.file + ':' + defsRef.line + ')'];
  }
  let scrubbed = scrubStackFrameUrls(line);
  return [scrubbed.startsWith('at ') ? '  ' + scrubbed : scrubbed];
}
function formatStackTraceForReport(err) {
  let trace = stackTraceLines(err);
  if (!trace.length) {
    try {
      throw new Error('stack capture');
    } catch (cap) {
      trace = stackTraceLines(cap).slice(1);
    }
  }
  let msg = err && err.message != null ? String(err.message) : String(err);
  let errName = err && err.name ? err.name : 'Error';
  let parts = [];
  trace.forEach(function (line) {
    if (line.indexOf('Error:') === 0 && line.indexOf(msg) >= 0) return;
    if (line.indexOf(errName + ':') === 0 && line.indexOf(msg) >= 0) return;
    parts.push.apply(parts, formatStackFrameLine(line));
  });
  return parts;
}
function stackNameToMethodSpec(name) {
  // 'Proxy.foo' / 'Object.foo' wrappers come from the runtime's proxies; the bare
  // trailing name is the interesting part.
  if (!name || name === 'eval' || name === '<anonymous>') return null;
  let s = String(name).trim();
  if (/^(Proxy|Object)\.\w+$/.test(s)) s = s.slice(s.indexOf('.') + 1);
  if (/^\w+\.prototype\.\w+$/.test(s)) return s;
  if (/^\w+$/.test(s) && typeof $global[s] === 'function') return s;
  return null;
}
function stackFrameSourceText(frame) {
  if (frame.methodSpec) {
    try {
      let fn = methodFromSpec(frame.methodSpec);
      if (typeof fn === 'function') return frame.methodSpec + ' = ' + fn.toString();
    } catch (e) {
      /* fall through */
    }
  }
  if (frame.alldefsLine && _alldefsSourceLines) {
    return alldefsSourceExcerpt(frame.alldefsLine, 4)
      .map(function (ex) {
        return String(ex.no).padStart(5) + '  ' + ex.text;
      })
      .join('\n');
  }
  if ((frame.name === 'eval' || frame.name === '<anonymous>') && _lastEvalSource)
    return _lastEvalSource;
  return null;
}
function stackFrameListLabel(frame) {
  if (frame.methodSpec) return frame.methodSpec;
  if (frame.name === 'eval' || frame.name === '<anonymous>') {
    if (_lastEvalSource)
      return 'eval: ' + truncateString(_lastEvalSource.replace(/\s+/g, ' ').trim(), 52);
    return 'eval';
  }
  if (frame.name && frame.file && frame.line)
    return frame.name + ' (' + shortStackFileName(frame.file) + ':' + frame.line + ')';
  if (frame.name) return frame.name;
  if (frame.alldefsLine)
    return (frame.defsFile || defsSourceFile()) + ':' + frame.alldefsLine;
  return 'frame';
}
function stackFrameHighlightName(frame) {
  if (!frame) return null;
  if (frame.methodSpec) {
    let dot = frame.methodSpec.lastIndexOf('.');
    return dot >= 0 ? frame.methodSpec.slice(dot + 1) : frame.methodSpec;
  }
  let n = frame.name ? String(frame.name).trim() : '';
  if (!n || n === 'eval' || n === '<anonymous>') return null;
  let dot = n.lastIndexOf('.');
  return dot >= 0 ? n.slice(dot + 1) : n;
}
function stackFrameFromRawLine(rawLine) {
  let line = String(rawLine).trim();
  let name = stackFrameLabelName(line);
  let parsed = parseStackFrameLine(line);
  let defsRef = extractDefsLineFromFrame(line);
  let methodSpec = stackNameToMethodSpec(name);
  let file = parsed ? shortStackFileName(parsed.file) : defsRef ? defsRef.file : null;
  let lineNo = parsed ? parsed.line : defsRef ? defsRef.line : null;
  let defsLine = null;
  let defsFile = null;
  if (file && lineNo != null && isDefsStackFile(file)) {
    defsLine = lineNo;
    defsFile = file;
  } else if (defsRef) {
    defsLine = defsRef.line;
    defsFile = defsRef.file;
  }
  let frame = {
    name: name,
    file: file,
    line: lineNo,
    alldefsLine: defsLine, // line in defs source file, if any
    defsFile: defsFile,
    methodSpec: methodSpec,
  };
  frame.listLabel = stackFrameListLabel(frame);
  frame.sourceText = stackFrameSourceText(frame);
  return frame;
}
function stackFramesFromError(err) {
  let trace = stackTraceLines(err);
  let msg = err && err.message != null ? String(err.message) : String(err);
  let errName = err && err.name ? err.name : 'Error';
  let frames = [];
  trace.forEach(function (line) {
    if (line.indexOf('Error:') === 0 && line.indexOf(msg) >= 0) return;
    if (line.indexOf(errName + ':') === 0 && line.indexOf(msg) >= 0) return;
    frames.push(stackFrameFromRawLine(line));
  });
  return frames;
}
function errorReportHeader(err, contextIfAny) {
  let when = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let name = err && err.name ? err.name : 'Error';
  let msg = err && err.message != null ? String(err.message) : String(err);
  let parts = ['// Runtime error — ' + when];
  if (contextIfAny) parts.push('// Context: ' + contextIfAny);
  parts.push('', name + ': ' + msg);
  return parts.join('\n');
}
function formatErrorReport(err, contextIfAny) {
  let parts = [errorReportHeader(err, contextIfAny), '', '// Stack trace:'];
  formatStackTraceForReport(err).forEach(function (line) {
    parts.push(line);
  });
  return parts.join('\n');
}
function ensureAlldefsSourceLines() {
  // TODO: think about fetch
  return null;

  if (_alldefsSourceLines) return Promise.resolve(_alldefsSourceLines);
  let url =
    window.defsScriptUrl != null
      ? window.defsScriptUrl
      : window.alldefsScriptUrl != null
        ? window.alldefsScriptUrl
        : defsSourceFile();
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('ensureAlldefsSourceLines: ' + r.status + ' ' + url);
      return r.text();
    })
    .then(function (text) {
      _alldefsSourceLines = text.split('\n');
      return _alldefsSourceLines;
    })
    .catch(function (e) {
      console.warn('defs source not loaded for stack excerpts', e);
      return null;
    });
}
function alldefsSourceExcerpt(lineNo, radiusIfAny) {
  let lines = _alldefsSourceLines;
  if (!lines || lineNo < 1 || lineNo > lines.length) return [];
  let radius = radiusIfAny != null ? radiusIfAny : 1;
  let out = [];
  let lo = Math.max(0, lineNo - 1 - radius);
  let hi = Math.min(lines.length, lineNo - 1 + radius + 1);
  for (let i = lo; i < hi; i++) out.push({ no: i + 1, text: lines[i] });
  return out;
}
function handleRuntimeError(err, contextIfAny) {
  if (Lively && Lively.addMorph) {
    presentError(err, contextIfAny);
    return true;
  }
  recoverFromRuntimeError(err, contextIfAny);
  return false;
}
function errorPanelTitle(err) {
  let name = err && err.name ? err.name : 'Error';
  let msg = err && err.message != null ? String(err.message) : String(err);
  return 'Error: ' + truncateString(name + ' — ' + msg, 72);
}
function errorReportPanelBounds() {
  let b = getBounds();
  if (!b) return rect(40, 40, 520, 420);
  let wdt = Math.min(560, Math.max(320, Math.floor(b.width() * 0.55)));
  let ht = Math.min(520, Math.max(240, Math.floor(b.height() * 0.65)));
  return rect(24, 24, wdt, ht);
}
function openErrorStackPanel(err, contextIfAny, titleIfAny) {
  if (!Lively || !Lively.addMorph) return null;
  let panel = new ErrorStackPanel(
    errorReportPanelBounds(),
    err,
    contextIfAny,
    titleIfAny || errorPanelTitle(err),
  );
  Lively.addMorph(panel);
  panel.beTopMorph();
  return panel;
}
function presentError(err, contextIfAny) {
  let report = formatErrorReport(err, contextIfAny);
  _lastErrorReport = report;
  console.error(report);
  let panel = openErrorStackPanel(err, contextIfAny);
  if (!_alldefsSourceLines) {
    // ensureAlldefsSourceLines is currently disabled and returns null.
    let loading = ensureAlldefsSourceLines();
    if (loading && loading.then)
      loading.then(function () {
        if (panel && panel.refreshStackSources) panel.refreshStackSources();
      });
  }
  return panel;
}
function recoverFromRuntimeError(err, contextIfAny) {
  if (_errorRecoveryInProgress) {
    console.error('error during recovery', err);
    return null;
  }
  _errorRecoveryInProgress = true;
  try {
    let report = formatErrorReport(err, contextIfAny);
    _lastErrorReport = report;
    console.error(report);
    if (window._uiRafId != null) {
      window.cancelAnimationFrame(window._uiRafId);
      window._uiRafId = null;
    }
    if (window._uiAbortController) window._uiAbortController.abort();
    initUI();
    initLively();
    let panel = openErrorStackPanel(err, contextIfAny);
    render();
    return panel;
  } finally {
    _errorRecoveryInProgress = false;
  }
}
function evaluateWithErrorRecovery(fn, contextIfAny) {
  _evalJustFailed = false;
  try {
    return fn();
  } catch (err) {
    _evalJustFailed = true;
    presentError(err, contextIfAny);
    return undefined;
  }
}
function triggerTestError(messageIfAny) {
  throw new Error(messageIfAny != null ? String(messageIfAny) : 'intentional test error');
}
// +---------------------------------------+
// |  Sundry Global — Storage and History  |
// +---------------------------------------+
// localStorage wrappers, recent-changes journal, timing helpers.

function storageGetItem(key) {
  return localStorage.getItem(key);
}
function storageKeys() {
  return Object.keys(localStorage);
}
function storageSetItem(key, value) {
  // storageSetItem('test', 'test string to localStorage');
  // storageGetItem('test');
  // storageKeys();
  localStorage.setItem(key, value);
}
function storageEditItem(key) {
  //storageEditItem('ToDoList')
  Lively.addMorph(new MethodPanel(null, 'to do list', 'localStorage.' + key));
}
function saveRecentChanges() {
  // saveRecentChanges();
  let changes = recentChanges.slice(-50);
  storageSetItem('recentChanges', JSON.stringify(changes));
}
function recentChangesSince(dateStr) {
  // recentChanges = recentChangesSince('December 1, 2025') // shorten changes; shrink VM
  // recentChangesSince('October 1, 2025').length ==> 45
  let firstDate = new Date(dateStr);
  let changes = [];
  recentChanges.forEach((tuple) => {
    let timeAndDate = new Date(tuple[1].slice(2, 19));
    if (timeAndDate >= firstDate) changes.push(tuple);
  });
  return changes;
}
function recentDateStr(date) {
  // recentDateStr(new Date) ==>  [10:15 Jul 28 2025]
  // Private method for recent methods browsing
  let timeStr = date.toTimeString().slice(0, 5);
  let dateStr = date.toDateString().slice(4);
  return ' [' + timeStr + ' ' + dateStr + ']';
}
function timeSheet() {
  // timeSheet()
  //  Scan recentChanges, and report each day worked
  //  later we will add time span
  //  and finally methods worked on
  let report = '';
  let date = '';
  // TODO: startMS is not initialized -- looks like a bug to me!
  let startMS;
  let hours = 0;
  let methods = new Set();
  recentChanges.forEach((tuple) => {
    let timeAndDate = tuple[1].slice(2, 19);
    let datePart = timeAndDate.slice(6, 17);
    let timeMS = new Date(timeAndDate).getTime();
    if (datePart == date) {
      hours = (timeMS - startMS) / (60 * 60 * 1000);
      methods.add(tuple[0]);
    } else {
      date = datePart;
      startMS = timeMS;
      hours = Math.max(hours, 1.5);
      report += date + ': ' + hours.toFixed(1) + ' hours \n';
      Array.from(methods)
        .sort()
        .forEach((spec) => {
          report += '    ' + spec + '\n';
        });
      hours = 0;
      methods = new Set().add(tuple[0]);
    }
  });
  return report;
}
function msToRun(fn) {
  // msToRun(() => {return methodsContaining('//').length}) ==> 149,3
  let now = Date.now();
  let value = fn.call(this);
  return [value, Date.now() - now];
}
// +------------------------------+
// |  Sundry Global — Inspection  |
// +------------------------------+
// Quick object inspection in an InspectorPanel.

function inspect(obj, optionalBounds) {
  // inspect(pt(3, 5));
  let r;
  if (optionalBounds != null) {
    let o = optionalBounds;
    r = rect(o.topLeft.x, o.topLeft.y, o.width(), o.height());
  } else {
    r = rect(500, 100, 300, 300);
  }
  let p = new InspectorPanel(r, obj);
  Lively.addMorph(p);
  p.startStepping('showSelectedValue', false, 500);
  return p;
}
function inspectString(obj) {
  if (obj === null) return 'null';
  let typeStr = typeof obj;
  if (typeStr == 'number') return typeStr + ': ' + obj.toString();
  if (typeStr == 'boolean') return typeStr + ': ' + obj.toString();
  if (typeStr == 'string') return typeStr + ': ' + obj.toString();
  if (Array.isArray(obj)) {
    let parts = obj.map((el) => inspectString(el));
    return 'array: [' + parts.join(', ') + ']';
  }
  if (obj && obj.instanceOf) {
    if (obj.instanceOf(Point)) return obj.asString();
    if (obj.instanceOf(Rectangle)) return obj.asString();
    if (obj.instanceOf(SimpleTransform)) return obj.asString();
    if (obj.instanceOf(StepSpec)) return obj.asString();
  }
  try {
    let vowely = 'aeiou'.includes(obj.className[0].toLowerCase());
    typeStr = typeStr + (vowely ? ': an ' : ': a ') + obj.className;
  } catch (err) {
    typeStr = typeStr + ': ' + err;
  }
  return typeStr;
}
