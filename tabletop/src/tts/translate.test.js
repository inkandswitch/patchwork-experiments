// The translation's parts, over finite cases: every quarter-turn pose of a
// face-down deck comes out as TTS has it; every tile shape, every die, both
// kinds of bag; and an image's size read from its header.
import { describe, it, expect } from "vitest";
import { translate, tableHeight } from "./translate.js";
import { convertRotation, sceneRotationMatrix } from "./convert.js";
import { imageSize } from "./image-size.js";
import { encodePNG } from "./test/png.js";
import { validate, errorText } from "./test/contract/validate.js";

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
    const bare = translate(save([node("Custom_Token", { kind: "token", image: { ImageURL: "https://x/t.png", CustomToken: {} } })]));
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
    const t = translate(save(objects, { tableURL: "https://x/table.png", snapPoints: [{ position: [0, 1, 0], rotation: null, tags: [] }], note: "Read the rules.", rules: "Don't." }), { file: files, imageSize: () => ({ width: 200, height: 100 }) });
    const r = validate(t.game);
    expect(r.ok, errorText(r)).toBe(true);
    expect(t.counts).toMatchObject({ cards: 6, decks: 2, bags: 1, dice: 1, seats: 2 });
    expect(t.game.about).toMatch(/Don't\.\n\nRead the rules\.$/);
    expect(Object.keys(t.game.seats)).toEqual(["blue", "red"]);
    // a tile cut to its picture: twice as wide as deep
    const tile = Object.values(t.game.pieces).find((p) => p.name === "Tile").parts[0];
    expect(tile.size[0] / tile.size[1]).toBeCloseTo(2, 6);
  });

  it("stops at its limit, and says so", () => {
    const t = translate(save(Array.from({ length: 5 }, () => node("PlayerPawn", { kind: "piece" }))), { maxObjects: 3 });
    expect(t.game.setup.filter((s) => s.piece && t.game.pieces[s.piece].name === "PlayerPawn")).toHaveLength(3);
    expect(t.warnings).toEqual(["stopped at 3 objects: 2 more were left out"]);
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
});

describe("an image's size, from its header", () => {
  it("PNG, GIF and JPEG; nothing else", () => {
    expect(imageSize(encodePNG(7, 3, new Uint8Array(7 * 3 * 4)))).toEqual({ width: 7, height: 3 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0x10, 0x00]))).toEqual({ width: 288, height: 16 });
    // SOI, an APP0 of 16 bytes, then SOF0: precision, height 600, width 800
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600 });
    expect(imageSize(new TextEncoder().encode("<html>not an image</html>"))).toBe(null);
    expect(imageSize(new Uint8Array(3))).toBe(null);
  });
});
