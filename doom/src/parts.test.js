// The parts a map is made of: Doom's pegging rules case by case, and on
// E1M1 the seams between the static part and each door, at rest.
import { describe, expect, it } from "vitest";
import { anchorOf, INSET, mapModel, modelOf, partGeometry, sectorAt, textureTop, UPPER_UNPEGGED, unpeggedFaces } from "./parts.js";
import { notesOf } from "./source.js";
import { readMap, readTextures } from "./wad.js";
import { fixture } from "./test/fixture.js";

describe("pegging (dmsp1666 §4.3): which edge a wall's texture hangs from", () => {
  // a side's sector F, the sector beyond B (both at rest), a texture 72 tall
  const F = { floor: 0, ceiling: 128 };
  const B = { floor: 24, ceiling: 96 };
  const h = 72;
  const UPPER = 8, LOWER = 16;
  const cases = [
    // [kind, flags, top]
    ["wall", 0, 128], // hangs from the ceiling
    ["wall", UPPER, 128],
    ["wall", LOWER, 72], // stands on the floor
    ["wall", UPPER | LOWER, 72],
    ["lower", 0, 24], // hangs from the higher floor beyond
    ["lower", UPPER, 24],
    ["lower", LOWER, 128], // as if from this ceiling
    ["lower", UPPER | LOWER, 128],
    ["upper", 0, 96 + 72], // stands on the lower ceiling beyond: goes with it
    ["upper", UPPER, 128], // hangs from this ceiling
    ["upper", LOWER, 96 + 72],
    ["upper", UPPER | LOWER, 128],
    ["railing", 0, 96], // hangs from the lower ceiling
    ["railing", UPPER, 96],
    ["railing", LOWER, 24 + 72], // stands on the higher floor
    ["railing", UPPER | LOWER, 24 + 72],
  ];
  it.each(cases)("%s with flags %i: top row at %i", (kind, flags, top) => {
    expect(textureTop(kind, flags, F, B, h)).toBe(top);
  });
  it("names only the four kinds", () => expect(() => textureTop("ceiling", 0, F, B, h)).toThrow());
});

describe("parts", () => {
  it("a door part is only a door that works here", () => {
    const m = mapModel(fixture(), "E1M1");
    expect(() => anchorOf(m, 98)).toThrow(/isn't a door/); // a lift
    expect(() => partGeometry(m, 98)).toThrow(/isn't a door/);
    expect(() => anchorOf(m, 100)).not.toThrow();
  });
});

describe("E1M1's parts, at rest", () => {
  const wad = fixture();
  const model = mapModel(wad, "E1M1");
  const textures = readTextures(wad);
  /** a part's wall vertices, back in map units: [{ x, y, z, u, v, texture }] */
  const vertsOf = (door) => {
    const g = partGeometry(model, door);
    const out = [];
    for (const b of g.buckets.values()) {
      if (b.kind !== "wall") continue;
      for (let i = 0; i < b.positions.length / 3; i++) out.push({ x: b.positions[i * 3] + g.anchor[0], y: b.positions[i * 3 + 1] + g.anchor[1], z: b.positions[i * 3 + 2] + g.anchor[2], u: b.uvs[i * 2], v: b.uvs[i * 2 + 1], texture: b.texture });
    }
    return { g, out };
  };
  const statics = vertsOf(null);

  it("the 11 doors are E1M1's plain doors", () => {
    expect(model.specials.doors.map((d) => d.sector)).toEqual([10, 34, 48, 54, 64, 78, 79, 80, 81, 84, 100]);
  });

  it.each(model.specials.doors.map((d) => [d.sector, d]))("door %i meets the wall above it seamlessly when shut, and its face is its own", (sector, d) => {
    const { out } = vertsOf(sector);
    expect(out.length).toBeGreaterThan(0);
    const top = out.filter((p) => p.z === d.open);
    const bottom = out.filter((p) => p.z === d.closed);
    expect(top.length).toBe(bottom.length);
    for (const p of top) {
      // the static wall's vertex on the same line (the door's strip sits INSET inside it), same height
      const q = statics.out.find((s) => s.texture === p.texture && s.z === p.z && Math.hypot(s.x - p.x, s.y - p.y) <= INSET + 1e-9 && Math.abs(s.u - p.u) < 1e-9);
      expect(q, `door ${sector} at ${p.x},${p.y}`).toBeTruthy();
      expect(q.v).toBeCloseTo(p.v, 12);
    }
    // the door's face: on each of its lines, the texture's bottom row is on the door's bottom edge, after the side's row offset
    expect(faceErrors(model, sector)).toEqual([]);
  });

  /**
   * Where a door's face isn't standing on its bottom edge: for each line to a
   * neighbour, the door's bottom vertices of that side's upper texture should
   * have v = (h + yoff) / h (top row at closed + h, less the row offset).
   */
  function faceErrors(m, sector) {
    const g = partGeometry(m, sector);
    const d = m.doors.get(sector);
    const V = m.map.vertexes;
    const errs = [];
    m.map.linedefs.forEach((l, i) => {
      if (l.left < 0) return;
      const f = m.map.sidedefs[l.right].sector, b = m.map.sidedefs[l.left].sector;
      if (f === b || (f !== sector && b !== sector)) return;
      const side = m.map.sidedefs[f === sector ? l.left : l.right];
      const h = textures.get(side.upper).height;
      const b0 = g.buckets.get(`wall:${side.upper}`);
      for (const v of [V[l.v1], V[l.v2]]) {
        let found = false;
        for (let k = 0; k < b0.positions.length / 3; k++) {
          const x = b0.positions[k * 3] + g.anchor[0], y = b0.positions[k * 3 + 1] + g.anchor[1], z = b0.positions[k * 3 + 2] + g.anchor[2];
          if (z !== d.closed || Math.hypot(x - v.x, y - v.y) > INSET + 1e-9) continue;
          found = true;
          const want = (h + side.yoff) / h;
          if (Math.abs(b0.uvs[k * 2 + 1] - want) > 1e-12) errs.push({ line: i, v: b0.uvs[k * 2 + 1], want });
        }
        if (!found) errs.push({ line: i, missing: [v.x, v.y] });
      }
    });
    return errs;
  }

  it("the face check sees a row offset (doors 48 and 84 have one), and would see a face hung from the wrong edge", () => {
    const offsets = [48, 84].map((s) => model.map.linedefs.filter((l) => l.left >= 0 && [l.right, l.left].some((x) => model.map.sidedefs[x].sector === s)).map((l) => [l.right, l.left].map((x) => model.map.sidedefs[x]).find((sd) => sd.sector !== s).yoff));
    expect(offsets.map((o) => o.some((y) => y !== 0))).toEqual([true, true]);
    // (on most of E1M1's doors the ceiling beyond is one texture above the door's floor, so either edge gives
    // the same rows; on 48 and 84 it isn't.) Their faces made upper-unpegged: the texture now hangs from the
    // ceiling beyond, not the door's bottom edge, and the check sees it
    const map = structuredClone(readMap(wad, "E1M1"));
    for (const l of map.linedefs) if (l.left >= 0 && [l.right, l.left].some((x) => [48, 84].includes(map.sidedefs[x].sector))) l.flags |= UPPER_UNPEGGED;
    const m = modelOf(wad, map);
    for (const s of [48, 84]) expect(faceErrors(m, s).length, `door ${s}`).toBeGreaterThan(0);
    // and those doors' notes say the face rises with the door, where Doom keeps it still
    expect(unpeggedFaces(m, 48).length).toBe(2);
    expect(notesOf(m, 48, [])).toMatch(/lines \d+, \d+ is upper-unpegged: Doom keeps that texture still as the door rises; here it rises with the door/);
    for (const d of model.specials.doors) expect(unpeggedFaces(model, d.sector)).toEqual([]);
  });

  it("a door a map leaves ajar shuts to its floor: imported shut, its faces aligned to it shut, the seam still clean", () => {
    // door 100 left 16 units open
    const map = structuredClone(readMap(wad, "E1M1"));
    map.sectors[100].ceiling = map.sectors[100].floor + 16;
    const m = modelOf(wad, map);
    const d = m.doors.get(100);
    expect(d).toMatchObject({ closed: map.sectors[100].floor, ajar: 16, open: model.doors.get(100).open });
    expect(anchorOf(m, 100)[2]).toBe(map.sectors[100].floor);
    expect(faceErrors(m, 100)).toEqual([]);
    expect(notesOf(m, 100, [])).toMatch(/leaves it 16 units ajar; it is imported shut/);
    // the static wall above it is aligned to the door shut too: the seam's v matches
    const g = partGeometry(m, 100);
    const s = partGeometry(m, null);
    const at = (gg, tex, z) => {
      const b = gg.buckets.get(`wall:${tex}`);
      const out = [];
      for (let k = 0; k < b.positions.length / 3; k++) if (b.positions[k * 3 + 2] + gg.anchor[2] === z) out.push({ x: b.positions[k * 3] + gg.anchor[0], y: b.positions[k * 3 + 1] + gg.anchor[1], u: b.uvs[k * 2], v: b.uvs[k * 2 + 1] });
      return out;
    };
    let seams = 0;
    for (const b of g.buckets.values()) {
      if (b.kind !== "wall") continue;
      for (const p of at(g, b.texture, d.open)) {
        const q = at(s, b.texture, d.open).find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= INSET + 1e-9 && Math.abs(q.u - p.u) < 1e-9);
        expect(q).toBeTruthy();
        expect(q.v).toBeCloseTo(p.v, 12);
        seams++;
      }
    }
    expect(seams).toBeGreaterThan(0);
  });

  it("the static part has no ceiling over a door, and the door's underside is at its shut height", () => {
    for (const d of model.specials.doors) {
      const g = partGeometry(model, d.sector);
      const flats = [...g.buckets.values()].filter((b) => b.kind === "flat");
      expect(flats).toHaveLength(1);
      // all of it at the anchor's height, which is the door's shut one
      for (let i = 2; i < flats[0].positions.length; i += 3) expect(flats[0].positions[i]).toBe(0);
      expect(g.anchor[2]).toBe(d.closed);
    }
  });

  it("what doesn't work here is drawn where it rests: the lifts' floors at their resting heights", () => {
    const g = partGeometry(model, null);
    const lifts = model.specials.resting.find((r) => r.kind === "lift").sectors;
    expect(lifts).toEqual([98, 103]);
    const floors = [...g.buckets.values()].filter((b) => b.kind === "flat").flatMap((b) => {
      const zs = [];
      for (let i = 2; i < b.positions.length; i += 3) zs.push(b.positions[i] + g.anchor[2]);
      return zs;
    });
    for (const s of lifts) expect(floors).toContain(model.map.sectors[s].floor);
  });

  it("every wall texture E1M1 names is drawn: nothing missing", () => {
    expect(statics.g.missing).toEqual([]);
  });
});

describe("the exit switch, a part of its own", () => {
  const model = mapModel(fixture(), "E1M1");
  /** A bucket's triangles in the map's own units, as world-placed corner lists with their uvs (from the part's anchor). */
  const corners = (g, key) => {
    const b = g.buckets.get(key);
    if (!b) return [];
    const out = [];
    for (let t = 0; t < b.indices.length; t += 3) {
      const tri = [0, 1, 2].map((k) => {
        const i = b.indices[t + k];
        return [b.positions[3 * i] + g.anchor[0], b.positions[3 * i + 1] + g.anchor[1], b.positions[3 * i + 2] + g.anchor[2], b.uvs[2 * i], b.uvs[2 * i + 1], b.colors[3 * i]].map((v) => +v.toFixed(9)).join(",");
      });
      out.push(tri.join(" "));
    }
    return out.sort();
  };

  it("E1M1 has one: line 407 (type 11), not left among what isn't imported", () => {
    expect(model.specials.exits).toEqual([{ line: 407, secret: false }]);
    expect(model.specials.inert.flatMap((r) => r.lines)).not.toContain(407);
  });

  it("is exactly the walls the static part would draw on that line, which the static part leaves out: the two meet with no seam", () => {
    const exit = partGeometry(model, null, 407);
    const whole = partGeometry({ ...model, exits: new Map() }, null); // the static part as if nothing were pulled out
    const statics = partGeometry(model, null);
    const key = "wall:SW1GRAY";
    expect([...exit.buckets.keys()]).toEqual([key]);
    expect(corners(exit, key)).toHaveLength(2);
    expect(corners(exit, key)).toEqual(corners(whole, key));
    expect(statics.buckets.has(key)).toBe(false);
    // and nothing else differs between the two static parts
    const others = (g) => [...g.buckets.keys()].filter((k) => k !== key).sort().flatMap((k) => corners(g, k));
    expect(others(statics)).toEqual(others(whole));
  });

  it("is anchored at the middle of its line on its floor; a line that isn't one is refused", () => {
    expect(anchorOf(model, null, 407)).toEqual([-400, 1296, -120]);
    expect(() => anchorOf(model, null, 406)).toThrow(/isn't an exit switch/);
  });

  // Can a walker get there from the player 1 start? Over the sectors as they
  // are here: plain doors open, everything that doesn't work here where it
  // rests (the lifts too), and a walker with the arena's body at 36 units to
  // the metre: up 30 (a jump's apex, 0.85 m; it steps 16), any drop, 60 of
  // headroom (1.67 m), never across an impassable line.
  it("is reachable on foot from the player 1 start, through plain doors only", () => {
    const { map, doors } = model;
    const floor = (s) => map.sectors[s].floor;
    const ceil = (s) => (doors.has(s) ? doors.get(s).open : map.sectors[s].ceiling);
    const start = map.things[model.specials.starts.find((s) => s.player === 1).thing];
    const s0 = sectorAt(model, start.x, start.y);
    const goal = map.sidedefs[map.linedefs[407].right].sector;
    const prev = new Map([[s0, null]]);
    const queue = [s0];
    while (queue.length) {
      const s = queue.shift();
      map.linedefs.forEach((l) => {
        if (l.left < 0 || l.flags & 1) return;
        const f = map.sidedefs[l.right].sector, b = map.sidedefs[l.left].sector;
        const o = f === s ? b : b === s ? f : -1;
        if (o < 0 || prev.has(o)) return;
        if (floor(o) - floor(s) > 30 || Math.min(ceil(o), ceil(s)) - Math.max(floor(o), floor(s)) < 60) return;
        prev.set(o, s);
        queue.push(o);
      });
    }
    const path = [];
    for (let s = goal; s != null && prev.has(s); s = prev.get(s)) path.push(s);
    path.reverse();
    expect(path[0]).toBe(s0);
    expect(path.at(-1)).toBe(goal);
    // the plain doors on the way, and that no locked door is
    expect(path.filter((s) => doors.has(s))).toEqual([10, 34, 64]);
    const resting = new Set(model.specials.resting.filter((r) => r.kind !== "lift").flatMap((r) => r.sectors));
    expect(path.filter((s) => resting.has(s))).toEqual([]);
  });
});
