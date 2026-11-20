// The translation's parts, over finite cases: every quarter-turn pose of a
// face-down deck comes out as TTS has it; every tile shape, every die, both
// kinds of bag; and an image's size read from its header.
import { describe, it, expect } from "vitest";
import { D6_ROTATIONS, TABLE_NONE_SINK, customDieFaces, sideUp, translate, tableHeight } from "./translate.js";
import { dieOf } from "../dice/die.js";
import { solid } from "../dice/solids.js";
import { unityRotation } from "./convert.js";
import { tableLayout } from "../setup.js";
import { STATES } from "../states.js";
import { convertRotation, sceneRotationMatrix } from "./convert.js";
import { validate, errorText } from "../../contract/v2/validate.js";
import { applyRecipe } from "../../contract/v2/recipe.js";

const save = (objects, extra = {}) => ({ saveName: "S", gameMode: "", table: "", tableURL: "", note: "", rules: "", snapPoints: [], objects, ...extra });
const node = (name, more = {}) => ({ path: "0", guid: "", name, kind: more.kind, nickname: "", description: "", transform: { posX: 0, posY: 1, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...(more.transform ?? {}) }, color: null, locked: false, tags: [], mesh: null, image: null, customDeck: null, cardId: null, deckIds: null, pdf: null, number: 1, rotationValues: null, snapPoints: [], handColor: null, contents: [], states: [], children: [], ...more });
const DECK = { 1: { FaceURL: "https://x/face.png", BackURL: "https://x/back.png", NumWidth: 10, NumHeight: 7 } };
const card = (cardId) => node("Card", { kind: "card", cardId, customDeck: DECK });
/** A file doc URL for each asset URL: base58 letters only, as an automerge URL has. */
const files = (u) => `automerge:F${u.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(-20)}`;
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

describe("a deck, turned every way", () => {
  it("for every quarter turn about every axis, its cards lie as TTS has them: level × turned over when face down", () => {
    const q = [0, 90, 180, 270];
    let n = 0;
    for (const x of q)
      for (const y of q)
        for (const z of q) {
          const deck = node("Deck", { kind: "deck", contents: [card(100), card(101)], customDeck: DECK, transform: { rotX: x, rotY: y, rotZ: z } });
          const { game } = translate(save([deck]), { file: files });
          const t = game.setup.find((s) => s.deck);
          const want = sceneRotationMatrix(convertRotation([x, y, z]));
          const at = sceneRotationMatrix(t.at.rotation ?? [0, 0, 0]);
          const got = t.deck.faceDown ? mul(at, sceneRotationMatrix([0, 0, Math.PI])) : at;
          // (rotations are kept to the microradian)
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(got[i][j]).toBeCloseTo(want[i][j], 5);
          n++;
        }
    expect(n).toBe(64);
  });
});

describe("pieces", () => {
  it("each tile Type is its outline; a token is cut from its image", () => {
    const outlines = [0, 1, 2, 3].map((type) => {
      const { game } = translate(save([node("Custom_Tile", { kind: "tile", image: { ImageURL: "https://x/t.png", CustomTile: { Type: type, Thickness: 0.2 } } })]), { file: files });
      return Object.values(game.pieces).find((p) => p.name === "Tile").parts[0].outline;
    });
    expect(outlines).toEqual(["rect", "hex", "circle", "rounded"]);
    const { game } = translate(save([node("Custom_Token", { kind: "token", image: { ImageURL: "https://x/t.png", CustomToken: { Thickness: 0.2 } } })]), { file: files });
    expect(Object.values(game.pieces).find((p) => p.name === "Token").parts[0]).toMatchObject({ outline: "cutout", at: [0, -0.00254, 0] });
    // its image unhad, it's a plain slab: a cut-out needs its image
    const bare = translate(save([node("Custom_Token", { kind: "token", image: { ImageURL: "https://x/t.png", CustomToken: {} } })]), { file: () => null });
    expect(Object.values(bare.game.pieces).find((p) => p.name === "Token").parts[0].outline).toBe("rect");
  });

  it("every die is a die document of its shape, sized from its scale", () => {
    const shapes = [4, 6, 8, 10, 12, 20].map((s) => Object.values(translate(save([node(`Die_${s}`, { kind: "die" })])).game.pieces).find((p) => p.doc).doc.shape);
    expect(shapes).toEqual(["d4", "d6", "d8", "d10", "d12", "d20"]);
    const custom = [0, 1, 2, 3, 4, 5].map((type) => Object.values(translate(save([node("Custom_Dice", { kind: "die", image: { CustomDice: { Type: type } }, transform: { scaleX: 2, scaleY: 2, scaleZ: 2 } })])).game.pieces).find((p) => p.doc).doc);
    expect(custom.map((d) => [d.shape, d.size])).toEqual(["d4", "d6", "d8", "d10", "d12", "d20"].map((s) => [s, 0.0508]));
  });

  it("a bag hands out what it holds; an infinite bag, copies", () => {
    for (const [name, rule] of [["Bag", "random"], ["Infinite_Bag", "random-replace"], ["Custom_Model_Infinite_Bag", "random-replace"]]) {
      const { game } = translate(save([node(name, { kind: "bag", contents: [node("Checker_red", { kind: "piece" })] })]));
      const bag = game.setup.find((t) => t.contents);
      expect([game.pieces[bag.piece].bag.rule, bag.contents.length]).toEqual([rule, 1]);
    }
  });

  it("a card image is its cell of the sheet, turned 180° (TTS reads an image from its −Z)", () => {
    const { game } = translate(save([card(123 - 100 + 100)]), { file: files });
    const face = Object.values(game.pieces).find((p) => p.back);
    expect(face.parts[0].top).toEqual({ file: files("https://x/face.png"), rect: [0.3, 0.285714, 0.1, 0.142857], turn: 180 });
    expect(game.pieces[face.back].parts[0].top).toEqual({ file: files("https://x/back.png"), turn: 180 });
  });

  it("whatever a save holds, the game is valid by the format: one of everything here", () => {
    const objects = [
      node("Deck", { kind: "deck", contents: [card(100), card(105)], customDeck: DECK, transform: { rotZ: 180 } }),
      card(102),
      node("Custom_Tile_Stack", { kind: "tile", number: 4, image: { ImageURL: "https://x/t.png", CustomTile: { Type: 1 } } }),
      node("Custom_Board", { kind: "board", image: { ImageURL: "https://x/b.png", WidthScale: 1.5 }, snapPoints: [{ position: [1, 0.2, 1], rotation: [0, 90, 0], tags: ["Card"] }] }),
      node("Figurine_Custom", { kind: "figurine", image: { ImageURL: "https://x/f.png" } }),
      node("Custom_Model", { kind: "model", mesh: { MeshURL: "https://x/m.obj", DiffuseURL: "https://x/m.png", MaterialIndex: 2 } }),
      node("Custom_Model_Bag", { kind: "bag", contents: [card(103), node("Deck", { kind: "deck", deckIds: [104, 106], customDeck: DECK })] }),
      node("Die_6", { kind: "die" }),
      node("PlayerPawn", { kind: "piece" }),
      node("Custom_PDF", { kind: "pdf" }),
      node("Custom_Assetbundle", { kind: "assetbundle" }),
      node("HandTrigger", { kind: "zone", handColor: "Blue", transform: { posZ: -20, scaleX: 12, scaleY: 5, scaleZ: 4 } }),
      node("HandTrigger", { kind: "zone", handColor: "Red", transform: { posZ: 20, rotY: 180, scaleX: 12, scaleY: 5, scaleZ: 4 } }),
    ];
    const t = translate(save(objects, { tableURL: "https://x/table.png", snapPoints: [{ position: [0, 1, 0], rotation: null, tags: [] }], note: "Read the rules.", rules: "Don't." }), { file: files });
    const r = validate(t.game);
    expect(r.ok, errorText(r)).toBe(true);
    expect(t.counts).toMatchObject({ cards: 6, decks: 2, bags: 1, dice: 1, seats: 2 });
    expect(t.game.about).toMatch(/Don't\.\n\nRead the rules\.$/);
    expect(Object.keys(t.game.seats)).toEqual(["blue", "red"]);
    // a tile cut to its picture: as wide as the picture says, measured when it's drawn (square until then)
    const tile = Object.values(t.game.pieces).find((p) => p.name === "Tile").parts[0];
    expect(tile.aspect).toBe("image");
    expect(tile.size[0] / tile.size[1]).toBeCloseTo(1, 6);
  });

  it("stops at its limit, and says so", () => {
    const t = translate(save(Array.from({ length: 5 }, () => node("PlayerPawn", { kind: "piece" }))), { maxObjects: 3 });
    expect(t.game.setup.filter((s) => s.piece && t.game.pieces[s.piece].name === "PlayerPawn")).toHaveLength(3);
    expect(t.warnings).toEqual(["stopped at 3 objects: 2 more were left out"]);
  });

  it("a seat's camera has its whole hand in the lower part of the picture and the table's middle above it, at every side of the table", () => {
    // four hands as Sovereign's lie: 15.5 × 3.6 units, 28.6 out from the middle, each side's turned to face it
    const hands = [["Red", 6.7, 28.7, 0], ["Yellow", -28.6, -6.1, 90], ["Green", 8.6, -28.6, 180], ["Pink", 28.6, 4.6, 270]].map(([c, x, z, r]) =>
      node("HandTrigger", { kind: "zone", handColor: c, transform: { posX: x, posY: 2.9, posZ: z, rotY: r, scaleX: 15.5, scaleY: 6, scaleZ: 3.556 } }),
    );
    const { game } = translate(save([...hands, node("PlayerPawn", { kind: "piece", transform: { posX: 30, posZ: 30 } }), node("PlayerPawn", { kind: "piece", transform: { posX: -30, posZ: -30 } })]), { file: files });
    const middle = game.setup.find((s) => game.pieces[s.piece]?.name === "Table").at.position;
    // the stage's camera: 45° high; as wide as a 4:3 picture
    const half = { v: (22.5 * Math.PI) / 180, h: Math.atan(Math.tan((22.5 * Math.PI) / 180) * (4 / 3)) };
    const sub = (a, b) => a.map((v, i) => v - b[i]);
    const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (a) => a.map((v) => v / Math.hypot(...a));
    for (const [sid, seat] of Object.entries(game.seats)) {
      const { position: eye, target } = seat.camera;
      const f = unit(sub(target, eye));
      const r = unit(cross(f, [0, 1, 0]));
      const up = cross(r, f);
      /** A point's angles off the middle of the picture: { v (up +), h }. */
      const seen = (p) => {
        const d = sub(p, eye);
        return { v: Math.atan2(dot(d, up), dot(d, f)), h: Math.atan2(dot(d, r), dot(d, f)) };
      };
      const hand = game.setup.find((s) => s.seat === sid);
      const { min, max } = game.pieces[hand.piece].zone;
      const yaw = hand.at.rotation?.[1] ?? 0;
      for (const x of [min[0], max[0]])
        for (const z of [min[2], max[2]]) {
          const p = [hand.at.position[0] + Math.cos(yaw) * x + Math.sin(yaw) * z, 0, hand.at.position[2] - Math.sin(yaw) * x + Math.cos(yaw) * z];
          const a = seen(p);
          expect(a.v, `${sid}: its hand's corner below the middle of the picture`).toBeLessThan(0);
          expect(a.v, `${sid}: …and in it`).toBeGreaterThan(-half.v + 0.05);
          expect(Math.abs(a.h), `${sid}: …across`).toBeLessThan(half.h);
        }
      const m = seen([middle[0], 0, middle[2]]);
      expect(m.v, `${sid}: the table's middle in the upper half`).toBeGreaterThan(0);
      expect(m.v).toBeLessThan(half.v);
      expect(Math.abs(m.h)).toBeLessThan(1e-6);
    }
  });
});

describe("States: a piece's other looks", () => {
  const MESH = (u, color) => ({ mesh: { MeshURL: `https://x/${u}.obj`, DiffuseURL: "https://x/skin.png", MaterialIndex: 1 }, color });
  const YELLOW = { r: 1, g: 0.72, b: 0 };
  const ship = (stateId = null, more = {}) => node("Custom_Model", { kind: "model", nickname: "Ship", ...MESH("ship", YELLOW), ...(stateId ? { stateId: String(stateId) } : {}), ...more });
  const damaged = (stateId) => node("Custom_Model", { kind: "model", nickname: "Ship (Damaged)", ...MESH("shipdamaged", { r: 0.96, g: 0.78, b: 0.27 }), stateId: String(stateId) });

  it("an object with States is one piece with a state for each, in TTS's order, each named by its Nickname; its things all one piece", () => {
    const a = ship(null, { states: [damaged(2)] });
    const b = ship(null, { states: [damaged(2)], transform: { posX: 3 } });
    const { game, counts, skipped } = translate(save([a, b]), { file: files });
    const kinds = Object.entries(game.pieces).filter(([, p]) => p.states);
    expect(kinds).toHaveLength(1);
    const [kind, piece] = kinds[0];
    expect(piece.name).toBe("Ship");
    expect(piece.states.map((x) => x.name)).toEqual(["Ship (Damaged)"]);
    expect(piece.states[0].parts[0]).toMatchObject({ shape: "model", file: files("https://x/shipdamaged.obj") });
    expect(piece.states[0].parts[0].color).not.toBe(piece.parts[0].color);
    expect(game.setup.filter((t) => t.piece === kind)).toHaveLength(2);
    expect(game.setup.some((t) => t.state)).toBe(false);
    expect(counts.states).toBe(2); // (each object's other states)
    expect(Object.keys(skipped).filter((k) => /state/.test(k))).toEqual([]);
    expect(validate(game)).toEqual({ ok: true, stage: null, errors: [] });
  });

  it("an object saved in another of its states is the same piece, laid out in that state (the object is the state States leaves out)", () => {
    const sunk = node("Custom_Model", { kind: "model", nickname: "Ship (Damaged)", ...MESH("shipdamaged", { r: 0.96, g: 0.78, b: 0.27 }), states: [ship(1)] });
    const fine = ship(null, { states: [damaged(2)] });
    const { game } = translate(save([fine, sunk]), { file: files });
    const kinds = Object.keys(game.pieces).filter((k) => game.pieces[k].states);
    expect(kinds).toHaveLength(1);
    const things = game.setup.filter((t) => t.piece === kinds[0]);
    expect(things.map((t) => t.state ?? null)).toEqual([null, "Ship (Damaged)"]);
    // laid out: the damaged one shows its state's look, and both can be turned to either
    const layout = tableLayout(game, { fileOf: (ref) => ({ url: `automerge:${ref.replace(/#/, "x")}` }), rng: () => 0.5 });
    const laid = Object.values(layout.objects).filter((o) => o.traits?.[STATES]);
    expect(laid.map((o) => o.traits[STATES].own)).toEqual([0, 1]);
    expect(laid[1].sourceUrl).toBe(`automerge:${kinds[0]}x1`);
  });

  it("names a state with no Nickname of its own (none, or one another look has) by the piece and its number", () => {
    const board = (stateId, nickname) => node("Custom_Board", { kind: "board", nickname, image: { ImageURL: `https://x/map${stateId}.png` }, ...(stateId > 1 ? { stateId: String(stateId) } : {}) });
    const b = { ...board(1, "Map"), states: [board(2, "Map"), board(3, ""), board(4, "Map for 4")] };
    const { game } = translate(save([b]), { file: files });
    const piece = Object.values(game.pieces).find((p) => p.states);
    expect([piece.name, ...piece.states.map((x) => x.name)]).toEqual(["Map", "Map (state 2)", "Map (state 3)", "Map for 4"]);
    expect(validate(game).ok).toBe(true);
  });

  it("leaves out a card's and a deck's States, and a state that isn't the same sort of thing (a die's that's a model), counted", () => {
    const c = { ...card(100), states: [{ ...card(101), stateId: "2" }] };
    const deck = node("Deck", { kind: "deck", customDeck: DECK, contents: [{ ...card(102), states: [{ ...card(103), stateId: "2" }] }], states: [{ ...card(104), stateId: "2" }] });
    const die = node("Die_6", { kind: "die", states: [ship(2)] });
    const { game, skipped, counts } = translate(save([c, deck, die]), { file: files });
    expect(skipped).toMatchObject({ "Card (another state of a card)": 2, "Card (another state of a deck)": 1, "Custom_Model (another state, not drawn as one)": 1 });
    expect(Object.values(game.pieces).some((p) => p.states)).toBe(false);
    expect(counts.states).toBe(0);
  });
});

describe("a custom d6: its faces are cells of its image", () => {
  const DIE = "https://x/assault-die.png";
  const defaults = D6_ROTATIONS.map(([x, y, z], k) => ({ Value: String(k + 1), Rotation: { x, y, z } }));
  const custom = (more = {}) => node("Custom_Dice", { kind: "die", image: { ImageURL: DIE, CustomDice: { Type: 1 } }, rotationValues: defaults, ...more });

  it("each RotationValue's side, found from its turn, is a side of the d6 of its own, opposite values opposite (TTS's defaults sum to 7)", () => {
    const outcomes = solid("d6").outcomes;
    const sides = D6_ROTATIONS.map((r) => outcomes.findIndex((o) => o.up.every((v, i) => Math.abs(v - sideUp(r)[i]) < 1e-9)));
    expect(new Set(sides).size).toBe(6);
    for (let k = 0; k < 6; k++) expect(outcomes[sides[k]].opposite).toBe(sides[5 - k]);
  });

  it("the side a turn puts up is the one Unity's rotation lifts to +Y (z mirrored into the format's frame)", () => {
    for (const r of D6_ROTATIONS) {
      const m = unityRotation(r);
      const n = sideUp(r);
      const local = [n[0], n[1], -n[2]];
      expect([0, 1, 2].map((i) => m[i][0] * local[0] + m[i][1] * local[1] + m[i][2] * local[2]).map((v) => +v.toFixed(9) + 0)).toEqual([0, 1, 0]);
    }
  });

  it("each face is its value's cell of the image as TTS's shipped D6.png template has it, named by its value, which is how it reads when rolled", () => {
    const { game, approximated } = translate(save([custom()]), { file: files });
    const doc = Object.values(game.pieces).find((p) => p.doc).doc;
    const die = dieOf(doc);
    const outcomes = solid("d6").outcomes;
    // the template (2048²) in thirds, the top row unused: 2 4 5 across the middle, 1 3 6 across the bottom
    const template = { 1: [0, 2], 2: [0, 1], 3: [1, 2], 4: [1, 1], 5: [2, 1], 6: [2, 2] };
    for (let k = 0; k < 6; k++) {
      const i = outcomes.findIndex((o) => o.up.every((v, j) => Math.abs(v - sideUp(D6_ROTATIONS[k])[j]) < 1e-9));
      const [col, row] = template[k + 1];
      expect(die.faces[i].label).toBe(String(k + 1));
      expect(die.faces[i].image.file).toBe(files(DIE));
      expect(die.faces[i].image.rect).toEqual([col / 3, row / 3, 1 / 3, 1 / 3].map((v) => +v.toFixed(6)));
    }
    expect(approximated).toEqual({});
    expect(validate(game).ok).toBe(true);
  });

  it("its values may be anything, on any side: a value is the cell of the side it names, wherever TTS's defaults put that side", () => {
    // the sides as TTS has them, relabelled: a face of hits where 1 was, blanks for 2 and 5
    const words = ["Hit", "", "Miss", "Miss", "", "Hit 2"];
    const rv = D6_ROTATIONS.map(([x, y, z], k) => ({ Value: words[k], Rotation: { x, y, z } }));
    const faces = customDieFaces(custom({ rotationValues: rv }), (cell) => ({ file: "automerge:img", rect: [cell.x, cell.y, cell.w, cell.h] }));
    const die = dieOf({ shape: "d6", faces });
    const outcomes = solid("d6").outcomes;
    const at = (k) => outcomes.findIndex((o) => o.up.every((v, j) => Math.abs(v - sideUp(D6_ROTATIONS[k])[j]) < 1e-9));
    expect(die.faces[at(0)].label).toBe("Hit");
    expect(die.faces[at(5)].label).toBe("Hit 2");
    expect(die.faces[at(1)].label).toBe("blank");
    // turns that put two values on one side: not a die this can read (numbered plainly, approximated)
    const bad = D6_ROTATIONS.map(([x, y, z], k) => ({ Value: String(k), Rotation: { x: 0, y: 0, z: 0 } }));
    expect(customDieFaces(custom({ rotationValues: bad }), () => null)).toBe(null);
    const t = translate(save([custom({ rotationValues: bad })]), { file: files });
    expect(t.approximated).toEqual({ Custom_Dice: 1 });
  });

  it("without its image, each face carries its value as a mark; another custom die (a d20) is numbered the usual way, counted", () => {
    const { game } = translate(save([custom()]), { file: () => null });
    const die = dieOf(Object.values(game.pieces).find((p) => p.doc).doc);
    expect(die.faces.every((f) => f.image === null && f.marks.length === 1)).toBe(true);
    const d20 = translate(save([custom({ image: { ImageURL: DIE, CustomDice: { Type: 5 } } })]), { file: files });
    expect(Object.values(d20.game.pieces).find((p) => p.doc).doc.faces).toBeUndefined();
    expect(d20.approximated).toEqual({ Custom_Dice: 1 });
  });
});

describe("the table top", () => {
  it("is the commonest foot of the flat things lying level; 0.96 with none", () => {
    const tile = (y) => node("Custom_Tile", { kind: "tile", transform: { posY: y } });
    expect(tableHeight([tile(1), tile(1), tile(2)])).toBe(1);
    expect(tableHeight([node("Custom_Model", { kind: "model" })])).toBe(0.96);
    // a card lies by its middle: its foot is half its thickness down
    expect(tableHeight([card(100)].map((c) => ({ ...c, transform: { ...c.transform, posY: 1.01 } })))).toBe(1);
  });
  it("is a slab, its top at the table top; where the mod says Table_None, its top sunk under it (the mod's own table's top is there), its snap points still at the table top", () => {
    const tableOf = (extra) => {
      const { game } = translate(save([node("PlayerPawn", { kind: "piece" })], { snapPoints: [{ position: [1, 1, 1] }], ...extra }), { file: files });
      expect(validate(game).ok, errorText(validate(game))).toBe(true);
      const s = game.setup.find((x) => game.pieces[x.piece]?.name === "Table");
      const piece = game.pieces[s.piece];
      expect(piece.parts.map((p) => p.shape)).toEqual(["slab"]);
      const [part] = piece.parts;
      expect(s.at.position[1]).toBe(0);
      expect(piece.snapPoints.map((p) => p.position[1])).toEqual([0]);
      return part.at[1] + part.thickness;
    };
    for (const table of ["", "Table_Custom", "Table_Square"]) expect(tableOf({ table })).toBeCloseTo(0, 9);
    expect(tableOf({ table: "Table_None" })).toBeCloseTo(-TABLE_NONE_SINK, 9);
  });
});

describe("a setup recipe from what a mod's data says (GAME-FORMAT.md §6)", () => {
  const T = (x, z, more = {}) => ({ posX: x, posY: 1, posZ: z, ...more });
  const hand = (color, x) => node("HandTrigger", { kind: "zone", guid: `h-${color}`, handColor: color, transform: T(x, -12, { posY: 3, scaleX: 10, scaleY: 4, scaleZ: 3 }) });
  const token = (guid, x, z) => node("Custom_Token", { kind: "token", guid, nickname: guid, image: { ImageURL: "https://x/t.png", CustomToken: { Thickness: 0.2 } }, transform: T(x, z) });
  /** A memory bag: these tokens inside, and where it saved each (TTS position, degrees). */
  const memoryBag = (guid, nickname, x, saved) =>
    node("Custom_Model_Bag", { kind: "bag", guid, nickname, transform: T(x, 20), contents: saved.map(([g]) => token(g, 0, 0)), memory: Object.fromEntries(saved.map(([g, px, pz]) => [g, { position: [px, 1, pz], rotation: [0, 90, 0] }])) });

  it("how many play: a seat for each hand, the last in TTS's colour order left out for fewer, as few as PlayerCounts says", () => {
    const { game } = translate(save([hand("Blue", 10), hand("White", -10), hand("Red", 0)], { playerCounts: [2, 3] }), { file: files });
    expect(game.recipe.options).toEqual([{ key: "players", label: "Players", kind: "integer", min: 2, max: 3, default: 3 }]);
    expect(game.recipe.layout).toEqual([{ remove: { seat: "blue" }, unless: "players >= 3" }]);
    expect(validate(game).ok).toBe(true);
    // one hand: nothing to choose
    expect(translate(save([hand("White", 0)]), { file: files }).game.recipe).toBeUndefined();
  });

  it("a memory bag: its things named and placed where it saved them, out of the bag; bags laying out one spot are one choice, others each a yes or no", () => {
    const bags = [
      memoryBag("aaa111", "Heroes", 0, [["t1", 0, 0], ["t2", 4, 0]]),
      memoryBag("bbb222", "Villains", 5, [["t3", 4.5, 0.5]]), // over t2's spot: the same place
      memoryBag("ccc333", "Loot", 10, [["t4", 30, 30]]), // somewhere else
    ];
    bags[0].contents.push(token("stray", 0, 0)); // in the bag, no saved place: stays a bag's thing
    const { game } = translate(save(bags), { file: files });
    expect(game.recipe.options).toEqual([
      { key: "layout", label: "Lay out", kind: "enum", options: [{ value: "none", label: "Nothing" }, { value: "aaa111", label: "Heroes" }, { value: "bbb222", label: "Villains" }], default: "none" },
      { key: "layout2", label: "Lay out “Loot”", kind: "boolean", default: false },
    ]);
    expect(game.recipe.layout.map((s) => [Object.keys(s.place), s.when])).toEqual([
      [["tts-t1", "tts-t2"], "layout == aaa111"],
      [["tts-t3"], "layout == bbb222"],
      [["tts-t4"], "layout2"],
    ]);
    // the place is the thing's as if it lay there (metres, mirrored z, its turn), on the table
    const t2 = game.recipe.layout[0].place["tts-t2"];
    expect(t2.position[0]).toBeCloseTo(4 * 0.0254, 6);
    expect(game.recipe.layout[1].place["tts-t3"].position[2]).toBeCloseTo(-0.5 * 0.0254, 6);
    expect(t2.rotation[1]).toBeCloseTo(-Math.PI / 2, 5);
    expect(t2.position[1]).toBeGreaterThanOrEqual(0);
    const heroes = game.setup.find((t) => t.contents?.some((c) => c.id === "tts-t1"));
    expect(heroes.contents.map((c) => c.id ?? "unnamed")).toEqual(["tts-t1", "tts-t2", "unnamed"]);
    expect(heroes.contents.every((c) => c.at === undefined)).toBe(true);
    expect(validate(game).ok).toBe(true);
    // laid out as Heroes: those two on the table, the stray still in the bag
    const laid = applyRecipe(game, { layout: "aaa111" });
    expect(laid.setup.filter((t) => /^tts-t/.test(t.id ?? "")).map((t) => t.id)).toEqual(["tts-t1", "tts-t2"]);
    expect(laid.setup.find((t) => t.contents?.length === 1).contents[0].id).toBeUndefined();
  });

  it("memory bags in bags, and GUIDs missing or repeated: laid out from wherever they are; what has no saved place, or a repeat of one laid, stays in its bag; a bag with no GUID is a choice all the same", () => {
    const inner = memoryBag("", "Inner", 0, [["t5", 20, 0]]); // no GUID of its own
    inner.contents.push(token("t5", 0, 0)); // the same GUID again: laid once
    const outer = memoryBag("", "Outer", 0, [["t6", 20.2, 0]]); // over the inner's spot, also no GUID
    outer.contents.push(inner, token("", 0, 0)); // a bag inside a bag, and a token with no GUID at all
    outer.memory.ghost = { position: [50, 1, 50], rotation: [0, 0, 0] }; // saved for something that isn't in it: nothing to lay
    const box = node("Custom_Model_Bag", { kind: "bag", guid: "box", nickname: "Box", transform: T(-10, 20), contents: [outer] });
    const { game } = translate(save([box]), { file: files });
    expect(validate(game).ok, errorText(validate(game))).toBe(true);
    expect(game.recipe.options).toEqual([{ key: "layout", label: "Lay out", kind: "enum", options: [{ value: "none", label: "Nothing" }, { value: "bag", label: "Inner" }, { value: "bag-2", label: "Outer" }], default: "none" }]);
    expect(game.recipe.layout.map((x) => [Object.keys(x.place), x.when])).toEqual([[["tts-t5"], "layout == bag"], [["tts-t6"], "layout == bag-2"]]);
    // laid out as Inner: its one token out of two bags onto the table, the repeat still in it
    const laid = applyRecipe(game, { layout: "bag" });
    expect(laid.setup.filter((t) => t.id === "tts-t5")).toHaveLength(1);
    expect(laid.setup.find((t) => t.id === "tts-t5").at.position[0]).toBeCloseTo(20 * 0.0254, 6);
    const all = (things) => things.flatMap((t) => [t, ...all(t.contents ?? [])]);
    const outerBag = all(laid.setup).find((t) => t.contents?.some((c) => c.id === "tts-t6"));
    expect(outerBag.contents.map((t) => t.id ?? (t.contents ? "bag" : "unnamed"))).toEqual(["tts-t6", "bag", "unnamed"]);
    expect(outerBag.contents[1].contents.map((t) => t.id ?? "unnamed")).toEqual(["unnamed"]);
    expect(validate(laid).ok).toBe(true);
  });

  it("face-down decks: shuffled when the game starts if whoever starts it chooses, never otherwise", () => {
    const down = node("Deck", { kind: "deck", guid: "d1", contents: [card(100), card(101)], customDeck: DECK, transform: { rotZ: 180 } });
    const up = node("Deck", { kind: "deck", guid: "d2", contents: [card(102), card(103)], customDeck: DECK, transform: { posX: 5 } });
    const { game } = translate(save([down, up]), { file: files });
    expect(game.recipe).toEqual({ options: [{ key: "shuffle", label: "Shuffle the face-down decks when the game starts", kind: "boolean", default: false }], start: [{ shuffle: "tts-d1", when: "shuffle" }] });
    expect(applyRecipe(game).recipe.start).toEqual([]);
    expect(applyRecipe(game, { shuffle: true }).recipe.start).toEqual([{ shuffle: "tts-d1" }]);
  });
});
