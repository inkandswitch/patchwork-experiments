// The X-ray's panel models (xray-model.js), pure, over the gears graph's
// small worlds (gears.test.js's: 16 extension subsets × 64 object trait
// combinations × 2 scene traits) and the finite cases of the layers:
//   - the object lens lists exactly the graph's holders in input order, each
//     verb as its chip; the outline is the object, then the links it is
//     held through, each once;
//   - the running list is the running order; in a world whose running set
//     is the doc's, nothing lingers; one running for a trait nowhere does;
//   - the extension lens's grid has a cell per (held object, verb), each the
//     object lens's verb; its trait tables a row per object carrying it;
//   - every subset of layers toggles exactly the one asked for.

import { describe, expect, it } from "vitest";
import { activeSet } from "../stage/activation.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { TOO_FAR } from "../parts/toolbar-commands.js";
import { buildGears, gearsOfObject } from "./gears.js";
import { LAYERS, extensionOutline, extensionSections, layerSections, layersOn, lingering, objectOutline, objectSections, quietHolder, runningSections, toggleLayer, verbChip } from "./xray-model.js";

const has = (o, t) => !!o?.traits?.[t];
const run = () => {};
const EXTS = [
  { id: "t.all", traits: ["*"], commands: [{ id: "poke", name: "Poke", run, state: (t) => (t == null ? {} : { label: `Poke ${t}` }) }] },
  { id: "t.a", traits: ["t.a"], commands: [{ id: "ping", name: "Ping", key: "p", run, state: (t, ctx) => (t == null ? null : has(ctx.scene.objects[t], "t.a") ? {} : { disabled: true, title: "not an a" }) }] },
  { id: "t.b", traits: ["t.b"], provides: ["svc"], commands: [{ id: "tick", name: "Tick", reach: true, run, state: (t) => (t == null ? null : {}) }] },
  { id: "t.u", traits: ["t.a", "t.b"], uses: ["svc"], commands: [] },
];
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
  const metas = exts.map(({ commands: _c, ...m }) => ({ type: "scene:extension", ...m }));
  const running = activeSet({ metas, doc: d }).map((w) => ({ id: w.id, scope: w.scope }));
  const runs = new Set(running.map((r) => r.id));
  const commands = exts.filter((e) => runs.has(e.id)).map((e) => ({ id: e.id, value: e.commands }));
  // o3 is out of reach: a reach verb on it is "too far"
  const context = { scene, view: null, reach: 1, distance: (t) => (t === "o3" ? 5 : 0) };
  const g = buildGears({ metas, scene, running, commands, context, inputs: exts.map((e) => ({ id: e.id, value: { press: () => null } })) });
  return { g, scene, running };
}

describe("the X-ray's lenses, over every small world", () => {
  it("2048 worlds: the object lens is the graph's holders and verbs; the outline its chain; the running list; nothing lingers; the grid is the verbs", () => {
    let worlds = 0;
    for (let subset = 0; subset < 16; subset++)
      for (let c = 0; c < 64; c++)
        for (const sceneA of [false, true]) {
          const { g, scene, running } = world(subset, [c & 3, (c >> 2) & 3, (c >> 4) & 3], sceneA);
          const at = `${subset}/${c}/${sceneA}`;
          for (const id of scene.ids) {
            const o = gearsOfObject(g, id);
            const secs = objectSections(g, id);
            const holders = secs.find((s) => s.id === "holders");
            // (every holder with something for it, in input order; one with nothing, holding the scene, is named in the note)
            const loud = o.holders.filter((h) => !quietHolder(h));
            expect([at, id, holders.rows.map((r) => r.ext)]).toEqual([at, id, loud.map((h) => h.ext)]);
            holders.rows.forEach((r, i) => expect([at, id, r.chips]).toEqual([at, id, loud[i].verbs.map(verbChip)]));
            // a reach verb beyond reach is out of reach, never "disabled"
            for (const r of holders.rows) for (const ch of r.chips) if (ch.text.startsWith("Tick")) expect([at, id, ch.state]).toEqual([at, id, id === "o3" ? "far" : "on"]);
            const out = objectOutline(g, id);
            expect(out[0]).toEqual({ key: `focus:${id}`, id, role: "focus" });
            const chain = out.slice(1).map((x) => x.id);
            expect(new Set(chain).size).toBe(chain.length);
            expect(chain.every((x) => x !== id && o.holders.some((h) => h.via === x))).toBe(true);
          }
          const runningSec = runningSections(g).find((s) => s.id === "running");
          expect([at, runningSec.rows.map((r) => r.ext)]).toEqual([at, running.map((r) => r.id)]);
          // the running set is the doc's: nothing here lingers
          expect([at, g.extensions.filter((e) => lingering(g, e)).map((e) => e.id)]).toEqual([at, []]);
          for (const r of running) {
            const secs = extensionSections(g, r.id);
            const lens = secs.find((s) => s.id === "grid");
            const held = g.holds.filter((h) => h.ext === r.id).map((h) => h.object);
            const mine = g.verbs.filter((v) => v.ext === r.id);
            if (!mine.length) expect(lens).toBeUndefined();
            else {
              // a row for the scene and each object it holds; each cell the verb's chip state, or "·"
              expect(lens.table.rows.length).toBe(1 + held.length);
              const commands = [...new Set(mine.map((v) => v.command))];
              lens.table.rows.forEach((row, i) => {
                const target = i === 0 ? null : held[i - 1];
                commands.forEach((cmd, k) => {
                  const v = mine.find((x) => x.command === cmd && x.target === target);
                  expect([at, r.id, target, cmd, row[k + 1].state ?? null]).toEqual([at, r.id, target, cmd, v ? verbChip(v).state : null]);
                });
              });
            }
            const e = EXTS.find((x) => x.id === r.id);
            for (const t of e.traits.filter((x) => x !== "*")) {
              const sec = secs.find((s) => s.id === `trait:${t}`);
              const carrying = [null, ...scene.ids].filter((l) => has(l == null ? scene.d : scene.objects[l], t));
              // (a table while anything carries it, every value having a field here; else a note)
              expect([at, t, (sec.table?.rows ?? []).map((row) => row[0].object ?? null), !!sec.note]).toEqual([at, t, carrying, !carrying.length]);
            }
            // its outline: the objects carrying its traits, each once
            const outline = extensionOutline(g, r.id).map((x) => x.id);
            expect(new Set(outline).size).toBe(outline.length);
          }
          worlds++;
        }
    expect(worlds).toBe(2048);
  });

  it("an extension running for a trait that sits nowhere lingers; one busy holding a pose or the tool says so", () => {
    const { g } = world(0b0010, [0, 0, 0], false); // t.a registered, nothing carries t.a
    expect(g.extensions.find((e) => e.id === "t.a").state).toBe("idle");
    const objects = { o: { name: "O", transform: T } };
    const scene = { d: { objects, traits: {} }, objects, ids: ["o"], parents: resolveParents(objects), groups: resolveGroups(objects) };
    const metas = [{ id: "t.a", type: "scene:extension", traits: ["t.a"] }, { id: "t.all", type: "scene:extension", traits: ["*"] }];
    const g2 = buildGears({ metas, scene, running: [{ id: "t.all", scope: "scene" }, { id: "t.a", scope: "objects" }], inspect: [{ id: "scene.poses", value: { holds: [{ id: "o", ext: "t.all", mine: true, rank: 0 }] } }] });
    expect(g2.extensions.filter((e) => lingering(g2, e)).map((e) => e.id)).toEqual(["t.a"]);
    const rows = runningSections(g2, { hands: [{ ext: "t.a", kind: "tool", name: "Thing" }] }).find((s) => s.id === "running").rows;
    expect(rows.map((r) => [r.ext, r.sub.split(" · ").slice(2)])).toEqual([
      ["t.all", ["busy"]],
      ["t.a", ["lingering", "busy"]],
    ]);
  });
});

describe("verbs, layers and badges", () => {
  it("a verb's chip: enabled, disabled with why, out of reach; its label and key", () => {
    expect(verbChip({ name: "Draw", keys: ["d"], enabled: true })).toEqual({ text: "Draw (D)", state: "on", title: "enabled" });
    expect(verbChip({ name: "Draw", label: "Draw to my hand", keys: [], enabled: false, reason: "not your turn" })).toEqual({ text: "Draw to my hand", state: "off", title: "disabled: not your turn" });
    expect(verbChip({ name: "Lift", keys: ["Delete"], enabled: false, reason: TOO_FAR })).toEqual({ text: "Lift (Delete)", state: "far", title: "out of reach" });
  });

  it("every subset of layers: toggling one turns exactly it on or off, in the panel's order", () => {
    const all = LAYERS.map((l) => l.id);
    expect(layersOn(null)).toEqual(LAYERS.filter((l) => l.on).map((l) => l.id));
    for (let m = 0; m < 1 << all.length; m++) {
      const pref = all.filter((_, i) => m & (1 << i));
      expect(layersOn(pref)).toEqual(pref);
      for (const id of all)
        for (const on of [true, false]) {
          const next = toggleLayer(pref, id, on);
          expect(next).toEqual(all.filter((x) => (x === id ? on : pref.includes(x))));
        }
    }
  });

  it("claims, poses and display as sections and one badge per object; the route's taker marked, older routes after; clock, links, people, visibility", () => {
    const objects = { c: { name: "Card", transform: T }, d: { name: "Deck", transform: T } };
    const scene = { d: { objects, traits: {} }, objects, ids: ["c", "d"], parents: resolveParents(objects), groups: resolveGroups(objects) };
    const g = buildGears({
      // (the natives whose snapshots the layers read run, as in every stage)
      metas: [{ id: "t.game", type: "scene:extension", name: "Game", traits: ["*"] }, ...["claims", "poses", "clock", "audience"].map((n) => ({ id: `scene.${n}`, type: "scene:extension", traits: ["*"] })), { id: "scene.links", type: "scene:view" }],
      scene,
      running: ["t.game", "scene.claims", "scene.poses", "scene.clock", "scene.audience"].map((id) => ({ id, scope: "scene" })),
      views: ["scene.links"],
      inspect: [
        { id: "scene.claims", value: { claims: [{ id: null, kind: "seat:p1", viewer: "v:ana", mine: true }, { id: "c", kind: "turn", viewer: "v:ben", lapsing: true }] } },
        { id: "scene.poses", value: { holds: [{ id: "c", viewer: "v:ben", session: "s2", rank: 0, yields: false }, { id: "c", viewer: "v:ana", mine: true, rank: 1 }] } },
        { id: "scene.clock", value: { running: true, t: 12.34, computing: false, computer: { viewer: "v:ben", mine: false }, processes: { "t.game": 2 } } },
        { id: "scene.links", value: { stages: [{ path: ["d"], role: "pinned", open: false, reason: "unavailable" }] } },
        { id: "scene.audience", value: { objects: [{ id: "c", audience: ["v:ana"], shown: "all", veiled: false }] } },
      ],
      owners: { layers: [], labels: [], display: { d: [{ ext: "t.game", fields: ["hidden"] }] } },
    });
    const who = (v, mine) => (mine ? "you" : { "v:ana": "Ana", "v:ben": "Ben" }[v] ?? "someone");
    const routes = [
      { type: "press", path: ["d"], steps: [{ step: "holder", ext: "t.game", holder: null }], took: 0 },
      { type: "click", path: ["c"], steps: [{ step: "hand", ext: "scene.xray" }, { step: "holder", ext: "t.game", holder: "c" }, { step: "default", ext: null }], took: 1 },
    ];
    const { sections, badges } = layerSections(g, layersOn(LAYERS.map((l) => l.id)), { who, viewer: "v:ana", routes, peers: { s1: { viewer: "v:ana" }, s2: { viewer: "v:ben", body: { label: "Seated" }, held: { name: "X-ray" } } }, session: "s1", view: { body: { label: "Watching" }, hands: [] } });
    const by = Object.fromEntries(sections.map((s) => [s.id, s]));
    expect(sections.map((s) => s.id)).toEqual(LAYERS.map((l) => l.id));
    expect(by.claims.rows.map((r) => [r.text, r.sub, r.state])).toEqual([
      ["seat:p1 on the scene", "you", "on"],
      ["turn on Card", "Ben · lapsing", "off"],
    ]);
    expect(by.poses.rows.map((r) => [r.text, r.state])).toEqual([
      ["Card: Ben", "on"],
      ["Card: you", "off"],
    ]);
    expect(by.clock.rows.map((r) => r.text)).toEqual(["running", "computed by Ben", "Game"]);
    expect(by.display.rows).toEqual([{ text: "Deck", sub: "Game (hidden)", object: "d" }]);
    const [last, older] = by.route.rows;
    expect([last.text, last.sub, last.chips.map((c) => c.state ?? null)]).toEqual(["click on Card", "taken by Game (holder)", [null, "took", null]]);
    // a run of view plugins passed over is one chip
    const passed = layerSections(g, ["route"], { routes: [{ type: "key", path: null, steps: ["a", "b", "c"].map((x) => ({ step: "plugin", ext: `v.${x}` })).concat([{ step: "body", ext: "t.game", body: "seat" }]), took: -1 }] }).sections[0].rows[0];
    expect(passed.chips).toEqual([{ text: "3 view plugins", title: "v.a, v.b, v.c" }, { text: "body Game" }]);
    expect([older.text, older.older]).toEqual(["press on Deck", true]);
    expect(by.links.rows.map((r) => [r.text, r.sub])).toEqual([["Deck", "pinned · closed: unavailable"]]);
    expect(by.people.rows.map((r) => [r.text, r.sub])).toEqual([
      ["you", "Watching"],
      ["Ben", "Seated · X-ray · session s2"],
    ]);
    expect(by.visibility.rows.map((r) => r.sub)).toEqual(["may see: you · turned toward: everyone"]);
    // one badge per object, its layers' texts in the panel's order; a scene claim has no object to sit on
    expect(badges).toEqual([
      { key: "xray:c", on: "c", text: "turn: Ben (lapsing) · held: Ben · sees: you", kind: "claim" },
      { key: "xray:d", on: "d", text: "shown by Game", kind: "display" },
    ]);
    // none on: nothing
    expect(layerSections(g, [], { who })).toEqual({ sections: [], badges: [] });
  });
});
