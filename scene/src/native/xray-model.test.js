// The X-ray's models (xray-model.js), pure, over the gears graph's small
// worlds (gears.test.js's: 16 extension subsets × 64 object trait
// combinations × 2 scene traits) and the finite cases of the rest:
//   - colours: one per extension, in the palette, distinct for every subset
//     the palette can hold, the same whatever the order asked;
//   - looks: every object has one; what nothing responds to fades with no
//     outline; the rest are outlined in their responders' colours in input
//     order; isolating an extension lights exactly the objects it holds;
//   - the legend counts what each extension holds, by package, the rest idle;
//   - the card has exactly the responding chain, with the graph's verbs;
//   - glyphs: each kind from exactly the state that makes it;
//   - the route's boxes are in the chain's order with the taker marked.

import { describe, expect, it } from "vitest";
import { activeSet } from "../stage/activation.js";
import { resolveParents } from "../hierarchy.js";
import { resolveGroups } from "../groups.js";
import { TOO_FAR } from "../stage/commands.js";
import { buildGears } from "./gears.js";
import { BANDS, GHOST, GLYPHS, NEUTRAL, OPACITY, PALETTE, card, colours, details, glyphs, isGeneric, lead, legend, looks, responders, routeBoxes, strip, verbChip } from "./xray-model.js";

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


const ALL = ["t.all", "t.a", "t.b", "t.u"];
const depth = (g, id, ext) => g.chains[id].find((h) => h.ext === ext).depth;

describe("colours", () => {
  it("every subset of ten ids, in any order: each in the palette, all distinct, the same asked again", () => {
    const pool = ["scene.carry", "tabletop", "seats", "keeper", "scene.claims", "scene.poses", "scene.clock", "machine", "sailing", "scene.links"];
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
    for (let m = 1; m < 1 << pool.length; m++) {
      const ids = pool.filter((_, i) => m & (1 << i));
      const c = colours(ids);
      const got = ids.map(c);
      expect(new Set(got).size).toBe(ids.length);
      for (const x of got) expect(PALETTE).toContain(x);
      const back = colours([...ids].reverse());
      expect(ids.map(back)).toEqual(got);
    }
  });
  it("an id not asked for is neutral, the same whoever asks", () => {
    expect(colours(["a"])("b")).toBe(NEUTRAL);
    expect(PALETTE).not.toContain(NEUTRAL);
  });
  it("more ids than the palette holds: still one from it each, the first of the sorted taking its own slot", () => {
    const ids = Array.from({ length: PALETTE.length + 5 }, (_, i) => `e${i}`);
    const c = colours(ids);
    expect(ids.every((id) => PALETTE.includes(c(id)))).toBe(true);
    expect(new Set(ids.map(c)).size).toBe(PALETTE.length);
  });
});

describe("the scene-wide view, over every small world", () => {
  it("2048 worlds: looks, isolation, the legend and the card agree with who holds what", () => {
    let worlds = 0;
    for (let subset = 0; subset < 16; subset++)
      for (let c = 0; c < 64; c++)
        for (const sceneA of [false, true]) {
          const { g, scene, running } = world(subset, [c & 3, (c >> 2) & 3, (c >> 4) & 3], sceneA);
          const at = `${subset}/${c}/${sceneA}`;
          const colour = colours(running.map((r) => r.id));
          const all = looks(g, colour);
          expect([at, Object.keys(all)]).toEqual([at, scene.ids]);
          for (const id of scene.ids) {
            const by = responders(g, id);
            // (a trait on the object or what it hangs on or is filed under; the scene's traits hold nothing in particular)
            expect([at, id, by.every((e) => running.some((r) => r.id === e))]).toEqual([at, id, true]);
            if (!by.length) expect([at, id, all[id]]).toEqual([at, id, { tint: GHOST, opacity: OPACITY.faded }]);
            else expect([at, id, all[id]]).toEqual([at, id, { tint: GHOST, opacity: OPACITY.ghost, outline: [colour(lead(g, id))] }]);
            // the lead is one of the responders, the nearest of them (none of these are generic); none when none respond
            expect([at, id, lead(g, id)]).toEqual([at, id, by.length ? by.reduce((a, e) => (depth(g, id, e) < depth(g, id, a) ? e : a)) : null]);
            // the one looked at is lit; the one hovered shows the whole chain
            expect(looks(g, colour, { focus: [id] })[id]).toEqual({ opacity: OPACITY.lit, ...(by.length ? { outline: [colour(lead(g, id))] } : {}) });
            expect(looks(g, colour, { focus: [id], banded: id })[id]).toEqual({ opacity: OPACITY.lit, ...(by.length ? { outline: by.slice(0, BANDS).map(colour) } : {}) });
          }
          for (const r of running) {
            const iso = looks(g, colour, { isolated: r.id });
            const lit = scene.ids.filter((id) => iso[id].opacity === OPACITY.lit);
            expect([at, r.id, lit]).toEqual([at, r.id, scene.ids.filter((id) => responders(g, id).includes(r.id))]);
            for (const id of scene.ids) {
              if (lit.includes(id)) expect(iso[id].outline).toEqual([colour(r.id)]);
              else expect([at, id, iso[id]]).toEqual([at, id, { tint: GHOST, opacity: OPACITY.faded }]);
            }
          }
          // the legend: a row per running extension holding something, its count, grouped by package; the rest idle
          const lg = legend(g, colour);
          const rows = lg.groups.flatMap((x) => x.rows);
          const exts = g.extensions.filter((e) => e.kind === "extension" && e.state === "running");
          const holds = (e) => g.holds.filter((h) => h.ext === e && h.via != null).length;
          expect([at, rows.map((r) => [r.ext, r.count])]).toEqual([at, exts.filter((e) => holds(e.id)).map((e) => [e.id, holds(e.id)])]);
          expect([at, lg.idle.map((x) => x.ext)]).toEqual([at, exts.filter((e) => !holds(e.id)).map((e) => e.id)]);
          expect(lg.problems).toEqual([]);
          expect(legend(g, colour, { isolated: "t.a" }).groups.flatMap((x) => x.rows).filter((r) => r.on).map((r) => r.ext)).toEqual(running.some((r) => r.id === "t.a") && holds("t.a") ? ["t.a"] : []);
          // the card: the responding chain with the graph's verbs for it; nothing that doesn't act on it
          for (const id of scene.ids) {
            const k = card(g, id, colour);
            expect([at, id, k.chain.map((x) => x.ext)]).toEqual([at, id, responders(g, id)]);
            const mine = g.verbs.filter((v) => v.target === id);
            k.chain.forEach((x) => expect(x.verbs).toEqual(mine.filter((v) => v.ext === x.ext).map(verbChip)));
            expect(k.plugins).toEqual([]);
            expect(k.traits.map((t) => t.text)).toEqual(g.carries.filter((t) => t.object === id).map((t) => t.trait));
            const d = details(g, id, colour);
            expect([at, id, d.folds.filter((f) => responders(g, id).includes(f.ext)).map((f) => f.ext)]).toEqual([at, id, responders(g, id)]);
          }
          expect(card(g, "nope", colour)).toBe(null);
          expect(details(g, "nope", colour)).toBe(null);
          worlds++;
        }
    expect(worlds).toBe(2048);
  });

  it("a view plugin with a verb for the object is on the card after the chain, in its own colour", () => {
    const objects = { o: { name: "O", transform: T } };
    const scene = { d: { objects, traits: {} }, objects, ids: ["o"], parents: resolveParents(objects), groups: resolveGroups(objects) };
    const g = buildGears({ metas: [{ id: "v.sel", type: "scene:view", name: "Select" }], scene, views: ["v.sel"], commands: [{ id: "v.sel", value: [{ id: "pick", name: "Pick", key: "e", run, state: () => ({}) }] }] });
    const colour = colours(["v.sel"]);
    const k = card(g, "o", colour);
    expect(k.chain).toEqual([]);
    expect(k.plugins).toEqual([{ ext: "v.sel", name: "Select", colour: colour("v.sel"), verbs: [{ text: "Pick", key: "E", state: "on", title: "enabled" }] }]);
  });

  it("failed extensions and missing packages are the legend's problems, in red", () => {
    const g = buildGears({ metas: [{ id: "t.x", type: "scene:extension", name: "Ex" }], scene: { d: { objects: {}, traits: {} }, objects: {}, ids: [], parents: new Map(), groups: new Map() }, settled: { failed: ["t.x"], errors: { "t.x": "boom" }, missing: ["https://x.test/pkg"] } });
    expect(legend(g, colours([])).problems).toEqual([{ text: "Ex", why: "failed: boom" }, { text: "x.test/pkg", why: "package not loaded here" }]);
  });
});

describe("the most specific responder", () => {
  // a Lost Cities card in miniature: Carry (native), a game extension and a keeper all hold it
  const objects = { card: { name: "Card", transform: T, traits: { "scene.carry": {}, "g.card": {}, "keep.plain": {} } }, plain: { name: "Plain", transform: T, traits: { "scene.carry": {} } }, kept: { name: "Kept", transform: T, traits: { "scene.carry": {}, "keep.plain": {} } }, kid: { name: "Kid", parent: "plain", transform: T, traits: { "g.card": {} } } };
  const scene = { d: { objects, traits: {} }, objects, ids: Object.keys(objects), parents: resolveParents(objects), groups: resolveGroups(objects) };
  const metas = [
    { id: "scene.carry", type: "scene:extension", name: "Carry", traits: ["scene.carry"] },
    { id: "g.game", type: "scene:extension", name: "Game", traits: ["g.card"] },
    { id: "keep.plain", type: "scene:extension", name: "Keeper", traits: ["keep.plain"], keeper: "plain" },
  ];
  const make = (ids) => buildGears({ metas, scene, running: ids.map((id) => ({ id, scope: "scene" })) });
  const ALLR = metas.map((m) => m.id);

  it("over every subset running: a game over a native and a keeper; a native alone is its own", () => {
    for (let m = 0; m < 8; m++) {
      const running = ALLR.filter((_, i) => m & (1 << i));
      const g = make(running);
      const has = (e) => running.includes(e);
      expect([m, lead(g, "card")]).toEqual([m, has("g.game") ? "g.game" : has("scene.carry") ? "scene.carry" : has("keep.plain") ? "keep.plain" : null]);
      expect([m, lead(g, "plain")]).toEqual([m, has("scene.carry") ? "scene.carry" : null]);
      // a native part ahead of a keeper only by input order: both generic, the nearer then the first
      expect([m, lead(g, "kept")]).toEqual([m, g.chains.kept.filter((h) => h.via != null)[0]?.ext ?? null]);
      // a child: its own trait is the game's (it holds it itself), the carry on what it hangs on is farther
      expect([m, lead(g, "kid")]).toEqual([m, has("g.game") ? "g.game" : has("scene.carry") ? "scene.carry" : null]);
      for (const id of scene.ids) {
        const l = lead(g, id);
        if (l != null) expect(responders(g, id)).toContain(l);
      }
    }
    expect(isGeneric(make(ALLR), "scene.carry") && isGeneric(make(ALLR), "keep.plain") && !isGeneric(make(ALLR), "g.game")).toBe(true);
  });

  it("one outline in the lead's colour; the whole chain only when hovered", () => {
    const g = make(ALLR);
    const colour = colours(ALLR);
    expect(looks(g, colour).card.outline).toEqual([colour("g.game")]);
    expect(looks(g, colour).plain.outline).toEqual([colour("scene.carry")]);
    expect(looks(g, colour, { focus: "card", banded: "card" }).card.outline).toEqual(responders(g, "card").slice(0, BANDS).map(colour));
    expect(looks(g, colour, { focus: "card", banded: "card" }).plain.outline).toEqual([colour("scene.carry")]);
  });
});

describe("glyphs", () => {
  const objects = { c: { name: "Card", transform: T }, d: { name: "Deck", transform: T }, e: { name: "Engine", transform: T } };
  const scene = { d: { objects, traits: {} }, objects, ids: ["c", "d", "e"], parents: resolveParents(objects), groups: resolveGroups(objects) };
  const metas = ["t.game", "scene.xray"].map((id) => ({ id, type: id === "scene.xray" ? "scene:view" : "scene:extension", name: id === "t.game" ? "Game" : "X-ray", traits: [] }));
  const make = (inspect, display = {}) => buildGears({ metas, scene, running: [{ id: "t.game", scope: "scene" }], inspect, owners: { layers: [], labels: [], display } });
  const who = (v, mine) => (mine ? "you" : { "v:ben": "Ben" }[v] ?? "someone");

  it("a lock for a claim, a hand for the pose that counts, a gear for a process, an eye for another's override; in that order; none for the X-ray's own", () => {
    const g = make(
      [
        { id: "scene.claims", value: { claims: [{ id: "c", kind: "turn", viewer: "v:ben" }, { id: null, kind: "seat", viewer: "v:ana", mine: true }] } },
        { id: "scene.poses", value: { holds: [{ id: "c", viewer: "v:ben", rank: 0 }, { id: "d", viewer: "v:ana", mine: true, rank: 1 }] } },
        { id: "scene.clock", value: { drives: [{ id: "c", ext: "t.game" }, { id: "gone", ext: "t.game" }] } },
      ],
      { c: [{ ext: "t.game", fields: ["hidden"] }, { ext: "scene.xray", fields: ["tint", "opacity", "outline"] }], d: [{ ext: "scene.xray", fields: ["opacity"] }] },
    );
    const out = glyphs(g, { who, self: "scene.xray" });
    // (a claim on the scene is the scene's: id null)
    expect(new Set(out.keys())).toEqual(new Set(["c", null]));
    expect(out.get(null)).toEqual([{ kind: "lock", title: "seat claimed by you" }]);
    expect(out.get("c")).toEqual([
      { kind: "lock", title: "turn claimed by Ben" },
      { kind: "hand", title: "held by Ben" },
      { kind: "gear", title: "driven by a process of Game" },
      { kind: "eye", title: "shown otherwise by Game (hidden)" },
    ]);
    expect(Object.keys(GLYPHS)).toEqual(["lock", "hand", "gear", "eye", "link"]);
  });

  it("links are boxes: their role, or closed with why", () => {
    const g = make([]);
    const out = glyphs(g, { links: [{ path: ["d"], role: "acting", open: true }, { path: ["e"], role: "pinned", open: false, reason: "unavailable" }, { path: ["d", "x"], role: "acting", open: true }] });
    expect(out.get("d")).toEqual([{ kind: "link", title: "acting" }]);
    expect(out.get("e")).toEqual([{ kind: "link", title: "pinned, closed: unavailable" }]);
  });

  it("a yielding hand and a lapsing lock say so", () => {
    const g = make([{ id: "scene.claims", value: { claims: [{ id: "c", kind: "turn", viewer: "v:ben", lapsing: true }] } }, { id: "scene.poses", value: { holds: [{ id: "c", viewer: "v:ben", rank: 0, yields: true }] } }]);
    expect(glyphs(g, { who }).get("c").map((x) => x.title)).toEqual(["turn claimed by Ben (lapsing)", "held by Ben (yielding)"]);
  });
});

describe("the route strip", () => {
  const g = buildGears({ metas: [{ id: "t.game", type: "scene:extension", name: "Game" }, { id: "scene.edit", type: "scene:extension", name: "Edit" }], scene: { d: { objects: { c: { name: "Card", transform: T } }, traits: {} }, objects: { c: { name: "Card", transform: T } }, ids: ["c"], parents: new Map(), groups: new Map() } });
  const colour = colours(["t.game", "scene.edit"]);
  const o = { g, colour };

  it("boxes in the chain's order, only those offered it; the taker marked in its colour", () => {
    const r = { type: "click", path: ["c"], steps: [{ step: "hand", ext: "scene.edit", name: "Edit" }, { step: "holder", ext: "t.game", holder: "c" }, { step: "plugin", ext: "v.a" }], took: 1 };
    const b = routeBoxes(r, o);
    expect([b.type, b.on, b.took]).toEqual(["click", "Card", true]);
    expect(b.boxes.map((x) => [x.kind, x.label, x.names, x.took?.name ?? null])).toEqual([
      ["hand", "Tools", ["Edit"], null],
      ["holder", "Holders", ["Game"], "Game"],
      ["plugin", "View plugins", ["v.a"], null],
    ]);
    expect(b.boxes[1].took.colour).toBe(colour("t.game"));
  });

  it("nobody took it: no box marked; the body and the default are boxes of their own", () => {
    const b = routeBoxes({ type: "key", path: null, steps: [{ step: "body", ext: "t.game", body: "walk" }, { step: "default", ext: null }], took: -1 }, o);
    expect([b.on, b.took, b.boxes.map((x) => [x.label, x.names, x.took])]).toEqual(["nothing", false, [["Body", ["Game"], null], ["Default", ["default"], null]]]);
  });

  it("the latest route always, even untaken; the older ones only if something took them, five at most, newest first", () => {
    const mk = (n, took) => Array.from({ length: n }, (_, i) => ({ type: `e${i}`, path: [], steps: [], took: took(i) }));
    const s = strip(mk(9, () => 0), o);
    expect([s.last.type, s.older.map((r) => r.type)]).toEqual(["e8", ["e7", "e6", "e5", "e4", "e3"]]);
    const u = strip(mk(9, (i) => (i % 3 === 0 ? 0 : -1)), o);
    expect([u.last.type, u.last.took, u.older.map((r) => r.type)]).toEqual(["e8", false, ["e6", "e3", "e0"]]);
    expect(strip(mk(3, () => -1), o).older).toEqual([]);
    expect(strip(mk(1, () => -1), o).last.type).toBe("e0");
    expect(strip([], o)).toEqual({ last: null, older: [] });
  });
});

describe("verbs", () => {
  it("a verb's chip: enabled, disabled with why, out of reach; its label and its key apart", () => {
    expect(verbChip({ name: "Draw", keys: ["d"], enabled: true })).toEqual({ text: "Draw", key: "D", state: "on", title: "enabled" });
    expect(verbChip({ name: "Draw", label: "Draw to my hand", keys: [], enabled: false, reason: "not your turn" })).toEqual({ text: "Draw to my hand", key: null, state: "off", title: "disabled: not your turn" });
    expect(verbChip({ name: "Lift", keys: ["Delete"], enabled: false, reason: TOO_FAR })).toEqual({ text: "Lift", key: "Delete", state: "far", title: "out of reach" });
  });
});
