// The gears graph (gears.js; PLANS.md section 4), over every small world:
// each subset of four extensions (one of every doc, two with a trait each,
// one with both and a service of the other's) × each object's traits
// (three objects: one, one hung on it, one filed in a group) × the scene's.
// 16 × 64 × 2 = 2048 worlds. In each, against a model written here from
// STAGE.md alone:
//   - A holds O ⇔ one of A's traits (or "*") sits on O, what it hangs on, its
//     groups or the scene; the two lenses agree (A among O's holders ⇔ O in
//     A's held), and O's holders go nearest first, ties in running order;
//   - every grid cell of A's lens is the verb O's lens gives A, and both are
//     commandState's;
//   - A's objects by trait are exactly where its traits sit, with their values;
//   - a trait nothing registered declares is "not running", with where it sits;
//   - the service has its provider and its user exactly when they run.

import { describe, expect, it } from "vitest";
import { activeSet } from "../stage/activation.js";
import { resolveParents } from "../hierarchy.js";
import { groupChain, resolveGroups } from "../groups.js";
import { commandState } from "../stage/commands.js";
import { buildGears, gearsOfExtension, gearsOfObject } from "./gears.js";

const has = (o, t) => !!o?.traits?.[t];
const run = () => {};
const EXTS = [
  { id: "t.all", traits: ["*"], commands: [{ id: "poke", name: "Poke", run, state: (t) => (t == null ? {} : { label: `Poke ${t}` }) }] },
  { id: "t.a", traits: ["t.a"], commands: [{ id: "ping", name: "Ping", run, state: (t, ctx) => (t == null ? null : has(ctx.scene.objects[t], "t.a") ? {} : { disabled: true, title: "not an a" }) }] },
  { id: "t.b", traits: ["t.b"], provides: ["svc"], commands: [{ id: "tick", name: "Tick", key: "t", show: ["menu"], run, state: (t) => (t == null ? null : { checked: true }) }] },
  { id: "t.u", traits: ["t.a", "t.b"], uses: ["svc"], commands: [] },
];
const VIEW = { id: "t.view", type: "scene:view", commands: [{ id: "look", name: "Look", show: ["toolbar"], run, state: (t) => (t == null ? {} : null) }] };
const TRAITS = [[], ["t.a"], ["t.b"], ["t.a", "t.b"]];
const T = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

function world(subset, combo, sceneA) {
  const traitsOf = (ts, i) => Object.fromEntries(ts.map((t) => [t, { n: i }]));
  const objects = {
    o1: { name: "One", transform: T, traits: traitsOf(TRAITS[combo[0]], 1) },
    o2: { name: "Two", parent: "o1", transform: T, traits: traitsOf(TRAITS[combo[1]], 2) },
    g: { name: "Group", kind: "group", transform: T },
    o3: { name: "Three", group: "g", transform: T, traits: traitsOf(TRAITS[combo[2]], 3) },
  };
  const d = { objects, traits: sceneA ? { "t.a": { scene: true } } : {} };
  const scene = { d, objects, ids: ["o1", "o2", "g", "o3"], parents: resolveParents(objects), groups: resolveGroups(objects) };
  const exts = EXTS.filter((_, i) => subset & (1 << i));
  const metas = [...exts.map(({ commands: _c, ...m }) => ({ type: "scene:extension", ...m })), { id: VIEW.id, type: VIEW.type }];
  const running = activeSet({ metas: metas.filter((m) => m.type === "scene:extension"), doc: d }).map((w) => ({ id: w.id, scope: w.scope }));
  const runs = new Set(running.map((r) => r.id));
  const commands = [...exts.filter((e) => runs.has(e.id)).map((e) => ({ id: e.id, value: e.commands })), { id: VIEW.id, value: VIEW.commands }];
  const context = { scene, view: null };
  const g = buildGears({ metas, scene, running, views: [VIEW.id], commands, context, inputs: exts.map((e) => ({ id: e.id, value: { press: () => null } })) });
  return { g, scene, exts, running, runs, context, d };
}

/** The model: the links an object's traits are read at (itself, what it hangs on, its groups) and the scene. */
function linksOf(scene, id) {
  const up = [];
  for (let p = scene.parents.get(id); p != null; p = scene.parents.get(p)) up.push(p);
  return [id, ...up, ...groupChain(scene.groups, id), null];
}

describe("the gears graph, over every small world", () => {
  it("2048 worlds: holding, both lenses, the verbs grid, traits, what isn't running and services agree with the model", () => {
    let worlds = 0;
    let pairs = 0;
    for (let subset = 0; subset < 16; subset++)
      for (let c = 0; c < 64; c++)
        for (const sceneA of [false, true]) {
          const combo = [c & 3, (c >> 2) & 3, (c >> 4) & 3];
          const { g, scene, exts, running, runs, context, d } = world(subset, combo, sceneA);
          const at = `${subset}/${combo}/${sceneA}`;
          const traitAt = (link, t) => has(link == null ? d : scene.objects[link], t);
          const objectIds = scene.ids;
          for (const id of objectIds) {
            const lens = gearsOfObject(g, id);
            const links = linksOf(scene, id);
            // the model's holders: each running extension at the nearest link carrying one of its traits
            const model = running
              .map((r, rank) => {
                const ts = EXTS.find((e) => e.id === r.id).traits;
                const depth = ts.includes("*") ? links.length - 1 : links.findIndex((l) => ts.some((t) => traitAt(l, t)));
                return { ext: r.id, depth, rank, via: links[depth] };
              })
              .filter((h) => h.depth >= 0)
              .sort((p, q) => p.depth - q.depth || p.rank - q.rank);
            expect([at, id, lens.holders.map((h) => [h.ext, h.via, h.depth])]).toEqual([at, id, model.map((h) => [h.ext, h.via ?? null, h.depth])]);
            expect(lens.views.map((v) => v.ext)).toEqual(["t.view"]);
            for (const h of lens.holders) {
              pairs++;
              const ext = gearsOfExtension(g, h.ext);
              // A holds O in one lens ⇔ in the other
              expect([at, id, h.ext, ext.held.includes(id)]).toEqual([at, id, h.ext, true]);
              // each cell of A's grid is the verb O's lens gives A, and commandState's
              for (const cmd of EXTS.find((e) => e.id === h.ext).commands) {
                const cell = ext.grid.rows.find((r) => r.id === id).cells[cmd.id] ?? null;
                const verb = h.verbs.find((v) => v.command === cmd.id) ?? null;
                expect([at, id, cmd.id, cell]).toEqual([at, id, cmd.id, verb]);
                const st = commandState(cmd, id, context);
                expect([at, id, cmd.id, verb && verb.enabled, verb?.reason ?? null]).toEqual([at, id, cmd.id, st && !st.disabled, st?.disabled ? st.title : null]);
              }
              expect(h.events).toEqual(["press"]);
            }
          }
          for (const e of exts) {
            const lens = gearsOfExtension(g, e.id);
            expect([at, e.id, lens.state]).toEqual([at, e.id, runs.has(e.id) ? "running" : "idle"]);
            // the other way round: what A's lens says it holds, O's lens says too
            for (const id of lens.held) expect([at, e.id, id, gearsOfObject(g, id).holders.some((h) => h.ext === e.id)]).toEqual([at, e.id, id, true]);
            if (!runs.has(e.id)) expect([at, e.id, lens.held]).toEqual([at, e.id, []]);
            // its objects by trait: exactly where its traits sit, with their values
            for (const t of e.traits.filter((x) => x !== "*")) {
              const want = [null, ...objectIds].filter((l) => traitAt(l, t)).map((l) => ({ id: l, value: (l == null ? d : scene.objects[l]).traits[t] }));
              expect([at, e.id, t, lens.objects[t]]).toEqual([at, e.id, t, want]);
            }
          }
          // what isn't running: a trait on something that nothing registered declares
          const declared = new Set(exts.flatMap((e) => e.traits));
          const loose = ["t.a", "t.b"].filter((t) => !declared.has(t) && [null, ...objectIds].some((l) => traitAt(l, t)));
          expect([at, g.notRunning.traits.map((x) => x.trait)]).toEqual([at, loose]);
          for (const x of g.notRunning.traits) expect(x.on).toEqual([null, ...objectIds].filter((l) => traitAt(l, x.trait)));
          // the service: provided while t.b runs, used while t.u runs
          const svc = g.services.find((s) => s.name === "svc");
          if (exts.some((e) => e.provides || e.uses)) expect([at, svc.provider, svc.users]).toEqual([at, runs.has("t.b") ? "t.b" : null, runs.has("t.u") ? ["t.u"] : []]);
          worlds++;
        }
    expect(worlds).toBe(2048);
    expect(pairs).toBeGreaterThan(worlds); // (t.all alone holds all four objects in half the worlds)
  });
});

describe("the gears graph's other strands", () => {
  const scene = (() => {
    const objects = { x: { name: "X", transform: T, traits: { "t.a": { v: 1 } } }, y: { name: "Y", transform: T, traits: { "t.gone": {} } } };
    const d = { objects, traits: {} };
    return { d, objects, ids: ["x", "y"], parents: resolveParents(objects), groups: resolveGroups(objects) };
  })();
  const metas = [
    { id: "t.a", type: "scene:extension", traits: ["t.a"], importUrl: "automerge:pkg#h1", describes: { "t.a": { name: "A" } } },
    { id: "t.bad", type: "scene:extension", traits: ["t.a"] },
    { id: "t.v", type: "scene:view" },
  ];
  const g = buildGears({
    metas,
    scene,
    running: [{ id: "t.a", scope: "objects" }],
    views: ["t.v"],
    settled: { missing: ["automerge:missing"], failed: ["t.bad"], errors: { "t.bad": "no luck" } },
    inspect: [
      { id: "scene.claims", value: { claims: [{ id: "x", kind: "helm", ext: "t.a", viewer: "v:me", session: "s1", mine: true, lapsing: false }] } },
      { id: "scene.poses", value: { holds: [{ id: "x", ext: "t.a", session: "s1", rank: 0, since: 3, yields: true, mine: true }, { id: "x", session: "s2", viewer: "v:ben", rank: 1, since: 4 }] } },
      { id: "scene.clock", value: { running: true, processes: { "t.a": 2 } } },
    ],
    owners: { layers: [{ ext: "t.a", onTop: false, meshes: 3 }], labels: [{ ext: "t.a", key: "k", text: "Hi", on: "x" }], display: { x: [{ ext: "t.v", fields: ["hidden"] }, { ext: "t.a", fields: ["transform"] }] } },
    provenance: [{ path: ["objects", "x", "transform"], by: { ext: "t.a" } }, { path: ["packages"], by: { kernel: "packages" } }],
  });

  it("an extension's lens: package and version, describes, what it holds now, what it wrote; a failed one with its error; not running", () => {
    const a = gearsOfExtension(g, "t.a");
    expect([a.package, a.version, a.describes]).toEqual(["automerge:pkg", "h1", ["t.a"]]);
    expect(a.now.claims.map((c) => [c.object, c.kind])).toEqual([["x", "helm"]]);
    expect(a.now.poses.map((p) => [p.object, p.rank, p.yields])).toEqual([["x", 0, true]]);
    expect(a.now.processes.map((p) => p.count)).toEqual([2]);
    expect(a.now.layers).toEqual([{ ext: "t.a", onTop: false, meshes: 3 }]);
    expect(a.now.overrides).toEqual([{ object: "x", ext: "t.a", fields: ["transform"], layer: 1 }]);
    expect(a.wrote).toEqual([["objects", "x", "transform"]]);
    expect(gearsOfExtension(g, "t.bad")).toMatchObject({ state: "failed", error: "no luck" });
    expect(g.notRunning).toEqual({ traits: [{ trait: "t.gone", on: ["y"] }], packages: ["automerge:missing"], failed: [{ id: "t.bad", error: "no luck" }] });
    expect(gearsOfExtension(g, "nobody")).toBe(null);
    expect(Object.isFrozen(g) && Object.isFrozen(g.extensions[0])).toBe(true);
  });

  it("an object's lens: its holders, then the view plugins; what each draws there, in layering order; its claims and poses, a peer's included", () => {
    const x = gearsOfObject(g, "x");
    expect(x.holders.map((h) => [h.ext, h.via])).toEqual([["t.a", "x"]]);
    expect(x.views.map((h) => h.ext)).toEqual(["t.v"]);
    expect(x.holders[0].draws.labels.map((l) => l.text)).toEqual(["Hi"]);
    expect(x.overrides.map((o) => o.ext)).toEqual(["t.v", "t.a"]);
    expect(x.poses.map((p) => p.session)).toEqual(["s1", "s2"]);
    expect(x.traits).toEqual([{ object: "x", trait: "t.a", value: { v: 1 }, by: ["t.a", "t.bad"] }]);
    expect(gearsOfObject(g, "nope")).toBe(null);
  });
});
