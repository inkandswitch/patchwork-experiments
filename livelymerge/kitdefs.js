//written on 2026-10-05 13:54 PDT; gestures, hands and streaming added 2026-10-06 (see lm-07)
// The Kit — kernel
// =================
// Parts with slots, connected by wires, reacting to signals. See KIT_PLAN.md.
//
//  Part    The only kind of object. A part has a name, slots, sub-parts (each with
//          an owner), and an optional `like` part it delegates to for missing slots.
//  Slot    One namespace per part for data AND behaviour. A slot holding a function
//          is a script (its source is just script.toString()); anything else is data.
//          Slots named with a leading `$` are per-user and ephemeral (Livelymerge rule).
//  Signal  The single rule for anything happening:
//            part.signal(name, value)
//              1. run the script `on` + Name (signal 'click' runs onClick), if any
//              2. pass `value` along every wire leaving the part's outlet `name`
//          part.set(name, value) stores the value, then signals `name` — so setting
//          `count` runs onCount. Scripts WITHOUT the `on` prefix are actions
//          (increment, track): call them with part.run(name) or reach them by wire.
//  Wire    A part connecting one part's outlet to another part's slot (its inlet),
//          with an optional `transform` script. Delivery: if the inlet is an action
//          script, run it with the value; otherwise set the slot (which signals).
//
// Looks, layout, and input are conventions on ordinary slots, not new concepts:
//   geometry  x, y, w, h (owner coordinates), rotation (degrees), pivotX/pivotY
//             (0..1 of w/h, default 0.5 = rotate about the centre)
//   look      'box' (default) | 'oval' | 'none'; fill, border, borderWidth, radius;
//             text, fontSize, textColor, align; hidden; a `draw` script overrides
//   layout    'free' (default) | 'row' | 'column'; gap, padding; fit (shrink-wrap)
//   input     pointerDown / pointerMove / pointerUp / click / keyDown signals go to
//             the part under the pointer, or the nearest owner that handles them
//             (has an onPointerDown, … script or a wire from that outlet)
//   carrying  a part sitting in a container whose `acceptsDrops` is true can be
//             picked up by the user's hand (press and drag it; Alt-click picks it up
//             and keeps holding it until the next click) and dropped into any other
//             such container; `locked` stops it
//   stepping  a part with an onTick script and `stepEvery` (ms) is signalled `tick`
//
// Gestures, overlays, hands (the idiom from the lm-07 lab note)
// ------------------------------------------------------------
// Every slot write is, potentially, an Automerge operation, and a drag writes x and
// y thirty times a second. So while a pointer GESTURE is in progress (button down
// until it is released, or an Alt-click carry until the drop), slot writes made in
// response to pointer events do not touch the document: they go to the part's
// per-user OVERLAY ($slots), which get() favours over the shared slot. When the
// gesture ends, the overlaid values are written back into the shared slots in
// place — one document change for the whole gesture — and the overlays are dropped.
// Scripts don't know or care: set/put/get behave the same, only the cost changes.
//
// Nobody else would see the gesture, then, if we didn't tell them: once per frame
// the kernel broadcasts the overlays of the parts in flight (automerge-repo
// ephemeral messages: relayed, never persisted), and peers install what they
// receive in their own copies' overlays. A peer keeps such an overlay on a LEASE —
// dropped after a second of silence about that part, or, for the gesture's final
// (end:true) message, held until the peer's own document contains the committed
// values, so a slow sync never snaps the part back.
//
// HANDS use the same channel. Each session has one hand: an ordinary part kept
// only in the world's $hands list (so it is per-user and never in the document),
// moved for free, broadcast with every message or a heartbeat once a second, and
// removed by peers after four seconds of silence or on the session's `bye`. A hand
// never OWNS what it carries — the cargo stays in the scene graph and rides along
// on its overlay; the hand's `carrying` field just tints the cargo's shadow.
//
// setLocal(name, value) is the same overlay, used deliberately: a per-user value that
// shadows the shared slot and is never committed (the clock's hands, for instance,
// which every replica computes for itself).
//
// How the kernel itself is stored: Part and Wire are plain persistent objects that
// hold the methods; every part is Object.create(Part). Re-evaluating this file
// rewrites the methods on those same objects, so existing parts pick up new kernel
// code without being rebuilt. (Classes can't do this: a re-declared class is a new
// class, and old instances keep the old methods.)

let Part = typeof Part === 'object' && Part ? Part : {};
let Wire = typeof Wire === 'object' && Wire ? Wire : Object.create(Part);

function kitMethods(target, methods) {
  /** Copy every method in `methods` onto `target` (the kernel's "class body"). */
  let keys = Object.keys(methods);
  for (let i = 0; i < keys.length; i++) target[keys[i]] = methods[keys[i]];
  return target;
}

// +--------+
// |  Part  |
// +--------+
kitMethods(Part, {
  init: function (spec) {
    /**
     * part({ name: 'dial', like: protoPart, angle: 0, turn: function (v) {...} })
     * Every key except `name` and `like` becomes an own slot (quietly — no signals
     * fire during construction).
     */
    this.name = null;
    this.like = null;
    this.owner = null;
    this.slots = {};
    this.parts = [];
    this.wiresOut = [];
    if (spec) {
      let keys = Object.keys(spec);
      for (let i = 0; i < keys.length; i++) {
        let k = keys[i];
        if (k === 'name') this.setName(spec.name);
        else if (k === 'like') this.makeLike(spec.like);
        else this.put(k, spec[k]);
      }
    }
    return this;
  },

  // --- Names ------------------------------------------------------------------
  // A name is a code-friendly label, independent of structure: it lets scripts say
  // clock.find('hourHand') instead of clock.parts[0].parts[1]. Names need not be
  // unique; find() answers the NEAREST part with that name (see find).

  setName: function (name) {
    this.name = name == null || name === '' ? null : '' + name;
    return this;
  },
  getName: function () {
    return this.name;
  },
  find: function (name) {
    /**
     * The nearest part named `name`, searching outward from me:
     *   1. me, then my sub-parts breadth-first (direct sub-parts beat deeper ones);
     *   2. then each owner in turn: the owner itself, then its other branches.
     * So a part finds its siblings before its cousins, and the world finds anything.
     * Answers null when there is no such part.
     */
    let s = '' + name;
    let found = this.findBelow(s, true);
    if (found) return found;
    let from = this;
    let up = this.owner;
    while (up) {
      if (up.name === s) return up;
      for (let i = 0; i < up.parts.length; i++) {
        let p = up.parts[i];
        if (p === from) continue;
        found = p.findBelow(s, true);
        if (found) return found;
      }
      from = up;
      up = up.owner;
    }
    return null;
  },
  findBelow: function (name, includeSelf) {
    /** Breadth-first search of my sub-tree (optionally including me) for `name`. */
    let queue = includeSelf ? [this] : this.parts.slice();
    while (queue.length > 0) {
      let p = queue.shift();
      if (p.name === name) return p;
      for (let i = 0; i < p.parts.length; i++) queue.push(p.parts[i]);
    }
    return null;
  },

  // --- Slots ------------------------------------------------------------------
  // get/has look through the like-chain; own*/put/set/removeSlot touch only me.
  // Each part may also carry a per-user OVERLAY, $slots: values that shadow the
  // shared slots of the same name on this replica only (see the header). get()
  // favours the overlay; put/set write to it during a gesture (kitOverlayScope) or
  // when asked to (setLocal); commitOverlays writes a gesture's values back.

  get: function (name) {
    /** The slot's value: mine if I have it, else from my like-chain; else undefined. */
    let p = this;
    while (p) {
      let v = p.ownValue(name);
      if (v !== undefined) return v;
      p = p.like;
    }
    return undefined;
  },
  ownValue: function (name) {
    /** My own value for `name`: the overlay's if there is one, else the shared slot's. */
    let o = this.$slots;
    if (o) {
      let v = o[name];
      if (v !== undefined) return v;
    }
    return this.slots[name];
  },
  persistentValue: function (name) {
    /** What the DOCUMENT says (mine or inherited), ignoring any overlay. */
    let p = this;
    while (p) {
      let v = p.slots[name];
      if (v !== undefined) return v;
      p = p.like;
    }
    return undefined;
  },
  num: function (name, otherwise) {
    /** A numeric slot, or `otherwise` when it is missing or not a number. */
    let v = this.get(name);
    return typeof v === 'number' ? v : otherwise;
  },
  has: function (name) {
    return this.get(name) !== undefined;
  },
  hasOwn: function (name) {
    return this.ownValue(name) !== undefined;
  },
  put: function (name, value) {
    /** Store an own slot WITHOUT signalling (construction, layout, copies). */
    if (this.ownValue(name) === value) return this;
    if (kitOverlayScope(this)) this.overlayWrite(name, value);
    else this.slots[name] = value;
    return this;
  },
  set: function (name, value) {
    /**
     * Store an own slot, then signal `name` with the new value so scripts and wires
     * react. Setting a slot to the value it already has does nothing — this is what
     * keeps a loop of wires (a <-> b) from ringing forever.
     */
    if (this.ownValue(name) === value) return this;
    if (kitOverlayScope(this)) this.overlayWrite(name, value);
    else this.slots[name] = value;
    this.signal(name, value);
    return this;
  },
  store: function (name, value) {
    /**
     * Write the DOCUMENT slot now, gesture or no gesture, and drop any overlay of
     * the same name so the new value shows through. For the structural moves the
     * kernel makes mid-gesture (lifting a part into the world, dropping it into a
     * container), which must leave the document self-consistent at every moment.
     * The name stays in $pending, so the gesture's end message still reports it.
     */
    if (this.$slots && this.$slots[name] !== undefined) delete this.$slots[name];
    if (this.slots[name] !== value) this.slots[name] = value;
    return this;
  },
  setLocal: function (name, value) {
    /**
     * A per-user value for `name` that shadows the shared slot on this replica
     * only; the document never sees it. Signals like set(). For things every
     * replica computes for itself (the clock's hands) or wants to show only to
     * its own user. clearLocal(name) lets the shared value show through again.
     */
    if (this.ownValue(name) === value) return this;
    if (!this.$slots) this.$slots = {};
    this.$slots[name] = value;
    this.signal(name, value);
    return this;
  },
  clearLocal: function (name) {
    if (this.$slots && this.$slots[name] !== undefined) delete this.$slots[name];
    if (this.$pending && this.$pending[name]) delete this.$pending[name];
    return this;
  },
  overlayWrite: function (name, value) {
    /** A gesture write: into the overlay, noted in $pending (what commitOverlays
     * will write back and what goes on the wire), and I join the parts in flight. */
    if (!this.$slots) this.$slots = {};
    this.$slots[name] = value;
    if (!this.$pending) this.$pending = {};
    this.$pending[name] = true;
    let g = $kit.gesture;
    if (g && !g.parts.includes(this)) g.parts.push(this);
  },
  pendingNames: function () {
    return this.$pending ? Object.keys(this.$pending) : [];
  },
  commitOverlays: function () {
    /**
     * End of a gesture: write every pending overlay value into the shared slot IN
     * PLACE (same value: no write) and forget the overlay. Values that setLocal put
     * in the overlay are not pending, so they stay.
     */
    let names = this.pendingNames();
    for (let i = 0; i < names.length; i++) {
      let k = names[i];
      let v = this.$slots ? this.$slots[k] : undefined;
      if (v !== undefined) {
        if (this.slots[k] !== v) this.slots[k] = v;
        delete this.$slots[k];
      }
    }
    this.$pending = null;
    if (this.$slots && Object.keys(this.$slots).length === 0) this.$slots = null;
    return this;
  },
  removeSlot: function (name) {
    /** Drop my own slot (an inherited value, if any, shows through again). */
    this.clearLocal(name);
    delete this.slots[name];
    return this;
  },
  ownSlotNames: function () {
    return Object.keys(this.slots);
  },
  slotNames: function () {
    /** Own and inherited slot names, nearest first, without duplicates. */
    let seen = {};
    let out = [];
    let p = this;
    while (p) {
      let keys = Object.keys(p.slots);
      for (let i = 0; i < keys.length; i++) {
        if (!seen[keys[i]]) {
          seen[keys[i]] = true;
          out.push(keys[i]);
        }
      }
      p = p.like;
    }
    return out;
  },

  // --- Scripts ----------------------------------------------------------------
  // A script is just a function in a slot; `this` is the part when it runs. The
  // source text lives in the function itself (scriptSource), so searching and
  // editing code is searching and editing slots.

  define: function (name, script) {
    /**
     * part.define('turn', function (v) { this.set('angle', v); })
     * part.define('turn', 'function (v) { this.set("angle", v); }')  // from text
     * Quietly stores the script (defining a script is not a signal).
     */
    let fn = typeof script === 'string' ? compileScript(script) : script;
    return this.put(name, fn);
  },
  isScript: function (name) {
    return typeof this.get(name) === 'function';
  },
  scriptSource: function (name) {
    let fn = this.get(name);
    return typeof fn === 'function' ? fn.toString() : null;
  },
  run: function (name, a, b, c) {
    /** Call the script `name` with `this` = me; answers its result (undefined if none). */
    let fn = this.get(name);
    if (typeof fn !== 'function') return undefined;
    return fn.call(this, a, b, c);
  },

  // --- Signals ----------------------------------------------------------------

  signal: function (name, value) {
    /**
     * The one rule for things happening (see the header):
     *   1. run my reaction script on<Name> (kitOn(name)), if any, with `value`;
     *   2. pass `value` along every wire leaving my outlet `name`.
     * A signal nobody scripted or wired is harmless. Depth-limited, so a runaway
     * chain of signals stops instead of hanging the frame.
     */
    // The depth counter is per-user ($): a shared counter would cost two document
    // writes per signal.
    let depth = typeof $kitSignalDepth === 'number' ? $kitSignalDepth : 0;
    if (depth > 200) throw new Error('signal loop at ' + this + '.' + name);
    $kitSignalDepth = depth + 1;
    try {
      let fn = this.get(kitOn(name));
      if (typeof fn === 'function') fn.call(this, value);
      for (let i = 0; i < this.wiresOut.length; i++) {
        let w = this.wiresOut[i];
        if (w.outlet === name) w.deliver(value);
      }
    } finally {
      $kitSignalDepth = depth;
    }
    return this;
  },
  handles: function (name) {
    /** True if signalling `name` on me would do anything (a reaction script or a wire). */
    if (this.isScript(kitOn(name))) return true;
    for (let i = 0; i < this.wiresOut.length; i++) if (this.wiresOut[i].outlet === name) return true;
    return false;
  },
  receive: function (inlet, value) {
    /** How a wire hands me a value: run an action inlet, set a data inlet. */
    if (this.isScript(inlet)) {
      this.run(inlet, value);
      return this;
    }
    return this.set(inlet, value);
  },

  // --- Wires ------------------------------------------------------------------

  wireTo: function (outlet, target, inlet, transform) {
    /**
     * slider.wireTo('value', dial, 'angle', v => v * 3.6)
     * Answers the new Wire. The wire lives in my wiresOut list (not in my parts), so
     * it never takes part in layout, but it is a full Part: nameable, inspectable,
     * findable, and copied along with the parts it connects.
     */
    let w = Object.create(Wire).init();
    w.from = this;
    w.outlet = outlet;
    w.to = target;
    w.inlet = inlet;
    if (transform) w.define('transform', transform);
    this.wiresOut.push(w);
    return w;
  },
  wiresIn: function () {
    /** Wires arriving at me, from anywhere in my world. */
    let out = [];
    let all = this.world().allParts();
    for (let i = 0; i < all.length; i++) {
      let ws = all[i].wiresOut;
      for (let j = 0; j < ws.length; j++) if (ws[j].to === this) out.push(ws[j]);
    }
    return out;
  },
  unwireAll: function () {
    /** Remove every wire into or out of me. */
    let ins = this.wiresIn();
    for (let i = 0; i < ins.length; i++) ins[i].remove();
    this.wiresOut = [];
    return this;
  },

  // --- Structure --------------------------------------------------------------

  add: function (sub, index) {
    /** Make `sub` my sub-part (removing it from any previous owner); answers it. */
    if (sub.owner === this && index == null && this.parts[this.parts.length - 1] === sub) return sub;
    if (sub.owner) sub.owner.removePart(sub);
    if (index == null || index >= this.parts.length) this.parts.push(sub);
    else this.parts.splice(index, 0, sub);
    sub.owner = this;
    return sub;
  },
  removePart: function (sub) {
    let i = this.parts.indexOf(sub);
    if (i >= 0) this.parts.splice(i, 1);
    if (sub.owner === this) sub.owner = null;
    return sub;
  },
  remove: function () {
    /** Take me out of my owner. My wires stay, so I can be put back intact. */
    if (this.owner) this.owner.removePart(this);
    return this;
  },
  world: function () {
    let p = this;
    while (p.owner) p = p.owner;
    return p;
  },
  allParts: function () {
    /** Me and every part below me, breadth-first. */
    let out = [];
    let queue = [this];
    while (queue.length > 0) {
      let p = queue.shift();
      out.push(p);
      for (let i = 0; i < p.parts.length; i++) queue.push(p.parts[i]);
    }
    return out;
  },
  contains: function (other) {
    let p = other;
    while (p) {
      if (p === this) return true;
      p = p.owner;
    }
    return false;
  },

  // --- Likeness (delegation) --------------------------------------------------
  // `like` is how parts share behaviour without classes: a part with no slot of its
  // own reads its like-part's slot. Edit the prototype's script and every part like
  // it changes too; give one part its own slot and it overrides just for itself.

  makeLike: function (proto) {
    if (proto != null) {
      let p = proto;
      while (p) {
        if (p === this) throw new Error('makeLike would create a cycle');
        p = p.like;
      }
    }
    this.like = proto || null;
    return this;
  },
  isLike: function (proto) {
    let p = this.like;
    while (p) {
      if (p === proto) return true;
      p = p.like;
    }
    return false;
  },

  // --- Copying ----------------------------------------------------------------
  // Two ways to duplicate a sub-tree, differing only in what each new part holds:
  //   copy()      independent: each new part gets its own copy of the old part's slots
  //               (and keeps the old part's like-link).
  //   instance()  delegating: each new part is like the old one and starts with no
  //               own slots, so later edits to the original show through. This is what
  //               dragging a prototype out of the parts bin does.
  // Either way, wires between parts inside the sub-tree are recreated between the
  // corresponding new parts; wires leading outside it are left behind.

  copy: function () {
    return this.duplicate(false);
  },
  instance: function () {
    return this.duplicate(true);
  },
  duplicate: function (asInstance) {
    let olds = this.allParts();
    let news = [];
    for (let i = 0; i < olds.length; i++) {
      let o = olds[i];
      let n = Object.create(Object.getPrototypeOf(o)).init();
      n.name = o.name;
      if (asInstance) n.like = o;
      else {
        n.like = o.like;
        let keys = Object.keys(o.slots);
        for (let k = 0; k < keys.length; k++) n.slots[keys[k]] = o.slots[keys[k]];
      }
      news.push(n);
    }
    for (let i = 0; i < olds.length; i++) {
      let o = olds[i];
      for (let j = 0; j < o.parts.length; j++) news[i].add(news[olds.indexOf(o.parts[j])]);
      for (let j = 0; j < o.wiresOut.length; j++) {
        let w = o.wiresOut[j];
        let ti = olds.indexOf(w.to);
        if (ti >= 0) w.copyBetween(news[i], news[ti]);
      }
    }
    return news[0];
  },

  // --- Geometry ---------------------------------------------------------------
  // x, y, w, h are in my owner's coordinates; rotation (degrees) turns me about my
  // pivot (pivotX, pivotY as fractions of w, h). Points are plain {x, y} objects.

  pivot: function () {
    return { x: this.num('w', 0) * this.num('pivotX', 0.5), y: this.num('h', 0) * this.num('pivotY', 0.5) };
  },
  ownerFromLocal: function (lx, ly) {
    let pv = this.pivot();
    let r = (this.num('rotation', 0) * Math.PI) / 180;
    let dx = lx - pv.x;
    let dy = ly - pv.y;
    let c = Math.cos(r);
    let s = Math.sin(r);
    return { x: dx * c - dy * s + pv.x + this.num('x', 0), y: dx * s + dy * c + pv.y + this.num('y', 0) };
  },
  localFromOwner: function (ox, oy) {
    let pv = this.pivot();
    let r = (this.num('rotation', 0) * Math.PI) / 180;
    let dx = ox - this.num('x', 0) - pv.x;
    let dy = oy - this.num('y', 0) - pv.y;
    let c = Math.cos(r);
    let s = Math.sin(r);
    return { x: dx * c + dy * s + pv.x, y: -dx * s + dy * c + pv.y };
  },
  worldFromLocal: function (lx, ly) {
    let p = this.ownerFromLocal(lx, ly);
    return this.owner ? this.owner.worldFromLocal(p.x, p.y) : p;
  },
  localFromWorld: function (wx, wy) {
    let p = this.owner ? this.owner.localFromWorld(wx, wy) : { x: wx, y: wy };
    return this.localFromOwner(p.x, p.y);
  },
  worldRotation: function () {
    let r = 0;
    let p = this;
    while (p) {
      r += p.num('rotation', 0);
      p = p.owner;
    }
    return r;
  },
  containsLocal: function (lx, ly) {
    /** Is my-coordinates point (lx, ly) on me? (Ovals test the ellipse.) */
    let look = this.get('look') || 'box';
    if (look === 'none') return false;
    let w = this.num('w', 0);
    let h = this.num('h', 0);
    if (look === 'oval') {
      let nx = (lx - w / 2) / (w / 2);
      let ny = (ly - h / 2) / (h / 2);
      return nx * nx + ny * ny <= 1;
    }
    return lx >= 0 && ly >= 0 && lx <= w && ly <= h;
  },
  partAt: function (ox, oy, excluding) {
    /**
     * The frontmost visible part at owner-coordinates (ox, oy): one of my sub-parts
     * (last added is in front) or me — or null. `excluding` skips a sub-tree (the
     * part being carried).
     */
    if (this === excluding || this.get('hidden')) return null;
    let l = this.localFromOwner(ox, oy);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      let hit = this.parts[i].partAt(l.x, l.y, excluding);
      if (hit) return hit;
    }
    return this.containsLocal(l.x, l.y) ? this : null;
  },
  moveTo: function (newOwner, index) {
    /**
     * Re-own me without changing where I appear on screen (position and turn).
     * Writes the document directly (store), even mid-gesture: the document must
     * never hold me under one owner with coordinates meant for another.
     */
    if (newOwner === this.owner) {
      newOwner.add(this, index);
      return this;
    }
    let pv = this.pivot();
    let w = this.worldFromLocal(pv.x, pv.y);
    let r = this.worldRotation() - (newOwner ? newOwner.worldRotation() : 0);
    let l = newOwner ? newOwner.localFromWorld(w.x, w.y) : w;
    newOwner.add(this, index);
    this.store('x', l.x - pv.x);
    this.store('y', l.y - pv.y);
    this.store('rotation', r);
    return this;
  },

  // --- Layout -----------------------------------------------------------------

  layout: function () {
    /**
     * Arrange my sub-parts by my `layout` slot, then lay out each of them:
     *   'row' / 'column'  place them in order, `gap` apart, inside `padding`;
     *                     with `fit` true I shrink-wrap around them.
     *   'free' (default)  leave them where they are.
     * Runs before every draw; writes only what actually moves.
     */
    let mode = this.get('layout');
    if (mode === 'row' || mode === 'column') {
      let pad = this.num('padding', 6);
      let gap = this.num('gap', 6);
      let along = pad;
      let across = 0;
      for (let i = 0; i < this.parts.length; i++) {
        let p = this.parts[i];
        if (p.get('hidden')) continue;
        if (mode === 'row') {
          p.put('x', along);
          p.put('y', pad);
          along += p.num('w', 0) + gap;
          across = Math.max(across, p.num('h', 0));
        } else {
          p.put('x', pad);
          p.put('y', along);
          along += p.num('h', 0) + gap;
          across = Math.max(across, p.num('w', 0));
        }
      }
      if (this.get('fit')) {
        let len = Math.max(along - gap + pad, 2 * pad);
        let wid = across + 2 * pad;
        this.put('w', mode === 'row' ? len : wid);
        this.put('h', mode === 'row' ? wid : len);
      }
    }
    for (let i = 0; i < this.parts.length; i++) this.parts[i].layout();
  },

  // --- Drawing ----------------------------------------------------------------

  draw: function (c) {
    /** Draw me (my look, or my `draw` script) and then my sub-parts, in my frame. */
    if (this.get('hidden')) return;
    let pv = this.pivot();
    c.save();
    c.translate(this.num('x', 0) + pv.x, this.num('y', 0) + pv.y);
    let r = this.num('rotation', 0);
    if (r) c.rotate((r * Math.PI) / 180);
    c.translate(-pv.x, -pv.y);
    // In a hand (mine or a peer's): a drop shadow in the carrier's colour.
    let carrier = this.$carriedBy;
    if (carrier) {
      c.shadowColor = kitHandColor(carrier.num('colorIndex', 0));
      c.shadowBlur = 14;
      c.shadowOffsetX = 3;
      c.shadowOffsetY = 5;
    }
    if (this.isScript('draw')) this.run('draw', c);
    else this.drawLook(c);
    if (carrier) {
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
    }
    for (let i = 0; i < this.parts.length; i++) this.parts[i].draw(c);
    c.restore();
  },
  drawLook: function (c) {
    let look = this.get('look') || 'box';
    let w = this.num('w', 0);
    let h = this.num('h', 0);
    if (look !== 'none') {
      c.beginPath();
      if (look === 'oval') c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
      else {
        let rad = Math.min(this.num('radius', 0), w / 2, h / 2);
        if (rad > 0 && c.roundRect) c.roundRect(0, 0, w, h, rad);
        else c.rect(0, 0, w, h);
      }
      let fill = this.get('fill');
      if (fill !== 'none') {
        c.fillStyle = fill || '#d8d4cc';
        c.fill();
      }
      let border = this.get('border');
      if (border && border !== 'none') {
        c.strokeStyle = border;
        c.lineWidth = this.num('borderWidth', 1);
        c.stroke();
      }
    }
    let text = this.get('text');
    if (text != null && text !== '') this.drawText(c, '' + text, w, h);
  },
  drawText: function (c, text, w, h) {
    let size = this.num('fontSize', 14);
    let lines = text.split('\n');
    let align = this.get('align') || 'center';
    c.font = size + 'px sans-serif';
    c.fillStyle = this.get('textColor') || '#222';
    c.textBaseline = 'middle';
    c.textAlign = align;
    let x = align === 'left' ? 4 : align === 'right' ? w - 4 : w / 2;
    let lineH = size * 1.25;
    let y = h / 2 - ((lines.length - 1) * lineH) / 2;
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], x, y + i * lineH);
  },

  // --- Printing ---------------------------------------------------------------

  toString: function () {
    return this.name != null ? "a Part named '" + this.name + "'" : 'a Part';
  },
});

// +--------+
// |  Wire  |
// +--------+
kitMethods(Wire, {
  deliver: function (value) {
    /**
     * Pass `value` to the far end: through the transform script (if any; `this` is
     * the wire, and it also receives the source part), then into the target's inlet.
     * A transform answering undefined stops the value here — a filter.
     */
    if (!this.to) return;
    let v = value;
    if (this.isScript('transform')) {
      v = this.run('transform', value, this.from);
      if (v === undefined) return;
    }
    this.to.receive(this.inlet, v);
  },
  remove: function () {
    if (this.from) {
      let i = this.from.wiresOut.indexOf(this);
      if (i >= 0) this.from.wiresOut.splice(i, 1);
    }
    return this;
  },
  copyBetween: function (newFrom, newTo) {
    let w = newFrom.wireTo(this.outlet, newTo, this.inlet);
    w.name = this.name;
    let keys = Object.keys(this.slots);
    for (let k = 0; k < keys.length; k++) w.slots[keys[k]] = this.slots[keys[k]];
    return w;
  },
  toString: function () {
    return (
      'a Wire ' +
      (this.from ? this.from.name || '?' : '?') + '.' + this.outlet +
      ' -> ' +
      (this.to ? this.to.name || '?' : '?') + '.' + this.inlet
    );
  },
});

// +-----------+
// |  Helpers  |
// +-----------+

function kitOn(name) {
  /** The reaction script a signal runs: 'click' -> 'onClick', 'count' -> 'onCount'. */
  let s = '' + name;
  return 'on' + s.charAt(0).toUpperCase() + s.slice(1);
}

function compileScript(source) {
  /** Turn script text ('function (v) {...}' or 'v => ...') into a function. */
  return eval('(' + source + ')');
}

function part(spec) {
  /** part({ name: 'n', x: 1 }) — make a new Part with these slots. */
  return Object.create(Part).init(spec);
}

function wire(from, outlet, to, inlet, transform) {
  /** wire(slider, 'value', dial, 'angle') — shorthand for from.wireTo(...). */
  return from.wireTo(outlet, to, inlet, transform);
}

function kitSearch(root, text) {
  /**
   * Every place under `root` where `text` appears: in a part's name, a slot name, a
   * script's source, or a string slot. Answers [{ part, slot, where }] — the Finder
   * (phase 4) is just a view of this list. Wires are searched too.
   */
  let hits = [];
  let t = ('' + text).toLowerCase();
  let visit = (p) => {
    if (p.name && p.name.toLowerCase().indexOf(t) >= 0) hits.push({ part: p, slot: null, where: 'name' });
    let keys = Object.keys(p.slots);
    for (let i = 0; i < keys.length; i++) {
      let k = keys[i];
      let v = p.slots[k];
      if (k.toLowerCase().indexOf(t) >= 0) hits.push({ part: p, slot: k, where: 'slot name' });
      else if (typeof v === 'function' && v.toString().toLowerCase().indexOf(t) >= 0)
        hits.push({ part: p, slot: k, where: 'script' });
      else if (typeof v === 'string' && v.toLowerCase().indexOf(t) >= 0)
        hits.push({ part: p, slot: k, where: 'value' });
    }
  };
  let all = root.allParts();
  for (let i = 0; i < all.length; i++) {
    visit(all[i]);
    for (let j = 0; j < all[i].wiresOut.length; j++) visit(all[i].wiresOut[j]);
  }
  return hits;
}

function kitPartWithId(root, id) {
  /** The part under `root` whose object id is `id` (what peers' messages name), or null. */
  let all = root.allParts();
  for (let i = 0; i < all.length; i++) if (all[i].$id === id) return all[i];
  return null;
}

// +------------+
// |  Gestures  |
// +------------+
// A gesture is the span from a pointer press to its release — longer, for an
// Alt-click carry, until the drop. While one is in progress, put/set calls made
// while a pointer event is being handled go to the parts' overlays (see "Slots");
// kitGestureEnd commits them all in one go and sends the end message. Tunables:

let KIT_STREAM_MS = 1000 / 30; // at most one outbound message this often (end messages excepted)
let KIT_LEASE_MS = 1000; // a peer's overlay lapses after this much silence about the part
let KIT_COMMIT_WAIT_MS = 30000; // how long an end overlay waits for the commit to sync in
let KIT_ABANDON_MS = 60000; // how long a lease for an unknown part is kept
let KIT_HAND_HEARTBEAT_MS = 1000; // an idle hand still says hello this often
let KIT_HAND_TTL_MS = 4000; // a silent hand is removed after this long
let KIT_HAND_MAX = 64; // peers' hands we are willing to show

function kitOverlayScope(p) {
  /** Should a write to `p` go to its overlay? Yes during a gesture, inside pointer
   * event handling — but never for a hand (per-user already; its writes are free). */
  return (
    typeof $kit === 'object' && $kit != null && $kit.gesture != null && $kit.inPointerEvent === true && !p.$isHand
  );
}

function kitGestureBegin() {
  if (!$kit.gesture) $kit.gesture = { parts: [] };
}

function kitGestureEndIfIdle(world) {
  /** After a pointer-up or a drop: the gesture is over unless the button is still
   * down, a part holds the pointer, or my hand is still carrying something. */
  if (!$kit.gesture) return;
  if ($kit.down || $kit.capture) return;
  let hand = kitMyHand(world);
  if (hand && hand.$cargo) return;
  kitGestureEnd();
}

function kitGestureEnd() {
  /**
   * Commit every part's pending overlays — one document change for the whole
   * gesture — then tell peers, with end:true, exactly what was committed (so they
   * can hold their overlays until their documents say the same; see kitApplyEntry).
   */
  let g = $kit.gesture;
  $kit.gesture = null;
  if (!g) return;
  let objs = new window.Array();
  for (let i = 0; i < g.parts.length; i++) {
    let p = g.parts[i];
    let names = p.pendingNames();
    if (names.length === 0) continue;
    p.commitOverlays();
    let entry = kitEntryFor(p, names, true);
    if (entry) objs.push(entry);
  }
  if (objs.length > 0) kitBroadcast(objs, true);
}

// +---------+
// |  Hands  |
// +---------+
// A hand is an ordinary part — slots x, y (world coordinates of the pointer), name,
// colorIndex — kept only in the world's $hands list, so it is per-user and never in
// the document. Mine is created on my first pointer event and drawn in place of the
// OS cursor; peers' are created when their messages arrive (kitApplyHand) and
// removed when they fall silent (kitSweepHands). Per-user fields live directly on
// the part: $isHand, $sid (the session it belongs to), $isLocal, $lastSeen, and
// what it carries: $cargo (the part), $sticky (an Alt-click carry: no auto-drop),
// $lifted (the cargo has moved, so it has been lifted into the world).

function kitHands(world) {
  if (!world.$hands) world.$hands = [];
  return world.$hands;
}

function kitHandForSid(world, sid) {
  let hands = world.$hands;
  if (!hands) return null;
  for (let i = 0; i < hands.length; i++) if (hands[i].$sid === sid) return hands[i];
  return null;
}

function kitMyHand(world) {
  /** This session's hand, or null before its first pointer event. */
  return kitHandForSid(world, $kitSid);
}

function kitLocalHand(world, wx, wy) {
  /** This session's hand, created on first use at world-point (wx, wy). */
  let hand = kitMyHand(world);
  if (hand) return hand;
  hand = kitMakeHand(world, $kitSid, wx, wy, kitColorIndexForSid($kitSid));
  hand.$isLocal = true;
  return hand;
}

function kitMakeHand(world, sid, wx, wy, colorIndex) {
  let hand = part();
  hand.$isHand = true; // before any slot write: a hand's writes never go to an overlay
  hand.setName('hand');
  hand.put('look', 'none');
  hand.put('x', wx);
  hand.put('y', wy);
  hand.put('colorIndex', colorIndex);
  hand.$sid = sid;
  hand.$isLocal = false;
  hand.$cargo = null;
  kitHands(world).push(hand); // the only edge to it is this $-edge: per-user for good
  return hand;
}

function kitMoveHand(hand, wx, wy) {
  /** Hands are per-user objects: these writes never reach the document. */
  hand.put('x', wx);
  hand.put('y', wy);
}

function kitRemoveHand(world, hand) {
  /** A peer left (its `bye`, or KIT_HAND_TTL_MS of silence). */
  let hands = world.$hands;
  if (!hands) return;
  let i = hands.indexOf(hand);
  if (i >= 0) hands.splice(i, 1);
  kitHandSetCargo(hand, null);
}

function kitHandSetCargo(hand, cargo) {
  /** Point the hand at what it carries, and the cargo back at the hand (for the
   * shadow tint). Both are $-edges, so neither persists or promotes anything. */
  let prev = hand.$cargo;
  if (prev && prev !== cargo && prev.$carriedBy === hand) prev.$carriedBy = null;
  hand.$cargo = cargo;
  if (cargo) cargo.$carriedBy = hand;
}

function kitPeerHandCount(world) {
  let hands = world.$hands;
  if (!hands) return 0;
  let n = 0;
  for (let i = 0; i < hands.length; i++) if (!hands[i].$isLocal) n++;
  return n;
}

function kitColorIndexForSid(sid) {
  /** A stable palette index for a session id: the sender picks it, so a hand has the
   * same colour on every screen. */
  let s = sid == null ? '' : '' + sid;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  let n = 8;
  return ((h % n) + n) % n;
}

function kitHandColor(index) {
  let palette = ['#2e9e4f', '#2f6fd0', '#d03a2e', '#e08a1e', '#1aa3b8', '#c9b400', '#b03ab0', '#555555'];
  let i = typeof index === 'number' && Number.isInteger(index) ? ((index % 8) + 8) % 8 : 0;
  return palette[i];
}

function kitDrawHand(c, hand) {
  /** An arrow cursor at the hand's position, in its colour, with a name tag for peers. */
  let x = hand.num('x', 0);
  let y = hand.num('y', 0);
  let color = kitHandColor(hand.num('colorIndex', 0));
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(0, 17);
  c.lineTo(4.5, 13);
  c.lineTo(7.5, 20);
  c.lineTo(10.5, 18.5);
  c.lineTo(7.5, 12);
  c.lineTo(13, 12);
  c.closePath();
  c.fillStyle = color;
  c.fill();
  c.strokeStyle = 'white';
  c.lineWidth = 1.5;
  c.stroke();
  let label = hand.get('name');
  if (!hand.$isLocal && label) {
    c.font = '12px sans-serif';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    let w = c.measureText(label).width;
    c.fillStyle = color;
    c.fillRect(12, 22, w + 8, 16);
    c.fillStyle = 'white';
    c.fillText(label, 16, 24);
  }
  c.restore();
}

function kitUserName() {
  /**
   * My display name, from the Patchwork account's contact doc, as a native Promise
   * (the result lands in window._lmUserName, outside any transaction). Null when
   * there is no account or no registered name.
   */
  try {
    if (!window || !window.repo || !window.accountDocHandle) return Promise.resolve(null);
    let account = window.accountDocHandle.doc ? window.accountDocHandle.doc() : null;
    if (!account || account.contactUrl == null || account.contactUrl === '') return Promise.resolve(null);
    return window.repo
      .find(account.contactUrl)
      .then(function (h) {
        if (!h || !h.doc) return null;
        let contact = h.doc();
        if (!contact || contact.name == null || contact.name === '') return null;
        return String(contact.name);
      })
      .catch(function () {
        return null;
      });
  } catch (_err) {
    return Promise.resolve(null);
  }
}

// +------------------+
// |  The wire format |
// +------------------+
// Plain JSON, built from host objects (new window.Object / window.Array) because
// handle.broadcast wants plain data — and with NO $-prefixed keys, because LM
// routes $-names on host objects to its ephemeral sidecar, not to the object.
//
//   { type: 'kit-eph-changes', v: 1, sid, end?: true,
//     objects: [{ id, owner, slots: { x: 130, y: 70, ... } }],
//     hand?: { x, y, colorIndex, name?, carrying?: partId } | { bye: true } }
//
// `sid` is the sender's session id (echo suppression; a hand IS a session). An
// entry names a part by object id, the owner it is under (so a peer whose document
// hasn't yet seen a re-owning can wait rather than misplace it), and its pending
// overlay values — primitives only. A receiver validates everything and writes ONLY
// overlays ($slots) and hands, never a shared slot: a malformed or malicious
// message cannot change the document, only draw something in the wrong place for a
// moment.

function kitStreamable(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 1024;
  return typeof v === 'boolean';
}

function kitEntryFor(p, names, committed) {
  /** The wire entry for part `p` and these slot names: overlay values while the
   * gesture lasts, committed (document) values for the end message. */
  if (typeof p.$id !== 'string') return null;
  let slots = new window.Object();
  let n = 0;
  for (let i = 0; i < names.length && n < 32; i++) {
    let k = names[i];
    let v = committed ? p.persistentValue(k) : p.ownValue(k);
    if (kitStreamable(v)) {
      slots[k] = v;
      n++;
    }
  }
  if (n === 0) return null;
  let entry = new window.Object();
  entry.id = p.$id;
  entry.owner = p.owner && typeof p.owner.$id === 'string' ? p.owner.$id : null;
  entry.slots = slots;
  return entry;
}

function kitHandPayload(world, now) {
  /** My hand for the wire, or null before it exists. Remembers what went out, so
   * kitHandDue can tell motion from idleness. */
  let hand = kitMyHand(world);
  if (!hand) return null;
  let h = new window.Object();
  h.x = hand.num('x', 0);
  h.y = hand.num('y', 0);
  h.colorIndex = hand.num('colorIndex', 0);
  let name = window._lmUserName;
  if (typeof name === 'string' && name.length > 0) h.name = name;
  let cargo = hand.$cargo;
  if (cargo && typeof cargo.$id === 'string') h.carrying = cargo.$id;
  $kit.handSentX = h.x;
  $kit.handSentY = h.y;
  $kit.handSentCarrying = h.carrying != null ? h.carrying : null;
  $kit.handSentAt = now;
  return h;
}

function kitHandDue(world, now) {
  /** Does my hand need to go on the wire? If it never has, if it moved or changed
   * cargo since the last time, or if the heartbeat is due. */
  let hand = kitMyHand(world);
  if (!hand) return false;
  if ($kit.handSentAt == null) return true;
  if (hand.num('x', 0) !== $kit.handSentX || hand.num('y', 0) !== $kit.handSentY) return true;
  let carrying = hand.$cargo && typeof hand.$cargo.$id === 'string' ? hand.$cargo.$id : null;
  if (carrying !== $kit.handSentCarrying) return true;
  return now - $kit.handSentAt >= KIT_HAND_HEARTBEAT_MS;
}

function kitBroadcast(objs, isEnd) {
  if (!window.handle || !window.handle.broadcast) return;
  let now = $kit.frameNow;
  let msg = new window.Object();
  msg.type = 'kit-eph-changes';
  msg.v = 1;
  msg.sid = $kitSid;
  if (isEnd) msg.end = true;
  msg.objects = objs;
  let hand = kitHandPayload(kitWorld, now); // rides on every message
  if (hand != null) msg.hand = hand;
  $kit.streamSentAt = now;
  window.handle.broadcast(msg);
}

function kitFlushStream(world, now) {
  /** Once per frame: one message carrying every part in flight and my hand —
   * when there is something to say, and not more often than KIT_STREAM_MS. */
  if (!window.handle || !window.handle.broadcast) return;
  if ($kit.streamSentAt != null && now - $kit.streamSentAt < KIT_STREAM_MS) return;
  let objs = new window.Array();
  let g = $kit.gesture;
  if (g) {
    for (let i = 0; i < g.parts.length; i++) {
      let p = g.parts[i];
      let names = p.pendingNames();
      if (names.length === 0) continue;
      let entry = kitEntryFor(p, names, false);
      if (entry) objs.push(entry);
    }
  }
  if (objs.length > 0 || kitHandDue(world, now)) kitBroadcast(objs, false);
}

// +------------------------+
// |  Receiving from peers  |
// +------------------------+

function kitProcessInbound(world, now) {
  /** Once per frame: apply the messages queued since the last frame (the listener
   * runs outside the transaction and may only push onto a host array), then sweep
   * lapsed overlays and silent hands. */
  if (!window._kitMessages || !window._kitLeases) return;
  if (window._kitMessages.length > 0) {
    let msgs = window._kitMessages;
    window._kitMessages = new window.Array();
    for (let i = 0; i < msgs.length; i++) kitTry(() => kitApplyMessage(world, msgs[i], now));
  }
  kitSweepLeases(world, now);
  kitSweepHands(world, now);
}

function kitApplyMessage(world, m, now) {
  if (!m || m.type !== 'kit-eph-changes' || m.v !== 1) return;
  if (typeof m.sid !== 'string' || m.sid.length === 0 || m.sid.length > 64) return;
  if (m.sid === $kitSid) return; // my own message, echoed
  if (m.hand != null) kitApplyHand(world, m, now);
  let objs = m.objects;
  if (!objs || typeof objs.length !== 'number') return;
  let n = Math.min(objs.length, 32);
  for (let i = 0; i < n; i++) kitApplyEntry(world, objs[i], m.end === true, now);
}

function kitValidHand(h) {
  if (h == null || typeof h !== 'object') return false;
  if (h.bye === true) return true;
  if (!Number.isFinite(h.x) || !Number.isFinite(h.y)) return false;
  if (h.colorIndex != null && !(Number.isInteger(h.colorIndex) && h.colorIndex >= 0 && h.colorIndex < 1024))
    return false;
  if (h.name != null && !(typeof h.name === 'string' && h.name.length <= 32)) return false;
  if (h.carrying != null && !(typeof h.carrying === 'string' && h.carrying.length <= 64)) return false;
  return true;
}

function kitApplyHand(world, m, now) {
  /** A peer's hand: make it on first sight, move it, note what it carries (so the
   * cargo's shadow takes its colour), and stamp $lastSeen for kitSweepHands. */
  let h = m.hand;
  if (!kitValidHand(h)) return;
  let hand = kitHandForSid(world, m.sid);
  if (hand && hand.$isLocal) return;
  if (h.bye === true) {
    if (hand) kitRemoveHand(world, hand);
    return;
  }
  if (!hand) {
    if (kitPeerHandCount(world) >= KIT_HAND_MAX) return;
    hand = kitMakeHand(world, m.sid, h.x, h.y, h.colorIndex != null ? h.colorIndex : 0);
  }
  kitMoveHand(hand, h.x, h.y);
  hand.put('name', typeof h.name === 'string' && h.name.length > 0 ? h.name : null);
  hand.$lastSeen = now;
  // Resolve what it carries each time: the part may not have synced in yet.
  let cargo = h.carrying != null ? kitPartWithId(world, h.carrying) : null;
  if (cargo && cargo.$carriedBy && cargo.$carriedBy !== hand && cargo.$carriedBy.$isLocal) cargo = null; // mine wins
  kitHandSetCargo(hand, cargo);
}

function kitSweepHands(world, now) {
  /** Drop peers' hands that have been silent for KIT_HAND_TTL_MS. A jump in the
   * frame clock means THIS tab was hidden, which says nothing about the peers, so
   * such a frame skips expiry rather than blinking every hand off. */
  let hands = world.$hands;
  if (!hands || hands.length === 0) return;
  let last = $kit.handSweepAt;
  $kit.handSweepAt = now;
  if (last != null && now - last > KIT_HAND_TTL_MS) return;
  let stale = [];
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    if (!hand.$isLocal && hand.$lastSeen != null && now - hand.$lastSeen > KIT_HAND_TTL_MS) stale.push(hand);
  }
  for (let i = 0; i < stale.length; i++) kitRemoveHand(world, stale[i]);
}

function kitValidEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 64) return false;
  if (entry.owner != null && !(typeof entry.owner === 'string' && entry.owner.length <= 64)) return false;
  if (entry.slots == null || typeof entry.slots !== 'object') return false;
  let keys = Object.keys(entry.slots);
  if (keys.length === 0 || keys.length > 32) return false;
  for (let i = 0; i < keys.length; i++) {
    let k = keys.at(i);
    if (typeof k !== 'string' || k.length === 0 || k.length > 64 || k.charAt(0) === '$') return false;
    if (!kitStreamable(entry.slots[k])) return false;
  }
  return true;
}

function kitApplyEntry(world, entry, isEnd, now) {
  /**
   * Install a peer's overlay on the named part and (re)new its lease. The lease is
   * a host object of ids, names and numbers only — it must never pin heap objects.
   * Policy, all on the receiving side:
   *   - my own gesture on the part wins (it has $pending and no lease of ours);
   *   - the values are for the owner the sender has; if my document hasn't caught
   *     up with that re-owning, keep what I'm showing (extend the lease) rather
   *     than draw the part at the wrong place;
   *   - an end entry's values are what was committed: hold that overlay until my
   *     document shows the same (kitSweepLeases).
   */
  if (!kitValidEntry(entry)) return;
  let p = kitPartWithId(world, entry.id);
  if (!p) return; // not synced in yet (or gone): later messages will catch it
  let lease = window._kitLeases[entry.id];
  if (p.$pending != null && lease == null) return; // local interaction wins
  let myOwner = p.owner && typeof p.owner.$id === 'string' ? p.owner.$id : null;
  let names = Object.keys(entry.slots);
  if (entry.owner !== myOwner) {
    if (!lease) return;
    lease.deadline = isEnd ? now : now + KIT_LEASE_MS;
    if (isEnd) kitLeaseRecordCommit(lease, entry, names);
    return;
  }
  if (!p.$slots) p.$slots = {};
  if (!lease) {
    lease = new window.Object();
    lease.names = new window.Array();
    window._kitLeases[entry.id] = lease;
  }
  for (let i = 0; i < names.length; i++) {
    let k = names.at(i);
    p.$slots[k] = entry.slots[k];
    if (!lease.names.includes(k)) lease.names.push(k);
  }
  lease.deadline = isEnd ? now : now + KIT_LEASE_MS;
  if (isEnd) kitLeaseRecordCommit(lease, entry, names);
  else lease.committed = null;
}

function kitLeaseRecordCommit(lease, entry, names) {
  /** Copy the committed values (and owner) out of the end entry into the lease,
   * so kitLanded can wait for the document to show them. */
  let c = new window.Object();
  for (let i = 0; i < names.length; i++) {
    let k = names.at(i);
    c[k] = entry.slots[k];
  }
  lease.committed = c;
  lease.owner = entry.owner;
  lease.waitUntil = lease.deadline + KIT_COMMIT_WAIT_MS;
}

function kitLanded(p, lease) {
  /** Does my document already say what the sender committed? (Values travel
   * verbatim through JSON and Automerge, so equality is exact.) */
  let myOwner = p.owner && typeof p.owner.$id === 'string' ? p.owner.$id : null;
  if (lease.owner !== myOwner) return false;
  let keys = Object.keys(lease.committed);
  for (let i = 0; i < keys.length; i++) {
    let k = keys.at(i);
    if (p.persistentValue(k) !== lease.committed[k]) return false;
  }
  return true;
}

function kitSweepLeases(world, now) {
  let ids = Object.keys(window._kitLeases);
  for (let i = 0; i < ids.length; i++) {
    let id = ids.at(i);
    let lease = window._kitLeases[id];
    let p = kitPartWithId(world, id);
    if (!p) {
      // Still syncing in, or deleted. Keep the lease a long while: dropping it
      // while the part may still carry overlays would make every later message
      // about it look like a local interaction.
      if (now > lease.deadline + KIT_ABANDON_MS) delete window._kitLeases[id];
      continue;
    }
    if (!p.$slots) {
      delete window._kitLeases[id]; // already cleared (e.g. I dragged it myself and committed)
      continue;
    }
    if (lease.deadline > now) continue;
    if (lease.committed != null && !kitLanded(p, lease) && now <= lease.waitUntil) continue; // hold
    delete window._kitLeases[id];
    for (let j = 0; j < lease.names.length; j++) {
      let k = lease.names[j];
      if (p.$slots[k] !== undefined) delete p.$slots[k];
    }
    if (Object.keys(p.$slots).length === 0) p.$slots = null;
  }
}

// +---------+
// |  Input  |
// +---------+
// The browser's events are queued between frames (host callbacks may not touch the
// heap) and turned into signals inside the frame:
//   pointerDown / pointerMove / pointerUp / click  ->  the part under the pointer, or
//       the nearest owner that handles that signal (has a script or wire for it);
//   keyDown  ->  the focused part ($kit.focus), else the world.
// The event value is { x, y (world), lx, ly (in the handling part), target, part,
// shift, alt, meta, ctrl, button, key }.
// A part can capture the pointer (kitCapture(part)) so moves and the up go to it
// even when the pointer leaves it — that's how a slider keeps tracking.
// If nobody handles a pointerDown, the kernel's default applies: my hand picks up
// the part (see kitGrabbable), carries it while the button is down, and drops it
// into the container under the pointer on release. Alt-click picks up without the
// auto-drop; the next press drops. Every pointer press begins a gesture (see
// "Gestures"), so whatever scripts write while the button is down is overlaid,
// streamed, and committed once on release.

function kitCapture(p) {
  $kit.capture = p;
}

function kitEvent(e, wx, wy, target) {
  return {
    x: wx,
    y: wy,
    lx: wx,
    ly: wy,
    target: target,
    part: target,
    shift: !!e.shiftKey,
    alt: !!e.altKey,
    meta: !!e.metaKey,
    ctrl: !!e.ctrlKey,
    button: e.button || 0,
    key: e.key || null,
  };
}

function kitDispatch(name, target, evt) {
  /** Signal `name` on the nearest part (target, then its owners) that handles it. */
  let p = target;
  while (p) {
    if (p.handles(name)) {
      let l = p.localFromWorld(evt.x, evt.y);
      evt.lx = l.x;
      evt.ly = l.y;
      evt.part = p;
      p.signal(name, evt);
      return true;
    }
    p = p.owner;
  }
  return false;
}

function kitGrabbable(target) {
  /**
   * What a hand picks up: the nearest part (target, then owners) that sits in a
   * container with `acceptsDrops` and isn't `locked`. So the hands of a clock are
   * carried with the clock, unless the clock itself accepts drops.
   */
  let p = target;
  while (p && p.owner) {
    if (!p.get('locked') && p.owner.get('acceptsDrops')) return p;
    p = p.owner;
  }
  return null;
}

function kitDropTarget(world, wx, wy, carried) {
  let p = world.partAt(wx, wy, carried);
  while (p && !p.get('acceptsDrops')) p = p.owner;
  return p || world;
}

function kitPickUp(hand, p, wx, wy, sticky) {
  /** The hand takes `p`. Nothing moves yet: the lift into the world happens on the
   * first real move (kitCarryMove), so a plain click costs no document writes. */
  kitHandSetCargo(hand, p);
  hand.$sticky = sticky;
  hand.$lifted = false;
  hand.$grabX = wx;
  hand.$grabY = wy;
  hand.$lastX = wx;
  hand.$lastY = wy;
}

function kitCarryMove(world, hand, wx, wy) {
  /** The cargo follows the hand. Its x/y writes land in its overlay (we are inside a
   * gesture), so a drag of any length is zero document writes until the drop. */
  let cargo = hand.$cargo;
  if (!hand.$lifted) {
    if (!hand.$sticky && Math.abs(wx - hand.$grabX) + Math.abs(wy - hand.$grabY) <= 3) return;
    cargo.moveTo(world); // lift it to the top level, frontmost: the one structural write
    hand.$lifted = true;
  }
  cargo.set('x', cargo.num('x', 0) + wx - hand.$lastX);
  cargo.set('y', cargo.num('y', 0) + wy - hand.$lastY);
  hand.$lastX = wx;
  hand.$lastY = wy;
}

function kitDrop(world, hand, wx, wy) {
  let cargo = hand.$cargo;
  kitHandSetCargo(hand, null);
  hand.$sticky = false;
  if (!cargo || !hand.$lifted) return;
  hand.$lifted = false;
  let into = kitDropTarget(world, wx, wy, cargo);
  cargo.moveTo(into);
  into.signal('drop', cargo);
}

function kitPointerDown(world, wx, wy, e) {
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  if (hand.$cargo) {
    // A press while my hand is laden (a sticky carry) drops the cargo, nothing else.
    kitDrop(world, hand, wx, wy);
    kitGestureEndIfIdle(world);
    return;
  }
  kitGestureBegin();
  let target = world.partAt(wx, wy) || world;
  $kit.down = { target: target, x: wx, y: wy };
  if (e.altKey) {
    let g = kitGrabbable(target);
    if (g) {
      kitPickUp(hand, g, wx, wy, true);
      return;
    }
  }
  if (!kitDispatch('pointerDown', target, kitEvent(e, wx, wy, target))) {
    let g = kitGrabbable(target);
    if (g) kitPickUp(hand, g, wx, wy, false);
  }
}

function kitPointerMove(world, wx, wy, e) {
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  if ($kit.capture) {
    kitDispatch('pointerMove', $kit.capture, kitEvent(e, wx, wy, $kit.capture));
    return;
  }
  if (hand.$cargo) {
    kitCarryMove(world, hand, wx, wy);
    return;
  }
  let target = world.partAt(wx, wy) || world;
  kitDispatch('pointerMove', target, kitEvent(e, wx, wy, target));
}

function kitPointerUp(world, wx, wy, e) {
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  let down = $kit.down;
  $kit.down = null;
  if ($kit.capture) {
    let c = $kit.capture;
    $kit.capture = null;
    kitDispatch('pointerUp', c, kitEvent(e, wx, wy, c));
  } else if (hand.$cargo) {
    if (!hand.$sticky) {
      let lifted = hand.$lifted;
      kitDrop(world, hand, wx, wy);
      if (!lifted) kitClick(world, wx, wy, e, down); // never moved: it was a click
    }
  } else kitClick(world, wx, wy, e, down);
  kitGestureEndIfIdle(world);
}

function kitClick(world, wx, wy, e, down) {
  let target = world.partAt(wx, wy) || world;
  kitDispatch('pointerUp', target, kitEvent(e, wx, wy, target));
  if (down && down.target === target) kitDispatch('click', target, kitEvent(e, wx, wy, target));
}

function kitKeyDown(world, e) {
  let target = $kit.focus || world;
  let evt = kitEvent(e, 0, 0, target);
  kitDispatch('keyDown', target, evt);
}

function kitHandleEvent(world, e) {
  /** One queued browser event -> signals. Coordinates are canvas offsets. */
  let wx = e.offsetX || 0;
  let wy = e.offsetY || 0;
  let t = e.type;
  if (t === 'pointerdown' || t === 'pointermove' || t === 'pointerup' || t === 'pointercancel') {
    $kit.inPointerEvent = true; // slot writes from here on are gesture writes (kitOverlayScope)
    try {
      if (t === 'pointerdown') kitPointerDown(world, wx, wy, e);
      else if (t === 'pointermove') kitPointerMove(world, wx, wy, e);
      else kitPointerUp(world, wx, wy, e);
    } finally {
      $kit.inPointerEvent = false;
    }
  } else if (t === 'keydown') kitKeyDown(world, e);
}

// +-------------+
// |  The frame  |
// +-------------+

function kitTick(world, now) {
  /** Signal `tick` on every part with an onTick script whose `stepEvery` (ms) is due. */
  let all = world.allParts();
  for (let i = 0; i < all.length; i++) {
    let p = all[i];
    let every = p.num('stepEvery', 0);
    if (every <= 0 || !p.isScript('onTick')) continue;
    if (p.$lastTick == null || now - p.$lastTick >= every) {
      p.$lastTick = now;
      p.signal('tick', now);
    }
  }
}

function kitFrame(now) {
  /**
   * One frame: queued events -> signals, due ticks, peers' messages in, layout,
   * my message out, draw. Errors from scripts are caught per step and shown in a
   * strip at the bottom of the world, so one broken script doesn't stop the system.
   */
  let world = kitWorld;
  $kit.frameNow = now;
  if (typeof canvas !== 'undefined' && canvas) {
    world.put('w', canvas.width);
    world.put('h', canvas.height);
  }
  let events = window._kitEvents;
  window._kitEvents = new window.Array();
  for (let i = 0; i < events.length; i++) kitTry(() => kitHandleEvent(world, events[i]));
  kitTry(() => kitTick(world, now));
  kitTry(() => kitProcessInbound(world, now));
  kitTry(() => world.layout());
  kitTry(() => kitFlushStream(world, now));
  if (typeof ctx !== 'undefined' && ctx) kitTry(() => kitRender(world, ctx));
}

function kitTry(fn) {
  try {
    fn();
  } catch (e) {
    $kit.lastError = String(e && e.message ? e.message : e);
    if (typeof console !== 'undefined') console.error('Kit:', e);
  }
}

function kitRender(world, c) {
  c.clearRect(0, 0, world.num('w', 0), world.num('h', 0));
  world.draw(c);
  // Hands last, above everything: peers' with name tags, mine in place of the cursor.
  let hands = world.$hands;
  if (hands) {
    for (let i = 0; i < hands.length; i++) {
      if (hands[i].$isLocal && !$kit.drawLocalHand) continue;
      kitDrawHand(c, hands[i]);
    }
  }
  if ($kit.lastError) {
    let h = world.num('h', 0);
    c.fillStyle = '#b3261e';
    c.fillRect(0, h - 22, world.num('w', 0), 22);
    c.fillStyle = 'white';
    c.font = '12px sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('Script error: ' + $kit.lastError + '   (click to dismiss)', 8, h - 11);
  }
}

function initUI() {
  /**
   * Called by the Livelymerge tool when the document opens (and safe to call again).
   * Sets up per-user state, the canvas and message listeners, and the frame loop;
   * makes the world on first run.
   */
  $kit = {
    listeners: [], // keeps the host-held closures alive for the heap's GC
    capture: null,
    down: null,
    focus: null,
    lastError: null,
    onFrame: null,
    gesture: null, // { parts } while a pointer gesture is in progress (see "Gestures")
    inPointerEvent: false,
    frameNow: 0,
    streamSentAt: null,
    handSentAt: null,
    handSentX: null,
    handSentY: null,
    handSentCarrying: null,
    handSweepAt: null,
    ephListener: null,
    drawLocalHand: true, // my hand replaces the OS cursor over the canvas
  };
  // My session id: what peers key my hand and my messages by. Random, never
  // persisted, and kept across re-inits so a mid-session initUI can't make this
  // replica mistake its own in-flight messages for a peer's.
  if (typeof $kitSid !== 'string') $kitSid = 'kit-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  // Raw side-tables on the real window (host data only; never the LM heap):
  window._kitEvents = new window.Array(); // DOM events queued between frames
  window._kitMessages = new window.Array(); // peers' messages queued between frames
  // partId -> lease for peers' overlays. Preserved across re-inits: parts may still
  // carry overlays from before, and a fresh table would leave them without a lease.
  if (window._kitLeases == null) window._kitLeases = new window.Object();

  if (window._uiAbortController) window._uiAbortController.abort();
  window._uiAbortController = new window.AbortController();
  let signal = window._uiAbortController.signal;
  let listen = (source, type, fn) => {
    // Runs OUTSIDE a transaction: only queue the raw event (host array).
    $kit.listeners.push(fn);
    source.addEventListener(type, fn, { signal: signal });
  };
  if (typeof canvas !== 'undefined' && canvas && canvas.addEventListener) {
    canvas.tabIndex = 1;
    canvas.style.touchAction = 'none';
    if ($kit.drawLocalHand) canvas.style.cursor = 'none';
    listen(canvas, 'pointerdown', (e) => {
      // Capture the pointer so the release reaches us even off-canvas: a gesture
      // that never ended would leave its overlays uncommitted.
      if (e.target && e.target.setPointerCapture) {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch (_err) {
          /* ignore */
        }
      }
      window._kitEvents.push(e);
    });
    listen(canvas, 'pointermove', (e) => window._kitEvents.push(e));
    listen(canvas, 'pointerup', (e) => window._kitEvents.push(e));
    listen(canvas, 'pointercancel', (e) => window._kitEvents.push(e));
    listen(canvas, 'keydown', (e) => window._kitEvents.push(e));
  }
  // Peers' messages: the callback runs outside the frame transaction, so it only
  // queues; kitProcessInbound drains the queue inside the frame. The listener is
  // kept in $kit (an LM function read back through a window slot breaks).
  if (window.handle && window.handle.on) {
    if ($kitEphListener != null && window.handle.off) window.handle.off('ephemeral-message', $kitEphListener);
    $kitEphListener = (payload) => {
      if (payload && payload.message) window._kitMessages.push(payload.message);
    };
    $kit.ephListener = $kitEphListener;
    window.handle.on('ephemeral-message', $kitEphListener);
  }
  // My goodbye, prebuilt here (inside the transaction) for the listeners below, which
  // run outside one and must not touch the heap. window._ephByeMsg is also what the
  // Livelymerge tool broadcasts when it unmounts (switching documents has no pagehide).
  let bye = new window.Object();
  bye.type = 'kit-eph-changes';
  bye.v = 1;
  bye.sid = $kitSid;
  bye.objects = new window.Array();
  let byeHand = new window.Object();
  byeHand.bye = true;
  bye.hand = byeHand;
  window._ephByeMsg = bye;
  if (typeof window.addEventListener === 'function') {
    listen(window, 'pagehide', () => {
      if (window.handle && window.handle.broadcast && window._ephByeMsg) window.handle.broadcast(window._ephByeMsg);
    });
  }
  // The name peers draw next to my hand (settles outside any transaction; read by
  // kitHandPayload inside one).
  try {
    kitUserName()
      .then(function (name) {
        window._lmUserName = name ? String(name).slice(0, 24) : null;
      })
      .catch(function () {});
  } catch (_err) {
    /* ignore */
  }

  if (typeof kitWorld === 'undefined' || !kitWorld) kitWorld = kitMakeWorld();
  function onFrame(now) {
    try {
      window.runtime.change(() => {
        if ($kit.lastError && window._kitEvents.length > 0 && window._kitEvents[0].type === 'pointerdown') {
          $kit.lastError = null;
        }
        kitFrame(now);
        window._uiRafId = window.requestAnimationFrame(onFrame);
      });
    } catch (e) {
      if (typeof console !== 'undefined') console.error('Kit frame:', e);
      window._uiRafId = window.requestAnimationFrame(onFrame);
    }
  }
  $kit.onFrame = onFrame;
  if (window._uiRafId != null) window.cancelAnimationFrame(window._uiRafId);
  window._uiRafId = window.requestAnimationFrame(onFrame);
}

// +-----------------------+
// |  The starting world   |
// +-----------------------+

function kitMakeWorld() {
  let world = part({ name: 'world', fill: '#f4f1ea', acceptsDrops: true, x: 0, y: 0, w: 800, h: 600 });
  kitExamples(world);
  return world;
}

function kitLabel(text, x, y) {
  return part({ look: 'none', text: text, x: x, y: y, w: 200, h: 20, align: 'left', fontSize: 13, textColor: '#555' });
}

function kitExamples(world) {
  /**
   * A few things built from parts, to play with and take apart. Each is a few
   * parts, a slot or two, and at most a couple of one-line scripts or wires.
   */
  // Counter: a button wired to a number's increment action; onCount shows the count.
  world.add(kitLabel('Counter: click +1', 30, 20));
  let counter = world.add(part({ name: 'counter', x: 30, y: 44, w: 150, h: 44, fill: 'none' }));
  let num = counter.add(part({ name: 'number', x: 0, y: 0, w: 80, h: 44, count: 0, text: '0', fontSize: 20, fill: 'white', border: '#999', radius: 6 }));
  num.define('increment', function () { this.set('count', this.get('count') + 1); });
  num.define('onCount', function (n) { this.set('text', '' + n); });
  let plus = counter.add(part({ name: 'button', x: 90, y: 0, w: 60, h: 44, text: '+1', fill: '#4a7bd0', textColor: 'white', radius: 8 }));
  wire(plus, 'click', num, 'increment');

  // Slider -> dial: one wire with a transform; another wire to a readout. The whole
  // chain (value, knob, angle, needle, readout) is overlaid while the pointer is
  // down and committed once on release — the scripts don't do anything special.
  world.add(kitLabel('Slider wired to a dial', 30, 120));
  let slider = world.add(part({ name: 'slider', x: 30, y: 150, w: 200, h: 24, fill: '#ddd', radius: 12, value: 25 }));
  slider.add(part({ name: 'knob', look: 'oval', x: 38, y: 0, w: 24, h: 24, fill: '#4a7bd0' }));
  slider.define('onPointerDown', function (e) { kitCapture(this); this.run('track', e); });
  slider.define('onPointerMove', function (e) { this.run('track', e); });
  slider.define('track', function (e) {
    let v = Math.round(Math.max(0, Math.min(100, ((e.lx - 12) / (this.get('w') - 24)) * 100)));
    this.set('value', v);
  });
  slider.define('onValue', function (v) { this.find('knob').put('x', (v / 100) * (this.get('w') - 24)); });
  let dial = world.add(part({ name: 'dial', look: 'oval', x: 260, y: 120, w: 90, h: 90, fill: 'white', border: '#999', angle: 0 }));
  dial.add(part({ name: 'needle', x: 45, y: 43, w: 40, h: 4, pivotX: 0, fill: '#c33' }));
  dial.define('onAngle', function (a) { this.find('needle').set('rotation', a); });
  wire(slider, 'value', dial, 'angle', (v) => v * 3.6 - 90);
  let readout = world.add(part({ name: 'readout', look: 'none', x: 360, y: 155, w: 80, h: 20, text: '25', align: 'left' }));
  wire(slider, 'value', readout, 'text', (v) => '' + v);
  slider.signal('value', 25);

  // Clock: three hands and an onTick script. Every replica computes the time for
  // itself, so the hands' rotation is per-user (setLocal): no document writes, ever.
  world.add(kitLabel('Clock: onTick script, stepEvery 1000', 30, 240));
  let clock = world.add(part({ name: 'clock', look: 'oval', x: 60, y: 270, w: 140, h: 140, fill: 'white', border: '#555', borderWidth: 3, stepEvery: 1000 }));
  clock.add(part({ name: 'hourHand', x: 70, y: 67, w: 40, h: 6, pivotX: 0, fill: '#333', radius: 3 }));
  clock.add(part({ name: 'minuteHand', x: 70, y: 68, w: 58, h: 4, pivotX: 0, fill: '#333', radius: 2 }));
  clock.add(part({ name: 'secondHand', x: 70, y: 69, w: 62, h: 2, pivotX: 0, fill: '#c33' }));
  clock.define('onTick', function () {
    let d = new Date();
    let s = d.getSeconds();
    let m = d.getMinutes() + s / 60;
    let h = (d.getHours() % 12) + m / 60;
    this.find('secondHand').setLocal('rotation', s * 6 - 90);
    this.find('minuteHand').setLocal('rotation', m * 6 - 90);
    this.find('hourHand').setLocal('rotation', h * 30 - 90);
  });

  // Shelf: a row container. Drag things onto it and they line up.
  world.add(kitLabel('Shelf: drop parts here (layout: row)', 300, 240));
  let shelf = world.add(part({ name: 'shelf', x: 300, y: 270, w: 300, h: 70, fill: '#e6dfd0', border: '#b8ad96', radius: 6, layout: 'row', gap: 8, padding: 10, acceptsDrops: true, fit: true }));
  shelf.add(part({ name: 'red', x: 0, y: 0, w: 40, h: 40, fill: '#d05a4a', radius: 4 }));
  shelf.add(part({ name: 'green', look: 'oval', x: 0, y: 0, w: 40, h: 40, fill: '#5aa05a' }));
}

// Live stamp — eval `KITDEFS_WRITTEN_ON` to confirm this build is loaded.
let KITDEFS_WRITTEN_ON = '2026-10-06 11:48 PDT';
//written on 2026-10-06 11:48 PDT
