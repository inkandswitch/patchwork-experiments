//written on 2026-10-07 11:45 PDT
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
//   look      'box' (default) | 'oval' | 'none' | 'text'; fill, border, borderWidth,
//             radius; text, fontSize, textColor, align; hidden; a `draw` script overrides.
//             'text' is a box you can type in (caret, selection) — see kitField.
//             Double-click completes a match (word / line / brackets / whole string);
//             shift-drag extends the nearer end.
//   layout    'free' (default) | 'row' | 'column'; gap, padding; fit (shrink-wrap)
//   input     pointerDown / pointerMove / pointerUp / click / keyDown signals go to
//             the part under the pointer, or the nearest owner that handles them
//             (has an onPointerDown, … script or a wire from that outlet)
//   carrying  a part sitting in a container whose `acceptsDrops` is true can be
//             picked up by the user's hand (press and drag it; Alt-click picks it up
//             and keeps holding it until the next click) and dropped into any other
//             such container; `locked` stops it
//   bin       a container with `isBin`: dragging a sub-part stamps an instance()
//             (the original stays); dropping a part in keeps it as a new prototype
//   halo      meta/cmd-click a part: c copy, x delete, - wire, s scale, r rotate;
//             the name at the bottom inspects (ellipsis if it meets r or s).
//             A second ⌘-click climbs to the owner; the world clears the halo.
//   inspect   halo title (or kitInspect(part)): slot list + script editor, themselves parts
//   find      bin "find" (or kitFind(text)): kitSearch hits; click a hit to inspect
//   wires     drawn when `$kit.showWires` is true; the halo "-" handle drag-connects
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
  beTop: function () {
    /** Move me last among my owner's sub-parts (frontmost). */
    if (this.owner) this.owner.add(this);
    return this;
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
    let sy = this.get('scroll') ? this.$scrollY || 0 : 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      let hit = this.parts[i].partAt(l.x, l.y + sy, excluding);
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
        let maxH = this.num('maxH', 0);
        if (maxH > 0 && this.num('h', 0) > maxH) this.put('h', maxH);
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
    let clipKids = this.get('scroll') || this.get('clip');
    if (clipKids) {
      c.save();
      c.beginPath();
      c.rect(0, 0, this.num('w', 0), this.num('h', 0));
      c.clip();
      if (this.get('scroll')) c.translate(0, -(this.$scrollY || 0));
    }
    for (let i = 0; i < this.parts.length; i++) this.parts[i].draw(c);
    if (clipKids) c.restore();
    c.restore();
  },
  drawLook: function (c) {
    let look = this.get('look') || 'box';
    if (look === 'text') look = 'box';
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
    let editing = typeof $kit === 'object' && $kit && $kit.focus === this;
    if ((text != null && text !== '') || editing) {
      c.save();
      c.beginPath();
      c.rect(0, 0, w, h);
      c.clip();
      this.drawText(c, text == null ? '' : '' + text, w, h);
      c.restore();
    }
  },
  drawText: function (c, text, w, h) {
    let v = kitTextView(this);
    let size = v.size;
    let lines = v.lines;
    let align = v.align;
    c.font = size + 'px sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = align;
    let pad = v.pad;
    let x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
    let lineH = v.lineH;
    let y0 = v.y0;
    if (typeof $kit === 'object' && $kit && $kit.focus === this) {
      let lohi = kitTextRange(this);
      if (lohi.lo !== lohi.hi) {
        c.fillStyle = '#b8d4f0';
        let a = 0;
        for (let i = 0; i < lines.length; i++) {
          let b = a + lines[i].length;
          let s = Math.max(lohi.lo, a);
          let e = Math.min(lohi.hi, b);
          if (e > s) {
            let x0 = kitTextX(c, lines[i], s - a, align, w, pad);
            let x1 = kitTextX(c, lines[i], e - a, align, w, pad);
            c.fillRect(Math.min(x0, x1), y0 + i * lineH - lineH / 2, Math.abs(x1 - x0) || 1, lineH);
          }
          a = b + 1;
        }
      }
    }
    if (typeof $kit === 'object' && $kit && $kit.focus === this) {
      let pair = kitTextBracketAt(v.text, kitCaret(this));
      if (pair) {
        let tint = pair.ok ? '#c8e6b8' : '#f0c0c0';
        kitTextMark(c, v, pair.a, tint);
        if (pair.ok) kitTextMark(c, v, pair.b, tint);
      }
    }
    c.fillStyle = this.get('textColor') || '#222';
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], x, y0 + i * lineH);
    if (typeof $kit === 'object' && $kit && $kit.focus === this) {
      let caret = kitCaret(this);
      let line = 0;
      let col = caret;
      let seen = 0;
      for (let i = 0; i < lines.length; i++) {
        if (caret <= seen + lines[i].length) {
          line = i;
          col = caret - seen;
          break;
        }
        seen += lines[i].length + 1;
        line = i;
        col = lines[i].length;
      }
      let cx = kitTextX(c, lines[line] || '', col, align, w, pad);
      c.strokeStyle = '#222';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx, y0 + line * lineH - lineH / 2);
      c.lineTo(cx, y0 + line * lineH + lineH / 2);
      c.stroke();
    }
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

function kitOutlets(p) {
  /**
   * Names a wire can leave on: 'click', each onX script's signal (onClick -> click),
   * and every data slot. The wire picker's left column.
   */
  let seen = {};
  let out = [];
  let add = (n) => {
    if (n && !seen[n]) {
      seen[n] = true;
      out.push(n);
    }
  };
  add('click');
  let names = p.slotNames();
  for (let i = 0; i < names.length; i++) {
    let n = names[i];
    let v = p.get(n);
    if (typeof v === 'function') {
      if (n.length > 2 && n.slice(0, 2) === 'on') add(n.charAt(2).toLowerCase() + n.slice(3));
    } else add(n);
  }
  return out;
}

function kitInlets(p) {
  /** Names a wire can enter: data slots and action scripts (not onX reactions). */
  let seen = {};
  let out = [];
  let add = (n) => {
    if (n && !seen[n]) {
      seen[n] = true;
      out.push(n);
    }
  };
  let names = p.slotNames();
  for (let i = 0; i < names.length; i++) {
    let n = names[i];
    let v = p.get(n);
    if (typeof v === 'function') {
      if (!(n.length > 2 && n.slice(0, 2) === 'on')) add(n);
    } else add(n);
  }
  return out;
}

function kitSpawn(proto, dest) {
  /**
   * Stamp an instance of `proto` into `dest` (usually the world), sitting exactly
   * where the prototype appears on screen. Dragging out of a bin uses this so the
   * original stays put and later edits to it show through in the stamp.
   */
  let inst = proto.instance();
  let pv = proto.pivot();
  let wpt = proto.worldFromLocal(pv.x, pv.y);
  let turn = proto.worldRotation();
  dest.add(inst);
  let l = dest.localFromWorld(wpt.x, wpt.y);
  let ipv = inst.pivot();
  inst.store('x', l.x - ipv.x);
  inst.store('y', l.y - ipv.y);
  inst.store('rotation', turn - dest.worldRotation());
  return inst;
}

function kitWorldBox(p) {
  /** Axis-aligned world rectangle covering a (possibly rotated) part. */
  let w = p.num('w', 0);
  let h = p.num('h', 0);
  let pts = [
    p.worldFromLocal(0, 0),
    p.worldFromLocal(w, 0),
    p.worldFromLocal(w, h),
    p.worldFromLocal(0, h),
  ];
  let x0 = pts[0].x;
  let y0 = pts[0].y;
  let x1 = x0;
  let y1 = y0;
  for (let i = 1; i < 4; i++) {
    if (pts[i].x < x0) x0 = pts[i].x;
    if (pts[i].y < y0) y0 = pts[i].y;
    if (pts[i].x > x1) x1 = pts[i].x;
    if (pts[i].y > y1) y1 = pts[i].y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, pts: pts };
}

function kitHaloItems(target) {
  /**
   * Letter handles around `target`, in world pixels. Not parts: they live only
   * while the halo is up (ephemeral, per user) so they never enter the doc.
   * c NE, - E, s SE, r SW, x NW; the name sits on the bottom edge between r and s.
   */
  let box = kitWorldBox(target);
  let s = 16;
  let at = (id, label, hx, hy) => ({ id: id, label: label, x: hx - s / 2, y: hy - s / 2, w: s, h: s });
  let x0 = box.x + s;
  let x1 = box.x + box.w - s;
  let maxW = Math.max(20, x1 - x0);
  let name = target.name != null ? '' + target.name : 'part';
  let tw = Math.min(maxW, Math.max(20, name.length * 7 + 8));
  return [
    at('copy', 'c', box.x + box.w, box.y),
    at('wire', '-', box.x + box.w, box.y + box.h / 2),
    at('resize', 's', box.x + box.w, box.y + box.h),
    at('rotate', 'r', box.x, box.y + box.h),
    at('del', 'x', box.x, box.y),
    { id: 'title', x: box.x + box.w / 2 - tw / 2, y: box.y + box.h - 8, w: tw, h: 16, label: name, maxW: maxW },
  ];
}

function kitHitItem(items, wx, wy) {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    let r = items[i];
    if (wx >= r.x && wy >= r.y && wx <= r.x + r.w && wy <= r.y + r.h) return r;
  }
  return null;
}

function kitShowHalo(target) {
  $kit.haloTarget = target && target.owner && !target.$isHand ? target : null;
  $kit.wiringFrom = null;
  $kit.picker = null;
  $kit.haloDrag = null;
}

function kitOpenPicker(from, to, wx, wy) {
  $kit.picker = { from: from, to: to, outlet: null, x: wx + 8, y: wy + 8 };
  $kit.wiringFrom = null;
}

function kitPickerItems() {
  let pk = $kit.picker;
  if (!pk) return [];
  let out = kitOutlets(pk.from);
  let inn = kitInlets(pk.to);
  let rowH = 18;
  let colW = 90;
  let items = [];
  items.push({ id: 'title', x: pk.x, y: pk.y, w: colW * 2 + 8, h: 16, label: 'wire', kind: 'label' });
  for (let i = 0; i < out.length; i++) {
    items.push({
      id: 'out:' + out[i],
      x: pk.x,
      y: pk.y + 20 + i * rowH,
      w: colW,
      h: rowH - 1,
      label: out[i],
      kind: 'outlet',
      name: out[i],
    });
  }
  for (let i = 0; i < inn.length; i++) {
    items.push({
      id: 'in:' + inn[i],
      x: pk.x + colW + 8,
      y: pk.y + 20 + i * rowH,
      w: colW,
      h: rowH - 1,
      label: inn[i],
      kind: 'inlet',
      name: inn[i],
    });
  }
  return items;
}

function kitPick(item) {
  let pk = $kit.picker;
  if (!pk || !item) return;
  if (item.kind === 'outlet') pk.outlet = item.name;
  else if (item.kind === 'inlet' && pk.outlet) {
    wire(pk.from, pk.outlet, pk.to, item.name);
    $kit.picker = null;
    $kit.showWires = true;
  }
}

function kitDoHalo(id, target, wx, wy) {
  if (id === 'copy') {
    kitGestureBegin();
    let cpy = target.copy();
    if (target.owner) target.owner.add(cpy);
    cpy.moveTo(target.world());
    kitShowHalo(cpy);
    $kit.haloDrag = { id: 'copy', target: cpy, x: wx, y: wy, ox: wx, oy: wy };
  } else if (id === 'del') {
    target.unwireAll();
    target.remove();
    kitShowHalo(null);
  } else if (id === 'wire') {
    $kit.wiringFrom = target;
    $kit.picker = null;
  } else if (id === 'title') {
    kitInspect(target);
  } else if (id === 'resize' || id === 'rotate') {
    kitGestureBegin();
    $kit.haloDrag = { id: id, target: target, x: wx, y: wy };
  }
}

function kitHaloDragTo(wx, wy) {
  let d = $kit.haloDrag;
  if (!d) return;
  let tgt = d.target;
  if (d.id === 'copy') {
    tgt.put('x', tgt.num('x', 0) + wx - d.x);
    tgt.put('y', tgt.num('y', 0) + wy - d.y);
    d.x = wx;
    d.y = wy;
  } else if (d.id === 'resize') {
    let l = tgt.localFromWorld(wx, wy);
    tgt.put('w', Math.max(12, l.x));
    tgt.put('h', Math.max(12, l.y));
  } else if (d.id === 'rotate') {
    let pv = tgt.pivot();
    let c = tgt.worldFromLocal(pv.x, pv.y);
    tgt.put('rotation', (Math.atan2(wy - c.y, wx - c.x) * 180) / Math.PI);
  }
}

function kitCenter(p) {
  return p.worldFromLocal(p.num('w', 0) / 2, p.num('h', 0) / 2);
}

function kitDrawWires(world, c) {
  let all = world.allParts();
  c.save();
  c.strokeStyle = '#4a7bd0';
  c.fillStyle = '#4a7bd0';
  c.lineWidth = 1.5;
  c.font = '11px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = 0; i < all.length; i++) {
    let ws = all[i].wiresOut;
    for (let j = 0; j < ws.length; j++) {
      let wr = ws[j];
      if (!wr.from || !wr.to) continue;
      let a = kitCenter(wr.from);
      let b = kitCenter(wr.to);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      let mx = (a.x + b.x) / 2;
      let my = (a.y + b.y) / 2;
      let label = (wr.outlet || '') + '→' + (wr.inlet || '');
      c.fillStyle = '#f4f1ea';
      c.fillRect(mx - 28, my - 8, 56, 14);
      c.fillStyle = '#4a7bd0';
      c.fillText(label, mx, my);
    }
  }
  c.restore();
}

function kitDrawHalo(c) {
  let tgt = $kit.haloTarget;
  if (!tgt || !tgt.owner) return;
  let box = kitWorldBox(tgt);
  c.save();
  c.strokeStyle = '#4a7bd0';
  c.lineWidth = 1.5;
  c.setLineDash ? c.setLineDash([4, 3]) : null;
  c.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  c.setLineDash ? c.setLineDash([]) : null;
  c.font = '11px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  let items = kitHaloItems(tgt);
  for (let i = 0; i < items.length; i++) {
    let r = items[i];
    c.fillStyle = '#fff';
    c.strokeStyle = '#4a7bd0';
    c.lineWidth = 1;
    if (r.id === 'title') {
      c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeRect(r.x, r.y, r.w, r.h);
      let s = r.label || '';
      let maxW = r.maxW || r.w;
      if (c.measureText && c.measureText(s).width > maxW) {
        while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        s = s + '…';
      }
      c.fillStyle = '#234';
      c.fillText(s, r.x + r.w / 2, r.y + r.h / 2);
    } else {
      c.beginPath();
      c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = r.id === 'del' ? '#a33' : '#234';
      c.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2);
    }
  }
  c.restore();
}

function kitDrawPicker(c) {
  let items = kitPickerItems();
  if (items.length === 0) return;
  let pk = $kit.picker;
  c.save();
  let last = items[items.length - 1];
  let top = items[0];
  c.fillStyle = '#fff';
  c.strokeStyle = '#4a7bd0';
  c.lineWidth = 1;
  let h = last.y + last.h - top.y + 8;
  c.fillRect(pk.x - 6, pk.y - 6, top.w + 12, h);
  c.strokeRect(pk.x - 6, pk.y - 6, top.w + 12, h);
  for (let i = 0; i < items.length; i++) {
    let r = items[i];
    let chosen = pk.outlet && r.kind === 'outlet' && r.name === pk.outlet;
    if (r.kind !== 'label') {
      c.fillStyle = chosen ? '#4a7bd0' : '#f4f1ea';
      c.fillRect(r.x, r.y, r.w, r.h);
    }
    c.fillStyle = chosen ? '#fff' : '#234';
    c.font = '11px sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(r.label, r.x + 4, r.y + r.h / 2);
  }
  c.restore();
}

function kitDrawRubber(c) {
  let src = $kit.wiringFrom;
  if (!src) return;
  let a = kitCenter(src);
  c.save();
  c.strokeStyle = '#4a7bd0';
  c.setLineDash ? c.setLineDash([5, 4]) : null;
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo($kit.pointerX || a.x, $kit.pointerY || a.y);
  c.stroke();
  c.restore();
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
    // A bin stamps an instance and leaves the prototype; anything else is moved.
    if (cargo.owner && cargo.owner.get('isBin')) {
      cargo = kitSpawn(cargo, world);
      kitHandSetCargo(hand, cargo);
    }
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
  $kit.pointerX = wx;
  $kit.pointerY = wy;
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  // Overlay hits first (halo, picker): they are not parts, so they never persist.
  if ($kit.picker) {
    let hit = kitHitItem(kitPickerItems(), wx, wy);
    if (hit && hit.kind !== 'label') kitPick(hit);
    else $kit.picker = null;
    $kit.down = { overlay: true, x: wx, y: wy };
    return;
  }
  if ($kit.haloTarget && $kit.haloTarget.owner) {
    let hit = kitHitItem(kitHaloItems($kit.haloTarget), wx, wy);
    if (hit) {
      kitDoHalo(hit.id, $kit.haloTarget, wx, wy);
      $kit.down = { overlay: true, x: wx, y: wy };
      return;
    }
  }
  if ($kit.wiringFrom) {
    let target = world.partAt(wx, wy) || world;
    if (target !== world && target !== $kit.wiringFrom) kitOpenPicker($kit.wiringFrom, target, wx, wy);
    else $kit.wiringFrom = null;
    $kit.down = { overlay: true, x: wx, y: wy };
    return;
  }
  if (e.metaKey) {
    let target = world.partAt(wx, wy) || world;
    let cur = $kit.haloTarget;
    if (cur && cur.owner && (cur === target || cur.contains(target))) kitShowHalo(cur.owner);
    else kitShowHalo(target === world ? null : target);
    $kit.down = { overlay: true, x: wx, y: wy };
    return;
  }
  if (hand.$cargo) {
    // A press while my hand is laden (a sticky carry) drops the cargo, nothing else.
    kitDrop(world, hand, wx, wy);
    kitGestureEndIfIdle(world);
    return;
  }
  kitGestureBegin();
  let target = world.partAt(wx, wy) || world;
  if ($kit.focus && $kit.focus !== target) $kit.focus = null;
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
  $kit.pointerX = wx;
  $kit.pointerY = wy;
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  if ($kit.haloDrag) {
    kitHaloDragTo(wx, wy);
    return;
  }
  if ($kit.textDrag) {
    kitTextDragTo($kit.textDrag, wx, wy);
    return;
  }
  if ($kit.down && $kit.down.overlay) return;
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
  $kit.pointerX = wx;
  $kit.pointerY = wy;
  let hand = kitLocalHand(world, wx, wy);
  kitMoveHand(hand, wx, wy);
  let down = $kit.down;
  let textDrag = $kit.textDrag;
  $kit.down = null;
  $kit.textDrag = null;
  if (textDrag) kitTextFinish(textDrag);
  if ($kit.haloDrag) {
    let d = $kit.haloDrag;
    $kit.haloDrag = null;
    if (d.id === 'copy' && d.target && d.target.owner) {
      if (Math.abs(wx - d.ox) + Math.abs(wy - d.oy) < 4) {
        d.target.put('x', d.target.num('x', 0) + 16);
        d.target.put('y', d.target.num('y', 0) + 16);
      } else {
        d.target.moveTo(kitDropTarget(world, wx, wy, d.target));
      }
    }
    kitGestureEndIfIdle(world);
    return;
  }
  if (down && down.overlay) {
    kitGestureEndIfIdle(world);
    return;
  }
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
  else if (t === 'wheel') kitWheel(world, wx, wy, e);
}

function kitWheel(world, wx, wy, e) {
  /** Scroll the text field or `scroll` container under the pointer. */
  let target = world.partAt(wx, wy) || world;
  let dy = typeof e.deltaY === 'number' ? e.deltaY : 0;
  let p = target;
  while (p) {
    if (p.get('scroll') || p.get('look') === 'text' || p.get('multiline')) {
      kitScrollBy(p, dy);
      return;
    }
    p = p.owner;
  }
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
  if ($kit.showWires !== false) kitDrawWires(world, c);
  if ($kit.wiringFrom) kitDrawRubber(c);
  kitDrawHalo(c);
  kitDrawPicker(c);
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
    showWires: true,
    haloTarget: null,
    haloDrag: null,
    wiringFrom: null,
    picker: null,
    pointerX: 0,
    pointerY: 0,
    textDrag: null,
    textDragStart: null,
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
      if (canvas.focus) canvas.focus();
      window._kitEvents.push(e);
    });
    listen(canvas, 'pointermove', (e) => window._kitEvents.push(e));
    listen(canvas, 'pointerup', (e) => window._kitEvents.push(e));
    listen(canvas, 'pointercancel', (e) => window._kitEvents.push(e));
    listen(canvas, 'keydown', (e) => window._kitEvents.push(e));
    listen(canvas, 'wheel', (e) => {
      if (e.preventDefault) e.preventDefault();
      window._kitEvents.push(e);
    });
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
  else kitInstallTools(kitWorld);
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
  kitInstallTools(world);
  return world;
}

function kitInstallTools(world) {
  /**
   * Ensure the world has a parts bin, and that an older bin (from before Finder)
   * gets a find button. Safe to call again after re-eval.
   */
  let bin = world.find('bin');
  if (!bin) bin = world.add(kitMakeBin());
  if (!bin.find('findBtn')) {
    let wbtn = bin.find('wiresBtn');
    let idx = wbtn ? bin.parts.indexOf(wbtn) + 1 : 2;
    bin.add(kitMakeFindBtn(), idx);
  }
}

function kitParseValue(text, old) {
  if (typeof old === 'number') {
    let n = Number(text);
    return n === n ? n : old;
  }
  if (typeof old === 'boolean') return text === 'true' || text === '1';
  return text;
}

function kitTextOf(p) {
  let t = p.get('text');
  return t == null ? '' : '' + t;
}

function kitTextView(p) {
  /**
   * How a field lays out its string: top-aligned + $scrollY for `text` / multiline
   * (so a long script cannot paint over the Inspector rows); centred for labels.
   */
  let text = kitTextOf(p);
  let size = p.num('fontSize', 14);
  let lineH = size * 1.25;
  let pad = 4;
  let lines = text.split('\n');
  let h = p.num('h', 0);
  let top = p.get('look') === 'text' || p.get('multiline');
  let scrollY = top && typeof p.$scrollY === 'number' ? p.$scrollY : 0;
  let y0 = top ? pad + lineH / 2 - scrollY : h / 2 - ((lines.length - 1) * lineH) / 2;
  return {
    text: text,
    size: size,
    lineH: lineH,
    pad: pad,
    lines: lines,
    y0: y0,
    align: p.get('align') || (top ? 'left' : 'center'),
    w: p.num('w', 0),
    h: h,
  };
}

function kitScrollMax(p) {
  if (p.get('look') === 'text' || p.get('multiline')) {
    let v = kitTextView(p);
    return Math.max(0, v.lines.length * v.lineH + 2 * v.pad - v.h);
  }
  if (!p.get('scroll')) return 0;
  let pad = p.num('padding', 0);
  let gap = p.num('gap', 0);
  let inner = pad;
  if (p.get('layout') === 'column' || p.get('layout') === 'row') {
    for (let i = 0; i < p.parts.length; i++) {
      if (p.parts[i].get('hidden')) continue;
      inner += (p.get('layout') === 'column' ? p.parts[i].num('h', 0) : p.parts[i].num('w', 0)) + gap;
    }
    inner = inner - gap + pad;
  } else {
    inner = pad;
    for (let i = 0; i < p.parts.length; i++) {
      let ch = p.parts[i];
      if (ch.get('hidden')) continue;
      let bot = ch.num('y', 0) + ch.num('h', 0);
      if (bot > inner) inner = bot;
    }
    inner += pad;
  }
  return Math.max(0, inner - p.num('h', 0));
}

function kitScrollBy(p, dy) {
  let max = kitScrollMax(p);
  let y = (p.$scrollY || 0) + dy;
  if (y < 0) y = 0;
  if (y > max) y = max;
  p.$scrollY = y;
}

function kitTextRevealCaret(p) {
  if (!(p.get('look') === 'text' || p.get('multiline'))) return;
  let v = kitTextView(p);
  let lc = kitTextLineCol(v.text, kitCaret(p));
  let yLine = v.pad + lc.line * v.lineH;
  let view = p.$scrollY || 0;
  let viewH = Math.max(v.lineH, v.h - 2 * v.pad);
  if (yLine < view) p.$scrollY = yLine;
  else if (yLine + v.lineH > view + viewH) p.$scrollY = yLine + v.lineH - viewH;
  let max = kitScrollMax(p);
  if ((p.$scrollY || 0) < 0) p.$scrollY = 0;
  if ((p.$scrollY || 0) > max) p.$scrollY = max;
}

function kitCaret(p) {
  let n = kitTextOf(p).length;
  let c = p.$caret;
  if (typeof c !== 'number') c = n;
  return Math.max(0, Math.min(n, c));
}

function kitAnchor(p) {
  let n = kitTextOf(p).length;
  let a = p.$anchor;
  if (typeof a !== 'number') a = kitCaret(p);
  return Math.max(0, Math.min(n, a));
}

function kitTextRange(p) {
  let a = kitAnchor(p);
  let c = kitCaret(p);
  return a < c ? { lo: a, hi: c } : { lo: c, hi: a };
}

function kitTextX(c, line, col, align, w, pad) {
  /** x of column `col` on `line`, matching drawText. */
  let prefix = line.slice(0, col);
  let tw = c.measureText ? c.measureText(prefix).width : col * 8;
  if (align === 'left') return pad + tw;
  let full = c.measureText ? c.measureText(line).width : line.length * 8;
  if (align === 'right') return w - pad - (full - tw);
  return w / 2 - full / 2 + tw;
}

function kitTextIndexAt(p, lx, ly) {
  /** Caret index nearest local point (lx, ly). */
  let v = kitTextView(p);
  let line = Math.round((ly - v.y0) / v.lineH);
  if (line < 0) line = 0;
  if (line >= v.lines.length) return v.text.length;
  let start = 0;
  for (let i = 0; i < line; i++) start += v.lines[i].length + 1;
  let s = v.lines[line];
  let c = typeof ctx !== 'undefined' ? ctx : null;
  if (c && c.font != null) c.font = v.size + 'px sans-serif';
  let best = 0;
  let bestD = 1e9;
  for (let i = 0; i <= s.length; i++) {
    let x = kitTextX(c || { measureText: null }, s, i, v.align, v.w, v.pad);
    let d = Math.abs(x - lx);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return start + best;
}

function kitTextReplace(p, lo, hi, insert, caret) {
  let t = kitTextOf(p);
  p.set('text', t.slice(0, lo) + insert + t.slice(hi));
  p.$caret = caret;
  p.$anchor = caret;
  kitTextRevealCaret(p);
}

function kitTextMove(p, next, extend) {
  let n = kitTextOf(p).length;
  if (next < 0) next = 0;
  if (next > n) next = n;
  p.$caret = next;
  if (!extend) p.$anchor = next;
  kitTextRevealCaret(p);
}

function kitTextLineCol(t, i) {
  let head = t.slice(0, i);
  let line = head.split('\n').length - 1;
  let nl = head.lastIndexOf('\n');
  return { line: line, col: nl < 0 ? i : i - nl - 1 };
}

function kitTextAtLineCol(t, line, col) {
  let lines = t.split('\n');
  if (line < 0) return 0;
  if (line >= lines.length) return t.length;
  let start = 0;
  for (let i = 0; i < line; i++) start += lines[i].length + 1;
  if (col < 0) col = 0;
  if (col > lines[line].length) col = lines[line].length;
  return start + col;
}

function kitTextMark(c, v, index, color) {
  /** Highlight the character at `index` (bracket match). */
  let lc = kitTextLineCol(v.text, index);
  let line = v.lines[lc.line] || '';
  let x0 = kitTextX(c, line, lc.col, v.align, v.w, v.pad);
  let x1 = kitTextX(c, line, Math.min(lc.col + 1, line.length), v.align, v.w, v.pad);
  c.fillStyle = color;
  c.fillRect(Math.min(x0, x1), v.y0 + lc.line * v.lineH - v.lineH / 2, Math.max(Math.abs(x1 - x0), 4), v.lineH);
}

function kitTextBracketAt(t, caret) {
  /**
   * Matching bracket at the caret (char before, else at). `{ a, b, ok }`.
   * ok is false when the mate is missing (still mark the one we are on).
   */
  let mates = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };
  let opens = { '(': true, '[': true, '{': true };
  let tryAt = (i) => {
    if (i < 0 || i >= t.length) return null;
    let ch = t.charAt(i);
    let other = mates[ch];
    if (!other) return null;
    let dir = opens[ch] ? 1 : -1;
    let depth = 0;
    for (let j = i; j >= 0 && j < t.length; j += dir) {
      let c = t.charAt(j);
      if (c === ch) depth++;
      else if (c === other) {
        depth--;
        if (depth === 0) return { a: i, b: j, ok: true };
      }
    }
    return { a: i, b: i, ok: false };
  };
  return tryAt(caret - 1) || tryAt(caret);
}

function kitTextSelectWord(str, i1) {
  /**
   * Double-click match from Livelymerge TextBox.selectWord: whole string at either
   * end, whole line at a line break, insides of brackets/quotes/block comments,
   * slash-slash to end of line, a run of spaces, else an alphanumeric (and 12.3) word.
   * Returns { lo, hi } with hi exclusive.
   */
  if (!str) return { lo: 0, hi: 0 };
  let n = str.length;
  if (i1 < 0) i1 = 0;
  if (i1 > n) i1 = n;
  if (i1 === 0 || i1 === n) return { lo: 0, hi: n };
  let rightBrackets = '*)}]>\'"`';
  let leftBrackets = '*({[<\'"`';
  let isWhite = (c) => c === '\t' || c === ' ';
  let isAlpha = (c) => /^[a-zA-Z0-9\-]$/.test(c || '');
  let periodWithDigit = (c, prev) => c === '.' && '0123456789'.indexOf(prev) >= 0;
  let matchBrackets = (chin, chout, start, dir) => {
    let i = start;
    let depth = 1;
    while (dir < 0 ? i - 1 >= 0 : i + 1 < n) {
      i += dir;
      if (str.charAt(i) === chin && chin !== chout) depth++;
      if (str.charAt(i) === chout) depth--;
      if (depth === 0) return i;
    }
    return i;
  };
  let lineAround = (i) => {
    let lo = i;
    while (lo > 0 && str.charAt(lo - 1) !== '\n' && str.charAt(lo - 1) !== '\r') lo--;
    let hi = i;
    while (hi < n && str.charAt(hi) !== '\n' && str.charAt(hi) !== '\r') hi++;
    if (hi < n) hi++;
    return { lo: lo, hi: hi };
  };
  if (i1 > 0) {
    let left = str.charAt(i1 - 1);
    if (left === '\n' || left === '\r') return lineAround(i1);
    let bi = leftBrackets.indexOf(left);
    if (left === '*' && (i1 - 2 < 0 || str.charAt(i1 - 2) !== '/')) bi = -1;
    if (bi >= 0) {
      let close = matchBrackets(leftBrackets.charAt(bi), rightBrackets.charAt(bi), i1 - 1, 1);
      return { lo: i1, hi: close };
    }
  }
  if (i1 < n) {
    let right = str.charAt(i1);
    if (right === '\n' || right === '\r') return lineAround(i1);
    let bi = rightBrackets.indexOf(right);
    if (right === '*' && (i1 + 1 >= n || str.charAt(i1 + 1) !== '/')) bi = -1;
    if (bi >= 0) {
      let open = matchBrackets(rightBrackets.charAt(bi), leftBrackets.charAt(bi), i1, -1);
      return { lo: open + 1, hi: i1 };
    }
  }
  if (i1 >= 2 && str.charAt(i1 - 1) === '/' && str.charAt(i1 - 2) === '/') {
    let hi = i1;
    while (hi < n && str.charAt(hi) !== '\n' && str.charAt(hi) !== '\r') hi++;
    return { lo: i1, hi: hi };
  }
  let myI1 = i1;
  let myI2 = i1 - 1;
  while (myI1 - 1 >= 0 && isWhite(str.charAt(myI1 - 1))) myI1--;
  while (myI2 + 1 < n && isWhite(str.charAt(myI2 + 1))) myI2++;
  if (myI2 - myI1 >= 1) return { lo: myI1, hi: myI2 + 1 };
  let i2 = i1 - 1;
  let prev = i1 < n ? str.charAt(i1) : '';
  while (i1 - 1 >= 0 && (isAlpha(str.charAt(i1 - 1)) || periodWithDigit(str.charAt(i1 - 1), prev))) {
    prev = str.charAt(i1 - 1);
    i1--;
  }
  while (i2 + 1 < n && (isAlpha(str.charAt(i2 + 1)) || periodWithDigit(str.charAt(i2 + 1), prev))) {
    prev = str.charAt(i2 + 1);
    i2++;
  }
  return { lo: i1, hi: i2 + 1 };
}

function kitTextShiftExtend(p, i) {
  /**
   * Shift-click/drag: pin the farther end of the current selection and move the
   * nearer one (ties go to the right end). An empty selection pins where it was.
   */
  let range = kitTextRange(p);
  let a = range.lo;
  let b = range.hi;
  let far = a === b ? a : Math.abs(i - a) <= Math.abs(i - b) ? b : a;
  p.$anchor = far;
  p.$caret = i;
}

function kitTextFinish(p) {
  /**
   * Pointer-up: a tiny drag is still a click (so the next click can complete a
   * double-click match). Remember a collapsed caret for that second click.
   */
  if (!p) return;
  let start = $kit.textDragStart;
  $kit.textDragStart = null;
  if (start && !start.shift) {
    let d = Math.abs(($kit.pointerX || 0) - start.x) + Math.abs(($kit.pointerY || 0) - start.y);
    if (d < 4) {
      p.$caret = start.i;
      p.$anchor = start.i;
    }
  }
  let range = kitTextRange(p);
  p.$priorNull = range.lo === range.hi ? range.lo : -1;
}

function kitTextDragTo(p, wx, wy) {
  let l = p.localFromWorld(wx, wy);
  p.$caret = kitTextIndexAt(p, l.x, l.y);
  kitTextRevealCaret(p);
}

function kitTextClick(e) {
  /**
   * Focus me and start a drag-select. Shift moves the nearer end. A second click
   * at the same caret completes selectWord (whole match), and does not keep dragging.
   */
  $kit.focus = this;
  let i = kitTextIndexAt(this, e.lx, e.ly);
  if (e.shift) {
    kitTextShiftExtend(this, i);
    $kit.textDrag = this;
    $kit.textDragStart = { x: e.x, y: e.y, i: i, shift: true };
  } else if (this.$priorNull === i) {
    let w = kitTextSelectWord(kitTextOf(this), i);
    this.$anchor = w.lo;
    this.$caret = w.hi;
    this.$priorNull = -1;
    $kit.textDrag = null;
    $kit.textDragStart = null;
  } else {
    this.$caret = i;
    this.$anchor = i;
    $kit.textDrag = this;
    $kit.textDragStart = { x: e.x, y: e.y, i: i, shift: false };
  }
  kitTextRevealCaret(this);
}

function kitTextKey(e) {
  /**
   * Real typing on a focused field: caret, selection, arrows, Backspace/Delete.
   * Enter accepts (Shift-Enter or `multiline` inserts a newline); ⌘/Ctrl-Enter
   * always accepts. The bindings follow Livelymerge's TextBox, not Morphic itself.
   */
  let k = e.key;
  if (k == null || k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;
  let t = kitTextOf(this);
  let caret = kitCaret(this);
  let range = kitTextRange(this);
  let lo = range.lo;
  let hi = range.hi;
  if (e.ctrl || e.meta) {
    if (k === 'a' || k === 'A') {
      this.$anchor = 0;
      this.$caret = t.length;
      return;
    }
    if ((k === 'Enter' || k === 'Return') && this.isScript('accept')) this.run('accept');
    return;
  }
  if (k === 'Backspace') {
    if (lo !== hi) kitTextReplace(this, lo, hi, '', lo);
    else if (lo > 0) kitTextReplace(this, lo - 1, lo, '', lo - 1);
    return;
  }
  if (k === 'Delete') {
    if (lo !== hi) kitTextReplace(this, lo, hi, '', lo);
    else if (lo < t.length) kitTextReplace(this, lo, lo + 1, '', lo);
    return;
  }
  if (k === 'ArrowLeft') {
    kitTextMove(this, lo !== hi && !e.shift ? lo : caret - 1, e.shift);
    return;
  }
  if (k === 'ArrowRight') {
    kitTextMove(this, lo !== hi && !e.shift ? hi : caret + 1, e.shift);
    return;
  }
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    let lc = kitTextLineCol(t, caret);
    let dest = kitTextAtLineCol(t, lc.line + (k === 'ArrowUp' ? -1 : 1), lc.col);
    kitTextMove(this, dest, e.shift);
    return;
  }
  if (k === 'Enter') {
    if (e.shift || this.get('multiline')) {
      kitTextReplace(this, lo, hi, '\n', lo + 1);
      return;
    }
    if (this.isScript('accept')) this.run('accept');
    return;
  }
  if (k === 'Escape') {
    $kit.focus = null;
    return;
  }
  if (k.length === 1) kitTextReplace(this, lo, hi, k, lo + 1);
}

function kitField(spec) {
  /** A part you can click and type into. `look: 'text'` if none given. Enter runs `accept`. */
  if (!spec.look) spec.look = 'text';
  if (spec.align == null) spec.align = 'left';
  let f = part(spec);
  f.define('onPointerDown', kitTextClick);
  f.define('onKeyDown', kitTextKey);
  return f;
}

function kitInspect(tgt) {
  /**
   * Open (or raise) the Inspector on `tgt`. The Inspector is an ordinary part, so it
   * can inspect itself — that's how you change the Inspector from inside the Kit.
   */
  let dest = tgt && tgt.world ? tgt.world() : kitWorld;
  let ins = dest.find('inspector');
  if (!ins) ins = dest.add(kitMakeInspector());
  ins.run('show', tgt);
  ins.beTop();
  return ins;
}

function kitFind(q) {
  let dest = kitWorld;
  let f = dest.find('finder');
  if (!f) f = dest.add(kitMakeFinder());
  f.beTop();
  if (q != null && q !== '') {
    f.find('query').set('text', q);
    f.run('search', q);
  }
  $kit.focus = f.find('query');
  return f;
}

function kitMakeInspector() {
  /**
   * A column of slot rows plus a script editor. `show(tgt)` rebuilds the rows from
   * tgt.slotNames(). Click a script row to edit; click a data row and type, Enter
   * to set. All of that is scripts on this part, so they appear in the list too.
   */
  let ins = part({
    name: 'inspector',
    x: 16,
    y: 400,
    w: 310,
    fill: '#fff',
    border: '#4a7bd0',
    radius: 6,
    layout: 'column',
    gap: 3,
    padding: 8,
    fit: true,
  });
  ins.add(part({ name: 'title', look: 'none', text: 'Inspector', w: 290, h: 18, align: 'left', fontSize: 13, locked: true }));
  ins.add(part({ name: 'rows', fill: 'none', w: 290, layout: 'column', gap: 1, fit: true, maxH: 220, scroll: true }));
  let editor = ins.add(
    kitField({
      name: 'editor',
      w: 290,
      h: 120,
      text: '',
      fill: '#f8f6f1',
      border: '#ccc',
      fontSize: 11,
      align: 'left',
      multiline: true,
      hidden: true,
    }),
  );
  editor.define('accept', function () {
    let host = this.owner;
    let tgt = host.get('target');
    let n = host.get('editing');
    if (!tgt || !n) return;
    try {
      tgt.define(n, this.get('text'));
    } catch (err) {
      $kit.lastError = String(err && err.message ? err.message : err);
    }
    host.run('refresh');
  });
  let rowLike = part({ name: 'rowLike' });
  rowLike.define('onPointerDown', kitTextClick);
  rowLike.define('onClick', function () {
    if (this.get('kind') === 'script') this.owner.owner.run('pick', this.get('slotName'));
  });
  rowLike.define('onKeyDown', kitTextKey);
  rowLike.define('accept', function () {
    let host = this.owner.owner;
    let tgt = host.get('target');
    let n = this.get('slotName');
    if (!tgt || !n) return;
    let raw = '' + this.get('text');
    let prefix = n + ': ';
    let body = raw.indexOf(prefix) === 0 ? raw.slice(prefix.length) : raw;
    tgt.set(n, kitParseValue(body, tgt.get(n)));
    host.run('refresh');
  });
  ins.put('rowLike', rowLike);
  ins.define('show', function (tgt) {
    this.put('target', tgt);
    this.put('editing', null);
    this.put('rotation', 0);
    this.find('editor').put('hidden', true);
    this.run('refresh');
  });
  ins.define('refresh', function () {
    let tgt = this.get('target');
    this.find('title').set('text', tgt ? 'inspect ' + tgt : 'Inspector');
    let rows = this.find('rows');
    while (rows.parts.length > 0) rows.removePart(rows.parts[0]);
    if (!tgt) return;
    let names = tgt.slotNames();
    let proto = this.get('rowLike');
    for (let i = 0; i < names.length; i++) {
      let n = names[i];
      let v = tgt.get(n);
      let kind = typeof v === 'function' ? 'script' : v && v.slots ? 'ref' : 'data';
      let shown = kind === 'script' ? n + '  ƒ' : n + ': ' + v;
      rows.add(
        part({
          like: proto,
          slotName: n,
          kind: kind,
          text: shown,
          w: 290,
          h: 18,
          fontSize: 11,
          align: 'left',
          fill: tgt.hasOwn(n) ? '#fff' : '#f0eee8',
          border: '#eee',
          locked: true,
        }),
      );
    }
  });
  ins.put('stepEvery', 16);
  ins.define('onTick', function () {
    /** Keep data rows in step with the target (w/h while scaling, count, …). */
    let tgt = this.get('target');
    if (!tgt) return;
    let rows = this.find('rows');
    let names = tgt.slotNames();
    if (names.length !== rows.parts.length) {
      this.run('refresh');
      return;
    }
    for (let i = 0; i < names.length; i++) {
      let row = rows.parts[i];
      if (row.get('slotName') !== names[i]) {
        this.run('refresh');
        return;
      }
      if (row.get('kind') !== 'data' || $kit.focus === row) continue;
      let shown = names[i] + ': ' + tgt.get(names[i]);
      if (row.get('text') !== shown) row.put('text', shown);
    }
  });
  ins.define('pick', function (n) {
    let tgt = this.get('target');
    if (!tgt) return;
    this.put('editing', n);
    if (typeof tgt.get(n) === 'function') {
      let ed = this.find('editor');
      ed.put('hidden', false);
      ed.set('text', tgt.scriptSource(n) || '');
      ed.$caret = kitTextOf(ed).length;
      ed.$anchor = ed.$caret;
      $kit.focus = ed;
    }
  });
  return ins;
}

function kitMakeFinder() {
  /**
   * A search field plus hit rows. Enter runs kitSearch on the world; a hit's click
   * opens the Inspector on that part. Built from the same field/row pattern.
   */
  let f = part({
    name: 'finder',
    x: 340,
    y: 400,
    w: 260,
    fill: '#fff',
    border: '#4a7bd0',
    radius: 6,
    layout: 'column',
    gap: 3,
    padding: 8,
    fit: true,
  });
  f.add(part({ name: 'title', look: 'none', text: 'Finder', w: 240, h: 16, align: 'left', fontSize: 13, locked: true }));
  let query = f.add(
    kitField({ name: 'query', w: 240, h: 22, text: '', fill: '#f8f6f1', border: '#ccc', fontSize: 12, align: 'left' }),
  );
  query.define('accept', function () {
    this.owner.run('search', this.get('text'));
  });
  f.add(part({ name: 'hits', fill: 'none', w: 240, layout: 'column', gap: 1, fit: true }));
  let hitLike = part({ name: 'hitLike' });
  hitLike.define('onClick', function () {
    kitInspect(this.get('hitPart'));
  });
  f.put('hitLike', hitLike);
  f.define('search', function (q) {
    let hits = this.find('hits');
    while (hits.parts.length > 0) hits.removePart(hits.parts[0]);
    if (q == null || q === '') return;
    let list = kitSearch(this.world(), q);
    let proto = this.get('hitLike');
    let n = list.length < 12 ? list.length : 12;
    for (let i = 0; i < n; i++) {
      let h = list[i];
      hits.add(
        part({
          like: proto,
          hitPart: h.part,
          text: (h.part.name || '?') + ' · ' + (h.slot || '') + ' · ' + h.where,
          w: 240,
          h: 18,
          fontSize: 11,
          align: 'left',
          fill: '#fff',
          border: '#eee',
          locked: true,
        }),
      );
    }
  });
  return f;
}

function kitMakeFindBtn() {
  let btn = part({ name: 'findBtn', w: 130, h: 22, text: 'find', fill: '#6a6a6a', textColor: 'white', radius: 4, locked: true });
  btn.define('onClick', function () {
    kitFind();
  });
  return btn;
}

function kitMakeBin() {
  /**
   * A column of prototypes. Dragging one out stamps an instance (isBin); dropping a
   * finished part in keeps it as a new prototype. The "wires" button toggles drawing.
   */
  let bin = part({
    name: 'bin',
    x: 620,
    y: 16,
    w: 150,
    h: 280,
    fill: '#ece8df',
    border: '#b8ad96',
    radius: 8,
    layout: 'column',
    gap: 8,
    padding: 10,
    acceptsDrops: true,
    isBin: true,
    fit: true,
  });
  bin.add(part({ look: 'none', text: 'Parts Bin', w: 130, h: 16, align: 'left', fontSize: 12, textColor: '#555', locked: true }));
  let wiresBtn = bin.add(
    part({ name: 'wiresBtn', w: 130, h: 22, text: 'hide wires', fill: '#4a7bd0', textColor: 'white', radius: 4, locked: true }),
  );
  wiresBtn.define('onClick', function () {
    $kit.showWires = $kit.showWires === false;
    this.set('text', $kit.showWires === false ? 'show wires' : 'hide wires');
    this.set('fill', $kit.showWires === false ? '#ccc' : '#4a7bd0');
    this.set('textColor', $kit.showWires === false ? '#222' : 'white');
  });
  bin.add(kitMakeFindBtn());
  bin.add(part({ name: 'box', w: 48, h: 32, fill: '#d8d4cc', border: '#999', radius: 4 }));
  bin.add(part({ name: 'oval', look: 'oval', w: 40, h: 40, fill: '#8eb4e0' }));
  bin.add(part({ name: 'protoButton', w: 88, h: 28, text: 'button', fill: '#4a7bd0', textColor: 'white', radius: 6 }));
  return bin;
}

function kitLabel(text, x, y) {
  return part({ look: 'none', text: text, x: x, y: y, w: 200, h: 20, align: 'left', fontSize: 13, textColor: '#555' });
}

function kitExamples(world) {
  /**
   * A few things built from parts, to play with and take apart. Each is a few
   * parts, a slot or two, and at most a couple of one-line scripts or wires.
   */
  // Counter: a button wired to a number — two world parts, so you can drag them apart
  // (same as slider and dial) and see the wire between them.
  world.add(kitLabel('Counter: click +1', 30, 20));
  let num = world.add(part({ name: 'number', x: 30, y: 44, w: 80, h: 44, count: 0, text: '0', fontSize: 20, fill: 'white', border: '#999', radius: 6 }));
  num.define('increment', function () { this.set('count', this.get('count') + 1); });
  num.define('onCount', function (n) { this.set('text', '' + n); });
  let plus = world.add(part({ name: 'button', x: 170, y: 44, w: 60, h: 44, text: '+1', fill: '#4a7bd0', textColor: 'white', radius: 8 }));
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
  world.add(kitLabel('Clock: onTick script, stepEvery 16', 30, 240));
  let clock = world.add(part({ name: 'clock', look: 'oval', x: 60, y: 270, w: 140, h: 140, fill: 'white', border: '#555', borderWidth: 3, stepEvery: 16 }));
  clock.add(part({ name: 'hourHand', x: 70, y: 67, w: 40, h: 6, pivotX: 0, fill: '#333', radius: 3 }));
  clock.add(part({ name: 'minuteHand', x: 70, y: 68, w: 58, h: 4, pivotX: 0, fill: '#333', radius: 2 }));
  clock.add(part({ name: 'secondHand', x: 70, y: 69, w: 62, h: 2, pivotX: 0, fill: '#c33' }));
  clock.define('onTick', function () {
    let cx = this.num('w', 0) / 2;
    let cy = this.num('h', 0) / 2;
    this.find('hourHand').setLocal('x', cx);
    this.find('hourHand').setLocal('y', cy - this.find('hourHand').num('h', 0) / 2);
    this.find('minuteHand').setLocal('x', cx);
    this.find('minuteHand').setLocal('y', cy - this.find('minuteHand').num('h', 0) / 2);
    this.find('secondHand').setLocal('x', cx);
    this.find('secondHand').setLocal('y', cy - this.find('secondHand').num('h', 0) / 2);
    let d = new Date();
    let s = d.getSeconds();
    let m = d.getMinutes() + s / 60;
    let h = (d.getHours() % 12) + m / 60;
    this.find('secondHand').setLocal('rotation', s * 6 - 90);
    this.find('minuteHand').setLocal('rotation', m * 6 - 90);
    this.find('hourHand').setLocal('rotation', h * 30 - 90);
  });

  world.add(kitLabel('⌘-click a part for its halo; click the name to inspect', 300, 20));
  world.add(kitLabel('drag from the bin to stamp a copy; Option-click carries', 300, 40));

  // Shelf: a row container. Drag things onto it and they line up.
  world.add(kitLabel('Shelf: drop parts here (layout: row)', 300, 240));
  let shelf = world.add(part({ name: 'shelf', x: 300, y: 270, w: 300, h: 70, fill: '#e6dfd0', border: '#b8ad96', radius: 6, layout: 'row', gap: 8, padding: 10, acceptsDrops: true, fit: true }));
  shelf.add(part({ name: 'red', x: 0, y: 0, w: 40, h: 40, fill: '#d05a4a', radius: 4 }));
  shelf.add(part({ name: 'green', look: 'oval', x: 0, y: 0, w: 40, h: 40, fill: '#5aa05a' }));
}

// Live stamp — eval `KITDEFS_WRITTEN_ON` to confirm this build is loaded.
let KITDEFS_WRITTEN_ON = '2026-10-07 11:45 PDT';
//written on 2026-10-07 11:45 PDT
