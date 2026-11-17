import { describe, it, expect } from "vitest";
import { cardCell, cardFaces, cellRect } from "./cards.js";

describe("card cells", () => {
  it("CardID is deckKey * 100 + cell", () => {
    expect(cardCell(354)).toEqual({ deckKey: 3, index: 54 }); // the KB's own example
    expect(cardCell(2700)).toEqual({ deckKey: 27, index: 0 });
    expect(cardCell(10169)).toEqual({ deckKey: 101, index: 69 });
  });

  it("counts cells row by row from the top left (TTS's 10 × 7 template)", () => {
    expect(cellRect(0, 10, 7)).toMatchObject({ col: 0, row: 0, x: 0, y: 0, w: 0.1 });
    expect(cellRect(9, 10, 7)).toMatchObject({ col: 9, row: 0 });
    expect(cellRect(10, 10, 7)).toMatchObject({ col: 0, row: 1 });
    const hidden = cellRect(69, 10, 7); // the "hidden" face
    expect(hidden).toMatchObject({ col: 9, row: 6, clamped: false });
    expect(hidden.x).toBeCloseTo(0.9);
    expect(hidden.y).toBeCloseTo(6 / 7);
    expect(cellRect(75, 10, 7)).toMatchObject({ col: 9, row: 6, clamped: true });
    expect(cellRect(0, 1, 1)).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("a card's faces: its cell of the face sheet, and the whole back (or its cell, with UniqueBack)", () => {
    const entry = { FaceURL: " https://f/ ", BackURL: "https://b/", NumWidth: 2, NumHeight: 2, UniqueBack: false };
    const f = cardFaces(1103, entry);
    expect(f.face.url).toBe("https://f/");
    expect(f.face.rect).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(f.back.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const u = cardFaces(1101, { ...entry, UniqueBack: true });
    expect(u.back.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(cardFaces(1, null)).toBeNull();
  });
});
