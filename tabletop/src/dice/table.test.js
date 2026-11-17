// Liar's dice as data (games/liars-dice.json: what's there, where, and what
// a cup can do there before anyone touches it; its template is the table
// writer's, table/template.test.js), and the cup part, through a stand-in of
// the stage's drop context.

import { cupsOf, policy } from "./cup.js";
import { DICE_EACH, SETS, cupPart } from "./table.js";
import { emptyScene } from "../empty-scene.js";
import { plugins } from "../index.js";
import { validate } from "../../contract/v1/validate.js";
import game from "../../games/liars-dice.json" with { type: "json" };

/** The game's things as a scene would hold them: each where its setup says, with its piece's traits (every thing here is one copy). */
function table() {
  const objects = {};
  game.setup.forEach((t, i) => {
    const piece = game.pieces[t.piece];
    objects[`o${i}`] = { name: t.name ?? piece.name, parent: null, transform: { position: t.at.position, rotation: t.at.rotation ?? [0, 0, 0], scale: 1 }, ...(piece.traits ? { traits: structuredClone(piece.traits) } : {}) };
  });
  return { objects };
}

function fakeCtx() {
  const doc = emptyScene();
  const files = new Map();
  const notices = [];
  let n = 0;
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
    change: (fn) => fn(doc),
    notify: (text, kind) => notices.push({ text, kind }),
    worldOf: () => null,
  };
}

describe("Liar's dice, as data", () => {
  it("is a valid tabletop-game, registered by its id", async () => {
    expect(validate(game)).toEqual({ ok: true, stage: null, errors: [] });
    const p = plugins.find((x) => x.type === "tabletop:game" && x.id === "liars-dice");
    expect(p.id).toBe("liars-dice");
    expect(await p.load()).toEqual(game);
  });

  it("six seats, each a cup and five dice in its set's colour; a pool; a table; seats named for the sets", () => {
    const d = table();
    const objects = Object.values(d.objects);
    expect(objects.filter((o) => o.traits?.["dice.cup"]).length).toBe(6);
    expect(objects.filter((o) => o.traits?.["dice.die"]).length).toBe(6 * DICE_EACH);
    expect(game.pieces.pool.locked && game.pieces.table.locked).toBe(true);
    expect(Object.entries(game.seats).map(([id, s]) => [id, s.name])).toEqual(SETS.map((set, i) => [`seat${i + 1}`, `${set.name} (Player ${i + 1})`]));
    // every cup starts lifted, nobody's, with nothing shaken and no draw: its trait is all it needs to be drawn for
    for (const o of objects.filter((x) => x.traits?.["dice.cup"])) expect(o.traits).toEqual({ "dice.cup": { up: true, blind: false, holder: null, roll: null, round: null } });
    for (const o of objects.filter((x) => x.traits?.["dice.die"])) expect(o.traits).toEqual({ "dice.die": {} });
    // each set's dice and cup in its colour: the die is drawn from a die doc of that body and ink
    for (const set of SETS) {
      const k = set.name.toLowerCase();
      expect(game.pieces[`${k}-die`].doc).toMatchObject({ "@patchwork": { type: "die" }, shape: "d6", body: set.body, ink: set.ink });
      expect(game.pieces[`${k}-cup`].parts[0].color).toBe(set.body);
    }
  });

  it("every cup has its own five dice beside it, covers nothing, and keeps nothing from anyone", () => {
    const snap = { objects: table().objects };
    const { cups, covered } = cupsOf(snap);
    expect(cups.size).toBe(6);
    expect(covered.size).toBe(0);
    const p = policy(snap, []);
    const top = game.setup.find((t) => t.piece === "pool").at.position[1];
    for (const c of cups.values()) {
      const set = snap.objects[c.id].name.replace(" cup", "");
      expect(c.front.map((id) => snap.objects[id].name).sort()).toEqual([1, 2, 3, 4, 5].map((i) => `${set} die ${i}`));
      expect(c.covering).toBe(false);
      expect(p(c.id)).toEqual({ show: "all" });
      // on the table's top, inside its edge
      expect(c.t.position[1]).toBe(top);
      expect(Math.hypot(c.t.position[0], c.t.position[2])).toBeLessThan(0.55);
    }
    for (const [id, o] of Object.entries(snap.objects)) if (o.traits?.["dice.die"]) expect(p(id)).toBe(null);
  });
});

describe("the cup part", () => {
  it("the cup part: a cup with its five dice in front of it, on what it's put on", async () => {
    const ctx = fakeCtx();
    ctx.doc().objects.slab = { name: "slab", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } };
    const id = await cupPart.create(ctx, { parent: "slab", transform: { position: [0.1, 0.02, 0], rotation: [0, 0.5, 0], scale: 1 } });
    const snap = { objects: ctx.doc().objects };
    const c = cupsOf(snap).cups.get(id);
    expect(c.front.length).toBe(5);
    expect(snap.objects[id].parent).toBe("slab");
    expect(snap.objects[id].traits).toEqual({ "dice.cup": { up: true, blind: false, holder: null, roll: null, round: null }, "scene.carry": {} });
  });
});
