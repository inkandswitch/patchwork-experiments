// A fake view of linked stages for the water extension's tests: each stage a
// doc, a frame (its root's world matrix, null for the outermost), a world
// clock and the extensions it runs; the api each gets is the slice of
// scene's api water uses, with scene's ambient rule (STAGE.md, "Ambients"):
// a stage stacks its extensions' offers per name in running order, the later
// whole, null clearing; each name a stage reads is the outermost offer on its
// own path (its parents' chain, the outermost first, itself last), as plain
// JSON (copied and frozen), with its frame in the offering doc's root and
// that doc's clock. The rule itself is scene's to prove
// (scene/src/stage/ambients-stage.test.js); this only lets water run on it.

import { fakeThree } from "./fake-three.js";

const frozen = (v) => {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) frozen(v[k]);
    Object.freeze(v);
  }
  return v;
};

/** A doc transform ({ position, rotation (Euler XYZ), scale }) as a column-major matrix. */
export function compose(t) {
  const [x, y, z] = t?.position ?? [0, 0, 0];
  const [a, b, c] = t?.rotation ?? [0, 0, 0];
  const s = t?.scale ?? 1;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx(a) · Ry(b) · Rz(c) (three's XYZ order)
  const R = [cb * cc, ca * sc + sa * sb * cc, sa * sc - ca * sb * cc, -cb * sc, ca * cc - sa * sb * sc, sa * cc + ca * sb * sc, sb, -sa * cb, ca * cb];
  return [R[0] * s, R[1] * s, R[2] * s, 0, R[3] * s, R[4] * s, R[5] * s, 0, R[6] * s, R[7] * s, R[8] * s, 0, x, y, z, 1];
}

/** Column-major A · B. */
export function mulM(A, B) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k];
  return o;
}

/** Column-major inverse of a similarity (rotation · uniform scale, then translation). */
export function invertSimilarity(M) {
  const s2 = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
  // the inverse's linear part is the transpose over s²; its translation that, applied to -T
  const R = [M[0] / s2, M[4] / s2, M[8] / s2, 0, M[1] / s2, M[5] / s2, M[9] / s2, 0, M[2] / s2, M[6] / s2, M[10] / s2, 0];
  const T = [M[12], M[13], M[14]];
  return [...R, -(R[0] * T[0] + R[4] * T[1] + R[8] * T[2]), -(R[1] * T[0] + R[5] * T[1] + R[9] * T[2]), -(R[2] * T[0] + R[6] * T[1] + R[10] * T[2]), 1];
}

/**
 * @param {{ doc: object, matrix?: number[] | null, parent?: number, extensions?: object[], drawn?: boolean, poses?: object }[]} specs  the outermost first;
 *   `matrix` is the stage's root in the outermost's (null for the outermost); `parent` the stage it is linked in (default the outermost);
 *   `poses` overrides an object's drawn matrix (api.worldOf), as a held pose does
 */
export function fakeView(specs) {
  const THREE = fakeThree();
  const stages = [];
  const view = {
    stages,
    THREE,
    /** the outermost's stacked offers, by name */
    ambients() {
      return stages[0] ? view.offers(stages[0]) : {};
    },
    /** a stage's stacked offers, by name */
    offers(world) {
      const out = {};
      for (const inst of world.instances) {
        const offer = inst.ambient?.() ?? null;
        if (!offer) continue;
        for (const [k, v] of Object.entries(offer)) if (v !== undefined) out[k] = v;
      }
      for (const k of Object.keys(out)) {
        if (out[k] == null) delete out[k];
        else {
          const key = JSON.stringify(out[k]);
          if (world.cache.get(k)?.key !== key) world.cache.set(k, { key, value: frozen(JSON.parse(key)) });
          out[k] = world.cache.get(k).value;
        }
      }
      return out;
    },
    /** one frame: every clock ticks by dt (those that run), then every loop runs */
    frame(dt = 1 / 60) {
      for (const s of stages) if (s.clock.running && s.clock.computed) s.clock.t += Math.min(0.25, dt);
      for (const s of stages) for (const fn of [...s.loops]) fn(dt);
    },
    dispose() {
      for (const s of stages) for (const i of s.instances) i.dispose?.();
    },
  };
  specs.forEach((spec, n) => {
    const s = {
      n,
      doc: spec.doc,
      matrix: spec.matrix ?? null,
      parent: n === 0 ? null : (spec.parent ?? 0),
      clock: { t: spec.t ?? 0, running: spec.running ?? true, computed: spec.computed ?? true },
      instances: [],
      loops: new Set(),
      extent: null,
      extentSets: 0,
      notices: [],
      processes: 0,
      groups: [],
      poses: spec.poses ?? null,
      camera: { position: [3, 10, 20] },
      cache: new Map(),
    };
    stages.push(s);
    s.api = {
      THREE,
      doc: () => s.doc,
      scene: () => {
        const objects = s.doc.objects ?? {};
        const parents = new Map(Object.entries(objects).map(([id, o]) => [id, o.parent && objects[o.parent] ? o.parent : null]));
        const world = (id) => {
          const o = objects[id];
          if (!o) return null;
          const own = compose(o.transform);
          const p = parents.get(id);
          return p ? mulM(world(p), own) : own;
        };
        return { d: s.doc, traits: s.doc.traits ?? {}, objects, parents, ids: Object.keys(objects), world };
      },
      worldOf: (id) => s.poses?.[id] ?? s.api.scene().world(id),
      clock: Object.freeze({ t: () => s.clock.t, running: () => s.clock.running, process: () => (spec.drawn ? () => {} : (s.processes++, () => s.processes--)) }),
      loop: (fn) => (s.loops.add(fn), () => s.loops.delete(fn)),
      world: () => {
        const g = {
          children: [],
          position: { x: 0, y: 0, z: 0 },
          add: (o) => {
            g.children.push(o);
            o.removeFromParent = () => (g.children = g.children.filter((c) => c !== o));
          },
        };
        s.groups.push(g);
        return g;
      },
      camera: Object.freeze({ get: () => ({ position: s.camera.position }) }),
      extent: (box) => {
        s.extent = box;
        s.extentSets++;
      },
      invalidate: () => {},
      notify: (text) => s.notices.push(text),
      collect: (name) => s.instances.filter((i) => i[name] !== undefined).map((i, k) => ({ id: `ext${k}`, value: i[name] })),
      ambient: (name) => {
        // the stage's path, the outermost first
        const path = [];
        for (let at = s; at; at = at.n === 0 ? null : stages[at.parent]) path.unshift(at);
        const from = path.find((at) => view.offers(at)[name] !== undefined);
        if (!from) return null;
        const value = view.offers(from)[name];
        const mine = from === s;
        const matrix = mine ? null : from.matrix ? mulM(invertSimilarity(from.matrix), s.matrix) : s.matrix;
        return Object.freeze({ value, mine, frame: { matrix }, clock: Object.freeze({ t: from.clock.t, running: from.clock.running }) });
      },
    };
  });
  // start each stage's extensions (after every stage exists, as a view's arrive)
  specs.forEach((spec, n) => {
    for (const ext of spec.extensions ?? []) stages[n].instances.push(ext.create(stages[n].api));
  });
  return view;
}

/** A wave maker standing in for sailing's sea: contributes these components for these bodies as `water.waves`. */
export const waves = (components, look, ids = ["sea"]) => ({ create: () => ({ "water.waves": { bodies: Object.fromEntries(ids.map((id) => [id, { components, ...(look ? { look } : {}) }])) } }) });

/** Whoever makes the weather, standing in for sailing's sea: offers the world's wind ambient. */
export const windOf = (wind) => ({ create: () => ({ ambient: () => ({ wind }) }) });

/** Count the open surfaces drawn across the view (one mesh each). */
export const surfaces = (view) => view.stages.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.children.filter((c) => c.name === "ocean").length, 0), 0);
/** Count the bounded patches drawn across the view. */
export const patches = (view) => view.stages.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.children.filter((c) => c.name === "water-patch").length, 0), 0);

/** A level placement's world matrix: yaw (radians), then translation; column-major. */
export function placement(yaw = 0, t = [0, 0, 0], s = 1) {
  const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s;
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, t[0], t[1], t[2], 1];
}
