// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classify, collectAssets, countNames, deckEntry, readSave, walk } from "./tts.js";
import { fixtureSave } from "./test/fixture.js";

describe("classify", () => {
  it("knows TTS's object names", () => {
    const cases = {
      Card: "card", CardCustom: "card", Deck: "deck", DeckCustom: "deck",
      Bag: "bag", Infinite_Bag: "bag", Custom_Model_Bag: "bag", Custom_Model_Infinite_Bag: "bag", Custom_Assetbundle_Bag: "bag",
      Custom_Model: "model", Custom_Model_Stack: "model", Custom_Tile: "tile", Custom_Tile_Stack: "tile",
      Custom_Token: "token", Custom_Token_Stack: "token", Custom_Board: "board", Figurine_Custom: "figurine",
      Custom_Dice: "die", Die_6: "die", Die_20: "die", Custom_PDF: "pdf", Custom_Assetbundle: "assetbundle",
      HandTrigger: "zone", ScriptingTrigger: "zone", LayoutZone: "zone", "3DText": "text", Notecard: "text",
      BlockSquare: "piece", Chess_Pawn_White: "piece", Checker_white: "piece", backgammon_piece_brown: "piece",
      Counter: "fixture", SomethingNew: "unknown",
    };
    for (const [name, kind] of Object.entries(cases)) expect([name, classify(name)]).toEqual([name, kind]);
  });
});

describe("readSave", () => {
  it("reads the fixture: names, transforms, contents, snap points; never the scripts", () => {
    const save = readSave(fixtureSave());
    expect(save.saveName).toBe("Tiny Test Mod");
    expect(save.table).toBe("Table_Custom");
    expect(save.snapPoints).toHaveLength(2);
    expect(save.snapPoints[1]).toEqual({ position: [-6, 0.96, -6], rotation: [0, 90, 0], tags: [] });
    const [board, deck] = save.objects;
    expect(board).toMatchObject({ kind: "tile", nickname: "Board", locked: true, path: "0" });
    expect(board.snapPoints).toHaveLength(4);
    expect(board.snapPoints[1].rotation).toBeNull();
    expect(deck.kind).toBe("deck");
    expect(deck.contents.map((c) => [c.cardId, c.path])).toEqual([[1100, "1/0"], [1101, "1/1"], [1102, "1/2"]]);
    expect(deckEntry(deck.contents[0], deck).FaceURL).toMatch(/AAAA1111/);
    expect(JSON.stringify(save)).not.toMatch(/never read|ignored|Panel/);
    const hand = save.objects.find((o) => o.name === "HandTrigger");
    expect(hand.handColor).toBe("White");
    const stack = save.objects.find((o) => o.name === "Custom_Tile_Stack");
    expect(stack.number).toBe(3);
  });

  it("walks everything, counts names and collects asset URLs with who uses them", () => {
    const save = readSave(fixtureSave());
    expect([...walk(save.objects)].length).toBe(17);
    expect(countNames(save.objects)).toMatchObject({ CardCustom: 4, Custom_Token: 2, Custom_Model: 2 });
    const assets = collectAssets(save.objects, { tableURL: save.tableURL });
    expect(assets.size).toBe(10);
    const sheet = [...assets.values()].find((a) => /AAAA1111/.test(a.url));
    expect(sheet).toMatchObject({ type: "image", uses: 4 });
    expect(sheet.by).toEqual(["Red One", "Green Two", "Blue Three", "Yellow Four"]);
    expect([...assets.values()].find((a) => /rules\.pdf/.test(a.url)).type).toBe("pdf");
    expect([...assets.values()].filter((a) => a.type === "model")).toHaveLength(3);
  });

  it("refuses what isn't a save", () => {
    expect(() => readSave("{}")).toThrow(/ObjectStates/);
    expect(() => readSave("nope")).toThrow();
  });
});
