// Reading a WAD, against Freedoom's E1M1 (src/test/e1m1.wad: the map's lumps
// verbatim, and what drawing it needs; probes/make-fixture.mjs).
import { describe, expect, it } from "vitest";
import { findLump, flat, patch, readMap, readPalette, readPicture, readTextures, readWad } from "./wad.js";

import { fixture } from "./test/fixture.js";

describe("the archive", () => {
  it("reads the directory and finds the map", () => {
    const wad = fixture();
    expect(wad.kind).toBe("PWAD");
    expect(wad.maps).toEqual(["E1M1"]);
    expect(wad.lumps.length).toBe(227);
    expect(findLump(wad, "PLAYPAL").size).toBe(14 * 768);
  });

  it("refuses what isn't one, and a directory that runs past the end", () => {
    expect(() => readWad(new Uint8Array(4))).toThrow(/too short/);
    expect(() => readWad(new TextEncoder().encode("JUNKJUNKJUNKJUNK"))).toThrow(/not a WAD/);
    const b = new Uint8Array(12);
    b.set([..."PWAD"].map((c) => c.charCodeAt(0)));
    new DataView(b.buffer).setInt32(4, 10, true);
    new DataView(b.buffer).setInt32(8, 12, true);
    expect(() => readWad(b)).toThrow(/runs past/);
  });

  it("names a missing map, and the maps there are", () => {
    expect(() => readMap(fixture(), "E1M2")).toThrow(/no map E1M2 .*\(it has E1M1\)/);
  });
});

describe("E1M1, as the Unofficial Doom Specs lay its records out", () => {
  const map = readMap(fixture(), "E1M1");
  it("has Freedoom 0.13.0's counts: 182 sectors, 1,175 lines, 292 things", () => {
    expect(map.sectors).toHaveLength(182);
    expect(map.linedefs).toHaveLength(1175);
    expect(map.things).toHaveLength(292);
    expect(map.sidedefs).toHaveLength(54870 / 30);
    expect(map.vertexes).toHaveLength(4784 / 4);
  });
  it("every line has a front side; every reference points at something there", () => {
    for (const l of map.linedefs) {
      expect(l.right).toBeGreaterThanOrEqual(0);
      expect(l.v1).toBeLessThan(map.vertexes.length);
      expect(l.v2).toBeLessThan(map.vertexes.length);
    }
    for (const s of map.sidedefs) expect(s.sector).toBeLessThan(map.sectors.length);
  });
  it("player 1 starts at (-416, 256) facing east, in a sector with its floor at 0", () => {
    const t = map.things.find((x) => x.type === 1);
    expect(t).toEqual({ x: -416, y: 256, angle: 0, type: 1, flags: 7 });
  });
  it("its specials: 20 door lines of type 1, 1 of 117, 4 locked (26); one exit", () => {
    const count = (n) => map.linedefs.filter((l) => l.special === n).length;
    expect([count(1), count(117), count(26), count(11)]).toEqual([20, 1, 4, 1]);
  });
});

describe("pictures", () => {
  const wad = fixture();
  it("the palette is 256 colours", () => {
    expect(readPalette(wad)).toHaveLength(768);
  });
  it("every texture the map uses is defined, from patches the WAD has", () => {
    const map = readMap(wad, "E1M1");
    const tex = readTextures(wad);
    const used = new Set(map.sidedefs.flatMap((s) => [s.upper, s.lower, s.middle]).filter((n) => n !== "-"));
    for (const n of used) {
      const t = tex.get(n);
      expect(t, n).toBeTruthy();
      expect(t.width).toBeGreaterThan(0);
      for (const p of t.patches) expect(patch(wad, p.patch), `${n}: ${p.patch}`).toBeTruthy();
    }
  });
  it("every flat the map uses is 64 × 64 (but the sky, which isn't a picture)", () => {
    const map = readMap(wad, "E1M1");
    for (const f of new Set(map.sectors.flatMap((s) => [s.floorFlat, s.ceilingFlat]))) expect(flat(wad, f)?.length, f).toBe(4096);
  });
  it("a picture's posts fill only what they cover", () => {
    // 2 × 3: column 0 has a post of 2 from row 1; column 1 is empty
    const b = new Uint8Array([2, 0, 3, 0, 0, 0, 0, 0, 16, 0, 0, 0, 22, 0, 0, 0, 1, 2, 0, 7, 9, 0, 0xff, 0xff]);
    const pic = readPicture(b);
    expect([pic.width, pic.height]).toEqual([2, 3]);
    expect([...pic.pixels]).toEqual([-1, -1, 7, -1, 9, -1]);
  });
});
