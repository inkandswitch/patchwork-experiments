// A fake view of linked stages for the water extension's tests: each stage a
// doc, a frame (its root's world matrix, null for the outermost), a world
// clock and the extensions it runs; the api each gets is the slice of
// scene's api water uses, with scene's ambient rule (STAGE.md, "Ambients"):
// a stage stacks its extensions' offers per name in running order, the later
// whole, null clearing; every stage reads the outermost's, as plain JSON
// (copied and frozen). The rule itself is scene's to prove
// (scene/src/stage/ambients-stage.test.js); this only lets water run on it.

import { fakeThree } from "./fake-three.js";

const frozen = (v) => {
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) frozen(v[k]);
    Object.freeze(v);
  }
  return v;
};

/**
 * @param {{ doc: object, matrix?: number[] | null, extensions?: object[], drawn?: boolean }[]} specs  the outermost first
 */
export function fakeView(specs) {
  const THREE = fakeThree();
  const stages = [];
  const view = {
    stages,
    THREE,
    /** the outermost's stacked offers, by name */
    ambients() {
      const world = stages[0];
      const out = {};
      if (!world) return out;
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
      clock: { t: spec.t ?? 0, running: spec.running ?? true, computed: spec.computed ?? true },
      instances: [],
      loops: new Set(),
      extent: null,
      extentSets: 0,
      notices: [],
      processes: 0,
      groups: [],
      camera: { position: [3, 10, 20] },
      cache: new Map(),
    };
    stages.push(s);
    s.api = {
      THREE,
      doc: () => s.doc,
      scene: () => ({ d: s.doc, traits: s.doc.traits }),
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
        const value = view.ambients()[name];
        if (value === undefined) return null;
        const world = stages[0];
        return Object.freeze({ value, mine: s === world, frame: s.matrix ? { matrix: s.matrix } : { matrix: null }, clock: Object.freeze({ t: world.clock.t, running: world.clock.running }) });
      },
    };
  });
  // start each stage's extensions (after every stage exists, as a view's arrive)
  specs.forEach((spec, n) => {
    for (const ext of spec.extensions ?? []) stages[n].instances.push(ext.create(stages[n].api));
  });
  return view;
}

/** A wave maker standing in for sailing's sea: contributes these components as `water.waves`. */
export const waves = (components, look) => ({ create: () => ({ "water.waves": { components, ...(look ? { look } : {}) } }) });

/** Count the ocean meshes drawn across the view (one surface each). */
export const surfaces = (view) => view.stages.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.children.filter((c) => c.name === "ocean").length, 0), 0);

/** A level placement's world matrix: yaw (radians), then translation; column-major. */
export function placement(yaw = 0, t = [0, 0, 0], s = 1) {
  const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s;
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, t[0], t[1], t[2], 1];
}
