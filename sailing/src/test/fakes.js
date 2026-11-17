// Just enough of the stage for sailing's play parts, with no stage: one
// shared doc and presence, and an api per view (session) that reads and
// writes them as STAGE.md says. Time is Date.now (vitest's fake timers) and
// each view's loops run when the test ticks the world. A peer's held pose
// shows at once (no playout delay: shownAt is now), which is all these
// tests need. scene().parents is a Map, resolved as the stage resolves it (a
// missing parent, or a group, is none).
//
// The doc's clock (api.clock, scene/TOOLS.md §7) as the stage keeps it: the
// first view here, drawing and with a process computes it (the doc's
// "clock" claim) and steps its processes on a grid of 1/60 s of world time;
// every view reads the same t (a follower's lag is the stage's business);
// it checkpoints on pause, on letting go (hidden, leaving, stopping) and
// every 30 s, stamping what each save moved (`saved`). Holds are ranked as
// the stage ranks them: a person's before a yielding one, then the first.
//
//   const w = fakeWorld(doc, { content });
//   const a = w.join("A");  const b = w.join("B");
//   w.tick(1 / 60, 120);  w.leave("A");  // a bye: abort, claims and holds let go
//   w.hide("A");  // its tab hidden: its visibilitychange listeners hear it

import { vi } from "vitest";
import { createSurface } from "./surface.js";
import { seaWavesFor } from "../sea.js";
import { windOffer } from "./weather.js";

/**
 * An empty scene doc, as the scene datatype's init writes one: every map a
 * scene has, made with the doc. The source of truth is scene/src/datatype.js
 * (SceneDatatype.init and DEFAULT_VIEW); packages don't import each other,
 * so this is a copy of its shape. Every test that needs a scene doc starts
 * from this one.
 */
export function emptyScene() {
  return {
    title: "Untitled scene",
    objects: {},
    order: [],
    dimensions: {},
    traits: {},
    assets: {},
    packages: [],
    clock: { running: true, t: 0 },
    view: { units: "m", grid: true, axes: true, bounds: false, snap: true, start: { body: "edit" } },
  };
}

/** T · R(XYZ) · S as a column-major 4×4 (scene/src/transform.js). */
export function composeMatrix(t) {
  const p = t?.position ?? [0, 0, 0];
  const r = t?.rotation ?? [0, 0, 0];
  const s = t?.scale ?? 1;
  const a = Math.cos(r[0]), b = Math.sin(r[0]);
  const c = Math.cos(r[1]), d = Math.sin(r[1]);
  const e = Math.cos(r[2]), f = Math.sin(r[2]);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m11 = c * e, m12 = -c * f, m13 = d;
  const m21 = af + be * d, m22 = ae - bf * d, m23 = -b * c;
  const m31 = bf - ae * d, m32 = be + af * d, m33 = a * c;
  return [m11 * s, m21 * s, m31 * s, 0, m12 * s, m22 * s, m32 * s, 0, m13 * s, m23 * s, m33 * s, 0, p[0], p[1], p[2], 1];
}

/** Do two doc transforms say the same thing? */
function sameTransform(a, b) {
  if (!a || !b) return false;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= 1e-6;
  return [0, 1, 2].every((i) => near(a.position?.[i], b.position?.[i]) && near(a.rotation?.[i], b.rotation?.[i])) && near(a.scale ?? 1, b.scale ?? 1);
}

/** a · b, column-major. */
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The shape of three.js the play parts ask for. */
export function fakeThree() {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      Object.assign(this, { x, y, z });
    }
    set(x, y, z) {
      Object.assign(this, { x, y, z });
      return this;
    }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      return this.set(this.x / l, this.y / l, this.z / l);
    }
  }
  class Vector4 {
    constructor(x = 0, y = 0, z = 0, w = 0) {
      Object.assign(this, { x, y, z, w });
    }
    set(x, y, z, w) {
      Object.assign(this, { x, y, z, w });
      return this;
    }
  }
  class Color {
    constructor(v) {
      this.v = v;
    }
    set(v) {
      this.v = v;
      return this;
    }
    setRGB(r, g, b) {
      this.v = [r, g, b];
      return this;
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }
  class BufferGeometry {
    attributes = {};
    setAttribute(name, a) {
      this.attributes[name] = a;
    }
    setIndex(i) {
      this.index = i;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class ShaderMaterial {
    constructor(o) {
      Object.assign(this, o);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector3();
      this.userData = {};
    }
    removeFromParent() {}
  }
  const clone = (u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v.value }]));
  // the scene graph looks.js draws its lines with
  class Object3D {
    constructor() {
      this.children = [];
      this.position = new Vector3();
      this.scale = new Vector3(1, 1, 1);
      this.visible = true;
      this.userData = {};
    }
    add(...o) {
      this.children.push(...o);
    }
    remove(o) {
      const i = this.children.indexOf(o);
      if (i >= 0) this.children.splice(i, 1);
    }
  }
  class Group extends Object3D {}
  class Line extends Object3D {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
    }
  }
  class LineSegments extends Line {}
  class LineBasicMaterial {
    constructor(o) {
      Object.assign(this, o);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class MeshStandardMaterial extends LineBasicMaterial {}
  return {
    Object3D,
    Group,
    Line,
    LineSegments,
    LineBasicMaterial,
    MeshStandardMaterial,
    Vector2,
    Vector3,
    Vector4,
    Color,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Mesh,
    UniformsLib: { fog: { fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogColor: { value: new Color("#fff") } } },
    UniformsUtils: { clone },
  };
}

/** A content root as the stage shows a GLB: a node with position, rotation, scale, and named children. */
export function fakeNode(children = {}) {
  const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { Object.assign(this, { x: a, y: b, z: c }); return this; } });
  return {
    position: v3(),
    rotation: v3(),
    scale: v3(1, 1, 1),
    visible: true,
    children,
    getObjectByName: (name) => children[name] ?? null,
  };
}

/**
 * A shared doc and presence, and views on them.
 * @param {object} doc  the scene doc ({ objects, order, traits, view })
 * @param {{ content?: { [id]: object } }} [o]  what api.content(id) answers
 */
export function fakeWorld(doc, { content = {} } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const views = new Map(); // session → view
  const holds = new Map(); // id → { session, transform, landed? }
  const released = []; // every pose.release: { session, id, landed }
  let version = 0;
  let snapshot = null;
  const claims = []; // { session, id, kind, onLost }
  let now = null; // the frame clock (ms), as the loops get it

  // ─── the doc's clock ───
  const STEP = 1 / 60;
  const clock = { t: Number(doc.clock?.t) || 0, computer: null, nextSave: Infinity };
  const running = () => doc.clock?.running !== false;
  const kept = (v) => v.processes.filter((p) => !p.replicated);
  // the clock's fields, one by one (the stage never writes the map whole)
  const setClock = (d, fields) => {
    if (!d.clock) d.clock = { running: true, t: 0 };
    Object.assign(d.clock, fields);
  };
  const tkey = (t) => JSON.stringify([t?.position, t?.rotation, t?.scale ?? 1]);
  function checkpoint(list, write = null) {
    change((d) => {
      setClock(d, { ...write, t: clock.t });
      const before = new Map(Object.entries(d.objects ?? {}).map(([id, o]) => [id, tkey(o.transform)]));
      for (const p of list) p.save?.(d);
      for (const [id, o] of Object.entries(d.objects ?? {})) if (before.has(id) && before.get(id) !== tkey(o.transform)) o.saved = clock.t;
    });
    clock.nextSave = Date.now() + 30_000;
  }
  function stopComputing(v, { save }) {
    if (clock.computer !== v) return;
    if (save) checkpoint(v.processes);
    clock.computer = null;
    for (const p of kept(v)) p.stop?.();
    if (doc.claims?.clock?.session === v.session) change((d) => delete d.claims.clock);
  }
  function clockFrame(dt) {
    const c = clock.computer;
    // the claim taken from us by someone else: lost, nothing saved
    if (c && doc.claims?.clock?.session !== c.session) {
      clock.computer = null;
      for (const p of kept(c)) p.stop?.();
    }
    if (clock.computer && (!running() || !clock.computer.processes.length)) stopComputing(clock.computer, { save: true });
    if (!clock.computer && running()) {
      const held = doc.claims?.clock?.session;
      const next = held && present(held) ? null : [...views.values()].find((v) => v.here && !v.hidden && v.processes.length);
      if (next) {
        clock.t = Math.max(clock.t, Number(doc.clock?.t) || 0);
        change((d) => {
          if (!d.claims) d.claims = {};
          d.claims.clock = { viewer: next.viewer, session: next.session };
        });
        clock.computer = next;
        clock.nextSave = Date.now() + 30_000;
        for (const p of kept(next)) {
          p.k = Math.floor(clock.t / STEP + 1e-9);
          p.start?.(clock.t);
        }
      }
    }
    if (clock.computer && running()) {
      clock.t += Math.min(0.25, dt);
      const k1 = Math.floor(clock.t / STEP + 1e-9);
      for (const p of [...clock.computer.processes]) while (p.k < k1 && clock.computer?.processes.includes(p)) p.step(STEP, ++p.k * STEP);
      if (Date.now() >= clock.nextSave) checkpoint(clock.computer.processes);
    }
  }

  const holderOf = (id) => (id == null ? doc : doc.objects?.[id]);
  const present = (s) => !!views.get(s)?.here;

  function scene() {
    if (snapshot?.version === version) return snapshot.value;
    const objects = doc.objects ?? {};
    const parents = new Map();
    for (const [id, o] of Object.entries(objects)) {
      const p = o.parent;
      parents.set(id, typeof p === "string" && p !== id && objects[p] && objects[p].kind !== "group" ? p : null);
    }
    const value = Object.freeze({ d: doc, objects, ids: doc.order ?? Object.keys(objects), parents, traits: doc.traits ?? {} });
    snapshot = { version, value };
    return value;
  }

  /** After a change: a claim whose field now names someone else is lost (once), by a view that's still here to hear it. */
  function settle() {
    for (const c of [...claims]) {
      const f = holderOf(c.id)?.claims?.[c.kind];
      if (f && f.session !== c.session && present(c.session)) {
        claims.splice(claims.indexOf(c), 1);
        c.onLost?.();
      }
    }
  }

  function change(fn) {
    fn(doc);
    version++;
    settle();
    // a landed hold goes once the doc shows where it landed
    for (const [id, h] of [...holds]) if (h.landed && sameTransform(doc.objects?.[id]?.transform, h.transform)) holds.delete(id);
  }

  function worldOf(id) {
    const o = doc.objects?.[id];
    if (!o) return null;
    const own = composeMatrix(holds.get(id)?.transform ?? o.transform);
    const p = scene().parents.get(id);
    return p ? multiply(worldOf(p), own) : own;
  }

  // The world's water and ambients, as the water package and the stage give
  // them to a doc that is its own world (one doc here: always the outermost):
  // its open water (the lowest id of its objects with the water trait and no
  // size) with the waves its sea makes under its weather's wind, evaluated by
  // water's evaluator itself (a copy, ./surface.js), as water's reader is for
  // the outermost at level 0; the golden file pins the copy. No bounded
  // water here: what reads it is the water package's to prove.
  const memo = new Map();
  const memoOf = (key, make) => {
    if (!memo.has(key)) memo.set(key, make());
    return memo.get(key);
  };
  function openWater() {
    const ids = Object.keys(doc.objects ?? {}).sort();
    const id = ids.find((k) => doc.objects[k]?.traits?.water && doc.objects[k].traits.water.size == null);
    return id ? { id, o: doc.objects[id] } : null;
  }
  function waterReader() {
    const w = openWater();
    if (!w) return null;
    const wind = windOffer(doc.traits?.weather);
    const sea = w.o.traits["sailing.sea"];
    const waves = sea ? seaWavesFor(sea, wind) : { components: [], look: { seed: 1, stats: {} } };
    return memoOf(`water:${JSON.stringify(waves)}`, () => Object.freeze({ ...createSurface(waves.components), body: null, level: 0, seed: waves.look.seed, stats: waves.look.stats }));
  }
  const contribution = Object.freeze({ at: () => waterReader() });
  function ambients() {
    // the weather's: its wind (a stand-in for the weather package's offer, ./weather.js); no atmosphere, which nothing here reads
    const out = doc.traits?.weather ? { wind: windOffer(doc.traits.weather) } : {};
    if (openWater()) out.water = { v: 2, level: 0, components: waterReader().components };
    for (const k of Object.keys(out)) out[k] = memoOf(`ambient:${k}:${JSON.stringify(out[k])}`, () => structuredClone(out[k]));
    return out;
  }

  function join(session, { viewer = `viewer-${session}` } = {}) {
    const view = { session, viewer, here: true, keys: {}, at: Date.now(), loops: [], listeners: [], abort: new AbortController(), rate: null, processes: [] };
    views.set(session, view);
    const ext = "sailing";
    const api = {
      id: ext,
      session,
      viewer,
      THREE: fakeThree(),
      signal: view.abort.signal,
      doc: () => doc,
      change,
      scene,
      claim(id, kind, { onLost } = {}) {
        const f = holderOf(id)?.claims?.[kind];
        if (f && f.session !== session && present(f.session)) return null;
        change((d) => {
          const h = id == null ? d : d.objects[id];
          if (!h.claims) h.claims = {};
          h.claims[kind] = { viewer, session };
        });
        const entry = { session, id, kind, onLost };
        claims.push(entry);
        return () => {
          const i = claims.indexOf(entry);
          if (i >= 0) claims.splice(i, 1);
          if (holderOf(id)?.claims?.[kind]?.session === session) change(() => delete holderOf(id).claims[kind]);
        };
      },
      claimedBy(id, kind) {
        const f = holderOf(id)?.claims?.[kind];
        if (!f) return null;
        if (f.session === session) return { viewer: f.viewer, session, mine: true };
        return present(f.session) ? { viewer: f.viewer, session: f.session, mine: false } : null;
      },
      presence: {
        set(key, value) {
          const mine = { ...view.keys[ext] };
          if (value === undefined) delete mine[key];
          else mine[key] = value;
          view.keys = { ...view.keys, [ext]: mine };
          view.at = Date.now();
        },
        get() {
          const out = {};
          for (const [s, v] of views) if (s !== session && v.here) out[s] = { viewer: v.viewer, at: v.at, keys: v.keys };
          return out;
        },
        rate(hz) {
          view.rate = hz;
        },
        shownAt: (s) => (present(s) ? Date.now() : null),
        watch: () => () => {},
      },
      clock: {
        // the stage's time (scene/src/stage/time.js): here the wall vitest's fake timers move
        now: () => Date.now(),
        after(ms, fn) {
          const h = setTimeout(fn, ms);
          return () => clearTimeout(h);
        },
        t: () => clock.t,
        running,
        computer: () => api.claimedBy(null, "clock"),
        pause() {
          if (!running()) return;
          const write = { running: false, by: viewer };
          if (clock.computer === view) {
            checkpoint(view.processes, write);
            clock.computer = null;
            for (const p of kept(view)) p.stop?.();
            change((d) => delete d.claims.clock);
          } else change((d) => setClock(d, { ...write, t: clock.t }));
        },
        resume() {
          if (!running()) change((d) => setClock(d, { running: true, t: clock.t, by: viewer }));
        },
        process(spec) {
          const p = { ...spec, k: Math.floor(clock.t / STEP + 1e-9) };
          view.processes.push(p);
          if (clock.computer === view && !p.replicated) p.start?.(clock.t);
          const remove = () => {
            if (!view.processes.includes(p)) return;
            if (clock.computer === view && !p.replicated) {
              checkpoint([p]);
              p.stop?.();
            }
            view.processes.splice(view.processes.indexOf(p), 1);
          };
          // the extension stopping takes its processes with it (saved first, where this view computes them)
          view.abort.signal.addEventListener("abort", remove);
          return remove;
        },
      },
      pose: {
        hold(id, transform, { yields = false } = {}) {
          const cur = holds.get(id);
          // a person's before a yielding one, then the first (scene's holds.js)
          if (cur && !cur.landed && cur.session !== session && !(cur.yields && !yields)) return false;
          holds.set(id, { session, transform: structuredClone(transform), at: Date.now(), yields });
          return true;
        },
        release(id, { landed = false } = {}) {
          released.push({ session, id, landed });
          const h = holds.get(id);
          if (h?.session !== session) return;
          if (landed) h.landed = true;
          else holds.delete(id);
        },
      },
      heldBy(id, { yields = false } = {}) {
        const h = holds.get(id);
        if (!h || h.landed || h.session === session) return null;
        return !h.yields || yields ? h.session : null;
      },
      listen(target, type, fn) {
        view.listeners.push({ target, type, fn });
      },
      worldOf,
      // conventions in this stage: the water package's answer to which water a point is in
      collect: (name) => (name === "water" && openWater() ? [{ id: "water", value: contribution }] : []),
      // the world's ambients: this doc's own, it being the outermost
      ambient: (name) => {
        const value = ambients()[name];
        return value === undefined ? null : Object.freeze({ value, mine: true, frame: Object.freeze({ matrix: null }), clock: Object.freeze({ t: clock.t, running: running() }) });
      },
      content: (id) => content[id] ?? null,
      loop(fn) {
        view.loops.push(fn);
        return () => {
          const i = view.loops.indexOf(fn);
          if (i >= 0) view.loops.splice(i, 1);
        };
      },
      world: () => ({ children: [], add(o) { this.children.push(o); } }),
      // the camera as the stage hands it out, in the stage's frame
      camera: { get: () => ({ position: [0, 2, 0], target: [0, 0, -1], fov: 50, up: [0, 1, 0] }) },
      invalidate() {},
      schedule: (fn) => fn(),
    };
    view.api = api;
    return api;
  }

  return {
    doc,
    holds,
    released,
    clock,
    join,
    scene,
    change,
    view: (s) => views.get(s),
    /** Run every view's loops, `n` frames of `dt` seconds. */
    tick(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) {
        // the frame clock keeps its fractions (as rAF's does); Date.now is whole ms
        now = (now ?? Date.now()) + dt * 1000;
        vi.setSystemTime(Math.round(now));
        for (const [id, h] of [...holds]) if (h.landed && Date.now() - h.at > 3000) holds.delete(id);
        clockFrame(dt);
        // a hidden tab gets no frames
        for (const v of views.values()) if (v.here && !v.hidden) for (const fn of [...v.loops]) fn(dt, now);
      }
    },
    /**
     * A view goes. With a bye (the default) it stops as the stage stops an
     * extension: abort, its claims and holds let go; without one (a crash)
     * it just stops being heard, and its holds stay shown.
     */
    leave(session, { bye = true } = {}) {
      const v = views.get(session);
      if (bye) {
        // the stage stops: world time first (a checkpoint, the claim let go), then the extensions
        stopComputing(v, { save: true });
        v.abort.abort();
        v.processes.length = 0;
        for (const c of claims.filter((c) => c.session === session)) {
          claims.splice(claims.indexOf(c), 1);
          if (holderOf(c.id)?.claims?.[c.kind]?.session === session) change(() => delete holderOf(c.id).claims[c.kind]);
        }
        for (const [id, h] of [...holds]) if (h.session === session) holds.delete(id);
      }
      v.here = false;
      if (!bye && clock.computer === v) clock.computer = null; // a crash: no checkpoint; presence drops it
    },
    /** A view's tab is hidden (or shown again): what its visibilitychange listeners hear. */
    hide(session, hidden = true) {
      const v = views.get(session);
      v.hidden = hidden;
      // hidden, it can't compute: a checkpoint, and the claim let go
      if (hidden) stopComputing(v, { save: true });
      const was = Object.getOwnPropertyDescriptor(document, "visibilityState");
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
      try {
        for (const l of v.listeners) if (l.type === "visibilitychange") l.fn();
      } finally {
        if (was) Object.defineProperty(document, "visibilityState", was);
        else delete document.visibilityState;
      }
    },
    done() {
      vi.useRealTimers();
    },
  };
}

/**
 * A drop context (STAGE.md, "Drops" and "Parts"), as a template or a part
 * gets one: the doc, its snapshot (parents resolved), change, newId, a repo
 * that makes file docs, ctx.file (the scene's one doc per key, remembered at
 * doc.assets[key]) and notify. What it made is in `calls`.
 *   const { ctx, calls } = fakeDrop(doc);
 * @param {object} doc
 * @param {{ content?: { [id]: object } }} [o]
 */
export function fakeDrop(doc, { content } = {}) {
  const calls = { created: [], notices: [], made: [] };
  let n = 0;
  const repo = {
    async create2(d) {
      calls.created.push(d);
      return { url: `automerge:file${calls.created.length}` };
    },
  };
  const scene = () => {
    const objects = doc.objects ?? {};
    const parents = new Map();
    for (const [id, o] of Object.entries(objects)) {
      const p = o.parent;
      parents.set(id, typeof p === "string" && p !== id && objects[p] && objects[p].kind !== "group" ? p : null);
    }
    return { d: doc, objects, ids: doc.order ?? Object.keys(objects), parents, traits: doc.traits ?? {} };
  };
  const ctx = {
    repo,
    doc: () => doc,
    scene,
    change: (fn) => fn(doc),
    newId: (prefix) => `${prefix}${++n}`,
    notify: (text, kind) => calls.notices.push({ text, kind }),
    ...(content ? { content: (id) => content[id] ?? null } : {}),
    file: async (key, make) => {
      const have = doc.assets?.[key];
      if (have?.url) return { url: have.url, hint: have.hint ?? null };
      const f = await make();
      calls.made.push({ key, ...f });
      const made = await repo.create2({ "@patchwork": { type: "file" }, name: f.name, extension: f.extension, mimeType: f.mimeType, content: f.bytes });
      doc.assets[key] = { url: made.url, ...(f.hint ? { hint: f.hint } : {}) };
      return { url: made.url, hint: f.hint ?? null };
    },
  };
  return { ctx, calls };
}

/**
 * A three.js-shaped mesh node for api.content(id).root: triangles (9 numbers
 * each) as a non-indexed position attribute, at rest (identity transform),
 * with children (an array, as three's are).
 */
export function meshNode(triangles, children = []) {
  const array = Float32Array.from(triangles);
  return {
    isMesh: true,
    visible: true,
    geometry: { attributes: { position: { array, itemSize: 3, count: array.length / 3 } }, index: null },
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    children,
  };
}
