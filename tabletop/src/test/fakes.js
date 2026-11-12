// Just enough of the stage for the table extension, with no stage: one shared
// doc and presence, and an api per view (session) that reads and writes them
// as scene/STAGE.md says. Copied and trimmed from sailing/src/test/fakes.js
// (packages stand alone: never import another package's tests), with what a
// table needs added: a repo, the registry, an overlay, sends between views,
// labels and notices per view, claims with the 6 s grace, and ops.setTransform.
//
//   const w = fakeWorld(doc, { content, repo, registries });
//   const a = w.join("A", { viewer: "alice" });   // a's api
//   w.attach("A", Extension.create(a));           // so sends and flush reach it
//   w.flush();                                    // update() every attached view
//   w.tick(1 / 60, 30);  w.leave("A");            // frames; a bye
//
// Claims: a claim names { viewer, session }. One whose session is a view here
// is live; one whose session left (a bye) has lapsed at once; one whose
// session this world has never seen is in its grace period while `w.grace`
// is true (as for the first 6 s after a view first reads it), and lapsed once
// the test sets it false.
//
// Time is Date.now (vitest's fake timers), and each view's loops run when the
// test ticks the world. A peer's held pose shows at once (worldOf is what's
// drawn: holds included). camera.ride is recorded in view.rides. scene() is a
// snapshot like the stage's: { d, objects, ids, parents, traits, world(id),
// toLocal(id, p) }, its matrices column-major, Euler XYZ.

import { vi } from "vitest";

/** T · R(XYZ) · S as a column-major 4×4 (scene/src/transform.js). */
export function composeMatrix(t) {
  const p = t?.position ?? [0, 0, 0];
  const r = t?.rotation ?? [0, 0, 0];
  const s = Number(t?.scale) || 1;
  const a = Math.cos(r[0]), b = Math.sin(r[0]);
  const c = Math.cos(r[1]), d = Math.sin(r[1]);
  const e = Math.cos(r[2]), f = Math.sin(r[2]);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m11 = c * e, m12 = -c * f, m13 = d;
  const m21 = af + be * d, m22 = ae - bf * d, m23 = -b * c;
  const m31 = bf - ae * d, m32 = be + af * d, m33 = a * c;
  return [m11 * s, m21 * s, m31 * s, 0, m12 * s, m22 * s, m32 * s, 0, m13 * s, m23 * s, m33 * s, 0, p[0], p[1], p[2], 1];
}

/** a · b, column-major. */
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The inverse of a rotation · uniform scale + translation. */
function invertRigid(m) {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const rt = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1].map((v, i) => (i % 4 === 3 || i >= 12 ? v : v / s2));
  const t = [m[12], m[13], m[14]];
  for (let r = 0; r < 3; r++) rt[12 + r] = -(rt[r] * t[0] + rt[4 + r] * t[1] + rt[8 + r] * t[2]);
  return rt;
}

/** Do two doc transforms say the same thing? */
function sameTransform(a, b) {
  if (!a || !b) return false;
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= 1e-6;
  return [0, 1, 2].every((i) => near(a.position?.[i], b.position?.[i]) && near(a.rotation?.[i], b.rotation?.[i])) && near(a.scale ?? 1, b.scale ?? 1);
}

/**
 * The one planner a table uses, as scene/src/ops.js has it: a whole local
 * transform, written number by number (so a peer's unrelated field lands);
 * null when the object isn't there.
 */
export const ops = {
  setTransform(snapshot, id, t) {
    if (!snapshot?.objects?.[id]) return null;
    return (d) => {
      const o = d.objects?.[id];
      if (!o) return;
      if (!o.transform) o.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
      for (const k of ["position", "rotation"]) {
        if (!Array.isArray(o.transform[k])) o.transform[k] = [0, 0, 0];
        for (let i = 0; i < 3; i++) if (o.transform[k][i] !== t[k][i]) o.transform[k][i] = t[k][i];
      }
      if (o.transform.scale !== (t.scale ?? 1)) o.transform.scale = t.scale ?? 1;
    };
  },
};

/** An in-memory repo with real-looking urls, whose handles emit "change". */
export function fakeRepo() {
  const handles = new Map();
  let n = 0;
  const make = (url, doc) => {
    const listeners = new Set();
    const h = {
      url,
      doc: () => doc,
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        for (const l of [...listeners]) l();
      },
      on: (ev, fn) => ev === "change" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
    };
    handles.set(url, h);
    return h;
  };
  const next = () => `automerge:2Doc${String(n++).padStart(4, "x")}abcdefghijkmnopqr`;
  return {
    handles,
    add: (doc, url = next()) => make(url, structuredClone(doc)),
    async create2(doc) {
      return make(next(), structuredClone(doc));
    },
    async find(url) {
      const h = handles.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
  };
}

/**
 * A shared doc and presence, and views on them.
 * @param {object} doc  the scene doc ({ objects, order, traits, view, claims? })
 * @param {{ content?: { [id]: object }, repo?: object, registries?: { [type]: object } }} [o]
 *   content: what api.content(id) answers; registries: what api.registry(type) answers
 */
export function fakeWorld(doc, { content = {}, repo = fakeRepo(), registries = {} } = {}) {
  // a scene as its datatype makes it: `assets` comes with the doc (scene/STAGE.md, "Shared maps")
  if (!doc.assets) doc.assets = {};
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const views = new Map(); // session → view
  const gone = new Set(); // sessions that said bye
  const holds = new Map(); // id → { session, transform, landed? }
  const released = []; // every pose.release: { session, id, landed }
  const sent = []; // every send: { session, viewer, type, data }
  const claims = []; // { session, id, kind, onLost }
  let version = 0;
  let snapshot = null;
  let now = null; // the frame clock (ms), as the loops get it
  const world = {
    doc,
    repo,
    holds,
    released,
    sent,
    /** Whether a claim by a session never seen here still counts (its first 6 s). */
    grace: true,
  };

  const holderOf = (id) => (id == null ? doc : doc.objects?.[id]);
  const present = (s) => !!views.get(s)?.here;
  /** Is the session holding this claim field still counted, from `session`'s view? */
  const live = (f, session) => f.session === session || present(f.session) || (!gone.has(f.session) && !views.has(f.session) && world.grace);

  function scene() {
    if (snapshot?.version === version) return snapshot.value;
    const objects = doc.objects ?? {};
    const parents = new Map();
    for (const [id, o] of Object.entries(objects)) {
      const p = o.parent;
      parents.set(id, typeof p === "string" && p !== id && objects[p] && objects[p].kind !== "group" ? p : null);
    }
    const worldM = (id) => {
      const o = objects[id];
      if (!o) return composeMatrix();
      const own = composeMatrix(o.transform);
      const p = parents.get(id);
      return p ? multiply(worldM(p), own) : own;
    };
    const toLocal = (id, p) => {
      const inv = invertRigid(worldM(id));
      return [0, 1, 2].map((r) => inv[r] * p[0] + inv[4 + r] * p[1] + inv[8 + r] * p[2] + inv[12 + r]);
    };
    const value = Object.freeze({ d: doc, objects, ids: doc.order ?? Object.keys(objects), parents, traits: doc.traits ?? {}, world: worldM, toLocal });
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
    if (typeof fn !== "function") return;
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

  const presenceChanged = (except) => {
    for (const [s, v] of views) if (s !== except && v.here) for (const fn of [...v.watchers]) fn();
  };

  function join(session, { viewer = `viewer-${session}`, local = {} } = {}) {
    let localState = Object.freeze({ activities: Object.freeze({ current: "play", available: ["play", "edit"] }), ...local });
    const view = {
      session,
      viewer,
      here: true,
      keys: {},
      at: Date.now(),
      loops: [],
      listeners: [],
      watchers: [],
      notices: [], // { text, kind }
      labels: [], // the last labels().set(items)
      instance: null,
      seen: null, // the snapshot last flushed to its instance
      seenLocal: null,
      abort: new AbortController(),
      camera: null,
      rides: [],
      collected: null, // { [field]: value }: what api.collect finds on the other extensions
    };
    views.set(session, view);
    gone.delete(session);
    const ext = "tabletop";
    const api = {
      id: ext,
      session,
      viewer,
      repo,
      signal: view.abort.signal,
      doc: () => doc,
      change,
      scene,
      newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
      registry: async (type) => registries[type] ?? null,
      local: {
        get: () => localState,
        swap(fn) {
          localState = Object.freeze(fn(localState));
        },
        watch: () => () => {},
      },
      claim(id, kind, { onLost } = {}) {
        const f = holderOf(id)?.claims?.[kind];
        if (f && f.session !== session && live(f, session)) return null;
        const have = claims.find((c) => c.session === session && c.id === id && c.kind === kind);
        if (have) return have.release;
        change((d) => {
          const h = id == null ? d : d.objects[id];
          if (!h.claims) h.claims = {};
          h.claims[kind] = { viewer, session };
        });
        const entry = { session, id, kind, onLost };
        entry.release = () => {
          const i = claims.indexOf(entry);
          if (i >= 0) claims.splice(i, 1);
          if (holderOf(id)?.claims?.[kind]?.session === session) change(() => delete holderOf(id).claims[kind]);
        };
        claims.push(entry);
        return entry.release;
      },
      claimedBy(id, kind) {
        const f = holderOf(id)?.claims?.[kind];
        if (!f) return null;
        if (f.session === session) return { viewer: f.viewer, session, mine: true };
        return live(f, session) ? { viewer: f.viewer, session: f.session, mine: false } : null;
      },
      presence: {
        set(key, value) {
          const mine = { ...view.keys[ext] };
          if (value === undefined) delete mine[key];
          else mine[key] = value;
          view.keys = { ...view.keys, [ext]: mine };
          view.at = Date.now();
          presenceChanged(session);
        },
        get() {
          const out = {};
          for (const [s, v] of views) if (s !== session && v.here) out[s] = { viewer: v.viewer, at: v.at, keys: v.keys };
          return out;
        },
        rate() {},
        shownAt: (s) => (present(s) ? Date.now() : null),
        watch(fn) {
          view.watchers.push(fn);
          return () => {
            const i = view.watchers.indexOf(fn);
            if (i >= 0) view.watchers.splice(i, 1);
          };
        },
      },
      send(type, data) {
        sent.push({ session, viewer, type, data: structuredClone(data) });
        for (const [s, v] of views) if (s !== session && v.here) v.instance?.receive?.(type, structuredClone(data), { session, viewer });
      },
      notify: (text, kind) => view.notices.push({ text, kind }),
      labels: () => ({ set: (items) => (view.labels = items) }),
      overlay: () => (view.overlay = document.createElement("div")),
      style() {},
      cursor() {},
      box: () => null,
      camera: {
        set: (c) => (view.camera = c),
        get: () => view.camera,
        // rides asked for, the live ones in order (the stage applies the latest)
        ride(id, opts) {
          const r = { id, opts: opts ?? null };
          view.rides.push(r);
          return () => {
            const i = view.rides.indexOf(r);
            if (i >= 0) view.rides.splice(i, 1);
          };
        },
        object: { position: { x: 0, y: 1, z: 1 } },
      },
      pose: {
        hold(id, transform) {
          holds.set(id, { session, transform: structuredClone(transform), at: Date.now() });
        },
        release(id, { landed = false } = {}) {
          released.push({ session, id, landed });
          const h = holds.get(id);
          if (h?.session !== session) return;
          if (landed) h.landed = true;
          else holds.delete(id);
        },
      },
      heldBy(id) {
        const h = holds.get(id);
        return h && !h.landed && h.session !== session ? h.session : null;
      },
      listen(target, type, fn) {
        view.listeners.push({ target, type, fn });
      },
      worldOf,
      ops,
      content: (id) => content[id] ?? null,
      // the other extensions' fields (STAGE.md api.collect): what a test puts in view.collected, as one extension's
      collect: (name) => (view.collected?.[name] === undefined ? [] : [{ id: "other", value: view.collected[name] }]),
      loop(fn) {
        view.loops.push(fn);
        return () => {
          const i = view.loops.indexOf(fn);
          if (i >= 0) view.loops.splice(i, 1);
        };
      },
      invalidate() {},
      schedule: (fn) => fn?.(),
    };
    view.api = api;
    presenceChanged(session);
    return api;
  }

  return Object.assign(world, {
    content,
    join,
    scene,
    change,
    view: (s) => views.get(s),
    /** Give a view its extension instance: sends reach it, flush updates it. */
    attach(session, instance) {
      views.get(session).instance = instance;
      return instance;
    },
    /** update() each attached view whose doc or local state changed since it last heard. */
    flush() {
      for (const v of views.values()) {
        if (!v.here || !v.instance) continue;
        const s = scene();
        const l = v.api.local.get();
        if (s === v.seen && l === v.seenLocal) continue;
        const prev = v.seen ? { scene: v.seen, local: v.seenLocal } : undefined;
        v.seen = s;
        v.seenLocal = l;
        v.instance.update?.(s, l, prev);
      }
    },
    /** Run every view's loops, `n` frames of `dt` seconds. */
    tick(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) {
        now = (now ?? Date.now()) + dt * 1000;
        vi.setSystemTime(Math.round(now));
        for (const [id, h] of [...holds]) if (h.landed && Date.now() - h.at > 3000) holds.delete(id);
        for (const v of views.values()) if (v.here && !v.hidden) for (const fn of [...v.loops]) fn(dt, now);
      }
    },
    /**
     * A view goes. With a bye (the default) it stops as the stage stops an
     * extension: abort, its claims and holds let go, its session lapses at
     * once; without one (a crash) it just stops being heard.
     */
    leave(session, { bye = true } = {}) {
      const v = views.get(session);
      if (bye) {
        v.abort.abort();
        for (const c of claims.filter((c) => c.session === session)) {
          claims.splice(claims.indexOf(c), 1);
          if (holderOf(c.id)?.claims?.[c.kind]?.session === session) change(() => delete holderOf(c.id).claims[c.kind]);
        }
        for (const [id, h] of [...holds]) if (h.session === session) holds.delete(id);
        v.instance?.dispose?.();
      }
      v.here = false;
      gone.add(session);
      presenceChanged(session);
    },
    done() {
      vi.useRealTimers();
    },
  });
}

/**
 * A drop context (STAGE.md, "Drops" and "Parts"), as a template or a part
 * gets one: the doc, its snapshot (parents resolved), change, newId, a repo
 * that makes docs, ctx.file (the scene's one doc per key, remembered at
 * doc.assets[key]), the registry and notify. What it made is in `calls`;
 * `calls.log` is every create2 and change, in order. Copied from
 * sailing/src/test/fakes.js, with the registry and the log added.
 *   const { ctx, calls } = fakeDrop(doc, { registries: { "scene:extension": reg } });
 * @param {object} doc
 * @param {{ content?: { [id]: object }, registries?: { [type]: object } }} [o]
 */
export function fakeDrop(doc, { content, registries = {} } = {}) {
  const calls = { created: [], notices: [], made: [], changes: 0, log: [] };
  let n = 0;
  const repo = {
    async create2(d) {
      calls.created.push(d);
      calls.log.push({ op: "create", type: d?.["@patchwork"]?.type ?? null });
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
    change: (fn) => {
      calls.changes++;
      calls.log.push({ op: "change" });
      fn(doc);
    },
    newId: (prefix) => `${prefix}${++n}`,
    registry: async (type) => registries[type] ?? null,
    notify: (text, kind) => calls.notices.push({ text, kind }),
    ...(content ? { content: (id) => content[id] ?? null } : {}),
    async file(key, make) {
      const have = doc.assets[key];
      if (have?.url) return { url: have.url, hint: have.hint ?? null };
      const f = await make();
      calls.made.push({ key, ...f });
      const made = await repo.create2({ "@patchwork": { type: "file" }, name: f.name, extension: f.extension, mimeType: f.mimeType, content: f.bytes });
      // the stage writes assets in a change of its own (not the template's)
      doc.assets[key] = { url: made.url, ...(f.hint ? { hint: f.hint } : {}) };
      return { url: made.url, hint: f.hint ?? null };
    },
  };
  return { ctx, calls };
}

/** A registry (as getRegistry(type) gives) holding these plugins, each with its module. */
export function fakeRegistry(plugins) {
  const all = new Map(plugins.map((p) => [p.id, { ...p }]));
  return {
    filter: (fn) => [...all.values()].filter(fn),
    async load(id) {
      const p = all.get(id);
      if (p && !p.module) p.module = await p.load();
      return p;
    },
    on: () => () => {},
  };
}
