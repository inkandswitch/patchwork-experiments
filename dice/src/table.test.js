// The Liar's dice table and the cup part, laid out through a stand-in of
// the stage's drop context: what's made, where, and what a cup can do
// there before anyone touches it.

import { cupsOf, policy } from "./cup.js";
import { TABLE_RADIUS, TABLE_TOP } from "./cup-glb.js";
import { DICE_EACH, SETS, cupPart, layOutTable } from "./table.js";
import { emptyScene } from "./test/empty-scene.js";

function fakeCtx({ lots = true, seats = true } = {}) {
  const doc = emptyScene();
  const files = new Map();
  const notices = [];
  let n = 0;
  const plugins = [
    ...(lots ? [{ id: "keep.lots", lots: true, module: { attach: () => ({ "keep.lots": {} }) } }] : []),
    ...(seats ? [{ id: "scene.seats", roster: true, module: { lay: (d, s) => (d.traits["scene.seats"] = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, player: null }]))) } }] : []),
  ];
  const reg = { filter: (fn) => plugins.filter(fn), load: async (id) => ({ module: plugins.find((p) => p.id === id).module }) };
  return {
    doc: () => doc,
    files,
    notices,
    newId: (p) => `${p}${n++}`,
    file: async (key, make) => {
      if (!files.has(key)) {
        const f = await make();
        files.set(key, { url: `automerge:file${files.size}`, hint: f.hint, bytes: f.bytes.length });
      }
      return { url: files.get(key).url, hint: structuredClone(files.get(key).hint) };
    },
    registry: async (type) => (type === "scene:extension" ? reg : null),
    change: (fn) => fn(doc),
    notify: (text, kind) => notices.push({ text, kind }),
    worldOf: () => null,
  };
}

describe("the Liar's dice table", () => {
  it("six seats, each a cup and five dice in its set's colour; a pool; a table; in play", async () => {
    const ctx = fakeCtx();
    await layOutTable(ctx);
    const d = ctx.doc();
    const objects = Object.values(d.objects);
    expect(objects.filter((o) => o.traits?.["dice.cup"]).length).toBe(6);
    expect(objects.filter((o) => o.traits?.["dice.die"]).length).toBe(6 * DICE_EACH);
    expect(objects.filter((o) => o.name === "Pool" && o.locked).length).toBe(1);
    expect(objects.filter((o) => o.name === "Table" && o.locked).length).toBe(1);
    expect(Object.keys(d.traits["scene.seats"])).toEqual(["seat1", "seat2", "seat3", "seat4", "seat5", "seat6"]);
    expect(d.view.activity).toBe("play");
    expect(d.title).toBe("Liar's dice");
    expect(d.order.length).toBe(objects.length);
    // one file per kind of thing: a table, a pool, and a cup and a die per set
    expect(ctx.files.size).toBe(2 + 2 * SETS.length);
    // every cup is drawn on by lots, and starts lifted, nobody's, with nothing shaken
    for (const o of objects.filter((x) => x.traits?.["dice.cup"])) {
      expect(o.traits["keep.lots"]).toEqual({});
      expect(o.traits["dice.cup"]).toEqual({ up: true, blind: false, holder: null, roll: null });
    }
    expect(ctx.notices.some((n) => n.kind === "warn")).toBe(false);
  });

  it("every cup has its own five dice beside it, covers nothing, and keeps nothing from anyone", async () => {
    const ctx = fakeCtx();
    await layOutTable(ctx);
    const snap = { objects: ctx.doc().objects };
    const { cups, covered } = cupsOf(snap);
    expect(covered.size).toBe(0);
    const p = policy(snap, []);
    for (const c of cups.values()) {
      const set = snap.objects[c.id].name.replace(" cup", "");
      expect(c.front.map((id) => snap.objects[id].name).sort()).toEqual([1, 2, 3, 4, 5].map((i) => `${set} die ${i}`));
      expect(c.covering).toBe(false);
      expect(p(c.id)).toEqual({ show: "all" });
      // on the table, inside its edge
      expect(c.t.position[1]).toBe(TABLE_TOP);
      expect(Math.hypot(c.t.position[0], c.t.position[2])).toBeLessThan(TABLE_RADIUS - 0.05);
    }
    // nothing of the table is anyone's business (a die nobody shook gets no answer)
    for (const [id, o] of Object.entries(snap.objects)) if (o.traits?.["dice.die"]) expect(p(id)).toBe(null);
  });

  it("without lots or seats installed, it's still laid out, and says what's missing", async () => {
    const ctx = fakeCtx({ lots: false, seats: false });
    await layOutTable(ctx);
    expect(Object.values(ctx.doc().objects).filter((o) => o.traits?.["keep.lots"]).length).toBe(0);
    expect(ctx.notices.filter((n) => n.kind === "warn").map((n) => n.text)).toEqual([
      "Nothing installed here draws lots, so these cups can't be shaken fairly: add the keep package.",
      "Nothing installed here owns seats, so this table has none.",
    ]);
  });

  it("the cup part: a cup with its five dice in front of it, on what it's put on", async () => {
    const ctx = fakeCtx();
    ctx.doc().objects.slab = { name: "slab", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } };
    const id = await cupPart.create(ctx, { parent: "slab", transform: { position: [0.1, 0.02, 0], rotation: [0, 0.5, 0], scale: 1 } });
    const snap = { objects: ctx.doc().objects };
    const c = cupsOf(snap).cups.get(id);
    expect(c.front.length).toBe(5);
    expect(snap.objects[id].parent).toBe("slab");
    expect(snap.objects[id].traits["keep.lots"]).toEqual({});
  });
});
